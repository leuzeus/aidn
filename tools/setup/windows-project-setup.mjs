import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { preparePostgres, validateConnections } from './windows-postgres.mjs';
import { createActivationGitEnvironment } from '../../src/application/install/project-activation-service.mjs';
import { downloadReleasePackage, releasePackagePlan } from './github-release-package.mjs';

const sourceRoot = path.resolve(import.meta.dirname, '../..');
const hashFile = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fail = (code) => { throw new Error(code); };
const scalarFlags = new Map([
  ['--target', 'target'], ['--package-path', 'packagePath'], ['--package-sha256', 'packageSha256'],
  ['--postgres-mode', 'postgresMode'], ['--connection-env', 'connectionEnv'],
  ['--admin-connection-env', 'adminConnectionEnv'], ['--postgres-version', 'postgresVersion'],
  ['--project-name', 'projectName'], ['--source-branch', 'sourceBranch'],
  ['--release-version', 'releaseVersion'],
]);
export function parseArguments(argv) {
  const options = { write: false, postgresMode: 'existing', adminConnectionEnv: 'AIDN_SETUP_PG_ADMIN' };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) fail('DUPLICATE_ARGUMENT');
    seen.add(flag);
    if (flag === '--write') { options.write = true; continue; }
    if (!scalarFlags.has(flag) || !argv[i + 1] || argv[i + 1].startsWith('--')) fail('INVALID_ARGUMENT');
    options[scalarFlags.get(flag)] = argv[++i];
  }
  return options;
}

export function createSetupPlan(options) {
  if (!options.target) fail('TARGET_REQUIRED');
  const release = options.releaseVersion ? releasePackagePlan(options.releaseVersion) : null;
  if (release && (options.packagePath || options.packageSha256)) fail('PACKAGE_SOURCE_OPTIONS_CONFLICT');
  if (!release && (!options.packagePath || !/^[a-f0-9]{64}$/i.test(options.packageSha256 || ''))) fail('TARGET_AND_PINNED_TARBALL_REQUIRED');
  const target = fs.realpathSync(path.resolve(options.target));
  const packagePath = release ? null : fs.realpathSync(path.resolve(options.packagePath));
  if (!fs.statSync(target).isDirectory() || !release && (!fs.statSync(packagePath).isFile() || !packagePath.endsWith('.tgz'))) fail('INVALID_TARGET_OR_TARBALL');
  if (target.toLowerCase() === sourceRoot.toLowerCase()) fail('PACKAGE_SOURCE_IS_NOT_A_CLIENT');
  if (!release && hashFile(packagePath) !== options.packageSha256.toLowerCase()) fail('TARBALL_HASH_MISMATCH');
  if (!['none', 'existing', 'install'].includes(options.postgresMode)) fail('INVALID_POSTGRES_MODE');
  if (options.postgresMode !== 'none' && (!/^AIDN_[A-Z0-9_]+$/.test(options.connectionEnv || '')
      || !/^AIDN_[A-Z0-9_]+$/.test(options.adminConnectionEnv || '') || options.connectionEnv === options.adminConnectionEnv)) fail('INVALID_CONNECTION_VARIABLES');
  if (options.postgresMode === 'install' && !/^17\.\d+-\d+$/.test(options.postgresVersion || '')) fail('EXPLICIT_POSTGRES_17_VERSION_REQUIRED');
  if (options.postgresMode !== 'install' && options.postgresVersion) fail('POSTGRES_VERSION_REQUIRES_INSTALL_MODE');
  if (options.projectName && /[\r\n\0]/.test(options.projectName) || options.sourceBranch && /[\s\0]/.test(options.sourceBranch)) fail('INVALID_PROJECT_METADATA');
  if (!fs.existsSync(path.join(target, '.git'))) fail('EXISTING_GIT_PROJECT_REQUIRED');
  const git = spawnSync('git', ['-C', target, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8', windowsHide: true, timeout: 10000, env: createActivationGitEnvironment(process.env) });
  if (git.status !== 0 || fs.realpathSync(git.stdout.trim()).toLowerCase() !== target.toLowerCase()) fail('GIT_PROJECT_ROOT_REQUIRED');
  const packageFile = path.join(target, 'package.json');
  if (fs.existsSync(packageFile)) {
    const metadata = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    if (metadata.name === 'aidn-workflow') fail('PACKAGE_SOURCE_IS_NOT_A_CLIENT');
  }
  const version = release?.version || fs.readFileSync(path.join(sourceRoot, 'VERSION'), 'utf8').trim();
  return { ...options, target, packagePath, version,
    stages: [...(release ? ['release-download-and-verify'] : []), 'package-install', ...(options.postgresMode === 'install' ? ['postgres-install-interactive', 'database-prepare'] : []),
      ...(options.postgresMode !== 'none' ? ['database-verify'] : []), 'bootstrap-preview', 'bootstrap-apply', 'diagnose',
      ...(options.postgresMode !== 'none' ? ['persistence-status'] : []), 'native-approval-pending'] };
}

export function isReusableWingetExit(status) {
  return typeof status === 'number' && [0x8a15002b, 0x8a150061].includes(status >>> 0);
}
function runProcess(command, args, { cwd, env, interactive = false, stage }) {
  const result = spawnSync(command, args, { cwd, env, shell: false, encoding: 'utf8',
    stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'], windowsHide: !interactive,
    timeout: interactive ? 30 * 60 * 1000 : 5 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });
  // Do not echo child output: upstream npm/driver errors can contain credentials.
  const reusable = stage === 'postgres-install' && isReusableWingetExit(result.status);
  if (result.error || result.status !== 0 && !reusable) fail(`STAGE_${stage.toUpperCase().replaceAll('-', '_')}_FAILED`);
  return result.stdout || '';
}

export async function applySetup(plan, { env = process.env, run = runProcess, database = preparePostgres,
  log = console.log, platform = process.platform, pgFactory, releaseDownloader = downloadReleasePackage } = {}) {
  if (!plan.write) fail('WRITE_REQUIRED');
  if (platform !== 'win32') fail('WINDOWS_REQUIRED');
  const major = Number(process.versions.node.split('.')[0]), minor = Number(process.versions.node.split('.')[1]);
  if (major < 22 || major === 22 && minor < 13) fail('NODE_22_13_REQUIRED');
  const postgres = plan.postgresMode !== 'none';
  const dbOptions = postgres ? { connectionString: env[plan.connectionEnv],
    adminConnectionString: env[plan.adminConnectionEnv], create: plan.postgresMode === 'install',
    expectedServerVersion: plan.postgresMode === 'install' ? 170000 + Number(plan.postgresVersion.split('.')[1].split('-')[0]) : null } : null;
  if (dbOptions) validateConnections(dbOptions);
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (!fs.existsSync(npmCli)) fail('NODE_BUNDLED_NPM_REQUIRED');
  if (plan.releaseVersion) {
    log('Stage: release-download-and-verify');
    plan = { ...plan, ...await releaseDownloader(plan.releaseVersion) };
    log(`Release: v${plan.version}; commit: ${plan.releaseCommit}; SHA256: ${plan.packageSha256}`);
  }
  if (hashFile(plan.packagePath) !== plan.packageSha256.toLowerCase()) fail('TARBALL_CHANGED');
  // Only database preparation needs admin credentials. Never pass them to npm,
  // WinGet, bootstrap, hooks or other children.
  const childEnv = { ...env };
  delete childEnv[plan.adminConnectionEnv];
  delete childEnv[plan.connectionEnv];
  log('Stage: package-install');
  run(process.execPath, [npmCli, 'install', '--save-dev', '--save-exact', '--include=optional', '--ignore-scripts',
    '--no-audit', '--no-fund', plan.packageUrl || plan.packagePath], { cwd: plan.target, env: childEnv, stage: 'package-install' });
  if (hashFile(plan.packagePath) !== plan.packageSha256.toLowerCase()) fail('TARBALL_CHANGED');
  const installed = path.join(plan.target, 'node_modules/aidn-workflow');
  if (fs.readFileSync(path.join(installed, 'VERSION'), 'utf8').trim() !== plan.version
      || JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).name !== 'aidn-workflow') fail('INSTALLED_PACKAGE_IDENTITY_MISMATCH');
  if (plan.packageUrl) {
    const lock = JSON.parse(fs.readFileSync(path.join(plan.target, 'package-lock.json'), 'utf8'));
    const entry = lock.packages?.['node_modules/aidn-workflow'];
    if (entry?.resolved !== plan.packageUrl || entry?.integrity !== plan.packageIntegrity || entry?.version !== plan.version) fail('RELEASE_NPM_INTEGRITY_MISMATCH');
  }
  let clientFactory;
  if (postgres) {
    if (pgFactory) clientFactory = pgFactory;
    else {
      let Client;
      try { ({ Client } = createRequire(path.join(installed, 'package.json'))('pg')); }
      catch { fail('POSTGRES_DRIVER_MISSING'); }
      clientFactory = (connectionString) => new Client({ connectionString, connectionTimeoutMillis: 10000, query_timeout: 30000 });
    }
    if (plan.postgresMode === 'install') {
      log('Stage: postgres-install-interactive (complete the official installer and start its service)');
      run('winget.exe', ['install', '--id', 'PostgreSQL.PostgreSQL.17', '--exact', '--source', 'winget',
        '--version', plan.postgresVersion, '--interactive', '--no-upgrade'],
      { cwd: plan.target, env: childEnv, interactive: true, stage: 'postgres-install' });
    }
    log('Stage: database-prepare-and-verify');
    try { await database(dbOptions, { clientFactory }); }
    catch (error) {
      const code = /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'POSTGRES_CONNECTION_OR_PROVISIONING_FAILED';
      fail(code);
    }
    childEnv[plan.connectionEnv] = dbOptions.connectionString;
  }
  const bin = path.join(installed, 'bin/aidn.mjs');
  const args = ['bootstrap', '--target', plan.target, '--profile', postgres ? 'postgres' : 'default', '--no-codex-migrate-custom'];
  if (postgres) args.push('--runtime-persistence-connection-ref', `env:${plan.connectionEnv}`);
  if (plan.projectName) args.push('--project-name', plan.projectName);
  if (plan.sourceBranch) args.push('--source-branch', plan.sourceBranch);
  function cli(extra, stage) {
    log(`Stage: ${stage}`);
    let result;
    try { result = JSON.parse(run(process.execPath, [bin, ...extra, '--json'], { cwd: plan.target, env: childEnv, stage })); }
    catch { fail(`STAGE_${stage.toUpperCase().replaceAll('-', '_')}_FAILED`); }
    if (stage === 'persistence-status') {
      if (result.runtime_persistence?.backend !== 'postgres' || result.exists !== true
          || result.operations?.schema_status !== 'ready' || result.runtime_backend?.supported === false
          || result.runtime_backend_adoption_plan?.action !== 'noop') fail('POSTGRES_RUNTIME_NOT_READY');
    } else if (result.ok !== true) fail(`STAGE_${stage.toUpperCase().replaceAll('-', '_')}_REFUSED`);
    return result;
  }
  const preview = cli([...args, '--dry-run'], 'bootstrap-preview');
  if (!preview.installation_plan?.plan_id) fail('BOOTSTRAP_PLAN_MISSING');
  cli([...args, '--expect-plan', preview.installation_plan.plan_id], 'bootstrap-apply');
  const diagnostic = cli(['bootstrap', '--target', plan.target, '--diagnose'], 'diagnose');
  if (diagnostic.activation?.active !== true || diagnostic.capabilities?.installation?.missing?.length !== 0) fail('INSTALLATION_INCOMPLETE');
  if (postgres) cli(['runtime', 'persistence-status', '--target', plan.target], 'persistence-status');
  log(`AIDN ${plan.version} installed. Native Codex project/hook approval and execution remain unverified.`);
  return { ok: true, version: plan.version, native: 'unverified' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const plan = createSetupPlan(parseArguments(process.argv.slice(2)));
    console.log(`Target: ${plan.target}\nPackage version: ${plan.version}\nPackage source: ${plan.releaseVersion ? releasePackagePlan(plan.releaseVersion).packageUrl : plan.packagePath}\nPackage SHA256: ${plan.packageSha256 || 'verified from published manifest during apply'}\nPostgreSQL mode: ${plan.postgresMode}`);
    console.log(`Stages: ${plan.stages.join(' -> ')}`);
    if (plan.postgresMode !== 'none') console.log(`Runtime reference: env:${plan.connectionEnv}`);
    if (plan.postgresMode === 'install') console.log(`Host package: PostgreSQL.PostgreSQL.17 ${plan.postgresVersion}; interactive installation requires Windows approval.`);
    if (plan.write) await applySetup(plan);
    else console.log('PREVIEW: no download, database connection, installation or write. Add -Write to the PowerShell command to apply.');
  } catch (error) {
    console.error(`Setup stopped: ${/^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'INVALID_INPUT_OR_LOCAL_IO'}. Earlier applied stages are retained; no automatic database/server rollback.`);
    process.exitCode = 1;
  }
}
