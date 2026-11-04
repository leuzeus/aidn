import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { standardPrTriageItems, PR_TRIAGE_CONTRACT } from '../../src/core/workflow/standard-pr-triage.mjs';
import { assertNativeActivityAnswer } from '../../src/core/workflow/native-activity-output.mjs';

const expectedBodies = Object.freeze({
  positive: 'Complete fixture review evidence.',
  correction: 'The exported product value needs a bounded correction in a new admitted cycle, followed by impacted validation and fresh delivery.',
});

function scenarioBody(scenario) {
  if (!Object.hasOwn(expectedBodies, scenario)) throw Error('STANDARD_FIXTURE_SCENARIO_INVALID');
  return expectedBodies[scenario];
}

// Arrangement used by both the long composed driver and its short transfer
// check. The positive body is produced by the provider fixture's default path.
export function arrangeStandardReviewScenario(controlRoot, scenario) {
  const body = scenarioBody(scenario), file = path.join(controlRoot, 'standard-pr-correction-fixture.json');
  if (fs.existsSync(file)) throw Error('STANDARD_FIXTURE_REVIEW_SCENARIO_ALREADY_ARRANGED');
  if (scenario === 'correction') fs.writeFileSync(file, JSON.stringify({ review_body: body }), { flag: 'wx' });
}

export function assertCapturedStandardReviewScenario(captured, scenario) {
  assert.equal(captured.payload.observation.observations.evidence.reviews[0].body_chunks.join(''), scenarioBody(scenario));
}

// Product evidence names belong to the supplied product-root-relative snapshot.
// A fixture must not prepend the checkout's product directory a second time.
export function standardReviewScenarioAnswer(observed, scenario) {
  scenarioBody(scenario);
  const context = observed.context, correction = scenario === 'correction';
  const productEvidence = correction ? context.product_files.filter(row => row.present).map(row => {
    const ref = context.evidence_refs.find(ref => ref.ref === `product:${row.path}` && ref.sha256 === row.sha256);
    assert.ok(ref, 'STANDARD_FIXTURE_PRODUCT_EVIDENCE_REQUIRED'); return ref;
  }) : [];
  if (correction) assert.ok(productEvidence.length, 'STANDARD_FIXTURE_PRODUCT_EVIDENCE_REQUIRED');
  const answer = { outcome: 'completed', summary: 'Fixture-only review classification, effects pending', report: {
    contract_version: PR_TRIAGE_CONTRACT, context_sha256: observed.context_sha256,
    items: standardPrTriageItems(context.payload).map(row => ({ kind: row.kind, node_id: row.node_id, thread_id: row.thread_id,
      body_sha256: row.body_sha256, disposition: correction ? 'valid' : 'not_a_finding',
      rationale: correction ? 'Fixture finding on the selected exported product value requires a new admitted cycle.' : 'The complete fixture body contains only a review acknowledgement.',
      proposed_response: '', correction: correction ? 'Correct the selected product value through a new admitted cycle and run impacted checks.' : '',
      evidence_refs: [{ ref: 'github:' + row.kind + '/' + row.node_id, sha256: row.body_sha256 }, ...productEvidence] })) } };
  assertNativeActivityAnswer(answer, PR_TRIAGE_CONTRACT, observed.context_sha256);
  return answer;
}
