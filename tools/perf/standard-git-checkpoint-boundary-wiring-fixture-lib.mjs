import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createFreshStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
import { openCommonCheckpointFixtureHost } from './standard-git-checkpoint-crash-producer-fixture.mjs';
import { resolveStandardWorkflowConfiguration } from '../../src/application/runtime/standard-workflow-entry.mjs';
import { CODEX_STARTUP_ENVIRONMENT_PROFILES } from '../../src/core/agents/codex-startup-arguments.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

// Cheap wiring proof before an expensive actual checkpoint prefix. This uses
// the first real read-only operation of the published common model. It proves
// the interruption adapter reaches the real port, not Git crash recovery.
export async function verifyCommonGitCheckpointBoundaryWiring() {
  const owned = [], root = createFreshStandardWorkflowFixture('files', owned);
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-git-boundary-wiring-'));
  const dirs = Object.fromEntries(['control', 'review', 'home'].map(name => {
    const directory = path.join(base, name); fs.mkdirSync(directory); return [name, directory];
  }));
  const product = path.join(root, 'product'); fs.mkdirSync(product);
  fs.writeFileSync(path.join(product, 'app.mjs'), 'export const value = 1;\n', { flag: 'wx' });
  const humanFile = path.join(base, 'fixture-human.json'); fs.writeFileSync(humanFile, '{}', { flag: 'wx' });
  const pin = file => ({ path: file, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
  const resolved = resolveStandardWorkflowConfiguration({ contract_version: 'standard-workflow-execution.v1',
    parameters: {}, execution: { instance_id: 'git-boundary-wiring', target_root: root,
      product_root: product, product_files: ['app.mjs'], control_root: dirs.control, review_root: dirs.review,
      criteria: pin(path.join(root, 'AGENTS.md')), authorities: { project: pin(path.join(root, 'AGENTS.md')) },
      instructions: {}, controller: {}, native: { executable: process.execPath, sha256: pin(process.execPath).sha256,
        home: dirs.home, tool_roots: [], hook_hashes: { work: ['sha256:' + 'a'.repeat(64), 'sha256:' + 'b'.repeat(64)], review: [] },
        model: 'fixture-no-native', effort: 'low', startup: { mcp_server_ids: [], plugin_ids: [], app_ids: [],
          environment_override_names: [], environment_names: [...CODEX_STARTUP_ENVIRONMENT_PROFILES.worker],
          log_dir: dirs.control, sqlite_home: dirs.control } } } });
  const boundaries = [];
  const bound = openCommonCheckpointFixtureHost({ configuration: resolved.configuration, human_source_file: humanFile },
    { dispatchCheckpoint(point, id) {
      boundaries.push({ point, operation_id: id });
      if (point === 'effect_returned') throw Object.assign(Error('FIXTURE_BOUNDARY_WIRING_INTERRUPTED'),
        { code: 'FIXTURE_BOUNDARY_WIRING_INTERRUPTED' });
    } });
  const parameters = { session: { session_id: 'S001', session_branch: 'S001-wiring', objective: 'Check the actual operation boundary adapter' },
    cycle: { cycle_id: 'C001', cycle_type: 'feature', title: 'unused', objective: 'No cycle or Native activity in wiring proof' } };
  const proposed = bound.host.initialize({ parameters });
  bound.host.initialize({ parameters, write: true, expectedResultSha256: proposed.record.instance_sha256 });
  let preview;
  for (let step = 0; step < 3; step++) {
    const next = await bound.host.step({ write: false });
    if (next.kind === 'operation_preview') { preview = next.preview; break; }
    assert.equal(next.kind, 'call');
    await bound.host.applyCall(next.transition, { write: true,
      expectedSha256: bound.host.inspect().record.instance_sha256 });
  }
  assert(preview); assert.equal(preview.binding.id, 'context_reload');
  assert.equal(preview.binding.effect_class, 'read-only'); assert.equal(preview.prepared, null);
  const allocationBefore = H(bound.host.inspectAllocations());
  const staged = await bound.operationActor.stage(preview, { write: true, expectedPreviewSha256: H(preview) });
  await assert.rejects(bound.operationActor.dispatch(staged.operation_id, { write: true }),
    { code: 'FIXTURE_BOUNDARY_WIRING_INTERRUPTED' });
  assert.deepEqual(boundaries.map(row => row.point), ['dispatch_reserved', 'effect_returned']);
  assert(boundaries.every(row => row.operation_id === staged.operation_id));
  const journal = bound.host.readOperation(staged.operation_id);
  bound.signer.verify(journal); bound.signer.verify(journal.preview);
  assert.equal(journal.phase, 'dispatching'); assert.deepEqual(journal.results, []);
  const capsule = JSON.parse(bound.artifacts.read('workflows/dispatch-records/' + staged.operation_id + '.json', { required: true }).content);
  bound.signer.verify(capsule); assert.equal(capsule.phase, 'running');
  assert.equal(capsule.output, null); assert.equal(capsule.output_sha256, null);
  assert.equal(capsule.context_after_sha256, null); assert.equal(capsule.process_identity.pid, process.pid);
  assert.equal(H(bound.host.inspectAllocations()), allocationBefore);
  return { status: 'PASS_ACTUAL_OPERATION_HOST_BOUNDARY_WIRING_ONLY', root, base,
    binding: 'context_reload', boundaries: boundaries.map(row => row.point), actual_common_model: true,
    signed_running_null_output_capsule: true, original_results: 0,
    actual_Git_checkpoint: 'NOT_RUN', checkpoint_recovery: 'NOT_RUN',
    genuine_Native_clients: 0, genuine_model_calls: 0, full_standard_workflow: false };
}
