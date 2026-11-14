#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadStandardWorkflowStartupAssets } from "../../src/application/runtime/standard-workflow-startup-composition.mjs";
import { standardWorkflowOperationBindings, assertStandardWorkflowImplementation } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { verifyStandardWorkflowStartupAssets, refreshStandardWorkflowStartupBindings, assertStandardWorkflowModelSource } from "../../src/core/workflow/standard-workflow-model-catalog.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { agenticProcessImplementationPins } from "../../src/application/runtime/agentic-process-implementation-pins.mjs";

const root = new URL("../../", import.meta.url), read = path => fs.readFileSync(new URL(path, root), "utf8");
const assets = loadStandardWorkflowStartupAssets();
function fresh() {
  return { catalog: structuredClone(assets.catalog), model: structuredClone(assets.model), bindings: standardWorkflowOperationBindings(),
    specification: read("docs/SPEC.md"), skills: Object.fromEntries(["context-reload", "start-session"].map(id => {
      const path = `scaffold/codex/aidn-${id}/SKILL.md`; return [path, read(path)]; })) };
}
let checks = 0;
function test(name, run) { run(); checks++; process.stdout.write(`PASS ${name}\n`); }
function reject(name, mutate, code) { test(name, () => { const input = fresh(); mutate(input); assert.throws(() => verifyStandardWorkflowStartupAssets(input), { code }); }); }
for (const relative of ["src/application/install/project-activation-service.mjs", "src/core/gating/fallback-history-policy.mjs", "src/core/contracts/workflow-definition/standard-workflow-catalog.v4.schema.json", "src/core/contracts/workflow-definition/standard-workflow-catalog.v5.schema.json", "src/core/contracts/workflow-definition/standard-cycle-entry-observation-output.v1.schema.json",
  "src/application/runtime/standard-canonical-cycle-resume.mjs", "src/core/workflow/standard-canonical-cycle-resume.mjs", "src/core/workflow/standard-owned-cycle-resume.mjs",
  "src/core/workflow/standard-cycle-source-selection.mjs",
  "src/core/workflow/standard-cycle-prework.mjs",
  ...["subject", "report"].map(kind => `src/core/contracts/workflow-definition/standard-cycle-prework-${kind}.v1.schema.json`),
  "src/core/contracts/workflow-definition/standard-cycle-entry-choice-checkpoint-plan.v2.schema.json",
  "src/core/contracts/workflow-definition/standard-cycle-entry-choice-checkpoint-output.v2.schema.json",
  "src/core/contracts/workflow-definition/standard-cycle-plan-selection-output.v2.schema.json",
  "src/core/contracts/workflow-definition/standard-cycle-execution-source-output.v1.schema.json",
  "src/core/contracts/workflow-definition/standard-workflow-catalog.v6.schema.json",
  ...["standard-canonical-cycle-resume", "standard-canonical-cycle-resume-observe", "standard-owned-cycle-resume"].flatMap(name =>
    ["input", "output"].map(kind => `src/core/contracts/workflow-definition/${name}-${kind}.v1.schema.json`))])
test(relative + " bytes are direct fresh standard and process pins", () => {
  const url = new URL(relative, root);
  const before = agenticProcessImplementationPins(), original = fs.readFileSync;
  assert.ok(before.files.some(row => row.path === relative)); assertStandardWorkflowImplementation();
  fs.readFileSync = function(file, ...args) {
    const bytes = Reflect.apply(original, this, [file, ...args]);
    return String(file) === url.href ? Buffer.concat([bytes, Buffer.from("\n// changed activation fixture bytes\n")]) : bytes;
  };
  try {
    assert.throws(() => assertStandardWorkflowImplementation(), { code: "STANDARD_IMPLEMENTATION_CHANGED" });
    assert.notEqual(agenticProcessImplementationPins().sha256, before.sha256);
  } finally { fs.readFileSync = original; }
  assertStandardWorkflowImplementation(); assert.equal(agenticProcessImplementationPins().sha256, before.sha256);
});
test("published startup JSON is executable through the common IR contract and fixed registry", () => {
  const input = fresh(); assert.deepEqual(verifyStandardWorkflowStartupAssets(input), assets.source);
  assert.equal(assets.model.contract_version, "agentic-process-model.v2"); assert.equal(assets.model.model_id, "aidn-standard-startup");
  assert.equal(assets.catalog.scope.complete_standard_workflow, false); assert.ok(assets.catalog.scope.remaining_activities.includes("full_mixed_resume"));
  assert.ok(assets.catalog.scope.remaining_activities.includes("pr_review_and_merge"));
});
test("source descriptor pins the exact catalog and embedded model without granting execution", () => {
  assert.equal(assets.source.catalog_sha256, shadowHash(assets.catalog)); assert.equal(assets.source.model_sha256, shadowHash(assets.model));
  assertStandardWorkflowModelSource(assets.source, assets.model); assert.ok(Object.isFrozen(assets.model.nodes));
});
reject("a valid but changed startup order cannot retain the catalog hash", x => {
  const order = x.model.nodes[0].children; [order[0], order[1]] = [order[1], order[0]];
}, "STANDARD_STARTUP_MODEL_CHANGED");
reject("published data dependencies reject an order that consumes future results", x => x.model.nodes.find(node => node.id === "session_mode_select").children.reverse(), "PROCESS_INPUT_SOURCE_NOT_ORDERED");
reject("valid changed parameter mappings cannot retain the catalog hash", x => {
  x.model.data_bindings.inputs.find(row => row.node_id === "session_initialize").fields.session_branch.path = ["other_branch"];
}, "STANDARD_STARTUP_MODEL_CHANGED");
reject("catalog cannot turn a startup component into the complete standard workflow", x => { x.catalog.scope.complete_standard_workflow = true; }, "STANDARD_STARTUP_CATALOG_INVALID");
reject("catalog does not select executable modules", x => { x.catalog.module = "untrusted.mjs"; }, "STANDARD_STARTUP_CATALOG_INVALID");
reject("startup catalog rows do not select embedded call targets", x => {
  x.catalog.bindings[0].model_ref = { model_id: "unreviewed", revision: 1, model_sha256: "a".repeat(64) };
}, "STANDARD_STARTUP_CATALOG_INVALID");
reject("authority paths cannot escape the fixed package assets", x => { x.catalog.specification.path = "../SPEC.md"; }, "STANDARD_STARTUP_CATALOG_INVALID");
reject("changed SPEC bytes require a reviewed authority update", x => { x.specification += "\n"; }, "STANDARD_STARTUP_SPECIFICATION_CHANGED");
reject("changed skill bytes require a reviewed authority update", x => { x.skills[x.catalog.bindings[0].skill_source.path] += "\n"; }, "STANDARD_STARTUP_SKILL_CHANGED");
reject("stale code bindings fail instead of being repaired at load time", x => { x.bindings.find(row => row.id === "context_reload").implementation_sha256 = "f".repeat(64); }, "STANDARD_STARTUP_IMPLEMENTATION_CHANGED");
reject("duplicate activity traceability is rejected", x => { x.catalog.bindings[1].node_id = x.catalog.bindings[0].node_id; }, "STANDARD_STARTUP_COVERAGE_INVALID");
reject("traceability cannot point to a structural node instead of its operation", x => { x.catalog.bindings[0].node_id = x.model.entry; }, "STANDARD_STARTUP_BINDING_CHANGED");
reject("a skill source cannot be substituted by another declared skill", x => { x.catalog.bindings[0].skill_source.path = x.catalog.bindings[1].skill_source.path; }, "STANDARD_STARTUP_BINDING_CHANGED");
test("source descriptors reject self-hash substitutions", () => {
  const source = structuredClone(assets.source); source.model_sha256 = "0".repeat(64);
  assert.throws(() => assertStandardWorkflowModelSource(source, assets.model), { code: "STANDARD_MODEL_SOURCE_INVALID" });
});
test("implementation refresh creates an explicit new revision while preserving the authored graph", () => {
  const input = fresh(), original = shadowHash(input.model); input.bindings.find(row => row.id === "context_reload").implementation_sha256 = "f".repeat(64);
  const next = refreshStandardWorkflowStartupBindings(input);
  assert.deepEqual(next.changed, [input.bindings.find(row => row.id === "context_reload").id]); assert.equal(next.model.revision, input.model.revision + 1);
  assert.equal(next.catalog.revision, next.model.revision); assert.deepEqual(next.model.nodes, input.model.nodes);
  assert.equal(shadowHash(input.model), original);
  verifyStandardWorkflowStartupAssets({ ...input, ...next });
});
test("refresh is a no-op when exact bindings already match", () => {
  const input = fresh(), next = refreshStandardWorkflowStartupBindings(input);
  assert.deepEqual(next.changed, []); assert.deepEqual(next.model, input.model); assert.deepEqual(next.catalog, input.catalog);
});
test("refresh cannot silently accept a different effect class", () => {
  const input = fresh(); input.bindings.find(row => row.id === "context_reload").effect_class = "mutating";
  assert.throws(() => refreshStandardWorkflowStartupBindings(input), { code: "STANDARD_STARTUP_BINDING_REVIEW_REQUIRED" });
});
test("refresh cannot silently accept a different contract", () => {
  const input = fresh(); input.bindings.find(row => row.id === "context_reload").input_contract = "different-input.v1";
  assert.throws(() => refreshStandardWorkflowStartupBindings(input), { code: "STANDARD_STARTUP_BINDING_REVIEW_REQUIRED" });
});
test("refresh cannot silently accept a changed SPEC", () => {
  const input = fresh(); input.specification += "\n";
  assert.throws(() => refreshStandardWorkflowStartupBindings(input), { code: "STANDARD_STARTUP_SPECIFICATION_CHANGED" });
});
test("pin refresh CLI is read-only by default and emits one complete JSON result", () => {
  const modelPath = assets.catalog.model.path, catalogPath = "package/catalogs/standard-workflow-startup.v1.json";
  const before = [read(modelPath), read(catalogPath)];
  const result = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL("tools/verify/refresh-standard-startup-bindings.mjs", root))], { encoding: "utf8", cwd: os.tmpdir(), windowsHide: true }));
  assert.equal(result.status, "PASS"); assert.equal(result.written, false); assert.deepEqual([read(modelPath), read(catalogPath)], before);
});
test("the removed internal-age prefix selector refuses before fixture execution", () => {
  assert.throws(() => execFileSync(process.execPath, [fileURLToPath(new URL("tools/perf/verify-standard-workflow-composition-prefix-fixtures.mjs", root)), "--expire-initialize"],
    { encoding: "utf8", windowsHide: true, stdio: "pipe" }), error => error.status === 1 && /STANDARD_PREFIX_ARGUMENT_INVALID/.test(String(error.stderr)));
});
test("package-relative loading does not depend on the caller working directory", () => {
  const module = new URL("src/application/runtime/standard-workflow-startup-composition.mjs", root).href;
  const code = `import {loadStandardWorkflowStartupAssets} from ${JSON.stringify(module)}; console.log(JSON.stringify(loadStandardWorkflowStartupAssets().source));`;
  const source = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], { cwd: os.tmpdir(), encoding: "utf8", windowsHide: true }));
  assert.deepEqual(source, assets.source);
});
console.log(JSON.stringify({ status: "PASS", checks, evidence: "published-startup-component-and-authority-validation", full_standard_workflow: "NOT_YET_DELIVERED", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
