import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { composedCyclePlan, composedCycleValidationProfile } from './standard-composed-cycle-fixture-lib.mjs';
import { assertStandardCyclePlan } from '../../src/core/workflow/standard-cycle-planning.mjs';
import { readAgentRunFile } from '../../src/application/runtime/agent-run-configuration-service.mjs';

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
  console.log(JSON.stringify({ status: 'PASS', checks, scope: 'fixture-context-and-two-real-Node-checks',
    application_cycle_admission: 'NOT_RUN', human_native_provider: 'NOT_RUN', full_standard_workflow: false }));
} finally {
  assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir()));
  if (process.argv.includes('--retain-always')) console.log(JSON.stringify({ fixture_cleanup: 'retained', roots: [root] }));
  else fs.rmSync(root, { recursive: true });
}
