import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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
