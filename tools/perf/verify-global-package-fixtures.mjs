import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { prepareGlobalPackage, globalCodexAssets } from '../setup/global-package.mjs';
import { planGlobalSwitch, applyGlobalSwitch } from '../../src/application/install/global-runtime-store.mjs';
import { planCodexAssets, executeCodexAssets } from '../../src/application/install/codex-assets-service.mjs';
import { readActivation } from '../../src/application/install/project-activation-service.mjs';
import { resolveGlobalProjectBinding } from '../../src/application/install/global-project-integration.mjs';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-global-package-'));
const source = path.resolve(import.meta.dirname, '../..');
const home = path.join(temporary, 'AIDN espace été');
const userHome = path.join(temporary, 'user');
const packagePath = path.join(temporary, 'fixture.tgz');
const npmCli = path.join(temporary, 'npm-cli.js');
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const input = path.join(from, entry.name), output = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(input, output);
    else fs.copyFileSync(input, output);
  }
}
try {
  fs.writeFileSync(packagePath, 'injected tarball fixture');
  fs.writeFileSync(npmCli, '// injected npm');
  const artifact = { packagePath, packageSha256: createHash('sha256').update(fs.readFileSync(packagePath)).digest('hex') };
  let calls = 0;
  let fixtureVersion = '0.10.0';
  const run = (command, args, options) => {
    calls++;
    assert.equal(command, process.execPath);
    assert(args.includes('--ignore-scripts'));
    assert(args.includes('--include=optional'));
    assert.equal(options.env.AIDN_TEST_SECRET, undefined);
    const root = path.join(options.cwd, 'node_modules', 'aidn-workflow');
    fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(root, 'VERSION'), fixtureVersion);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'aidn-workflow', version: fixtureVersion }));
    fs.writeFileSync(path.join(root, 'bin/aidn.mjs'), `console.log(JSON.stringify({version:${JSON.stringify(fixtureVersion)},args:process.argv.slice(2),home:process.env.AIDN_HOME}));`);
    for (const name of ['scaffold']) {
      copyTree(path.join(source, name), path.join(root, name));
      assert(fs.existsSync(path.join(root, name)), `fixture copy missing: ${name}`);
    }
    for (const name of ['src/application/install/global-runtime-store.mjs', 'src/lib/fs/atomic-write-lib.mjs', 'tools/setup/global-launcher.mjs']) {
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      fs.copyFileSync(path.join(source, name), path.join(root, name));
    }
  };
  assert.throws(() => prepareGlobalPackage({ home, artifact: { ...artifact, packageSha256: '0'.repeat(64) }, version: '0.10.0' }, { run, npmCli }), /GLOBAL_TARBALL_HASH_MISMATCH/);
  assert.equal(calls, 0, 'wrong checksum stops before npm or directory creation');
  assert.equal(fs.existsSync(home), false);
  const prepared = prepareGlobalPackage({ home, artifact, version: '0.10.0' }, { run, npmCli, env: { ...process.env, AIDN_TEST_SECRET: 'fixture' } });
  const assets = globalCodexAssets({ home, packageRoot: prepared.packageRoot, userHome, codexHome: path.join(userHome, '.codex') });
  assert.equal(assets.filter(item => item.path.endsWith('SKILL.md')).length, 13);
  assert.equal(assets.filter(item => item.path.endsWith('.toml')).length, 4);
  assert(assets.filter(item => item.path.endsWith('SKILL.md')).every(item => !/npx aidn/.test(item.content)));
  const skill = assets.find(item => item.path.includes('aidn-context-reload') && item.path.endsWith('SKILL.md'));
  assert.match(skill.content, /aidn --integration-revision 1 runtime pre-write-admit/);
  assert.equal(fs.existsSync(userHome), false, 'rendering assets is a preview');
  const plan = planGlobalSwitch({ home, candidate: prepared.pointer, assets });
  applyGlobalSwitch({ home, plan, expectedPlanId: plan.plan_id, recheckProjects: () => [] });
  const userConfig = path.join(userHome, '.codex/config.toml');
  fs.writeFileSync(userConfig, `[[skills.config]]\npath = ${JSON.stringify(skill.path)}\nenabled = false\n`);
  assert.throws(() => globalCodexAssets({ home, packageRoot: prepared.packageRoot, userHome, codexHome: path.dirname(userConfig) }), /GLOBAL_SKILL_DISABLED/);
  assert.match(fs.readFileSync(userConfig, 'utf8'), /enabled = false/);
  fs.unlinkSync(userConfig);
  const launch = args => spawnSync(process.execPath, [path.join(home, 'bin/global-launcher.mjs'), ...args], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  const result = launch(['--integration-revision', '1', 'version']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { version: '0.10.0', args: ['version'], home });
  assert.deepEqual(fs.readdirSync(path.join(home, 'leases')), [], 'launcher releases operation lease');
  const stale = launch(['--integration-revision', '2', 'version']);
  assert.equal(stale.status, 2);
  assert.match(stale.stderr, /GLOBAL_INSTRUCTIONS_STALE/);
  const client = path.join(temporary, 'client');
  fs.mkdirSync(client);
  const localPlan = planCodexAssets({ repoRoot: source, targetRoot: client });
  assert.equal(localPlan.ok, true, JSON.stringify(localPlan.errors));
  assert.equal(executeCodexAssets({ repoRoot: source, targetRoot: client, dryRun: false, expectedPlanId: localPlan.plan_id }).ok, true);
  assert.equal(readActivation({ targetRoot: client }).active, true);
  const migrateOptions = { repoRoot: prepared.packageRoot, targetRoot: client, globalHome: home };
  const migration = planCodexAssets(migrateOptions);
  assert.equal(migration.ok, true, JSON.stringify(migration.errors));
  const applied = executeCodexAssets({ ...migrateOptions, dryRun: false, expectedPlanId: migration.plan_id });
  assert.equal(applied.ok, true, JSON.stringify(applied.errors));
  assert.equal(fs.existsSync(path.join(client, '.agents/skills/aidn-context-reload/SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(client, '.codex/agents/aidn-executor.toml')), false);
  assert.equal(fs.existsSync(path.join(client, '.codex/hooks/aidn-hook-runtime.mjs')), false);
  assert.match(fs.readFileSync(path.join(client, '.codex/hooks/aidn-session-start.mjs'), 'utf8'), /global-launcher/);
  const activated = readActivation({ targetRoot: client });
  assert.equal(activated.active, true, JSON.stringify(activated.errors));
  const other = path.join(temporary, 'other-project');
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, 'AGENTS.md'), '# Another project policy\n');
  const otherOptions = { ...migrateOptions, targetRoot: other };
  const otherPlan = planCodexAssets(otherOptions);
  assert.equal(otherPlan.ok, true, JSON.stringify(otherPlan.errors));
  assert.equal(executeCodexAssets({ ...otherOptions, dryRun: false, expectedPlanId: otherPlan.plan_id }).ok, true);
  const snapshot = root => fs.readdirSync(root, { recursive: true }).sort().filter(name => fs.statSync(path.join(root, name)).isFile())
    .map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex')]);
  const firstBefore = snapshot(client), secondBefore = snapshot(other);
  fixtureVersion = '0.11.0';
  const next = prepareGlobalPackage({ home, artifact, version: fixtureVersion }, { run, npmCli });
  const nextAssets = globalCodexAssets({ home, packageRoot: next.packageRoot, userHome, codexHome: path.join(userHome, '.codex') });
  const nextPlan = planGlobalSwitch({ home, candidate: next.pointer, assets: nextAssets });
  applyGlobalSwitch({ home, plan: nextPlan, expectedPlanId: nextPlan.plan_id, recheckProjects: () => [] });
  for (const targetRoot of [client, other]) {
    const current = readActivation({ targetRoot });
    assert.equal(current.active, true, JSON.stringify(current.errors));
    assert.equal(resolveGlobalProjectBinding(current.receipt.global_runtime).version, '0.11.0');
    assert.equal(current.receipt.package.version, '0.10.0', 'last local installation evidence is not an active version pin');
  }
  assert.deepEqual(snapshot(client), firstBefore, 'global update leaves first project byte-identical');
  assert.deepEqual(snapshot(other), secondBefore, 'global update leaves second project byte-identical');
  fs.appendFileSync(path.join(client, '.codex/hooks/aidn-session-start.mjs'), '\nchanged');
  assert.equal(readActivation({ targetRoot: client }).active, false, 'global binding does not bypass local connector integrity');
  fs.writeFileSync(skill.path, 'customized');
  const changed = launch(['version']);
  assert.equal(changed.status, 2);
  assert.match(changed.stderr, /GLOBAL_ASSET_CHANGED/);
  assert.equal(changed.stdout, '');
  console.log('PASS global package fixtures: verified local bytes, isolated candidate, 13 skills / 4 agents, stable launcher, revision refusal and customization preservation (npm injected, native discovery unqualified)');
} finally {
  const resolved = fs.realpathSync(temporary);
  if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) || !path.basename(resolved).startsWith('aidn-global-package-')) throw new Error('UNSAFE_FIXTURE_CLEANUP');
  fs.rmSync(resolved, { recursive: true, force: true });
}
