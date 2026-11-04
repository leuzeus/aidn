import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { composedCyclePlan, composedCycleValidationProfile, prepareComposedNativeAnswer, composedTriageAnswer } from './standard-composed-cycle-fixture-lib.mjs';
import { assertStandardCyclePlan } from '../../src/core/workflow/standard-cycle-planning.mjs';
import { readAgentRunFile } from '../../src/application/runtime/agent-run-configuration-service.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-composed-cycle-'));
let checks = 0;
try {
  for (const [cycle_id, cycle_type, expected] of [['C001', 'feature', 'TEST-001'], ['C017', 'corrective', 'TEST-002'], ['C031', 'corrective', 'TEST-002']]) {
    const proposal = composedCyclePlan({ context_sha256: 'a'.repeat(64), context: { session_id: 'S001', cycle_id, cycle_type,
      original_objective: 'The current admitted cycle goal.', mode: 'COMMITTING', allowed_product_files: ['product/app.mjs'] },
      evidence_refs: [{ ref: 'audit:SPEC.md', sha256: 'b'.repeat(64) }] });
    assertStandardCyclePlan(proposal); assert.equal(proposal.cycle_id, cycle_id); assert.equal(proposal.cycle_type, cycle_type);
    assert.deepEqual(proposal.tasks[0].test_refs, [expected]); checks++;
  }
  const ref = composedCycleValidationProfile(root), profile = readAgentRunFile(ref.path, { sha256: ref.sha256 }).value;
  assert.equal(profile.checks.length, 2);
  for (const [index, expected] of [[0, 2], [1, 3]]) {
    const check = profile.checks[index]; readAgentRunFile(check.script.path, { sha256: check.script.sha256, json: false });
    for (const value of [1, 2, 3]) {
      fs.writeFileSync(path.join(root, 'app.mjs'), 'export const value = ' + value + ';\n');
      const result = spawnSync(process.execPath, [check.script.path, ...check.args], { cwd: root, encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 0, result.stderr);
      const verdict = JSON.parse(result.stdout); assert.equal(verdict.validation_id, check.test_ref);
      assert.equal(verdict.status, value === expected ? 'passed' : 'failed'); checks++;
    }
  }
  // Retained expectation preparation is outside the reserved Native callback.
  // These deliberately minimal accepted-record doubles are not host authority.
  const instance = { events: [] }, records = new Map();
  const retain = (binding, input = {}) => {
    const operation_id = 'fixture-' + records.size, receipt = { operation_id, receipt_id: 'receipt-' + records.size };
    const record = { operation_id, preview: { input }, results: [{ receipt, output: { outcome: 'completed' } }] };
    instance.events.push({ kind: 'operation_intent', intent: { operation_id, binding_ref: binding } }, { kind: 'operation_result', receipt });
    records.set(operation_id, record); return record;
  };
  let reserved = false, reads = 0;
  const readOperation = id => { assert.equal(reserved, false, 'Native callback must not read the host'); reads++; return records.get(id); };
  const prepare = nodeId => prepareComposedNativeAnswer({ nodeId, instance, readOperation });
  const first = retain('session_pr_update_push');
  const receive = retain('session_pr_review_receive', { update_operation_id: first.operation_id });
  const select = retain('session_pr_triage_select', { received_operation_id: receive.operation_id });
  assert.equal(prepare('session_pr_triage').scenario, 'correction'); checks++;
  assert.throws(() => prepare('correction_pr_triage'), /STANDARD_FIXTURE_NATIVE_SOURCE_REQUIRED/); checks++;
  const update = retain('session_pr_redelivery_push');
  // The old accepted review must not qualify the redelivered occurrence.
  assert.throws(() => prepare('correction_pr_triage')); checks++;
  const newReceive = retain('session_pr_review_receive', { update_operation_id: update.operation_id });
  const newSelect = retain('session_pr_triage_select', { received_operation_id: newReceive.operation_id });
  const prepared = prepare('correction_pr_triage'); assert.equal(prepared.scenario, 'corrected');
  assert.equal(prepared.selection_operation_id, newSelect.operation_id); checks++;
  const initialized = retain('session_pr_correction_cycle_initialize', { cycle_id: 'C031' });
  assert.equal(prepare('correction_implement').cycle_id, 'C031'); checks++;
  instance.events.pop();
  assert.throws(() => prepare('correction_implement'), /STANDARD_FIXTURE_NATIVE_ACCEPTED_SOURCE_REQUIRED/); checks++;
  instance.events.push({ kind: 'operation_result', receipt: initialized.results[0].receipt });
  initialized.results[0].output.outcome = 'blocked'; assert.throws(() => prepare('correction_implement')); checks++;
  const snapshot = [{ path: 'app.mjs', present: true, bytes: 24,
    sha256: (await import('node:crypto')).createHash('sha256').update('export const value = 3;\n').digest('hex') }];
  const context = { selection_operation_id: newSelect.operation_id, received_operation_id: newReceive.operation_id, product_files: snapshot,
    payload: { observation: { observations: { update_operation_id: update.operation_id, evidence: { reviews: [] }, threads: { threads: [] } } } },
    evidence_refs: [{ ref: 'product:app.mjs', sha256: snapshot[0].sha256 }] };
  reserved = true; const priorReads = reads;
  const answer = composedTriageAnswer({ context, context_sha256: shadowHash(context) }, prepared);
  assert.equal(answer.outcome, 'completed'); assert.equal(reads, priorReads); checks++;
  for (const field of ['selection_operation_id', 'received_operation_id']) {
    assert.throws(() => composedTriageAnswer({ context: { ...context, [field]: 'foreign' }, context_sha256: shadowHash(context) }, prepared)); checks++;
  }
  assert.throws(() => composedTriageAnswer({ context, context_sha256: shadowHash(context) }, null)); checks++;
  console.log(JSON.stringify({ status: 'PASS', checks, scope: 'fixture-context-and-two-real-Node-checks',
    application_cycle_admission: 'NOT_RUN', human_native_provider: 'NOT_RUN', full_standard_workflow: false }));
} finally {
  assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir()));
  if (process.argv.includes('--retain-always')) console.log(JSON.stringify({ fixture_cleanup: 'retained', roots: [root] }));
  else fs.rmSync(root, { recursive: true });
}
