import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runStandardWorkflowEntry } from '../../src/application/runtime/standard-workflow-entry.mjs';
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { iterateAgenticProcessSimulation } from '../../src/core/workflow/agentic-process-simulation.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';
import { observeCommonCheckpointGit } from './standard-git-checkpoint-crash-producer-fixture.mjs';
import { runPublicCheckpointEntryControllers } from './standard-git-checkpoint-entry-controllers-fixture-lib.mjs';

export async function verifyPublicCheckpointBeforeEffectBoundary({ packet, bound, producerFile, prefixFile,
  operationId, original, capsuleBefore, evidenceRoot, boundMs }) {
  assert(packet.fixture.r09Request && bound.publicFixture, 'RETAINED_PUBLIC_HOST_CONFIGURATION_REQUIRED');
  const root = packet.fixture.configuration.target_root;
  const git = (...args) => execFileSync('git', ['--no-optional-locks', '-C', root, ...args],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
  const before = observeCommonCheckpointGit(root, original, { commitWitness: false });
  const head = git('rev-parse', 'HEAD'), count = Number(git('rev-list', '--count', 'HEAD'));
  const index = git('ls-files', '--stage', '-z');
  assert.equal(original.phase, 'dispatching'); assert.deepEqual(original.results, []);
  assert.equal(head, original.preview.prepared.plan.git.observed.head);
  const options = { request: packet.fixture.r09Request, environment: bound.publicFixture.environment };
  const ports = { providerTransport: bound.publicFixture.providerTransport };
  const inventory = H(bound.artifacts.observeInventory());
  const prepared = await runStandardWorkflowEntry(options, ports);
  assert.equal(prepared.written, false); assert.equal(prepared.can_apply, true);
  assert.equal(prepared.preview.kind, 'dispatch'); assert.equal(prepared.preview.payload.operation_id, operationId);
  assert.equal(H(bound.artifacts.observeInventory()), inventory);
  const actionFile = path.join(evidenceRoot, 'before-effect-public-action.json');
  fs.writeFileSync(actionFile, JSON.stringify(prepared.preview) + '\n', { flag: 'wx' });
  const controllers = await runPublicCheckpointEntryControllers({ producerFile, prefixFile, actionFile,
    evidenceRoot, boundMs });
  fs.writeFileSync(path.join(evidenceRoot, 'before-effect-public-controllers.json'), JSON.stringify(controllers) + '\n', { flag: 'wx' });
  for (const row of controllers.filter(row => row.status === 'rejected')) assert([
    'STANDARD_ENTRY_PRECONDITIONS_CHANGED', 'STANDARD_ENTRY_ACTION_CHANGED', 'PROCESS_JOURNAL_OWNER_CHANGED',
    'PROCESS_REVISION_CONFLICT', 'WORKFLOW_INSTANCE_LOCK_RECONCILIATION_REQUIRED', 'WORKFLOW_INSTANCE_REVISION_CONFLICT',
    'STANDARD_PR_CORRECTION_CHECKPOINT_DISPATCH_REQUIRED', 'STANDARD_PR_CORRECTION_CHECKPOINT_DISPATCH_CHANGED',
    'PROCESS_RESERVED_DISPATCH_UNCONFIRMED',
  ].includes(row.error.code), JSON.stringify(row.error));
  const completed = controllers.filter(row => row.status === 'fulfilled');
  assert(completed.length > 0, 'ONE_PUBLIC_BEFORE_EFFECT_OBSERVER_MUST_COMPLETE');
  for (const row of completed) {
    assert.equal(row.applied.result.operation_outcome, 'blocked');
    assert.equal(row.applied.result.effect_status, 'no_effect'); assert.equal(row.applied.result.native_started, false);
  }
  const observed = bound.host.readOperation(operationId);
  for (const field of ['preview', 'intent', 'grant', 'owner']) assert.deepEqual(observed[field], original[field]);
  assert.equal(observed.results.length, 1);
  assert.equal(observed.results[0].output.observations.reconciliation, 'observed-reserved-before-effect');
  assert.deepEqual(observed.results[0].output.facts, {});
  const oldAccepted = bound.host.inspect().record.events.filter(event => event.kind === 'operation_result'
    && event.receipt.operation_id === operationId);
  assert.equal(oldAccepted.length, 1); assert.equal(oldAccepted[0].receipt.outcome, 'blocked');
  assert.equal(oldAccepted[0].receipt.effect_status, 'no_effect');
  assert.deepEqual(observeCommonCheckpointGit(root, original, { commitWitness: false }), before);
  assert.equal(git('ls-files', '--stage', '-z'), index);
  assert.equal(git('rev-parse', 'HEAD'), head); assert.equal(Number(git('rev-list', '--count', 'HEAD')), count);
  const afterObservationInventory = H(bound.artifacts.observeInventory());
  await assert.rejects(runStandardWorkflowEntry({ ...options, preparedAction: prepared.preview,
    execute: true, expectPlan: H(prepared.preview) }, ports), { code: 'STANDARD_ENTRY_PRECONDITIONS_CHANGED' });
  assert.equal(H(bound.artifacts.observeInventory()), afterObservationInventory);

  // The accepted blocked result supplies no checkpoint completion. The next
  // exact ordinary action must stage a new identity and acquire its own grant.
  const next = await runStandardWorkflowEntry(options, ports);
  assert.equal(next.written, false); assert.equal(next.can_apply, true); assert.equal(next.preview.kind, 'operation');
  const preview = next.preview.payload.preview;
  assert.equal(preview.binding.id, 'session_pr_correction_checkpoint');
  const nextId = preview.prepared.plan.operation_id;
  assert.notEqual(nextId, operationId);
  fs.writeFileSync(path.join(evidenceRoot, 'before-effect-new-operation-action.json'), JSON.stringify(next.preview) + '\n', { flag: 'wx' });
  const applied = await runStandardWorkflowEntry({ ...options, preparedAction: next.preview,
    execute: true, expectPlan: H(next.preview) }, ports);
  fs.writeFileSync(path.join(evidenceRoot, 'before-effect-new-operation-applied.json'), JSON.stringify(applied) + '\n', { flag: 'wx' });
  assert.equal(applied.result.operation_outcome, 'completed'); assert.equal(applied.result.effect_status, 'confirmed');
  assert.equal(applied.result.native_started, false); assert.equal(applied.result.workflow_completed, false);
  const successor = bound.host.readOperation(nextId), stable = bound.host.inspect();
  assert.equal(successor.results.length, 1); assert.notEqual(successor.intent.operation_id, original.intent.operation_id);
  assert(successor.grant); assert.equal(successor.intent.authorization_sha256, H(successor.grant));
  assert.equal(stable.record.events.filter(event => event.kind === 'operation_result' && event.receipt.operation_id === nextId).length, 1);
  assert.deepEqual(bound.host.readOperation(operationId), observed);
  assert.deepEqual(bound.artifacts.readMany(['workflows/dispatch-records/' + operationId + '.json'], { includeMetadata: true }), capsuleBefore);
  assert.equal(bound.artifacts.ownerPending(), false);
  assert.equal(Number(git('rev-list', '--count', 'HEAD')), count + 1);
  const actual = observeCommonCheckpointGit(root, successor);
  assert.equal(actual.proof.status, 'confirmed'); assert.equal(actual.proof.parent_sha, head);
  assert.equal(actual.proof.commit_sha, git('rev-parse', 'HEAD'));
  assert.equal(actual.view.index_clean, true); assert.equal(actual.view.lock_present, false); assert.deepEqual(actual.view.changes, []);
  assert.equal(H(bound.host.inspectAllocations()), packet.native_allocations_sha256);
  assert.equal(H(packet.authorization), packet.original_authorization_sha256);
  const initial = { instanceId: stable.record.instance_id, model: stable.record.model, policyPins: stable.record.policy_pins,
    scopeId: stable.record.scope_id, facts: stable.record.initial_facts, parameters: stable.record.initial_parameters };
  let replay = createAgenticProcess(initial);
  for (const event of stable.record.events) replay = advanceAgenticProcess(replay, event);
  assert.deepEqual(replay, stable.record); assert.deepEqual(inspectAgenticProcess(replay), stable.cursor);
  let last, rows = 0;
  for (const row of iterateAgenticProcessSimulation({ ...initial, events: stable.record.events })) { last = row; rows++; }
  assert.equal(rows, stable.record.events.length + 1); assert.equal(last.instance_sha256, stable.record.instance_sha256);
  assert.deepEqual(last.cursor, stable.cursor);
  return { status: 'PASS_PUBLIC_BEFORE_EFFECT_GIT_CRASH_RECOVERY_COMPONENT', mode: 'files', cut: 'dispatch_reserved',
    base: evidenceRoot, root, retained_prefix: prefixFile, original_operation_id: operationId, successor_operation_id: nextId,
    public_controller_processes: 2, original_blocked_result_accepted_once: true, pre_dispatch_Git_unchanged: true,
    fresh_ordinary_intent_and_grant: true, actual_Git_commit_count_delta: 1, actual_git: actual,
    original_intent_preview_grant_owner_capsule_preserved: true, replay_sim_equal: true, new_native_allocations: 0,
    native_limits_unchanged: true, original_worker_bound_ms: boundMs, genuine_Native_clients: 0, genuine_model_calls: 0,
    human_provider_authorities: 'FIXTURE', actual_public_entry: 'SERVICE_WITH_IDENTIFIED_PROVIDER_TRANSPORT_FIXTURE',
    actual_CLI_shell: 'NOT_RUN', installed_archive: 'NOT_RUN', full_standard_workflow: false };
}
