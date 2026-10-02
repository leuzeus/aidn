#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { validateJsonSchema, validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import {
  evaluateSourceBranchTransition, evaluateMappedBranchTransition,
  evaluateCloseSessionTransition, evaluateRepairRouting,
} from "../../src/application/runtime/workflow-transition-lib.mjs";
import { WORKFLOW_ACTION, WORKFLOW_REASON } from "../../src/application/runtime/workflow-transition-constants.mjs";
import { transitionCases } from "../../tests/fixtures/workflow-shadow/transition-cases.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const json = (relative) => JSON.parse(read(relative));
const fixtureRoot = "tests/fixtures/workflow-shadow";
const schema = json("src/core/contracts/workflow-definition/workflow-definition.v1.schema.json");
const profile = { contractKind: "workflow-definition" };
const matrix = json(`${fixtureRoot}/parity-matrix.v1.json`);
const current = json(`${fixtureRoot}/audit-informed.v1.json`);
const alternate = json(`${fixtureRoot}/diagnostic-correction.v1.json`);

function unique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label}: duplicate identity`);
}

function checkReference(reference) {
  assert.equal(path.isAbsolute(reference.path), false, "reference must be repository relative");
  assert(!reference.path.split(/[\\/]/u).includes(".."), "reference may not escape repository");
  assert(read(reference.path).includes(reference.anchor), `missing source ${reference.path}#${reference.anchor}`);
}

// Fixture lint only: no handler dispatch, condition evaluation, compilation or effects.
function checkDescriptor(definition) {
  assert.deepEqual(validateJsonSchema(definition, schema, "$", profile), []);
  unique(definition.steps.map((step) => step.id), "steps");
  unique(definition.transitions.map((edge) => edge.id), "transitions");
  const steps = new Map(definition.steps.map((step) => [step.id, step]));
  const evidence = new Set(matrix.evidence.map((item) => item.id));
  const rules = new Set(matrix.rules.map((item) => item.id));
  assert(steps.has(definition.entry), "unknown entry");
  for (const item of [...definition.steps, ...definition.transitions]) {
    unique(item.rule_refs, "rule refs");
    unique(item.evidence_refs, "evidence refs");
    for (const id of item.rule_refs) assert(rules.has(id), `unknown rule ${id}`);
    for (const id of item.evidence_refs) assert(evidence.has(id), `unknown evidence ${id}`);
  }
  for (const step of definition.steps) {
    checkReference(step.source);
    unique(step.outcomes, "outcomes");
    const outgoing = definition.transitions.filter((edge) => edge.from === step.id);
    if (step.kind === "terminal") {
      assert(step.terminal_result, "terminal result missing");
      assert.equal(step.outcomes.length, 0, "terminal has outcomes");
      assert.equal(outgoing.length, 0, "terminal has transitions");
    } else {
      assert.equal(step.terminal_result, undefined, "nonterminal has terminal result");
      assert(step.outcomes.length > 0, "nonterminal needs outcomes");
      assert.deepEqual(outgoing.map((edge) => edge.outcome).sort(), [...step.outcomes].sort(), "each outcome needs exactly one transition");
    }
  }
  for (const edge of definition.transitions) {
    assert(steps.has(edge.from) && steps.has(edge.to), "unknown transition endpoint");
    assert(steps.get(edge.from).outcomes.includes(edge.outcome), "unknown outcome");
    assert.equal(edge.max_traversals != null, edge.on_exhausted != null, "bound and exhaustion target must be paired");
    if (edge.on_exhausted) assert.equal(steps.get(edge.on_exhausted)?.kind, "terminal", "exhaustion must terminate");
  }
  const walk = (seed, reverse = false) => {
    const seen = new Set(seed);
    for (const id of seen) for (const edge of definition.transitions) {
      for (const target of [edge.to, edge.on_exhausted].filter(Boolean)) {
        if (reverse ? target === id : edge.from === id) seen.add(reverse ? edge.from : target);
      }
    }
    return seen;
  };
  assert.equal(walk([definition.entry]).size, steps.size, "unreachable step");
  const terminals = definition.steps.filter((step) => step.kind === "terminal").map((step) => step.id);
  assert(terminals.length > 0, "terminal missing");
  assert.equal(walk(terminals, true).size, steps.size, "step cannot reach a terminal");
}

function observe(testCase) {
  const input = structuredClone(testCase.input);
  const before = structuredClone(input);
  if (testCase.evaluator === "source") input.openCycleTopology = new Map(input.openCycleTopology);
  if (testCase.evaluator === "close") input.cycleTopology = new Map(input.cycleTopology);
  const evaluators = {
    source: evaluateSourceBranchTransition, mapped: evaluateMappedBranchTransition,
    close: evaluateCloseSessionTransition, repair: evaluateRepairRouting,
  };
  assert(evaluators[testCase.evaluator], "unknown fixture evaluator");
  const result = evaluators[testCase.evaluator](input);
  if (input.openCycleTopology instanceof Map) input.openCycleTopology = [...input.openCycleTopology];
  if (input.cycleTopology instanceof Map) input.cycleTopology = [...input.cycleTopology];
  assert.deepEqual(input, before, `${testCase.id}: helper mutated input`);
  return {
    ...result, required_user_choice: result.required_user_choice ?? [],
    warning_count: (result.warnings ?? []).length,
    mapped_cycle: result.mapped_cycle?.cycle_id ?? null,
    mapped_session: result.mapped_session?.session_id ?? null,
    candidate_cycles: (result.candidate_cycles ?? []).map((cycle) => cycle.cycle_id),
    unresolved_cycles: (result.unresolved_cycles ?? []).map((cycle) => cycle.cycle_id),
  };
}

function checkMatrix() {
  const ruleIds = Array.from({ length: 11 }, (_, i) => `SPEC-R${String(i + 1).padStart(2, "0")}`);
  assert.deepEqual([...new Set(read("docs/SPEC.md").match(/SPEC-R\d{2}/gu))].sort(), ruleIds, "SPEC rule index changed");
  assert.deepEqual(matrix.rules.map((rule) => rule.id), ruleIds);
  assert.equal(matrix.authority, "reference_only");
  unique(matrix.evidence.map((item) => item.id), "evidence");
  unique(transitionCases.map((item) => item.id), "cases");
  const caseIds = new Set(transitionCases.map((item) => item.id));
  const linked = new Set();
  for (const rule of matrix.rules) {
    checkReference(rule.source);
    assert(["engine_invariant", "audit_informed_profile", "project_policy"].includes(rule.classification));
    assert(rule.retained_obligations && rule.boundary && rule.evidence_refs.length);
    for (const id of rule.evidence_refs) assert(matrix.evidence.some((item) => item.id === id));
    assert(current.steps.some((step) => step.rule_refs.includes(rule.id)), `unrepresented rule ${rule.id}`);
  }
  for (const item of matrix.evidence) {
    checkReference(item.source);
    assert(item.expected_proof, `${item.id}: expected proof missing`);
    assert(["assertion", "suite_reference", "procedure", "declaration"].includes(item.kind));
    assert.equal(item.case_ids.length > 0, item.kind === "assertion", `${item.id}: evidence kind mismatch`);
    for (const id of item.case_ids) { assert(caseIds.has(id), `unknown case ${id}`); linked.add(id); }
  }
  assert.equal(linked.size, caseIds.size, "unlinked parity case");
  // Every shared action/reason must have a fixture, or a named existing CLI proof.
  const actions = new Set(transitionCases.map((item) => item.expected.action));
  const reasons = new Set(transitionCases.map((item) => item.expected.reason_code));
  for (const action of Object.values(WORKFLOW_ACTION)) assert(actions.has(action), `uncovered action ${action}`);
  const wrapperReasons = {
    START_SESSION_BRANCH_NOT_AIDN: ["tools/perf/verify-start-session-admission-fixtures.mjs", "non_compliant_branch"],
    START_SESSION_CANONICAL_RUNTIME_INVALID: ["tools/perf/verify-start-session-canonical-fixtures.mjs", "START_SESSION_CANONICAL_RUNTIME_INVALID"],
  };
  for (const reason of Object.values(WORKFLOW_REASON)) {
    if (reasons.has(reason)) continue;
    assert(wrapperReasons[reason], `uncovered reason ${reason}`);
    checkReference({ path: wrapperReasons[reason][0], anchor: wrapperReasons[reason][1] });
  }
}

export function runWorkflowShadowFixtureSuite() {
  const passed = [];
  const run = (name, fn) => { try { fn(); passed.push(name); } catch (error) { throw new Error(`${name}: ${error.message}`, { cause: error }); } };
  run("internal_schema_profile", () => {
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", profile), []);
    assert(validateJsonSchemaDefinition(schema).length > 0, "must not enter public CLI registry");
    assert(validateJsonSchemaDefinition(schema, "#", { contractKind: "agent-execution" }).length > 0);
    assert(validateJsonSchemaDefinition({ ...schema, unknownKeyword: true }, "#", profile).length > 0);
  });
  run("rule_matrix_and_proof_links", checkMatrix);
  run("documented_matrix_matches_fixture", () => {
    const document = read("docs/WORKFLOW_SHADOW_PARITY.md");
    for (const rule of matrix.rules) {
      assert(document.includes(`| ${rule.id} | ${rule.classification} | ${rule.retained_obligations} | ${rule.boundary} | ${rule.evidence_refs.join(", ")} |`), `${rule.id}: documented matrix drift`);
    }
    for (const item of matrix.evidence) {
      assert(document.includes(`| ${item.id} | ${item.kind} | ${item.source.path} / ${item.source.anchor} | ${item.expected_proof} |`), `${item.id}: documented evidence drift`);
    }
  });
  run("current_descriptor", () => checkDescriptor(current));
  run("alternate_descriptor", () => {
    checkDescriptor(alternate);
    assert.notEqual(alternate.entry, current.entry);
    assert.deepEqual(alternate.steps.filter((step) => step.kind === "human_decision").map((step) => step.id), ["approval", "review"]);
    const loop = alternate.transitions.find((edge) => edge.from === "review" && edge.outcome === "rejected");
    assert.deepEqual([loop.to, loop.max_traversals, loop.on_exhausted], ["correction", 2, "stop"]);
  });
  const invalid = [
    ["production_authority", (d) => { d.authority = "canonical"; }],
    ["hidden_shell", (d) => { d.steps[0].command = "echo invalid"; }],
    ["unknown_primitive", (d) => { d.steps[0].kind = "javascript"; }],
    ["unknown_condition", (d) => { d.transitions[0].expression = "true"; }],
    ["duplicate_step", (d) => { d.steps.push(structuredClone(d.steps[0])); }],
    ["unknown_target", (d) => { d.transitions[0].to = "missing"; }],
    ["unknown_evidence", (d) => { d.steps[0].evidence_refs = ["missing"]; }],
    ["unknown_outcome", (d) => { d.transitions[0].outcome = "missing"; }],
    ["duplicate_transition", (d) => { d.transitions.push(structuredClone(d.transitions[0])); }],
    ["missing_terminal_result", (d) => { delete d.steps.find((step) => step.kind === "terminal").terminal_result; }],
    ["unreachable_step", (d) => { d.steps.push({ ...d.steps.at(-1), id: "unreachable" }); }],
    ["unbounded_retry_metadata", (d) => { delete d.transitions.at(-1).on_exhausted; }],
    ["zero_retry_bound", (d) => { d.transitions.at(-1).max_traversals = 0; }],
    ["reference_escape", (d) => { d.steps[0].source.path = "docs/../../outside"; }],
  ];
  for (const [name, mutate] of invalid) run(`reject_${name}`, () => {
    const definition = structuredClone(alternate); mutate(definition);
    assert.throws(() => checkDescriptor(definition));
  });
  for (const testCase of transitionCases) run(testCase.id, () => {
    const result = observe(testCase);
    for (const [key, value] of Object.entries(testCase.expected)) assert.deepEqual(result[key], value, `${testCase.id}.${key}`);
  });
  return { passed, rule_count: matrix.rules.length, transition_count: current.transitions.length, parity_case_count: transitionCases.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runWorkflowShadowFixtureSuite();
    console.log(`PASS workflow-shadow: ${result.passed.length} checks; ${result.rule_count} rules; ${result.transition_count} descriptive transitions; ${result.parity_case_count} helper cases`);
    console.log("Evidence boundary: suite_reference/procedure/declaration entries are linked expectations, not executed proof in this gate.");
  } catch (error) {
    console.error(`FAIL workflow-shadow: ${error.message}`);
    process.exitCode = 1;
  }
}
