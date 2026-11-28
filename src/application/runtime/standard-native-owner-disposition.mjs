import { assertNativePostAssignmentAssessment, nativePostAssignmentCanReconcileResources } from '../../core/workflow/native-post-assignment-assessment.mjs';
import { randomUUID } from 'node:crypto';
import { createWorkflowRecordStore } from '../../adapters/runtime/workflow-record-store.mjs';
import { observeLocalProcess, observeLocalProcessOwner } from '../../adapters/runtime/local-process-identity.mjs';
import { assertNativeDispatchRecord, nativeDispatchPath } from '../../core/workflow/native-dispatch-record.mjs';
import { assertNativeOwnerDispositionPlan, assertNativeOwnerDispositionRecord, assertNativeOwnerDispositionRequest,
  assertNativeOwnerDispositionReceipt, nativeOwnerDispositionPath } from '../../core/workflow/native-owner-disposition.mjs';
import { shadowHash as H, checkShadowJson } from '../../core/workflow/shadow-json.mjs';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import grantV1 from '../../core/contracts/workflow-definition/process-disposition-authorization-grant.v1.schema.json' with { type: 'json' };
import grantV2 from '../../core/contracts/workflow-definition/process-disposition-authorization-grant.v2.schema.json' with { type: 'json' };
import { LOCAL_ARTIFACT_FENCE_PATH } from './local-artifact-resource-fence.mjs';
import { inspectNativeOwnerLock, retireNativeOwnerLock, nativeRetiredOwnerRelativePath } from './local-native-owner-retirement.mjs';

const fail = code => { throw Object.assign(Error(code), { code }); };
const body = ({ authentication, key_id, ...value }) => value;
const stableAssessment = ({ authentication, key_id, observed_at_ms, inventory_sha256, ...value }) => value;
const isPostPlan = value => value?.contract_version === 'native-owner-disposition-plan.v2';
const stablePostAssessment = ({ authentication, key_id, base_assessment, ...value }) => ({ ...value, base_assessment: stableAssessment(base_assessment) });
const postFields = plan => isPostPlan(plan) ? { profile: plan.profile, post_assignment_sha256: plan.post_assignment_sha256 } : {};
const planProfile = plan => isPostPlan(plan) ? 'admitted_post_assignment' : 'no_assignment';
function material(inventory, id) {
  const { authentication, key_id, observed_at_ms, ...value } = inventory;
  const excluded = new Set(['artifact:' + nativeOwnerDispositionPath(id), 'native-owner-disposition:' + id,
    'artifact:' + LOCAL_ARTIFACT_FENCE_PATH, 'local:effects.lock', 'local:' + nativeRetiredOwnerRelativePath(id).split('/').at(-1)]);
  return { ...value, resources: value.resources.filter(row => !excluded.has(row.ref)) };
}
const leaseData = value => ({ record: value.record, content_sha256: value.content_sha256, previous_sha256: value.previous_sha256 });

export function createStandardNativeOwnerDisposition({ targetRoot, stateMode, artifacts, signer, assess, assessPostAssignment,
  source, now = Date.now, onBoundary = async () => {} }) {
  const store = createWorkflowRecordStore({ targetRoot, stateMode, descriptor: { pathForId: nativeOwnerDispositionPath,
    validate: assertNativeOwnerDispositionRecord, idOf: value => value.dispatch_id, hashOf: H, kind: 'native_allocation_journal' } });
  const fence = artifacts.resourceFence();
  const read = id => {
    const found = store.read(id);
    if (found.record) {
      signer.verify(found.record); signer.verify(found.record.plan);
      if (found.record.receipt) signer.verify(found.record.receipt);
    }
    return found;
  };
  const save = (previous, fields) => {
    const record = signer.seal({ ...(previous.record ? body(previous.record) : {}), ...fields,
      revision: (previous.record?.revision ?? 0) + 1 });
    assertNativeOwnerDispositionRecord(record);
    const result = store.compareAndSwap(record, previous.content_sha256);
    if (result.projection === 'pending') store.materialize(record.dispatch_id, { write: true });
    const after = read(record.dispatch_id);
    if (H(after.record) !== H(record)) fail('NATIVE_OWNER_DISPOSITION_RECORD_CHANGED');
    return after;
  };
  function observe(instanceId, input, retained, profile = 'no_assignment') {
    if (profile === 'admitted_post_assignment' && typeof assessPostAssignment !== 'function') fail('NATIVE_OWNER_DISPOSITION_AUTHORITY_REQUIRED');
    const post = profile === 'admitted_post_assignment' ? assessPostAssignment(instanceId, input) : null;
    if (post) { signer.verify(post.inventory); signer.verify(post.assessment); assertNativePostAssignmentAssessment(post.assessment, post.inventory); }
    const observed = post ? { inventory: post.inventory, assessment: post.assessment.base_assessment } : assess(instanceId, input), a = observed.assessment;
    signer.verify(observed.inventory); signer.verify(a);
    const readOnly = profile === 'no_assignment' && observed.readOnlyStorageStop;
    if (readOnly && (readOnly.instance_sha256 !== a.instance_sha256 || readOnly.journal_sha256 !== a.journal_sha256
      || readOnly.dispatch_id !== a.dispatch_id || readOnly.dispatch_sha256 !== a.dispatch_sha256))
      fail('NATIVE_OWNER_DISPOSITION_SUBJECT_CHANGED');
    if (a.allocation_phase !== 'failed' || !readOnly && a.return_binding !== 'matched'
      || profile === 'no_assignment' && !readOnly && a.assignment_status !== 'no_assignment'
      || profile === 'admitted_post_assignment' && !nativePostAssignmentCanReconcileResources(post.assessment))
      fail('NATIVE_OWNER_DISPOSITION_UNPROVEN_EFFECTS');
    const dispatch = assertNativeDispatchRecord(JSON.parse(artifacts.read(nativeDispatchPath(input.dispatchId), { required: true }).content));
    signer.verify(dispatch);
    if (H(dispatch) !== a.dispatch_sha256 || dispatch.leases.length !== 1 || dispatch.leases[0].status !== 'held')
      fail('NATIVE_OWNER_DISPOSITION_SUBJECT_CHANGED');
    const lease = dispatch.leases[0], intention = dispatch.local_owner_intentions.find(row => H(row.owner) === H(lease.owner));
    const lock = inspectNativeOwnerLock({ targetRoot: artifacts.root, dispatchId: dispatch.dispatch_id, intention, lease,
      allowRetired: Boolean(retained?.attempts.some(row => row.lease !== null)) });
    return { ...observed, dispatch, lease, intention, lock, post_assignment_assessment: post?.assessment ?? null,
      subject_sha256: H({ assessment: stableAssessment(a), inventory: material(observed.inventory, dispatch.dispatch_id),
        ...(readOnly ? { read_only_storage_stop: readOnly } : {}),
        ...(post ? { post_assignment: stablePostAssessment(post.assessment) } : {}) }) };
  }
  function assertSubject(plan, observed) {
    const { assessment: a, inventory, lease, lock } = observed;
    if (plan.subject_sha256 !== observed.subject_sha256 || plan.instance_sha256 !== a.instance_sha256
      || plan.configuration_sha256 !== a.configuration_sha256 || plan.physical_root_sha256 !== inventory.physical_root_sha256
      || plan.dispatch_sha256 !== a.dispatch_sha256 || plan.journal_sha256 !== a.journal_sha256 || plan.allocation_sha256 !== a.allocation_sha256
      || plan.lock_sha256 !== lock.sha256 || plan.original_lease_sha256 !== H(lease)) fail('NATIVE_OWNER_DISPOSITION_SUBJECT_CHANGED');
    if (isPostPlan(plan) && (!observed.post_assignment_assessment
      || plan.post_assignment_sha256 !== H(stablePostAssessment(observed.post_assignment_assessment))
      || plan.initial_instance_sha256 !== a.initial_instance_sha256
      || plan.checkpoint_sha256 !== a.checkpoint.sha256 || plan.checkpoint_state_sha256 !== a.checkpoint.state_sha256
      || plan.checkpoint_instance_sha256 !== a.checkpoint.instance_sha256)) fail('NATIVE_OWNER_DISPOSITION_SUBJECT_CHANGED');
    if (observeLocalProcessOwner(observed.dispatch.process_identity) !== 'terminated') fail('NATIVE_OWNER_DISPOSITION_ORIGINAL_ACTIVE');
  }
  function expectedFence(plan, observed, retained) {
    const current = fence.read();
    if (current.content_sha256 === plan.original_fence_sha256 && H(current.record) === H(observed.lease.resource_fence)) return current;
    if (!retained) fail('NATIVE_OWNER_DISPOSITION_FENCE_CHANGED');
    for (const attempt of retained.attempts) {
      if (H(current.record) === H(attempt.fence_intention.record)
        || attempt.lease && H(current.record) === H({ ...attempt.lease.record, state: 'released', revision: attempt.lease.record.revision + 1 })) return current;
    }
    fail('NATIVE_OWNER_DISPOSITION_FENCE_CHANGED');
  }
  function freshGrant(grant, request) {
    const legacy = grant?.contract_version === 'process-disposition-authorization-grant.v1';
    if (checkShadowJson(grant) || validateJsonSchema(grant, legacy ? grantV1 : grantV2, '$', { contractKind: 'workflow-definition' }).length
      || grant.request_sha256 !== H(request) || !Number.isSafeInteger(grant.observed_at_ms) || grant.observed_at_ms > now()
      || legacy && grant.expires_at_ms <= now()) fail('NATIVE_OWNER_DISPOSITION_AUTHORIZATION_REQUIRED');
  }
  async function invoke(method, input, signal) {
    if (typeof source?.[method] !== 'function' || typeof source.assertCurrent !== 'function') fail('NATIVE_OWNER_DISPOSITION_AUTHORITY_UNAVAILABLE');
    if (signal?.aborted) fail('NATIVE_OWNER_DISPOSITION_ABORTED');
    const controller = new AbortController(), combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let timer, abort;
    const cancelled = new Promise((_, reject) => { abort = () => reject(Object.assign(Error('NATIVE_OWNER_DISPOSITION_ABORTED'), { code: 'NATIVE_OWNER_DISPOSITION_ABORTED' })); combined.addEventListener('abort', abort, { once: true }); });
    const expired = new Promise((_, reject) => { timer = setTimeout(() => { reject(Object.assign(Error('NATIVE_OWNER_DISPOSITION_AUTHORIZATION_TIMEOUT'), { code: 'NATIVE_OWNER_DISPOSITION_AUTHORIZATION_TIMEOUT' })); controller.abort(); }, 5000); });
    try { return await Promise.race([Promise.resolve().then(() => source[method]({ ...structuredClone(input), signal: combined })), cancelled, expired]); }
    finally { clearTimeout(timer); combined.removeEventListener('abort', abort); controller.abort(); }
  }
  const boundary = async (name, id) => { if (await onBoundary(name, id) !== undefined) fail('NATIVE_OWNER_DISPOSITION_BOUNDARY_INVALID'); };
  const inputFor = plan => ({ expectedSha256: plan.instance_sha256, dispatchId: plan.dispatch_id, generation: plan.generation });
  function prepare(instanceId, input, profile) {
    const retained = read(input?.dispatchId), observed = observe(instanceId, input, retained.record, profile), a = observed.assessment;
    if (retained.record) {
      if (planProfile(retained.record.plan) !== profile) fail('NATIVE_OWNER_DISPOSITION_PLAN_CHANGED');
      assertSubject(retained.record.plan, observed); return structuredClone(retained.record.plan);
    }
    if (observeLocalProcessOwner(observed.dispatch.process_identity) !== 'terminated') fail('NATIVE_OWNER_DISPOSITION_ORIGINAL_ACTIVE');
    const current = fence.read();
    if (H(current.record) !== H(observed.lease.resource_fence)) fail('NATIVE_OWNER_DISPOSITION_FENCE_CHANGED');
    const post = profile === 'admitted_post_assignment';
    return assertNativeOwnerDispositionPlan(signer.seal({ contract_version: post ? 'native-owner-disposition-plan.v2' : 'native-owner-disposition-plan.v1',
      ...(post ? { profile, post_assignment_sha256: H(stablePostAssessment(observed.post_assignment_assessment)),
        initial_instance_sha256: a.initial_instance_sha256, checkpoint_sha256: a.checkpoint.sha256,
        checkpoint_state_sha256: a.checkpoint.state_sha256, checkpoint_instance_sha256: a.checkpoint.instance_sha256 } : {}),
      dispatch_id: a.dispatch_id, journal_id: a.journal_id, generation: a.generation, instance_id: a.instance_id,
      instance_sha256: a.instance_sha256, scope_id: observed.inventory.scope_id, model_sha256: observed.inventory.model_sha256,
      configuration_sha256: a.configuration_sha256, physical_root_sha256: observed.inventory.physical_root_sha256,
      dispatch_sha256: a.dispatch_sha256, journal_sha256: a.journal_sha256, allocation_sha256: a.allocation_sha256,
      subject_sha256: observed.subject_sha256, lock_sha256: observed.lock.sha256, original_lease_sha256: H(observed.lease),
      original_fence_sha256: current.content_sha256, prepared_at_ms: now(), nonce: randomUUID() }));
  }
  return Object.freeze({
    prepare: (instanceId, input) => prepare(instanceId, input, 'no_assignment'),
    preparePostAssignment: (instanceId, input) => prepare(instanceId, input, 'admitted_post_assignment'),
    async apply(supplied, { write = false, expectedPlanSha256, signal } = {}) {
      if (checkShadowJson(supplied)) fail('NATIVE_OWNER_DISPOSITION_CONTRACT_INVALID');
      const plan = structuredClone(supplied); assertNativeOwnerDispositionPlan(plan); signer.verify(plan);
      if (write !== true || expectedPlanSha256 !== H(plan)) fail('NATIVE_OWNER_DISPOSITION_EXACT_WRITE_REQUIRED');
      let retained = read(plan.dispatch_id), observed = observe(plan.instance_id, inputFor(plan), retained.record, planProfile(plan));
      assertSubject(plan, observed);
      if (retained.record && H(retained.record.plan) !== H(plan)) fail('NATIVE_OWNER_DISPOSITION_PLAN_CHANGED');
      if (retained.record?.phase === 'confirmed') return { status: 'retained_confirmation', receipt: retained.record.receipt, written: false, native_started: false };
      const last = retained.record?.attempts.at(-1);
      if (last && observeLocalProcessOwner(last.process_identity) !== 'terminated') fail('NATIVE_OWNER_DISPOSITION_ACTIVE');
      let currentFence = expectedFence(plan, observed, retained.record);
      const request = assertNativeOwnerDispositionRequest({ contract_version: isPostPlan(plan) ? 'native-owner-disposition-authorization-request.v2' : 'native-owner-disposition-authorization-request.v1', ...postFields(plan), action: 'native_owner_retire',
        nonce: randomUUID(), requested_at_ms: now(), plan_sha256: H(plan), ...Object.fromEntries(['dispatch_id', 'journal_id', 'generation', 'instance_id', 'instance_sha256', 'scope_id', 'model_sha256', 'configuration_sha256'].map(key => [key, plan[key]])) });
      const grant = await invoke('authorize', { request }, signal); freshGrant(grant, request);
      const verification = await invoke('verify', { request, grant }, signal); freshGrant(grant, request);
      if (verification?.outcome !== 'verified' || verification.authority_id !== grant.authority_id
        || verification.request_sha256 !== H(request) || verification.grant_sha256 !== H(grant)) fail('NATIVE_OWNER_DISPOSITION_AUTHORIZATION_NOT_AUTHENTICATED');
      const permit = () => {
        const fresh = observe(plan.instance_id, inputFor(plan), retained.record, planProfile(plan)); assertSubject(plan, fresh);
        if (signal?.aborted) fail('NATIVE_OWNER_DISPOSITION_ABORTED'); freshGrant(grant, request);
        if (source.assertCurrent({ request, grant }) !== undefined) fail('NATIVE_OWNER_DISPOSITION_AUTHORIZATION_NOT_AUTHENTICATED');
      };
      permit();
      const rechecked = read(plan.dispatch_id);
      if (rechecked.content_sha256 !== retained.content_sha256) fail('NATIVE_OWNER_DISPOSITION_RECORD_CHANGED');
      currentFence = expectedFence(plan, observed, retained.record);
      const self = observeLocalProcess(process.pid); if (!self) fail('PROCESS_IDENTITY_UNAVAILABLE');
      const intention = fence.prepareAcquire({ expectedSha256: currentFence.content_sha256 });
      const attempt = { attempt_id: randomUUID(), process_identity: self, request, grant, verification,
        fence_intention: intention, lease: null, retirement: null, released_fence: null };
      await boundary('native_disposition_before_intent', plan.dispatch_id); permit();
      retained = save(retained, { contract_version: isPostPlan(plan) ? 'native-owner-disposition-record.v2' : 'native-owner-disposition-record.v1',
        ...(isPostPlan(plan) ? { profile: plan.profile } : {}), dispatch_id: plan.dispatch_id,
        journal_id: plan.journal_id, instance_id: plan.instance_id, scope_id: plan.scope_id, model_sha256: plan.model_sha256, plan,
        phase: 'intent', attempts: [...(retained.record?.attempts ?? []), attempt], receipt: retained.record?.receipt ?? null });
      await boundary('native_disposition_intent', plan.dispatch_id); permit();
      const lease = fence.acquire({ expectedSha256: currentFence.content_sha256, prepared: intention,
        ...(currentFence.record?.state === 'held' ? { dispositionLease: currentFence.record } : {}) });
      await boundary('native_disposition_fence_acquired', plan.dispatch_id); permit(); fence.assert(lease);
      const update = fields => {
        const attempts = structuredClone(retained.record.attempts); Object.assign(attempts.at(-1), fields);
        retained = save(retained, { attempts, phase: fields.retirement ? 'retired' : 'acquired',
          ...(fields.retirement ? { receipt: retained.record.receipt ?? assertNativeOwnerDispositionReceipt(signer.seal({
            contract_version: isPostPlan(plan) ? 'native-owner-disposition-receipt.v2' : 'native-owner-disposition-receipt.v1',
            ...postFields(plan), dispatch_id: plan.dispatch_id, plan_sha256: H(plan),
            attempt_id: attempt.attempt_id, retirement_sha256: H(fields.retirement), original_lease_sha256: plan.original_lease_sha256,
            lock_sha256: plan.lock_sha256, effect: 'owner_lock_retired', confirmed_at_ms: now(), original_failure_preserved: true,
            complete_resource_closure: false, permits_resume: false, permits_native_renewal: false, accounting_reconciled: false, native_started: false })) } : {}) });
      };
      update({ lease: leaseData(lease) });
      await boundary('native_disposition_lease_retained', plan.dispatch_id);
      const retirement = retireNativeOwnerLock({ targetRoot: artifacts.root, dispatchId: plan.dispatch_id, intention: observed.intention,
        originalLease: observed.lease, fence, dispositionLease: lease, expectedLockSha256: plan.lock_sha256, assertPermit: permit, write: true });
      await boundary('native_disposition_lock_retired', plan.dispatch_id); permit(); fence.assert(lease); update({ retirement });
      await boundary('native_disposition_retirement_confirmed', plan.dispatch_id); permit(); fence.assert(lease);
      const released = fence.release(lease);
      await boundary('native_disposition_fence_released', plan.dispatch_id); permit();
      if (fence.read().content_sha256 !== released.content_sha256) fail('NATIVE_OWNER_DISPOSITION_FENCE_CHANGED');
      const attempts = structuredClone(retained.record.attempts); attempts.at(-1).released_fence = { record: released.record, content_sha256: released.content_sha256 };
      retained = save(retained, { attempts, phase: 'confirmed' });
      await boundary('native_disposition_confirmed', plan.dispatch_id);
      return { status: 'owner_retirement_confirmed', receipt: retained.record.receipt, written: true, native_started: false };
    },
    read: id => read(id).record,
  });
}
