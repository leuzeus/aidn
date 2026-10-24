#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { buildTaskContextRequest, finalizeWorkflowContextBudget } from "../../src/application/codex/task-context-profile.mjs";
import { resolveRuntimeProjectContext } from "../../src/application/runtime/runtime-project-context-service.mjs";
import { writeWorkflowAdapterConfig } from "../../src/lib/config/workflow-adapter-config-lib.mjs";
import { createTrackedFixtureFilter, removePathWithRetry } from "./test-git-fixture-lib.mjs";
import { isActivationFixtureSource, prepareActivationFixture } from "./test-activation-fixture-lib.mjs";
import { validateJsonSchema } from "../../src/core/contracts/json-schema-validator.mjs";
import schema from "../../src/core/contracts/cli-output/codex-workflow-step-agent.v1.schema.json" with { type: "json" };
import { persistHookContext } from "../../src/adapters/codex/context-store.mjs";
import { captureContextIdentity } from "../../src/adapters/codex/context-provenance.mjs";
import { projectHistoryTransitions } from "../../src/application/codex/context-history-transitions.mjs";
import { createRuntimeArtifactStore } from "../../src/application/runtime/runtime-persistence-service.mjs";

const repo = path.resolve(import.meta.dirname, "../.."), root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-task-profile-"));
const target = path.join(root, "client"), source = path.join(repo, "tests/fixtures/repo-installed-core"), checks = [];
const hash = value => createHash("sha256").update(value).digest("hex");
const run = (exe, args, cwd = target) => {
  const result = spawnSync(exe, args, { cwd, encoding: "utf8", windowsHide: true, timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
  assert(!result.error, result.error?.message); return result;
};
const cli = args => {
  const result = run(process.execPath, [path.join(repo, "bin/aidn.mjs"), ...args.slice(0, 2), "--target", target, ...args.slice(2)], repo);
  return { ...result, payload: JSON.parse(result.stdout) };
};
const workflow = extra => cli(["codex", "workflow-step", "--skills", "context-reload", "--view", "agent", "--grouped",
  "--context-profile", "token-efficiency.v1", "--bundle-target-bytes", "32768", "--json", ...extra]);
try {
  const tracked = createTrackedFixtureFilter(source, repo);
  fs.cpSync(source, target, { recursive: true, filter: file => tracked(file) && isActivationFixtureSource(source, file, { freshContext: true }) });
  for (const args of [["init", "-b", "test/context-profile"], ["config", "user.name", "AIDN fixture"], ["config", "user.email", "fixture@example.invalid"],
    ["add", "docs", ".aidn/config.json"], ["commit", "-m", "fixture"]]) assert.equal(run("git", args).status, 0);
  prepareActivationFixture(target, repo);
  fs.writeFileSync(path.join(target, ".aidn/config.json"), JSON.stringify({ version: 1, runtime: { stateMode: "files", indexStoreMode: "dual-sqlite" } }));
  for (const name of ["CURRENT-STATE.md", "RUNTIME-STATE.md"]) {
    const file = path.join(target, "docs/audit", name);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^runtime_state_mode:.*$/m, "runtime_state_mode: files"));
  }
  fs.unlinkSync(path.join(target, "docs/audit/HANDOFF-PACKET.md"));
  const documents = { "TOKEN-SPEC.md": "## Invariant\nPreserve every mandatory authority.\n### Exception\nAn explicit refusal can request expansion. Été 😀.\n",
    "TOKEN-DEPENDENCY.md": "## Dependency\nKeep source scope and provenance.\n",
    "TOKEN-OPTIONAL.md": "## Optional\n" + "Optional historical explanation.\n".repeat(1200),
    "TOKEN-MIGRATION.md": "## Migration\nReanchor before changing persistence.\n" };
  for (const [name, content] of Object.entries(documents)) fs.writeFileSync(path.join(target, "docs/audit", name), content);
  const resolved = resolveRuntimeProjectContext({ targetRoot: target });
  const scope = Object.fromEntries(["project_id", "workspace_id", "runtime_scope_id", "worktree_id"].map(key => [key, resolved[key]]));
  const adoption = JSON.parse(fs.readFileSync(path.join(repo, "package/governance/gfd-adoption.v1.json")));
  adoption.scope = "installed-project"; adoption.adoptionId = "synthetic-token-profile";
  adoption.authorities = Object.keys(documents).map((reference, i) => ({ id: `fixture-${i}`, reference, role: "synthetic fixture authority",
    scope: "synthetic project", owner: "project_owner", status: "effective", effectiveFrom: "2026-10-02" }));
  adoption.sections = [{ id: "fixture-context", disposition: "adapted", rationale: "Explicit fixture-only policy", responsibility: "project_owner", authorities: adoption.authorities.map(a => a.id), controls: [] }];
  const unit = (id, file, heading, requires = []) => ({ id, path: file, heading, sourceSha256: hash(documents[file]),
    authority: adoption.authorities.find(a => a.reference === file).id, status: "effective", scope: { project_id: scope.project_id, workspace_id: "*", worktree_id: "*" }, requires });
  adoption.extensions = { ...adoption.extensions, contextUnits: [unit("invariant", "TOKEN-SPEC.md", "## Invariant", [{ id: "dependency", reason: "The invariant requires scoped provenance" }]),
    unit("dependency", "TOKEN-DEPENDENCY.md", "## Dependency"), unit("optional", "TOKEN-OPTIONAL.md", "## Optional"), unit("migration", "TOKEN-MIGRATION.md", "## Migration")],
    taskContextPolicies: { schemaVersion: 1, mandatory: ["invariant"], skills: { "context-reload": { mandatory: [], optional: ["optional"],
      rules: [{ when: { operations: ["migrate"], pathPrefixes: ["src/runtime"] }, mandatory: ["migration"], optional: [] }] } } } };
  writeWorkflowAdapterConfig(target, { governanceAdoption: adoption });
  assert.equal(cli(["perf", "index", "--store", "sqlite", "--with-content", "--json"]).status, 0);
  const before = hash(fs.readFileSync(path.join(target, "docs/audit/CURRENT-STATE.md")));
  const result = workflow([]);
  assert.equal(result.status, 0, result.stderr || JSON.stringify(result.payload));
  assert.deepEqual(validateJsonSchema(result.payload, schema, "$"), []);
  assert.equal(result.payload.selection_policy.mode, "scoped"); assert.equal(result.payload.context_selection.status, "complete");
  assert.equal(result.payload.bundle_budget.status, "within-target"); assert(result.payload.bundle_budget.total_bytes <= 32768);
  assert.equal(result.payload.bundle_budget.total_bytes, Buffer.byteLength(JSON.stringify(result.payload)));
  assert.deepEqual(result.payload.bundle_budget.omitted_optional_ids, ["optional"]);
  assert.deepEqual(result.payload.artifacts.map(row => row.artifact.unit_id), ["dependency", "invariant"]);
  assert.deepEqual((result.payload.artifact_metadata ?? []).map(row => row.id).sort(),
    [...new Set(result.payload.artifacts.map(row => row.artifact.canonical_ref).filter(Boolean))].sort());
  assert.equal(result.payload.artifacts.find(row => row.artifact.unit_id === "invariant").artifact.content_excerpt, documents["TOKEN-SPEC.md"]);
  checks.push("actual CLI uses accepted task policy, complete authority/dependency and final target budget");
  const insufficient = workflow(["--bundle-target-bytes", "1000"]);
  assert.equal(insufficient.payload.ok, false); assert.equal(insufficient.payload.bundle_budget.status, "blocked");
  assert(insufficient.payload.bundle_budget.minimum_required_bytes > 1000); assert(insufficient.payload.bundle_budget.expansion_required.length >= 2);
  assert.deepEqual(insufficient.payload.artifacts, []); assert(insufficient.payload.admissions[0].ok);
  assert.equal(insufficient.payload.bundle_budget.total_bytes, Buffer.byteLength(JSON.stringify(insufficient.payload)));
  checks.push("insufficient mandatory budget refuses with expansion and unchanged admissions");
  for (const initial of [result.payload, insufficient.payload]) {
    const transported = structuredClone(initial), previousStatus = initial.bundle_budget.status;
    transported.daemon = { used: false, fallback: true, endpoint_file: "bounded-fixture-endpoint", reason: "fixture transport unavailable" };
    finalizeWorkflowContextBudget(transported, { targetBytes: initial.bundle_budget.target_bytes, hardLimitBytes: initial.bundle_budget.hard_limit_bytes });
    assert.equal(transported.bundle_budget.total_bytes, Buffer.byteLength(JSON.stringify(transported)));
    assert.equal(transported.bundle_budget.status, previousStatus);
    assert.deepEqual(transported.bundle_budget.expansion_required, initial.bundle_budget.expansion_required);
    assert.deepEqual(transported.admissions, initial.admissions);
  }
  checks.push("final transport metadata is counted without restoring omitted bodies or clearing a refusal");
  fs.writeFileSync(path.join(target, "task.json"), JSON.stringify({ operation: "migrate", paths: ["src/runtime/change.mjs"] }));
  const selected = workflow(["--context-task-file", "task.json"]);
  assert(selected.payload.artifacts.some(row => row.artifact.unit_id === "migration"));
  assert.equal(selected.payload.bundle_budget.status, "within-target");
  checks.push("operation and affected paths add mandatory task context");
  const admissions = { "context-reload": { ok: true, context: { mode: "THINKING" } } };
  const build = extra => buildTaskContextRequest({ adoption, scope, admissions, skills: ["context-reload"], asOf: "2026-10-20", ...extra });
  assert.equal(build({ skills: ["project-specific-unknown"] }).mode, "blocked");
  assert.equal(build({ adoption: { ...adoption, extensions: {} } }).mode, "blocked");
  const uncovered = structuredClone(adoption); delete uncovered.extensions.taskContextPolicies.skills["context-reload"];
  assert.equal(build({ adoption: uncovered }).reason, "skill_task_policy_required");
  assert.equal(build({ adoption: uncovered, skills: ["context-reload", "unknown"] }).mode, "blocked");
  writeWorkflowAdapterConfig(target, { governanceAdoption: uncovered });
  const refusedPolicy = workflow([]);
  assert.equal(refusedPolicy.payload.selection_policy.mode, "blocked");
  assert.match(refusedPolicy.payload.selection_policy.remediation, /Accept a current client-owned task policy/);
  assert.equal(refusedPolicy.payload.ok, false);
  assert.equal(refusedPolicy.payload.summary.hydrate_count, 0);
  assert.deepEqual(refusedPolicy.payload.artifacts, []);
  assert.equal(refusedPolicy.payload.bundle_budget.hard_limit_bytes, 65536);
  assert.deepEqual(validateJsonSchema(refusedPolicy.payload, schema, "$"), []);
  writeWorkflowAdapterConfig(target, { governanceAdoption: adoption });
  assert.equal(build({ task: { paths: ["../foreign"] } }).mode, "blocked");
  assert.equal(build({ adoption: { ...adoption, status: "proposed", acceptance: null } }).mode, "blocked");
  const invalid = structuredClone(adoption); invalid.extensions.taskContextPolicies.skills["context-reload"].rules[0].when.unrecognized = true;
  assert.equal(build({ adoption: invalid }).mode, "blocked");
  checks.push("unknown/unconfigured skills refuse with remediation and no hydration or budget expansion; invalid queries and unaccepted policy refuse");
  const baseline = workflow(["--bundle-target-bytes", "65536"]);
  assert.equal(baseline.payload.bundle_budget.status, "within-target");
  assert(baseline.payload.artifacts.some(row => row.artifact.unit_id === "optional"));
  const baselineRef = ".aidn/runtime/context/previous-workflow.json", baselineFile = path.join(target, baselineRef);
  fs.mkdirSync(path.dirname(baselineFile), { recursive: true });
  fs.writeFileSync(baselineFile, JSON.stringify(baseline.payload));
  const delta = workflow(["--bundle-target-bytes", "65536", "--context-baseline-file", baselineRef]);
  assert.deepEqual(validateJsonSchema(delta.payload, schema, "$"), []);
  assert.equal(delta.payload.context_delta.mode, "differential");
  assert.deepEqual(delta.payload.artifacts.map(row => row.artifact.unit_id), ["dependency", "invariant"]);
  assert.deepEqual(delta.payload.context_delta.unchanged_optional_refs.map(row => row.unit_id), ["optional"]);
  assert.equal(delta.payload.bundle_budget.total_bytes, Buffer.byteLength(JSON.stringify(delta.payload)));
  checks.push("workflow delta freshly returns mandatory closure and only references unchanged optional bodies");
  const metadataBaseline = structuredClone(baseline.payload);
  if (!metadataBaseline.artifact_metadata?.length) {
    // A caller-held baseline is a hint, not evidence. Exercise its metadata graph
    // even when this fixture's SQLite adapter has no canonical metadata object.
    const row = metadataBaseline.artifacts.find(row => row.artifact.unit_id === "optional"), old = row.id;
    const binding = { source: row.source, path: row.artifact.path, sha256: row.artifact.sha256, canonical: { synthetic_fixture_metadata: true } };
    const id = hash(JSON.stringify(binding)); metadataBaseline.artifact_metadata = [{ id, ...binding }];
    delete row.artifact.canonical; row.artifact.canonical_ref = id; row.id = hash(JSON.stringify({ source: row.source, artifact: row.artifact }));
    for (const context of metadataBaseline.contexts) context.artifact_refs = context.artifact_refs.map(ref => ref === old ? row.id : ref);
  }
  fs.writeFileSync(baselineFile, JSON.stringify(metadataBaseline));
  assert.equal(workflow(["--bundle-target-bytes", "65536", "--context-baseline-file", baselineRef]).payload.context_delta.mode, "differential");
  for (const change of [value => { value.artifact_metadata[0].canonical.fixture_tampered = true; }, value => { value.artifact_metadata = []; }]) {
    const metadataTampered = structuredClone(metadataBaseline); change(metadataTampered);
    fs.writeFileSync(baselineFile, JSON.stringify(metadataTampered));
    const freshMetadata = workflow(["--bundle-target-bytes", "65536", "--context-baseline-file", baselineRef]);
    assert.equal(freshMetadata.payload.context_delta.mode, "full");
    assert(freshMetadata.payload.artifacts.some(row => row.artifact.unit_id === "optional"));
    assert.equal(freshMetadata.payload.bundle_budget.total_bytes, Buffer.byteLength(JSON.stringify(freshMetadata.payload)));
  }
  checks.push("valid shared metadata is reusable as a hint; corrupt or missing metadata reconstructs the complete optional graph");
  for (const contents of ["{corrupt JSON", JSON.stringify({ ...baseline.payload,
    context_selection: { ...baseline.payload.context_selection, scope: { ...scope, worktree_id: "foreign" } } })]) {
    fs.writeFileSync(baselineFile, contents);
    const fresh = workflow(["--bundle-target-bytes", "65536", "--context-baseline-file", baselineRef]);
    assert.equal(fresh.payload.context_delta.mode, "full");
    assert(fresh.payload.artifacts.some(row => row.artifact.unit_id === "optional"));
  }
  fs.unlinkSync(baselineFile);
  const absent = workflow(["--bundle-target-bytes", "65536", "--context-baseline-file", baselineRef]);
  assert.equal(absent.payload.context_delta.mode, "full"); assert(absent.payload.artifacts.length >= 3);
  checks.push("missing, corrupt or foreign workflow baseline triggers complete fresh consultation");
  const tampered = structuredClone(baseline.payload), changed = tampered.artifacts.find(row => row.artifact.unit_id === "optional"), oldId = changed.id;
  changed.artifact.content_excerpt += "tampered"; changed.id = hash(JSON.stringify({ source: changed.source, artifact: changed.artifact }));
  for (const context of tampered.contexts) context.artifact_refs = context.artifact_refs.map(id => id === oldId ? changed.id : id);
  fs.writeFileSync(baselineFile, JSON.stringify(tampered));
  const integrity = workflow(["--bundle-target-bytes", "65536", "--context-baseline-file", baselineRef]);
  assert.equal(integrity.payload.context_delta.mode, "full"); assert.equal(integrity.payload.context_delta.reason, "baseline_integrity_invalid");
  assert(!integrity.payload.artifacts.some(row => row.artifact.content_excerpt.includes("tampered")));
  checks.push("baseline body integrity is checked independently of its artifact graph");
  fs.writeFileSync(baselineFile, JSON.stringify(baseline.payload));
  const mandatoryFile = path.join(target, "docs/audit/TOKEN-SPEC.md"); fs.unlinkSync(mandatoryFile);
  const unavailableAuthority = workflow(["--bundle-target-bytes", "65536", "--context-baseline-file", baselineRef]);
  assert.equal(unavailableAuthority.payload.ok, false); assert.equal(unavailableAuthority.payload.context_selection.status, "blocked");
  assert.equal(unavailableAuthority.payload.context_delta.reason, "current_selection_blocked"); assert.deepEqual(unavailableAuthority.payload.artifacts, []);
  fs.writeFileSync(mandatoryFile, documents["TOKEN-SPEC.md"]);
  checks.push("a missing current mandatory authority never reuses the baseline authority");

  const identity = captureContextIdentity({ targetRoot: target }); assert.equal(identity.status, "captured");
  for (let i = 0; i < 3; i++) persistHookContext({ targetRoot: target, skill: "context-reload", rawPayload: { fixture_observation: i },
    normalized: { ts: `2026-10-20T12:00:0${i}Z`, ok: i < 2, decision: i < 2 ? "allow" : "deny", mode: "THINKING", state_mode: "files", reason_codes: i < 2 ? [] : ["fixture-denial"] },
    sourceMeta: { execution_id: `fixture-observation-${i}`, command: "synthetic fixture observer", command_status: i < 2 ? 0 : 1,
      provenance: { kind: "hook-command-observation.v1", before: identity, after: identity, command_status: i < 2 ? 0 : 1, command_signal: null, command_error: false } } });
  const historyFile = path.join(target, ".aidn/runtime/context/codex-context.json"), historyBefore = hash(fs.readFileSync(historyFile));
  const transitioned = workflow(["--bundle-target-bytes", "65536", "--history-view", "transitions"]);
  assert.equal(transitioned.payload.history_view, "transitions"); assert.deepEqual(validateJsonSchema(transitioned.payload, schema, "$"), []);
  const transitions = transitioned.payload.contexts[0].recent_history;
  assert.deepEqual(transitions.map(row => row.observation_count), [2, 1]);
  assert.equal(new Set(transitions[0].observations.map(row => row.execution_id)).size, 2);
  assert(transitions.every(row => row.write_authorization === false && row.requires_fresh_admission));
  assert.equal(hash(fs.readFileSync(historyFile)), historyBefore); assert.equal(JSON.parse(fs.readFileSync(historyFile)).history.length, 3);
  checks.push("decision transitions preserve distinct executions and leave retained audit history untouched");
  const unknown = { skill: "context-reload", state_mode: "db-only", ok: true, reuse_status: "unknown",
    provenance: { kind: "hook-command-observation.v1", before: { ...identity, state_mode: "db-only" }, after: { ...identity, state_mode: "db-only" } } };
  const separate = projectHistoryTransitions([unknown, structuredClone(unknown)]);
  assert.equal(separate.length, 2); assert(separate.every(row => row.binding_status === "unavailable"));
  checks.push("unknown canonical history revisions are never collapsed into one observation");
  const currentFile = path.join(target, "docs/audit/CURRENT-STATE.md"), currentBefore = fs.readFileSync(currentFile);
  fs.appendFileSync(currentFile, "\nCurrent fixture context changed.\n");
  const reanchored = workflow(["--bundle-target-bytes", "65536", "--history-view", "transitions"]);
  assert.notEqual(reanchored.payload.observation.source_revision, transitioned.payload.observation.source_revision);
  assert(reanchored.payload.contexts[0].recent_history.every(row => row.reusable === false && row.reuse_status === "stale"));
  assert(reanchored.payload.admissions[0].ok); assert(reanchored.payload.artifacts.some(row => row.artifact.unit_id === "invariant"));
  fs.writeFileSync(currentFile, currentBefore);
  checks.push("context invalidation marks history stale and performs fresh independent admission and authority selection");
  const foreign = structuredClone(adoption); foreign.extensions.contextUnits[0].scope.project_id = "foreign";
  writeWorkflowAdapterConfig(target, { governanceAdoption: foreign });
  const denied = workflow([]);
  assert.equal(denied.payload.ok, false); assert.equal(denied.payload.context_selection.status, "blocked");
  assert(denied.payload.context_selection.errors.some(error => error.reason === "project_scope_mismatch")); assert.deepEqual(denied.payload.artifacts, []);
  checks.push("foreign mandatory authority blocks instead of falling back or omitting it");
  assert.equal(hash(fs.readFileSync(path.join(target, "docs/audit/CURRENT-STATE.md"))), before);
  assert(!fs.existsSync(path.join(target, ".aidn/runtime/context/agent-view-receipts")));
  assert.notEqual(workflow(["--bundle-hard-limit-bytes", "65537"]).status, 0);
  checks.push("profile remains read-only and refuses budgets above its versioned maximum");
  writeWorkflowAdapterConfig(target, { governanceAdoption: adoption });
  const written = workflow(["--write"]);
  assert.equal(written.payload.effect_class, "mutating");
  const receipt = written.payload.receipt, bytes = fs.readFileSync(receipt.path), retained = JSON.parse(bytes).observation;
  assert.equal(hash(bytes), receipt.sha256); assert.equal(bytes.length, receipt.bytes);
  assert.equal(retained.context_budget_request.target_bytes, 32768); assert.equal(retained.context_selection.status, "complete");
  assert.equal(written.payload.bundle_budget.total_bytes, Buffer.byteLength(JSON.stringify(written.payload)));
  assert.deepEqual(validateJsonSchema(written.payload, schema, "$"), []);
  checks.push("explicit diagnostic receipt is real and included in the final serialized budget");
  const receiptRef = path.relative(target, receipt.path);
  const receiptCount = fs.readdirSync(path.dirname(receipt.path)).length;
  const receiptDelta = workflow(["--bundle-target-bytes", "65536", "--context-baseline-file", receiptRef]);
  assert.equal(receiptDelta.payload.context_delta.mode, "differential");
  assert.deepEqual(receiptDelta.payload.artifacts.map(row => row.artifact.unit_id), ["dependency", "invariant"]);
  assert.deepEqual(receiptDelta.payload.context_delta.unchanged_optional_refs.map(row => row.unit_id), ["optional"]);
  assert.deepEqual(validateJsonSchema(receiptDelta.payload, schema, "$"), []);
  assert.equal(fs.readdirSync(path.dirname(receipt.path)).length, receiptCount, "reading a receipt never retains another receipt");
  const invalidReceiptRef = ".aidn/runtime/context/invalid-prior-receipt.json";
  for (const change of [
    value => { value.kind = "run-json-hook"; },
    value => { value.scope = "foreign"; },
    value => { value.write_authorization = true; },
    value => { value.observation.context_selection.scope.worktree_id = "foreign"; },
    value => {
      const optional = Object.values(value.observation.hydrations).flatMap(row => row.artifacts ?? []).find(row => row.unit_id === "optional");
      assert(optional); optional.content_excerpt += "tampered receipt hint";
    },
  ]) {
    const invalidReceipt = JSON.parse(bytes); change(invalidReceipt);
    fs.writeFileSync(path.join(target, invalidReceiptRef), JSON.stringify(invalidReceipt));
    const fresh = workflow(["--bundle-target-bytes", "65536", "--context-baseline-file", invalidReceiptRef]);
    assert.equal(fresh.payload.context_delta.mode, "full");
    assert(fresh.payload.artifacts.some(row => row.artifact.unit_id === "optional"));
    assert(!fresh.payload.artifacts.some(row => row.artifact.content_excerpt.includes("tampered receipt hint")));
  }
  const retainedDelta = workflow(["--bundle-target-bytes", "65536", "--context-baseline-file", receiptRef, "--write"]);
  assert.equal(retainedDelta.payload.context_delta.mode, "differential");
  const partialReceipt = workflow(["--bundle-target-bytes", "65536", "--context-baseline-file", path.relative(target, retainedDelta.payload.receipt.path)]);
  assert.equal(partialReceipt.payload.context_delta.mode, "full", "a differential receipt is not a complete prior selection");
  assert(partialReceipt.payload.artifacts.some(row => row.artifact.unit_id === "optional"));
  assert.equal(hash(fs.readFileSync(receipt.path)), receipt.sha256, "the complete retained observation is immutable");
  checks.push("complete workflow receipts provide untrusted delta hints; invalid, foreign or differential receipts reanchor freshly without implicit writes");
  const sqlite = createRuntimeArtifactStore({ targetRoot: target, backend: "sqlite" });
  const originalIndex = await sqlite.loadSnapshot({ includePayload: true, includeRuntimeHeads: false });
  assert(originalIndex.exists && originalIndex.payload);
  try {
    const inflated = structuredClone(originalIndex.payload);
    const artifact = inflated.artifacts.find(row => row.path === "TOKEN-SPEC.md"); assert(artifact);
    artifact.canonical = { schema_version: 1, format: "markdown", artifact_class: "spec", title: "Fixture source identity",
      stats: { sections: 2 }, structured_sections: { unselected: "Unselected canonical source detail. ".repeat(4000) } };
    await sqlite.writeIndexProjection({ payload: inflated });
    const requestRef = ".aidn/runtime/context/large-metadata-selection.json";
    fs.writeFileSync(path.join(target, requestRef), JSON.stringify({ schemaVersion: 1, purpose: "effective", asOf: "2026-10-20",
      scope, roots: ["invariant"], optional: [], units: adoption.extensions.contextUnits }));
    const standalone = cli(["codex", "hydrate-context", "--context-selection-file", requestRef,
      "--bundle-target-bytes", "32768", "--bundle-hard-limit-bytes", "65536", "--json"]);
    assert.equal(standalone.payload.context_selection.status, "blocked");
    assert(standalone.payload.context_selection.errors.some(row => row.reason === "mandatory_budget_insufficient"));
    const projected = workflow([]);
    assert.equal(projected.payload.context_selection.status, "complete", "raw hydration size cannot refuse a smaller final agent representation");
    assert.equal(projected.payload.bundle_budget.status, "within-target");
    assert.equal(projected.payload.bundle_budget.total_bytes, Buffer.byteLength(JSON.stringify(projected.payload)));
    assert(projected.payload.artifacts.some(row => row.artifact.content_excerpt === documents["TOKEN-SPEC.md"]));
    assert(!JSON.stringify(projected.payload).includes("Unselected canonical source detail."));
    assert.deepEqual(validateJsonSchema(projected.payload, schema, "$"), []);
  } finally { await sqlite.writeIndexProjection({ payload: originalIndex.payload }); }
  checks.push("workflow budgets only its final agent JSON while standalone hydration keeps its own complete JSON budget");
  // Refusal metadata itself can exceed a tiny requested hard limit. It must
  // report that fact rather than delete the admission/stop diagnostic.
  const diagnostic = { ok: true, contexts: [], artifacts: [], admissions: [{ blocking_reasons: ["x".repeat(500)] }] };
  finalizeWorkflowContextBudget(diagnostic, { targetBytes: 10, hardLimitBytes: 10 });
  assert.equal(diagnostic.ok, false); assert.equal(diagnostic.bundle_budget.fits_hard_limit, false);
  assert.equal(diagnostic.admissions[0].blocking_reasons[0].length, 500);
  checks.push("oversized refusal diagnostics remain explicit and intact");
  console.log(JSON.stringify({ status: "PASS", proof_class: "fixtures-and-real-source-cli", assertions: checks.length, checks,
    response_bytes: result.payload.bundle_budget.total_bytes, native_tokens: "UNAVAILABLE", installed_client: "SKIP" }));
} catch (error) { console.error(error.stack); process.exitCode = 1; }
finally { removePathWithRetry(root); }
