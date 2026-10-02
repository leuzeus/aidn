#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { activateWorkflowConsoleFixture } from "./workflow-console-fixture-lib.mjs";
import { createArtifactStore } from "../../src/adapters/runtime/artifact-store.mjs";
import { createWorkflowInstanceStore } from "../../src/adapters/runtime/workflow-instance-store.mjs";
import { createWorkflowInstanceService } from "../../src/application/runtime/workflow-instance-service.mjs";
import { createProjectWorkflowConsole } from "../../src/application/runtime/workflow-console-composition.mjs";
import { createWorkflowConsoleService, validateWorkflowConsoleRequest } from "../../src/application/runtime/workflow-console-service.mjs";
import { runWorkflowConsoleCli, parseWorkflowConsoleArguments } from "../runtime/workflow-console-cli.mjs";
import { startWorkflowDashboard } from "../../src/adapters/workflow-console/dashboard-server.mjs";
import { planAuthorization, applyAuthorization } from "../../src/application/install/project-activation-service.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { validateJsonSchema, validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { resolveCliEffectClass } from "../../src/core/cli/effect-policy.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-workflow-console-")), repo = fileURLToPath(new URL("../../", import.meta.url));
const original = JSON.parse(fs.readFileSync(path.join(repo, "tests/fixtures/workflow-shadow/diagnostic-correction.v1.json")));
const definition = { ...original, workflow_id: "reviewed-correction", entry: "approval", steps: original.steps.filter(s => s.id !== "diagnose"), transitions: original.transitions.filter(e => e.from !== "diagnose") };
const context = { contract_version: "workflow-shadow-context.v1", authority: "caller_supplied", product_version: "0.11.0", workflow_version: 7, state_mode: "files" };
const evidence = [{ ref: "fixture-human-review", sha256: "b".repeat(64) }];
const schemas = Object.fromEntries(["inspect", "action", "dashboard"].map(name => [name, JSON.parse(fs.readFileSync(path.join(repo, `src/core/contracts/cli-output/runtime-workflow-${name}.v1.schema.json`)))]));
function contracted(name, output) { assert.deepEqual(validateJsonSchema(output, schemas[name]), []); return output; }
function snapshot(folder) {
  const rows = [];
  const visit = (dir, prefix = "") => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const name = prefix + entry.name, file = path.join(dir, entry.name); if (entry.isDirectory()) visit(file, name + "/"); else rows.push([name, fs.readFileSync(file).toString("base64")]); } };
  visit(folder); return shadowHash(rows);
}
const put = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
let checks = 0;
async function check(name, action) { await action(); checks++; console.log("PASS " + name); }
try {
  await check("public contracts validate and help/JSON cannot start a dashboard", async () => {
    for (const schema of Object.values(schemas)) assert.deepEqual(validateJsonSchemaDefinition(schema), []);
    let started = false;
    for (const args of [["--json"], ["--serve", "--help", "--json"]]) {
      const output = contracted("dashboard", await runWorkflowConsoleCli("workflow-dashboard", args, { startDashboard: () => { started = true; } }));
      assert.equal(output.listening, false);
    }
    assert.equal(started, false);
    for (const args of [["--write"], ["--execute"], ["--serve"], ["--target", "a", "--target", "b"], ["--unknown"]]) assert.throws(() => parseWorkflowConsoleArguments("workflow-inspect", args), /WORKFLOW_CONSOLE_/);
    assert.throws(() => parseWorkflowConsoleArguments("workflow-dashboard", ["--serve", "--dry-run"]), /EFFECT_CONFLICT/);
    for (const [name, args] of [["inspect", ["--unknown"]], ["inspect", ["--write"]], ["action", ["--write", "--unknown"]],
      ["action", ["--execute", "--unknown"]], ["action", ["--write", "--dry-run"]], ["dashboard", ["--serve", "--unknown"]],
      ["dashboard", ["--serve", "--dry-run"]], ["action", ["--execute", "--help"]]]) {
      const output = contracted(name, await runWorkflowConsoleCli("workflow-" + name, args));
      assert.equal(output.effect_class, resolveCliEffectClass("aidn runtime workflow-" + name, args)); assert.equal(output.written, false);
    }
  });
  await check("source-style inspection is pure and reports missing activation without installation", async () => {
    const target = path.join(root, "source"); fs.mkdirSync(target); const before = snapshot(target);
    const result = spawnSync(process.execPath, [path.join(repo, "bin/aidn.mjs"), "runtime", "workflow-inspect", "--target", target, "--json"], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr); const value = contracted("inspect", JSON.parse(result.stdout));
    assert.equal(value.view.instances.length, 0); assert(value.view.admission.blockers.includes("WORKFLOW_INSTANCE_ACTIVATION_REQUIRED"));
    assert.equal(snapshot(target), before);
  });
  await check("generated input cannot select a target, effect, module or unknown operation", () => {
    for (const request of [{ operation: "shell", input: {} }, { operation: "decide", input: { write: true } }, { operation: "run", input: { command: "agent-run", target: "/other" } }, { operation: "decide", input: {}, execute: true }]) assert.throws(() => validateWorkflowConsoleRequest(request), /REQUEST_INVALID/);
    let invoked = false; const request = { operation: "decide", input: {} }; Object.defineProperty(request, "extra", { enumerable: true, get() { invoked = true; } });
    assert.throws(() => validateWorkflowConsoleRequest(request)); assert.equal(invoked, false);
  });
  await check("an in-flight browser preview cannot restore an invalidated approval", async () => {
    const elements = new Map(), get = id => {
      if (!elements.has(id)) elements.set(id, { value: "", checked: false, disabled: false, listeners: {}, addEventListener(name, handler) { this.listeners[name] = handler; } });
      return elements.get(id);
    };
    let respond; const requests = [];
    vm.runInNewContext(fs.readFileSync(path.join(repo, "src/adapters/workflow-console/dashboard.js"), "utf8"), {
      document: { getElementById: get }, fetch: (_url, options) => { requests.push(JSON.parse(options.body)); return new Promise(resolve => { respond = value => resolve({ ok: true, json: async () => value }); }); },
    });
    const request = { operation: "decide", input: { instanceId: "sample", outcome: "rejected" } };
    get("request").value = JSON.stringify(request); get("token").value = "fixture";
    for (const changed of ["request", "token", "instance"]) {
      const pendingPreview = get("preview").onclick(); get(changed).listeners.input();
      // Even an edit reverted to its original value invalidates the pending result.
      respond({ can_apply: true, action_sha256: "a".repeat(64) }); await pendingPreview;
      get("approve").checked = true; get("approve").onchange(); assert.equal(get("apply").disabled, true);
      const before = requests.length; await get("apply").onclick(); assert.equal(requests.length, before);
    }
    const preview = get("preview").onclick(); get("approve").checked = true;
    respond({ can_apply: true, action_sha256: "b".repeat(64) }); await preview;
    assert.equal(get("approve").checked, false); get("approve").checked = true; get("approve").onchange(); assert.equal(get("apply").disabled, false);
    const application = get("apply").onclick(); assert.deepEqual(requests.at(-1).request, request); assert.equal(requests.at(-1).expectPlan, "b".repeat(64));
    respond({ written: true }); await application; assert.equal(get("apply").disabled, true);
  });
  for (const mode of ["files", "dual", "db-only"]) await check("CLI and dashboard share observations, exact preview and guarded actions: " + mode, async () => {
    const target = path.join(root, mode); activateWorkflowConsoleFixture(target, path.join(root, "package"));
    put(path.join(target, ".aidn/config.json"), { runtime: { stateMode: mode } });
    if (mode !== "files") createArtifactStore({ sqliteFile: path.join(target, ".aidn/runtime/index/workflow-index.sqlite") }).close();
    const requestFile = path.join(root, mode + "-request.json"), request = { operation: "initialize", input: { instanceId: "sample", definition, context: { ...context, state_mode: mode } } };
    put(requestFile, request);
    const server = await startWorkflowDashboard({ targetRoot: target });
    const api = async (route, body, headers = {}) => fetch(server.url + "/api/" + route, { method: "POST", headers: { Origin: server.url, "Content-Type": "application/json", Authorization: "Bearer " + server.token, ...headers }, body: JSON.stringify(body) });
    try {
      const before = snapshot(target), cli = async (command, extra = []) => runWorkflowConsoleCli(command, ["--target", target, "--json", ...extra]);
      const preview = contracted("action", await cli("workflow-action", ["--request", requestFile])); assert.deepEqual(preview.errors, []); assert.equal(preview.can_apply, true);
      assert.deepEqual(await (await api("action", { request })).json(), preview); assert.equal(snapshot(target), before);
      assert.equal((await api("inspect", {}, { Authorization: "" })).status, 403);
      assert.equal((await api("inspect", {}, { Origin: "https://foreign.invalid" })).status, 403);
      const foreignHostStatus = await new Promise((resolve, reject) => {
        const req = http.request(server.url + "/api/inspect", { method: "POST", headers: { Host: "foreign.invalid", Origin: server.url } }, res => { res.resume(); resolve(res.statusCode); });
        req.on("error", reject); req.end("{}");
      });
      assert.equal(foreignHostStatus, 403);
      assert.equal((await api("inspect", { target: "/other" })).status, 400);
      const malformed = await (await api("action", { request, write: true, expectPlan: "0".repeat(64) })).json(); assert(malformed.errors.includes("WORKFLOW_CONSOLE_PREVIEW_CHANGED")); assert.equal(snapshot(target), before);
      const applied = contracted("action", await (await api("action", { request, write: true, expectPlan: preview.action_sha256 })).json()); assert.deepEqual(applied.errors, []); assert.equal(applied.written, true);
      const retained = snapshot(target), state = applied.result.instance;
      const inspect = contracted("inspect", await cli("workflow-inspect")); assert.deepEqual(await (await api("inspect", {})).json(), inspect); assert.equal(snapshot(target), retained);
      assert.equal(inspect.view.instances[0].instance_sha256, state.instance_sha256);
      const repeated = await cli("workflow-action", ["--request", requestFile, "--write", "--expect-plan", preview.action_sha256]); assert(repeated.errors.length); assert.equal(snapshot(target), retained);
      const decision = { operation: "decide", input: { instanceId: "sample", expectedSha256: state.instance_sha256, outcome: "rejected", evidence } }; put(requestFile, decision);
      const decisionPreview = await cli("workflow-action", ["--request", requestFile]); const decided = await cli("workflow-action", ["--request", requestFile, "--write", "--expect-plan", decisionPreview.action_sha256]);
      assert.equal(decided.result.cursor.status, "terminal"); assert.equal(decided.result.cursor.terminal_result, "stopped");
      if (mode !== "files") put(path.join(target, "docs/audit/workflows/instances/sample.json"), state);
      const observation = await (await api("inspect", {})).json(); assert.equal(observation.view.instances[0].revision, 2);
      const candidateDefinition = structuredClone(definition); candidateDefinition.revision++; candidateDefinition.transitions.find(edge => edge.max_traversals).max_traversals = 1;
      const suggestion = { operation: "propose", input: { baseInstanceId: "sample", definition: candidateDefinition, explanation: "Bounded fixture proposal." } };
      const candidate = await (await api("action", { request: suggestion })).json(); assert.equal(candidate.can_apply, false); assert.equal(candidate.action.preview.activation_eligible, true);
      const reviewed = { operation: "activate", input: { ...suggestion.input, expectedPreviewSha256: candidate.action.preview.preview_sha256, review: { decision: "approve", preview_sha256: candidate.action.preview.preview_sha256, evidence } } };
      const selectedPreview = await (await api("action", { request: reviewed })).json(); assert.equal(selectedPreview.can_apply, true);
      const selected = await (await api("action", { request: reviewed, write: true, expectPlan: selectedPreview.action_sha256 })).json(); assert.equal(selected.written, true);
      const selectedView = await cli("workflow-inspect"); assert.equal(selectedView.view.selections[0].definitions.length, 2); assert.deepEqual(await (await api("inspect", {})).json(), selectedView);
      // Revocation remains visible and cannot turn a reviewed action into consent.
      const next = { operation: "initialize", input: { ...request.input, instanceId: "revoked" } }; const ready = await (await api("action", { request: next })).json();
      applyAuthorization(planAuthorization({ targetRoot: target, action: "revoke" })); const revokedSnapshot = snapshot(target);
      const refused = await (await api("action", { request: next, write: true, expectPlan: ready.action_sha256 })).json(); assert(refused.errors.includes("WORKFLOW_INSTANCE_ACTIVATION_REQUIRED")); assert.equal(snapshot(target), revokedSnapshot);
      assert((await (await api("inspect", {})).json()).view.admission.blockers.includes("WORKFLOW_INSTANCE_ACTIVATION_REQUIRED"));
    } finally { server.close(); }
  });
  await check("checkpoint changes after preview refuse before a canonical write", () => {
    let revision = 1, writes = 0;
    const scope = () => ({ target_sha256: "a".repeat(64), persistence_sha256: "b".repeat(64), runtime_scope_id: "fixture", activation: { authority_id: "fixture", revision } });
    const service = createWorkflowInstanceService({ store: { read: () => ({ instance: null, content_sha256: null }), compareAndSwap() { writes++; } }, readAuthority: () => ({ scope: scope(), stateMode: "files", productVersion: "0.11.0" }) });
    const input = { instanceId: "guarded", definition, context }, preview = service.initialize(input); revision++;
    assert.throws(() => service.initialize({ ...input, write: true, expectedResultSha256: preview.instance.instance_sha256 }), /PREVIEW_CHANGED/); assert.equal(writes, 0);
  });
  await check("completed execution is displayed independently from acceptance, integration and cleanup", async () => {
    const status = { execution_status: "completed", attempts: [{ acceptance: "rejected" }], integration: { pending: 1 }, validation: { status: "failed" }, cleanup: { status: "not_requested" } };
    let calls = 0;
    const service = createWorkflowConsoleService({ readRecords: () => ({ instances: [], selections: [], truncated: true }), readAuthority: () => ({}), readRun: () => { calls++; return { status }; } });
    const first = await service.inspect(); assert.equal(calls, 0); assert(first.view.limits.includes("CATALOG_TRUNCATED_USE_EXACT_SELECTORS"));
    const read = await service.inspect({ configuration: "fixture", run: "fixture" }); assert.deepEqual(read.view.live_run.status, status); assert.equal(calls, 1);
  });
  await check("run actions preserve the supervisor preview hash and explicit shared sync", async () => {
    let applied = 0;
    const service = createWorkflowConsoleService({ targetIdentity: "a".repeat(64), invokeRun: (_input, flags) => {
      if (flags.apply) { assert.equal(flags.expectPlan, "b".repeat(64)); applied++; return { written: true, shared_coordination_sync: true, errors: [] }; }
      return { action_sha256: "b".repeat(64), can_apply: true, written: false, errors: [] };
    } });
    const request = { operation: "run", input: { command: "agent-run-resume", configuration: "fixture", run: "fixture" } }, preview = await service.action(request);
    assert((await service.action(request, { execute: true, expectPlan: preview.action_sha256 })).errors.length); assert.equal(applied, 0);
    const result = await service.action(request, { execute: true, expectPlan: preview.action_sha256, syncRelay: true }); assert.equal(result.written, true); assert.equal(applied, 1);
  });
  await check("long-lived composition follows current mode and does not adopt stale file projections", async () => {
    const target = path.join(root, "mode-switch"); fs.mkdirSync(target); const service = createProjectWorkflowConsole({ targetRoot: target });
    assert.equal((await service.inspect()).view.instances.length, 0);
    put(path.join(target, ".aidn/config.json"), { runtime: { stateMode: "db-only" } }); const before = snapshot(target);
    const result = await service.inspect(); assert.equal(result.view, null); assert(result.errors.includes("WORKFLOW_CONSOLE_CANONICAL_STORE_UNAVAILABLE")); assert.equal(snapshot(target), before);
  });
  await check("configured unavailable PostgreSQL refuses without local projection fallback", async () => {
    const target = path.join(root, "unavailable"); fs.mkdirSync(target);
    put(path.join(target, ".aidn/config.json"), { runtime: { stateMode: "files", persistence: { backend: "postgres", connectionRef: "env:AIDN_CONSOLE_MISSING_CONNECTION_FIXTURE" } } });
    put(path.join(target, "docs/audit/workflows/instances/stale.json"), { instance_id: "stale" });
    const before = snapshot(target), output = await createProjectWorkflowConsole({ targetRoot: target }).inspect();
    assert.equal(output.view, null); assert(output.errors.length); assert.equal(snapshot(target), before);
  });
  console.log(JSON.stringify({ ok: true, checks, proof_class: "cli-http-and-canonical-fixtures", native_codex: "SKIP", postgres: "SKIP" }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
