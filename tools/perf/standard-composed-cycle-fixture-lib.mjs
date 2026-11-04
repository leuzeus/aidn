import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { cyclePlanProposal } from './cycle-planning-fixture-lib.mjs';
import { createValidationProfileFixture } from './standard-cycle-validation-fixture-lib.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
import { standardReviewScenarioAnswer } from './standard-pr-review-scenario-fixture-lib.mjs';

// Scenario answers use host-authenticated context, never initial cycle parameters.
// These helpers remain fixture producers, not genuine Native/human authorities.
export function composedCyclePlan(observed) {
  const proposal = cyclePlanProposal(observed);
  if (observed.context.cycle_type === 'corrective') {
    const ref = 'TEST-002';
    proposal.tests[0].id = ref;
    proposal.tests[0].expected = 'The corrected exported value is 3 and its interface is unchanged';
    proposal.usage_matrix[0].test_refs = [ref];
    proposal.tasks[0].test_refs = [ref];
    proposal.tasks[0].done_criteria = ['The separate correction verifier confirms value 3 with the same exported interface'];
  }
  return proposal;
}

export function composedCycleValidationProfile(base) {
  const first = createValidationProfileFixture(base, { testRef: 'TEST-001' });
  const second = createValidationProfileFixture(path.join(base, 'correction-validation'), { testRef: 'TEST-002', expectedValue: 3 });
  const profile = { ...first.profile, checks: [...first.profile.checks, ...second.profile.checks.map(row => ({ ...row, snapshot_path: '_aidn_checks/correction.mjs' }))] };
  const bytes = JSON.stringify(profile), file = path.join(base, 'composed-validation-profile.json');
  fs.writeFileSync(file, bytes, { flag: 'wx' });
  return { path: file, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function composedCorrectionChoice(question, operationId) {
  assert.equal(question.contract_version, 'standard-pr-correction-question.v3');
  const number = question.cycle_constraints.minimum_cycle_number + 15;
  assert.ok(number <= 999999);
  const selected_cycle = { cycle_id: 'C' + String(number).padStart(3, '0'), title: 'human-selected-correction',
    objective: 'Correct the reviewed exported value to 3 through the admitted cycle and preserve its interface.' };
  return { contract_version: 'human-pr-correction-decision.v3', source_kind: 'human', authority_id: 'fixture_operator',
    source_event_id: 'standard:correction:' + operationId, subject_sha256: shadowHash(question.review), question_sha256: shadowHash(question),
    choice: 'create-correction-cycle', selected_cycle, cycle_sha256: shadowHash(selected_cycle),
    rationale: 'Fixture person selects a fresh cycle identity and objective for this exact current checkpoint.',
    evidence_refs: [{ ref: 'fixture:operator-correction', sha256: 'a'.repeat(64) }] };
}

// Fixture-only expectations are read before reserving Native. They never grant
// production authority; the worker independently authenticates its activity input.
export function prepareComposedNativeAnswer({ nodeId, instance, readOperation }) {
  const accepted = binding => {
    const event = instance.events.filter(row => row.kind === 'operation_intent' && row.intent.binding_ref === binding).at(-1);
    assert.ok(event, 'STANDARD_FIXTURE_NATIVE_SOURCE_REQUIRED');
    const record = readOperation(event.intent.operation_id), result = record.results.at(-1);
    assert.equal(result?.output.outcome, 'completed');
    assert.ok(instance.events.some(row => row.kind === 'operation_result'
      && row.receipt.operation_id === record.operation_id && shadowHash(row.receipt) === shadowHash(result.receipt)),
    'STANDARD_FIXTURE_NATIVE_ACCEPTED_SOURCE_REQUIRED');
    return record;
  };
  if (['session_pr_triage', 'correction_pr_triage'].includes(nodeId)) {
    const corrected = nodeId === 'correction_pr_triage';
    const update = accepted(corrected ? 'session_pr_redelivery_push' : 'session_pr_update_push');
    const received = accepted('session_pr_review_receive'), selection = accepted('session_pr_triage_select');
    assert.equal(received.preview.input.update_operation_id, update.operation_id);
    assert.equal(selection.preview.input.received_operation_id, received.operation_id);
    return Object.freeze({ kind: 'triage', scenario: corrected ? 'corrected' : 'correction',
      selection_operation_id: selection.operation_id, received_operation_id: received.operation_id,
      update_operation_id: update.operation_id });
  }
  if (nodeId === 'correction_implement') {
    const initialized = accepted('session_pr_correction_cycle_initialize');
    return Object.freeze({ kind: 'task', cycle_id: initialized.preview.input.cycle_id });
  }
  return null;
}

export function composedTriageAnswer(observed, source) {
  assert.equal(source?.kind, 'triage', 'STANDARD_FIXTURE_NATIVE_SOURCE_REQUIRED');
  assert.equal(observed.context.selection_operation_id, source.selection_operation_id);
  assert.equal(observed.context.received_operation_id, source.received_operation_id);
  assert.equal(observed.context.payload.observation.observations.update_operation_id, source.update_operation_id);
  return standardReviewScenarioAnswer(observed, source.scenario);
}
