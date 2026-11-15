import assert from 'node:assert/strict';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { assertNativeOwnerDispositionPlan, assertNativeOwnerDispositionRequest, assertNativeOwnerDispositionReceipt, assertNativeOwnerDispositionRecord } from '../../src/core/workflow/native-owner-disposition.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

// Closed-data cases only. All v2 work, operator approval and source signatures
// constructed here are synthetic. No physical owner or grant is exercised.
export function verifyNativePostAssignmentOwnerContracts(original, check) {
  assertNativeOwnerDispositionRecord(original);
  const signer = createOperationJournalSigner(() => Buffer.alloc(32, 137));
  const body = ({ key_id, authentication, ...v }) => v;
  const profile = 'admitted_post_assignment', post = H('synthetic-complete-post-assignment-assessment');
  const plan = signer.seal({ ...body(original.plan), contract_version: 'native-owner-disposition-plan.v2', profile,
    post_assignment_sha256: post, initial_instance_sha256: H('synthetic-before-assignment'),
    checkpoint_sha256: H('synthetic-admitted-checkpoint'), checkpoint_state_sha256: H('synthetic-checkpoint-state'),
    checkpoint_instance_sha256: original.plan.instance_sha256 });
  const attempts = original.attempts.map(row => {
    const request = { ...row.request, contract_version: 'native-owner-disposition-authorization-request.v2',
      profile, post_assignment_sha256: post, plan_sha256: H(plan) };
    const grant = { ...row.grant, request_sha256: H(request), grant_sha256: H('synthetic-operator-grant-' + row.attempt_id) };
    const verification = { ...row.verification, request_sha256: H(request), grant_sha256: H(grant) };
    return { ...structuredClone(row), request, grant, verification };
  });
  const receipt = signer.seal({ ...body(original.receipt), contract_version: 'native-owner-disposition-receipt.v2',
    profile, post_assignment_sha256: post, plan_sha256: H(plan) });
  const record = signer.seal({ ...body(original), contract_version: 'native-owner-disposition-record.v2',
    profile, plan, attempts, receipt });
  assertNativeOwnerDispositionPlan(plan); assertNativeOwnerDispositionRequest(attempts[0].request);
  assertNativeOwnerDispositionReceipt(receipt); assertNativeOwnerDispositionRecord(record);
  assert.notEqual(plan.initial_instance_sha256, plan.checkpoint_instance_sha256);
  check('post-assignment owner data separates initial/current/checkpoint subjects with immutable physical receipt');
  for (const [name, mutate] of [
    ['collapsed initial checkpoint', r => { r.plan.initial_instance_sha256 = r.plan.checkpoint_instance_sha256; }],
    ['collapsed initial current', r => { r.plan.initial_instance_sha256 = r.plan.instance_sha256; }],
    ['missing checkpoint pin', r => { delete r.plan.checkpoint_sha256; }],
    ['unknown plan profile', r => { r.plan.profile = 'unknown'; }],
    ['unknown record profile', r => { r.profile = 'unknown'; }],
    ['old plan in new record', r => { r.plan = original.plan; }],
    ['old request in new attempt', r => { r.attempts[0].request = original.attempts[0].request; }],
    ['old receipt in new record', r => { r.receipt = original.receipt; }],
    ['different request assessment', r => { r.attempts[0].request.post_assignment_sha256 = H('foreign'); }],
    ['different receipt assessment', r => { r.receipt.post_assignment_sha256 = H('foreign'); }],
    ['different plan assessment', r => { r.plan.post_assignment_sha256 = H('foreign'); }],
    ['resume permission', r => { r.receipt.permits_resume = true; }],
    ['Native renewal permission', r => { r.receipt.permits_native_renewal = true; }],
    ['Native start permission', r => { r.receipt.native_started = true; }],
    ['accounting confirmation', r => { r.receipt.accounting_reconciled = true; }],
    ['complete resource closure', r => { r.receipt.complete_resource_closure = true; }],
    ['lost original failure', r => { r.receipt.original_failure_preserved = false; }],
    ['foreign plan in receipt', r => { r.receipt.plan_sha256 = H('foreign'); }],
    ['foreign physical lease', r => { r.receipt.original_lease_sha256 = H('foreign'); }],
    ['unregistered callback', r => { r.observer = {}; }],
  ]) {
    const value = structuredClone(record); mutate(value);
    assert.throws(() => assertNativeOwnerDispositionRecord(value), { code: 'NATIVE_OWNER_DISPOSITION_CONTRACT_INVALID' });
    check('post-assignment owner data refuses ' + name);
  }
  assert.throws(() => assertNativeOwnerDispositionPlan({ ...plan, contract_version: 'native-owner-disposition-plan.v1' }), { code: 'NATIVE_OWNER_DISPOSITION_CONTRACT_INVALID' });
  assert.throws(() => assertNativeOwnerDispositionReceipt({ ...receipt, contract_version: 'native-owner-disposition-receipt.v1' }), { code: 'NATIVE_OWNER_DISPOSITION_CONTRACT_INVALID' });
  check('historical v1 owner data never reinterprets post-assignment fields');
  assertNativeOwnerDispositionRecord(original);
  check('historical v1 retained owner record stays accepted without conversion');
  return { checks: 23, Native_calls: 0, authority: 'synthetic_closed_data_only' };
}
