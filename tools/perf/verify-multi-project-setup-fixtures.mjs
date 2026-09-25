import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { executeInstallation, verifyInstallationCandidate } from '../../src/application/install/installation-service.mjs';
import { inspectProject, compareVersions, updateStatus } from '../setup/installed-project.mjs';
import { readProjects, rememberProject, forgetProject, editProjects } from '../setup/project-registry.mjs';
import { updateProject, setupProcess } from '../setup/update-project.mjs';
import { resolveReleaseVersion } from '../setup/github-release-package.mjs';
import { installUserSetup } from '../setup/install-user-setup.mjs';
import { getDatabaseSync } from '../../src/lib/sqlite/workflow-db-schema-lib.mjs';
import { removePathWithRetry } from './test-git-fixture-lib.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-multi-setup-'));
const repoRoot = path.resolve(import.meta.dirname, '../..');
const version = fs.readFileSync(path.join(repoRoot, 'VERSION'), 'utf8').trim();
const [major, minor] = version.split('.').map(Number);
const nextVersion = `${major}.${minor + 1}.0`;
const home = path.join(root, 'home');
const checks = [];
const put = (dir, name, data) => { const file = path.join(dir, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };
function snapshot(dir) {
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)).map(entry => [entry.name,
    entry.isDirectory() ? snapshot(path.join(dir, entry.name)) : createHash('sha256').update(fs.readFileSync(path.join(dir, entry.name))).digest('hex')]);
}
try {
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
  assert.equal(compareVersions('0.9.0-alpha.2', '0.9.0-alpha.10'), -1);
  assert.equal(compareVersions('0.9.0-alpha-beta', '0.9.0-alpha'), 1);
  assert.equal(compareVersions('0.9.0+local', '0.9.0'), 0);
  const target = path.join(root, 'client espace é'); fs.mkdirSync(target);
  assert.equal(spawnSync('git', ['init', '--quiet', target]).status, 0);
  put(target, 'AGENTS.md', 'Client instructions\n');
  assert.equal(inspectProject(target).state, 'absent');
  const install = await executeInstallation({ repoRoot, targetRoot: target, dryRun: false,
    args: { pack: 'core', initDefaults: true, projectName: 'neutral client', runtimeStateMode: 'files', artifactImportStore: 'file', sourceBranch: 'dev' } });
  assert(install.ok, JSON.stringify(install.errors));
  put(target, 'node_modules/aidn-workflow/package.json', { name: 'aidn-workflow', version });
  put(target, 'node_modules/aidn-workflow/VERSION', version);
  assert.equal(inspectProject(target).state, 'installed');
  const second = path.join(root, 'second'); fs.mkdirSync(second); spawnSync('git', ['init', '--quiet', second]); put(second, 'personal.txt', 'untouched');
  const secondBefore = snapshot(second), targetBefore = snapshot(target);
  assert.equal(updateStatus(inspectProject(target), version), 'up-to-date');
  const candidate = await verifyInstallationCandidate({ repoRoot, targetRoot: target, args: { persistencePolicy: 'verify-only', artifactImportStore: 'file', runtimeStateMode: 'files' } });
  assert(candidate.ok, JSON.stringify(candidate.errors));
  assert.deepEqual(snapshot(target), targetBefore);
  assert.deepEqual(readProjects(home), { schema_version: 1, projects: [] }); assert(!fs.existsSync(home));
  rememberProject(target, home); rememberProject(target, home); rememberProject(second, home);
  assert.equal(readProjects(home).projects.length, 2);
  const id = readProjects(home).projects[0].id;
  const registered = fs.readFileSync(path.join(home, 'projects.json'), 'utf8');
  editProjects(home, () => assert.throws(() => rememberProject(target, home), /REGISTRY_BUSY/));
  editProjects(home, () => {
    const code = `import { rememberProject } from ${JSON.stringify(new URL('../setup/project-registry.mjs', import.meta.url).href)};
      try { rememberProject(process.argv[2], process.argv[1]); process.exitCode = 3; }
      catch (error) { if (error.message !== 'PROJECT_REGISTRY_BUSY') throw error; }`;
    const contender = spawnSync(process.execPath, ['--input-type=module', '-e', code, home, target], { encoding: 'utf8' });
    assert.equal(contender.status, 0, contender.stderr);
  });
  assert.equal(fs.readFileSync(path.join(home, 'projects.json'), 'utf8'), registered);
  fs.writeFileSync(path.join(home, 'projects.json'), 'invalid');
  assert.throws(() => rememberProject(target, home), /INVALID_PROJECT_REGISTRY/);
  assert.equal(fs.readFileSync(path.join(home, 'projects.json'), 'utf8'), 'invalid');
  fs.writeFileSync(path.join(home, 'projects.json'), registered);
  forgetProject(id, home); assert.equal(readProjects(home).projects.length, 1);
  assert.deepEqual(snapshot(target), targetBefore);
  const moved = path.join(root, 'moved'); fs.renameSync(second, moved);
  assert.equal(readProjects(home).projects[0].path, second); fs.renameSync(moved, second);
  checks.push('independent-project-addresses; dedup; locked-atomic-registry; corrupt-and-moved-paths; forget-without-uninstall');
  let called = false;
  for (const selected of [version, '0.1.0']) {
    const result = await updateProject({ target, version: selected, write: true }, { home, run: () => { called = true; } });
    assert.equal(result.written, false);
  }
  assert.equal(called, false);
  const tarball = path.join(root, 'candidate.tgz'); fs.writeFileSync(tarball, 'candidate');
  const sha = createHash('sha256').update('candidate').digest('hex');
  const integrity = 'sha512-' + createHash('sha512').update('candidate').digest('base64');
  const stages = [];
  await assert.rejects(updateProject({ target, version: nextVersion, write: true, localPackage: { packagePath: tarball, packageSha256: sha } }, {
    home, log: () => {}, run: (command, args, options) => {
      stages.push(options.stage);
      if (options.stage === 'candidate-install') {
        put(options.cwd, 'node_modules/aidn-workflow/package.json', { name: 'aidn-workflow', version: nextVersion });
        put(options.cwd, 'node_modules/aidn-workflow/VERSION', nextVersion);
        put(options.cwd, 'package-lock.json', { packages: { 'node_modules/aidn-workflow': { integrity } } });
      } else if (options.stage === 'candidate-preflight') throw new Error('PERSISTENCE_MIGRATION_REQUIRED');
    },
  }), /PERSISTENCE_MIGRATION_REQUIRED/);
  assert.deepEqual(stages, ['candidate-install', 'candidate-preflight']);
  assert.deepEqual(snapshot(target), targetBefore); assert.deepEqual(snapshot(second), secondBefore);
  await assert.rejects(updateProject({ target, version: nextVersion, write: true, fingerprint: 'changed' }, { home }), /INSTALLED_PROJECT_CHANGED/);
  put(target, 'node_modules/aidn-workflow/VERSION', '0.8.0'); assert.equal(inspectProject(target).state, 'inconsistent');
  put(target, 'node_modules/aidn-workflow/VERSION', version);
  const configFile = path.join(target, '.aidn/config.json'), configText = fs.readFileSync(configFile, 'utf8');
  const legacy = JSON.parse(configText); delete legacy.install.aidnVersion; put(target, '.aidn/config.json', legacy);
  assert.equal(inspectProject(target).state, 'unknown'); fs.writeFileSync(configFile, configText);
  fs.renameSync(path.join(target, 'node_modules'), path.join(root, 'saved-modules'));
  assert.equal(inspectProject(target).state, 'package-missing');
  fs.renameSync(path.join(root, 'saved-modules'), path.join(target, 'node_modules'));
  const interrupted = path.join(root, 'interrupted'); fs.mkdirSync(interrupted); spawnSync('git', ['init', '--quiet', interrupted]);
  const partial = await executeInstallation({ repoRoot, targetRoot: interrupted, dryRun: false, failAfter: 1,
    args: { pack: 'core', initDefaults: true, runtimeStateMode: 'files', artifactImportStore: 'file' } });
  assert.equal(partial.ok, false); assert.equal(inspectProject(interrupted).state, 'interrupted');
  checks.push('numeric-semver; no-op-and-no-downgrade; staged-migration-refusal-before-project-npm; confirmation-drift; unknown-and-inconsistent');
  const release = { tag_name: 'v0.10.0', draft: false, prerelease: false, assets: ['aidn-workflow-0.10.0.tgz','manifest.json','checksums.txt'].map(name => ({ name, browser_download_url: `https://github.com/leuzeus/aidn/releases/download/v0.10.0/${name}` })) };
  assert.equal(await resolveReleaseVersion('latest', { read: async () => Buffer.from(JSON.stringify(release)) }), '0.10.0');
  assert.equal(await resolveReleaseVersion('LATEST', { read: async () => Buffer.from(JSON.stringify(release)) }), '0.10.0');
  assert.throws(() => setupProcess(process.execPath, ['-e', 'console.error("PERSISTENCE_MIGRATION_REQUIRED"); console.error("Warning: fixture"); process.exitCode=1;'],
    { cwd: root, env: process.env, stage: 'candidate-preflight' }), /PERSISTENCE_MIGRATION_REQUIRED/);
  assert.throws(() => setupProcess(process.execPath, ['-e', 'console.error("PRIVATE_UPPERCASE_VALUE"); process.exitCode=1;'],
    { cwd: root, env: process.env, stage: 'candidate-preflight' }), /^Error: CANDIDATE_PREFLIGHT_FAILED$/);
  await assert.rejects(resolveReleaseVersion('latest', { read: async () => Buffer.from(JSON.stringify({ ...release, assets: [] })) }), /ASSET/);
  await assert.rejects(resolveReleaseVersion('latest', { read: async () => { throw new Error('offline'); } }), /offline/);
  const setupBefore = snapshot(home);
  assert.equal(installUserSetup({ home, source: repoRoot }).written, false); assert.deepEqual(snapshot(home), setupBefore);
  checks.push('latest-stable-assets-and-network-failure; host-install-preview-no-write');
  if (process.platform === 'win32') {
    const menuFile = path.join(root, 'menu-proof.ps1'), answersFile = path.join(root, 'menu-answers.json');
    fs.writeFileSync(answersFile, JSON.stringify(['2', '0', target, 'o', '3', 'n', '5', 'o', 'q']));
    fs.writeFileSync(menuFile, `param($Source, $AnswersFile)
$ErrorActionPreference = 'Stop'
$global:menuAnswers = New-Object 'System.Collections.Generic.Queue[string]'
foreach ($answer in (Get-Content -LiteralPath $AnswersFile -Raw -Encoding UTF8 | ConvertFrom-Json)) { $global:menuAnswers.Enqueue([string]$answer) }
function Read-Host { param($Prompt, [switch]$AsSecureString)
 if ($AsSecureString -or $global:menuAnswers.Count -eq 0) { throw 'Unexpected prompt' }
 return $global:menuAnswers.Dequeue()
}
& (Join-Path $Source 'scripts/setup-project.ps1') -Wizard
`);
    const menu = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', menuFile, '-Source', repoRoot, '-AnswersFile', answersFile], {
      env: { ...process.env, AIDN_HOME: home }, encoding: 'utf8', timeout: 30000 });
    assert.equal(menu.status, 0, menu.stdout + menu.stderr);
    assert.equal(readProjects(home).projects.length, 1); assert.equal(readProjects(home).projects[0].path, second);
    assert.deepEqual(snapshot(target), targetBefore); assert.deepEqual(snapshot(second), secondBefore);
    const homeBefore = snapshot(home);
    const unchanged = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File',
      path.join(repoRoot, 'scripts/setup-project.ps1'), '-Target', target, '-Update', '-ReleaseVersion', '0.1.0', '-Write'], {
      env: { ...process.env, AIDN_HOME: home }, encoding: 'utf8', timeout: 30000 });
    assert.equal(unchanged.status, 0, unchanged.stdout + unchanged.stderr); assert(unchanged.stdout.includes('local-newer'));
    assert.deepEqual(snapshot(home), homeBefore); assert.deepEqual(snapshot(target), targetBefore);
    const localPreview = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File',
      path.join(repoRoot, 'scripts/setup-project.ps1'), '-Target', target, '-Update', '-PackagePath', tarball, '-PackageSha256', sha, '-Write'], {
      env: { ...process.env, AIDN_HOME: home }, encoding: 'utf8', timeout: 30000 });
    assert.equal(localPreview.status, 0, localPreview.stdout + localPreview.stderr); assert(localPreview.stdout.includes('up-to-date'));
    assert.deepEqual(snapshot(home), homeBefore); assert.deepEqual(snapshot(target), targetBefore);
    checks.push('real-powershell-menu-remember-consult-forget; scripted-downgrade-no-write');
  }
  const sqlTarget = path.join(root, 'sqlite'); fs.mkdirSync(sqlTarget);
  const sqlInstall = await executeInstallation({ repoRoot, targetRoot: sqlTarget, dryRun: false, args: { pack: 'core', initDefaults: true,
    runtimeStateMode: 'db-only', artifactImportStore: 'sqlite', projectName: 'sqlite fixture' } });
  assert(sqlInstall.ok, JSON.stringify(sqlInstall.errors));
  const sqlBefore = snapshot(sqlTarget);
  assert.equal((await verifyInstallationCandidate({ repoRoot, targetRoot: sqlTarget, args: { persistencePolicy: 'verify-only' } })).ok, true);
  assert.deepEqual(snapshot(sqlTarget), sqlBefore);
  const db = new (getDatabaseSync())(path.join(sqlTarget, '.aidn/runtime/index/workflow-index.sqlite'));
  db.prepare("UPDATE index_meta SET value = '1' WHERE key = 'schema_version'").run(); db.close();
  const oldSchema = snapshot(sqlTarget);
  await assert.rejects(verifyInstallationCandidate({ repoRoot, targetRoot: sqlTarget, args: { persistencePolicy: 'verify-only' } }), /PERSISTENCE_MIGRATION_REQUIRED/);
  assert.deepEqual(snapshot(sqlTarget), oldSchema);
  checks.push('actual-sqlite-candidate-read-only; old-schema-refused-without-migration');
  console.log(JSON.stringify({ ok: true, checks, live_postgres: 'SKIP: separate qualification', native_approval: 'unverified' }, null, 2));
} finally { const cleanup = removePathWithRetry(root); if (!cleanup.ok) throw cleanup.error; }
