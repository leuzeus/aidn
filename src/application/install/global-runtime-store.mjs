// Host-local runtime generations. This store never writes into a client project.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileAtomicSync } from '../../lib/fs/atomic-write-lib.mjs';

export const GLOBAL_INTEGRATION_REVISION = 1;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const idPattern = /^[a-f0-9-]{36}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
let bootId, bootChecked = false;
export function hostExecutionIdentity() {
  if (!bootChecked) {
    bootChecked = true;
    if (process.platform === 'win32') {
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        '(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().Ticks'],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 });
      const value = result.stdout?.trim();
      if (result.status === 0 && /^\d{15,20}$/.test(value ?? '')) bootId = `windows:${value}`;
    } else if (process.platform === 'linux') bootId = `linux:${fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}`;
  }
  // Restricted hosts may deny the read-only OS query. Normal locked operations
  // remain usable, but their orphan recovery cannot assert a reboot witness.
  return { pid: process.pid, boot_id: bootId ?? null };
}

export function globalHome(env = process.env) {
  const home = env.AIDN_HOME || (env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'AIDN'));
  if (!home || !path.isAbsolute(home)) fail('GLOBAL_HOME_REQUIRED');
  return assertGlobalHomeVisibility(home);
}

// Packaged Windows applications can redirect AppData without a junction. A
// logical path then addresses different runtimes/locks in ordinary terminals.
// Refuse that split before writing; never silently relocate an installation.
export function assertGlobalHomeVisibility(home, { platform = process.platform, realpath = fs.realpathSync.native } = {}) {
  const absolute = checkedHostPath(home);
  if (platform !== 'win32') return absolute;
  let ancestor = absolute;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) fail('GLOBAL_HOME_UNRESOLVED');
    ancestor = parent;
  }
  const normalize = value => path.resolve(value).toLowerCase();
  if (normalize(realpath(ancestor)) !== normalize(ancestor)) fail('GLOBAL_HOME_REDIRECTED');
  return absolute;
}

// Reject junctions, symlinks, devices and hard-linked files, including ancestors.
// All write paths are checked again at use time, not just when planning.
export function checkedHostPath(value) {
  if (!path.isAbsolute(value)) fail('GLOBAL_ABSOLUTE_PATH_REQUIRED');
  const absolute = path.resolve(value);
  let cursor = absolute;
  while (true) {
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))) fail('GLOBAL_UNSAFE_PATH');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return absolute;
}

function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes(':')
      || relative.split('/').some(part => !part || part === '.' || part === '..') || path.isAbsolute(relative)) fail('GLOBAL_INVALID_RELATIVE_PATH');
  return checkedHostPath(path.join(root, ...relative.split('/')));
}
function bytes(file) {
  checkedHostPath(file);
  try { return fs.readFileSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function read(file) {
  const content = bytes(file);
  if (content === null) return null;
  try { return JSON.parse(content); } catch { fail('GLOBAL_INVALID_JSON'); }
}
function put(file, value) {
  checkedHostPath(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  checkedHostPath(file);
  writeFileAtomicSync(file, json(value));
}
const at = (home, name) => inside(assertGlobalHomeVisibility(home), name);

export function inventoryRuntime(root) {
  checkedHostPath(root);
  const files = {};
  function walk(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix + entry.name;
      const file = inside(root, relative);
      if (entry.isDirectory()) walk(file, relative + '/');
      else {
        if (!entry.isFile()) fail('GLOBAL_UNSAFE_PACKAGE_ENTRY');
        files[relative] = digest(fs.readFileSync(file));
      }
    }
  }
  walk(root);
  return files;
}

export function sealRuntimeGeneration({ home, directory, packageRoot, provenance }) {
  const relative = path.relative(home, directory).replaceAll('\\', '/');
  if (!/^generations\/[a-f0-9-]{36}$/.test(relative)) fail('GLOBAL_INVALID_GENERATION');
  const expectedRoot = path.join(directory, 'node_modules', 'aidn-workflow');
  if (path.resolve(packageRoot) !== expectedRoot) fail('GLOBAL_INVALID_PACKAGE_ROOT');
  const version = fs.readFileSync(checkedHostPath(path.join(packageRoot, 'VERSION')), 'utf8').trim();
  const identity = read(path.join(packageRoot, 'package.json'));
  if (!stableVersion.test(version) || identity?.name !== 'aidn-workflow' || identity.version !== version) fail('GLOBAL_PACKAGE_IDENTITY_MISMATCH');
  if (!hashPattern.test(provenance?.sha256 ?? '')) fail('GLOBAL_PROVENANCE_REQUIRED');
  const files = inventoryRuntime(path.join(directory, 'node_modules'));
  if (!files['aidn-workflow/bin/aidn.mjs']) fail('GLOBAL_ENTRY_MISSING');
  const manifest = { schema_version: 1, id: path.basename(directory), version,
    integration_revision: GLOBAL_INTEGRATION_REVISION, provenance, files };
  put(path.join(directory, 'manifest.json'), manifest);
  return { id: manifest.id, version, manifest_sha256: digest(Buffer.from(json(manifest))) };
}

export function verifyRuntimeGeneration(home, pointer) {
  if (!idPattern.test(pointer?.id ?? '') || !stableVersion.test(pointer?.version ?? '')
      || !hashPattern.test(pointer?.manifest_sha256 ?? '')) fail('GLOBAL_INVALID_POINTER');
  const directory = at(home, `generations/${pointer.id}`);
  const raw = bytes(path.join(directory, 'manifest.json'));
  if (!raw || digest(raw) !== pointer.manifest_sha256) fail('GLOBAL_MANIFEST_CHANGED');
  const manifest = JSON.parse(raw);
  if (manifest.schema_version !== 1 || manifest.id !== pointer.id || manifest.version !== pointer.version
      || manifest.integration_revision !== GLOBAL_INTEGRATION_REVISION || !manifest.files
      || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) fail('GLOBAL_MANIFEST_INVALID');
  const actual = inventoryRuntime(path.join(directory, 'node_modules'));
  if (Object.keys(actual).length !== Object.keys(manifest.files).length
      || Object.entries(manifest.files).some(([name, hash]) => !hashPattern.test(hash) || actual[name] !== hash)) fail('GLOBAL_PACKAGE_CHANGED');
  return { directory, packageRoot: path.join(directory, 'node_modules', 'aidn-workflow'), manifest };
}

export function readGlobalState(home) {
  const state = read(at(home, 'runtime.json'));
  if (state === null) return null;
  if (state.schema_version !== 1 || !idPattern.test(state.installation_id ?? '') || !state.active
      || !Array.isArray(state.assets)) fail('GLOBAL_STATE_INVALID');
  return state;
}

function assetBytes(asset) {
  if (typeof asset.path !== 'string' || !path.isAbsolute(asset.path)) fail('GLOBAL_ASSET_INVALID');
  return bytes(asset.path);
}
export function verifyGlobalAssets(state) {
  for (const asset of state.assets) {
    if (!hashPattern.test(asset.sha256 ?? '')) fail('GLOBAL_ASSET_INVALID');
    const content = assetBytes(asset);
    if (!content || digest(content) !== asset.sha256) fail('GLOBAL_ASSET_CHANGED');
  }
}

function locked(home, name, callback) {
  const file = at(home, name);
  fs.mkdirSync(home, { recursive: true });
  let fd;
  try { fd = fs.openSync(file, 'wx'); } catch (error) { if (error.code === 'EEXIST') fail('GLOBAL_BUSY'); throw error; }
  try {
    fs.writeFileSync(fd, json(hostExecutionIdentity()));
    return callback();
  } finally { fs.closeSync(fd); fs.unlinkSync(file); }
}

export function resolveGlobalRuntime({ home = globalHome(), installationId, integrationRevision } = {}) {
  if (bytes(at(home, 'pending.json'))) fail('GLOBAL_TRANSACTION_PENDING');
  const state = readGlobalState(home);
  if (!state) fail('GLOBAL_NOT_INSTALLED');
  if (installationId && state.installation_id !== installationId) fail('GLOBAL_INSTALLATION_MISMATCH');
  if (integrationRevision !== undefined && integrationRevision !== GLOBAL_INTEGRATION_REVISION) fail('GLOBAL_INSTRUCTIONS_STALE');
  const generation = verifyRuntimeGeneration(home, state.active);
  verifyGlobalAssets(state);
  return { ...generation, state, home, version: state.active.version, entry: path.join(generation.packageRoot, 'bin', 'aidn.mjs') };
}

function pendingTransaction(home, expectedPlanId) {
  const transaction = read(at(home, 'pending.json'));
  if (!transaction || transaction.plan_id !== expectedPlanId || !idPattern.test(transaction.id)) fail('GLOBAL_PLAN_MISMATCH');
  const { id, status, installation_id, plan_id, ...content } = transaction;
  if (status !== 'pending' || !idPattern.test(installation_id) || digest(Buffer.from(JSON.stringify(content))) !== plan_id) fail('GLOBAL_JOURNAL_INVALID');
  return transaction;
}

export function resolveGlobalRecoveryRuntime({ home = globalHome(), expectedPlanId } = {}) {
  const transaction = pendingTransaction(home, expectedPlanId ?? read(at(home, 'pending.json'))?.plan_id);
  const generation = verifyRuntimeGeneration(home, transaction.candidate);
  return { ...generation, home, version: transaction.candidate.version,
    state: { active: transaction.candidate, installation_id: transaction.installation_id },
    entry: path.join(generation.packageRoot, 'bin', 'aidn.mjs') };
}

// Lease creation and the transition to pending share one mutex. An updater cannot
// miss a new admitted process between checking leases and starting a transaction.
export function acquireGlobalRuntime(options = {}) {
  const home = options.home ?? globalHome();
  return locked(home, 'admission.lock', () => {
    const resolved = resolveGlobalRuntime({ ...options, home });
    const token = randomUUID();
    const file = at(home, `leases/${token}.json`);
    put(file, { schema_version: 1, token, ...hostExecutionIdentity(), generation: resolved.state.active.id });
    let released = false;
    return { ...resolved, release() { if (!released) { checkedHostPath(file); fs.unlinkSync(file); released = true; } } };
  });
}

function assertNoLeases(home, waitMs = 0) {
  const directory = at(home, 'leases');
  if (!fs.existsSync(directory)) return;
  // The caller holds the admission barrier. Existing invocations may finish;
  // new invocations cannot acquire a lease while the updater drains this set.
  const deadline = Date.now() + Math.min(Math.max(waitMs, 0), 30000);
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (fs.readdirSync(directory).length && Date.now() < deadline) Atomics.wait(sleeper, 0, 0, 100);
  // No PID-based deletion: an interrupted lease requires explicit diagnosis.
  if (fs.readdirSync(directory).length) fail('GLOBAL_OPERATIONS_ACTIVE');
}

export function planGlobalSwitch({ home, candidate, assets = [], projects = [], rollback = false }) {
  if (bytes(at(home, 'pending.json'))) fail('GLOBAL_TRANSACTION_PENDING');
  const state = readGlobalState(home);
  if (state) { verifyRuntimeGeneration(home, state.active); verifyGlobalAssets(state); }
  verifyRuntimeGeneration(home, candidate);
  if (!Array.isArray(projects) || projects.some(project => project.compatible !== true || !hashPattern.test(project.fingerprint ?? ''))) fail('GLOBAL_PROJECT_INCOMPATIBLE');
  if (state && !rollback) {
    const a = state.active.version.split('.').map(BigInt), b = candidate.version.split('.').map(BigInt);
    const first = a.findIndex((n, index) => n !== b[index]);
    if (first === -1) fail('GLOBAL_ALREADY_CURRENT');
    if (a[first] > b[first]) fail('GLOBAL_DOWNGRADE_REFUSED');
  }
  if (rollback && (!state?.previous || JSON.stringify(candidate) !== JSON.stringify(state.previous))) fail('GLOBAL_ROLLBACK_TARGET_INVALID');
  const operations = [];
  const paths = new Set();
  for (const item of assets) {
    const target = checkedHostPath(item.path);
    const key = process.platform === 'win32' ? target.toLowerCase() : target;
    if (paths.has(key) || typeof item.content !== 'string') fail('GLOBAL_ASSET_INVALID');
    paths.add(key);
    const before = bytes(target);
    const previous = state?.assets.find(asset => asset.path === target);
    // Exact historical 0.9.x setup template, not ownership inferred by basename.
    const legacySetup = !state && target === path.join(home, 'bin', 'aidn-setup.cmd')
      && before?.equals(Buffer.from('@echo off\r\npowershell.exe -NoProfile -File "%~dp0aidn-setup.ps1" %*\r\nexit /b %errorlevel%\r\n'));
    if (before && !previous && !legacySetup && !before.equals(Buffer.from(item.content))) fail('GLOBAL_UNOWNED_ASSET');
    if (previous && (!before || digest(before) !== previous.sha256)) fail('GLOBAL_ASSET_CHANGED');
    operations.push({ path: target, before: before?.toString('base64') ?? null, after: Buffer.from(item.content).toString('base64') });
  }
  for (const previous of state?.assets ?? []) if (!operations.some(item => item.path === previous.path)) {
    operations.push({ path: previous.path, before: bytes(previous.path).toString('base64'), after: null });
  }
  const content = { schema_version: 1, action: rollback ? 'rollback' : 'switch',
    before: state, candidate, projects, operations };
  return { ...content, plan_id: digest(Buffer.from(JSON.stringify(content))) };
}

function writeAsset(operation, side) {
  const file = checkedHostPath(operation.path), image = operation[side];
  if (image === null) { if (fs.existsSync(file)) fs.unlinkSync(file); }
  else { fs.mkdirSync(path.dirname(file), { recursive: true }); checkedHostPath(file); writeFileAtomicSync(file, Buffer.from(image, 'base64')); }
}

export function applyGlobalSwitch({ home, plan, expectedPlanId, recheckProjects, waitForOperationsMs = 0 }) {
  if (typeof recheckProjects !== 'function') fail('GLOBAL_PROJECT_RECHECK_REQUIRED');
  return locked(home, 'update.lock', () => locked(home, 'admission.lock', () => {
    if (bytes(at(home, 'pending.json'))) fail('GLOBAL_TRANSACTION_PENDING');
    if (!expectedPlanId || expectedPlanId !== plan.plan_id) fail('GLOBAL_PLAN_MISMATCH');
    const { plan_id, ...content } = plan;
    if (digest(Buffer.from(JSON.stringify(content))) !== plan_id) fail('GLOBAL_PLAN_MISMATCH');
    if (JSON.stringify(readGlobalState(home)) !== JSON.stringify(plan.before)) fail('GLOBAL_STATE_CHANGED');
    const verified = recheckProjects();
    if (JSON.stringify(verified) !== JSON.stringify(plan.projects)) fail('GLOBAL_PROJECTS_CHANGED');
    verifyRuntimeGeneration(home, plan.candidate);
    if (plan.before) verifyGlobalAssets(plan.before);
    for (const operation of plan.operations) if ((bytes(operation.path)?.toString('base64') ?? null) !== operation.before) fail('GLOBAL_ASSET_CHANGED');
    assertNoLeases(home, waitForOperationsMs);
    if (JSON.stringify(recheckProjects()) !== JSON.stringify(plan.projects)) fail('GLOBAL_PROJECTS_CHANGED');
    const transaction = { ...plan, id: randomUUID(), status: 'pending', installation_id: plan.before?.installation_id ?? randomUUID() };
    put(at(home, 'pending.json'), transaction);
    return finishGlobalSwitch(home, transaction);
  }));
}

function finishGlobalSwitch(home, transaction) {
  verifyRuntimeGeneration(home, transaction.candidate);
  // Idempotent recovery accepts only the two journaled images, never a third.
  for (const operation of transaction.operations) {
    const current = bytes(operation.path)?.toString('base64') ?? null;
    if (current !== operation.before && current !== operation.after) fail('GLOBAL_RECOVERY_ASSET_CONFLICT');
  }
  const state = { schema_version: 1, installation_id: transaction.installation_id,
    active: transaction.candidate, previous: transaction.before?.active ?? null,
    integration_revision: GLOBAL_INTEGRATION_REVISION,
    assets: transaction.operations.filter(item => item.after !== null).map(item => ({ path: item.path, sha256: digest(Buffer.from(item.after, 'base64')) })) };
  const currentState = readGlobalState(home);
  if (JSON.stringify(currentState) !== JSON.stringify(transaction.before)
      && JSON.stringify(currentState) !== JSON.stringify(state)) fail('GLOBAL_RECOVERY_STATE_CONFLICT');
  for (const operation of transaction.operations) writeAsset(operation, 'after');
  put(at(home, 'runtime.json'), state);
  put(at(home, `transactions/${transaction.id}.json`), { ...transaction, status: 'complete' });
  fs.unlinkSync(at(home, 'pending.json'));
  return state;
}

export function resumeGlobalSwitch({ home, expectedPlanId, recheckProjects }) {
  if (typeof recheckProjects !== 'function') fail('GLOBAL_PROJECT_RECHECK_REQUIRED');
  return locked(home, 'update.lock', () => locked(home, 'admission.lock', () => {
    const transaction = pendingTransaction(home, expectedPlanId);
    if (JSON.stringify(recheckProjects()) !== JSON.stringify(transaction.projects)) fail('GLOBAL_PROJECTS_CHANGED');
    assertNoLeases(home);
    return finishGlobalSwitch(home, transaction);
  }));
}
