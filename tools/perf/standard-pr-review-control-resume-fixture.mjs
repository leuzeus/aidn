import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createStandardWorkflowExecution } from '../../src/application/runtime/standard-workflow-composition.mjs';
import { createLocalWorkflowSessionPush } from '../../src/adapters/runtime/local-workflow-session-push.mjs';
import { createGithubPrOpenTransportFixture } from './github-pr-open-fixture-lib.mjs';
import { createComposedGithubReviewFixture } from './github-review-evidence-fixture-lib.mjs';
import { createStandardReviewEventFixture } from './standard-pr-review-event-fixture-lib.mjs';
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.equal(data.proof_class, 'offline-fixture-only');
const f = data.fixture, configuration = f.configuration;
const host = createStandardWorkflowExecution({ configuration, readSigningKey: () => Buffer.alloc(32, 91),
  authorize: async () => ({ authorized: true, authority_id: 'fixture_operator', principal_sha256: 'a'.repeat(64), grant_sha256: 'b'.repeat(64) }),
  validationProfile: f.validationProfile,
  sessionPushPort: createLocalWorkflowSessionPush({ targetRoot: configuration.target_root, remoteRoot: f.sessionPushRemoteRoot }),
  sessionPullRequestPort: createGithubPrOpenTransportFixture({ remoteRoot: f.sessionPushRemoteRoot, controlRoot: configuration.control_root }).port,
  sessionReviewPort: createComposedGithubReviewFixture({ remoteRoot: f.sessionPushRemoteRoot, controlRoot: configuration.control_root }),
  sessionReviewEventPort: createStandardReviewEventFixture(configuration.control_root) });
const before = host.inspect(), allocations = host.inspectAllocations();
assert.equal(host.readControl(process.argv[3]).phase, 'reserved');
await host.deliverControl(process.argv[3], { write: true });
if (host.inspect().cursor.occurrences.some(row => row.wait_reason === 'call_return')) {
  const returned = await host.step({ write: true });
  assert.equal(returned.kind, 'call');
  const routed = await host.step({ write: true });
  assert.equal(host.readOperation(routed.operation_id).results.at(-1).output.facts.session_pr_pretriage_external, false);
}
const result = await host.step({ write: true });
assert.equal(result.kind, 'operation');
assert.equal(host.readOperation(result.operation_id).intent.binding_ref, 'session_pr_review_receive');
assert.equal(host.readOperation(result.operation_id).results.at(-1).output.outcome, 'completed');
assert.deepEqual(host.inspectAllocations(), allocations);
console.log(JSON.stringify({ instance_sha256: host.inspect().record.instance_sha256,
  prior_events: before.record.events.length, events: host.inspect().record.events.length,
  new_native_allocations: 0, signed_payload_consumed: true }));
