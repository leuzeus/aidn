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
import { validateJsonSchema } from '../../src/core/contracts/json-schema-validator.mjs';
import { discoverGlobalAgents } from './codex-agent-discovery-lib.mjs';

const source = path.resolve(import.meta.dirname, '../..');
const contract = JSON.parse(fs.readFileSync(path.join(source, 'src/core/contracts/cli-output/global-management.v1.schema.json')));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-real-global-'));
const home = path.join(temporary, 'AIDN espace été'), userHome = path.join(temporary, 'user');
const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
let postgresEvidence;
let legacyVersion;
let report;
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
  const cli = args => {
    const payload = JSON.parse(run(process.execPath, [path.join(home, 'bin/global-launcher.mjs'), ...args, '--json'], { env }));
    assert.deepEqual(validateJsonSchema(payload, contract), [], 'actual successful CLI output must match its public contract');
    return payload;
  };
  for (const name of ['projet été', 'second']) {
    const target = path.join(temporary, name); fs.mkdirSync(target);
    run('git', ['init', target]);
    let action = 'add';
    if (name === 'projet été') {
      run(process.execPath, [npm, 'install', '--save-dev', '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund', legacy?.packagePath ?? packagePath], { cwd: target });
      const local = path.join(target, 'node_modules/aidn-workflow');
      legacyVersion = fs.readFileSync(path.join(local, 'VERSION'), 'utf8').trim();
      assert.equal(legacyVersion, legacy ? process.argv[legacyIndex + 1] : version);
      assert.equal(JSON.parse(fs.readFileSync(path.join(local, 'package.json'))).version, legacyVersion);
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
  // These are actual connector subprocesses with a synthetic payload. Native
  // Codex trust and interception must still be proved separately by a human.
  const hookTarget = path.join(temporary, 'second');
  const hookBefore = snapshot(hookTarget);
  const sessionHook = JSON.parse(run(process.execPath, [path.join(hookTarget, '.codex/hooks/aidn-session-start.mjs')], {
    cwd: hookTarget, env, input: JSON.stringify({ cwd: hookTarget, hook_event_name: 'SessionStart', source: 'startup' }),
  }));
  assert.match(sessionHook.hookSpecificOutput.additionalContext, /AIDN canonical admission/);
  assert.doesNotMatch(sessionHook.hookSpecificOutput.additionalContext, /degraded|Missing installed assets/);
  const editHook = JSON.parse(run(process.execPath, [path.join(hookTarget, '.codex/hooks/aidn-pre-tool-use.mjs')], {
    cwd: hookTarget, env, input: JSON.stringify({ cwd: hookTarget, hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: {} }),
  }));
  assert.equal(editHook.hookSpecificOutput.permissionDecision, 'deny');
  assert.deepEqual(snapshot(hookTarget), hookBefore);
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
  let worktree = 'NOT_RUN';
  if (process.argv.includes('--require-worktree')) {
    const parent = path.join(temporary, 'second'), target = path.join(temporary, 'worktree été');
    run('git', ['-C', parent, '-c', 'user.name=AIDN qualification', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'Synthetic qualification root']);
    run('git', ['-C', parent, 'worktree', 'add', '-b', 'qualification-worktree', target]);
    assert.equal(readActivation({ targetRoot: target }).active, false, 'a new worktree is never implicitly active');
    const proposed = cli(['project', 'add', '--target', target]);
    const applied = cli(['project', 'add', '--target', target, '--write', '--expect-plan', proposed.result.plan_id]);
    assert.equal(applied.ok, true);
    assert.equal(readActivation({ targetRoot: target }).active, true);
    assert.equal(cli(['doctor', '--target', target]).result.version, version);
    assert.equal(fs.existsSync(path.join(target, 'node_modules/aidn-workflow')), false);
    const ownReceipt = JSON.parse(fs.readFileSync(path.join(target, '.aidn/install/receipt.json')));
    assert.notDeepEqual(ownReceipt, JSON.parse(fs.readFileSync(path.join(parent, '.aidn/install/receipt.json'))));
    worktree = 'PASS: actual git worktree, inactive before explicit preparation, own receipt and common engine';
  }
  let discovery = { status: 'NOT_RUN' };
  let agentDiscovery = { status: 'NOT_RUN' };
  if (process.argv.includes('--require-codex-discovery')) {
    discovery = await discoverRepoSkills({ cwd: path.join(temporary, 'second'), codexHome: path.join(userHome, '.codex'),
      env: { ...env, HOME: userHome, USERPROFILE: userHome }, scope: 'user', skillsRoot: path.join(userHome, '.codex/skills'),
      expectedSkillNames: SKILL_IDENTITIES.map(skill => skill.publicName) });
    assert.equal(discovery.status, 'PASS', JSON.stringify(discovery.errors?.length ? discovery.errors : discovery.reason));
    assert.equal(discovery.skills.length, SKILL_IDENTITIES.length);
    const discoveryCwd = path.join(temporary, 'native discovery only'); fs.mkdirSync(discoveryCwd);
    agentDiscovery = await discoverGlobalAgents({ cwd: discoveryCwd, codexHome: options.codexHome,
      env: { ...env, HOME: userHome, USERPROFILE: userHome },
      expectedNames: ['aidn-executor', 'aidn-explorer', 'aidn-reviewer', 'aidn-validator'] });
    assert.equal(agentDiscovery.status, 'PASS', JSON.stringify(agentDiscovery));
    const agentFile = path.join(options.codexHome, 'agents/aidn-executor.toml'), definition = fs.readFileSync(agentFile);
    try {
      fs.unlinkSync(agentFile);
      const missing = await discoverGlobalAgents({ cwd: discoveryCwd, codexHome: options.codexHome,
        env: { ...env, HOME: userHome, USERPROFILE: userHome }, expectedNames: ['aidn-executor', 'aidn-explorer', 'aidn-reviewer', 'aidn-validator'] });
      assert.equal(missing.status, 'FAIL');
      assert.equal(missing.discovered.includes('aidn-executor'), false, 'native discovery must track the global definition, not cached names');
      agentDiscovery.negative_control = 'PASS: missing definition is not advertised';
    } finally { fs.writeFileSync(agentFile, definition); }
  }
  const postgres = postgresEvidence ? 'PASS: canonical rows unchanged at each exercised global operation; synthetic scopes cleaned' : 'NOT_RUN';
  await postgresEvidence?.cleanup();
  postgresEvidence = undefined;
  report = { status: 'PASS', package_installation: 'actual npm tarball and dependency installation',
    global_launcher: 'actual subprocess', projects: 2, local_package_removal: 'actual npm uninstall', version, legacy_version: legacyVersion,
    package_sha256: options.packageSha256, global_update_rollback: update,
    additional_worktree: worktree, hook_connectors: 'PASS: direct subprocesses, synthetic input, no native tool interception claim',
    postgres,
    native_skills_discovery: discovery.status, native_agents_discovery: agentDiscovery, native_hooks: 'NOT_RUN',
    source_commit: run('git', ['rev-parse', 'HEAD']).trim(), source_dirty: run('git', ['status', '--porcelain']).trim() !== '',
    ...(process.argv.includes('--keep-native-fixture') ? { native_fixture: temporary, native_target: path.join(temporary, 'second'),
      native_home: home, native_codex_home: options.codexHome } : {}),
  };
} catch (error) {
  const message = String(error.message).replaceAll(process.env.AIDN_RUNTIME_PG_SMOKE_URL || '\0', '[redacted]')
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[redacted-postgres-url]');
  console.error(message); process.exitCode = 1;
} finally {
  await postgresEvidence?.cleanup();
  const resolved = fs.realpathSync(temporary);
  if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) || !path.basename(resolved).startsWith('aidn-real-global-')) throw new Error('UNSAFE_QUALIFICATION_CLEANUP');
  if (!report || !process.argv.includes('--keep-native-fixture')) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
if (report && !process.exitCode) console.log(JSON.stringify(report, null, 2));
