import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  sealRuntimeGeneration, planGlobalSwitch, applyGlobalSwitch, resolveGlobalRuntime,
  acquireGlobalRuntime, readGlobalState, resumeGlobalSwitch, resolveGlobalRecoveryRuntime,
  assertGlobalHomeVisibility,
} from '../../src/application/install/global-runtime-store.mjs';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-global-store-'));
const home = path.join(temporary, 'utilisateur été', 'AIDN');
const userSkill = path.join(temporary, 'skills', 'aidn-context-reload', 'SKILL.md');
const digest = value => createHash('sha256').update(value).digest('hex');
const projects = ['one', 'two'].map(name => ({ id: name, compatible: true, fingerprint: digest(name) }));
const recheckProjects = () => projects;
function generation(version) {
  const directory = path.join(home, 'generations', randomUUID());
  const packageRoot = path.join(directory, 'node_modules', 'aidn-workflow');
  fs.mkdirSync(path.join(packageRoot, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'VERSION'), version);
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'aidn-workflow', version }));
  fs.writeFileSync(path.join(packageRoot, 'bin', 'aidn.mjs'), `console.log('${version}');\n`);
  return sealRuntimeGeneration({ home, directory, packageRoot, provenance: { sha256: digest(version), source: 'fixture' } });
}
function plan(candidate, content, extra = {}) {
  return planGlobalSwitch({ home, candidate, assets: [{ path: userSkill, content }], projects, ...extra });
}
function apply(value, options = {}) {
  return applyGlobalSwitch({ home, plan: value, expectedPlanId: value.plan_id, recheckProjects, ...options });
}
function snapshot(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true }).filter(name => fs.statSync(path.join(root, name)).isFile())
    .sort().map(name => [name, digest(fs.readFileSync(path.join(root, name)))]);
}
try {
  const empty = snapshot(temporary);
  assert.throws(() => assertGlobalHomeVisibility(home, { platform: 'win32',
    realpath: ancestor => path.join(ancestor, 'redirected-container') }), /GLOBAL_HOME_REDIRECTED/);
  assert.deepEqual(snapshot(temporary), empty, 'redirected future home must refuse without creating directories');
  assert.equal(assertGlobalHomeVisibility(home, { platform: 'win32', realpath: ancestor => ancestor }), home);
  const first = generation('0.10.0');
  const populated = snapshot(temporary);
  assert.throws(() => assertGlobalHomeVisibility(home, { platform: 'win32',
    realpath: ancestor => path.join(ancestor, 'redirected-container') }), /GLOBAL_HOME_REDIRECTED/);
  assert.deepEqual(snapshot(temporary), populated, 'redirected existing home must remain unchanged');
  const beforePreview = snapshot(temporary);
  const initial = plan(first, 'skill revision 1');
  assert.deepEqual(snapshot(temporary), beforePreview, 'preview has no writes');
  assert.throws(() => resolveGlobalRuntime({ home }), /GLOBAL_NOT_INSTALLED/);
  assert.throws(() => apply(initial, { expectedPlanId: 'wrong' }), /GLOBAL_PLAN_MISMATCH/);
  apply(initial);
  assert.equal(resolveGlobalRuntime({ home }).version, '0.10.0');
  assert.equal(fs.readFileSync(userSkill, 'utf8'), 'skill revision 1');
  assert.throws(() => resolveGlobalRuntime({ home, integrationRevision: 2 }), /GLOBAL_INSTRUCTIONS_STALE/);
  assert.throws(() => resolveGlobalRuntime({ home, installationId: randomUUID() }), /GLOBAL_INSTALLATION_MISMATCH/);
  const installed = readGlobalState(home);
  const second = generation('0.11.0');
  const update = plan(second, 'skill revision 2');
  assert.throws(() => apply(update, { recheckProjects: () => projects.slice(1) }), /GLOBAL_PROJECTS_CHANGED/);
  assert.deepEqual(readGlobalState(home), installed);
  assert.throws(() => planGlobalSwitch({ home, candidate: second, projects: [{ compatible: false }] }), /GLOBAL_PROJECT_INCOMPATIBLE/);
  const lease = acquireGlobalRuntime({ home });
  assert.throws(() => apply(update), /GLOBAL_OPERATIONS_ACTIVE/);
  assert.equal(lease.version, '0.10.0');
  lease.release();
  const moduleUrl = new URL('../../src/application/install/global-runtime-store.mjs', import.meta.url).href;
  fs.writeFileSync(path.join(home, 'admission.lock'), '{}');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {acquireGlobalRuntime} from ${JSON.stringify(moduleUrl)}; acquireGlobalRuntime({home:${JSON.stringify(home)}});`], { encoding: 'utf8' });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /GLOBAL_BUSY/);
  fs.unlinkSync(path.join(home, 'admission.lock'));
  apply(update);
  assert.equal(resolveGlobalRuntime({ home }).version, '0.11.0');
  assert.equal(readGlobalState(home).installation_id, installed.installation_id);
  assert.throws(() => plan(first, 'old'), /GLOBAL_DOWNGRADE_REFUSED/);
  assert.throws(() => plan(second, 'same'), /GLOBAL_ALREADY_CURRENT/);
  apply(plan(first, 'skill revision 1', { rollback: true }));
  assert.equal(resolveGlobalRuntime({ home }).version, '0.10.0');
  fs.writeFileSync(userSkill, 'personal customization');
  assert.throws(() => resolveGlobalRuntime({ home }), /GLOBAL_ASSET_CHANGED/);
  assert.throws(() => plan(second, 'new'), /GLOBAL_ASSET_CHANGED/);
  assert.equal(fs.readFileSync(userSkill, 'utf8'), 'personal customization');
  fs.writeFileSync(userSkill, 'skill revision 1');
  const runtime = resolveGlobalRuntime({ home });
  fs.appendFileSync(runtime.entry, '// tampered');
  assert.throws(() => resolveGlobalRuntime({ home }), /GLOBAL_PACKAGE_CHANGED/);
  fs.writeFileSync(runtime.entry, "console.log('0.10.0');\n");
  fs.writeFileSync(path.join(runtime.packageRoot, 'extra.mjs'), 'unexpected');
  assert.throws(() => resolveGlobalRuntime({ home }), /GLOBAL_PACKAGE_CHANGED/);
  fs.unlinkSync(path.join(runtime.packageRoot, 'extra.mjs'));

  // Reproduce a crash after a durable pending journal and a partial asset write.
  const interrupted = plan(second, 'skill revision 2');
  const tx = { ...interrupted, id: randomUUID(), status: 'pending', installation_id: installed.installation_id };
  fs.writeFileSync(path.join(home, 'pending.json'), JSON.stringify(tx));
  fs.writeFileSync(userSkill, 'skill revision 2');
  assert.throws(() => acquireGlobalRuntime({ home }), /GLOBAL_TRANSACTION_PENDING/);
  assert.equal(resolveGlobalRecoveryRuntime({ home, expectedPlanId: tx.plan_id }).version, '0.11.0');
  assert.throws(() => resolveGlobalRecoveryRuntime({ home, expectedPlanId: 'wrong' }), /GLOBAL_PLAN_MISMATCH/);
  fs.writeFileSync(userSkill, 'concurrent customization');
  assert.throws(() => resumeGlobalSwitch({ home, expectedPlanId: tx.plan_id, recheckProjects }), /GLOBAL_RECOVERY_ASSET_CONFLICT/);
  assert.equal(fs.readFileSync(userSkill, 'utf8'), 'concurrent customization');
  fs.writeFileSync(userSkill, 'skill revision 2');
  resumeGlobalSwitch({ home, expectedPlanId: tx.plan_id, recheckProjects });
  assert.equal(resolveGlobalRuntime({ home }).version, '0.11.0');
  assert.equal(fs.existsSync(path.join(home, 'pending.json')), false);
  const beforeRead = snapshot(temporary);
  resolveGlobalRuntime({ home });
  assert.deepEqual(snapshot(temporary), beforeRead, 'runtime resolution is read-only');
  console.log('PASS global runtime store: preview, two-project preconditions, integrity, leases, concurrency, rollback and interrupted recovery (fixtures only)');
} finally {
  const resolved = fs.realpathSync(temporary);
  if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) || !path.basename(resolved).startsWith('aidn-global-store-')) throw new Error('UNSAFE_FIXTURE_CLEANUP');
  fs.rmSync(resolved, { recursive: true, force: true });
}
