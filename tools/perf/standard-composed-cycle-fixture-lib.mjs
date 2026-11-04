import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { cyclePlanProposal } from './cycle-planning-fixture-lib.mjs';
import { createValidationProfileFixture } from './standard-cycle-validation-fixture-lib.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';

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
