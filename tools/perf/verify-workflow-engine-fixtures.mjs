#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { activateWorkflowConsoleFixture } from "./workflow-console-fixture-lib.mjs";
import { createProjectWorkflowInstanceService, createLegacyProjectWorkflowInstanceService } from "../../src/application/runtime/workflow-instance-composition.mjs";
import { createArtifactStore } from "../../src/adapters/runtime/artifact-store.mjs";
import { createProjectWorkflowCandidateService } from "../../src/application/runtime/workflow-candidate-composition.mjs";
import { createProjectWorkflowConsole } from "../../src/application/runtime/workflow-console-composition.mjs";
import { runProjectWorkflow } from "../../src/application/runtime/workflow-run-service.mjs";
import { runWorkflowRunCli } from "../runtime/workflow-run.mjs";
import { resolveWorkflowEngine } from "../../src/core/workflow/workflow-engine-policy.mjs";
import { createAgenticProcess, advanceAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { agenticPolicyPins } from "../../src/core/workflow/agentic-process-model.mjs";
import { assertAgenticProcessStart } from "../../src/core/workflow/agentic-process-start.mjs";
import { validateAidnProjectConfig } from "../../src/lib/config/aidn-config-lib.mjs";
import { validateJsonSchema } from "../../src/core/contracts/json-schema-validator.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-workflow-engine-"));
const model = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agentic-process/compatible-work-and-review.json", import.meta.url)));
const schema = JSON.parse(fs.readFileSync(new URL("../../src/core/contracts/cli-output/runtime-workflow-run.v1.schema.json", import.meta.url)));
let count = 0;
async function check(name, action) { await action(); count++; console.log("PASS " + name); }
function fixture() { const targetRoot = path.join(root, "project-" + count); activateWorkflowConsoleFixture(targetRoot, path.join(root, "package")); return targetRoot; }
const put = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
function snapshot(folder) {
  return JSON.stringify(fs.readdirSync(folder, { recursive: true }).sort().map(name => {
    const file = path.join(folder, name); return [name, fs.statSync(file).isDirectory() ? null : fs.readFileSync(file).toString("base64")];
  }));
}
try {
  for (const mode of ["files", "dual", "db-only"]) await check("new JSON workflow defaults to agentic without XML/profile opt-in: " + mode, async () => {
    const targetRoot = fixture(), service = createProjectWorkflowInstanceService({ targetRoot });
    put(path.join(targetRoot, ".aidn/config.json"), { runtime: { stateMode: mode } });
    if (mode !== "files") createArtifactStore({ sqliteFile: path.join(targetRoot, ".aidn/runtime/index/workflow-index.sqlite") }).close();
    assert.equal(resolveWorkflowEngine(), "agentic");
    const preview = service.initialize({ instanceId: "direct-json", model });
    assert.equal(preview.written, false); assert.equal(preview.record.contract_version, "agentic-process-instance.v1");
    const state = service.initialize({ instanceId: "direct-json", model, write: true, expectedResultSha256: preview.record.instance_sha256 });
    assert.equal(service.inspect("direct-json").record.instance_sha256, state.record.instance_sha256);
    const view = await createProjectWorkflowConsole({ targetRoot }).inspect();
    assert.deepEqual(view.errors, []); assert.equal(view.view.default_engine, "agentic"); assert.equal(view.view.instances[0].engine, "agentic");
    assert.equal((await createProjectWorkflowConsole({ targetRoot }).inspect({ instanceId: "direct-json" })).view.instances[0].model.model_id, model.model_id);
    assert.throws(() => service.initialize({ instanceId: "implicit-old", definition: {} }), /WORKFLOW_AGENTIC_MODEL_REQUIRED/);
    assert.throws(() => createProjectWorkflowCandidateService({ targetRoot }).initializeSelected({ workflowId: "implicit-old", instanceId: "new" }), /WORKFLOW_LEGACY_ENGINE_SELECTION_REQUIRED/);
  });
  await check("console defaults to agentic and requires an exact preview before writing a JSON model", async () => {
    const targetRoot = fixture(), service = createProjectWorkflowConsole({ targetRoot });
    const request = { operation: "initialize", input: { instanceId: "console-json", model } };
    const preview = await service.action(request);
    assert.deepEqual(preview.errors, []); assert.equal(preview.can_apply, true);
    const denied = await service.action(request, { write: true, expectPlan: "a".repeat(64) });
    assert.deepEqual(denied.errors, ["WORKFLOW_CONSOLE_PREVIEW_CHANGED"]);
    assert.equal((await service.inspect()).view.instances.length, 0);
    const result = await service.action(request, { write: true, expectPlan: preview.action_sha256 });
    assert.deepEqual(result.errors, []); assert.equal(result.written, true);
  });
  await check("sequential creation is explicit while historical reads survive a default engine change", async () => {
    const targetRoot = fixture(), service = createProjectWorkflowInstanceService({ targetRoot });
    const definition = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/workflow-shadow/diagnostic-correction.v1.json", import.meta.url)));
    const version = fs.readFileSync(new URL("../../VERSION", import.meta.url), "utf8").trim();
    definition.compatibility.product_version = version;
    const context = { contract_version: "workflow-shadow-context.v1", authority: "caller_supplied", product_version: version, workflow_version: 7, state_mode: "files" };
    const old = service.initialize({ engine: "legacy", instanceId: "historical", definition, context, write: true });
    assert.throws(() => service.initialize({ instanceId: "historical", model, write: true }), /WORKFLOW_INSTANCE_ENGINE_CONFLICT/);
    assert.equal(service.inspect("historical").instance.instance_sha256, old.instance.instance_sha256);
    const view = await createProjectWorkflowConsole({ targetRoot }).inspect({ instanceId: "historical" });
    assert.deepEqual(view.errors, []); assert.equal(view.view.instances[0].engine, "legacy");
    put(path.join(targetRoot, ".aidn/config.json"), { runtime: { workflowEngine: "legacy" } });
    assert.equal((await runProjectWorkflow({ targetRoot })).engine, "legacy");
    assert.equal((await runProjectWorkflow({ targetRoot, engine: "agentic" })).engine, "agentic");
    assert.throws(() => validateAidnProjectConfig({ runtime: { workflowEngine: "unknown" } }), /workflowEngine/);
  });
  await check("ambiguous historical IDs require an engine selector instead of implicit conversion", () => {
    const targetRoot = fixture(), service = createProjectWorkflowInstanceService({ targetRoot });
    const definition = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/workflow-shadow/diagnostic-correction.v1.json", import.meta.url)));
    const version = fs.readFileSync(new URL("../../VERSION", import.meta.url), "utf8").trim(); definition.compatibility.product_version = version;
    service.initialize({ instanceId: "same", model, write: true });
    createLegacyProjectWorkflowInstanceService({ targetRoot }).initialize({ instanceId: "same", definition, context: { contract_version: "workflow-shadow-context.v1", authority: "caller_supplied", product_version: version, workflow_version: 7, state_mode: "files" }, write: true });
    assert.throws(() => service.inspect("same"), /WORKFLOW_ENGINE_AMBIGUOUS/);
    assert.equal(service.inspect("same", { engine: "agentic" }).record.model.model_id, model.model_id);
    assert.equal(service.inspect("same", { engine: "legacy" }).instance.instance_id, "same");
  });
  await check("ordinary CLI selects agentic and returns its public JSON contract without native allocation", async () => {
    const targetRoot = fixture(), before = snapshot(targetRoot);
    const result = spawnSync(process.execPath, ["bin/aidn.mjs", "runtime", "workflow-run", "--target", targetRoot, "--json"], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const output = JSON.parse(result.stdout); assert.deepEqual(validateJsonSchema(output, schema), []);
    assert.equal(snapshot(targetRoot), before);
    assert.equal(output.engine, "agentic"); assert.equal(output.written, false); assert.equal(output.dry_run, true);
    assert(output.requirements.includes("WORKFLOW_CONFIGURATION_REQUIRED"));
    let called = false;
    const denied = await runWorkflowRunCli(["--execute", "--dry-run"], { run() { called = true; } });
    assert.deepEqual(denied.errors, ["WORKFLOW_RUN_EFFECT_CONFLICT"]); assert.equal(called, false);
  });
  await check("execution delegates to the owned engine only after matching preview and explicit authorization", async () => {
    const targetRoot = fixture(), configuration = path.join(root, "execution.json"), authorization = path.join(root, "authorization.json");
    put(configuration, { target_root: targetRoot }); put(authorization, { approved: true });
    let starts = 0;
    const dependencies = { async runOwned(input) {
      if (!input.execute) return { scope_id: "fixture", native_started: false, written: false };
      starts++; assert.equal(input.authorization.approved, true);
      return { status: "COMPLETED", worker_result: { bytes_retained: 1 } };
    } };
    const preview = await runProjectWorkflow({ targetRoot, configuration }, dependencies);
    assert.deepEqual(preview.errors, []); assert.equal(starts, 0); assert.equal(preview.can_apply, false);
    const refused = await runProjectWorkflow({ targetRoot, configuration, execute: true, expectPlan: preview.action_sha256 }, dependencies);
    assert.deepEqual(refused.errors, ["WORKFLOW_RUN_AUTHORIZATION_REQUIRED"]); assert.equal(starts, 0);
    const consented = await runProjectWorkflow({ targetRoot, configuration, authorization }, dependencies);
    const stale = await runProjectWorkflow({ targetRoot, configuration, authorization, execute: true, expectPlan: "a".repeat(64) }, dependencies);
    assert.deepEqual(stale.errors, ["WORKFLOW_RUN_PREVIEW_CHANGED"]); assert.equal(starts, 0);
    const applied = await runProjectWorkflow({ targetRoot, configuration, authorization, execute: true, expectPlan: consented.action_sha256 }, dependencies);
    assert.deepEqual(applied.errors, []); assert.equal(starts, 1); assert.equal(applied.shared_coordination_sync, false);
    put(authorization, { approved: true, max_responses: 100 });
    const changed = await runProjectWorkflow({ targetRoot, configuration, authorization, execute: true, expectPlan: consented.action_sha256 }, dependencies);
    assert.deepEqual(changed.errors, ["WORKFLOW_RUN_PREVIEW_CHANGED"]); assert.equal(starts, 1);
  });
  await check("console-created pristine state can enter the host; any history or changed facts require reconciliation", () => {
    const creation = { instanceId: "start", model, facts: {}, scopeId: "fixture", policyPins: agenticPolicyPins(model) };
    const record = createAgenticProcess(creation);
    assertAgenticProcessStart(record, creation);
    assert.throws(() => assertAgenticProcessStart(record, { ...creation, facts: { changed: true } }), /RECONCILIATION/);
    const changed = advanceAgenticProcess(record, { kind: "facts", event_id: "observed", facts: { changed: true } });
    assert.throws(() => assertAgenticProcessStart(changed, creation), /RECONCILIATION/);
  });
  await check("legacy execution is selected explicitly and never used as a fallback from the default engine", async () => {
    const targetRoot = fixture(), configuration = path.join(root, "legacy.json"), plan = path.join(root, "legacy-plan.json");
    put(configuration, { target_root: targetRoot }); let legacyCalls = 0;
    const dependencies = {
      runOwned() { throw new Error("PROCESS_EXECUTION_CONFIGURATION_INVALID"); },
      lifecycle: () => ({ async invoke(args) {
        legacyCalls++; assert.equal(args.command, "agent-run");
        return { action_sha256: "a".repeat(64), can_apply: true, dry_run: true, written: false, errors: [] };
      } }),
    };
    const refused = await runProjectWorkflow({ targetRoot, configuration }, dependencies);
    assert.deepEqual(refused.errors, ["PROCESS_EXECUTION_CONFIGURATION_INVALID"]); assert.equal(legacyCalls, 0);
    const explicit = await runProjectWorkflow({ targetRoot, engine: "legacy", configuration, plan }, dependencies);
    assert.deepEqual(explicit.errors, []); assert.equal(explicit.engine, "legacy"); assert.equal(legacyCalls, 1);
  });
  console.log(JSON.stringify({ status: "PASS", checks: count, native_calls: 0 }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
