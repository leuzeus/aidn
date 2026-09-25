import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { readProjects } from './project-registry.mjs';
import { compareVersions } from './installed-project.mjs';
import { downloadBytes, downloadReleasePackage, resolveReleaseVersion, releasePackagePlan, verifyReleaseMetadata } from './github-release-package.mjs';
import { prepareGlobalPackage, globalCodexAssets } from './global-package.mjs';
import { preflightGlobalProjects } from './global-project-preflight.mjs';
import { readGlobalState, verifyRuntimeGeneration, verifyGlobalAssets, planGlobalSwitch, applyGlobalSwitch, resumeGlobalSwitch, checkedHostPath } from '../../src/application/install/global-runtime-store.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error(code); };
const fingerprint = value => hash(JSON.stringify(value));
const sourceRoot = path.resolve(import.meta.dirname, '../..');

export async function planGlobalUpdate(options, dependencies = {}) {
  const { home, rollback = false, packagePath, packageSha256 } = options;
  checkedHostPath(home);
  const state = readGlobalState(home);
  if (state) { verifyRuntimeGeneration(home, state.active); verifyGlobalAssets(state); }
  const registry = readProjects(home);
  let artifact, version, previous;
  if (rollback) {
    if (!state?.previous) fail('GLOBAL_NO_PREVIOUS_VERSION');
    previous = verifyRuntimeGeneration(home, state.previous);
    version = state.previous.version;
    artifact = { kind: 'previous', pointer: state.previous };
  } else if (packagePath) {
    if (!/^[a-f0-9]{64}$/i.test(packageSha256 ?? '') || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(options.release ?? '')) fail('GLOBAL_PINNED_LOCAL_PACKAGE_REQUIRED');
    const file = checkedHostPath(path.resolve(packagePath));
    if (hash(fs.readFileSync(file)) !== packageSha256.toLowerCase()) fail('GLOBAL_TARBALL_HASH_MISMATCH');
    artifact = { kind: 'local', packagePath: file, packageSha256: packageSha256.toLowerCase() };
    version = options.release;
  } else {
    const read = dependencies.read ?? downloadBytes;
    version = await resolveReleaseVersion(options.release ?? 'latest', { read });
    const release = releasePackagePlan(version);
    const metadata = JSON.parse((await read(release.apiUrl, 2 * 1024 * 1024)).toString('utf8'));
    const manifest = JSON.parse((await read(release.manifestUrl, 2 * 1024 * 1024)).toString('utf8'));
    const checksums = (await read(release.checksumsUrl, 16384)).toString('utf8');
    const verified = verifyReleaseMetadata(release, metadata, manifest, checksums);
    artifact = { kind: 'release', packageSha256: verified.sha256, releaseCommit: manifest.git_commit, version };
  }
  const probeRoot = previous?.packageRoot ?? (state ? verifyRuntimeGeneration(home, state.active).packageRoot : sourceRoot);
  const preflight = (dependencies.preflight ?? preflightGlobalProjects)({ home, candidateRoot: probeRoot });
  const order = state ? compareVersions(version, state.active.version) : 1;
  const status = !preflight.compatible ? 'blocked' : !rollback && order < 0 ? 'local-newer'
    : !rollback && order === 0 ? 'up-to-date' : state ? rollback ? 'rollback-proposed' : 'update-available' : 'installation-proposed';
  const userHome = checkedHostPath(options.userHome ?? os.homedir());
  const codexHome = checkedHostPath(options.codexHome ?? process.env.CODEX_HOME ?? path.join(userHome, '.codex'));
  const content = { schema_version: 1, action: rollback ? 'rollback' : 'update', home, userHome, codexHome,
    state_fingerprint: fingerprint(state), registry_fingerprint: fingerprint(registry),
    version, artifact, projects: preflight.projects, status };
  return { ...content, plan_id: fingerprint(content), written: false };
}

export async function executeGlobalUpdate(options, dependencies = {}) {
  const plan = await planGlobalUpdate(options, dependencies);
  if (!options.write) return plan;
  if (!options.expectedPlanId || options.expectedPlanId !== plan.plan_id) fail('GLOBAL_PLAN_MISMATCH');
  if (plan.status === 'blocked') fail('GLOBAL_PROJECT_INCOMPATIBLE');
  if (plan.status === 'local-newer') fail('GLOBAL_DOWNGRADE_REFUSED');
  if (plan.status === 'up-to-date') return plan;
  let prepared;
  if (options.rollback) {
    const generation = verifyRuntimeGeneration(options.home, plan.artifact.pointer);
    prepared = { packageRoot: generation.packageRoot, pointer: plan.artifact.pointer };
  } else {
    const artifact = plan.artifact.kind === 'local' ? plan.artifact
      : await (dependencies.download ?? downloadReleasePackage)(plan.version, { cacheRoot: path.join(options.home, 'packages') });
    if (artifact.packageSha256 !== plan.artifact.packageSha256
        || plan.artifact.releaseCommit && artifact.releaseCommit !== plan.artifact.releaseCommit) fail('GLOBAL_RELEASE_CHANGED');
    prepared = (dependencies.prepare ?? prepareGlobalPackage)({ home: options.home, artifact, version: plan.version }, dependencies);
  }
  const check = () => {
    if (fingerprint(readProjects(options.home)) !== plan.registry_fingerprint) fail('GLOBAL_REGISTRY_CHANGED');
    const result = (dependencies.preflight ?? preflightGlobalProjects)({ home: options.home, candidateRoot: prepared.packageRoot });
    if (!result.compatible) fail('GLOBAL_PROJECT_INCOMPATIBLE');
    // Observed project metadata must not change during download/preparation.
    if (JSON.stringify(result.projects) !== JSON.stringify(plan.projects)) fail('GLOBAL_PROJECTS_CHANGED');
    return result.projects;
  };
  const projects = check();
  if (fingerprint(readGlobalState(options.home)) !== plan.state_fingerprint) fail('GLOBAL_STATE_CHANGED');
  const assets = (dependencies.assets ?? globalCodexAssets)({ home: options.home, packageRoot: prepared.packageRoot,
    userHome: plan.userHome, codexHome: plan.codexHome });
  const switchPlan = planGlobalSwitch({ home: options.home, candidate: prepared.pointer, assets, projects, rollback: options.rollback });
  const state = applyGlobalSwitch({ home: options.home, plan: switchPlan, expectedPlanId: switchPlan.plan_id, recheckProjects: check, waitForOperationsMs: 30000 });
  return { ...plan, status: 'complete', written: true, version: state.active.version, installation_id: state.installation_id };
}

export function resumeGlobalUpdate({ home, expectedPlanId, write = false }, dependencies = {}) {
  const file = checkedHostPath(path.join(home, 'pending.json'));
  const transaction = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { packageRoot } = verifyRuntimeGeneration(home, transaction.candidate);
  if (!write) return { status: 'interrupted', written: false, plan_id: transaction.plan_id, version: transaction.candidate.version };
  const state = resumeGlobalSwitch({ home, expectedPlanId, recheckProjects: () => {
    const result = (dependencies.preflight ?? preflightGlobalProjects)({ home, candidateRoot: packageRoot, globalRecoveryPlanId: expectedPlanId });
    if (!result.compatible) fail('GLOBAL_PROJECT_INCOMPATIBLE');
    return result.projects;
  } });
  return { status: 'complete', written: true, version: state.active.version, plan_id: expectedPlanId };
}
