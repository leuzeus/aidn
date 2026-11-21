import { STANDARD_ARTIFACT_MAX_BYTES, STANDARD_ARTIFACT_INVENTORY_MAX_BYTES } from './standard-workflow-artifacts.mjs';
import { randomUUID } from 'node:crypto';
import { createWorkflowRecordStore } from '../../adapters/runtime/workflow-record-store.mjs';
import { createNativeAllocationJournalStore } from '../../adapters/runtime/native-allocation-journal-store.mjs';
import { observeLocalProcess, observeLocalProcessOwner } from '../../adapters/runtime/local-process-identity.mjs';
import { assertNativeAllocationJournal, nativeJournalId, nativeJournalPath } from '../../core/workflow/native-allocation-journal.mjs';
import { assertNativeAuthorization } from '../../core/workflow/native-authorization-epoch.mjs';
import { assertNativeReconciliationRequest, assertNativeReconciliationGrant, isNativePostAssignmentReconciliation,
  nativeReconciliationPostAssignmentSubject } from '../../core/workflow/native-allocation-reconciliation.mjs';
import { assertNativePostAssignmentAssessment } from '../../core/workflow/native-post-assignment-assessment.mjs';
import { assertNativeReconciliationPreparation, assertNativeReconciliationRecord, nativeReconciliationId, nativeReconciliationPath,
  retainedNativeReconciliationReceipt } from '../../core/workflow/native-allocation-reconciliation-record.mjs';
import { assertNativeOwnerDispositionRecord } from '../../core/workflow/native-owner-disposition.mjs';
import { assertNativeDispatchRecord, nativeDispatchPath } from '../../core/workflow/native-dispatch-record.mjs';
import { shadowHash as H, checkShadowJson } from '../../core/workflow/shadow-json.mjs';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import grantV1 from '../../core/contracts/workflow-definition/process-disposition-authorization-grant.v1.schema.json' with { type: 'json' };
import grantV2 from '../../core/contracts/workflow-definition/process-disposition-authorization-grant.v2.schema.json' with { type: 'json' };
import { LOCAL_ARTIFACT_FENCE_PATH } from './local-artifact-resource-fence.mjs';
import { inspectNativeOwnerLock } from './local-native-owner-retirement.mjs';
import { readNativeAllocationCheckpoint } from './native-allocation-evidence.mjs';
import { readAgentRunFile } from './agent-run-configuration-service.mjs';
import { observeNativePostAssignmentCheckpoint } from './standard-native-post-assignment-assessment.mjs';

const fail = code => { throw Object.assign(Error(code), { code }); };
const body = ({ authentication, key_id, ...value }) => value;
const baseContext = ({ diagnostic_native_journal_sha256, ...context }) => context;
const leaseData = value => ({ record: value.record, content_sha256: value.content_sha256, previous_sha256: value.previous_sha256 });
const nativeSessions = state => state.resources.map(row => ({ kind: 'native_session',
  ...Object.fromEntries(['execution_id', 'agent_id', 'lineage_id', 'session_id', 'adapter_id'].map(key => [key, row.executor[key]])) }));
function material(inventory, q) {
  const { authentication, key_id, observed_at_ms, context_sha256, accounting, ...value } = inventory;
  const excluded = new Set(['artifact:' + nativeReconciliationPath(nativeReconciliationId(q.journal_id, q.generation)),
    'native-reconciliation:' + nativeReconciliationId(q.journal_id, q.generation), 'artifact:' + LOCAL_ARTIFACT_FENCE_PATH,
    'artifact:' + nativeJournalPath(q.journal_id), 'native:' + q.journal_id, 'native:' + q.journal_id + '/' + q.generation]);
  // The exact target journal is checked separately against the original or a
  // retained proposal. Other Native/resource rows and non-Native counts remain.
  return { ...value, accounting: { operation_attempts: accounting.operation_attempts, unknown_operations: accounting.unknown_operations },
    resources: value.resources.filter(row => !excluded.has(row.ref)) };
}

// Model only serialized upper bounds. Placeholder digests below are never
// stored or returned as evidence, receipts, signatures or authorizations.
export function assertNativeReconciliationWriteCapacity(record, rows) {
  const last = record.attempts.at(-1), proposed = last.proposal, digest = '0'.repeat(64);
  const released = { ...last.fence_intention.record, revision: last.fence_intention.record.revision + 1, state: 'released' };
  const attempts = [...record.attempts.slice(0, -1), { ...last,
    lease: { record: last.fence_intention.record, content_sha256: digest, previous_sha256: last.fence_intention.previous_sha256 },
    commit_sha256: H(proposed), released_fence: { record: released, content_sha256: digest } }];
  const final = { ...record, revision: 160, phase: 'confirmed', attempts,
    commit: record.commit ?? { proposal_sha256: H(proposed), proposal_content_sha256: digest,
      receipt_sha256: H(proposed.reconciliations.at(-1)), proposal_attempt_id: last.attempt_id } };
  const bytes = value => Buffer.byteLength(JSON.stringify(value) + '\n');
  const auditPath = nativeReconciliationPath(record.reconciliation_id), nativePath = nativeJournalPath(record.journal_id);
  const current = name => Buffer.byteLength(rows.find(row => row.path === name)?.content ?? '');
  const auditBytes = Math.max(bytes(record), bytes(final)), nativeBytes = bytes(proposed), fenceBytes = bytes(released);
  const total = rows.reduce((sum, row) => sum + Buffer.byteLength(row.content), 0)
    - current(auditPath) - current(nativePath) - current(LOCAL_ARTIFACT_FENCE_PATH) + auditBytes + nativeBytes + fenceBytes;
  if (auditBytes > STANDARD_ARTIFACT_MAX_BYTES || nativeBytes > STANDARD_ARTIFACT_MAX_BYTES
    || total > STANDARD_ARTIFACT_INVENTORY_MAX_BYTES) fail('NATIVE_RECONCILIATION_HISTORY_CAPACITY_REQUIRED');
  return { audit_max_bytes: auditBytes, native_bytes: nativeBytes, final_inventory_max_bytes: total };
}

export function createStandardNativeAllocationReconciliation({ targetRoot, stateMode, configuration, artifacts, signer,
  assess, assessPostAssignment, capture, readOwnerDisposition, operatorSource, resourceSource, now = Date.now, onBoundary = async () => {} }) {
  const nativeStore = createNativeAllocationJournalStore({ targetRoot, stateMode });
  const store = createWorkflowRecordStore({ targetRoot, stateMode, descriptor: { pathForId: nativeReconciliationPath,
    validate: assertNativeReconciliationRecord, idOf: value => value.reconciliation_id, hashOf: H, kind: 'native_allocation_journal' } });
  const fence = artifacts.resourceFence();
  function verifyRequest(q) {
    signer.verify(q);
    if (isNativePostAssignmentReconciliation(q)) {
      signer.verify(q.post_assignment_assessment); signer.verify(q.post_assignment_assessment.base_assessment);
    }
  }
  function verifyJournal(journal) {
    assertNativeAllocationJournal(journal); signer.verify(journal);
    if (journal.origin_journal) verifyJournal(journal.origin_journal);
    for (const receipt of journal.reconciliations ?? []) { signer.verify(receipt); verifyRequest(receipt.request); }
  }
  const readNative = id => { const found = nativeStore.read(id); if (found.record) verifyJournal(found.record); return found; };
  const read = id => {
    const found = store.read(id);
    if (found.record) {
      const r = found.record; signer.verify(r); verifyRequest(r.request); signer.verify(r.inventory); verifyJournal(r.original_journal);
      for (const row of r.attempts) verifyJournal(row.proposal);
    }
    return found;
  };
  const save = (previous, fields, assertCurrent) => {
    if (typeof assertCurrent !== 'function') fail('NATIVE_RECONCILIATION_AUTHORITY_REQUIRED');
    const record = signer.seal({ ...(previous.record ? body(previous.record) : {}), ...fields, revision: (previous.record?.revision ?? 0) + 1 });
    assertNativeReconciliationRecord(record);
    assertNativeReconciliationWriteCapacity(record, artifacts.observeInventory().rows);
    assertCurrent();
    const result = store.compareAndSwap(record, previous.content_sha256);
    if (result.projection === 'pending') store.materialize(record.reconciliation_id, { write: true });
    const after = read(record.reconciliation_id); if (H(after.record) !== H(record)) fail('NATIVE_RECONCILIATION_RECORD_CHANGED');
    return after;
  };
  function originalAuthorization(original) {
    const authorization = original.initial_authorization ?? { approved: true, model_allowed: true, ...original.allocations[0].limits };
    assertNativeAuthorization(authorization);
    if (!original.initial_authorization && H(authorization) !== original.allocations[0].authorization_sha256)
      fail('NATIVE_RECONCILIATION_ORIGINAL_AUTHORIZATION_REQUIRED');
    return structuredClone(authorization);
  }
  function retiredOwner(q, original, fresh) {
    const post = isNativePostAssignmentReconciliation(q);
    const owner = assertNativeOwnerDispositionRecord(readOwnerDisposition(q.dispatch_id));
    signer.verify(owner); signer.verify(owner.plan); if (owner.receipt) signer.verify(owner.receipt);
    if (owner.phase !== 'confirmed' || H(owner.receipt) !== q.owner_retirement_receipt_sha256
      || owner.plan.journal_sha256 !== q.journal_sha256 || owner.plan.allocation_sha256 !== q.allocation_sha256
      || owner.plan.instance_sha256 !== q.instance_sha256 || owner.plan.physical_root_sha256 !== q.physical_root_sha256
      || owner.plan.configuration_sha256 !== q.configuration_sha256
      || post && (owner.plan.contract_version !== 'native-owner-disposition-plan.v2'
        || owner.plan.post_assignment_sha256 !== q.post_assignment_sha256 || owner.plan.initial_instance_sha256 !== q.initial_instance_sha256
        || owner.plan.checkpoint_sha256 !== q.checkpoint_sha256 || owner.plan.checkpoint_state_sha256 !== q.checkpoint_state_sha256
        || owner.plan.checkpoint_instance_sha256 !== q.checkpoint_instance_sha256)) fail('NATIVE_RECONCILIATION_OWNER_RETIREMENT_REQUIRED');
    const dispatch = assertNativeDispatchRecord(JSON.parse(artifacts.read(nativeDispatchPath(q.dispatch_id), { required: true }).content));
    signer.verify(dispatch);
    if (H(dispatch) !== q.dispatch_sha256 || dispatch.journal_id !== q.journal_id || dispatch.phase !== 'returned'
      || dispatch.native_journal_after_sha256 !== H(original) || dispatch.leases.length !== 1
      || observeLocalProcessOwner(dispatch.process_identity) !== 'terminated') fail('NATIVE_RECONCILIATION_ORIGINAL_OWNER_CHANGED');
    const lease = dispatch.leases[0], intention = dispatch.local_owner_intentions.find(row => H(row.owner) === H(lease.owner));
    const lock = inspectNativeOwnerLock({ targetRoot: artifacts.root, dispatchId: q.dispatch_id, intention, lease, allowRetired: true });
    if (!lock.retired || lock.sha256 !== owner.plan.lock_sha256 || H(lease) !== owner.plan.original_lease_sha256)
      fail('NATIVE_RECONCILIATION_OWNER_RETIREMENT_REQUIRED');
    const entry = original.allocations.at(-1), data = readNativeAllocationCheckpoint(entry, configuration, { scopeId: original.scope_id, modelSha256: original.model_sha256 });
    const closure = readAgentRunFile(entry.closure_ref.path, { maxBytes: 262144 });
    if (entry.phase !== 'failed' || !entry.tree_closed || H(entry) !== q.allocation_sha256
      || entry.checkpoint.sha256 !== q.checkpoint_sha256 || entry.checkpoint.state_sha256 !== q.checkpoint_state_sha256
      || closure.sha256 !== q.closure_sha256 || !data.state.parent_closed
      || !post && (data.responses_observed !== 0 || data.state.resources.length || data.state.results.length)
      || !post && data.state.instance.instance_sha256 !== q.instance_sha256
      || !post && q.instance_sha256 !== entry.initial_instance_sha256 || closure.value.process_tree?.termination_state !== 'confirmed'
      || closure.value.process_tree?.termination_proof?.active_processes !== 0
      || closure.value.authorized_at_ms !== entry.limits.authorized_at_ms || closure.value.global_deadline_ms !== entry.limits.global_deadline_ms
      || dispatch.result_sha256 !== H({ contract_version: 'journaled-native-allocation-result.v1', owned_result: closure.value,
        journal_id: q.journal_id, generation: q.generation, journal_phase: 'failed', journal_sha256: H(original),
        status: 'FAILED', first_failure: entry.first_failure, retry: false })) fail(post ? 'NATIVE_RECONCILIATION_POST_ASSIGNMENT_CHANGED' : 'NATIVE_RECONCILIATION_NO_ASSIGNMENT_REQUIRED');
    if (post) {
      const work = observeNativePostAssignmentCheckpoint({ journal: original, entry, current: fresh.instance, configuration });
      if (data.responses_observed < 1 || entry.initial_instance_sha256 !== q.initial_instance_sha256
        || data.state.instance.instance_sha256 !== q.checkpoint_instance_sha256
        || H(data.state.resources) !== q.checkpoint_resources_sha256 || data.state.resources.length !== q.checkpoint_resource_count
        || H(nativeSessions(data.state)) !== H(q.resources.filter(row => row.kind === 'native_session'))
        || H(entry.consumption) !== H(q.minimum_consumption) || H(work) !== H(q.post_assignment_assessment.checkpoint_work))
        fail('NATIVE_RECONCILIATION_POST_ASSIGNMENT_CHANGED');
    }
    return owner.attempts.at(-1).released_fence;
  }
  function expectedFence(retired, retained) {
    const current = fence.read();
    if (current.content_sha256 === retired.content_sha256 && H(current.record) === H(retired.record)) return current;
    for (const row of retained?.attempts ?? []) {
      if (H(current.record) === H(row.fence_intention.record)
        || row.lease && H(current.record) === H({ ...row.lease.record, state: 'released', revision: row.lease.record.revision + 1 })) return current;
    }
    fail('NATIVE_RECONCILIATION_FENCE_CHANGED');
  }
  function observe(preparation, retained) {
    const { request: q, inventory } = assertNativeReconciliationPreparation(preparation);
    verifyRequest(q); signer.verify(inventory);
    if (configuration === null || H(configuration) !== q.configuration_sha256 || q.physical_root_sha256 !== H(artifacts.root))
      fail('NATIVE_RECONCILIATION_AUTHORITY_REQUIRED');
    const native = readNative(q.journal_id), original = retained?.original_journal ?? native.record;
    if (!original || H(original) !== q.journal_sha256 || original.allocations.length !== q.generation
      || original.journal_id !== nativeJournalId({ instance_id: q.instance_id, scope_id: q.scope_id })) fail('NATIVE_RECONCILIATION_SUBJECT_CHANGED');
    if (native.content_sha256 !== (retained?.original_content_sha256 ?? native.content_sha256)
      && !(retained?.attempts.some(row => H(row.proposal) === H(native.record)))) fail('NATIVE_RECONCILIATION_JOURNAL_CHANGED');
    if (!retained && H(native.record) !== q.journal_sha256) fail('NATIVE_RECONCILIATION_JOURNAL_CHANGED');
    const fresh = capture(q.instance_id, q.instance_sha256); signer.verify(fresh.inventory);
    if (fresh.context.diagnostic_native_journal_sha256 !== H(native.record) || H(fresh.context) !== fresh.inventory.context_sha256
      || ['instance_id', 'instance_sha256', 'scope_id', 'model_sha256', 'configuration_sha256', 'physical_root_sha256'].some(key => fresh.inventory[key] !== q[key])
      || H(material(fresh.inventory, q)) !== H(material(inventory, q))
      || (retained ? H(baseContext(fresh.context)) !== retained.base_context_sha256 : fresh.inventory.context_sha256 !== inventory.context_sha256))
      fail('NATIVE_RECONCILIATION_CURRENT_CONTEXT_CHANGED');
    const after = readNative(q.journal_id); if (after.content_sha256 !== native.content_sha256) fail('NATIVE_RECONCILIATION_JOURNAL_CHANGED');
    const retired = retiredOwner(q, original, fresh);
    return { native, original, fresh, retired, currentFence: expectedFence(retired, retained), initial_authorization: originalAuthorization(original) };
  }
  async function invoke(source, method, input, signal) {
    if (typeof source?.[method] !== 'function' || signal?.aborted) fail('NATIVE_RECONCILIATION_SOURCE_REQUIRED');
    const controller = new AbortController(), combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let timer, abort;
    const stopped = new Promise((_, reject) => { abort = () => reject(Object.assign(Error('NATIVE_RECONCILIATION_ABORTED'), { code: 'NATIVE_RECONCILIATION_ABORTED' })); combined.addEventListener('abort', abort, { once: true }); });
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { reject(Object.assign(Error('NATIVE_RECONCILIATION_SOURCE_TIMEOUT'), { code: 'NATIVE_RECONCILIATION_SOURCE_TIMEOUT' })); controller.abort(); }, 5000); });
    try { return await Promise.race([Promise.resolve().then(() => source[method]({ ...structuredClone(input), signal: combined })), stopped, timeout]); }
    finally { clearTimeout(timer); combined.removeEventListener('abort', abort); controller.abort(); }
  }
  const boundary = async (name, id) => { if (await onBoundary(name, id) !== undefined) fail('NATIVE_RECONCILIATION_BOUNDARY_INVALID'); };
  function freshOperator(grant, q) {
    const legacy = grant?.contract_version === 'process-disposition-authorization-grant.v1';
    if (checkShadowJson(grant) || validateJsonSchema(grant, legacy ? grantV1 : grantV2, '$', { contractKind: 'workflow-definition' }).length
      || grant.request_sha256 !== H(q) || grant.observed_at_ms > now() || legacy && grant.expires_at_ms <= now()) fail('NATIVE_RECONCILIATION_OPERATOR_REQUIRED');
  }
  function prepare(instanceId, input, post = false) {
      if (checkShadowJson(input) || !input || Object.keys(input).sort().join(',') !== 'dispatchId,expectedSha256,generation'
        || !/^[a-f0-9]{64}$/.test(input.expectedSha256 ?? '')) fail('NATIVE_RECONCILIATION_INPUT_INVALID');
      nativeDispatchPath(input.dispatchId);
      const currentSubject = capture(instanceId, input.expectedSha256);
      const retained = read(nativeReconciliationId(nativeJournalId(currentSubject.instance), input.generation));
      if (retained.record) {
        if (retained.record.request.dispatch_id !== input.dispatchId || retained.record.request.instance_sha256 !== input.expectedSha256
          || post !== isNativePostAssignmentReconciliation(retained.record.request))
          fail('NATIVE_RECONCILIATION_REQUEST_CHANGED');
        const prepared = { request: retained.record.request, inventory: retained.record.inventory };
        observe(prepared, retained.record); return structuredClone(prepared);
      }
      if (post && typeof assessPostAssignment !== 'function') fail('NATIVE_RECONCILIATION_AUTHORITY_REQUIRED');
      const observed = post ? assessPostAssignment(instanceId, input) : assess(instanceId, input);
      const postAssessment = post ? assertNativePostAssignmentAssessment(observed.assessment, observed.inventory) : null;
      if (post) { signer.verify(postAssessment); signer.verify(postAssessment.base_assessment); signer.verify(observed.inventory); }
      const a = post ? postAssessment.base_assessment : observed.assessment;
      if ((!post && a.assignment_status !== 'no_assignment') || a.allocation_phase !== 'failed' || a.return_binding !== 'matched'
        || post && postAssessment.evidence_profile !== 'admitted_closed_checkpoint')
        fail(post ? 'NATIVE_RECONCILIATION_POST_ASSIGNMENT_REQUIRED' : 'NATIVE_RECONCILIATION_NO_ASSIGNMENT_REQUIRED');
      const owner = assertNativeOwnerDispositionRecord(readOwnerDisposition(a.dispatch_id));
      if (owner.phase !== 'confirmed') fail('NATIVE_RECONCILIATION_OWNER_RETIREMENT_REQUIRED');
      const current = post ? { inventory: observed.inventory } : capture(instanceId, input.expectedSha256), native = readNative(a.journal_id), entry = native.record?.allocations.at(-1);
      if (H(native.record) !== a.journal_sha256 || H(entry) !== a.allocation_sha256) fail('NATIVE_RECONCILIATION_SUBJECT_CHANGED');
      if (!post && native.record.contract_version === 'native-allocation-journal.v5') fail('NATIVE_RECONCILIATION_PROFILE_VERSION_REQUIRED');
      const checkpoint = post ? readNativeAllocationCheckpoint(entry, configuration, { scopeId: native.record.scope_id, modelSha256: native.record.model_sha256 }) : null;
      const q = assertNativeReconciliationRequest(signer.seal({ contract_version: post ? 'native-allocation-reconciliation-request.v2' : 'native-allocation-reconciliation-request.v1',
        request_id: randomUUID(), profile: post ? 'admitted_post_assignment' : 'no_assignment',
        ...(post ? { post_assignment_assessment: postAssessment, post_assignment_sha256: H(nativeReconciliationPostAssignmentSubject(postAssessment)),
          initial_instance_sha256: entry.initial_instance_sha256, checkpoint_instance_sha256: entry.checkpoint.instance_sha256,
          checkpoint_resources_sha256: H(checkpoint.state.resources), checkpoint_resource_count: checkpoint.state.resources.length } : {}),
        journal_id: a.journal_id, instance_id: a.instance_id, scope_id: current.inventory.scope_id, model_sha256: current.inventory.model_sha256,
        configuration_sha256: a.configuration_sha256, instance_sha256: a.instance_sha256, physical_root_sha256: current.inventory.physical_root_sha256,
        inventory_sha256: H(current.inventory), journal_sha256: a.journal_sha256, allocations_sha256: H(native.record.allocations), generation: a.generation,
        allocation_sha256: a.allocation_sha256, dispatch_id: a.dispatch_id, dispatch_sha256: a.dispatch_sha256,
        checkpoint_sha256: a.checkpoint.sha256, checkpoint_state_sha256: a.checkpoint.state_sha256, closure_sha256: a.checkpoint.closure_sha256,
        owner_retirement_receipt_sha256: H(owner.receipt), minimum_consumption: entry.consumption ?? { responses_observed: 0, response_sha256: [], storage_debit_bytes: 0, native_usage_sha256: null },
        resources: [{ kind: 'allocation', generation: a.generation, owner_id: entry.owner_id, closure_sha256: entry.closure_ref.sha256, checkpoint_sha256: entry.checkpoint.sha256 },
          ...(post ? nativeSessions(checkpoint.state) : []),
          { kind: 'native_scope', instance_id: a.instance_id, scope_id: current.inventory.scope_id, configuration_sha256: a.configuration_sha256 }], prepared_at_ms: now() }));
      const prepared = { request: q, inventory: current.inventory }; observe(prepared, null); return structuredClone(prepared);
  }
  return Object.freeze({
    prepare: (instanceId, input) => prepare(instanceId, input, false),
    preparePostAssignment: (instanceId, input) => prepare(instanceId, input, true),
    async apply(supplied, { write = false, expectedRequestSha256, sourceRef = null, signal } = {}) {
      const preparation = structuredClone(assertNativeReconciliationPreparation(supplied)), q = preparation.request;
      verifyRequest(q); signer.verify(preparation.inventory);
      const post = isNativePostAssignmentReconciliation(q);
      if (write !== true || expectedRequestSha256 !== H(q)) fail('NATIVE_RECONCILIATION_EXACT_WRITE_REQUIRED');
      const id = nativeReconciliationId(q.journal_id, q.generation); let retained = read(id);
      if (retained.record && H(retained.record.request) !== H(q)) fail('NATIVE_RECONCILIATION_REQUEST_CHANGED');
      if (retained.record?.phase === 'confirmed') return { status: 'retained_confirmation', receipt: retainedNativeReconciliationReceipt(retained.record), written: false, native_started: false };
      if (retained.record?.attempts.length >= 32) fail('NATIVE_RECONCILIATION_ATTEMPT_LIMIT');
      const previous = retained.record?.attempts.at(-1);
      if (previous && observeLocalProcessOwner(previous.process_identity) !== 'terminated') fail('NATIVE_RECONCILIATION_REPRENEUR_ACTIVE');
      let observed = observe(preparation, retained.record), existingProposal = retained.record?.attempts.find(row => row.lease && H(row.proposal) === H(observed.native.record));
      let proposal, resourceInput = null;
      if (existingProposal) proposal = existingProposal.proposal;
      else {
        if (typeof sourceRef !== 'string' || !sourceRef || sourceRef.length > 256 || typeof resourceSource?.assertCurrent !== 'function') fail('NATIVE_RECONCILIATION_RESOURCE_SOURCE_REQUIRED');
        const grant = structuredClone(await invoke(resourceSource, 'read', { request: q, sourceRef }, signal));
        if (grant === null) return { status: 'WAITING', written: false, native_started: false };
        assertNativeReconciliationGrant(grant, q);
        const verified = structuredClone(await invoke(resourceSource, 'verify', { request: q, grant, sourceRef }, signal));
        if (verified?.outcome !== 'verified' || verified.authority_id !== grant.authority_id || verified.grant_sha256 !== H(grant)
          || verified.evidence_class !== grant.closure.evidence_class || grant.closure.observed_at_ms > now()) fail('NATIVE_RECONCILIATION_SOURCE_NOT_AUTHENTICATED');
        resourceInput = { request: q, grant, sourceRef };
        const receipt = signer.seal({ contract_version: post ? 'native-allocation-reconciliation-receipt.v2' : 'native-allocation-reconciliation-receipt.v1', request: q, grant,
          verification: { outcome: 'verified', authority_id: grant.authority_id, request_sha256: H(q), grant_sha256: H(grant), evidence_class: grant.closure.evidence_class },
          confirmed_at_ms: now(), original_failure_preserved: true, accounting_reconciled: true, permits_effects: false, permits_resume: false,
          permits_native_renewal: false, complete_resource_closure: false, native_started: false });
        const original = observed.original;
        if (!post && original.contract_version === 'native-allocation-journal.v5') fail('NATIVE_RECONCILIATION_PROFILE_VERSION_REQUIRED');
        proposal = signer.seal({ contract_version: post ? 'native-allocation-journal.v5' : 'native-allocation-journal.v4', journal_id: original.journal_id, instance_id: original.instance_id,
          scope_id: original.scope_id, model_sha256: original.model_sha256, revision: original.revision + 1, allocations: original.allocations,
          initial_authorization: observed.initial_authorization, epochs: original.epochs ?? [],
          origin_journal: post ? original.contract_version === 'native-allocation-journal.v5' ? original.origin_journal : original
            : original.contract_version === 'native-allocation-journal.v4' ? original.origin_journal : original,
          reconciliations: [...(original.reconciliations ?? []), receipt] }); assertNativeAllocationJournal(proposal);
      }
      const operatorGrant = structuredClone(await invoke(operatorSource, 'authorize', { request: q }, signal)); freshOperator(operatorGrant, q);
      const operatorVerification = structuredClone(await invoke(operatorSource, 'verify', { request: q, grant: operatorGrant }, signal)); freshOperator(operatorGrant, q);
      if (operatorVerification?.outcome !== 'verified' || operatorVerification.authority_id !== operatorGrant.authority_id
        || operatorVerification.request_sha256 !== H(q) || operatorVerification.grant_sha256 !== H(operatorGrant)
        || typeof operatorSource?.assertCurrent !== 'function') fail('NATIVE_RECONCILIATION_OPERATOR_NOT_AUTHENTICATED');
      const permit = () => {
        observed = observe(preparation, retained.record);
        if (signal?.aborted) fail('NATIVE_RECONCILIATION_ABORTED'); freshOperator(operatorGrant, q);
        if (operatorSource.assertCurrent({ request: q, grant: operatorGrant }) !== undefined
          || resourceInput && resourceSource.assertCurrent(resourceInput) !== undefined) fail('NATIVE_RECONCILIATION_AUTHORIZATION_CHANGED');
      };
      permit(); if (read(id).content_sha256 !== retained.content_sha256) fail('NATIVE_RECONCILIATION_RECORD_CHANGED');
      const processIdentity = observeLocalProcess(process.pid); if (!processIdentity) fail('PROCESS_IDENTITY_UNAVAILABLE');
      const intention = fence.prepareAcquire({ expectedSha256: observed.currentFence.content_sha256 });
      const attempt = { attempt_id: randomUUID(), process_identity: processIdentity, operator_grant: operatorGrant,
        operator_verification: operatorVerification, resource_source_ref: existingProposal ? null : sourceRef, proposal,
        fence_intention: intention, lease: null, commit_sha256: null, released_fence: null };
      const priorCommit = retained.record?.commit ?? (existingProposal ? { proposal_sha256: H(proposal), proposal_content_sha256: observed.native.content_sha256,
        receipt_sha256: H(proposal.reconciliations.at(-1)), proposal_attempt_id: existingProposal.attempt_id } : null);
      await boundary('native_reconciliation_before_intent', id); permit();
      retained = save(retained, { contract_version: post ? 'native-allocation-reconciliation-record.v2' : 'native-allocation-reconciliation-record.v1',
        ...(post ? { profile: q.profile } : {}), reconciliation_id: id, journal_id: q.journal_id,
        generation: q.generation, instance_id: q.instance_id, scope_id: q.scope_id, model_sha256: q.model_sha256, request: q,
        inventory: preparation.inventory, base_context_sha256: H(baseContext(observed.fresh.context)), initial_authorization: observed.initial_authorization,
        original_journal: observed.original, original_content_sha256: retained.record?.original_content_sha256 ?? observed.native.content_sha256,
        phase: 'intent', attempts: [...(retained.record?.attempts ?? []), attempt], commit: priorCommit }, permit);
      await boundary('native_reconciliation_intent', id); permit();
      const beforeFence = expectedFence(observed.retired, retained.record);
      const lease = fence.acquire({ expectedSha256: beforeFence.content_sha256, prepared: intention,
        ...(beforeFence.record?.state === 'held' ? { dispositionLease: beforeFence.record } : {}) });
      await boundary('native_reconciliation_fence_acquired', id); permit(); fence.assert(lease);
      const update = (fields, phase, commit = retained.record.commit) => { const attempts = structuredClone(retained.record.attempts); Object.assign(attempts.at(-1), fields); retained = save(retained, { attempts, phase, commit }, permit); };
      update({ lease: leaseData(lease) }, 'acquired');
      await boundary('native_reconciliation_lease_retained', id); permit(); fence.assert(lease);
      let native = readNative(q.journal_id);
      if (H(native.record) !== H(proposal)) {
        if (native.content_sha256 !== retained.record.original_content_sha256 || H(native.record) !== H(retained.record.original_journal)) fail('NATIVE_RECONCILIATION_JOURNAL_CHANGED');
        nativeStore.compareAndSwap(proposal, native.content_sha256);
      }
      await boundary('native_reconciliation_journal_cas', id); permit(); fence.assert(lease);
      native = readNative(q.journal_id); if (H(native.record) !== H(proposal)) fail('NATIVE_RECONCILIATION_JOURNAL_CHANGED');
      if (stateMode !== 'db-only' && artifacts.read(nativeJournalPath(q.journal_id), { required: true }).source !== 'files') {
        permit(); fence.assert(lease); nativeStore.materialize(q.journal_id, { write: true });
      }
      const commit = retained.record.commit ?? { proposal_sha256: H(proposal), proposal_content_sha256: native.content_sha256,
        receipt_sha256: H(proposal.reconciliations.at(-1)), proposal_attempt_id: attempt.attempt_id };
      update({ commit_sha256: H(proposal) }, 'committed', commit);
      await boundary('native_reconciliation_commit_retained', id); permit(); fence.assert(lease);
      const released = fence.release(lease);
      await boundary('native_reconciliation_fence_released', id); permit();
      if (fence.read().content_sha256 !== released.content_sha256) fail('NATIVE_RECONCILIATION_FENCE_CHANGED');
      update({ released_fence: { record: released.record, content_sha256: released.content_sha256 } }, 'confirmed');
      await boundary('native_reconciliation_confirmed', id);
      return { status: 'allocation_reconciliation_confirmed', receipt: retainedNativeReconciliationReceipt(retained.record), written: true, native_started: false };
    },
    read: id => read(id).record,
  });
}
