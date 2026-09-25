// Internal subprocess protocol for the Windows setup; not an aidn CLI surface.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readInstallationContext } from '../../src/application/install/codex-assets-service.mjs';
const [root, target, action = 'verify'] = process.argv.slice(2);
try {
  if (!['verify', 'apply'].includes(action)) throw new Error('INVALID_CANDIDATE_ACTION');
  const config = JSON.parse(fs.readFileSync(path.join(target, '.aidn/config.json'), 'utf8'));
  const adapter = JSON.parse(fs.readFileSync(path.join(target, '.aidn/project/workflow.adapter.json'), 'utf8'));
  const saved = readInstallationContext({ targetRoot: target }).receipt?.installation?.args;
  if (!saved?.pack) throw new Error('RECORDED_PACK_REQUIRED');
  const service = await import(pathToFileURL(path.join(root, 'src/application/install/installation-service.mjs')));
  if (!service.verifyInstallationCandidate) throw new Error('CANDIDATE_UPDATE_PROTOCOL_UNSUPPORTED');
  const args = { pack: saved.pack, persistencePolicy: 'verify-only', skipArtifactImport: true,
    runtimeStateMode: config.runtime?.stateMode, artifactImportStore: config.install?.artifactImportStore,
    runtimePersistenceBackend: config.runtime?.persistence?.backend,
    runtimePersistenceConnectionRef: config.runtime?.persistence?.connectionRef,
    runtimePersistenceLocalProjectionPolicy: config.runtime?.persistence?.localProjectionPolicy,
    projectName: adapter.projectName, sourceBranch: config.workflow?.sourceBranch };
  const options = { repoRoot: root, targetRoot: target, args };
  const plan = await service.verifyInstallationCandidate(options);
  if (!plan.ok) throw new Error('CANDIDATE_PLAN_REFUSED');
  if (action === 'apply') {
    const result = await service.executeInstallation({ ...options, dryRun: false, expectedPlanId: plan.plan_id });
    if (!result.ok || result.pending) throw new Error('UPDATE_INCOMPLETE_USE_INSTALLATION_DIAGNOSTIC');
  }
  console.log(JSON.stringify({ ok: true, planId: plan.plan_id }));
} catch (error) {
  console.error(/^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'CANDIDATE_VERIFICATION_FAILED');
  process.exitCode = 1;
}
