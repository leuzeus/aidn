#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bindWorkflowSegment, assertWorkflowSegmentBinding, previewWorkflowSegment } from "../../src/core/workflow/workflow-segment-binding.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { normalizeAgentExecutionPlan, fingerprintAgentExecutionValue as hash } from "../../src/core/agents/agent-execution-contracts.mjs";
import { validateJsonSchema, validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { assertAgentRunConfiguration } from "../../src/application/runtime/agent-run-configuration-service.mjs";
import { parseAgentRunArguments, buildAgentRunActionPreview, createAgentRunLifecycle } from "../../src/application/runtime/agent-run-lifecycle-service.mjs";
import { createPublicAgentRunLifecycle } from "../../src/application/runtime/agent-run-public-composition.mjs";
import { inspectNativeAgentRun } from "../../src/application/runtime/agent-run-native-runtime-service.mjs";
import { createSchedulerFixture } from "./agent-execution-scheduler-test-lib.mjs";

const json = file => JSON.parse(fs.readFileSync(new URL("../../" + file, import.meta.url), "utf8"));
const definition = json("tests/fixtures/workflow-shadow/diagnostic-correction.v1.json");
const source = json("tests/fixtures/agent-execution/contracts/complete-chain.json");
const context = { contract_version: "workflow-shadow-context.v1", authority: "caller_supplied", product_version: "0.11.0", workflow_version: 7, state_mode: "dual" };
const profile = { contractKind: "workflow-definition" };
const checks = [];
async function check(name, operation) {
  await operation(); checks.push(name); console.log("PASS " + name);
}
const select = (canonical = source.plan.canonical, overrides = {}) => bindWorkflowSegment({ definition, context, stepId: "correction", canonical, ...overrides });
function configuration(root = os.tmpdir()) {
  const ref = name => ({ path: path.join(root, "resources", name), sha256: "a".repeat(64) });
  return { contract_version: "agent-run-configuration.v2", run_id: "run.fixture", planning_key: "planning.fixture",
    target_root: path.join(root, "target"), resources_root: path.join(root, "resources"), integration_ref: "refs/heads/codex/fixture",
    prepared_manifest: ref("prepared.json"), git: { executable: process.execPath, sha256: "a".repeat(64) },
    commit_identity: { name: "AIDN fixture", email: "fixture@example.invalid", timestamp: "2026-10-01T00:00:00Z" },
    native: { candidate: {}, runtime: {}, helper: {}, metadata_runner: { executable: process.execPath, sha256: "a".repeat(64) },
      qualification: ref("qualification.json"), profile: { manifest: ref("profile.json"), policy: ref("policy.json"), consent: {} } },
    verification: { runner: { id: "fixture", executable: process.execPath }, environment: {}, audit_policy: ref("audit.json"), public_key: ref("public.pem"),
      private_key: ref("private.pem"), boundary: { configuration: ref("boundary.json"), qualification: ref("boundary-proof.json") } }, workflow: select() };
}
function observed(config = configuration()) {
  const plan = structuredClone(source.plan); delete plan.plan_sha256;
  plan.supervision = { configuration_sha256: hash(config) };
  return { configuration: config, plan: normalizeAgentExecutionPlan(plan), snapshot: null,
    targetIdentity: { target_root: config.target_root }, preconditions: { blockers: [], canonical_snapshot_sha256: "b".repeat(64) } };
}
const args = (command = "agent-run", extra = []) => parseAgentRunArguments(command, ["--configuration", "/fixture.json", "--json",
  ...(command === "agent-run" ? ["--plan", "/plan.json"] : ["--run", "run.fixture"]), ...extra]);
const execute = preview => args("agent-run", ["--execute", "--expect-plan", preview.action_sha256, "--sync-relay"]);
const reseal = binding => { const { binding_sha256, ...body } = binding; return { ...body, binding_sha256: shadowHash(body) }; };
function harness(c, second = c) {
  const calls = []; let reads = 0;
  const lifecycle = createAgentRunLifecycle({ readContext: async () => { calls.push("read"); return reads++ ? second : c; },
    createRuntime: async () => { calls.push("runtime"); throw new Error("unexpected runtime construction"); } });
  return { lifecycle, calls };
}

await check("closed binding and selection contracts with exact plan and canonical pins", () => {
  for (const name of ["workflow-segment-binding.v1", "workflow-segment-selection.v1"]) {
    const schema = json(`src/core/contracts/workflow-definition/${name}.schema.json`);
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", profile), []);
    const value = name.includes("binding") ? select() : previewWorkflowSegment(select(), source.plan);
    assert.deepEqual(validateJsonSchema(value, schema, "$", profile), []);
    assert.ok(validateJsonSchema({ ...value, unexpected: true }, schema, "$", profile).length);
  }
  assert.equal(select().canonical_sha256, hash(source.plan.canonical));
  assert.equal(previewWorkflowSegment(select(), source.plan).plan_sha256, normalizeAgentExecutionPlan(source.plan).plan_sha256);
});
await check("selection is deterministic and leaves definition, context and plan unchanged", () => {
  const before = hash({ definition, context, source }), binding = select();
  assert.deepEqual(binding, select()); assert(Object.isFrozen(binding.definition.steps));
  previewWorkflowSegment(binding, source.plan); assert.equal(hash({ definition, context, source }), before);
});
for (const version of [1, 2, 3]) await check(`selection preserves agent plan v${version} without implicit upgrade`, () => {
  const plan = structuredClone(source.plan); delete plan.plan_sha256;
  plan.contract_version = `agent-execution-plan.v${version}`;
  if (version > 1) plan.assurance_profile = `codex-cooperative.v${version - 1}`;
  const normalized = normalizeAgentExecutionPlan(plan), before = hash(normalized);
  assert.equal(previewWorkflowSegment(select(), normalized).plan_sha256, normalized.plan_sha256);
  assert.equal(hash(normalized), before); assert.equal(normalized.contract_version, plan.contract_version);
});
await check("v1 remains closed and v2 requires an explicit valid binding", () => {
  const v2 = configuration(); assert.equal(assertAgentRunConfiguration(v2), v2);
  const v1 = { ...v2, contract_version: "agent-run-configuration.v1" }; delete v1.workflow;
  assertAgentRunConfiguration(v1);
  for (const invalid of [{ ...v1, workflow: v2.workflow }, { ...v1, contract_version: "agent-run-configuration.v2" }, { ...v2, workflow: null }, { ...v2, contract_version: "agent-run-configuration.v3" }]) {
    assert.throws(() => assertAgentRunConfiguration(invalid));
  }
  assert.equal(Object.hasOwn(buildAgentRunActionPreview(args(), observed(v1)).action.preconditions, "workflow"), false);
});
for (const stepId of ["missing", "diagnose", "approval", "review", "done"]) await check(`non-segment selection refused: ${stepId}`, () => {
  assert.throws(() => select(undefined, { stepId }), { code: "WORKFLOW_SEGMENT_STEP_INVALID" });
});
await check("unknown primitives and unbounded macro return fail before binding", () => {
  const unknown = structuredClone(definition); unknown.steps[0].primitive_ref = "unknown";
  assert.throws(() => select(undefined, { definition: unknown }), { code: "WORKFLOW_SEGMENT_COMPILATION_INVALID" });
  const unbounded = structuredClone(definition), edge = unbounded.transitions.find(item => item.max_traversals);
  delete edge.max_traversals; delete edge.on_exhausted;
  assert.throws(() => select(undefined, { definition: unbounded }), { code: "WORKFLOW_SEGMENT_COMPILATION_INVALID" });
});
await check("tampered pins, getters and non-JSON data are refused", () => {
  assert.throws(() => assertWorkflowSegmentBinding({ ...select(), revision: 2 }), { code: "WORKFLOW_SEGMENT_BINDING_CHANGED" });
  let reads = 0; const hostile = { ...select() }; Object.defineProperty(hostile, "step_id", { get() { reads++; return "correction"; }, enumerable: true });
  assert.throws(() => assertWorkflowSegmentBinding(hostile), { code: "WORKFLOW_SEGMENT_BINDING_INVALID" }); assert.equal(reads, 0);
  assert.throws(() => select(undefined, { revision: Infinity }), { code: "WORKFLOW_SEGMENT_BINDING_INVALID" });
  const revision = {}; Object.defineProperty(revision, "value", { get() { reads++; return 1; }, enumerable: true });
  assert.throws(() => select(undefined, { revision }), { code: "WORKFLOW_SEGMENT_BINDING_INVALID" }); assert.equal(reads, 0);
});
for (const field of ["session_id", "cycle_id", "planning_revision", "plan_sha256", "task_selector", "activation", "scope"]) await check(`canonical ${field} cannot be rebound`, () => {
  const plan = structuredClone(source.plan); delete plan.plan_sha256;
  if (field === "scope") plan.canonical.scope.push({ path: "extra.txt", operations: ["add"] });
  else if (field === "activation") plan.canonical.activation.revision++;
  else if (field === "planning_revision") plan.canonical[field]++;
  else if (field === "plan_sha256") plan.canonical[field] = "c".repeat(64);
  else plan.canonical[field] += "2";
  assert.throws(() => previewWorkflowSegment(select(), plan), { code: "WORKFLOW_SEGMENT_CANONICAL_CHANGED" });
});
await check("existing scope and DAG validators remain authoritative", () => {
  for (const [code, mutation] of [["SCOPE_NOT_SUBSET", p => p.tasks[0].scope.push({ path: "unauthorized.txt", operations: ["add"] })], ["DEPENDENCY_CYCLE", p => p.tasks[0].depends_on.push("join")]]) {
    const plan = structuredClone(source.plan); delete plan.plan_sha256; mutation(plan);
    assert.throws(() => previewWorkflowSegment(select(), plan), { code });
  }
});
await check("preview contains contracted provenance and constructs no runtime", async () => {
  const c = observed(), before = hash(c), h = harness(c), result = await h.lifecycle.invoke(args());
  assert.deepEqual(result.errors, []); assert.equal(result.written, false); assert.equal(result.shared_coordination_sync, false);
  assert.deepEqual(h.calls, ["read"]); assert.equal(hash(c), before);
  assert.equal(result.action.preconditions.workflow.macro_progress, "not_evaluated");
  assert.equal(result.action.preconditions.workflow.validation, "compiled");
  assert.deepEqual(validateJsonSchema(result, json("src/core/contracts/cli-output/runtime-agent-run.v1.schema.json")), []);
});
await check("rebound definition invalidates both the frozen plan and earlier approval", async () => {
  const c = observed(), original = buildAgentRunActionPreview(args(), c), nextConfig = configuration();
  const nextDefinition = structuredClone(definition); nextDefinition.revision++;
  nextConfig.workflow = select(undefined, { definition: nextDefinition, revision: 2 });
  assert.throws(() => buildAgentRunActionPreview(args(), { ...c, configuration: nextConfig }), { code: "AGENT_RUN_CONFIGURATION_CHANGED" });
  const h = harness(observed(nextConfig)), out = await h.lifecycle.invoke(execute(original));
  assert.deepEqual(out.errors, ["AGENT_RUN_PREVIEW_CHANGED"]); assert.deepEqual(h.calls, ["read"]);
});
await check("revocation on second read refuses all effects", async () => {
  const c = observed(), second = structuredClone(c); second.preconditions.blockers.push("AGENT_RUN_ACTIVATION_INVALID");
  const h = harness(c, second), out = await h.lifecycle.invoke(execute(buildAgentRunActionPreview(args(), c)));
  assert.deepEqual(out.errors, ["AGENT_RUN_PREVIEW_CHANGED"]); assert.deepEqual(h.calls, ["read", "read"]); assert.equal(out.written, false);
});
for (const field of ["compiler_version", "compilation_sha256", "registry", "definition_sha256"]) await check(`compiler drift blocks new execution but retains historical cancellation: ${field}`, () => {
  const cfg = configuration(), binding = structuredClone(cfg.workflow);
  binding[field] = field === "compiler_version" ? "historical.compiler" : field === "registry" ? { version: "historical.registry", sha256: "d".repeat(64) } : "d".repeat(64);
  cfg.workflow = reseal(binding); const c = observed(cfg);
  assert.throws(() => buildAgentRunActionPreview(args(), c), { code: "WORKFLOW_SEGMENT_COMPILATION_CHANGED" });
  assert.throws(() => buildAgentRunActionPreview(args("agent-run-resume"), c), { code: "WORKFLOW_SEGMENT_COMPILATION_CHANGED" });
  for (const command of ["agent-run-status", "agent-run-cancel", "agent-run-cleanup"]) assert.equal(buildAgentRunActionPreview(args(command), c).action.preconditions.workflow.validation, "retained");
  c.snapshot = { run: { run_id: cfg.run_id, plan_sha256: c.plan.plan_sha256 }, cancel_request: { request_sha256: "e".repeat(64) } };
  assert.equal(buildAgentRunActionPreview(args("agent-run-resume"), c).action.preconditions.workflow.validation, "retained");
});
await check("public composition refuses a client without PostgreSQL before native execution", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-segment-"));
  try {
    const cfg = configuration(root); fs.mkdirSync(cfg.target_root); fs.mkdirSync(cfg.resources_root);
    const configPath = path.join(root, "configuration.json"), planPath = path.join(root, "plan.json");
    fs.writeFileSync(configPath, JSON.stringify(cfg)); fs.writeFileSync(planPath, JSON.stringify(observed(cfg).plan));
    const out = await createPublicAgentRunLifecycle().invoke(parseAgentRunArguments("agent-run", ["--target", cfg.target_root, "--configuration", configPath, "--plan", planPath, "--json"]));
    assert.deepEqual(out.errors, ["AGENT_RUN_POSTGRES_REQUIRED"]); assert.equal(out.written, false);
    assert.deepEqual(fs.readdirSync(cfg.target_root), []); assert.deepEqual(fs.readdirSync(cfg.resources_root), []);
  } finally {
    const resolved = fs.realpathSync(root);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir())); assert(path.basename(resolved).startsWith("aidn-segment-"));
    fs.rmSync(resolved, { recursive: true });
  }
});
await check("native preview reports the first missing candidate prerequisite explicitly", async () => {
  const c = observed(), before = hash(c);
  const out = await inspectNativeAgentRun({ args: args(), context: c });
  assert.deepEqual(out.blockers, ["AGENT_RUN_ABSOLUTE_PATH_REQUIRED"]);
  assert.deepEqual(out.resources, []); assert.equal(hash(c), before);
});
await check("approved selected segment traverses the existing scheduler and returns evidence", async () => {
  const c = observed(), raw = structuredClone(c.plan); delete raw.plan_sha256;
  raw.validations = [{ validation_id: "contents", argv: ["fixture", "contents"] }];
  raw.limits.concurrency = 2;
  raw.audit = { read_only: true, criteria: ["Changes remain in delegated scope"] };
  c.plan = normalizeAgentExecutionPlan(raw);
  const f = createSchedulerFixture({ plan: c.plan }), calls = [];
  try {
    const lifecycle = createAgentRunLifecycle({ readContext: async () => c, createRuntime: async () => ({
      store: { reserveRun: async input => { assert.deepEqual(input.plan, c.plan); assert.equal(input.planningKey, c.configuration.planning_key); calls.push("reserved"); } },
      scheduler: f.create(), ownerId: f.options.ownerId, runner: f.options.runner, close: async () => calls.push("closed"),
    }) });
    const out = await lifecycle.invoke(execute(await lifecycle.invoke(args())));
    assert.deepEqual(out.errors, []); assert.equal(out.written, true); assert.equal(out.status.execution_status, "completed");
    assert.deepEqual(calls, ["reserved", "closed"]); assert.equal(f.maxLive, 2);
    assert.deepEqual(f.state.integrations.map(row => row.prepared.task_id), ["alpha", "beta", "join"]);
    assert(f.operations.indexOf("integration-applied:beta") < f.operations.indexOf("claim:join"));
    assert.equal(out.status.validation.sha, f.state.integration_head.sha);
    assert.equal(out.action.preconditions.workflow.plan_sha256, out.plan_sha256);
    assert(out.status.attempts.every(row => row.acceptance === "accepted" && row.termination_state === "confirmed"));
  } finally { f.cleanup(); }
});
console.log(JSON.stringify({ ok: true, checks: checks.length, proof_class: "lifecycle-and-scheduler-fixtures", native_codex: "SKIP", postgres: "SKIP" }));
