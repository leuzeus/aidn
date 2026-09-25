import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { executeInstallation } from '../../src/application/install/installation-service.mjs';
import { readActivation } from '../../src/application/install/project-activation-service.mjs';
import { sealRuntimeGeneration, resolveGlobalRuntime } from '../../src/application/install/global-runtime-store.mjs';
import { executeGlobalUpdate, planGlobalUpdate } from '../setup/global-update.mjs';
import { executeGlobalMigration, planGlobalMigration, resumeGlobalMigration } from '../setup/global-migrate.mjs';
import { addGlobalProject, removeGlobalProject } from '../setup/global-project.mjs';
import { parseArgs, publicGlobalResult } from '../setup/global-cli.mjs';
import { validateJsonSchema } from '../../src/core/contracts/json-schema-validator.mjs';
import { globalWizard } from '../setup/global-wizard.mjs';
import { provisionGlobalProject, provisioningFile } from '../setup/global-project-provision.mjs';
import { preflightGlobalProjects } from '../setup/global-project-preflight.mjs';

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
  const installAnswers = ['5', 'latest', 'OUI', '0'];
  const calls = [];
  const wizard = await globalWizard({ home }, { ask: async () => installAnswers.shift(), show: () => {},
    run: async input => { calls.push(input); return { status: input.write ? 'complete' : 'installation-proposed', version: '0.10.0', plan_id: 'confirmed', written: !!input.write }; },
    registerEnvironment: selected => { assert.equal(selected, home); calls.push('registered'); } });
  assert.equal(wizard.written, true);
  assert.equal(calls[1].expectedPlanId, 'confirmed');
  assert.equal(calls[1].release, '0.10.0', 'wizard pins the confirmed latest version');
  assert.equal(calls[2], 'registered', 'user environment is registered only after successful initial apply');
  const invalidAnswers = ['1', second, '2', 'env:PATH', '0'];
  let invalidCalls = 0;
  await globalWizard({ home }, { ask: async () => invalidAnswers.shift(), show: () => {},
    run: () => { invalidCalls++; throw new Error('invalid secret reference must not reach the planner'); } });
  assert.equal(invalidCalls, 0);
  for (const persistence of ['1', '2', '3']) {
    const wizardAnswers = ['1', second, persistence,
      ...(persistence === '1' ? [] : ['env:AIDN_PG_WIZARD_FIXTURE']),
      ...(persistence === '3' ? ['17.5-3', 'env:AIDN_PG_WIZARD_ADMIN_FIXTURE'] : []), 'NON', '0'];
    let planned = 0, secretCalls = 0;
    await globalWizard({ home }, { ask: async () => wizardAnswers.shift(), show: () => {},
      secret: async () => { secretCalls++; return 'must-not-be-requested'; },
      run: async input => { assert.equal(input.write, undefined); planned++; return { plan_id: 'cancelled' }; } });
    assert.equal(planned, 1); assert.equal(secretCalls, 0, 'every persistence choice confirms before requesting secrets');
  }
  const pgRoot = path.join(root, 'new local postgres'); fs.mkdirSync(pgRoot);
  assert.equal(spawnSync('git', ['init', pgRoot], { windowsHide: true }).status, 0);
  const pgOptions = { home, target: pgRoot, postgresMode: 'install', postgresVersion: '17.5-3',
    connectionRef: 'env:AIDN_PG_FIXTURE_PROJECT', adminConnectionRef: 'env:AIDN_PG_FIXTURE_ADMIN' };
  const pgRuntime = resolveGlobalRuntime({ home });
  let serverFails = true, nonempty = false, installFails = false;
  const events = [];
  const pgDependencies = { platform: 'win32', run: (_command, _args, opts) => {
    events.push('winget'); assert.equal(opts.env.AIDN_PG_FIXTURE_PROJECT, undefined); assert.equal(opts.env.AIDN_PG_FIXTURE_ADMIN, undefined);
    return { status: serverFails ? 1 : 0 };
  }, database: async () => events.push('database'), clientFactory: () => ({ connect: async () => {}, end: async () => {},
    query: async () => ({ rows: nonempty ? [{ object: 'unowned-data' }] : [] }) }),
  install: async input => { events.push('bootstrap'); assert.equal(process.env.AIDN_PG_FIXTURE_ADMIN, undefined);
    assert.equal(input.args.persistencePolicy, 'adopt'); return { ok: !installFails }; },
  verify: async () => events.push('verify'), remember: () => events.push('remember') };
  const pgBefore = snapshot(root), pgPlan = await provisionGlobalProject(pgOptions, pgRuntime, pgDependencies);
  const publicPlan = JSON.parse(JSON.stringify(publicGlobalResult(pgPlan)));
  const resultSchema = JSON.parse(fs.readFileSync(path.join(source, 'src/core/contracts/cli-output/global-management.v1.schema.json')));
  const payload = { contract_version: 'global-management.v1', command: 'aidn project add', effect_class: 'preview', ok: true, written: false, errors: [], result: publicPlan };
  assert.deepEqual(validateJsonSchema(payload, resultSchema), []);
  assert(validateJsonSchema({ ...payload, result: { ...publicPlan, secret: 'must-not-be-public' } }, resultSchema).length > 0);
  assert.equal(pgPlan.status, 'provisioning-proposed'); assert.deepEqual(snapshot(root), pgBefore); assert.deepEqual(events, []);
  await assert.rejects(provisionGlobalProject({ ...pgOptions, write: true, expectedPlanId: 'wrong' }, pgRuntime, pgDependencies), /GLOBAL_PLAN_MISMATCH/);
  const previousSecrets = [process.env.AIDN_PG_FIXTURE_PROJECT, process.env.AIDN_PG_FIXTURE_ADMIN];
  process.env.AIDN_PG_FIXTURE_PROJECT = 'postgres://fixture:fixture_password_long@127.0.0.1/fixture';
  process.env.AIDN_PG_FIXTURE_ADMIN = 'postgres://postgres:fixture_admin_password@127.0.0.1/postgres';
  try {
    const apply = { ...pgOptions, write: true, expectedPlanId: pgPlan.plan_id };
    await assert.rejects(provisionGlobalProject(apply, pgRuntime, pgDependencies), /GLOBAL_POSTGRES_INSTALL_FAILED/);
    assert.equal(fs.existsSync(path.join(pgRoot, '.aidn')), false);
    assert.throws(() => preflightGlobalProjects({ home, candidateRoot: pgRuntime.packageRoot }), /GLOBAL_PROJECT_PROVISIONING_PENDING/);
    assert(!fs.readFileSync(provisioningFile(home, pgRoot), 'utf8').includes('password'));
    const resume = { ...apply, resume: true }; serverFails = false; nonempty = true;
    await assert.rejects(provisionGlobalProject(resume, pgRuntime, pgDependencies), /GLOBAL_POSTGRES_DATABASE_NOT_EMPTY/);
    assert(!events.includes('bootstrap'));
    nonempty = false; installFails = true;
    await assert.rejects(provisionGlobalProject(resume, pgRuntime, pgDependencies), /GLOBAL_PROVISION_BOOTSTRAP_INTERRUPTED/);
    nonempty = true;
    await assert.rejects(provisionGlobalProject(resume, pgRuntime, pgDependencies), /GLOBAL_POSTGRES_DATABASE_NOT_EMPTY/);
    nonempty = false; installFails = false;
    assert.equal((await provisionGlobalProject(resume, pgRuntime, pgDependencies)).status, 'complete');
    assert.deepEqual(events.slice(-3), ['bootstrap', 'verify', 'remember']);
    assert(!fs.existsSync(provisioningFile(home, pgRoot)));
    assert.equal(fs.existsSync(path.join(pgRoot, 'node_modules')), false);
  } finally {
    for (const [index, key] of ['AIDN_PG_FIXTURE_PROJECT', 'AIDN_PG_FIXTURE_ADMIN'].entries()) {
      if (previousSecrets[index] === undefined) delete process.env[key]; else process.env[key] = previousSecrets[index];
    }
  }
  console.log('PASS global management fixtures: immutable preview, exact plan, version detection, interrupted npm removal and explicit migration resume; npm injected, no native or PostgreSQL qualification');
} finally {
  const resolved = fs.realpathSync(root);
  if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) || !path.basename(resolved).startsWith('aidn-global-management-')) throw new Error('UNSAFE_FIXTURE_CLEANUP');
  fs.rmSync(resolved, { recursive: true, force: true });
}
