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

const source = path.resolve(import.meta.dirname, '../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-real-global-'));
const home = path.join(temporary, 'AIDN espace été'), userHome = path.join(temporary, 'user');
const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: source, encoding: 'utf8', timeout: 240000, windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(`REAL_GLOBAL_CHILD_FAILED: ${command === process.execPath ? args[1] : command}; ${result.error?.code ?? result.status}; ${result.stderr?.slice(-1200) ?? ''}`);
  return result.stdout;
}
try {
  const packed = JSON.parse(run(process.execPath, [npm, 'pack', source, '--ignore-scripts', '--json', '--pack-destination', temporary]));
  assert.equal(path.basename(packed[0].filename), packed[0].filename);
  const packagePath = path.join(temporary, packed[0].filename);
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
      run(process.execPath, [npm, 'install', '--save-dev', '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund', packagePath], { cwd: target });
      const local = path.join(target, 'node_modules/aidn-workflow');
      const { executeInstallation } = await import(pathToFileURL(path.join(local, 'src/application/install/installation-service.mjs')).href);
      const installed = await executeInstallation({ repoRoot: local, targetRoot: target, dryRun: false,
        args: { pack: 'core', initDefaults: true, projectName: 'neutral', runtimeStateMode: 'files', artifactImportStore: 'file', sourceBranch: 'dev' } });
      assert.equal(installed.ok, true, JSON.stringify(installed.errors));
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
  }
  assert.equal(cli(['project', 'list']).result.projects.length, 2);
  assert.deepEqual(fs.readdirSync(path.join(home, 'leases')), []);
  let discovery = { status: 'NOT_RUN' };
  if (process.argv.includes('--require-codex-discovery')) {
    discovery = await discoverRepoSkills({ cwd: path.join(temporary, 'second'), codexHome: path.join(userHome, '.codex'),
      env: { ...env, HOME: userHome, USERPROFILE: userHome }, scope: 'user', skillsRoot: path.join(userHome, '.agents/skills'),
      expectedSkillNames: SKILL_IDENTITIES.map(skill => skill.publicName) });
    assert.equal(discovery.status, 'PASS', JSON.stringify(discovery.errors?.length ? discovery.errors : discovery.reason));
    assert.equal(discovery.skills.length, SKILL_IDENTITIES.length);
  }
  console.log(JSON.stringify({ status: 'PASS', package_installation: 'actual npm tarball and dependency installation',
    global_launcher: 'actual subprocess', projects: 2, local_package_removal: 'actual npm uninstall', version, persistence: 'files',
    postgres: 'NOT_RUN', native_codex: discovery.status, native_hooks: 'NOT_RUN' }, null, 2));
} finally {
  const resolved = fs.realpathSync(temporary);
  if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) || !path.basename(resolved).startsWith('aidn-real-global-')) throw new Error('UNSAFE_QUALIFICATION_CLEANUP');
  fs.rmSync(resolved, { recursive: true, force: true });
}
