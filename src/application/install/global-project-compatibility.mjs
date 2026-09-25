import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveActivationTarget, inspectPreparedProject } from './project-activation-service.mjs';
import { readInstallationContext } from './codex-assets-service.mjs';
import { validateAidnProjectConfig } from '../../lib/config/aidn-config-lib.mjs';
import { planRuntimeBackendAdoption } from '../runtime/runtime-backend-adoption-service.mjs';
import { inspectWorkflowDbSchema, getLatestWorkflowSchemaVersion } from '../../lib/sqlite/workflow-db-schema-lib.mjs';
import { checkedHostPath, GLOBAL_INTEGRATION_REVISION } from './global-runtime-store.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error(code); };

// Runs from the candidate package before activation. No installation planner is
// involved: a normal global update must not propose rewriting client assets.
export async function inspectGlobalProjectCompatibility({ targetRoot, candidateIntegrationRevision = GLOBAL_INTEGRATION_REVISION, globalRecoveryPlanId }, {
  postgresPlan = planRuntimeBackendAdoption,
} = {}) {
  const root = fs.realpathSync(checkedHostPath(path.resolve(targetRoot)));
  const read = name => fs.readFileSync(checkedHostPath(path.join(root, name)), 'utf8');
  const identity = resolveActivationTarget({ targetRoot: root });
  if (identity.target_root !== root) fail('GLOBAL_PROJECT_ROOT_REQUIRED');
  if (fs.existsSync(checkedHostPath(path.join(root, '.aidn/install/pending.json')))) fail('GLOBAL_PROJECT_INTERRUPTED');
  const configRaw = read('.aidn/config.json');
  const config = validateAidnProjectConfig(JSON.parse(configRaw));
  const adapterRaw = read('.aidn/project/workflow.adapter.json');
  const adapter = JSON.parse(adapterRaw);
  if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter)) fail('GLOBAL_PROJECT_ADAPTER_INVALID');
  const { receipt } = readInstallationContext({ targetRoot: root });
  if (!receipt?.installation) fail('GLOBAL_PROJECT_RECEIPT_REQUIRED');
  const preparation = inspectPreparedProject({ targetRoot: root, globalRecoveryPlanId });
  const activation = { authorization: preparation.authorization,
    state: preparation.authorization?.status === 'revoked' ? 'revoked' : receipt.activation ? 'active' : 'legacy-active' };
  // Revocation is intentional. Still validate preparation by reading assets and
  // persistence, without calling authorize or manufacturing workflow context.
  if (receipt.global_runtime && receipt.global_runtime.integration_revision !== candidateIntegrationRevision) fail('GLOBAL_PROJECT_INTEGRATION_MIGRATION_REQUIRED');
  const backend = config.runtime?.persistence?.backend ?? 'sqlite';
  let persistence;
  if (backend === 'postgres') {
    const result = await postgresPlan({ targetRoot: root, backend, connectionRef: config.runtime.persistence.connectionRef,
      configData: config, ignoreSourceDriftWhenTargetReady: true });
    if (result.blocked !== false || result.action !== 'noop') fail('GLOBAL_PROJECT_DATABASE_MIGRATION_REQUIRED');
    persistence = { backend, compatible: true };
  } else if (config.runtime?.stateMode !== 'files' || ['sqlite', 'dual-sqlite', 'all'].includes(config.install?.artifactImportStore)) {
    const status = inspectWorkflowDbSchema({ sqliteFile: path.join(root, '.aidn/runtime/index/workflow-index.sqlite'), readOnly: true });
    if (!status.exists || status.pending_ids.length || Number(status.schema_version) !== getLatestWorkflowSchemaVersion()) fail('GLOBAL_PROJECT_DATABASE_MIGRATION_REQUIRED');
    persistence = { backend, schema_version: Number(status.schema_version), compatible: true };
  } else persistence = { backend: 'files', compatible: true };
  // Recheck observed metadata after the possibly slow backend probe. Return only
  // a digest, not receipt preimages or connection credentials.
  if (read('.aidn/config.json') !== configRaw || read('.aidn/project/workflow.adapter.json') !== adapterRaw
      || JSON.stringify(readInstallationContext({ targetRoot: root }).receipt) !== JSON.stringify(receipt)) fail('GLOBAL_PROJECT_CHANGED');
  return { compatible: true, activation: activation.state, persistence,
    integration_revision: receipt.global_runtime?.integration_revision ?? null,
    fingerprint: digest(JSON.stringify([configRaw, adapterRaw, receipt, activation.authorization, persistence])) };
}
