#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createWorkflowInstance, assertWorkflowInstance, inspectWorkflowInstance, decideWorkflowInstance,
  prepareWorkflowInstanceSegment, reconcileWorkflowInstanceSegment, assertCurrentWorkflowCompilation } from "../../src/core/workflow/workflow-instance.mjs";
import { createWorkflowInstanceStore, workflowInstanceArtifactPath } from "../../src/adapters/runtime/workflow-instance-store.mjs";
import { createWorkflowInstanceService } from "../../src/application/runtime/workflow-instance-service.mjs";
import { createProjectWorkflowInstanceService } from "../../src/application/runtime/workflow-instance-composition.mjs";
import { createArtifactStore } from "../../src/adapters/runtime/artifact-store.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { bindWorkflowSegment } from "../../src/core/workflow/workflow-segment-binding.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { normalizeAgentExecutionPlan } from "../../src/core/agents/agent-execution-contracts.mjs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { resolveActivationTarget, planAuthorization, applyAuthorization, readActivation } from "../../src/application/install/project-activation-service.mjs";
import { createAgentRunLifecycle } from "../../src/application/runtime/agent-run-lifecycle-service.mjs";

const json = name => JSON.parse(fs.readFileSync(new URL("../../" + name, import.meta.url), "utf8"));
const original = json("tests/fixtures/workflow-shadow/diagnostic-correction.v1.json");
// A supported bounded path; diagnosis remains explicitly unsupported.
const definition = { ...original, workflow_id: "reviewed-correction", entry: "approval",
  steps: original.steps.filter(s => s.id !== "diagnose"), transitions: original.transitions.filter(e => e.from !== "diagnose") };
const context = { contract_version: "workflow-shadow-context.v1", authority: "caller_supplied", product_version: "0.11.0", workflow_version: 7, state_mode: "files" };
const scope = { target_sha256: "a".repeat(64), persistence_sha256: "a".repeat(64), runtime_scope_id: "scope.fixture", activation: { authority_id: "authority.fixture", revision: 2 } };
const evidence = [{ ref: "fixture-review", sha256: "b".repeat(64) }];
const source = json("tests/fixtures/agent-execution/contracts/complete-chain.json").plan;
const initial = (mode = "files", def = definition) => createWorkflowInstance({ instanceId: "fixture", definition: def, context: { ...context, state_mode: mode }, scope });
function segment(instance = initial(), runId = "run.fixture") {
  const configuration = { contract_version: "agent-run-configuration.v2", run_id: runId,
    target_root: os.tmpdir(), workflow: bindWorkflowSegment({ definition: instance.definition, context: instance.compilation.context, stepId: "correction", canonical: source.canonical }) };
  const plan = structuredClone(source); delete plan.plan_sha256;
  plan.supervision = { configuration_sha256: shadowHash(configuration) };
  return { configuration, plan: normalizeAgentExecutionPlan(plan), configurationPath: path.join(os.tmpdir(), "instance-config.json"), planPath: path.join(os.tmpdir(), "instance-plan.json") };
}
const approve = state => decideWorkflowInstance(state, { outcome: "approved", evidence });
const intend = (state, run = "run.fixture") => prepareWorkflowInstanceSegment(state, segment(state, run));
const success = pending => ({ run_id: pending.run_id, plan_sha256: pending.plan_sha256, execution_status: "completed",
  integration: { sha: "c".repeat(40), pending: 0 }, validation: { status: "passed", sha: "c".repeat(40), evidence_sha256: "d".repeat(64) },
  attempts: [{ task_id: "task", acceptance: "accepted", evidence }], cleanup: { status: "not_requested" } });

if (process.argv[2] === "--interrupted-effect") {
  const root = process.argv[3], point = process.argv[4], store = createWorkflowInstanceStore({ targetRoot: root, stateMode: "files" });
  const state = store.read("fixture").instance;
  assert(inspectWorkflowInstance(state).pending);
  if (point === "after-effect") fs.writeFileSync(path.join(root, "effect-proof.json"), JSON.stringify(success(inspectWorkflowInstance(state).pending)));
  process.exit(31);
}

let checks = 0;
async function check(name, run) { await run(); checks++; console.log("PASS " + name); }
const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-workflow-instance-"));
try {
  await check("closed retained instance contract and tamper detection", () => {
    assert.deepEqual(validateJsonSchemaDefinition(json("src/core/contracts/workflow-definition/workflow-instance.v1.schema.json"), "#", { contractKind: "workflow-definition" }), []);
    assertWorkflowInstance(initial());
    for (const changed of [{ ...initial(), extra: true }, { ...initial(), revision: 2 }, { ...initial(), instance_sha256: "0".repeat(64) }]) assert.throws(() => assertWorkflowInstance(changed), /WORKFLOW_INSTANCE_/);
    assert.throws(() => createWorkflowInstance({ instanceId: "../bad", definition, context, scope }), /WORKFLOW_INSTANCE_INVALID/);
    assert.throws(() => workflowInstanceArtifactPath("CON"), /WORKFLOW_INSTANCE_ID_INVALID/);
  });
  await check("human checkpoint, retained evidence, unsupported handler and typed outcome", () => {
    const state = approve(initial()); assert.equal(state.revision, 2); assert.deepEqual(state.events[0].evidence, evidence);
    assert.equal(inspectWorkflowInstance(state).step_id, "correction");
    assert.equal(inspectWorkflowInstance(initial("files", original)).status, "handler_unavailable");
    assert.throws(() => decideWorkflowInstance(initial("files", original), { outcome: "diagnosed", evidence }), /HANDLER_UNAVAILABLE/);
    assert.throws(() => decideWorkflowInstance(initial(), { outcome: "maybe", evidence }), /OUTCOME_INVALID/);
    assert.throws(() => decideWorkflowInstance(initial(), { outcome: "approved", evidence: [] }), /INSTANCE_INVALID/);
  });
  await check("multi-transition traversal and bounded return require a distinct run per visit", () => {
    let state = initial();
    state = approve(state);
    for (let visit = 0; visit < 3; visit++) {
      state = intend(state, "run." + visit);
      const pending = inspectWorkflowInstance(state).pending;
      state = reconcileWorkflowInstanceSegment(state, success(pending));
      assert.equal(inspectWorkflowInstance(state).step_id, "review");
      state = decideWorkflowInstance(state, { outcome: "rejected", evidence });
      if (visit < 2) assert.throws(() => intend(state, "run." + visit), /RUN_REUSED/);
    }
    assert.equal(inspectWorkflowInstance(state).status, "terminal");
    assert.equal(state.events.filter(e => e.kind === "segment_result").length, 3);
  });
  await check("completed without acceptance or exact integrated validation remains reconciliation", () => {
    const state = intend(approve(initial())), status = success(inspectWorkflowInstance(state).pending);
    for (const changed of [{ ...status, execution_status: "running" }, { ...status, attempts: [] },
      { ...status, attempts: [{ task_id: "task", acceptance: "rejected" }] }, { ...status, validation: { ...status.validation, sha: "e".repeat(40) } }])
      assert.throws(() => reconcileWorkflowInstanceSegment(state, changed), /RECONCILIATION_REQUIRED/);
    assert.throws(() => reconcileWorkflowInstanceSegment(state, { ...status, run_id: "foreign" }), /RESULT_INVALID/);
    assert.equal(inspectWorkflowInstance(reconcileWorkflowInstanceSegment(state, { ...status, execution_status: "failed" })).status, "terminal");
  });
  await check("compiler drift preserves historical inspection but never silently migrates", () => {
    const changed = structuredClone(initial()); changed.compilation.registry.sha256 = "0".repeat(64);
    const { compilation_sha256, ...body } = changed.compilation; changed.compilation.compilation_sha256 = shadowHash(body);
    const { instance_sha256, ...value } = changed; changed.instance_sha256 = shadowHash(value);
    assert.equal(inspectWorkflowInstance(changed).step_id, "approval");
    assert.throws(() => assertCurrentWorkflowCompilation(changed), /COMPILATION_CHANGED/);
  });
  for (const stateMode of ["files", "dual", "db-only"]) await check("canonical checkpoint reconnect and competing writer: " + stateMode, () => {
    const targetRoot = path.join(root, stateMode); fs.mkdirSync(targetRoot);
    fs.mkdirSync(path.join(targetRoot, ".aidn")); fs.writeFileSync(path.join(targetRoot, ".aidn/config.json"), JSON.stringify({ runtime: { stateMode } }));
    const sqliteFile = path.join(targetRoot, ".aidn/runtime/index/workflow-index.sqlite");
    if (stateMode !== "files") { const provision = createArtifactStore({ sqliteFile }); provision.close(); }
    const store = createWorkflowInstanceStore({ targetRoot, stateMode }), state = initial(stateMode);
    const before = fs.readdirSync(targetRoot).sort(); assert.equal(store.read("fixture").instance, null); assert.deepEqual(fs.readdirSync(targetRoot).sort(), before);
    store.compareAndSwap(state, null); const read = store.read("fixture"), next = approve(state);
    store.compareAndSwap(next, read.content_sha256);
    assert.throws(() => store.compareAndSwap(next, read.content_sha256), /REVISION_CONFLICT/);
    assert.equal(createWorkflowInstanceStore({ targetRoot, stateMode }).read("fixture").instance.instance_sha256, next.instance_sha256);
    const visible = path.join(targetRoot, "docs/audit", workflowInstanceArtifactPath("fixture"));
    if (stateMode === "db-only") assert.equal(fs.existsSync(visible), false);
    if (stateMode === "dual") { store.materialize("fixture", { write: true }); fs.writeFileSync(visible, "stale projection"); assert.equal(store.read("fixture").instance.revision, 2); }
    if (stateMode === "files") {
      fs.writeFileSync(visible + ".lock", "abandoned process evidence");
      assert.throws(() => store.compareAndSwap(next, store.read("fixture").content_sha256), /LOCK_RECONCILIATION_REQUIRED/);
      assert.equal(store.read("fixture").instance.revision, 2);
    }
  });
  await check("SQLite compare-and-swap rolls back stale hashes and respects read-only", () => {
    const sqliteFile = path.join(root, "cas.sqlite"), store = createArtifactStore({ sqliteFile });
    const artifact = { path: "workflows/instances/cas.json", content: "first" };
    store.compareAndSwapArtifact({ artifact, expectedSha256: null });
    assert.throws(() => store.compareAndSwapArtifact({ artifact: { ...artifact, content: "second" }, expectedSha256: "0".repeat(64) }), /REVISION_CONFLICT/);
    assert.equal(store.getArtifact(artifact.path).content, "first");
    store.compareAndSwapArtifact({ artifact: { ...artifact, content: "second" }, expectedSha256: artifactContentHash("first") }); store.close();
    const reader = createArtifactStore({ sqliteFile, readOnly: true }); assert.throws(() => reader.compareAndSwapArtifact({ artifact, expectedSha256: null }), /read-only/); reader.close();
    assert.throws(() => createArtifactStore({ sqliteFile: path.join(root, "absent.sqlite"), existingOnly: true }), /ARTIFACT_STORE_MISSING/);
    assert.equal(fs.existsSync(path.join(root, "absent.sqlite")), false);
  });
  await check("projection failure retains the committed checkpoint and never repeats a decision", () => {
    const targetRoot = path.join(root, "projection-failure"); fs.mkdirSync(targetRoot);
    fs.mkdirSync(path.join(targetRoot, ".aidn")); fs.writeFileSync(path.join(targetRoot, ".aidn/config.json"), JSON.stringify({ runtime: { stateMode: "dual" } }));
    const sqliteFile = path.join(targetRoot, ".aidn/runtime/index/workflow-index.sqlite"); createArtifactStore({ sqliteFile }).close();
    fs.writeFileSync(path.join(targetRoot, "docs"), "fixture projection barrier");
    const store = createWorkflowInstanceStore({ targetRoot, stateMode: "dual" });
    const service = createWorkflowInstanceService({ store, readAuthority: () => ({ scope, stateMode: "dual", productVersion: "0.11.0" }) });
    const input = { instanceId: "fixture", definition, context: { ...context, state_mode: "dual" }, write: true };
    const result = service.initialize(input); assert.equal(result.written, true); assert.equal(result.projection, "reconciliation_required");
    assert.equal(service.inspect("fixture").instance.instance_sha256, result.instance.instance_sha256);
    assert.throws(() => service.initialize(input), /ALREADY_EXISTS/);
    fs.unlinkSync(path.join(targetRoot, "docs")); store.materialize("fixture", { write: true });
    assert.equal(service.inspect("fixture").instance.revision, 1);
  });
  for (const point of ["before-effect", "after-effect"]) await check("process interruption " + point + " preserves intent without duplicate dispatch", async () => {
    const targetRoot = path.join(root, point); fs.mkdirSync(targetRoot);
    let state = intend(approve(initial())); const store = createWorkflowInstanceStore({ targetRoot, stateMode: "files" }); store.compareAndSwap(state, null);
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--interrupted-effect", targetRoot, point], { encoding: "utf8", windowsHide: true });
    assert.equal(child.status, 31, child.stderr);
    const reconnect = createWorkflowInstanceStore({ targetRoot, stateMode: "files" }); let dispatch = 0;
    const service = createWorkflowInstanceService({ store: reconnect,
      readAuthority: () => ({ scope, stateMode: "files", productVersion: "0.11.0" }), readSegment: () => segment(),
      lifecycle: { async invoke(args) { assert.equal(args.command, "agent-run-status"); dispatch++;
        return point === "after-effect" ? { errors: [], status: JSON.parse(fs.readFileSync(path.join(targetRoot, "effect-proof.json"))) } : { errors: ["AGENT_RUN_NOT_FOUND"], status: null }; } } });
    assert.equal(service.inspect("fixture").cursor.status, "reconciliation_required"); assert.equal(dispatch, 0);
    if (point === "before-effect") await assert.rejects(service.reconcile({ instanceId: "fixture", expectedSha256: state.instance_sha256, write: true }), /RECONCILIATION_REQUIRED/);
    else { const result = await service.reconcile({ instanceId: "fixture", expectedSha256: state.instance_sha256, write: true }); assert.equal(result.cursor.step_id, "review");
      await assert.rejects(service.reconcile({ instanceId: "fixture", expectedSha256: state.instance_sha256, write: true }), /REVISION_CONFLICT/); }
    assert.equal(dispatch, 1);
  });
  await check("service preview is pure, duplicate decision rejected and activation rechecked", () => {
    const targetRoot = path.join(root, "service"); fs.mkdirSync(targetRoot); const store = createWorkflowInstanceStore({ targetRoot, stateMode: "files" });
    let revoked = false;
    const service = createWorkflowInstanceService({ store, readAuthority: () => ({ scope: revoked ? { ...scope, activation: { ...scope.activation, revision: 3 } } : scope, stateMode: "files", productVersion: "0.11.0" }) });
    const input = { instanceId: "fixture", definition, context };
    assert.equal(service.initialize(input).written, false); assert.deepEqual(fs.readdirSync(targetRoot), []);
    const state = service.initialize({ ...input, write: true }).instance;
    const request = { instanceId: "fixture", expectedSha256: state.instance_sha256, outcome: "approved", evidence, write: true };
    revoked = true; assert.throws(() => service.decide(request), /AUTHORITY_CHANGED/); revoked = false;
    service.decide(request); assert.throws(() => service.decide(request), /REVISION_CONFLICT/);
  });
  await check("durable intent dispatch uses existing lifecycle preview and rejects stale action approval", async () => {
    const targetRoot = path.join(root, "dispatch"); fs.mkdirSync(targetRoot); const store = createWorkflowInstanceStore({ targetRoot, stateMode: "files" });
    const state = intend(approve(initial())), data = segment(); store.compareAndSwap(state, null);
    let runtimes = 0, materialRevision = 1;
    const lifecycle = createAgentRunLifecycle({ readContext: async () => ({ ...data, snapshot: null,
      targetIdentity: { target_root: data.configuration.target_root }, preconditions: { blockers: [], materialRevision } }),
      createRuntime: async () => { runtimes++; throw Object.assign(new Error("FIXTURE_RUNTIME_BOUNDARY"), { code: "FIXTURE_RUNTIME_BOUNDARY" }); } });
    const service = createWorkflowInstanceService({ store, readAuthority: () => ({ scope, stateMode: "files", productVersion: "0.11.0" }), readSegment: () => data, lifecycle });
    const request = { instanceId: "fixture", expectedSha256: state.instance_sha256, command: "agent-run" };
    const preview = await service.segment(request); assert.equal(preview.can_apply, true); assert.equal(runtimes, 0);
    await assert.rejects(service.segment({ ...request, execute: true }), /EXPLICIT_EFFECT_REQUIRED/);
    materialRevision++;
    const stale = await service.segment({ ...request, execute: true, syncRelay: true, expectPlan: preview.action_sha256 });
    assert.deepEqual(stale.errors, ["AGENT_RUN_PREVIEW_CHANGED"]); assert.equal(runtimes, 0);
    const current = await service.segment(request);
    const applied = await service.segment({ ...request, execute: true, syncRelay: true, expectPlan: current.action_sha256 });
    assert.deepEqual(applied.errors, ["FIXTURE_RUNTIME_BOUNDARY"]); assert.equal(runtimes, 1);
    assert.equal(store.read("fixture").instance.instance_sha256, state.instance_sha256);
  });
  await check("real composition refuses an uninstalled source-style directory without mutation", () => {
    const targetRoot = path.join(root, "uninstalled"); fs.mkdirSync(targetRoot);
    const service = createProjectWorkflowInstanceService({ targetRoot });
    assert.throws(() => service.initialize({ instanceId: "fixture", definition, context, write: true }), /ACTIVATION_REQUIRED/);
    assert.deepEqual(fs.readdirSync(targetRoot), []);
  });
  await check("real composition persists human checkpoints in an activated disposable client fixture", () => {
    const productVersion = fs.readFileSync(new URL("../../VERSION", import.meta.url), "utf8").trim();
    const currentDefinition = structuredClone(definition); currentDefinition.compatibility.product_version = productVersion;
    const currentContext = { ...context, product_version: productVersion };
    const targetRoot = path.join(root, "activated"), packageRoot = path.join(root, "neutral-package");
    const put = (base, name, text) => { const file = path.join(base, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
    fs.mkdirSync(targetRoot); put(packageRoot, "VERSION", productVersion + "\n"); put(packageRoot, "bin/aidn.mjs", "// neutral fixture, never executed\n");
    applyAuthorization(planAuthorization({ targetRoot, action: "authorize" }));
    const identity = resolveActivationTarget({ targetRoot }), assets = {};
    for (const name of [".codex/hooks/aidn-hook-runtime.mjs", ".codex/hooks/aidn-session-start.mjs", ".codex/hooks/aidn-pre-tool-use.mjs", ".agents/skills/context-reload/SKILL.md", ".agents/skills/start-session/SKILL.md"]) {
      const text = "Neutral fixture\n"; put(targetRoot, name, text); assets[name] = { kind: "file", current: Buffer.from(text).toString("base64") };
    }
    const block = "<!-- CODEX-AUDIT-WORKFLOW START -->\nNeutral fixture\n<!-- CODEX-AUDIT-WORKFLOW END -->";
    put(targetRoot, "AGENTS.md", block); assets["AGENTS.md"] = { kind: "agents-block", current: block };
    const hooks = ["SessionStart", "PreToolUse"].map(event => ({ event, group: { matcher: "fixture" }, hook: { type: "command", command: "echo fixture" } }));
    put(targetRoot, ".codex/hooks.json", JSON.stringify({ hooks: Object.fromEntries(hooks.map(h => [h.event, [{ ...h.group, hooks: [h.hook] }]])) }));
    assets[".codex/hooks.json"] = { kind: "hooks", current: hooks };
    const receipt = { schema_version: 1, scope: "codex-integration", root_id: identity.root_id,
      package: { root: packageRoot, version: productVersion, entry: "bin/aidn.mjs", entry_sha256: artifactContentHash(fs.readFileSync(path.join(packageRoot, "bin/aidn.mjs"), "utf8")), version_sha256: artifactContentHash(productVersion + "\n") },
      assets, last_transaction: "a".repeat(32), last_action: "install", activation: { mode: identity.scope, authority_id: identity.authority_id } };
    const tx = { schema_version: 1, id: receipt.last_transaction, scope: "codex-integration", root_id: identity.root_id, status: "complete", operations: [], receipt_after: receipt };
    const seal = value => JSON.stringify({ ...value, integrity_sha256: shadowHash(value) });
    put(targetRoot, `.aidn/install/transactions/${tx.id}.json`, seal(tx)); put(targetRoot, ".aidn/install/receipt.json", seal(receipt));
    assert.equal(readActivation({ targetRoot }).state, "active");
    const service = createProjectWorkflowInstanceService({ targetRoot });
    const state = service.initialize({ instanceId: "fixture", definition: currentDefinition, context: currentContext, write: true }).instance;
    assert.equal(createProjectWorkflowInstanceService({ targetRoot }).inspect("fixture").instance.instance_sha256, state.instance_sha256);
    const human = service.initialize({ instanceId: "human", definition: currentDefinition, context: currentContext, write: true }).instance;
    const decided = service.decide({ instanceId: "human", expectedSha256: human.instance_sha256, outcome: "rejected", evidence, write: true });
    assert.equal(decided.cursor.status, "terminal"); assert.equal(decided.instance.revision, 2);
    applyAuthorization(planAuthorization({ targetRoot, action: "revoke" }));
    assert.throws(() => service.decide({ instanceId: "fixture", expectedSha256: state.instance_sha256, outcome: "rejected", evidence, write: true }), /ACTIVATION_REQUIRED/);
    assert.equal(service.inspect("fixture").instance.revision, 1);
  });
  console.log(JSON.stringify({ ok: true, checks, proof_class: "durable-fixtures", native_codex: "SKIP", postgres: "SKIP" }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
