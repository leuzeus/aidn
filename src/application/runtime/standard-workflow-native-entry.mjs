import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';
import { createOperationJournalSigner } from '../../core/workflow/process-operation-journal.mjs';
import { assertNativeOwnerDispositionPlan } from '../../core/workflow/native-owner-disposition.mjs';
import { assertNativeReconciliationPreparation, nativeReconciliationId } from '../../core/workflow/native-allocation-reconciliation-record.mjs';
import { assertNativeEpochRequest } from '../../core/workflow/native-authorization-epoch.mjs';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import actionSchema from '../../core/contracts/workflow-definition/standard-workflow-native-action.v1.schema.json' with { type: 'json' };
import resultSchema from '../../core/contracts/workflow-definition/standard-workflow-native-result.v1.schema.json' with { type: 'json' };
import actionSchemaV2 from '../../core/contracts/workflow-definition/standard-workflow-native-action.v2.schema.json' with { type: 'json' };
import resultSchemaV2 from '../../core/contracts/workflow-definition/standard-workflow-native-result.v2.schema.json' with { type: 'json' };

const fail = code => { throw Object.assign(Error(code), { code }); };
export const isStandardNativeEntryAction = action => [actionSchema, actionSchemaV2].some(schema => action?.contract_version === schema['x-aidn-contract-version']);
export const isStandardNativeEntryKind = kind => actionSchema.properties.kind.enum.includes(kind);
export const standardNativeEntryActionVersion = actionSchema['x-aidn-contract-version'];
export const standardNativeEntryActionSchema = action => action?.contract_version === actionSchemaV2['x-aidn-contract-version'] ? actionSchemaV2 : actionSchema;
export const standardNativeEntryActionVersionFor = next => next?.profile === 'admitted_post_assignment'
  ? actionSchemaV2['x-aidn-contract-version'] : standardNativeEntryActionVersion;

// Fixed composition capabilities only. Authored actions supply exact data,
// never an operator, source verifier, process observer or writer.
export function standardNativeEntryOperatorSources(authority, readPermit) {
  function local(authorize, verify) {
    if (typeof authority[authorize] !== 'function' || typeof authority[verify] !== 'function') return null;
    return Object.freeze({ authorize: ({ request }) => authority[authorize](request, readPermit()),
      verify: ({ request, grant }) => authority[verify](request, grant, readPermit()),
      assertCurrent: ({ request, grant }) => { authority[verify](request, grant, readPermit()); } });
  }
  return Object.freeze({ owner: local('authorizeNativeOwnerDisposition', 'verifyNativeOwnerDisposition'),
    reconciliation: local('authorizeNativeReconciliation', 'verifyNativeReconciliation') });
}

// These three fields can change through the selected Native resource action
// before its acknowledgement. Its private producer authenticates the exact
// original or its own retained postimage. Every other context field, including
// generation, prefix, root/configuration, source/model, key and trust, stays exact.
export function standardNativeEntryContext(context) {
  const { journal_sha256, phase, consumption, ...native } = context.native;
  return { ...context, native };
}

export function prepareStandardNativeRecovery(host, state) {
  const journal = host.inspectAllocations(), latest = journal?.allocations.at(-1);
  if (!latest || latest.phase !== 'failed') fail('STANDARD_ENTRY_NATIVE_NO_ASSIGNMENT_REQUIRED');
  const retained = host.readNativeAllocationReconciliation(nativeReconciliationId(journal.journal_id, latest.generation));
  const originalHash = retained?.request.journal_sha256 ?? H(journal);
  const inventory = host.prepareReconciliationInventory({ expectedSha256: state.record.instance_sha256 });
  const dispatches = inventory.resources.filter(row => row.details?.record_kind === 'native_dispatch'
    && row.details.kind === 'allocation' && row.details.journal_id === journal.journal_id
    && row.details.native_journal_after_sha256 === originalHash && row.details.phase === 'returned');
  if (dispatches.length !== 1) fail('STANDARD_ENTRY_NATIVE_DISPATCH_AMBIGUOUS');
  const dispatchId = dispatches[0].ref.slice('native-dispatch:'.length), owner = host.readNativeOwnerDisposition(dispatchId);
  const input = { expectedSha256: state.record.instance_sha256, generation: latest.generation, dispatchId };
  // A nonzero retained minimum selects the fixed post-assignment capability.
  // That capability still authenticates the full accepted checkpoint/result
  // history and current physical subject; this counter grants no admission.
  const post = (latest.consumption?.responses_observed ?? 0) > 0;
  const profile = post ? { profile: 'admitted_post_assignment' } : {};
  if (owner?.phase !== 'confirmed') return { kind: 'native_owner_retire', ...profile,
    payload: { plan: post ? host.prepareNativePostAssignmentOwnerDisposition(input) : host.prepareNativeOwnerDisposition(input) } };
  return { kind: 'native_allocation_reconcile', ...profile, payload: {
    preparation: post ? host.prepareNativePostAssignmentAllocationReconciliation(input) : host.prepareNativeAllocationReconciliation(input), source_ref: null } };
}

export function prepareStandardNativeEpoch(host, authorization) {
  const journal = host.inspectAllocations(), latest = journal?.allocations.at(-1), epoch = journal?.epochs?.at(-1);
  const original = journal?.initial_authorization ?? (latest
    ? { approved: true, model_allowed: true, ...journal.allocations[0].limits } : authorization);
  const current = epoch?.grant.authorization ?? original, consumption = host.previewNative().consumption;
  const reconciliation = journal?.reconciliations?.at(-1);
  const newEpochRequired = reconciliation && !(epoch?.start_generation > reconciliation.request.generation);
  const expired = current && Date.now() >= Math.min(current.global_deadline_ms, current.workflow_deadline_ms);
  const exhausted = current && consumption.known && (consumption.responses >= current.max_responses || current.max_bytes - consumption.bytes < 1048576);
  if (!newEpochRequired && !expired && !exhausted) return null;
  return { kind: 'native_authorization_epoch', payload: { request: host.prepareNativeAuthorizationEpoch({ originalAuthorization: original }), source_ref: null } };
}

export function assertStandardNativeEntryAction(action, state, authority) {
  if (validateJsonSchema(action, standardNativeEntryActionSchema(action), '$', { contractKind: 'workflow-definition' }).length || !state)
    fail('STANDARD_ENTRY_NATIVE_ACTION_INVALID');
  const payload = action.payload, kind = action.kind;
  const keys = kind === 'native_owner_retire' ? ['plan'] : kind === 'native_allocation_reconcile' ? ['preparation', 'source_ref'] : ['request', 'source_ref'];
  if (Object.keys(payload).sort().join(',') !== keys.sort().join(',')) fail('STANDARD_ENTRY_NATIVE_ACTION_INVALID');
  const subject = kind === 'native_owner_retire' ? assertNativeOwnerDispositionPlan(payload.plan)
    : kind === 'native_allocation_reconcile' ? assertNativeReconciliationPreparation(payload.preparation).request : assertNativeEpochRequest(payload.request);
  const signer = createOperationJournalSigner(() => authority.readKey()); signer.verify(subject);
  if (payload.preparation) signer.verify(payload.preparation.inventory);
  const context = action.context;
  if (subject.key_id !== context.key_id || subject.instance_id !== state.record.instance_id || subject.instance_sha256 !== context.instance_sha256
    || subject.scope_id !== state.record.scope_id || subject.model_sha256 !== state.record.model_sha256
    || subject.configuration_sha256 !== context.configuration_sha256) fail('STANDARD_ENTRY_NATIVE_SUBJECT_CHANGED');
  if (kind === 'native_authorization_epoch') {
    if (subject.journal_sha256 !== (context.native.journal_sha256 ?? H(null)) || subject.next_generation !== context.native.generation + 1)
      fail('STANDARD_ENTRY_NATIVE_SUBJECT_CHANGED');
  } else if (subject.journal_sha256 !== context.native.journal_sha256 || subject.generation !== context.native.generation)
    fail('STANDARD_ENTRY_NATIVE_SUBJECT_CHANGED');
  return subject;
}

export function standardNativeEntryRequirements(action, sources) {
  const requirements = [];
  if (action.kind === 'native_owner_retire' && !sources.owner || action.kind === 'native_allocation_reconcile' && !sources.reconciliation)
    requirements.push('EXPLICIT_NATIVE_LOCAL_OPERATOR_REQUIRED');
  if (action.kind !== 'native_owner_retire' && action.payload.source_ref === null) requirements.push('AUTHENTICATED_NATIVE_RESOURCE_SOURCE_REQUIRED');
  return requirements;
}

export async function applyStandardNativeEntryAction(host, action, signal) {
  const p = action.payload;
  if (action.kind === 'native_owner_retire') return host.applyNativeOwnerDisposition(p.plan, { write: true, expectedPlanSha256: H(p.plan), signal });
  if (action.kind === 'native_allocation_reconcile') return host.applyNativeAllocationReconciliation(p.preparation,
    { write: true, expectedRequestSha256: H(p.preparation.request), sourceRef: p.source_ref, signal });
  // Retained activation is a read. It must not materialize a historical journal
  // on acknowledgement or recapture consent, budgets, closure or a worker.
  const retained = await host.activateNativeAuthorizationEpoch(p.request, { write: false });
  if (retained.status === 'retained') return retained;
  if (signal?.aborted) fail('STANDARD_ENTRY_ABORTED');
  return host.activateNativeAuthorizationEpoch(p.request, { write: true, sourceRef: p.source_ref });
}

export function standardNativeEntryResult(host, action, details) {
  const state = host.inspectDiagnostic();
  const post = action.contract_version === actionSchemaV2['x-aidn-contract-version'], schema = post ? resultSchemaV2 : resultSchema;
  const result = { contract_version: schema['x-aidn-contract-version'], ...(post ? { profile: 'admitted_post_assignment' } : {}), action_kind: action.kind,
    process_status: state.cursor.status, workflow_completed: false, operation_outcome: null,
    effect_status: details.written === true ? 'confirmed' : 'no_effect', written: details.written === true, native_started: false, details };
  if (validateJsonSchema(result, schema, '$', { contractKind: 'workflow-definition' }).length) fail('STANDARD_ENTRY_NATIVE_RESULT_INVALID');
  return result;
}
