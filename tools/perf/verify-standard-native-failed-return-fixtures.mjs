import assert from "node:assert/strict";
import { runStandardWorkflowAction } from "../../src/application/runtime/standard-workflow-entry.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

const allocationActive = "STANDARD_PROCESS_NATIVE_ALLOCATION_ACTIVE";
const firstFailure = "PROCESS_SESSION_TURN_FAILED";

function fixture({ currentStatus = "RUNNING", treeClosed = true, changedJournal = false, inspectionError = allocationActive } = {}) {
  const generation = 1;
  const journalId = "native_" + "a".repeat(40);
  const journal = {
    journal_id: journalId,
    allocations: [{ generation, phase: "failed", tree_closed: treeClosed, first_failure: firstFailure }],
  };
  const result = {
    kind: "native",
    contract_version: "journaled-native-allocation-result.v1",
    journal_id: journalId,
    journal_phase: "failed",
    journal_sha256: shadowHash(journal),
    generation,
    status: "FAILED",
    first_failure: firstFailure,
    retry: false,
  };
  const parameters = {};
  const state = { record: { instance_sha256: "b".repeat(64), initial_parameters: parameters }, cursor: { status: "RUNNING" } };
  const reads = { diagnostic: 0, allocations: 0 };
  const host = {
    inspect() {
      if (reads.allocations) throw Object.assign(Error(inspectionError), { code: inspectionError });
      return state;
    },
    inspectDiagnostic() {
      reads.diagnostic++;
      return {
        record: state.record,
        cursor: { status: currentStatus },
        native: { journal: changedJournal ? { ...journal, revision: 2 } : journal },
      };
    },
    previewNative: () => ({ consumption: { known: true, responses: 0, bytes: 0 } }),
    inspectAllocations: () => null,
    async step({ write }) {
      if (!write) return { kind: "native_preview" };
      reads.allocations++;
      return result;
    },
  };
  const future = Date.now() + 60000;
  const input = {
    request: {}, configuration: {}, parameters, modelSource: {},
    authorization: { approved: true, model_allowed: true, global_deadline_ms: future,
      workflow_deadline_ms: future, max_responses: 1, max_bytes: 1048576 },
  };
  const ports = {
    authority: { keyId: () => "c".repeat(64), trustSha: () => "d".repeat(64) },
    compose: () => host,
  };

  return {
    result, reads,
    async run() {
      const plan = await runStandardWorkflowAction(input, ports);
      assert.equal(plan.preview.kind, "native");
      assert.equal(plan.written, false);
      assert.equal(reads.allocations, 0);
      return runStandardWorkflowAction({
        ...input, preparedAction: plan.preview, execute: true, expectPlan: plan.action_sha256,
      }, ports);
    },
  };
}

for (const currentStatus of ["RUNNING", "COMPLETED"]) {
  const test = fixture({ currentStatus });
  const output = await test.run();
  assert.deepEqual(output.result.details, test.result);
  assert.equal(output.result.process_status, currentStatus);
  assert.equal(output.result.workflow_completed, false);
  assert.equal(output.result.written, true);
  assert.deepEqual(test.reads, { diagnostic: 1, allocations: 1 });
}
for (const options of [{ treeClosed: false }, { changedJournal: true }, { inspectionError: "PROCESS_HISTORY_CHANGED" }]) {
  const test = fixture(options);
  await assert.rejects(test.run(), { code: options.inspectionError ?? allocationActive });
  assert.equal(test.reads.allocations, 1);
}
console.log(JSON.stringify({ status: "PASS_STANDARD_NATIVE_FAILED_RETURN", cases: 5, actual_model_calls: 0 }));
