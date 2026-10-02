#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { proposeWorkflowCandidate, previewWorkflowCandidate, renderWorkflowCandidate, checkWorkflowProjection } from "../../src/core/workflow/workflow-candidate.mjs";
import { activateWorkflowCandidate, assertWorkflowSelection } from "../../src/core/workflow/workflow-selection.mjs";
import { createWorkflowInstance, decideWorkflowInstance } from "../../src/core/workflow/workflow-instance.mjs";
import { createWorkflowInstanceService } from "../../src/application/runtime/workflow-instance-service.mjs";
import { createWorkflowCandidateService } from "../../src/application/runtime/workflow-candidate-service.mjs";
import { createProjectWorkflowCandidateService, createWorkflowSelectionStore } from "../../src/application/runtime/workflow-candidate-composition.mjs";
import { createWorkflowInstanceStore } from "../../src/adapters/runtime/workflow-instance-store.mjs";
import { createArtifactStore } from "../../src/adapters/runtime/artifact-store.mjs";
import { createIndexStore } from "../../src/lib/index/index-store.mjs";
import { compileShadowWorkflow } from "../../src/core/workflow/workflow-shadow-compiler.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";

const json = file => JSON.parse(fs.readFileSync(new URL("../../" + file, import.meta.url), "utf8"));
const original = json("tests/fixtures/workflow-shadow/diagnostic-correction.v1.json");
const base = { ...original, workflow_id: "reviewed-correction", entry: "approval",
  steps: original.steps.filter(step => step.id !== "diagnose"), transitions: original.transitions.filter(edge => edge.from !== "diagnose") };
const context = { contract_version: "workflow-shadow-context.v1", authority: "caller_supplied", product_version: "0.11.0", workflow_version: 7, state_mode: "files" };
const scope = { target_sha256: "a".repeat(64), persistence_sha256: "b".repeat(64), runtime_scope_id: "scope.fixture", activation: { authority_id: "fixture", revision: 1 } };
const evidence = [{ ref: "human-review-fixture", sha256: "c".repeat(64) }];
const candidate = () => { const value = structuredClone(base); value.revision++; value.transitions.find(edge => edge.max_traversals).max_traversals = 1; return value; };
const proposal = (definition = candidate(), overrides = {}) => proposeWorkflowCandidate({ baseDefinition: base, definition, context, explanation: "Limit correction to one return while retaining approval and review.", ...overrides });
const compiled = () => compileShadowWorkflow(base, context).compilation;
const review = preview => ({ decision: "approve", preview_sha256: preview.preview_sha256, evidence });
let count = 0;
async function check(name, work) { await work(); count++; console.log("PASS " + name); }
const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-workflow-candidate-"));
try {
  await check("closed candidate and selection schemas", () => {
    for (const name of ["workflow-candidate.v1", "workflow-selection.v1", "workflow-candidate-preview.v1", "workflow-projection.v1"]) assert.deepEqual(validateJsonSchemaDefinition(json(`src/core/contracts/workflow-definition/${name}.schema.json`), "#", { contractKind: "workflow-definition" }), []);
  });
  await check("pure deterministic candidate carries exact compilation, diff and permission ceiling", () => {
    const before = JSON.stringify({ base, context }); const first = proposal();
    assert.deepEqual(first, proposal()); assert.equal(first.permissions.within_ceiling, true);
    assert.equal(first.diff.transitions.length, 1); assert.equal(first.diff.steps.length, 0);
    assert.equal(first.execution_available, false); assert.equal(first.written, false);
    assert.equal(JSON.stringify({ base, context }), before); assert(Object.isFrozen(first.compilation));
  });
  await check("invalid suggestions and executable permission declarations are rejected", () => {
    for (const mutate of [def => def.permissions = { write: ["**"] }, def => def.steps[0].primitive_ref = "shell",
      def => def.transitions[0].condition = "eval(anything)", def => def.revision = 99]) {
      const next = candidate(); mutate(next); assert.throws(() => proposal(next), /WORKFLOW_CANDIDATE_/);
    }
    let getter = false; const next = candidate(); Object.defineProperty(next, "permissions", { enumerable: true, get() { getter = true; return {}; } });
    assert.throws(() => proposal(next), /INPUT_INVALID/); assert.equal(getter, false);
  });
  await check("increasing bounded returns cannot be activated", () => {
    const next = candidate(); next.transitions.find(edge => edge.max_traversals).max_traversals = 3;
    const result = proposal(next); assert.equal(result.permissions.within_ceiling, false);
    assert(result.permissions.reasons.some(reason => reason.code === "RETURN_CAPABILITY_EXTENDED"));
  });
  await check("adding an effect step cannot be activated even with a known primitive", () => {
    const next = candidate(), step = structuredClone(next.steps.find(step => step.id === "correction")); step.id = "additional"; next.steps.push(step);
    const completed = next.transitions.find(edge => edge.from === "correction" && edge.outcome === "completed"); completed.to = "additional";
    next.transitions.push({ ...structuredClone(completed), id: "additional-completed", from: "additional", to: "review" },
      { ...structuredClone(completed), id: "additional-failed", from: "additional", to: "stop", outcome: "failed" });
    assert(proposal(next).permissions.reasons.some(reason => reason.code === "CAPABILITY_ADDED"));
  });
  await check("removing approval or bypassing review cannot be activated", () => {
    const removed = candidate(); removed.entry = "correction"; removed.steps = removed.steps.filter(step => step.id !== "approval"); removed.transitions = removed.transitions.filter(edge => edge.from !== "approval");
    const result = proposal(removed); assert.equal(result.permissions.within_ceiling, false); assert(result.permissions.reasons.some(reason => reason.code === "CONTROL_REMOVED"));
    const bypass = candidate(); bypass.transitions.find(edge => edge.from === "approval" && edge.outcome === "approved").to = "review";
    bypass.transitions.find(edge => edge.from === "correction" && edge.outcome === "completed").to = "done";
    assert(proposal(bypass).permissions.reasons.some(reason => reason.code === "POSTCONDITION_BYPASSED"));
  });
  await check("adding a human prerequisite keeps the declared permission ceiling", () => {
    const next = candidate(), step = structuredClone(next.steps.find(step => step.id === "approval")); step.id = "additional-review"; next.steps.push(step);
    const approved = next.transitions.find(edge => edge.from === "approval" && edge.outcome === "approved"); approved.to = step.id;
    next.transitions.push({ ...structuredClone(approved), id: "additional-approved", from: step.id, to: "correction" },
      { ...structuredClone(approved), id: "additional-rejected", from: step.id, outcome: "rejected", to: "stop" });
    assert.equal(proposal(next).permissions.within_ceiling, true);
  });
  await check("unsupported existing handlers remain explicit and never become executable by suggestion", () => {
    const next = structuredClone(original); next.revision++;
    const result = proposal(next, { baseDefinition: original });
    assert(result.permissions.reasons.some(reason => reason.code === "HANDLER_UNAVAILABLE" && reason.id === "diagnose"));
  });
  await check("documentation and diagram use compiler identities; stale or tampered projection is detected", () => {
    const value = proposal(), projection = renderWorkflowCandidate(value, compiled());
    for (const step of value.compilation.steps) { assert(projection.markdown.includes(step.id)); assert(projection.mermaid.includes(step.id)); }
    for (const edge of value.compilation.transitions) { assert(projection.markdown.includes(edge.id)); assert(projection.mermaid.includes(edge.id)); }
    assert.equal(checkWorkflowProjection(value, compiled(), projection), true);
    assert.equal(checkWorkflowProjection(proposal(candidate(), { explanation: "A different explanation." }), compiled(), projection), false);
    const changed = { ...projection, markdown: projection.markdown + "stale" }; const { projection_sha256, ...body } = changed; changed.projection_sha256 = shadowHash(body);
    assert.equal(checkWorkflowProjection(value, compiled(), changed), false);
  });
  for (const stateMode of ["files", "dual", "db-only"]) await check("reviewed activation persists without migrating instances: " + stateMode, () => {
    const targetRoot = path.join(root, stateMode); fs.mkdirSync(targetRoot);
    fs.mkdirSync(path.join(targetRoot, ".aidn")); fs.writeFileSync(path.join(targetRoot, ".aidn/config.json"), JSON.stringify({ runtime: { stateMode } }));
    if (stateMode !== "files") createArtifactStore({ sqliteFile: path.join(targetRoot, ".aidn/runtime/index/workflow-index.sqlite") }).close();
    const options = { targetRoot, stateMode }, instances = createWorkflowInstanceStore(options), selections = createWorkflowSelectionStore(options);
    const ctx = { ...context, state_mode: stateMode };
    const waiting = createWorkflowInstance({ instanceId: "source", definition: base, context: ctx, scope });
    let seed = decideWorkflowInstance(waiting, { outcome: "rejected", evidence }); instances.compareAndSwap(seed, null);
    let revoked = false;
    const authority = () => { if (revoked) throw new Error("WORKFLOW_INSTANCE_ACTIVATION_REQUIRED"); return { scope, stateMode, productVersion: "0.11.0" }; };
    const lifecycle = createWorkflowInstanceService({ store: instances, readAuthority: authority });
    const service = createWorkflowCandidateService({ selections, instances, readAuthority: authority, initializeInstance: input => lifecycle.initialize(input) });
    const request = { baseInstanceId: "source", definition: candidate(), explanation: "One bounded return." };
    const packet = service.generationInput({ workflowId: base.workflow_id, baseInstanceId: "source" });
    assert.deepEqual(packet.response_fields, ["definition", "explanation"]); assert.equal(packet.registry.authority, "reference_only");
    assert.equal(packet.baseline.sha256, seed.instance_sha256); assert.equal(packet.written, false);
    const before = instances.read("source"); const preview = service.propose(request); assert.equal(preview.activation_eligible, true);
    assert.equal(selections.read(base.workflow_id).record, null);
    const apply = { ...request, expectedPreviewSha256: preview.preview_sha256, review: review(preview), write: true };
    assert.equal(service.activate({ ...apply, write: false }).written, false); assert.equal(selections.read(base.workflow_id).record, null);
    assert.throws(() => service.activate({ ...apply, review: { ...review(preview), preview_sha256: "0".repeat(64) } }), /REVIEW_INVALID/);
    revoked = true; assert.throws(() => service.activate(apply), /ACTIVATION_REQUIRED/); revoked = false;
    const result = service.activate(apply); assert.equal(result.written, true); assertWorkflowSelection(result.selection);
    assert.equal(createWorkflowSelectionStore(options).read(base.workflow_id).record.selection_sha256, result.selection.selection_sha256);
    assert.deepEqual(instances.read("source"), before);
    assert.throws(() => service.activate(apply), /WORKFLOW_CANDIDATE_/);
    const created = service.initializeSelected({ workflowId: base.workflow_id, instanceId: "selected", expectedSelectionSha256: result.selection.selection_sha256, write: true });
    assert.equal(created.instance.definition.revision, 3); assert.equal(instances.read("source").instance.definition.revision, 2);
    const newer = candidate(); newer.revision = 4;
    const next = { definition: newer, explanation: "Retain the selected topology." }, nextPreview = service.propose(next);
    const second = service.activate({ ...next, expectedPreviewSha256: nextPreview.preview_sha256, review: review(nextPreview), write: true });
    assert.equal(second.selection.revision, 2); assertWorkflowSelection(second.selection);
    assert.throws(() => service.initializeSelected({ workflowId: base.workflow_id, instanceId: "stale", expectedSelectionSha256: result.selection.selection_sha256, write: true }), /SELECTION_CHANGED/);
    assert.equal(instances.read("selected").instance.definition.revision, 3);
    if (stateMode === "files") {
      const index = createIndexStore({ targetRoot, mode: "sqlite", sqliteOutput: path.join(targetRoot, ".aidn/runtime/index/workflow-index.sqlite") });
      const payload = content => ({ schema_version: 2, target_root: targetRoot, artifacts: [{ path: `workflows/definitions/${base.workflow_id}.json`, content_format: "utf8", content, sha256: artifactContentHash(content) }] });
      index.write(payload(JSON.stringify(result.selection)));
      index.write(payload(JSON.stringify(second.selection)));
      const mirror = createArtifactStore({ sqliteFile: path.join(targetRoot, ".aidn/runtime/index/workflow-index.sqlite"), readOnly: true });
      try { assert.equal(JSON.parse(mirror.getArtifact(`workflows/definitions/${base.workflow_id}.json`).content).selection_sha256, second.selection.selection_sha256); }
      finally { mirror.close(); }
    } else {
      const sqliteOutput = path.join(targetRoot, ".aidn/runtime/index/workflow-index.sqlite"), index = createIndexStore({ targetRoot, mode: "sqlite", sqliteOutput });
      const empty = { schema_version: 2, generated_at: "2026-10-01T00:00:00Z", target_root: targetRoot, artifacts: [], cycles: [], sessions: [], file_map: [], tags: [], artifact_tags: [] };
      index.write(empty);
      assert.equal(selections.read(base.workflow_id).record.selection_sha256, second.selection.selection_sha256);
      assert.equal(instances.read("source").instance.instance_sha256, seed.instance_sha256);
      assert.throws(() => index.write({ ...empty, artifacts: [{ path: `workflows/definitions/${base.workflow_id}.json`, content_format: "utf8", content: "{}" }] }), /ARTIFACT_WORKFLOW_PROJECTION_CONFLICT/);
      assert.equal(selections.read(base.workflow_id).record.selection_sha256, second.selection.selection_sha256);
    }
    if (stateMode === "db-only") assert.equal(fs.existsSync(path.join(targetRoot, "docs")), false);
  });
  await check("active baseline refuses activation and an expanded ceiling cannot be approved", () => {
    const targetRoot = path.join(root, "active"); fs.mkdirSync(targetRoot); const options = { targetRoot, stateMode: "files" };
    const instances = createWorkflowInstanceStore(options), selections = createWorkflowSelectionStore(options);
    const state = createWorkflowInstance({ instanceId: "source", definition: base, context, scope }); instances.compareAndSwap(state, null);
    const service = createWorkflowCandidateService({ instances, selections, readAuthority: () => ({ scope, stateMode: "files", productVersion: "0.11.0" }) });
    const input = { baseInstanceId: "source", definition: candidate(), explanation: "Candidate." }, preview = service.propose(input);
    assert.equal(preview.quiescent, false);
    assert.throws(() => service.activate({ ...input, expectedPreviewSha256: preview.preview_sha256, review: review(preview), write: true }), /BASELINE_ACTIVE/);
    instances.compareAndSwap(decideWorkflowInstance(state, { outcome: "rejected", evidence }), instances.read("source").content_sha256);
    assert.throws(() => service.activate({ ...input, expectedPreviewSha256: preview.preview_sha256, review: review(preview), write: true }), /PREVIEW_CHANGED/);
    const expanded = candidate(); expanded.transitions.find(edge => edge.max_traversals).max_traversals = 3;
    const bad = { ...input, definition: expanded }, badPreview = service.propose(bad); assert.equal(badPreview.activation_eligible, false);
    assert.throws(() => service.activate({ ...bad, expectedPreviewSha256: badPreview.preview_sha256, review: review(badPreview), write: true }), /PERMISSION_EXTENSION/);
    assert.equal(selections.read(base.workflow_id).record, null);
  });
  await check("retained compiler drift is readable but cannot initialize an unreviewed compilation", () => {
    const changed = structuredClone(proposal()); changed.compilation.registry.sha256 = "0".repeat(64);
    const { compilation_sha256, ...compiledBody } = changed.compilation; changed.compilation.compilation_sha256 = shadowHash(compiledBody);
    const { proposal_sha256, ...proposalBody } = changed; changed.proposal_sha256 = shadowHash(proposalBody);
    const seed = { instance_id: "source", instance_sha256: "e".repeat(64), definition: base, compilation: compiled() };
    const preview = previewWorkflowCandidate({ proposal: changed, baseCompilation: compiled(), scope, baseline: { kind: "instance", id: seed.instance_id, sha256: seed.instance_sha256 } });
    const selected = activateWorkflowCandidate({ seed, scope, proposal: changed, review: review(preview) });
    let initialized = false;
    const service = createWorkflowCandidateService({ selections: { read: () => ({ record: selected }) }, instances: {},
      readAuthority: () => ({ scope, stateMode: "files", productVersion: "0.11.0" }), initializeInstance: () => { initialized = true; } });
    assert.equal(service.inspect(base.workflow_id).selection_sha256, selected.selection_sha256);
    assert.throws(() => service.initializeSelected({ workflowId: base.workflow_id, instanceId: "future", expectedSelectionSha256: selected.selection_sha256, write: true }), /COMPILATION_CHANGED/);
    assert.equal(initialized, false);
  });
  await check("package source-style directory cannot invent a canonical baseline", () => {
    const targetRoot = path.join(root, "uninstalled"); fs.mkdirSync(targetRoot);
    const service = createProjectWorkflowCandidateService({ targetRoot });
    assert.throws(() => service.propose({ baseInstanceId: "missing", definition: candidate(), explanation: "Untrusted suggestion." }), /BASELINE_INVALID/);
    assert.deepEqual(fs.readdirSync(targetRoot), []);
  });
  console.log(JSON.stringify({ ok: true, checks: count, proof_class: "candidate-and-durable-artifact-fixtures", native_codex: "SKIP", postgres: "SKIP" }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
