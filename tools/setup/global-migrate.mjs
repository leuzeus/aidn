import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { projectRoot } from './installed-project.mjs';
import { rememberProject, readProjects } from './project-registry.mjs';
import { planInstallationAssets, executeInstallationAssets, readInstallationContext } from '../../src/application/install/codex-assets-service.mjs';
import { renderGlobalCommands } from '../../src/application/install/global-project-integration.mjs';
import { inventoryGlobalMigration } from '../../src/application/install/global-migration-inventory.mjs';
import { inspectGlobalProjectCompatibility } from '../../src/application/install/global-project-compatibility.mjs';
import { acquireGlobalRuntime, checkedHostPath, resolveGlobalRuntime, hostExecutionIdentity } from '../../src/application/install/global-runtime-store.mjs';
import { writeFileAtomicSync } from '../../src/lib/fs/atomic-write-lib.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error(code); };
const relativeJournal = '.aidn/install/global-migration.json';
const read = file => { checkedHostPath(file); return fs.existsSync(file) ? fs.readFileSync(file) : null; };
const json = file => { const bytes = read(file); return bytes ? JSON.parse(bytes) : null; };
const write = (file, data) => { checkedHostPath(file); writeFileAtomicSync(file, JSON.stringify({ ...data, journal_sha256: hash(JSON.stringify(data)) }, null, 2) + '\n'); };
function dependenciesOf(pkg) {
  return Object.fromEntries(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].map(section =>
    [section, Object.fromEntries(Object.entries(pkg?.[section] ?? {}).filter(([name]) => name !== 'aidn-workflow'))]));
}
function protectedDependencies(pkg, lock) {
  const packages = lock?.packages ?? {}, protectedEntries = new Map();
  const locate = (owner, name) => {
    let directory = owner;
    while (true) {
      const candidate = [directory, 'node_modules', name].filter(Boolean).join('/');
      if (packages[candidate]) return candidate;
      if (!directory) return null;
      const parent = path.posix.dirname(directory); directory = parent === '.' ? '' : parent;
    }
  };
  const visit = key => {
    if (!key || protectedEntries.has(key)) return;
    if (key.endsWith('/aidn-workflow')) fail('GLOBAL_MIGRATION_SHARED_AIDN_DEPENDENCY');
    const entry = packages[key];
    protectedEntries.set(key, entry);
    if (entry.link && packages[entry.resolved]) visit(entry.resolved);
    for (const name of new Set([...Object.keys(entry.dependencies ?? {}), ...Object.keys(entry.optionalDependencies ?? {}), ...Object.keys(entry.peerDependencies ?? {})])) visit(locate(key, name));
  };
  for (const entries of Object.values(dependenciesOf(pkg))) for (const name of Object.keys(entries)) visit(locate('', name));
  return protectedEntries;
}
function dependencyIdentity(entry) {
  if (!entry) return null;
  return Object.fromEntries(['version', 'resolved', 'integrity', 'link', 'dependencies', 'optionalDependencies', 'peerDependencies'].filter(key => Object.hasOwn(entry, key)).map(key => [key, entry[key]]));
}
function integrationOptions(home, root, runtime, inventory) {
  const { receipt } = readInstallationContext({ targetRoot: root });
  const operations = inventory.entries.filter(item => item.reason === 'managed-operational-commands').map(item => ({
    path: item.path, kind: 'local-file', data: Buffer.from(renderGlobalCommands(read(path.join(root, item.path)).toString('utf8'))).toString('base64'),
  }));
  // Use the existing installation finalization boundary without rewriting its
  // configuration: identical bytes checkpoint the no-data-migration callback.
  operations.push({ path: '.aidn/config.json', kind: 'config-fields', data: read(path.join(root, '.aidn/config.json')).toString('base64'), finalize: true });
  return { repoRoot: runtime.packageRoot, targetRoot: root, globalHome: home, installation: { operations,
    context: { args: receipt.installation.args, version_after: receipt.installation.version, external_effects: [] } } };
}

export async function planGlobalMigration({ home, target }) {
  const root = projectRoot(target);
  const runtime = resolveGlobalRuntime({ home });
  readProjects(home);
  if (read(path.join(root, relativeJournal))) fail('GLOBAL_MIGRATION_REQUIRES_RESUME');
  const inventory = inventoryGlobalMigration({ targetRoot: root, globalSkillsVerified: true, globalAgentsVerified: true });
  protectedDependencies(json(path.join(root, 'package.json')), json(path.join(root, 'package-lock.json')));
  const compatibility = inventory.conflicts.length ? { fingerprint: null } : await inspectGlobalProjectCompatibility({ targetRoot: root });
  const integration = planInstallationAssets(integrationOptions(home, root, runtime, inventory));
  const data = { schema_version: 1, target: root, installation_id: runtime.state.installation_id, generation: runtime.state.active.id,
    compatibility_fingerprint: compatibility.fingerprint, inventory, integration_plan: integration.plan_id,
    conflicts: [...inventory.conflicts, ...(integration.conflicts ?? [])], registry: hash(JSON.stringify(readProjects(home))) };
  return { ...data, plan_id: hash(JSON.stringify(data)), written: false };
}

function backup(root, plan) {
  const names = new Set([...plan.inventory.entries.filter(item => item.sha256).map(item => item.path),
    '.aidn/config.json', '.aidn/project/workflow.adapter.json', '.aidn/install/receipt.json', 'package.json', 'package-lock.json']);
  const snapshots = [];
  for (const name of names) {
    const content = read(path.join(root, name));
    snapshots.push({ path: name, sha256: content ? hash(content) : null, bytes: content?.toString('base64') ?? null });
  }
  return snapshots;
}

export async function executeGlobalMigration(options, dependencies = {}) {
  if (!options.write) return planGlobalMigration(options);
  const lease = acquireGlobalRuntime({ home: options.home });
  try {
    const plan = await planGlobalMigration(options);
    if (!options.expectedPlanId || plan.plan_id !== options.expectedPlanId) fail('GLOBAL_PLAN_MISMATCH');
    if (plan.conflicts.length) fail('GLOBAL_MIGRATION_CONFLICT');
    const file = path.join(plan.target, relativeJournal);
    const lock = checkedHostPath(`${file}.lock`);
    let fd;
    try { fd = fs.openSync(lock, 'wx'); } catch (error) { if (error.code === 'EEXIST') fail('GLOBAL_MIGRATION_BUSY'); throw error; }
    try {
      fs.writeFileSync(fd, JSON.stringify(hostExecutionIdentity()));
      if (read(file)) fail('GLOBAL_MIGRATION_REQUIRES_RESUME');
      const snapshots = backup(plan.target, plan);
      const tx = { schema_version: 1, id: randomUUID(), plan, phase: 'prepared', snapshots };
      // The existing installation store is privately ignored before any backup.
      if (read(path.join(plan.target, '.aidn/install/.gitignore'))?.toString('utf8').trim() !== '*') fail('GLOBAL_PRIVATE_BACKUP_STORE_REQUIRED');
      write(file, tx);
      return await finishMigration(options.home, file, tx, lease, dependencies);
    } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  } finally { lease.release(); }
}

async function finishMigration(home, file, tx, runtime, dependencies) {
  const root = tx.plan.target;
  if (runtime.state.installation_id !== tx.plan.installation_id || runtime.state.active.id !== tx.plan.generation) fail('GLOBAL_MIGRATION_GENERATION_CHANGED');
  if (tx.phase === 'prepared') {
    const args = { ...integrationOptions(home, root, runtime, tx.plan.inventory), dryRun: false };
    const pending = read(path.join(root, '.aidn/install/pending.json'));
    const receipt = readInstallationContext({ targetRoot: root }).receipt;
    const completed = receipt?.last_transaction && /^[a-f0-9]{32}$/.test(receipt.last_transaction)
      ? json(path.join(root, '.aidn/install/transactions', `${receipt.last_transaction}.json`)) : null;
    const alreadyApplied = completed?.plan_id === tx.plan.integration_plan && completed.status === 'complete';
    if (pending) args.action = 'resume';
    const integration = planInstallationAssets(args);
    if (!integration.ok || !pending && !alreadyApplied && integration.plan_id !== tx.plan.integration_plan) fail('GLOBAL_MIGRATION_INTEGRATION_CHANGED');
    if (!alreadyApplied) {
      const result = await executeInstallationAssets({ ...args, expectedPlanId: integration.plan_id }, async () => {});
      if (!result.ok || result.pending) fail('GLOBAL_MIGRATION_INTEGRATION_FAILED');
    }
    tx.phase = 'integration-complete'; write(file, tx);
  }
  if (tx.phase === 'integration-complete') {
    const pkg = json(path.join(root, 'package.json'));
    const original = tx.snapshots.find(item => item.path === 'package.json');
    const old = original?.bytes ? JSON.parse(Buffer.from(original.bytes, 'base64')) : null;
    const oldLockBytes = tx.snapshots.find(item => item.path === 'package-lock.json')?.bytes;
    const oldLock = oldLockBytes ? JSON.parse(Buffer.from(oldLockBytes, 'base64')) : null;
    const protectedEntries = protectedDependencies(old, oldLock);
    if (JSON.stringify(dependenciesOf(pkg)) !== JSON.stringify(dependenciesOf(old))) fail('GLOBAL_MIGRATION_OTHER_DEPENDENCIES_CHANGED');
    if (pkg && ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].some(section => Object.hasOwn(pkg[section] ?? {}, 'aidn-workflow'))
        || fs.existsSync(path.join(root, 'node_modules/aidn-workflow'))) {
      const npm = dependencies.npmCli ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
      if (!fs.existsSync(npm)) fail('NODE_BUNDLED_NPM_REQUIRED');
      const result = (dependencies.run ?? spawnSync)(process.execPath,
        [npm, 'uninstall', 'aidn-workflow', '--ignore-scripts', '--no-audit', '--no-fund'],
        { cwd: root, env: process.env, shell: false, windowsHide: true, encoding: 'utf8', timeout: 300000, maxBuffer: 2 * 1024 * 1024 });
      if (result.error || result.status !== 0) fail('GLOBAL_MIGRATION_NPM_FAILED');
    }
    const after = json(path.join(root, 'package.json'));
    const afterLock = json(path.join(root, 'package-lock.json'));
    for (const [key, beforeEntry] of protectedEntries) {
      if (JSON.stringify(dependencyIdentity(beforeEntry)) !== JSON.stringify(dependencyIdentity(afterLock?.packages?.[key]))) fail('GLOBAL_MIGRATION_DEPENDENCY_LOCK_CHANGED');
    }
    if (JSON.stringify(dependenciesOf(after)) !== JSON.stringify(dependenciesOf(old))) fail('GLOBAL_MIGRATION_OTHER_DEPENDENCIES_CHANGED');
    if (after && ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].some(section => Object.hasOwn(after[section] ?? {}, 'aidn-workflow'))
        || json(path.join(root, 'package-lock.json'))?.packages?.['node_modules/aidn-workflow']
        || fs.existsSync(path.join(root, 'node_modules/aidn-workflow'))) fail('GLOBAL_MIGRATION_NPM_INCOMPLETE');
    tx.phase = 'npm-complete'; write(file, tx);
  }
  if (tx.phase === 'npm-complete') {
    for (const item of tx.plan.inventory.entries.filter(entry => entry.action === 'remove-empty-directory')) {
      const directory = checkedHostPath(path.join(root, item.path));
      if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
    }
    // Managed skill directories emptied by the asset transaction are removed
    // only when still empty; never recursively remove a parent or extension.
    const parents = new Set(tx.plan.inventory.entries.filter(item => item.action === 'remove').map(item => path.dirname(path.join(root, item.path))));
    for (const parent of parents) {
      checkedHostPath(parent);
      if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
    }
    for (const name of ['.aidn/config.json', '.aidn/project/workflow.adapter.json']) {
      const original = tx.snapshots.find(item => item.path === name);
      if ((read(path.join(root, name))?.toString('base64') ?? null) !== original.bytes) fail('GLOBAL_MIGRATION_CONFIGURATION_CHANGED');
    }
    await inspectGlobalProjectCompatibility({ targetRoot: root, globalMigrationPlanId: tx.plan.plan_id });
    rememberProject(root, home);
    tx.phase = 'complete'; write(file, tx);
  }
  const archive = checkedHostPath(path.join(root, '.aidn/install/global-migrations', `${tx.id}.json`));
  write(archive, tx);
  fs.unlinkSync(file);
  return { status: 'complete', written: true, plan_id: tx.plan.plan_id, target: root,
    version: runtime.version, backup: archive, removed: tx.plan.inventory.entries.filter(item => item.action === 'remove').map(item => item.path) };
}

export async function resumeGlobalMigration(options, dependencies = {}) {
  const root = projectRoot(options.target), file = checkedHostPath(path.join(root, relativeJournal));
  const stored = json(file);
  if (!stored) fail('GLOBAL_MIGRATION_JOURNAL_INVALID');
  const { journal_sha256, ...tx } = stored;
  if (journal_sha256 !== hash(JSON.stringify(tx)) || tx.schema_version !== 1 || tx.plan?.target !== root || !Array.isArray(tx.snapshots)
      || !/^[a-f0-9-]{36}$/.test(tx.id) || !['prepared', 'integration-complete', 'npm-complete', 'complete'].includes(tx.phase)) fail('GLOBAL_MIGRATION_JOURNAL_INVALID');
  const { plan_id, written, ...content } = tx.plan;
  if (hash(JSON.stringify(content)) !== plan_id) fail('GLOBAL_MIGRATION_JOURNAL_INVALID');
  if (!options.write) return { status: 'interrupted', phase: tx.phase, plan_id, written: false };
  if (options.expectedPlanId !== plan_id) fail('GLOBAL_PLAN_MISMATCH');
  const lease = acquireGlobalRuntime({ home: options.home });
  const lock = checkedHostPath(`${file}.lock`);
  let fd;
  try {
    fd = fs.openSync(lock, 'wx');
    fs.writeFileSync(fd, JSON.stringify(hostExecutionIdentity()));
    return await finishMigration(options.home, file, tx, lease, dependencies);
  } finally { if (fd !== undefined) { fs.closeSync(fd); fs.unlinkSync(lock); } lease.release(); }
}
