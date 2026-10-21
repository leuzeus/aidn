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
  assert.equal(build({ skills: ["project-specific-unknown"] }).mode, "legacy-full-fallback");
  assert.equal(build({ adoption: { ...adoption, extensions: {} } }).mode, "legacy-full-fallback");
  assert.equal(build({ task: { paths: ["../foreign"] } }).mode, "blocked");
  assert.equal(build({ adoption: { ...adoption, status: "proposed", acceptance: null } }).mode, "blocked");
  const invalid = structuredClone(adoption); invalid.extensions.taskContextPolicies.skills["context-reload"].rules[0].when.unrecognized = true;
  assert.equal(build({ adoption: invalid }).mode, "blocked");
  checks.push("unknown/unconfigured skills preserve full fallback; invalid queries and unaccepted policy refuse");
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
