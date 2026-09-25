import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { executeInstallation } from '../../src/application/install/installation-service.mjs';
import { readActivation } from '../../src/application/install/project-activation-service.mjs';
import { sealRuntimeGeneration } from '../../src/application/install/global-runtime-store.mjs';
import { executeGlobalUpdate, planGlobalUpdate } from '../setup/global-update.mjs';
import { executeGlobalMigration, planGlobalMigration, resumeGlobalMigration } from '../setup/global-migrate.mjs';
import { addGlobalProject, removeGlobalProject } from '../setup/global-project.mjs';
import { parseArgs } from '../setup/global-cli.mjs';
import { globalWizard } from '../setup/global-wizard.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-global-management-'));
const source = path.resolve(import.meta.dirname, '../..');
const home = path.join(root, 'home espace été');
const userHome = path.join(root, 'user');
const hash = value => createHash('sha256').update(value).digest('hex');
function copy(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const input = path.join(from, entry.name), output = path.join(to, entry.name);
    if (entry.isDirectory()) copy(input, output); else fs.copyFileSync(input, output);
  }
}
function prepare({ version, artifact }) {
  const directory = path.join(home, 'generations', randomUUID());
  const packageRoot = path.join(directory, 'node_modules/aidn-workflow');
  fs.mkdirSync(packageRoot, { recursive: true });
  for (const name of ['src', 'tools/setup', 'bin', 'scaffold', 'package', 'packs', 'docs']) copy(path.join(source, name), path.join(packageRoot, name));
  fs.writeFileSync(path.join(packageRoot, 'VERSION'), version);
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'aidn-workflow', version, type: 'module' }));
  return { packageRoot, pointer: sealRuntimeGeneration({ home, directory, packageRoot, provenance: { sha256: artifact.packageSha256 } }) };
}
const snapshot = directory => fs.readdirSync(directory, { recursive: true }).sort()
  .filter(name => fs.statSync(path.join(directory, name)).isFile()).map(name => [name, hash(fs.readFileSync(path.join(directory, name)))]);
try {
  const packagePath = path.join(root, 'fixture.tgz'); fs.writeFileSync(packagePath, 'fixture package');
  const options = { home, userHome, codexHome: path.join(userHome, '.codex'), packagePath,
    packageSha256: hash(fs.readFileSync(packagePath)), release: '0.10.0' };
  const deps = { prepare, preflight: () => ({ compatible: true, projects: [] }) };
  const before = snapshot(root);
  const plan = await planGlobalUpdate(options, deps);
  assert.equal(plan.status, 'installation-proposed'); assert.deepEqual(snapshot(root), before);
  await assert.rejects(executeGlobalUpdate({ ...options, write: true, expectedPlanId: 'incorrect' }, deps), /GLOBAL_PLAN_MISMATCH/);
  assert.deepEqual(snapshot(root), before);
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'bin/aidn-setup.cmd'), '@echo off\r\npowershell.exe -NoProfile -File "%~dp0aidn-setup.ps1" %*\r\nexit /b %errorlevel%\r\n');
  assert.equal((await executeGlobalUpdate({ ...options, write: true, expectedPlanId: plan.plan_id }, deps)).status, 'complete');
  assert.equal((await planGlobalUpdate(options, deps)).status, 'up-to-date');
  assert.equal((await planGlobalUpdate({ ...options, release: '0.9.1' }, deps)).status, 'local-newer');

  const target = path.join(root, 'projet été'); fs.mkdirSync(target);
  assert.equal(spawnSync('git', ['init', target], { windowsHide: true }).status, 0);
  const installed = await executeInstallation({ repoRoot: source, targetRoot: target, dryRun: false,
    args: { pack: 'core', initDefaults: true, projectName: 'neutral', runtimeStateMode: 'files', artifactImportStore: 'file', sourceBranch: 'dev' } });
  assert.equal(installed.ok, true, JSON.stringify(installed.errors));
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'neutral', dependencies: { 'aidn-workflow': '0.9.1', other: '1.2.3' } }));
  fs.writeFileSync(path.join(target, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': { dependencies: { 'aidn-workflow': '0.9.1', other: '1.2.3' } }, 'node_modules/aidn-workflow': { version: '0.9.1' }, 'node_modules/other': { version: '1.2.3' } } }));
  const localBefore = snapshot(target);
  const migration = await planGlobalMigration({ home, target });
  assert.deepEqual(migration.conflicts, []); assert.deepEqual(snapshot(target), localBefore);
  const npmCli = path.join(root, 'npm.mjs'); fs.writeFileSync(npmCli, '');
  await assert.rejects(executeGlobalMigration({ home, target, write: true, expectedPlanId: migration.plan_id },
    { npmCli, run: () => ({ status: 1 }) }), /GLOBAL_MIGRATION_NPM_FAILED/);
  assert.equal(readActivation({ targetRoot: target }).active, false);
  const pending = await resumeGlobalMigration({ home, target }); assert.equal(pending.status, 'interrupted');
  const run = () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'))); delete pkg.dependencies['aidn-workflow'];
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(pkg));
    const lock = JSON.parse(fs.readFileSync(path.join(target, 'package-lock.json')));
    delete lock.packages['node_modules/aidn-workflow']; delete lock.packages[''].dependencies['aidn-workflow'];
    fs.writeFileSync(path.join(target, 'package-lock.json'), JSON.stringify(lock)); return { status: 0 };
  };
  const done = await resumeGlobalMigration({ home, target, write: true, expectedPlanId: pending.plan_id }, { npmCli, run });
  assert.equal(done.status, 'complete'); assert(fs.existsSync(done.backup));
  assert.equal(readActivation({ targetRoot: target }).active, true);
  assert.equal(fs.existsSync(path.join(target, '.agents/skills/aidn-context-reload/SKILL.md')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'package.json'))).dependencies.other, '1.2.3');
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'projects.json'))).projects.length, 1);
  const second = path.join(root, 'second'); fs.mkdirSync(second);
  assert.equal(spawnSync('git', ['init', second], { windowsHide: true }).status, 0);
  const addPlan = await addGlobalProject({ home, target: second });
  assert.equal(addPlan.ok, true, JSON.stringify(addPlan.errors));
  assert.equal(fs.existsSync(path.join(second, '.aidn')), false);
  const added = await addGlobalProject({ home, target: second, write: true, expectedPlanId: addPlan.plan_id });
  assert.equal(added.ok, true, JSON.stringify(added.errors));
  assert.equal(readActivation({ targetRoot: second }).active, true);
  assert.equal(fs.existsSync(path.join(second, '.agents/skills/aidn-context-reload/SKILL.md')), false);
  const registry = JSON.parse(fs.readFileSync(path.join(home, 'projects.json')));
  assert.equal(registry.projects.length, 2);
  const bothBefore = snapshot(target), secondBefore = snapshot(second);
  const forget = removeGlobalProject({ home, id: registry.projects[1].id });
  assert.equal(forget.written, false);
  removeGlobalProject({ home, id: registry.projects[1].id, write: true, expectedPlanId: forget.plan_id });
  assert.deepEqual(snapshot(target), bothBefore); assert.deepEqual(snapshot(second), secondBefore);
  assert.throws(() => parseArgs(['update', '--write']), /GLOBAL_EXPECT_PLAN_REQUIRED/);
  assert.throws(() => parseArgs(['project-list', '--write', '--expect-plan', 'x']), /GLOBAL_READ_ONLY_COMMAND/);
  assert.throws(() => parseArgs(['doctor', '--release', 'latest']), /GLOBAL_ARGUMENT_INVALID/);
  const answers = ['6', target, 'NON', '0']; let writes = 0;
  const beforeCancel = snapshot(root);
  await globalWizard({ home }, { ask: async () => answers.shift(), show: () => {}, run: async input => {
    if (input.write) writes++;
    return { plan_id: 'f'.repeat(64), written: false };
  } });
  assert.equal(writes, 0); assert.deepEqual(snapshot(root), beforeCancel);
  console.log('PASS global management fixtures: immutable preview, exact plan, version detection, interrupted npm removal and explicit migration resume; npm injected, no native or PostgreSQL qualification');
} finally {
  const resolved = fs.realpathSync(root);
  if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) || !path.basename(resolved).startsWith('aidn-global-management-')) throw new Error('UNSAFE_FIXTURE_CLEANUP');
  fs.rmSync(resolved, { recursive: true, force: true });
}
