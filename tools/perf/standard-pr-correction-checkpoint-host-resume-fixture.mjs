import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createStandardWorkflowExecution } from '../../src/application/runtime/standard-workflow-composition.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createLocalWorkflowSessionPush } from '../../src/adapters/runtime/local-workflow-session-push.mjs';
import { createGithubPrOpenTransportFixture } from './github-pr-open-fixture-lib.mjs';
import { createComposedGithubReviewFixture } from './github-review-evidence-fixture-lib.mjs';
import { createStandardReviewEventFixture } from './standard-pr-review-event-fixture-lib.mjs';
import { closureHumanSource } from './cycle-closure-fixture-lib.mjs';
import { observeComposedHost } from './standard-composed-observation-fixture-lib.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';

const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), id = process.argv[3];
assert.equal(data.proof_class, 'offline-fixture-only'); assert.equal(data.experiment.checkpoint_ack_loss, true);
const f = data.fixture, configuration = f.configuration;
const host = observeComposedHost(createStandardWorkflowExecution({ configuration, readSigningKey: () => Buffer.alloc(32, 91),
  authorize: async () => ({ authorized: true, authority_id: 'fixture_operator', principal_sha256: 'a'.repeat(64), grant_sha256: 'b'.repeat(64) }),
  humanSource: closureHumanSource(f.human_source_file), validationProfile: f.validationProfile,
  sessionPushPort: createLocalWorkflowSessionPush({ targetRoot: configuration.target_root, remoteRoot: f.sessionPushRemoteRoot }),
  sessionPullRequestPort: createGithubPrOpenTransportFixture({ remoteRoot: f.sessionPushRemoteRoot, controlRoot: configuration.control_root }).port,
  sessionReviewPort: createComposedGithubReviewFixture({ remoteRoot: f.sessionPushRemoteRoot, controlRoot: configuration.control_root }),
  sessionReviewEventPort: createStandardReviewEventFixture(configuration.control_root) }),
path.join(configuration.control_root, 'checkpoint-recovery-host-' + process.pid + '.jsonl'));
const git = (...args) => execFileSync('git', ['-C', configuration.target_root, ...args], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
const before = host.inspect(), allocation = host.inspectAllocations(), original = host.readOperation(id), head = git('rev-parse', 'HEAD'), count = git('rev-list', '--count', 'HEAD');
assert.equal(original.phase, 'dispatching'); assert.deepEqual(original.results, []);
assert.equal(createStandardWorkflowArtifacts({ targetRoot: configuration.target_root }).ownerPending(), false);
await assert.rejects(host.reconcileCorrectionCheckpoint(id), { code: 'STANDARD_HOST_EXPLICIT_WRITE_REQUIRED' });
const result = await host.reconcileCorrectionCheckpoint(id, { write: true });
assert.equal(result.status, 'receipted'); assert.equal(result.receipt.outcome, 'completed');
const recovered = host.readOperation(id);
for (const key of ['preview', 'intent', 'grant', 'owner']) assert.deepEqual(recovered[key], original[key]);
assert.equal(recovered.revision, original.revision + 1); assert.equal(recovered.results.length, 1);
assert.equal(recovered.results[0].output.observations.reconciliation, 'observed-existing-commit');
assert.equal(recovered.results[0].output.observations.git.commit_sha, head);
assert.equal(host.inspect().record.instance_sha256, before.record.instance_sha256);
assert.equal((await host.reconcileCorrectionCheckpoint(id, { write: true })).status, 'retained_result');
assert.equal(shadowHash(host.readOperation(id)), shadowHash(recovered));
const accepted = await host.acceptOperation(id, { write: true });
assert.deepEqual(host.inspectAllocations(), allocation); assert.equal(git('rev-parse', 'HEAD'), head); assert.equal(git('rev-list', '--count', 'HEAD'), count);
console.log(JSON.stringify({ instance_sha256: accepted.record.instance_sha256, workflow_status: accepted.cursor.status,
  missing_receipt_recovered_by_real_host: true, original_intent_preview_grant_owner_preserved: true,
  repeated_recovery: 'retained_result', git_commit_repeated: false, new_native_allocations: 0,
  fixture_key: 'PUBLIC_Buffer.alloc(32,91)', producer_provider_human_identity: 'fixture', native_models: 0, full_standard: false }));
