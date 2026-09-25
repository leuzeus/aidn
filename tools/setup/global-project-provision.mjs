import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { checkedHostPath, hostExecutionIdentity } from '../../src/application/install/global-runtime-store.mjs';
import { writeFileAtomicSync } from '../../src/lib/fs/atomic-write-lib.mjs';
import { planInstallation, executeInstallation } from '../../src/application/install/installation-service.mjs';
import { readInstallationContext } from '../../src/application/install/codex-assets-service.mjs';
import { inspectGlobalProjectCompatibility } from '../../src/application/install/global-project-compatibility.mjs';
import { preparePostgres, validateConnections } from './windows-postgres.mjs';
import { isReusableWingetExit } from './windows-project-setup.mjs';
import { rememberProject } from './project-registry.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = code => { throw new Error(code); };
export const provisioningFile = (home, target) => checkedHostPath(path.join(home, 'preparations', `${hash(process.platform === 'win32' ? target.toLowerCase() : target)}.json`));
const read = file => fs.existsSync(checkedHostPath(file)) ? JSON.parse(fs.readFileSync(file)) : null;
function save(file, value) { writeFileAtomicSync(checkedHostPath(file), JSON.stringify({ ...value, sha256: hash(value) }) + '\n', { mode: 0o600 }); }
function validateJournal(record, root, runtime) {
  const { sha256, ...value } = record;
  if (hash(value) !== sha256 || value.target !== root || value.generation !== runtime.state.active.id
      || !['prepared', 'server-ready', 'database-ready', 'bootstrap-started', 'complete'].includes(value.phase)) fail('GLOBAL_PROVISION_JOURNAL_INVALID');
  if (hash({ schema_version: value.schema_version, target: value.target, generation: value.generation, options: value.options, core_plan_id: value.core_plan_id }) !== value.plan_id) fail('GLOBAL_PROVISION_JOURNAL_INVALID');
  return value;
}

// New local-server provisioning is explicit and separate from ordinary global
// update/migration. Its only schema initialization is for an empty database.
export async function provisionGlobalProject(options, runtime, dependencies = {}) {
  const { home, target: root } = options;
  const file = provisioningFile(home, root);
  const recorded = read(file);
  if (recorded && !options.resume) fail('GLOBAL_PROVISION_REQUIRES_RESUME');
  if (!recorded && options.resume) fail('GLOBAL_PROVISION_RESUME_MISSING');
  const saved = recorded ? validateJournal(recorded, root, runtime) : null;
  const selected = saved?.options ?? { pack: options.pack ?? 'core', connectionRef: options.connectionRef,
    adminConnectionRef: options.adminConnectionRef, postgresVersion: options.postgresVersion };
  for (const key of Object.keys(selected)) if (saved && options[key] !== undefined && options[key] !== selected[key]) fail('GLOBAL_PROVISION_OPTIONS_FROZEN');
  const { connectionRef, adminConnectionRef, postgresVersion } = selected;
  if (!/^env:AIDN_(?:PG|POSTGRES)_[A-Z0-9_]+$/.test(connectionRef ?? '')
      || !/^env:AIDN_(?:PG|POSTGRES)_[A-Z0-9_]+$/.test(adminConnectionRef ?? '') || connectionRef === adminConnectionRef) fail('GLOBAL_PROVISION_REFERENCES_INVALID');
  if (!/^17\.\d+-\d+$/.test(postgresVersion ?? '')) fail('EXPLICIT_POSTGRES_17_VERSION_REQUIRED');
  if (!saved && fs.existsSync(checkedHostPath(path.join(root, '.aidn')))) fail('GLOBAL_PROVISION_REQUIRES_NEW_PROJECT');
  const input = { repoRoot: runtime.packageRoot, targetRoot: root, globalHome: home,
    args: { pack: selected.pack, initDefaults: true, projectName: path.basename(root), runtimeStateMode: 'db-only',
      artifactImportStore: 'sqlite', runtimePersistenceBackend: 'postgres', runtimePersistenceConnectionRef: connectionRef,
      runtimePersistenceLocalProjectionPolicy: 'none', persistencePolicy: 'adopt' } };
  const pending = read(path.join(root, '.aidn/install/pending.json'));
  if (saved && pending) {
    if (!/^[a-f0-9]{32}$/.test(pending.id ?? '') || read(path.join(root, '.aidn/install/transactions', `${pending.id}.json`))?.plan_id !== saved.core_plan_id) fail('GLOBAL_PROVISION_TRANSACTION_MISMATCH');
  }
  const receipt = readInstallationContext({ targetRoot: root }).receipt;
  const last = receipt?.last_transaction && /^[a-f0-9]{32}$/.test(receipt.last_transaction)
    ? read(path.join(root, '.aidn/install/transactions', `${receipt.last_transaction}.json`)) : null;
  const completed = saved && last?.status === 'complete' && last.plan_id === saved.core_plan_id;
  const core = completed ? { ok: true, plan_id: saved.core_plan_id, operations: [] }
    : await (dependencies.plan ?? planInstallation)({ ...input, ...(pending ? { action: 'resume' } : {}) });
  if (core.ok === false) return core;
  if (saved && !pending && !completed && core.plan_id !== saved.core_plan_id) fail('GLOBAL_PROVISION_PROJECT_CHANGED');
  const frozen = saved ?? { schema_version: 1, target: root, generation: runtime.state.active.id, options: selected, core_plan_id: core.plan_id };
  const id = saved?.plan_id ?? hash(frozen);
  const result = { ok: true, plan_id: id, status: saved ? 'interrupted' : 'provisioning-proposed', written: false,
    operations: core.operations, external_effects: [
      { id: 'postgres-install', package: 'PostgreSQL.PostgreSQL.17', version: postgresVersion, interactive: true },
      { id: 'database-provision', connection_ref: connectionRef, admin_connection_ref: adminConnectionRef },
      { id: 'empty-database-initialization', policy: 'new-empty-database-only' },
    ] };
  if (!options.write) return result;
  if (options.expectedPlanId !== id) fail('GLOBAL_PLAN_MISMATCH');
  if ((dependencies.platform ?? process.platform) !== 'win32') fail('WINDOWS_REQUIRED');
  const runtimeName = connectionRef.slice(4), adminName = adminConnectionRef.slice(4);
  const db = { connectionString: process.env[runtimeName], adminConnectionString: process.env[adminName], create: true,
    expectedServerVersion: 170000 + Number(postgresVersion.split('.')[1].split('-')[0]) };
  const parsed = validateConnections(db);
  const endpoint = { host: parsed.url.hostname, port: parsed.url.port || '5432', role: parsed.role, database: parsed.database };
  if (saved?.endpoint && JSON.stringify(saved.endpoint) !== JSON.stringify(endpoint)) fail('GLOBAL_PROVISION_ENDPOINT_CHANGED');
  const factory = dependencies.clientFactory ?? (value => {
    const { Client } = createRequire(path.join(runtime.packageRoot, 'package.json'))('pg');
    return new Client({ connectionString: value, connectionTimeoutMillis: 10000, query_timeout: 30000 });
  });
  fs.mkdirSync(checkedHostPath(path.dirname(file)), { recursive: true });
  let fd;
  try { fd = fs.openSync(checkedHostPath(`${file}.lock`), 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('GLOBAL_PROVISION_BUSY'); throw error; }
  const adminSecret = process.env[adminName]; delete process.env[adminName];
  try {
    fs.writeFileSync(fd, JSON.stringify(hostExecutionIdentity()));
    if (JSON.stringify(read(file)) !== JSON.stringify(recorded)) fail('GLOBAL_PROVISION_CHANGED');
    let tx = saved ?? { ...frozen, plan_id: id, endpoint, phase: 'prepared' };
    if (!saved) save(file, tx);
    if (tx.phase === 'prepared') {
      const childEnv = { ...process.env }; delete childEnv[runtimeName]; delete childEnv[adminName];
      const installed = (dependencies.run ?? spawnSync)('winget.exe', ['install', '--id', 'PostgreSQL.PostgreSQL.17', '--exact', '--source', 'winget',
        '--version', postgresVersion, '--interactive', '--no-upgrade'],
      { cwd: root, env: childEnv, shell: false, windowsHide: false, encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'], timeout: 1800000 });
      if (installed.error || installed.status !== 0 && !isReusableWingetExit(installed.status)) fail('GLOBAL_POSTGRES_INSTALL_FAILED');
      tx = { ...tx, phase: 'server-ready' }; save(file, tx);
    }
    if (tx.phase === 'server-ready' || tx.phase === 'database-ready' || tx.phase === 'bootstrap-started' && !pending && !completed) {
      await (dependencies.database ?? preparePostgres)(db, { clientFactory: factory });
      const client = factory(db.connectionString);
      try {
        await client.connect();
        const existing = await client.query("SELECT nspname AS object FROM pg_namespace WHERE nspname NOT IN ('public', 'information_schema') AND nspname NOT LIKE 'pg_%' UNION ALL SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace UNION ALL SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace UNION ALL SELECT typname FROM pg_type WHERE typnamespace = 'public'::regnamespace");
        if (existing.rows.length) fail('GLOBAL_POSTGRES_DATABASE_NOT_EMPTY');
      } finally { await client.end(); }
      tx = { ...tx, phase: 'database-ready' }; save(file, tx);
    }
    if (!completed) {
      tx = { ...tx, phase: 'bootstrap-started' }; save(file, tx);
      const installed = await (dependencies.install ?? executeInstallation)({ ...input, ...(pending ? { action: 'resume' } : {}),
        dryRun: false, expectedPlanId: core.plan_id });
      if (!installed.ok || installed.pending) fail('GLOBAL_PROVISION_BOOTSTRAP_INTERRUPTED');
    }
    await (dependencies.verify ?? inspectGlobalProjectCompatibility)({ targetRoot: root });
    (dependencies.remember ?? rememberProject)(root, home);
    tx = { ...tx, phase: 'complete' };
    const archive = checkedHostPath(path.join(home, 'preparation-history', `${id}.json`));
    fs.mkdirSync(path.dirname(archive), { recursive: true }); save(archive, tx); fs.unlinkSync(file);
    return { ...result, status: 'complete', written: true };
  } catch (error) {
    throw new Error(/^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'GLOBAL_POSTGRES_PROVISION_FAILED');
  } finally {
    if (adminSecret !== undefined) process.env[adminName] = adminSecret;
    fs.closeSync(fd); fs.unlinkSync(checkedHostPath(`${file}.lock`));
  }
}
