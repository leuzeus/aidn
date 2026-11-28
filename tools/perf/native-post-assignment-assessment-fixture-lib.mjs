import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { assertNativeAllocationAssessment } from '../../src/core/workflow/native-allocation-assessment.mjs';
import { assertNativePostAssignmentAssessment, nativePostAssignmentEvidenceProfile } from '../../src/core/workflow/native-post-assignment-assessment.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

// Closed-data cases only. The caller supplies the ordinary synthetic failed
// fixture observation. This function creates no Native resource or authority.
export function verifyNativePostAssignmentAssessmentContracts(original, check) {
  const signer = createOperationJournalSigner(() => Buffer.alloc(32, 119));
  const { authentication, key_id, ...inventoryBody } = structuredClone(original.inventory);
  const allocation = inventoryBody.resources.find(r => r.kind === 'native_allocation');
  const journal = inventoryBody.resources.find(r => r.ref === 'native:' + original.assessment.journal_id);
  const dispatch = inventoryBody.resources.find(r => r.ref === 'native-dispatch:' + original.assessment.dispatch_id);
  allocation.ref = 'native:' + original.assessment.journal_id + '/2';
  allocation.details.generation = 2;
  allocation.details.initial_instance_sha256 = H('synthetic-initial-prefix-before-accepted-native-work');
  const inventory = signer.seal(inventoryBody);
  const { authentication: ignoredAuth, key_id: ignoredKey, ...body } = structuredClone(original.assessment);
  const base = signer.seal({ ...body, generation: 2, inventory_sha256: H(inventory),
    journal_sha256: journal.sha256, dispatch_sha256: dispatch.sha256, allocation_sha256: allocation.sha256,
    initial_instance_sha256: allocation.details.initial_instance_sha256, assignment_status: 'unknown',
    checkpoint: { ...body.checkpoint, responses_observed: 1, resources: 3, results: 4 } });
  assertNativeAllocationAssessment(base, inventory);
  const work = { prefix_relation: 'match', checkpoint_event_count: 9, current_event_count: 9,
    prior_checkpoint_sha256: H('synthetic-admitted-previous-checkpoint'),
    prior_resources: 2, total_resources: 3, generation_resources: 1,
    prior_results: 3, total_results: 4, generation_results: 1, generation_assignments: 1,
    unresolved_assignments: 0, history_preserved: true, worker_checkpoint_matches: true,
    worker_parent_closed: true, worker_generation_resources: 1, consumption_matches: true };
  const seal = (b, w) => signer.seal({ contract_version: 'native-post-assignment-assessment.v1', base_assessment: b,
    checkpoint_work: w, evidence_profile: nativePostAssignmentEvidenceProfile(b, w), business_effect: 'unknown',
    complete_resource_closure: false, permits_effects: false, permits_resume: false,
    permits_native_renewal: false, permits_owner_retirement: false, written: false });
  const valid = seal(base, work);
  assertNativePostAssignmentAssessment(valid, inventory);
  assert.equal(valid.evidence_profile, 'admitted_closed_checkpoint');
  check('post-assignment data retains cumulative resources3/results4 and generation-local closure1');
  for (const [name, mutate] of [
    ['effects', v => { v.permits_effects = true; }], ['resume', v => { v.permits_resume = true; }],
    ['renewal', v => { v.permits_native_renewal = true; }], ['retirement', v => { v.permits_owner_retirement = true; }],
    ['complete closure', v => { v.complete_resource_closure = true; }], ['write', v => { v.written = true; }],
    ['business success', v => { v.business_effect = 'confirmed'; }], ['JSON callback', v => { v.observer = {}; }],
    ['foreign key', v => { v.key_id = H('foreign-key'); }], ['foreign prefix', v => { v.base_assessment.instance_sha256 = H('foreign-prefix'); }],
    ['missing work property', v => { delete v.checkpoint_work.worker_parent_closed; }],
    ['resource refund', v => { v.checkpoint_work.generation_resources = 0; }],
    ['result refund', v => { v.checkpoint_work.generation_results = 0; }],
    ['ahead checkpoint', v => { v.checkpoint_work.current_event_count = 8; }],
    ['false extension', v => { v.checkpoint_work.prefix_relation = 'canonical_extension'; }],
    ['missing prior generation', v => { v.checkpoint_work.prior_checkpoint_sha256 = null; }],
  ]) {
    const value = structuredClone(valid); mutate(value);
    assert.throws(() => assertNativePostAssignmentAssessment(value, inventory), e => /NATIVE_.*ASSESSMENT_/.test(e.code));
    check('post-assignment data refuses ' + name);
  }
  for (const [name, mutate] of [
    ['missing worker checkpoint', w => { w.worker_checkpoint_matches = false; }],
    ['missing worker closure', w => { w.worker_parent_closed = false; }],
    ['cumulative closure count', w => { w.worker_generation_resources = 3; }],
    ['unknown closure count', w => { w.worker_generation_resources = null; }],
    ['unknown consumption', w => { w.consumption_matches = false; }],
    ['changed history', w => { w.history_preserved = false; }],
    ['unresolved assignment', w => { w.unresolved_assignments = 1; }],
    ['no generation assignment', w => { w.generation_assignments = 0; }],
  ]) {
    const changed = structuredClone(work); mutate(changed);
    const value = seal(base, changed);
    assertNativePostAssignmentAssessment(value, inventory); assert.equal(value.evidence_profile, 'unknown');
    const forged = { ...value, evidence_profile: 'admitted_closed_checkpoint' };
    assert.throws(() => assertNativePostAssignmentAssessment(forged, inventory), { code: 'NATIVE_POST_ASSIGNMENT_ASSESSMENT_INVALID' });
    check('post-assignment incomplete ' + name + ' stays unknown and cannot claim complete evidence');
  }
  assert.equal(assertNativePostAssignmentAssessment(seal(base, null), inventory).evidence_profile, 'unknown');
  check('post-assignment missing admitted work remains unknown');
  assert.throws(() => assertNativeAllocationAssessment(valid, inventory), { code: 'NATIVE_ALLOCATION_ASSESSMENT_INVALID' });
  check('legacy no-assignment assessment does not reinterpret the new profile');
  const interruptedBase = signer.seal({ ...base, checkpoint: { ...base.checkpoint, responses_observed: 3, results: 3 } });
  const interruptedWork = { ...work, total_results: 3, generation_results: 0, unresolved_assignments: 1,
    interrupted_assignment: { assignment_sha256: H('single-interrupted-assignment'),
      initial_instance_sha256: interruptedBase.initial_instance_sha256, authorized_responses: 2,
      product_preimage_sha256: H('unchanged-product'), observed_product_sha256: H('unchanged-product'),
      reason_code: 'PROCESS_EXECUTION_RESPONSE_LIMIT' } };
  const interrupted = assertNativePostAssignmentAssessment(seal(interruptedBase, interruptedWork), inventory);
  assert.equal(interrupted.evidence_profile, 'admitted_interrupted_checkpoint');
  assert.equal(interrupted.business_effect, 'unknown');
  assert.equal(interrupted.permits_resume, false);
  check('interrupted assignment keeps three responses and provides resource evidence only');
  for (const [name, mutate] of [
    ['removed proof', w => { delete w.interrupted_assignment; }],
    ['changed product', w => { w.interrupted_assignment.observed_product_sha256 = H('changed-product'); }],
    ['foreign pre-assignment prefix', w => { w.interrupted_assignment.initial_instance_sha256 = H('foreign-prefix'); }],
    ['limit without overrun', w => { w.interrupted_assignment.authorized_responses = 3; }],
    ['additional assignment', w => { w.generation_assignments = 2; }],
    ['unclosed worker', w => { w.worker_parent_closed = false; }],
  ]) {
    const value = structuredClone(interruptedWork); mutate(value);
    const observed = seal(interruptedBase, value);
    assert.equal(assertNativePostAssignmentAssessment(observed, inventory).evidence_profile, 'unknown');
    const forged = { ...observed, evidence_profile: 'admitted_interrupted_checkpoint' };
    assert.throws(() => assertNativePostAssignmentAssessment(forged, inventory), { code: 'NATIVE_POST_ASSIGNMENT_ASSESSMENT_INVALID' });
    check('interrupted Native assessment rejects ' + name);
  }
  return { checks: 34, native_calls: 0, authority: 'synthetic_closed_data_only' };
}


async function verifyInheritedCheckpoint({ mode, mixedFixture, bootstrapMixed, tree }) {
  const f = mixedFixture(mode, { cancelWorkerGeneration: 2 });
  const authorization = await bootstrapMixed(f), host = f.open();
  const first = await host.step({ write: true, authorization });
  assert.equal(first.journal_phase, 'closed');
  const prior = host.inspectAllocations().allocations[0];
  const priorState = host.readCheckpoint(1).state;
  assert.equal(priorState.resources.length, 1);
  assert.equal(priorState.results.length, 1);
  assert.equal((await host.step({ write: true })).kind, 'operation');
  const beforeSecond = host.inspect().record;
  const second = await host.step({ write: true, authorization: { ...authorization, authorized_at_ms: Date.now() } });
  assert.equal(second.journal_phase, 'failed', second.first_failure);
  assert.equal(second.first_failure, 'PROCESS_EXECUTION_CANCELLED');
  const journal = host.inspectAllocations(), entry = journal.allocations.at(-1);
  assert.deepEqual(journal.allocations[0], prior);
  assert.equal(entry.generation, 2);
  assert.equal(entry.initial_instance_sha256, beforeSecond.instance_sha256);
  assert.equal(entry.checkpoint.instance_sha256, beforeSecond.instance_sha256);
  assert.equal(entry.consumption.responses_observed, 0);
  assert.ok(entry.consumption.storage_debit_bytes > 0);
  assert.equal(f.t.sessions.length, 1);

  const artifacts = createStandardWorkflowArtifacts({ targetRoot: f.configuration.target_root });
  const dispatch = artifacts.observeInventory().rows.filter(row => row.path.startsWith('workflows/native-dispatches/'))
    .map(row => JSON.parse(row.content)).find(row => row.native_journal_after_sha256 === H(journal));
  const input = { expectedSha256: beforeSecond.instance_sha256, dispatchId: dispatch.dispatch_id, generation: 2 };
  const signer = createOperationJournalSigner(() => f.key);
  const beforeRead = { project: tree(f.configuration.target_root), native: tree(f.base) };
  const { inventory, assessment } = f.reopen().prepareNativeAllocationAssessment(input);
  signer.verify(inventory); signer.verify(assessment);
  assertNativeAllocationAssessment(assessment, inventory);
  assert.equal(assessment.assignment_status, 'no_assignment');
  assert.equal(assessment.checkpoint.inherited_checkpoint_sha256, prior.checkpoint.sha256);
  assert.equal(assessment.checkpoint.resources, priorState.resources.length);
  assert.equal(assessment.checkpoint.results, priorState.results.length);
  assert.equal(assessment.native_accounting_known, false);
  assert.equal(assessment.permits_owner_retirement, false);
  assert.equal(assessment.business_effect, 'unknown');
  for (const inherited of [undefined, null, entry.checkpoint.sha256]) {
    const invalid = structuredClone(assessment);
    if (inherited === undefined) delete invalid.checkpoint.inherited_checkpoint_sha256;
    else invalid.checkpoint.inherited_checkpoint_sha256 = inherited;
    assert.throws(() => assertNativeAllocationAssessment(signer.seal(invalid), inventory),
      error => /NATIVE_ALLOCATION_ASSESSMENT_/.test(error.code));
  }
  const post = f.reopen().prepareNativePostAssignmentAssessment(input);
  assertNativePostAssignmentAssessment(post.assessment, post.inventory);
  assert.equal(post.assessment.evidence_profile, 'unknown');
  for (const kind of ['assignments', 'resources', 'results']) assert.equal(post.assessment.checkpoint_work['generation_' + kind], 0);
  const original = fs.readFileSync(prior.checkpoint.path);
  try {
    fs.appendFileSync(prior.checkpoint.path, '\n');
    assert.throws(() => f.reopen().prepareNativeAllocationAssessment(input), { code: 'NATIVE_ALLOCATION_EVIDENCE_CHANGED' });
  } finally { fs.writeFileSync(prior.checkpoint.path, original); }
  assert.deepEqual({ project: tree(f.configuration.target_root), native: tree(f.base) }, beforeRead);
  console.log('PASS native resumed assessment ' + mode + ': inherited resources/results, zero new work, altered predecessor refused');
  return { scenario: 'cancelled_before_assignment_with_inherited_work', mode, launches: f.launches,
    first_failure: entry.first_failure, consumption: entry.consumption, work: post.assessment.checkpoint_work,
    assignment_status: assessment.assignment_status, history_retained: true };
}

// Real common-host and allocator ports with controlled Native RPC and controlled
// supervisor closure. No historical fixture bytes or authorization are edited.
export async function verifyNativePostAssignmentHostFixture({ mode, mixedFixture, bootstrapMixed }) {
  assert.ok(['dual', 'db-only'].includes(mode));
  const rows = [];
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const tree = root => {
    const out = { files: {}, directories: [] };
    const visit = dir => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(dir, e.name), rel = path.relative(root, file);
        if (e.isSymbolicLink()) out.files[rel] = 'LINK:' + fs.readlinkSync(file);
        else if (e.isDirectory()) { out.directories.push(rel); visit(file); }
        else out.files[rel] = hash(fs.readFileSync(file));
      }
    };
    visit(root); return out;
  };
  for (const scenario of ['confirmed_return_failure', 'unknown_native_tree']) {
    const { f, authorization, beforeNative, result } = await createNativePostAssignmentHostFixture({ mode, scenario, mixedFixture, bootstrapMixed });
    assert.equal(result.kind, 'native');
    const journal = f.open().inspectAllocations(), entry = journal.allocations.at(-1);
    assert.equal(journal.allocations.length, 1); assert.equal(entry.generation, 1);
    assert.equal(entry.phase, scenario === 'confirmed_return_failure' ? 'failed' : 'unresolved');
    assert.equal(result.first_failure, scenario === 'confirmed_return_failure' ? 'FIXTURE_POST_NATIVE_RETURN_FAILURE' : 'PROCESS_EXECUTION_TREE_CLOSE_UNCONFIRMED');
    assert.ok(entry.checkpoint); assert.ok(entry.closure_ref); assert.ok(entry.consumption);
    assert.equal(entry.initial_instance_sha256, beforeNative.instance_sha256);
    assert.notEqual(entry.checkpoint.instance_sha256, entry.initial_instance_sha256);
    assert.ok(entry.consumption.responses_observed > 0); assert.ok(entry.consumption.storage_debit_bytes > 0);
    assert.equal(f.launches, 1); assert.equal(f.t.sessions.every(s => s.closed), true);
    const artifacts = createStandardWorkflowArtifacts({ targetRoot: f.configuration.target_root });
    const dispatchRows = artifacts.observeInventory().rows.filter(r => r.path.startsWith('workflows/native-dispatches/'));
    assert.equal(dispatchRows.length, 1);
    const dispatch = JSON.parse(dispatchRows[0].content);
    assert.equal(dispatch.phase, 'returned');
    const signer = createOperationJournalSigner(() => f.key); signer.verify(journal); signer.verify(dispatch);
    const diagnostic = f.open().inspectDiagnostic();
    assert.equal(diagnostic.record.instance_sha256, entry.checkpoint.instance_sha256);
    assert.deepEqual(diagnostic.record.events.slice(0, beforeNative.events.length), beforeNative.events);
    assert.ok(diagnostic.record.events.some(e => e.kind === 'assign'));
    assert.ok(diagnostic.record.events.some(e => e.kind === 'result'));
    const input = { expectedSha256: diagnostic.record.instance_sha256, dispatchId: dispatch.dispatch_id, generation: entry.generation };
    const beforeRead = { project: tree(f.configuration.target_root), native: tree(f.base) };
    const post = f.open().prepareNativePostAssignmentAssessment(input);
    signer.verify(post.inventory); signer.verify(post.assessment); signer.verify(post.assessment.base_assessment);
    assertNativePostAssignmentAssessment(post.assessment, post.inventory);
    assert.equal(post.assessment.base_assessment.assignment_status, 'unknown');
    assert.equal(post.assessment.evidence_profile, scenario === 'confirmed_return_failure' ? 'admitted_closed_checkpoint' : 'unknown');
    assert.ok(post.assessment.checkpoint_work.generation_assignments > 0);
    assert.equal(post.assessment.checkpoint_work.generation_results, post.assessment.checkpoint_work.generation_assignments);
    assert.equal(post.assessment.checkpoint_work.unresolved_assignments, 0);
    assert.equal(post.assessment.checkpoint_work.worker_parent_closed, true);
    assert.equal(post.assessment.checkpoint_work.worker_checkpoint_matches, true);
    assert.equal(post.assessment.checkpoint_work.consumption_matches, true);
    for (const key of ['permits_effects', 'permits_resume', 'permits_native_renewal', 'permits_owner_retirement', 'complete_resource_closure', 'written']) assert.equal(post.assessment[key], false);
    assert.equal(post.assessment.business_effect, 'unknown');
    const cold = f.reopen().prepareNativePostAssignmentAssessment(input);
    signer.verify(cold.assessment); assertNativePostAssignmentAssessment(cold.assessment, cold.inventory);
    assert.equal(cold.assessment.evidence_profile, post.assessment.evidence_profile);
    assert.deepEqual(cold.assessment.checkpoint_work, post.assessment.checkpoint_work);
    assert.throws(() => f.open().inspect(), { code: 'STANDARD_PROCESS_NATIVE_ALLOCATION_ACTIVE' });
    await assert.rejects(f.open().step({ write: true, authorization }), { code: 'STANDARD_PROCESS_NATIVE_ALLOCATION_ACTIVE' });
    assert.throws(() => f.open().prepareNativeOwnerDisposition(input), { code: 'NATIVE_OWNER_DISPOSITION_UNPROVEN_EFFECTS' });
    assert.throws(() => f.open().prepareNativeAllocationReconciliation(input), { code: 'NATIVE_RECONCILIATION_NO_ASSIGNMENT_REQUIRED' });
    assert.equal(f.launches, 1);
    assert.deepEqual(f.open().inspectAllocations(), journal);
    assert.deepEqual({ project: tree(f.configuration.target_root), native: tree(f.base) }, beforeRead);
    rows.push({ scenario, mode, project_root: f.configuration.target_root, native_root: f.base,
      journal_id: journal.journal_id, journal_sha256: H(journal), dispatch_id: dispatch.dispatch_id,
      initial_instance_sha256: entry.initial_instance_sha256, checkpoint_instance_sha256: entry.checkpoint.instance_sha256,
      phase: entry.phase, first_failure: entry.first_failure, consumption: entry.consumption,
      work: post.assessment.checkpoint_work, evidence_profile: post.assessment.evidence_profile,
      original_events_retained: beforeNative.events.length, current_events: diagnostic.record.events.length,
      allocations: 1, launches: f.launches, all_original_bytes_and_directories_unchanged_after_read: true,
      ordinary_resume_and_legacy_no_assignment_writers_refused: true });
    console.log('PASS native post-assignment ' + mode + ': ' + scenario + ' through actual common-host/allocator/assignment/result/checkpoint ports, cold read and no replay');
  }
  rows.push(await verifyInheritedCheckpoint({ mode, mixedFixture, bootstrapMixed, tree }));
  return { mode, scenarios: rows, Native_RPC: 'controlled', supervisor_Native_tree_proof: 'controlled',
    common_host_and_canonical_ports: 'actual', model_calls: 0, genuine_native_client: 'NOT_RUN',
    post_assignment_retirement_reconciliation_resume: 'NOT_RUN', published_STANDARD: 'NOT_QUALIFIED', full_plan: false };
}


export async function createNativePostAssignmentHostFixture({ mode, scenario = 'confirmed_return_failure', protectedHome = null, mixedFixture, bootstrapMixed }) {
  assert.ok(['dual', 'db-only'].includes(mode));
  assert.ok(['confirmed_return_failure', 'unknown_native_tree'].includes(scenario));
  const f = mixedFixture(mode, { postAssignmentReturnFailure: scenario === 'confirmed_return_failure', treeUnknown: scenario === 'unknown_native_tree' });
  if (protectedHome) f.configuration.native.protected_roots = [...(f.configuration.native.protected_roots ?? []), protectedHome];
  const authorization = await bootstrapMixed(f);
  const beforeNative = f.open().inspect().record;
  const result = await f.open().step({ write: true, authorization });
  assert.equal(result.kind, 'native');
  assert.equal(f.launches, 1);
  return { f, authorization, beforeNative, result };
}
