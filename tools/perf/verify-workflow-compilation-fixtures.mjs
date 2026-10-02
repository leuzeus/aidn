#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import childProcess from "node:child_process";
import net from "node:net";
import path from "node:path";
import { compileShadowWorkflow, validateShadowWorkflow, explainShadowTransition, getWorkflowShadowRegistry } from "../../src/core/workflow/workflow-shadow-compiler.mjs";
import { validateJsonSchema, validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { evaluateSourceBranchTransition, evaluateMappedBranchTransition, evaluateCloseSessionTransition } from "../../src/application/runtime/workflow-transition-lib.mjs";
import { transitionCases } from "../../tests/fixtures/workflow-shadow/transition-cases.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const json = p => JSON.parse(read(p));
const current = json("tests/fixtures/workflow-shadow/audit-informed.v1.json");
const alternate = json("tests/fixtures/workflow-shadow/diagnostic-correction.v1.json");
const expected = json("tests/fixtures/workflow-shadow/compilation-expectations.v1.json");
const context = { contract_version: "workflow-shadow-context.v1", authority: "caller_supplied", product_version: "0.11.0", workflow_version: 7, state_mode: "files" };
const profile = { contractKind: "workflow-definition" };
let count = 0;
function check(name, fn) { try { fn(); count++; } catch (error) { throw new Error(`${name}: ${error.message}`, { cause: error }); } }
function compile(definition = current, ctx = context) {
  const result = compileShadowWorkflow(definition, ctx);
  assert(result.ok, JSON.stringify(result.issues));
  return result.compilation;
}
function reject(definition, code, ctx = context) {
  const result = compileShadowWorkflow(definition, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.compilation, null);
  assert(result.issues.some(item => item.code === code), JSON.stringify(result.issues));
}
function reorder(value) {
  if (Array.isArray(value)) return value.map(reorder);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reorder(v)]));
  return value;
}
function trace(definition, outcomes) {
  let step = definition.entry;
  const visited = [step], counts = new Map();
  for (const outcome of outcomes) {
    const edge = definition.transitions.find(item => item.from === step && item.outcome === outcome);
    const result = explainShadowTransition(definition, context, { step_id: step, outcome, traversals: counts.get(edge?.id) ?? 0 });
    assert(result.ok, JSON.stringify(result.issues));
    counts.set(result.edge_id, (counts.get(result.edge_id) ?? 0) + 1);
    step = result.next_step; visited.push(step);
  }
  return visited;
}

check("closed_internal_schemas", () => {
  for (const name of ["workflow-definition.v1", "workflow-shadow-context.v1", "workflow-compilation.v1"]) {
    const schema = json(`src/core/contracts/workflow-definition/${name}.schema.json`);
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", profile), []);
    assert(validateJsonSchemaDefinition(schema).length);
  }
  const legacy = structuredClone(current);
  for (const step of legacy.steps) delete step.primitive_ref;
  assert.deepEqual(validateJsonSchema(legacy, json("src/core/contracts/workflow-definition/workflow-definition.v1.schema.json"), "$", profile), []);
  reject(legacy, "UNKNOWN_PRIMITIVE");
  const schema = json("src/core/contracts/workflow-definition/workflow-compilation.v1.schema.json");
  assert.deepEqual(validateJsonSchema(compile(), schema, "$", profile), []);
  for (const mutate of [d => { d.execution_available = true; }, d => { d.effects = ["write"]; }, d => { d.binding = {}; }, d => { d.steps[0].primitive_version = 0; }, d => { d.transitions[0].condition.operator = "eval"; }]) {
    const payload = structuredClone(compile()); mutate(payload);
    assert(validateJsonSchema(payload, schema, "$", profile).length);
  }
});

check("registry_references_and_coverage", () => {
  const registry = getWorkflowShadowRegistry();
  assert(Object.isFrozen(registry));
  assert.equal(registry.execution, "unsupported");
  assert.equal(new Set(registry.primitives.map(p => p.id)).size, registry.primitives.length);
  const refs = new Set([...current.steps, ...alternate.steps].map(step => step.primitive_ref));
  assert.deepEqual([...refs].sort(), registry.primitives.map(p => p.id).sort());
  const matrix = json("tests/fixtures/workflow-shadow/parity-matrix.v1.json");
  assert.deepEqual(registry.evidence, matrix.evidence.map(item => item.id).sort());
  assert.deepEqual(registry.rules, matrix.rules.map(item => item.id));
  for (const primitive of registry.primitives) {
    assert.equal(primitive.version, 1);
    assert.equal(new Set(primitive.outcomes).size, primitive.outcomes.length);
    for (const reference of primitive.sources) assert(read(reference.path).includes(reference.anchor));
    if (primitive.observation) for (const outcome of Object.values(primitive.observation.values)) assert(primitive.outcomes.includes(outcome));
  }
  assert.deepEqual(registry.primitives.filter(p => p.admission_boundary).map(p => p.id), ["definition_of_ready"]);
});

check("deterministic_normalization_and_golden_hashes", () => {
  for (const definition of [current, alternate]) {
    const permuted = reorder(definition);
    permuted.steps.reverse(); permuted.transitions.reverse();
    for (const item of [...permuted.steps, ...permuted.transitions]) {
      item.rule_refs.reverse(); item.evidence_refs.reverse(); item.outcomes?.reverse();
    }
    assert.deepEqual(compile(permuted, reorder(context)), compile(definition));
    assert.equal(JSON.stringify(compile(permuted)), JSON.stringify(compile(definition)));
    assert.equal(compile(definition).compilation_sha256, expected.compilation_sha256[definition.workflow_id]);
    const revised = { ...definition, revision: definition.revision + 1 };
    assert.notEqual(compile(revised).definition.sha256, compile(definition).definition.sha256);
    assert.notEqual(compile(revised).compilation_sha256, compile(definition).compilation_sha256);
  }
});

check("all_state_modes_are_pure_context_data", () => {
  const hashes = new Set();
  for (const state_mode of ["files", "dual", "db-only"]) {
    const result = compile(current, { ...context, state_mode });
    hashes.add(result.compilation_sha256);
    assert.equal(result.context.state_mode, state_mode);
    assert.deepEqual(result.effects, []); assert.deepEqual(result.artifacts, []);
    assert.equal(result.execution_available, false); assert.equal(result.binding, null);
  }
  assert.equal(hashes.size, 3);
});

check("current_macro_and_distinct_alternate_paths", () => {
  for (const test of expected.traces) {
    const definition = test.workflow_id === current.workflow_id ? current : alternate;
    assert.deepEqual(trace(definition, test.outcomes), test.steps, test.id);
  }
  assert.notEqual(compile(current).definition.sha256, compile(alternate).definition.sha256);
  assert.equal(compile(current).registry.sha256, compile(alternate).registry.sha256);
  assert.equal(compile(alternate).diagnostics.find(d => d.path === "$.steps.correction").code, "SEGMENT_PLAN_AND_ADMISSION_REQUIRED");
});

check("graph_change_alone_changes_compiled_path", () => {
  const changed = structuredClone(alternate);
  const targets = { diagnose_diagnosed: "review", review_accepted: "approval", correction_completed: "done" };
  for (const edge of changed.transitions) if (targets[edge.id]) edge.to = targets[edge.id];
  assert.deepEqual(trace(changed, ["diagnosed", "accepted", "approved", "completed"]), ["diagnose", "review", "approval", "correction", "done"]);
  assert.notEqual(compile(changed).compilation_sha256, compile(alternate).compilation_sha256);
  assert.equal(compile(changed).registry.sha256, compile(alternate).registry.sha256);
  const renamed = structuredClone(alternate); renamed.workflow_id = "another_profile";
  for (const step of renamed.steps) step.id = `new_${step.id}`;
  renamed.entry = `new_${renamed.entry}`;
  for (const edge of renamed.transitions) { edge.id = `new_${edge.id}`; edge.from = `new_${edge.from}`; edge.to = `new_${edge.to}`; if (edge.on_exhausted) edge.on_exhausted = `new_${edge.on_exhausted}`; }
  assert.deepEqual(trace(renamed, ["diagnosed", "approved", "completed", "accepted"]), ["new_diagnose", "new_approval", "new_correction", "new_review", "new_done"]);
});

check("retry_boundary_zero_one_two_and_terminal", () => {
  for (const traversals of [0, 1, 2, 3]) {
    const result = explainShadowTransition(alternate, context, { step_id: "review", outcome: "rejected", traversals });
    assert.equal(result.next_step, traversals < 2 ? "correction" : "stop");
    assert.equal(result.exhausted, traversals >= 2);
    assert.equal(result.execution_available, false);
  }
  assert.equal(explainShadowTransition(alternate, context, { step_id: "done", outcome: "accepted" }).ok, false);
});

// Existing helpers remain the decision authority. The compiler only maps their
// observed finite action vocabulary to macro outcomes, preserving the payload.
for (const test of transitionCases.filter(test => test.evaluator !== "repair")) check(`compiled_parity_${test.id}`, () => {
  const input = structuredClone(test.input);
  if (test.evaluator === "source") input.openCycleTopology = new Map(input.openCycleTopology);
  if (test.evaluator === "close") input.cycleTopology = new Map(input.cycleTopology);
  const helper = { source: evaluateSourceBranchTransition, mapped: evaluateMappedBranchTransition, close: evaluateCloseSessionTransition }[test.evaluator];
  const observation = JSON.parse(JSON.stringify(helper(input)));
  assert.equal(observation.action, test.expected.action);
  assert.equal(observation.reason_code ?? null, test.expected.reason_code);
  const result = explainShadowTransition(current, context, { step_id: test.evaluator === "close" ? "close" : "start", observation });
  assert(result.ok, JSON.stringify(result.issues));
  assert.deepEqual(result.observation, observation);
  const target = expected.action_targets[test.expected.action];
  assert(target, `missing independent expected target for ${test.expected.action}`);
  assert.equal(result.next_step, target);
});

const invalid = [
  ["missing_primitive", "UNKNOWN_PRIMITIVE", d => { delete d.steps[0].primitive_ref; }],
  ["unknown_primitive", "UNKNOWN_PRIMITIVE", d => { d.steps[0].primitive_ref = "unknown"; }],
  ["source_escape", "SOURCE_REFERENCE_MISMATCH", d => { d.steps[0].source.path = "docs/../outside"; }],
  ["wrong_handler_kind", "PRIMITIVE_KIND_MISMATCH", d => { d.steps[0].kind = "gate"; }],
  ["unknown_output", "OUTPUT_TYPE_MISMATCH", d => { d.steps[0].outcomes[0] = "unknown"; }],
  ["unknown_condition", "SCHEMA_INVALID", d => { d.transitions[0].condition = "true"; }],
  ["hidden_shell", "SCHEMA_INVALID", d => { d.steps[0].shell = "echo denied"; }],
  ["permissions", "SCHEMA_INVALID", d => { d.permissions = ["write"]; }],
  ["parameters", "SCHEMA_INVALID", d => { d.parameters = { executor: "custom" }; }],
  ["duplicate_step", "DUPLICATE_IDENTITY", d => { d.steps.push(structuredClone(d.steps[0])); }],
  ["duplicate_edge", "DUPLICATE_IDENTITY", d => { d.transitions.push(structuredClone(d.transitions[0])); }],
  ["duplicate_outcome", "DUPLICATE_IDENTITY", d => { d.steps[0].outcomes.push(d.steps[0].outcomes[0]); }],
  ["unknown_entry", "UNKNOWN_ENTRY", d => { d.entry = "missing"; }],
  ["unknown_target", "UNKNOWN_ENDPOINT", d => { d.transitions[0].to = "missing"; }],
  ["unknown_evidence", "UNKNOWN_REFERENCE", d => { d.steps[0].evidence_refs = ["missing"]; }],
  ["missing_outcome_edge", "OUTCOME_COVERAGE", d => { d.transitions.shift(); }],
  ["unreachable", "UNREACHABLE_STEP", d => { d.steps.push({ ...d.steps.at(-1), id: "unreachable" }); }],
  ["missing_terminal_result", "INVALID_TERMINAL", d => { delete d.steps.at(-1).terminal_result; }],
  ["no_terminal_path", "NO_TERMINAL_PATH", d => { for (const e of d.transitions) if (e.from !== "review") e.to = e.from; }],
  ["unbounded_return", "UNBOUNDED_RETURN", d => { delete d.transitions.at(-1).max_traversals; delete d.transitions.at(-1).on_exhausted; }],
  ["missing_exhaustion", "INCOMPLETE_BOUND", d => { delete d.transitions.at(-1).on_exhausted; }],
  ["exhaustion_nonterminal", "INVALID_EXHAUSTION", d => { d.transitions.at(-1).on_exhausted = "approval"; }],
  ["zero_bound", "SCHEMA_INVALID", d => { d.transitions.at(-1).max_traversals = 0; }],
];
for (const [name, code, mutate] of invalid) check(`reject_${name}`, () => { const d = structuredClone(alternate); mutate(d); reject(d, code); });
check("admission_boundary_cannot_be_bypassed_by_a_return", () => {
  const d = structuredClone(current); d.transitions.find(e => e.from === "drift" && e.outcome === "resolved").to = "implement";
  reject(d, "UNBOUNDED_RETURN");
});
check("unknown_or_changed_context", () => {
  reject(current, "INCOMPATIBLE_CONTEXT", { ...context, product_version: "0.12.0" });
  reject(current, "SCHEMA_INVALID", { ...context, state_mode: "unknown" });
  reject(current, "SCHEMA_INVALID", { ...context, scope: ["outside"] });
});
check("non_json_inputs_and_resource_limits", () => {
  for (const bad of [undefined, NaN, Infinity, 1.5, 1n, new Date(), new Map(), () => {}, new Array(2)]) assert.equal(compileShadowWorkflow(bad, context).ok, false);
  const getter = {}; Object.defineProperty(getter, "steps", { enumerable: true, get() { throw new Error("getter invoked"); } });
  reject(getter, "INVALID_JSON");
  const cyclic = {}; cyclic.self = cyclic; reject(cyclic, "INVALID_JSON");
  const symbol = structuredClone(current); symbol[Symbol()] = 1; reject(symbol, "INVALID_JSON");
  const enormous = structuredClone(current); enormous.workflow_id = "x".repeat(16385); reject(enormous, "JSON_LIMIT");
  const large = structuredClone(alternate); while (large.steps.length < 257) large.steps.push({ ...large.steps[0], id: `step_${large.steps.length}` }); reject(large, "GRAPH_LIMIT");
});
check("unknown_observations_and_invalid_requests_refuse", () => {
  for (const request of [null, {}, { step_id: "start", observation: { action: "unknown" } }, { step_id: "mode", observation: { action: "create_session_allowed" } },
    { step_id: "start", outcome: "unknown" }, { step_id: "start", outcome: "admitted", traversals: -1 }, { step_id: "start", outcome: "admitted", observation: {} },
    { step_id: "start", outcome: "admitted", write: true }]) assert.equal(explainShadowTransition(current, context, request).ok, false);
});
check("immutable_inputs_outputs_and_registry", () => {
  const before = JSON.stringify({ current, alternate, context });
  const result = compile();
  assert.throws(() => { result.steps[0].id = "changed"; }, TypeError);
  assert.throws(() => { getWorkflowShadowRegistry().primitives[0].outcomes.push("changed"); }, TypeError);
  assert.equal(JSON.stringify({ current, alternate, context }), before);
});
check("no_ambient_io_or_clock_during_validate_compile_explain", () => {
  const replacements = [];
  const deny = () => { throw new Error("ambient effect or observation attempted"); };
  const replace = (object, key) => { replacements.push([object, key, object[key]]); object[key] = deny; };
  try {
    for (const key of ["readFileSync", "writeFileSync", "mkdirSync", "statSync", "readdirSync", "existsSync", "openSync", "rmSync"]) replace(fs, key);
    for (const key of ["spawn", "spawnSync", "exec", "execSync", "fork"]) replace(childProcess, key);
    replace(net, "connect"); replace(Date, "now"); replace(Math, "random");
    assert(validateShadowWorkflow(current, context).ok);
    assert(compileShadowWorkflow(alternate, context).ok);
    assert(explainShadowTransition(alternate, context, { step_id: "review", outcome: "rejected", traversals: 2 }).ok);
  } finally { for (const [object, key, value] of replacements.reverse()) object[key] = value; }
});
console.log(`PASS workflow-compilation: ${count} checks; 2 macro graphs; 28 compiled helper decisions; no execution or native qualification`);
