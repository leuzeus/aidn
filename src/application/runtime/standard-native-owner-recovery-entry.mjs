import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { shadowHash as H, checkShadowJson } from '../../core/workflow/shadow-json.mjs';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import requestSchema from '../../core/contracts/workflow-definition/standard-native-owner-recovery.v1.schema.json' with { type: 'json' };
import actionSchema from '../../core/contracts/workflow-definition/standard-native-owner-recovery-action.v1.schema.json' with { type: 'json' };
import { createOperationJournalSigner } from '../../core/workflow/process-operation-journal.mjs';
import { createStandardHostAuthority } from '../../adapters/runtime/standard-host-authority.mjs';
import { createAgenticProcessStore } from '../../adapters/runtime/agentic-process-store.mjs';
import { createProcessOperationJournalStore } from '../../adapters/runtime/process-operation-journal-store.mjs';
import { readWorkflowProjectAuthority } from './workflow-instance-composition.mjs';
import { readAgentRunFile, agentRunPhysicalPath } from './agent-run-configuration-service.mjs';
import { readAgenticProductSnapshot } from './agentic-process-execution-composition.mjs';
import { createStandardProcessAuthority } from './standard-process-authority.mjs';
import { createStandardWorkflowOperationHost } from './standard-workflow-operation-host.mjs';
import { standardNativeEntryOperatorSources } from './standard-workflow-native-entry.mjs';
import { assertStandardWorkflowImplementation, standardWorkflowOperationBindings } from './standard-workflow-operations.mjs';

const fail = code => { throw Object.assign(Error(code), { code }); };
function assertShape(value, schema) {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length)
    fail('STANDARD_NATIVE_OWNER_RECOVERY_CONTRACT_INVALID');
}
const sources = ['./standard-native-owner-recovery-entry.mjs', './workflow-run-service.mjs',
  '../../core/contracts/workflow-definition/standard-native-owner-recovery.v1.schema.json',
  '../../core/contracts/workflow-definition/standard-native-owner-recovery-action.v1.schema.json'];
function implementation() {
  assertStandardWorkflowImplementation();
  return H({ standard: standardWorkflowOperationBindings()[0].implementation_sha256,
    recovery: sources.map(source => [source, createHash('sha256').update(fs.readFileSync(new URL(source, import.meta.url))).digest('hex')]) });
}

// This entry exposes only the existing physical-owner disposition. The original
// model and source come from authenticated history, with no Native or business
// executor. New code never makes old operation bindings executable.
export async function runStandardNativeOwnerRecoveryEntry({ request, action = null, execute = false, expectPlan = null, environment = process.env },
  { onBoundary = async () => {} } = {}) {
  assertShape(request, requestSchema);
  const implementationSha = implementation();
  const targetRoot = agentRunPhysicalPath(request.target_root, { directory: true });
  const { stateMode } = readWorkflowProjectAuthority({ targetRoot });
  if (!['dual', 'db-only'].includes(stateMode)) fail('STANDARD_NATIVE_OWNER_RECOVERY_SQL_REQUIRED');
  const configurationFile = readAgentRunFile(request.original_configuration.path, { sha256: request.original_configuration.sha256, maxBytes: 1048576 });
  const configuration = configurationFile.value;
  if (configuration.target_root !== targetRoot || configuration.instance_id !== request.instance_id)
    fail('STANDARD_NATIVE_OWNER_RECOVERY_CONFIGURATION_CHANGED');
  const authority = createStandardHostAuthority({ configuration, environment }, { useProvider: false });
  const signer = createOperationJournalSigner(authority.readKey), options = { targetRoot, stateMode, env: environment };
  const instance = createAgenticProcessStore(options).read(request.instance_id).record;
  if (!instance || instance.instance_sha256 !== request.instance_sha256) fail('STANDARD_NATIVE_OWNER_RECOVERY_INSTANCE_CHANGED');
  const model = readAgentRunFile(configuration.model.path, { sha256: configuration.model.sha256 }).value;
  if (H(model) !== instance.model_sha256 || H(instance.model) !== instance.model_sha256)
    fail('STANDARD_NATIVE_OWNER_RECOVERY_MODEL_CHANGED');
  const lastIntent = instance.events.findLast(row => row.kind === 'operation_intent');
  if (!lastIntent) fail('STANDARD_NATIVE_OWNER_RECOVERY_SOURCE_REQUIRED');
  const origin = createProcessOperationJournalStore(options).read(lastIntent.intent.operation_id).record;
  if (!origin) fail('STANDARD_NATIVE_OWNER_RECOVERY_SOURCE_REQUIRED');
  signer.verify(origin); signer.verify(origin.preview);
  if (origin.phase !== 'receipted' || H(origin.intent) !== H(lastIntent.intent)
    || origin.preview.snapshot.native?.configuration_sha256 !== H(configuration)) fail('STANDARD_NATIVE_OWNER_RECOVERY_SOURCE_CHANGED');
  const modelSource = origin.preview.snapshot.model_source ?? null;
  const product = () => readAgenticProductSnapshot(configuration.product_root, configuration.product_files);
  const processAuthority = createStandardProcessAuthority({ configuration, model, modelSource, readSigningKey: authority.readKey,
    environment, readProductSnapshot: product, readProductSha256: () => H(product()) });
  let permit = null;
  const ownerSource = standardNativeEntryOperatorSources(authority, () => permit).owner;
  const host = createStandardWorkflowOperationHost({ targetRoot, model, modelSource, readSigningKey: authority.readKey,
    environment, processAuthority, reconciliationConfiguration: configuration, nativeOwnerDispositionSource: ownerSource,
    authorize: async () => fail('STANDARD_NATIVE_OWNER_RECOVERY_BUSINESS_FORBIDDEN') }, {
    async nativeOwnerDispositionBoundary(name, id) {
      if (implementation() !== implementationSha) fail('STANDARD_NATIVE_OWNER_RECOVERY_IMPLEMENTATION_CHANGED');
      await onBoundary(name, id);
    },
  });
  const input = { expectedSha256: request.instance_sha256, dispatchId: request.dispatch_id, generation: request.generation };
  const observed = host.prepareNativeAllocationAssessment(request.instance_id, input);
  if (!observed.readOnlyRejectedAnswer) fail('STANDARD_NATIVE_OWNER_RECOVERY_REJECTED_READONLY_REQUIRED');
  if (!execute) {
    if (action !== null || expectPlan !== null) fail('STANDARD_NATIVE_OWNER_RECOVERY_ARGUMENT_CONFLICT');
    const plan = host.prepareNativeOwnerDisposition(request.instance_id, input);
    const preview = { contract_version: 'standard-native-owner-recovery-action.v1', request_sha256: H(request), implementation_sha256: implementationSha, plan };
    assertShape(preview, actionSchema);
    return { preview, action_sha256: H(preview), can_apply: true };
  }
  assertShape(action, actionSchema);
  if (expectPlan !== H(action) || action.request_sha256 !== H(request) || action.implementation_sha256 !== implementationSha
    || action.plan.instance_id !== request.instance_id || action.plan.instance_sha256 !== request.instance_sha256
    || action.plan.dispatch_id !== request.dispatch_id || action.plan.generation !== request.generation)
    fail('STANDARD_NATIVE_OWNER_RECOVERY_EXACT_ACTION_REQUIRED');
  signer.verify(action.plan);
  // Reobservation in the existing writer authenticates the subject and its
  // private read-only witness again before each physical retirement boundary.
  permit = { action: 'native_owner_retire', key_id: authority.keyId(), trust_sha256: authority.trustSha(),
    action_sha256: H(action), subject_sha256: H(action.plan), scope_id: action.plan.scope_id, instance_sha256: request.instance_sha256 };
  if (implementation() !== implementationSha) fail('STANDARD_NATIVE_OWNER_RECOVERY_IMPLEMENTATION_CHANGED');
  const retainedBefore = host.readNativeOwnerDisposition(request.dispatch_id);
  try {
    const result = await host.applyNativeOwnerDisposition(action.plan, { write: true, expectedPlanSha256: H(action.plan) });
    return { result };
  } catch (cause) {
    // The common CLI envelope retains uncertainty. When the separate canonical
    // disposition changed, also report that known write despite a lost return.
    try { if (H(host.readNativeOwnerDisposition(request.dispatch_id)) !== H(retainedBefore)) cause.recovery_written = true; }
    catch { /* An unavailable observer cannot establish an unchanged outcome. */ }
    throw cause;
  }
}
