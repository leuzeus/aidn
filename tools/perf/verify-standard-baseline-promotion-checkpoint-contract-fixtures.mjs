import assert from "node:assert/strict";
import fs from "node:fs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
let checks = 0;
const test = (name, run) => { run(); checks++; console.log("PASS " + name); };
for (const kind of ["input", "plan", "output"]) test("promotion checkpoint " + kind + " uses only supported closed schema constructs", () => {
  const schema = JSON.parse(fs.readFileSync(new URL(`../../src/core/contracts/workflow-definition/standard-baseline-promotion-checkpoint-${kind}.v1.schema.json`, import.meta.url)));
  assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  assert.equal(schema.additionalProperties, false);
  const version = `standard-baseline-promotion-checkpoint-${kind}.v1`;
  assert.equal(schema.$id, "aidn://contracts/workflow-definition/" + version);
  assert.equal(schema["x-aidn-contract-version"], version);
  if (schema.properties.contract_version) assert.equal(schema.properties.contract_version.const, version);
  if (kind === "plan") assert.equal(schema.properties.input["x-aidn-contract-version"], "standard-baseline-promotion-checkpoint-input.v1");
});
const input = { closure_operation_id: "op_" + "a".repeat(40), record_operation_id: "op_" + "b".repeat(40), terminal_checkpoint_operation_id: "op_" + "c".repeat(40) };
test("input identifies three accepted records rather than commands or granted paths", () => {
  assertStandardOperationInput("baseline_promotion_checkpoint", input);
  for (const extra of [{ approvedPaths: ["foreign.mjs"] }, { command: "git add ." }, { approved: true }, { closure_operation_id: "untrusted" }])
    assert.throws(() => assertStandardOperationInput("baseline_promotion_checkpoint", { ...input, ...extra }));
});
const completed = { contract_version: "standard-baseline-promotion-checkpoint-output.v1", operation_ref: "baseline_promotion_checkpoint", outcome: "completed", effect_status: "confirmed",
  facts: { baseline_checkpoint_completed: true, baseline_checkpoint_commit_created: true, baseline_promotion_completed: false }, observations: {}, evidence_refs: [] };
test("completed checkpoint still leaves the promote-baseline skill pending", () => {
  assertStandardOperationOutput(completed);
  for (const mutate of [x => { x.facts.baseline_promotion_completed = true; }, x => { x.facts.baseline_checkpoint_completed = false; },
    x => { x.effect_status = "no_effect"; }, x => { delete x.facts.baseline_checkpoint_commit_created; }, x => { x.facts.baseline_promoted = true; }]) {
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
console.log(JSON.stringify({ status: "PASS", checks, scope: "promotion-checkpoint-contracts", application: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
