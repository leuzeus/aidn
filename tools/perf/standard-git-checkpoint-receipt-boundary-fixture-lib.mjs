import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runStandardWorkflowEntry } from '../../src/application/runtime/standard-workflow-entry.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';
import { runPublicCheckpointEntryControllers } from './standard-git-checkpoint-entry-controllers-fixture-lib.mjs';

// The surrounding driver proves the actual Git witness and producer death.
// This helper exercises public acceptance or stale-action refusal, preserving
// the original receipt. It supplies neither a Git witness nor a crash by itself.
export async function verifyPublicCheckpointReceiptBoundary({ packet, bound, producerFile,
  prefixFile, operationId, evidenceRoot, boundMs, cut, priorActionFile = null }) {
  assert(['receipted', 'accepted'].includes(cut));
  assert(bound.publicFixture && packet.fixture.r09Request);
  const before = bound.host.readOperation(operationId);
  assert.equal(before.phase, 'receipted'); assert.equal(before.results.length, 1);
  const receipt = before.results[0].receipt;
  assert.equal(receipt.outcome, 'completed'); assert.equal(receipt.effect_status, 'confirmed');
  const instanceBefore = bound.host.inspect().record;
  const acceptedCount = record => record.events.filter(event => event.kind === 'operation_result'
    && event.receipt.operation_id === operationId).length;
  assert.equal(acceptedCount(instanceBefore), cut === 'accepted' ? 1 : 0);
  const inventoryBefore = H(bound.artifacts.observeInventory());
  const input = { request: packet.fixture.r09Request, environment: bound.publicFixture.environment };
  const ports = { providerTransport: bound.publicFixture.providerTransport };
  const prepared = await runStandardWorkflowEntry(input, ports);
  fs.writeFileSync(path.join(evidenceRoot, 'public-entry-preview.json'), JSON.stringify(prepared) + '\n', { flag: 'wx' });
  assert.equal(prepared.written, false);
  assert.equal(H(bound.artifacts.observeInventory()), inventoryBefore);
  let actionFile;
  if (cut === 'receipted') {
    assert.equal(prepared.preview.kind, 'dispatch'); assert.equal(prepared.can_apply, true);
    assert.equal(prepared.preview.payload.operation_id, operationId);
    actionFile = path.join(evidenceRoot, 'public-entry-prepared-action.json');
    fs.writeFileSync(actionFile, JSON.stringify(prepared.preview) + '\n', { flag: 'wx' });
  } else {
    assert(priorActionFile, 'PUBLIC_PREACCEPTANCE_ACTION_REQUIRED');
    const prior = JSON.parse(fs.readFileSync(priorActionFile, 'utf8'));
    assert.equal(prior.kind, 'dispatch'); assert.equal(prior.payload.operation_id, operationId);
    assert.notEqual(prior.context.instance_sha256, instanceBefore.instance_sha256);
    actionFile = priorActionFile;
  }
  const controllers = await runPublicCheckpointEntryControllers({ producerFile, prefixFile,
    actionFile, evidenceRoot, boundMs });
  fs.writeFileSync(path.join(evidenceRoot, 'public-entry-controllers.json'), JSON.stringify(controllers) + '\n', { flag: 'wx' });
  const completed = controllers.filter(row => row.status === 'fulfilled');
  if (cut === 'receipted') {
    assert(completed.length > 0, 'ONE_PUBLIC_RECEIPT_ACCEPTANCE_MUST_COMPLETE');
    for (const row of controllers.filter(row => row.status === 'rejected')) assert([
      'STANDARD_ENTRY_PRECONDITIONS_CHANGED', 'STANDARD_ENTRY_ACTION_CHANGED',
      'WORKFLOW_INSTANCE_LOCK_RECONCILIATION_REQUIRED', 'WORKFLOW_INSTANCE_REVISION_CONFLICT',
      'PROCESS_REVISION_CONFLICT', 'PROCESS_JOURNAL_OWNER_CHANGED',
    ].includes(row.error.code), JSON.stringify(row.error));
    for (const { applied } of completed) {
      assert.equal(applied.result.operation_outcome, 'completed');
      assert.equal(applied.result.effect_status, 'confirmed');
      assert.equal(applied.result.native_started, false); assert.equal(applied.result.workflow_completed, false);
      assert.equal(applied.result.details.status, 'retained_result');
      assert.equal(H(applied.result.details.receipt), H(receipt));
    }
  } else {
    assert.equal(completed.length, 0, 'ACCEPTED_CHECKPOINT_STALE_ACTION_MUST_REFUSE');
    for (const row of controllers) assert.equal(row.error.code, 'STANDARD_ENTRY_PRECONDITIONS_CHANGED');
    assert.equal(H(bound.artifacts.observeInventory()), inventoryBefore);
    assert.deepEqual(bound.host.inspect().record, instanceBefore);
  }
  assert.deepEqual(bound.host.readOperation(operationId), before, 'PUBLIC_ACCEPTANCE_MUST_RETAIN_ORIGINAL_RECEIPT');
  assert.equal(acceptedCount(bound.host.inspect().record), 1);
  const root = packet.fixture.configuration.target_root;
  for (const lock of [path.join(root, 'docs/audit/workflows/process-instances', packet.fixture.configuration.instance_id + '.json.lock'),
    path.join(root, 'docs/audit/workflows/operation-records', operationId + '.json.lock')])
    assert.equal(fs.existsSync(lock), false, 'PUBLIC_RECEIPT_CONTROLLER_RECORD_LOCK_RETAINED');
  return { status: 'PASS_PUBLIC_RECEIPT_BOUNDARY_ENTRY_ONLY', cut, controller_processes: controllers.length,
    original_receipt_unchanged: true, accepted_results: 1, stale_action_refusals: controllers.length - completed.length,
    actual_Git_witness: 'PROVIDED_ONLY_BY_SURROUNDING_DRIVER', actual_producer_death: 'PROVIDED_ONLY_BY_SURROUNDING_DRIVER',
    genuine_Native_clients: 0, genuine_model_calls: 0, full_standard_workflow: false };
}
