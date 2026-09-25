#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { executeGlobalUpdate } from '../setup/global-update.mjs';
import { readActivation } from '../../src/application/install/project-activation-service.mjs';
import { discoverRepoSkills } from './codex-discovery-lib.mjs';
import { SKILL_IDENTITIES } from '../../src/core/skills/skill-policy.mjs';
import { readGlobalState, verifyRuntimeGeneration } from '../../src/application/install/global-runtime-store.mjs';
import { downloadReleasePackage } from '../setup/github-release-package.mjs';

const source = path.resolve(import.meta.dirname, '../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-real-global-'));
const home = path.join(temporary, 'AIDN espace été'), userHome = path.join(temporary, 'user');
const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
let postgresEvidence;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const input = path.join(from, entry.name), output = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(input, output);
    else if (entry.isFile()) fs.copyFileSync(input, output);
    else throw new Error('QUALIFICATION_UNSAFE_COPY');
  }
}
const snapshot = root => fs.readdirSync(root, { recursive: true }).sort()
  .filter(name => fs.statSync(path.join(root, name)).isFile()).map(name => [name, sha(fs.readFileSync(path.join(root, name)))]);
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: source, encoding: 'utf8', timeout: 240000, windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(`REAL_GLOBAL_CHILD_FAILED: ${command === process.execPath ? args[1] : command}; ${result.error?.code ?? result.status}; ${result.stderr?.slice(-1200) ?? ''}`);
  return result.stdout;
}
try {
  const packed = JSON.parse(run(process.execPath, [npm, 'pack', source, '--ignore-scripts', '--json', '--pack-destination', temporary]));
  assert.equal(path.basename(packed[0].filename), packed[0].filename);
  const packagePath = path.join(temporary, packed[0].filename);
  const legacyIndex = process.argv.indexOf('--legacy-release');
  const legacy = legacyIndex < 0 ? null : await downloadReleasePackage(process.argv[legacyIndex + 1], { cacheRoot: path.join(temporary, 'legacy-release') });
  const version = fs.readFileSync(path.join(source, 'VERSION'), 'utf8').trim();
  const options = { home, userHome, codexHome: path.join(userHome, '.codex'), release: version, packagePath, packageSha256: sha(fs.readFileSync(packagePath)) };
  const plan = await executeGlobalUpdate(options);
  assert.equal(fs.existsSync(home), false);
  const applied = await executeGlobalUpdate({ ...options, write: true, expectedPlanId: plan.plan_id });
  assert.equal(applied.status, 'complete');
  const env = { ...process.env, AIDN_HOME: home };
  const cli = args => JSON.parse(run(process.execPath, [path.join(home, 'bin/global-launcher.mjs'), ...args, '--json'], { env }));
  for (const name of ['projet été', 'second']) {
    const target = path.join(temporary, name); fs.mkdirSync(target);
    run('git', ['init', target]);
    let action = 'add';
    if (name === 'projet été') {
      run(process.execPath, [npm, 'install', '--save-dev', '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund', legacy?.packagePath ?? packagePath], { cwd: target });
      const local = path.join(target, 'node_modules/aidn-workflow');
      const { executeInstallation } = await import(pathToFileURL(path.join(local, 'src/application/install/installation-service.mjs')).href);
      if (process.argv.includes('--require-postgres')) {
        const { globalPostgresEvidence } = await import('./global-postgres-evidence-lib.mjs');
        postgresEvidence = await globalPostgresEvidence(target);
      }
      const installed = await executeInstallation({ repoRoot: local, targetRoot: target, dryRun: false,
        args: { pack: 'core', initDefaults: true, projectName: 'neutral', runtimeStateMode: 'files', artifactImportStore: 'file', sourceBranch: 'dev',
          ...(postgresEvidence ? { runtimeStateMode: 'db-only', artifactImportStore: 'sqlite', runtimePersistenceBackend: 'postgres',
            runtimePersistenceConnectionRef: 'env:AIDN_RUNTIME_PG_SMOKE_URL', runtimePersistenceLocalProjectionPolicy: 'none' } : {}) } });
      assert.equal(installed.ok, true, JSON.stringify(installed.errors));
      await postgresEvidence?.capture();
      action = 'migrate';
    }
    const add = cli(['project', action, '--target', target]);
    assert.equal(add.ok, true, JSON.stringify(add.errors));
    const result = cli(['project', action, '--target', target, '--write', '--expect-plan', add.result.plan_id]);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(readActivation({ targetRoot: target }).active, true);
    assert.equal(fs.existsSync(path.join(target, 'node_modules/aidn-workflow')), false);
    assert.equal(fs.existsSync(path.join(target, '.agents/skills/aidn-context-reload/SKILL.md')), false);
    const doctor = cli(['doctor', '--target', target]);
    assert.equal(doctor.ok, true, JSON.stringify(doctor.errors));
    assert.equal(doctor.result.version, version);
    assert.equal(doctor.result.integration, 'global');
    await postgresEvidence?.verify();
  }
  assert.equal(cli(['project', 'list']).result.projects.length, 2);
  assert.deepEqual(fs.readdirSync(path.join(home, 'leases')), []);
  let update = 'NOT_RUN';
  if (process.argv.includes('--require-update-rollback')) {
    // A synthetic next version exercises actual npm/switch behavior; this is
    // explicitly not proof of a published release or of future schema support.
    const candidate = path.join(temporary, 'synthetic-next-version');
    copyTree(verifyRuntimeGeneration(home, readGlobalState(home).active).packageRoot, candidate);
    const [major, minor, patch] = version.split('.').map(Number);
    const nextVersion = `${major}.${minor}.${patch + 1}`;
    fs.writeFileSync(path.join(candidate, 'VERSION'), nextVersion + '\n');
    const metadata = JSON.parse(fs.readFileSync(path.join(candidate, 'package.json')));
    metadata.version = nextVersion;
    fs.writeFileSync(path.join(candidate, 'package.json'), JSON.stringify(metadata, null, 2));
    const packedNext = JSON.parse(run(process.execPath, [npm, 'pack', candidate, '--ignore-scripts', '--json', '--pack-destination', temporary]));
    const nextPackage = path.join(temporary, packedNext[0].filename);
    const next = { ...options, release: nextVersion, packagePath: nextPackage, packageSha256: sha(fs.readFileSync(nextPackage)) };
    const projects = ['projet été', 'second'].map(name => path.join(temporary, name));
    const before = projects.map(snapshot), registry = fs.readFileSync(path.join(home, 'projects.json'));
    const proposed = await executeGlobalUpdate(next);
    assert.equal(proposed.status, 'update-available');
    assert.deepEqual(projects.map(snapshot), before);
    await executeGlobalUpdate({ ...next, write: true, expectedPlanId: proposed.plan_id });
    for (const target of projects) assert.equal(cli(['doctor', '--target', target]).result.version, nextVersion);
    assert.deepEqual(projects.map(snapshot), before, 'global update never rewrites either project');
    assert.deepEqual(fs.readFileSync(path.join(home, 'projects.json')), registry);
    await postgresEvidence?.verify();
    const rollbackOptions = { home, userHome, codexHome: options.codexHome, rollback: true };
    const rollback = await executeGlobalUpdate(rollbackOptions);
    await executeGlobalUpdate({ ...rollbackOptions, write: true, expectedPlanId: rollback.plan_id });
    for (const target of projects) assert.equal(cli(['doctor', '--target', target]).result.version, version);
    assert.deepEqual(projects.map(snapshot), before, 'rollback never restores project files or data');
    assert.deepEqual(fs.readFileSync(path.join(home, 'projects.json')), registry);
    await postgresEvidence?.verify();
    update = 'PASS: actual npm, synthetic next-version package, two-project switch and rollback';
  }
  let discovery = { status: 'NOT_RUN' };
  if (process.argv.includes('--require-codex-discovery')) {
    discovery = await discoverRepoSkills({ cwd: path.join(temporary, 'second'), codexHome: path.join(userHome, '.codex'),
      env: { ...env, HOME: userHome, USERPROFILE: userHome }, scope: 'user', skillsRoot: path.join(userHome, '.codex/skills'),
      expectedSkillNames: SKILL_IDENTITIES.map(skill => skill.publicName) });
    assert.equal(discovery.status, 'PASS', JSON.stringify(discovery.errors?.length ? discovery.errors : discovery.reason));
    assert.equal(discovery.skills.length, SKILL_IDENTITIES.length);
  }
  const postgres = postgresEvidence ? 'PASS: canonical rows unchanged at each exercised global operation; synthetic scopes cleaned' : 'NOT_RUN';
  await postgresEvidence?.cleanup();
  postgresEvidence = undefined;
  console.log(JSON.stringify({ status: 'PASS', package_installation: 'actual npm tarball and dependency installation',
    global_launcher: 'actual subprocess', projects: 2, local_package_removal: 'actual npm uninstall', version, legacy_version: legacy?.version ?? version,
    package_sha256: options.packageSha256, global_update_rollback: update,
    postgres,
    native_skills_discovery: discovery.status, native_agents_discovery: 'NOT_RUN', native_hooks: 'NOT_RUN' }, null, 2));
} catch (error) {
  const message = String(error.message).replaceAll(process.env.AIDN_RUNTIME_PG_SMOKE_URL || '\0', '[redacted]')
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[redacted-postgres-url]');
  console.error(message); process.exitCode = 1;
} finally {
  await postgresEvidence?.cleanup();
  const resolved = fs.realpathSync(temporary);
  if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) || !path.basename(resolved).startsWith('aidn-real-global-')) throw new Error('UNSAFE_QUALIFICATION_CLEANUP');
  fs.rmSync(resolved, { recursive: true, force: true });
}
