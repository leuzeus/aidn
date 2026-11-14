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
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { iterateAgenticProcessSimulation } from '../../src/core/workflow/agentic-process-simulation.mjs';

const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), id = process.argv[3];
assert.equal(data.proof_class, 'offline-fixture-only');
const unknown = data.experiment.checkpoint_owner_ack_loss === true;
assert.equal(unknown || data.experiment.checkpoint_ack_loss === true, true);
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
createOperationJournalSigner(() => Buffer.alloc(32, 91)).verify(original);
const oldEvent = unknown ? before.record.events.find(row => row.kind === 'operation_result' && row.receipt.operation_id === id) : null;
if (unknown) {
  assert.equal(original.phase, 'receipted'); assert.equal(original.results.length, 1);
  assert.equal(original.results[0].receipt.outcome, 'reconciliation_required');
  assert.equal(original.results[0].receipt.effect_status, 'unknown');
  assert.equal(original.results[0].output.observations.reason_code, 'FIXTURE_CHECKPOINT_OWNER_ACK_LOST');
  assert.ok(oldEvent); assert.deepEqual(oldEvent.receipt, original.results[0].receipt);
  assert.equal((await host.acceptOperation(id, { write: true, receiptId: oldEvent.receipt.receipt_id })).record.instance_sha256, before.record.instance_sha256);
} else { assert.equal(original.phase, 'dispatching'); assert.deepEqual(original.results, []); }
assert.equal(createStandardWorkflowArtifacts({ targetRoot: configuration.target_root }).ownerPending(), false);
await assert.rejects(host.reconcileCorrectionCheckpoint(id), { code: 'STANDARD_HOST_EXPLICIT_WRITE_REQUIRED' });
const competitors = unknown ? await Promise.allSettled([host.reconcileCorrectionCheckpoint(id, { write: true }), host.reconcileCorrectionCheckpoint(id, { write: true })]) : null;
if (unknown) {
  assert.equal(competitors.filter(row => row.status === 'fulfilled' && row.value.status === 'receipted').length, 1);
  for (const row of competitors.filter(row => row.status === 'rejected')) assert.ok([
    'PROCESS_JOURNAL_OWNER_CHANGED', 'STANDARD_PR_CORRECTION_CHECKPOINT_DISPATCH_REQUIRED',
    'STANDARD_PR_CORRECTION_CHECKPOINT_DISPATCH_CHANGED'].includes(row.reason.code), row.reason.code);
}
const result = unknown ? competitors.find(row => row.status === 'fulfilled' && row.value.status === 'receipted').value
  : await host.reconcileCorrectionCheckpoint(id, { write: true });
assert.equal(result.status, 'receipted'); assert.equal(result.receipt.outcome, 'completed');
const recovered = host.readOperation(id);
for (const key of ['preview', 'intent', 'grant', 'owner']) assert.deepEqual(recovered[key], original[key]);
assert.equal(recovered.revision, original.revision + 1); assert.equal(recovered.results.length, original.results.length + 1);
assert.equal(recovered.results.at(-1).output.observations.reconciliation, 'observed-existing-commit');
assert.equal(recovered.results.at(-1).output.observations.git.commit_sha, head);
assert.equal(recovered.results.at(-1).output.observations.dispatch_sha256, shadowHash(original));
if (unknown) {
  assert.deepEqual(recovered.results[0], original.results[0]);
  assert.notEqual(recovered.results[0].receipt.receipt_id, result.receipt.receipt_id);
  assert.notEqual(recovered.results[0].receipt.evidence_refs[0].ref, result.receipt.evidence_refs[0].ref);
  assert.equal((await host.acceptOperation(id, { write: true, receiptId: oldEvent.receipt.receipt_id })).record.instance_sha256, before.record.instance_sha256);
}
assert.equal(host.inspect().record.instance_sha256, before.record.instance_sha256);
assert.equal((await host.reconcileCorrectionCheckpoint(id, { write: true })).status, 'retained_result');
assert.equal(shadowHash(host.readOperation(id)), shadowHash(recovered));
const accepted = await host.acceptOperation(id, { write: true });
if (unknown) {
  assert.deepEqual(accepted.record.events.find(row => row.event_id === oldEvent.event_id), oldEvent);
  assert.equal(accepted.record.events.at(-1).receipt.receipt_id, result.receipt.receipt_id);
  assert.equal(accepted.record.events.at(-1).event_id, oldEvent.event_id + '_1');
}
const initial = { instanceId: accepted.record.instance_id, model: accepted.record.model, policyPins: accepted.record.policy_pins,
  scopeId: accepted.record.scope_id, facts: accepted.record.initial_facts, parameters: accepted.record.initial_parameters };
let replay = createAgenticProcess(initial);
for (const event of accepted.record.events) replay = advanceAgenticProcess(replay, event);
assert.deepEqual(replay, accepted.record); assert.deepEqual(inspectAgenticProcess(replay), accepted.cursor);
let last, rows = 0;
for (const row of iterateAgenticProcessSimulation({ ...initial, events: accepted.record.events })) { last = row; rows++; }
assert.equal(rows, accepted.record.events.length + 1); assert.equal(last.instance_sha256, accepted.record.instance_sha256);
assert.deepEqual(last.cursor, accepted.cursor);
assert.deepEqual(host.inspectAllocations(), allocation); assert.equal(git('rev-parse', 'HEAD'), head); assert.equal(git('rev-list', '--count', 'HEAD'), count);
console.log(JSON.stringify({ instance_sha256: accepted.record.instance_sha256, workflow_status: accepted.cursor.status,
  missing_receipt_recovered_by_real_host: !unknown, dispatcher_unknown_recovered_by_real_host: unknown,
  exact_replay_and_streamed_simulation: true, old_receipt_and_event_preserved: unknown, competing_observers_single_append: unknown,
  original_intent_preview_grant_owner_preserved: true,
  repeated_recovery: 'retained_result', git_commit_repeated: false, new_native_allocations: 0,
  fixture_key: 'PUBLIC_Buffer.alloc(32,91)', producer_provider_human_identity: 'fixture', native_models: 0, full_standard: false }));
