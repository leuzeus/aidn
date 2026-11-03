import assert from "node:assert/strict";
import fs from "node:fs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
let checks = 0;
const test = (name, run) => { run(); checks++; console.log("PASS " + name); };
for (const kind of ["input", "plan", "output"]) test("terminal checkpoint " + kind + " uses only supported closed schema constructs", () => {
  const schema = JSON.parse(fs.readFileSync(new URL(`../../src/core/contracts/workflow-definition/standard-cycle-terminal-checkpoint-${kind}.v1.schema.json`, import.meta.url)));
  assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  assert.equal(schema.additionalProperties, false);
});
const input = { closure_operation_id: "op_" + "a".repeat(40) };
test("input identifies an authenticated closure rather than commands or granted paths", () => {
  assertStandardOperationInput("cycle_terminal_checkpoint", input);
  for (const extra of [{ approvedPaths: ["foreign.mjs"] }, { command: "git add ." }, { approved: true }, { closure_operation_id: "untrusted" }])
    assert.throws(() => assertStandardOperationInput("cycle_terminal_checkpoint", { ...input, ...extra }));
});
const completed = { contract_version: "standard-cycle-terminal-checkpoint-output.v1", operation_ref: "cycle_terminal_checkpoint", outcome: "completed", effect_status: "confirmed",
  facts: { cycle_terminal_checkpoint_completed: true, cycle_terminal_commit_created: true, cycle_close_completed: false }, observations: {}, evidence_refs: [] };
test("completed checkpoint still leaves the cycle-close skill pending", () => {
  assertStandardOperationOutput(completed);
  for (const mutate of [x => { x.facts.cycle_close_completed = true; }, x => { x.facts.cycle_terminal_checkpoint_completed = false; },
    x => { x.effect_status = "no_effect"; }, x => { delete x.facts.cycle_terminal_commit_created; }, x => { x.facts.baseline_promoted = true; }]) {
    const bad = structuredClone(completed); mutate(bad); assert.throws(() => assertStandardOperationOutput(bad));
  }
});
test("refusal and unknown effect preserve empty facts and distinct outcomes", () => {
  for (const [outcome, effect_status] of [["blocked", "no_effect"], ["reconciliation_required", "unknown"]]) {
    const value = { ...completed, outcome, effect_status, facts: {} }; assertStandardOperationOutput(value);
    assert.throws(() => assertStandardOperationOutput({ ...value, facts: completed.facts }));
  }
  assert.throws(() => assertStandardOperationOutput({ ...completed, outcome: "completed", effect_status: "unknown" }));
});
console.log(JSON.stringify({ status: "PASS", checks, scope: "terminal-checkpoint-contracts", application: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
