import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

// Fixture-only capture of an actual common-host prefix. Earlier accepted
// operations are read from the real host; no operation record is synthesized.
// The separate checkpoint producer will consume this exact signed preview.
export async function retainStandardGitCheckpointPrefix({ host, resumeFile, authorization, readSigningKey }) {
  assert.equal(typeof readSigningKey, 'function');
  const saved = JSON.parse(fs.readFileSync(resumeFile, 'utf8'));
  assert.equal(saved.proof_class, 'offline-fixture-only');
  assert.equal(saved.experiment.checkpoint_recovery_prefix, true);
  assert.deepEqual(saved.authorization, authorization);
  assert(Number.isSafeInteger(authorization.max_responses) && authorization.max_responses > 0);
  assert(authorization.global_deadline_ms > authorization.authorized_at_ms);

  const artifacts = createStandardWorkflowArtifacts({ targetRoot: saved.fixture.configuration.target_root });
  assert(['files', 'dual'].includes(artifacts.describe().state_mode));
  const before = host.inspect(), nativeBefore = H(host.inspectAllocations());
  const frame = before.cursor.occurrences.find(row => row.node_id === 'session_pr_correction_checkpoint' && row.status === 'READY');
  assert(frame, 'ACTUAL_COMMON_GIT_CHECKPOINT_FRONTIER_REQUIRED');
  assert(!before.record.events.some(event => event.kind === 'operation_intent'
    && event.intent.binding_ref === 'session_pr_correction_checkpoint'));

  const signer = createOperationJournalSigner(readSigningKey);
  const retained = before.record.events.filter(event => event.kind === 'operation_intent').map(event => {
    const record = host.readOperation(event.intent.operation_id);
    signer.verify(record); signer.verify(record.preview);
    assert.equal(H(record.intent), H(event.intent));
    return { operation_id: record.operation_id, record_sha256: H(record) };
  });
  const inventoryBefore = H(artifacts.observeInventory());
  const proposed = await host.step({ write: false });
  assert.equal(proposed.kind, 'operation_preview');
  assert.equal(proposed.preview.binding.id, 'session_pr_correction_checkpoint');
  assert.equal(proposed.preview.prepared.can_apply, true);
  assert(proposed.preview.prepared.plan.git.files.length > 0, 'ACTUAL_GIT_COMMIT_PLAN_REQUIRED');
  signer.verify(proposed.preview);
  assert.equal(H(artifacts.observeInventory()), inventoryBefore);
  assert.equal(host.inspect().record.instance_sha256, before.record.instance_sha256);
  assert.equal(H(host.inspectAllocations()), nativeBefore);

  const output = path.join(fs.realpathSync(saved.fixture.configuration.control_root), 'standard-git-checkpoint-prefix.json');
  const packet = { ...saved, contract_version: 'fixture-standard-git-checkpoint-prefix.v1',
    checkpoint_preview: proposed.preview, checkpoint_preview_sha256: H(proposed.preview),
    instance_sha256: before.record.instance_sha256, scope_id: before.record.scope_id,
    model_sha256: before.record.model_sha256, event_prefix_count: before.record.events.length,
    event_prefix_sha256: H(before.record.events),
    original_authorization_sha256: H(saved.authorization), native_allocations_sha256: nativeBefore,
    retained_operations: retained, checkpoint_dispatched: false, observed_at_ms: Date.now() };
  fs.writeFileSync(output, JSON.stringify(packet) + '\n', { flag: 'wx' });
  return { standard_checkpoint_recovery_prefix: true,
    status: 'RETAINED_ACTUAL_COMMON_GIT_CHECKPOINT_PREFIX_ONLY', file: output,
    instance_sha256: packet.instance_sha256, model_sha256: packet.model_sha256,
    checkpoint_preview_sha256: packet.checkpoint_preview_sha256,
    original_authorization_sha256: packet.original_authorization_sha256,
    native_allocations_sha256: nativeBefore, retained_operations: retained.length,
    checkpoint_dispatched: false, full_standard_workflow: false,
    genuine_Native_clients: 0, genuine_model_calls: 0, human_provider_authorities: 'FIXTURE' };
}
