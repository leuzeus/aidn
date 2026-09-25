import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { inspectProject, updateStatus } from './installed-project.mjs';
import { downloadReleasePackage } from './github-release-package.mjs';
import { rememberProject, setupHome, readProjects } from './project-registry.mjs';

const fail = code => { throw new Error(code); };
export function cleanSetupEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !/^AIDN_/i.test(key)));
}
export function setupProcess(command, args, { cwd, env, stage }) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', windowsHide: true, shell: false, timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    const allowed = new Set(['PERSISTENCE_MIGRATION_REQUIRED', 'PERSISTENCE_VERIFY_ONLY_REQUIRES_NOOP',
      'CANDIDATE_PLAN_REFUSED', 'CANDIDATE_UPDATE_PROTOCOL_UNSUPPORTED', 'CANDIDATE_VERIFICATION_FAILED',
      'UPDATE_INCOMPLETE_USE_INSTALLATION_DIAGNOSTIC', 'RECORDED_PACK_REQUIRED']);
    const detail = String(result.stderr || '').split(/\r?\n/).find(line => allowed.has(line));
    fail(detail || `${stage.toUpperCase().replaceAll('-', '_')}_FAILED`);
  }
  return result.stdout;
}
export async function updateProject({ target, version, write, fingerprint, localPackage }, {
  env = process.env, run = setupProcess, download = downloadReleasePackage, home = setupHome(env), log = console.log,
} = {}) {
  const before = inspectProject(target);
  const status = updateStatus(before, version);
  if (status === 'diagnostic-required' || status === 'install-available') fail('INSTALLED_PROJECT_REQUIRED');
  if (fingerprint && before.fingerprint !== fingerprint) fail('INSTALLED_PROJECT_CHANGED');
  if (!write || status !== 'update-available') return { ...before, version, status, written: false };
  readProjects(home); // Corruption must be diagnosed before starting an update.
  const artifact = localPackage || await download(version);
  const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (hash(artifact.packagePath) !== artifact.packageSha256.toLowerCase()) fail('TARBALL_HASH_MISMATCH');
  const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-update-candidate-'));
  const source = path.resolve(import.meta.dirname, '../..');
  const candidateWorker = path.join(source, 'tools/setup/update-candidate.mjs');
  const npmEnv = cleanSetupEnvironment(env);
  const runtimeEnv = cleanSetupEnvironment(env);
  if (before.connectionRef) {
    const key = before.connectionRef.slice(4);
    if (env[key] !== undefined) runtimeEnv[key] = env[key];
  }
  const packageArgs = [npm, 'install', '--save-dev', '--save-exact', '--ignore-scripts', '--include=optional', '--no-audit', '--no-fund', artifact.packageUrl || artifact.packagePath];
  const verifyPackage = root => {
    const installed = path.join(root, 'node_modules/aidn-workflow');
    const identity = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'));
    if (identity.name !== 'aidn-workflow' || identity.version !== version || fs.readFileSync(path.join(installed, 'VERSION'), 'utf8').trim() !== version) fail('INSTALLED_PACKAGE_IDENTITY_MISMATCH');
    const entry = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')).packages?.['node_modules/aidn-workflow'];
    const integrity = artifact.packageIntegrity || `sha512-${createHash('sha512').update(fs.readFileSync(artifact.packagePath)).digest('base64')}`;
    if (entry?.integrity !== integrity || artifact.packageUrl && entry.resolved !== artifact.packageUrl) fail('RELEASE_NPM_INTEGRITY_MISMATCH');
    return installed;
  };
  try {
    log('Stage: prepare-update-candidate');
    fs.writeFileSync(path.join(staging, 'package.json'), '{"private":true}');
    run(process.execPath, packageArgs, { cwd: staging, env: npmEnv, stage: 'candidate-install' });
    const candidate = verifyPackage(staging);
    log('Stage: verify-existing-persistence (migration is separate)');
    run(process.execPath, [candidateWorker, candidate, before.target, 'verify'], { cwd: before.target, env: runtimeEnv, stage: 'candidate-preflight' });
    if (inspectProject(before.target).fingerprint !== before.fingerprint) fail('INSTALLED_PROJECT_CHANGED');
    if (hash(artifact.packagePath) !== artifact.packageSha256.toLowerCase()) fail('TARBALL_CHANGED');
    log('Stage: update-project-package');
    run(process.execPath, packageArgs, { cwd: before.target, env: npmEnv, stage: 'package-install' });
    const installed = verifyPackage(before.target);
    run(process.execPath, [candidateWorker, installed, before.target, 'apply'], { cwd: before.target, env: runtimeEnv, stage: 'installation-apply' });
    const diagnostic = JSON.parse(run(process.execPath, [path.join(installed, 'bin/aidn.mjs'), 'bootstrap', '--target', before.target, '--diagnose', '--json'], { cwd: before.target, env: runtimeEnv, stage: 'diagnose' }));
    if (!diagnostic.ok || diagnostic.activation?.active !== true || diagnostic.capabilities?.installation?.missing?.length !== 0) fail('INSTALLATION_INCOMPLETE');
    const after = inspectProject(before.target);
    if (after.state !== 'installed' || after.recordedVersion !== version) fail('INSTALLATION_INCOMPLETE');
    rememberProject(before.target, home);
    return { ...after, status: 'updated', written: true };
  } finally {
    // This path is created exclusively by mkdtemp above, never taken from input.
    fs.rmSync(staging, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}
