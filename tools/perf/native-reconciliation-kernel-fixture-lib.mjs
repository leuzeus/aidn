import assert from 'node:assert/strict';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';
import { assertNativeAllocationJournal, nativeJournalId } from '../../src/core/workflow/native-allocation-journal.mjs';
import { nativeAllocationTotals, nativeLimitsOf, effectiveNativeEpochAuthorization } from '../../src/core/workflow/native-authorization-epoch.mjs';
import { assertNativeReconciliationRequest, assertNativeReconciliationGrant, assertNativeReconciliationReceipt, nativeAllocationResolution } from '../../src/core/workflow/native-allocation-reconciliation.mjs';

// Data-contract fixtures only. Process/Native closure, owner retirement, source
// verification and consent below are synthetic, never product admission.
export function verifyNativeReconciliationKernel(check) {
  const signer = createOperationJournalSigner(() => Buffer.alloc(32, 117));
  const original = { approved: true, model_allowed: true, configuration_sha256: H('fixture-configuration'), authorized_at_ms: 1000,
    global_deadline_ms: 601000, workflow_deadline_ms: 601000, max_turn_ms: 60000, max_responses: 9, max_bytes: 33554432 };
  const scope = { instance_id: 'reconciliation-contract', scope_id: 'fixture-native-scope', model_sha256: H('fixture-model') };
  const scopeResource = { kind: 'native_scope', instance_id: scope.instance_id, scope_id: scope.scope_id, configuration_sha256: original.configuration_sha256 };
  const consumption = bytes => ({ responses_observed: 0, response_sha256: [], storage_debit_bytes: bytes, native_usage_sha256: null });
  const allocationResource = entry => ({ kind: 'allocation', generation: entry.generation, owner_id: entry.owner_id,
    closure_sha256: entry.closure_ref.sha256, checkpoint_sha256: entry.checkpoint.sha256 });
  const closureFor = request => ({ contract_version: 'native-resource-closure.v1', request_sha256: H(request), inventory_sha256: H(request.resources),
    observed_at_ms: request.prepared_at_ms !== undefined ? request.prepared_at_ms + 1 : request.issued_at_ms + 1, complete: true, active_resources: 0,
    evidence_class: 'fixture', resources: request.resources.map(resource => ({ resource_sha256: H(resource), state: 'closed',
      evidence_refs: [{ ref: 'fixture:synthetic-resource-closure', sha256: H(resource) }] })) });
  const entryFor = (generation, authorization, phase = 'failed') => {
    const prefix = H('fixture-instance-' + generation);
    return { generation, owner_id: 'fixture-owner-' + generation, configuration_sha256: original.configuration_sha256,
      authorization_sha256: H(authorization), initial_instance_sha256: prefix, limits: nativeLimitsOf(authorization), phase,
      owned_result_sha256: H('fixture-return-' + generation), tree_proof_sha256: H('fixture-tree-' + generation), tree_closed: true,
      owned_status: phase === 'closed' ? 'COMPLETED' : 'FAILED', first_failure: phase === 'closed' ? null : 'FIXTURE_NO_ASSIGNMENT_FAILURE',
      checkpoint: { path: 'fixture/checkpoint-' + generation + '.json', sha256: H('fixture-checkpoint-' + generation),
        state_sha256: H('fixture-state-' + generation), instance_sha256: prefix },
      closure_ref: { path: 'fixture/closure-' + generation + '.json', sha256: H('fixture-closure-' + generation) }, consumption: consumption(1024 * generation) };
  };
  const journalFor = entries => signer.seal({ contract_version: 'native-allocation-journal.v1', journal_id: nativeJournalId(scope), ...scope, revision: 2 * entries.length, allocations: entries });
  function epochFor(journal, initial = false, issuedAt = 2000000) {
    const entries = journal?.allocations ?? [], totals = nativeAllocationTotals(entries, journal?.reconciliations), resources = initial ? [scopeResource] : entries.map(allocationResource);
    const request = signer.seal({ contract_version: initial ? 'native-authorization-epoch-request.v2' : 'native-authorization-epoch-request.v1', request_id: 'fixture-epoch-' + issuedAt,
      ...scope, configuration_sha256: original.configuration_sha256, instance_sha256: H('fixture-current'), product_sha256: H('fixture-product'),
      journal_sha256: H(journal), allocations_sha256: H(entries), previous_epoch_sha256: journal?.epochs?.length ? H(journal.epochs.at(-1)) : null,
      epoch: (journal?.epochs?.length ?? 0) + 2, next_generation: entries.length + 1, initial_authorization: original, consumption: totals,
      resources, issued_at_ms: issuedAt, expires_at_ms: issuedAt + 300000 });
    const authorization = { ...original, authorized_at_ms: issuedAt + 1, global_deadline_ms: issuedAt + 600001, workflow_deadline_ms: issuedAt + 600001 };
    const grant = { contract_version: 'native-authorization-epoch-grant.v1', authority_id: 'fixture_native_owner', source_event_id: 'fixture-epoch-source-' + issuedAt,
      request_sha256: H(request), authorization, closure: closureFor(request), evidence_refs: [{ ref: 'fixture:synthetic-consent', sha256: H(issuedAt) }] };
    return { epoch: request.epoch, start_generation: request.next_generation, request, grant };
  }
  const firstClosed = entryFor(1, original, 'closed');
  firstClosed.consumption.responses_observed = 1; firstClosed.consumption.response_sha256 = [H('fixture-prior-response')];
  const v1 = journalFor([entryFor(1, original)]), closedOrigin = journalFor([firstClosed]);
  const epoch2 = epochFor(closedOrigin), effective2 = { ...epoch2.grant.authorization, max_responses: 8, max_bytes: original.max_bytes - 1024 };
  const v2 = signer.seal({ ...closedOrigin, contract_version: 'native-allocation-journal.v2', revision: 5,
    initial_authorization: original, origin_journal: closedOrigin, epochs: [epoch2], allocations: [...closedOrigin.allocations, entryFor(2, effective2)] });
  const initialEpoch = epochFor(null, true, 601001);
  const v3 = signer.seal({ contract_version: 'native-allocation-journal.v3', journal_id: nativeJournalId(scope), ...scope, revision: 3,
    initial_authorization: original, origin_journal: null, epochs: [initialEpoch], allocations: [entryFor(1, initialEpoch.grant.authorization)] });
  const origins = [v1, v2, v3];
  function reconcile(origin, preparedAt = 3000000) {
    const entry = origin.allocations.at(-1), generation = entry.generation;
    const request = signer.seal({ contract_version: 'native-allocation-reconciliation-request.v1', request_id: '00000000-0000-4000-8000-000000000117', profile: 'no_assignment',
      journal_id: origin.journal_id, ...scope, configuration_sha256: entry.configuration_sha256, instance_sha256: entry.initial_instance_sha256,
      physical_root_sha256: H('fixture-physical-root'), inventory_sha256: H('fixture-inventory'), journal_sha256: H(origin), allocations_sha256: H(origin.allocations),
      generation, allocation_sha256: H(entry), dispatch_id: 'native_dispatch_' + H('fixture-dispatch-' + generation).slice(0, 40), dispatch_sha256: H('fixture-signed-dispatch'),
      checkpoint_sha256: entry.checkpoint.sha256, checkpoint_state_sha256: entry.checkpoint.state_sha256, closure_sha256: entry.closure_ref.sha256,
      owner_retirement_receipt_sha256: H('fixture-synthetic-owner-retirement'), minimum_consumption: structuredClone(entry.consumption),
      resources: [allocationResource(entry), scopeResource], prepared_at_ms: preparedAt });
    const grant = { contract_version: 'native-allocation-reconciliation-grant.v1', authority_id: 'fixture_native_owner', source_event_id: 'fixture-reconciliation-' + origin.contract_version + '-' + generation,
      request_sha256: H(request), consumption: { ...consumption(entry.consumption.storage_debit_bytes + 128), native_usage_sha256: entry.consumption.native_usage_sha256 }, closure: closureFor(request),
      evidence_refs: [{ ref: 'fixture:synthetic-final-debit', sha256: H('fixture-cost') }] };
    const receipt = signer.seal({ contract_version: 'native-allocation-reconciliation-receipt.v1', request, grant,
      verification: { outcome: 'verified', authority_id: grant.authority_id, request_sha256: H(request), grant_sha256: H(grant), evidence_class: 'fixture' },
      confirmed_at_ms: preparedAt + 2, original_failure_preserved: true, accounting_reconciled: true, permits_effects: false, permits_resume: false,
      permits_native_renewal: false, complete_resource_closure: false, native_started: false });
    return signer.seal({ contract_version: 'native-allocation-journal.v4', journal_id: origin.journal_id, ...scope, revision: origin.revision + 1,
      allocations: structuredClone(origin.allocations), initial_authorization: original, epochs: structuredClone(origin.epochs ?? []), origin_journal: origin, reconciliations: [receipt] });
  }
  check('reconciliation kernel preserves empty worker usage evidence with zero responses', () => {
    const value = structuredClone(v1), usage = H({ thread_counters: [], aggregation: 'latest observed cumulative snapshot per thread; not a billed total', incomplete_turns_may_be_unknown: true });
    value.allocations[0].consumption.native_usage_sha256 = usage;
    const origin = signer.seal(value), reconciled = reconcile(origin), receipt = reconciled.reconciliations[0];
    assertNativeAllocationJournal(reconciled); signer.verify(reconciled);
    assert.deepEqual(reconciled.origin_journal, origin);
    assert.equal(receipt.request.minimum_consumption.native_usage_sha256, usage);
    assert.equal(receipt.grant.consumption.native_usage_sha256, usage);
    assert.equal(nativeAllocationTotals(reconciled.allocations, reconciled.reconciliations).responses, 0);
    for (const substitute of [null, H('substituted-usage')]) {
      const grant = structuredClone(receipt.grant); grant.consumption.native_usage_sha256 = substitute;
      assert.throws(() => assertNativeReconciliationGrant(grant, receipt.request), /NATIVE_RECONCILIATION_CONSUMPTION_CHANGED/);
    }
    const invalid = structuredClone(receipt.request); invalid.minimum_consumption.native_usage_sha256 = 'not-a-digest';
    assert.throws(() => assertNativeReconciliationRequest(invalid), /NATIVE_RECONCILIATION_REQUEST_INVALID/);
    invalid.minimum_consumption.native_usage_sha256 = usage; invalid.minimum_consumption.responses_observed = 1;
    invalid.minimum_consumption.response_sha256 = [H('response')];
    assert.throws(() => assertNativeReconciliationRequest(invalid), /NATIVE_RECONCILIATION_REQUEST_INVALID/);
  });
  for (const origin of origins) check('reconciliation kernel retains ' + origin.contract_version + ' failure and exact origin', () => {
    const before = JSON.stringify(origin), journal = reconcile(origin); assertNativeAllocationJournal(origin); assertNativeAllocationJournal(journal); signer.verify(journal);
    assert.equal(JSON.stringify(origin), before); assert.equal(JSON.stringify(journal.origin_journal), before);
    assert.equal(journal.allocations.at(-1).phase, 'failed'); assert.deepEqual(journal.allocations, origin.allocations);
    assert.equal(nativeAllocationTotals(journal.allocations).known, false);
    const totals = nativeAllocationTotals(journal.allocations, journal.reconciliations);
    assert.equal(totals.known, true); assert.equal(totals.responses, origin.allocations.reduce((sum, entry) => sum + entry.consumption.responses_observed, 0));
    assert.equal(totals.bytes, origin.allocations.reduce((sum, entry) => sum + entry.consumption.storage_debit_bytes, 0) + 128);
    assert.equal(nativeAllocationResolution(journal.allocations.at(-1), journal.reconciliations).kind, 'reconciled_no_assignment');
    assert.equal(journal.reconciliations[0].permits_resume, false); assert.equal(journal.reconciliations[0].complete_resource_closure, false);
  });
  for (const origin of origins) check('reconciliation kernel requires separate fresh epoch after ' + origin.contract_version, () => {
    const journal = reconcile(origin), generation = journal.allocations.length + 1, bad = structuredClone(journal);
    const next = entryFor(generation, original); Object.assign(next, { phase: 'reserved', tree_closed: false, owned_status: null, first_failure: null,
      owned_result_sha256: null, tree_proof_sha256: null, checkpoint: null, closure_ref: null, consumption: null });
    bad.revision++; bad.allocations.push(next);
    assert.throws(() => assertNativeAllocationJournal(bad), /NATIVE_RECONCILIATION_NEW_AUTHORIZATION_REQUIRED/);
    const epoch = epochFor(journal, false, 4000000), activated = signer.seal({ ...journal, revision: journal.revision + 1, epochs: [...journal.epochs, epoch] });
    assertNativeAllocationJournal(activated);
    const effective = effectiveNativeEpochAuthorization(activated, epoch.grant.authorization), totals = nativeAllocationTotals(journal.allocations, journal.reconciliations);
    assert.equal(effective.max_bytes, epoch.grant.authorization.max_bytes - totals.bytes);
    assert.equal(effective.max_responses, epoch.grant.authorization.max_responses - totals.responses);
    const backdated = epochFor(journal, false, 2999000);
    assert.throws(() => assertNativeAllocationJournal(signer.seal({ ...journal, revision: journal.revision + 1, epochs: [...journal.epochs, backdated] })), /NATIVE_RECONCILIATION_NEW_AUTHORIZATION_REQUIRED/);
    assert.throws(() => effectiveNativeEpochAuthorization(activated, original), /EXACT_GRANT_REQUIRED/);
    next.authorization_sha256 = H(effective); next.limits = nativeLimitsOf(effective);
    const reserved = signer.seal({ ...activated, revision: activated.revision + 1, allocations: [...activated.allocations, next] });
    assertNativeAllocationJournal(reserved); assert.deepEqual(reserved.origin_journal, origin);
  });
  const base = reconcile(v1), proof = base.reconciliations[0];
  check('reconciliation kernel retains two distinct failed generations and rejects reused source events', () => {
    const epoch = epochFor(base, false, 4000000), activated = signer.seal({ ...base, revision: base.revision + 1, epochs: [epoch] });
    const effective = effectiveNativeEpochAuthorization(activated, epoch.grant.authorization);
    const failedAgain = signer.seal({ ...activated, revision: activated.revision + 2, allocations: [...activated.allocations, entryFor(2, effective)] });
    assertNativeAllocationJournal(failedAgain); assert.equal(nativeAllocationTotals(failedAgain.allocations, failedAgain.reconciliations).known, false);
    const nextProof = reconcile(failedAgain, 5000000).reconciliations[0];
    const resolvedAgain = signer.seal({ ...failedAgain, revision: failedAgain.revision + 1, reconciliations: [...failedAgain.reconciliations, nextProof] });
    assertNativeAllocationJournal(resolvedAgain); assert.equal(H(resolvedAgain.reconciliations[0]), H(proof));
    assert.deepEqual(resolvedAgain.origin_journal, v1); assert.equal(nativeAllocationTotals(resolvedAgain.allocations, resolvedAgain.reconciliations).bytes, 1024 + 2048 + 256);
    const reused = structuredClone(resolvedAgain), repeated = reused.reconciliations[1];
    repeated.grant.source_event_id = proof.grant.source_event_id; repeated.verification.grant_sha256 = H(repeated.grant);
    assert.throws(() => assertNativeAllocationJournal(signer.seal(reused)), /NATIVE_RECONCILIATION_SOURCE_REUSED/);
    const reordered = structuredClone(resolvedAgain); reordered.reconciliations.reverse();
    assert.throws(() => assertNativeAllocationJournal(signer.seal(reordered)), /NATIVE_RECONCILIATION_HISTORY_INVALID/);
  });
  for (const [name, mutate] of [
    ['unknown permission', r => { r.approved = true; }], ['effect permission', r => { r.permits_effects = true; }],
    ['resume permission', r => { r.permits_resume = true; }], ['renewal permission', r => { r.permits_native_renewal = true; }],
    ['global closure claim', r => { r.complete_resource_closure = true; }], ['erased original failure', r => { r.original_failure_preserved = false; }],
    ['unsupported post-assignment profile', r => { r.request.profile = 'assigned'; }], ['foreign checkpoint', r => { r.request.checkpoint_sha256 = H('other'); }],
    ['foreign scope', r => { r.request.scope_id = 'other'; }], ['missing discovery scope', r => { r.request.resources.pop(); }],
    ['duplicate resource', r => { r.request.resources[1] = r.request.resources[0]; }], ['missing closure resource', r => { r.grant.closure.resources.pop(); }],
    ['unclosed resource', r => { r.grant.closure.resources[0].state = 'active'; }], ['foreign resource evidence', r => { r.grant.closure.resources[0].resource_sha256 = H('other'); }],
    ['active resources', r => { r.grant.closure.active_resources = 1; }], ['incomplete discovery', r => { r.grant.closure.complete = false; }],
    ['storage refund', r => { r.grant.consumption.storage_debit_bytes = 0; }], ['unaccounted response', r => { r.grant.consumption.responses_observed = 1; }],
    ['invented native usage', r => { r.grant.consumption.native_usage_sha256 = H('usage'); }], ['foreign verification authority', r => { r.verification.authority_id = 'other'; }],
    ['foreign verification grant', r => { r.verification.grant_sha256 = H('other'); }], ['false native evidence class', r => { r.verification.evidence_class = 'native'; }],
    ['receipt before closure', r => { r.confirmed_at_ms = r.request.prepared_at_ms; }], ['foreign original allocation', r => { r.request.allocation_sha256 = H('other'); }],
  ]) check('reconciliation kernel refuses ' + name, () => {
    const value = structuredClone(base); mutate(value.reconciliations[0]);
    assert.throws(() => assertNativeReconciliationReceipt(value.reconciliations[0], { journal: value, entry: value.allocations[0] }), /NATIVE_RECONCILIATION_/);
    assert.throws(() => assertNativeAllocationJournal(signer.seal(value)), error => error.code === 'NATIVE_ALLOCATION_JOURNAL_INVALID' || /^NATIVE_RECONCILIATION_/.test(error.code));
  });
  for (const [name, mutate] of [
    ['rewritten original allocation', v => { v.allocations[0].consumption.storage_debit_bytes++; }],
    ['rewritten original container', v => { v.origin_journal.revision--; }], ['duplicate proof', v => { v.reconciliations.push(v.reconciliations[0]); }],
    ['missing proof', v => { v.reconciliations = []; }], ['unsupported recursive origin', v => { v.origin_journal = base; }],
    ['foreign origin model', v => { v.origin_journal.model_sha256 = H('other'); }],
  ]) check('reconciliation kernel refuses ' + name, () => { const value = structuredClone(base); mutate(value); assert.throws(() => assertNativeAllocationJournal(signer.seal(value)), /NATIVE_/); });
  check('reconciliation kernel keeps unresolved accounting without a proof and rejects arithmetic overflow', () => {
    const failed = v1.allocations[0]; assert.equal(nativeAllocationResolution(failed), null);
    const huge = { ...failed, phase: 'closed', consumption: consumption(Number.MAX_SAFE_INTEGER) };
    assert.throws(() => nativeAllocationTotals([huge, huge]), /CONSUMPTION_OVERFLOW/);
    assert.equal(nativeAllocationTotals([failed]).known, false);
  });
  check('reconciliation kernel accepts no host callback and supplies no source authentication', () => {
    assertNativeReconciliationRequest(proof.request); assertNativeReconciliationGrant(proof.grant, proof.request); assertNativeReconciliationReceipt(proof, { journal: base, entry: base.allocations[0] });
    const forged = structuredClone(base); forged.authentication = H('not-a-MAC'); assert.throws(() => signer.verify(forged));
    assert.deepEqual(nativeAllocationTotals([]), { known: true, responses: 0, bytes: 0 });
  });
  return { origin: structuredClone(v1), journal: structuredClone(base),
    origins: structuredClone(origins), journals: origins.map(origin => structuredClone(reconcile(origin))) };
}

export async function verifyNativeReconciliationKernelStorage(mode, fixture, check, owned = []) {
  const { createNativeAllocationJournalStore } = await import('../../src/adapters/runtime/native-allocation-journal-store.mjs');
  const { createFreshStandardWorkflowFixture } = await import('./standard-workflow-fixture-lib.mjs');
  const fs = await import('node:fs'), path = await import('node:path');
  const root = createFreshStandardWorkflowFixture(mode, owned), options = { targetRoot: root, stateMode: mode };
  check('reconciliation kernel canonical ' + mode + ' storage retains failed origin and refuses stale replacement', () => {
    const store = createNativeAllocationJournalStore(options), id = fixture.origin.journal_id;
    store.compareAndSwap(fixture.origin, null);
    if (mode === 'dual') store.materialize(id, { write: true });
    const first = store.read(id); assert.deepEqual(first.record, fixture.origin);
    store.compareAndSwap(fixture.journal, first.content_sha256);
    if (mode === 'dual') store.materialize(id, { write: true });
    const cold = createNativeAllocationJournalStore(options).read(id);
    assertNativeAllocationJournal(cold.record);
    const signer = createOperationJournalSigner(() => Buffer.alloc(32, 117));
    signer.verify(cold.record); signer.verify(cold.record.origin_journal); signer.verify(cold.record.reconciliations[0]);
    assert.deepEqual(cold.record, fixture.journal); assert.deepEqual(cold.record.origin_journal, fixture.origin);
    assert.equal(cold.record.allocations[0].phase, 'failed');
    assert.throws(() => store.compareAndSwap(fixture.origin, first.content_sha256));
    assert.deepEqual(store.read(id).record, cold.record);
    const visible = path.join(root, 'docs/audit/workflows/native-allocations', id + '.json');
    assert.equal(fs.existsSync(visible), mode !== 'db-only');
    assert.equal(nativeAllocationTotals(cold.record.allocations).known, false);
    assert.equal(nativeAllocationTotals(cold.record.allocations, cold.record.reconciliations).known, true);
  });
  return { mode, root, scope: 'CANONICAL_DATA_ROUNDTRIP_ONLY_SYNTHETIC_PROOFS', Native_calls: 0, writer_admission: false, workflow_resume: false };
}
