import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateJsonSchema, validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { baselinePromotionPaths } from "../../src/core/workflow/standard-baseline-promotion.mjs";
const schemas = Object.fromEntries(["input", "plan", "output"].map(kind => [kind, JSON.parse(fs.readFileSync(new URL(`../../src/core/contracts/workflow-definition/standard-baseline-promotion-hook-${kind}.v1.schema.json`, import.meta.url)))]));
let checks = 0;
const test = (name, run) => { run(); checks++; console.log("PASS " + name); };
const valid = (value, schema) => validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length === 0;
test("private promotion finalizer schemas use supported validation vocabulary", () => {
  for (const schema of Object.values(schemas)) assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
});
test("input selects only an accepted record identity and cannot author permission or a successful result", () => {
  const input = { record_operation_id: "op_" + "a".repeat(40) }; assert.ok(valid(input, schemas.input));
  for (const extra of [{ authorized: true }, { completed: true }, { source_module: "arbitrary.mjs" }, { version: "v9.9" }]) assert.equal(valid({ ...input, ...extra }, schemas.input), false);
});
const output = (outcome, effect_status, facts, evidence_refs = []) => ({ contract_version: "standard-baseline-promotion-hook-output.v1", operation_ref: "baseline_promotion_finalize",
  outcome, effect_status, facts, evidence_refs, observations: { reason_code: "FIXTURE_REASON" } });
test("blocked and uncertain results remain distinct and cannot inherit completion facts", () => {
  for (const [outcome, effect] of [["blocked", "no_effect"], ["reconciliation_required", "unknown"]]) {
    const value = output(outcome, effect, {}); assert.ok(valid(value, schemas.output)); assert.equal(valid({ ...value, facts: { baseline_recorded: true, baseline_promotion_completed: true } }, schemas.output), false);
    assert.equal(valid({ ...value, effect_status: "confirmed" }, schemas.output), false);
  }
});
test("confirmed completion requires five committed postimages and six evidence references", () => {
  const value = output("completed", "confirmed", { baseline_recorded: true, baseline_promotion_completed: true }, Array.from({ length: 6 }, (_, i) => ({ ref: "fixture/" + i, sha256: "a".repeat(64) })));
  value.observations = { cycle_id: "C001", version: "v0.3", event: { event: "checkpoint_summary" }, event_offset: 0,
    event_file: ".aidn/runtime/perf/workflow-events.ndjson", committed: [...baselinePromotionPaths] }; assert.ok(valid(value, schemas.output));
  const missing = structuredClone(value); missing.observations.committed.pop(); assert.equal(valid(missing, schemas.output), false);
  const unconfirmed = structuredClone(value); unconfirmed.facts.baseline_promotion_completed = false; assert.equal(valid(unconfirmed, schemas.output), false);
});
test("fixed deterministic binding consumes only a record identity and preserves outcome contracts", () => {
  const binding = standardWorkflowOperationBindings().find(row => row.id === "baseline_promotion_finalize");
  assert.equal(binding.executor_kind, "deterministic"); assert.equal(binding.effect_class, "executor"); assert.equal(binding.skill_id, "promote-baseline"); assert.deepEqual(binding.allowed_modes, ["COMMITTING"]);
  assertStandardOperationInput(binding.id, { record_operation_id: "op_" + "a".repeat(40) });
  assert.throws(() => assertStandardOperationInput(binding.id, { record_operation_id: "op_" + "a".repeat(40), authorized: true }), { code: "STANDARD_OPERATION_INPUT_INVALID" });
  assertStandardOperationOutput(output("blocked", "no_effect", {})); assertStandardOperationOutput(output("reconciliation_required", "unknown", {}));
});
console.log(JSON.stringify({ status: "PASS", checks, proof: "promotion-finalizer-contract", actual_checkpoint: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
