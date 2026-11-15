import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';
import { assertNativeAllocationJournal } from '../../src/core/workflow/native-allocation-journal.mjs';
import { nativeAllocationTotals, nativeLimitsOf, effectiveNativeEpochAuthorization } from '../../src/core/workflow/native-authorization-epoch.mjs';
import { assertNativeReconciliationRequest, assertNativeReconciliationGrant, assertNativeReconciliationReceipt,
  nativeAllocationResolution, nativeReconciliationPostAssignmentSubject } from '../../src/core/workflow/native-allocation-reconciliation.mjs';
import { verifyNativeReconciliationKernel, verifyNativeReconciliationKernelStorage } from './native-reconciliation-kernel-fixture-lib.mjs';

// All work, closures, approvals and signatures constructed here are synthetic
// closed DATA. Storage checks exercise canonical stores, never a live writer,
// resource discoverer, Native process, human consent or productive resume.
export function verifyNativePostAssignmentReconciliationContracts(check) {
  const legacy = verifyNativeReconciliationKernel(check), signer = createOperationJournalSigner(() => Buffer.alloc(32, 117));
  const body = ({ key_id, authentication, ...value }) => value, seal = value => signer.seal(body(value));
  const initialOf = journal => journal.initial_authorization ?? { approved: true, model_allowed: true, ...journal.allocations[0].limits };
  const allocationResource = entry => ({ kind: 'allocation', generation: entry.generation, owner_id: entry.owner_id,
    closure_sha256: entry.closure_ref.sha256, checkpoint_sha256: entry.checkpoint.sha256 });
  const scopeResource = journal => ({ kind: 'native_scope', instance_id: journal.instance_id, scope_id: journal.scope_id,
    configuration_sha256: journal.allocations[0].configuration_sha256 });
  const closure = q => ({ contract_version: 'native-resource-closure.v1', request_sha256: H(q), inventory_sha256: H(q.resources),
    observed_at_ms: (q.prepared_at_ms ?? q.issued_at_ms) + 1, complete: true, active_resources: 0, evidence_class: 'fixture',
    resources: q.resources.map(resource => ({ resource_sha256: H(resource), state: 'closed',
      evidence_refs: [{ ref: 'fixture:synthetic-complete-native-scope', sha256: H(resource) }] })) });
  function epoch(journal, issued = 6000000) {
    const initial = initialOf(journal), scopeRequest = journal.contract_version === 'native-allocation-journal.v5';
    const resources = [...journal.allocations.map(allocationResource), ...(scopeRequest ? [scopeResource(journal)] : [])];
    const q = seal({ contract_version: scopeRequest ? 'native-authorization-epoch-request.v2' : 'native-authorization-epoch-request.v1', request_id: 'fixture-post-epoch-' + issued,
      instance_id: journal.instance_id, scope_id: journal.scope_id, model_sha256: journal.model_sha256,
      configuration_sha256: initial.configuration_sha256, instance_sha256: H('fixture-current-' + issued), product_sha256: H('fixture-product'),
      journal_sha256: H(journal), allocations_sha256: H(journal.allocations), previous_epoch_sha256: journal.epochs?.length ? H(journal.epochs.at(-1)) : null,
      epoch: (journal.epochs?.length ?? 0) + 2, next_generation: journal.allocations.length + 1, initial_authorization: initial,
      consumption: nativeAllocationTotals(journal.allocations, journal.reconciliations), resources, issued_at_ms: issued, expires_at_ms: issued + 300000 });
    const grant = { contract_version: 'native-authorization-epoch-grant.v1', authority_id: 'fixture_native_owner', source_event_id: 'fixture-post-epoch-source-' + issued,
      request_sha256: H(q), authorization: { ...initial, authorized_at_ms: issued + 1, global_deadline_ms: issued + 600001, workflow_deadline_ms: issued + 600001 },
      closure: closure(q), evidence_refs: [{ ref: 'fixture:synthetic-fresh-epoch-consent', sha256: H(issued) }] };
    return { epoch: q.epoch, start_generation: q.next_generation, request: q, grant };
  }
  function accepted(entry) {
    const result = structuredClone(entry), generation = entry.generation;
    result.first_failure = 'FIXTURE_POST_ASSIGNMENT_RETURN_FAILURE';
    result.checkpoint.instance_sha256 = H('fixture-accepted-instance-' + generation);
    result.consumption = { responses_observed: 1, response_sha256: [H('fixture-observed-response-' + generation)],
      storage_debit_bytes: entry.consumption.storage_debit_bytes, native_usage_sha256: H('fixture-observed-usage-' + generation) };
    return result;
  }
  function appendFailure(journal) {
    const nextEpoch = epoch(journal, 4000000), activated = seal({ ...journal, revision: journal.revision + 1, epochs: [...journal.epochs, nextEpoch] });
    assertNativeAllocationJournal(activated);
    const effective = effectiveNativeEpochAuthorization(activated, nextEpoch.grant.authorization), generation = journal.allocations.length + 1;
    const entry = accepted({ ...structuredClone(journal.allocations.at(-1)), generation, owner_id: 'fixture-post-owner-' + generation,
      authorization_sha256: H(effective), limits: nativeLimitsOf(effective), initial_instance_sha256: H('fixture-new-prefix-' + generation),
      checkpoint: { path: 'fixture/post-checkpoint-' + generation + '.json', sha256: H('fixture-post-checkpoint-' + generation),
        state_sha256: H('fixture-post-state-' + generation), instance_sha256: H('overwritten-fixture-prefix') },
      consumption: { storage_debit_bytes: 2048 * generation } });
    return seal({ ...activated, revision: activated.revision + 2, allocations: [...activated.allocations, entry] });
  }
  const origins = [...legacy.origins.map(journal => { const copy = structuredClone(journal); copy.allocations[copy.allocations.length - 1] = accepted(copy.allocations.at(-1)); return seal(copy); }),
    ...legacy.journals.map(appendFailure)];
  function reconcile(origin) {
    const entry = origin.allocations.at(-1), generation = entry.generation, prepared = 5000000;
    const resources = Array.from({ length: generation }, (_, i) => ({ kind: 'native_session', execution_id: 'fixture-execution-' + i,
      agent_id: 'fixture-agent-' + i, lineage_id: 'fixture-lineage-' + i, session_id: 'fixture-session-' + i, adapter_id: 'codex-agentic-session' }));
    const scope = { instance_id: origin.instance_id, scope_id: origin.scope_id, model_sha256: origin.model_sha256 };
    const base = seal({ contract_version: 'native-allocation-assessment.v1', instance_id: origin.instance_id, instance_sha256: entry.checkpoint.instance_sha256,
      configuration_sha256: entry.configuration_sha256, inventory_sha256: H('fixture-inventory-' + H(origin)), observed_at_ms: prepared,
      journal_id: origin.journal_id, journal_sha256: H(origin), allocation_sha256: H(entry), generation, allocation_phase: 'failed',
      initial_instance_sha256: entry.initial_instance_sha256, dispatch_id: 'native_dispatch_' + H('fixture-post-dispatch-' + generation).slice(0, 40),
      dispatch_sha256: H('fixture-post-dispatch-record-' + generation), checkpoint: { sha256: entry.checkpoint.sha256, state_sha256: entry.checkpoint.state_sha256,
        instance_sha256: entry.checkpoint.instance_sha256, closure_sha256: entry.closure_ref.sha256, parent_closed: true,
        responses_observed: 1, resources: generation, results: generation, os_tree_confirmed: true }, return_binding: 'matched', assignment_status: 'unknown',
      native_accounting_known: false, lease_statuses: ['held'], business_effect: 'unknown', complete_resource_closure: false,
      permits_effects: false, permits_resume: false, permits_native_renewal: false, permits_owner_retirement: false, written: false });
    const assessment = seal({ contract_version: 'native-post-assignment-assessment.v1', base_assessment: base,
      checkpoint_work: { prefix_relation: 'match', checkpoint_event_count: generation * 10, current_event_count: generation * 10,
        prior_checkpoint_sha256: generation === 1 ? null : origin.allocations[generation - 2].checkpoint.sha256,
        prior_resources: generation - 1, total_resources: generation, generation_resources: 1, prior_results: generation - 1, total_results: generation,
        generation_results: 1, generation_assignments: 1, unresolved_assignments: 0, history_preserved: true,
        worker_checkpoint_matches: true, worker_parent_closed: true, worker_generation_resources: 1, consumption_matches: true },
      evidence_profile: 'admitted_closed_checkpoint', business_effect: 'unknown', complete_resource_closure: false,
      permits_effects: false, permits_resume: false, permits_native_renewal: false, permits_owner_retirement: false, written: false });
    const request = seal({ contract_version: 'native-allocation-reconciliation-request.v2', request_id: '00000000-0000-4000-8000-000000001356', profile: 'admitted_post_assignment',
      journal_id: origin.journal_id, ...scope, configuration_sha256: entry.configuration_sha256, instance_sha256: base.instance_sha256,
      physical_root_sha256: H('fixture-physical-root'), inventory_sha256: base.inventory_sha256, journal_sha256: H(origin), allocations_sha256: H(origin.allocations),
      generation, allocation_sha256: H(entry), dispatch_id: base.dispatch_id, dispatch_sha256: base.dispatch_sha256,
      checkpoint_sha256: entry.checkpoint.sha256, checkpoint_state_sha256: entry.checkpoint.state_sha256, checkpoint_instance_sha256: entry.checkpoint.instance_sha256,
      initial_instance_sha256: entry.initial_instance_sha256, closure_sha256: entry.closure_ref.sha256,
      checkpoint_resources_sha256: H(resources.map(executor => ({ executor }))), checkpoint_resource_count: resources.length,
      post_assignment_assessment: assessment, post_assignment_sha256: H(nativeReconciliationPostAssignmentSubject(assessment)),
      owner_retirement_receipt_sha256: H('fixture-post-owner-retirement'), minimum_consumption: structuredClone(entry.consumption),
      resources: [allocationResource(entry), ...resources, scopeResource(origin)], prepared_at_ms: prepared });
    const grant = { contract_version: 'native-allocation-reconciliation-grant.v2', profile: request.profile, post_assignment_sha256: request.post_assignment_sha256,
      authority_id: 'fixture_native_owner', source_event_id: 'fixture-post-reconciliation-' + H(origin), request_sha256: H(request),
      consumption: { ...structuredClone(entry.consumption), storage_debit_bytes: entry.consumption.storage_debit_bytes + 128 }, closure: closure(request),
      evidence_refs: [{ ref: 'fixture:synthetic-nonrefunded-final-consumption', sha256: H(entry.consumption) }] };
    const receipt = seal({ contract_version: 'native-allocation-reconciliation-receipt.v2', request, grant,
      verification: { outcome: 'verified', authority_id: grant.authority_id, request_sha256: H(request), grant_sha256: H(grant), evidence_class: 'fixture' },
      confirmed_at_ms: prepared + 2, original_failure_preserved: true, accounting_reconciled: true, permits_effects: false, permits_resume: false,
      permits_native_renewal: false, complete_resource_closure: false, native_started: false });
    const journal = seal({ contract_version: 'native-allocation-journal.v5', journal_id: origin.journal_id, ...scope, revision: origin.revision + 1,
      allocations: structuredClone(origin.allocations), initial_authorization: initialOf(origin), epochs: structuredClone(origin.epochs ?? []),
      origin_journal: origin.contract_version === 'native-allocation-journal.v5' ? origin.origin_journal : structuredClone(origin),
      reconciliations: [...structuredClone(origin.reconciliations ?? []), receipt] });
    return { origin, request, grant, receipt, journal };
  }
  const fixtures = origins.map(reconcile);
  for (const [index, fixture] of fixtures.entries()) check('post-assignment contracts retain origin ' + index + ' and every observed debit', () => {
    const { origin, request, grant, receipt, journal } = fixture, before = JSON.stringify(origin);
    assertNativeAllocationJournal(origin); assertNativeReconciliationRequest(request); assertNativeReconciliationGrant(grant, request);
    assertNativeReconciliationReceipt(receipt, { journal, entry: journal.allocations.at(-1) }); assertNativeAllocationJournal(journal);
    assert.equal(JSON.stringify(origin), before); assert.equal(JSON.stringify(journal.origin_journal), before);
    assert.deepEqual(journal.allocations, origin.allocations); assert.deepEqual(journal.epochs, origin.epochs ?? []);
    assert.deepEqual(journal.reconciliations.slice(0, -1), origin.reconciliations ?? []);
    const actual = nativeAllocationTotals(journal.allocations, journal.reconciliations);
    assert.equal(actual.known, true); assert.equal(nativeAllocationTotals(origin.allocations, origin.reconciliations).known, false);
    assert.equal(actual.responses, journal.allocations.reduce((sum, row) => sum + row.consumption.responses_observed, 0));
    assert.equal(nativeAllocationResolution(journal.allocations.at(-1), journal.reconciliations).kind, 'reconciled_post_assignment');
    assert.equal(journal.allocations.at(-1).phase, 'failed'); assert.equal(receipt.permits_resume, false); assert.equal(receipt.complete_resource_closure, false);
  });
  for (const [index, fixture] of fixtures.entries()) check('post-assignment contracts require a fresh independently granted epoch ' + index, () => {
    const next = epoch(fixture.journal), activated = seal({ ...fixture.journal, revision: fixture.journal.revision + 1, epochs: [...fixture.journal.epochs, next] });
    assertNativeAllocationJournal(activated);
    const effective = effectiveNativeEpochAuthorization(activated, next.grant.authorization), totals = nativeAllocationTotals(fixture.journal.allocations, fixture.journal.reconciliations);
    assert.equal(effective.max_responses, next.grant.authorization.max_responses - totals.responses);
    assert.equal(effective.max_bytes, next.grant.authorization.max_bytes - totals.bytes);
    const late = epoch(fixture.journal, 4999000);
    assert.throws(() => assertNativeAllocationJournal(seal({ ...fixture.journal, revision: fixture.journal.revision + 1, epochs: [...fixture.journal.epochs, late] })), /NATIVE_RECONCILIATION_NEW_AUTHORIZATION_REQUIRED/);
  });
  const first = fixtures[0];
  for (const [name, mutate] of [
    ['initial/current identity substitution', q => { q.initial_instance_sha256 = q.instance_sha256; }],
    ['checkpoint substitution', q => { q.checkpoint_instance_sha256 = H('foreign'); }],
    ['post-assignment digest substitution', q => { q.post_assignment_sha256 = H('foreign'); }],
    ['missing Native scope', q => { q.resources = q.resources.filter(row => row.kind !== 'native_scope'); }],
    ['missing known session', q => { q.resources = q.resources.filter(row => row.kind !== 'native_session'); }],
    ['duplicate known session', q => { q.resources.push(q.resources.find(row => row.kind === 'native_session')); }],
    ['unknown response accounting', q => { q.minimum_consumption.responses_observed = 0; }],
    ['unresolved assignment', q => { q.post_assignment_assessment.checkpoint_work.unresolved_assignments = 1; }],
    ['inconsistent cumulative work', q => { q.post_assignment_assessment.checkpoint_work.prior_resources = 100; }],
    ['unknown Native closure', q => { q.post_assignment_assessment.base_assessment.checkpoint.os_tree_confirmed = false; }],
    ['extra callback', q => { q.callback = true; }],
  ]) check('post-assignment request refuses ' + name, () => { const q = structuredClone(first.request); mutate(q); assert.throws(() => assertNativeReconciliationRequest(q), /NATIVE_/); });
  for (const [name, mutate] of [
    ['response refund', g => { g.consumption.responses_observed = 0; g.consumption.response_sha256 = []; }],
    ['response substitution', g => { g.consumption.response_sha256[0] = H('foreign'); }],
    ['storage refund', g => { g.consumption.storage_debit_bytes = 0; }],
    ['lost observed usage', g => { g.consumption.native_usage_sha256 = null; }],
    ['foreign profile digest', g => { g.post_assignment_sha256 = H('foreign'); }],
    ['missing scope closure', g => { g.closure.resources.pop(); }],
    ['active resource', g => { g.closure.active_resources = 1; }],
    ['incomplete discovery', g => { g.closure.complete = false; }],
  ]) check('post-assignment grant refuses ' + name, () => { const g = structuredClone(first.grant); mutate(g); assert.throws(() => assertNativeReconciliationGrant(g, first.request), /NATIVE_/); });
  for (const key of ['permits_effects', 'permits_resume', 'permits_native_renewal', 'complete_resource_closure', 'native_started']) check('post-assignment receipt denies ' + key, () => {
    const value = structuredClone(first.receipt); value[key] = true; assert.throws(() => assertNativeReconciliationReceipt(value), /NATIVE_/);
  });
  check('v5 preserves inherited v4 proofs and refuses their replacement or a legacy downgrade', () => {
    const fixture = fixtures[3], changed = structuredClone(fixture.journal); changed.reconciliations[0].confirmed_at_ms++;
    assert.throws(() => assertNativeAllocationJournal(seal(changed)), /NATIVE_/);
    const downgraded = structuredClone(first.journal); downgraded.contract_version = 'native-allocation-journal.v4';
    assert.throws(() => assertNativeAllocationJournal(seal(downgraded)), /NATIVE_/);
    const missing = structuredClone(first.journal); missing.reconciliations = []; assert.throws(() => assertNativeAllocationJournal(seal(missing)), /NATIVE_/);
  });
  check('independent final accounting may retain additional responses without rewriting original consumption', () => {
    const value = structuredClone(first.grant); value.consumption.responses_observed++;
    value.consumption.response_sha256.push(H('fixture-additionally-observed-response')); assertNativeReconciliationGrant(value, first.request);
    assert.equal(first.origin.allocations[0].consumption.responses_observed, 1);
  });
  return { origin: structuredClone(first.origin), journal: structuredClone(first.journal) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let checks = 0; const check = (name, fn) => { fn(); checks++; console.log('PASS ' + name); };
    const fixture = verifyNativePostAssignmentReconciliationContracts(check), mode = process.argv[2], owned = [];
    if (mode) { assert.ok(['files', 'dual', 'db-only'].includes(mode)); await verifyNativeReconciliationKernelStorage(mode, fixture, check, owned); }
    console.log(JSON.stringify({ status: 'PASS_POST_ASSIGNMENT_RECONCILIATION_DATA', checks, mode: mode ?? null, retained_arenas: owned,
      closure_and_consent: 'SYNTHETIC_DATA', actual_canonical_store: Boolean(mode), physical_reconciliation_writer: 'NOT_RUN', Native_calls: 0, full_standard: false }));
  } catch (error) { console.error(error); process.exitCode = 1; }
}
