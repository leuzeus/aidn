#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { runHydrateContextUseCase } from "../../src/application/codex/hydrate-context-use-case.mjs";
import { selectScopedContext, completeMarkdownUnit } from "../../src/application/codex/scoped-context-selection.mjs";
import { writeWorkflowAdapterConfig } from "../../src/lib/config/workflow-adapter-config-lib.mjs";
import { createRuntimeArtifactStore } from "../../src/application/runtime/runtime-persistence-service.mjs";
import { validateJsonSchema } from "../../src/core/contracts/json-schema-validator.mjs";
import { resolveCliEffectClass } from "../../src/core/cli/effect-policy.mjs";
import { resolveRuntimeProjectContext } from "../../src/application/runtime/runtime-project-context-service.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";
import { redactDiagnostic } from "../verify/git-worktree-state-lib.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const hash = (value) => createHash("sha256").update(value).digest("hex");

async function main() {
  const report = { status: "FAIL", proof_class: "fixture", checks: [], native_client_qualification: "UNAVAILABLE", observations: {}, measurements: [] };
  let stage = "fixture-setup";
  let temporary;
  const check = (name, observed, expected = true) => {
    const pass = JSON.stringify(observed) === JSON.stringify(expected);
    report.checks.push({ name, observed, expected, pass });
    assert(pass, name);
  };
  try {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-scoped-context-"));
    fs.mkdirSync(path.join(temporary, ".aidn/project"), { recursive: true });
    fs.writeFileSync(path.join(temporary, ".aidn/project/shared-runtime.locator.json"), JSON.stringify({ version: 2, projectId: "synthetic-project", workspaceId: "A" }));
    const resolved = resolveRuntimeProjectContext({ targetRoot: temporary });
    const scope = { project_id: resolved.project_id, workspace_id: resolved.workspace_id, runtime_scope_id: resolved.runtime_scope_id, worktree_id: resolved.worktree_id, cycle_id: "C101" };
    const documents = {
      "SPEC.md": "# Synthetic specification\n" + "Historical explanation.\n".repeat(500)
        + "## Invariants\nDo not write without admission.\n```md\n## Not a heading\n```\n### Exceptions\nÉté 😀: consult historical hypotheses without promoting them.\n## DoR\nKeep rollback evidence.\n",
      "WORKFLOW.md": "## Local\nRead the scoped state.\n## Migration\nPreserve history.\n## Hypothesis\nNot an effective rule.\n",
      "cycles/C101/status.md": "## Status\nC101 in worktree A.\n",
      "cycles/C202/status.md": "## Status\nC202 in worktree B.\n",
      "decisions/current.md": "## Decision\nUse the selected canonical backend.\n",
      "decisions/old.md": "## Decision\nSuperseded: use files.\n",
      "attempt-rule.md": "## Integrity\nA missing prerequisite does not prove an unexecuted product failed.\n",
      "optional.md": "## Optional\n" + "Optional explanation 😀.\n".repeat(2000),
    };
    for (const [file, content] of Object.entries(documents)) {
      const destination = path.join(temporary, "docs/audit", file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, content);
    }
    const adoption = JSON.parse(fs.readFileSync(path.join(root, "package/governance/gfd-adoption.v1.json")));
    adoption.scope = "installed-project";
    adoption.adoptionId = "synthetic-scoped-client";
    adoption.authorities = Object.keys(documents).map((reference, index) => ({ id: `authority-${index}`, reference,
      role: "fixture authority", scope: "synthetic project", owner: "project_owner", status: "effective", effectiveFrom: "2026-10-02" }));
    adoption.sections = [{ id: "5", disposition: "adapted", rationale: "Owned synthetic corpus, explicitly accepted for fixture use.", responsibility: "project_owner",
      authorities: adoption.authorities.map((row) => row.id), controls: [] }];
    writeWorkflowAdapterConfig(temporary, { governanceAdoption: adoption });
    const unit = (id, file, heading, extra = {}) => ({ id, path: file, heading, sourceSha256: hash(documents[file]),
      authority: adoption.authorities.find((row) => row.reference === file).id, status: "effective",
      scope: { project_id: scope.project_id, workspace_id: "*", worktree_id: "*" }, requires: [], ...extra });
    const units = [
      unit("invariants", "SPEC.md", "## Invariants"),
      unit("dor", "SPEC.md", "## DoR", { requires: [{ id: "invariants", reason: "DoR cannot relax invariants" }] }),
      unit("local", "WORKFLOW.md", "## Local", { requires: [{ id: "invariants", reason: "mandatory safety conditions" }] }),
      unit("migration", "WORKFLOW.md", "## Migration", { requires: [{ id: "dor", reason: "migration readiness" }] }),
      unit("hypothesis", "WORKFLOW.md", "## Hypothesis", { status: "hypothesis" }),
      unit("cycle-A", "cycles/C101/status.md", "## Status", { scope: { project_id: scope.project_id, workspace_id: "A", worktree_id: scope.worktree_id, cycle_id: "C101" } }),
      unit("cycle-B", "cycles/C202/status.md", "## Status", { scope: { project_id: scope.project_id, workspace_id: "B", worktree_id: "synthetic-other-worktree", cycle_id: "C202" } }),
      unit("decision", "decisions/current.md", "## Decision", { requires: [{ id: "invariants", reason: "decision authority ceiling" }] }),
      unit("decision-old", "decisions/old.md", "## Decision", { status: "superseded" }),
      unit("attempt-rule", "attempt-rule.md", "## Integrity"), unit("optional", "optional.md", "## Optional"),
    ];
    adoption.extensions = { ...adoption.extensions, contextUnits: units };
    writeWorkflowAdapterConfig(temporary, { governanceAdoption: adoption });
    let payload = { schema_version: 1, generated_at: "2026-10-02T00:00:00Z", project_context: { ...scope }, target_root: temporary,
      cycles: [{ cycle_id: "C101", state: "IMPLEMENTING" }, { cycle_id: "C202", state: "OPEN" }],
      artifacts: Object.entries(documents).map(([file, content]) => ({ path: file, artifact_id: file, content, content_format: "utf8", sha256: hash(content),
        ...(file.includes("C101") ? { cycle_id: "C101", workspace_id: "A" } : file.includes("C202") ? { cycle_id: "C202", workspace_id: "B" } : {}) })),
      artifact_links: [], session_cycle_links: [], session_links: [], migration_findings: [] };
    const request = (roots, extra = {}) => ({ schemaVersion: 1, purpose: "effective", asOf: "2026-10-02", scope, roots, units, ...extra });
    const index = path.join(temporary, "index.json");
    const writeIndex = () => fs.writeFileSync(index, JSON.stringify(payload));
    writeIndex();
    const store = { readContext: () => ({ exists: true, context_file: null, store: { latest: { "context-reload": { ok: false, decision: "deny", reason_codes: ["synthetic-unresolved-admission"] } }, history: [] } }) };
    const args = { includeArtifacts: true, indexFile: index, backend: "json", maxArtifactBytes: 4096, maxArtifacts: 24,
      bundleTargetBytes: 8192, bundleHardLimitBytes: 65536, historyLimit: 20, skill: "context-reload", contextFile: "", out: "" };
    const hydrate = (req, extra = {}) => runHydrateContextUseCase({ targetRoot: temporary, hookContextStore: store, args: { ...args, contextRequest: req, ...extra } });
    const before = hash(fs.readFileSync(index));
    const scenarios = [
      ["S01-local", request(["local"]), "complete", ["invariants", "local"]],
      ["S02-migration", request(["migration"]), "complete", ["invariants", "dor", "migration"]],
      ["S03-decision", request(["decision"], { optional: ["decision-old"] }), "complete", ["invariants", "decision"]],
      ["S04-hypothesis", request(["hypothesis"]), "blocked", []],
      ["S05-conflict", request(["decision"], { units: [...units, structuredClone(units.find((row) => row.id === "decision"))] }), "blocked", []],
      ["S06-worktrees", request(["cycle-A"], { optional: ["cycle-B"] }), "complete", ["cycle-A"]],
      ["S07-integrity", request(["attempt-rule"]), "complete", ["attempt-rule"]],
      ["S08-late-invariant", request(["invariants"]), "complete", ["invariants"]],
    ];
    report.corpus_sha256 = hash(JSON.stringify({ documents, units, scenarios }));
    // Physical observation pins remain in the run hash above. This second hash
    // identifies the logical corpus across disposable package runs.
    const stableCorpus = (value) => {
      if (Array.isArray(value)) return value.map(stableCorpus);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stableCorpus(item)]));
      if (value === scope.worktree_id) return "<observed-worktree>";
      if (value === scope.runtime_scope_id) return "<observed-runtime-scope>";
      return value;
    };
    report.logical_corpus_sha256 = hash(JSON.stringify(stableCorpus({ documents, units, scenarios })));
    report.implementation_sha256 = Object.fromEntries(["src/application/codex/hydrate-context-use-case.mjs",
      "src/application/codex/scoped-context-selection.mjs", "tools/perf/verify-scoped-context-selection-fixtures.mjs"]
      .map((file) => [file, hash(fs.readFileSync(path.join(root, file)))]));
    stage = "eight-acceptance-scenarios";
    const legacy = await runHydrateContextUseCase({ targetRoot: temporary, hookContextStore: store, args });
    for (const [id, req, status, included] of scenarios) {
      const result = await hydrate(req);
      check(`${id}_status`, result.context_selection.status, status);
      check(`${id}_units`, result.artifacts.map((row) => row.unit_id), included);
      check(`${id}_no_write_authority`, result.context_selection.write_authorization, false);
      check(`${id}_admission_unchanged`, result.decisions, legacy.decisions);
      check(`${id}_complete_json_budget`, result.bundle_budget.total_bytes, Buffer.byteLength(JSON.stringify(result)));
      check(`${id}_no_truncation`, result.artifacts.every((row) => row.content_state === "included"));
      const baselineTimes = [], scopedTimes = [];
      let baselineBytes = 0, scopedBytes = 0;
      for (let sample = 0; sample < 5; sample += 1) {
        const baselineSample = async () => {
          const start = performance.now();
          const current = await runHydrateContextUseCase({ targetRoot: temporary, hookContextStore: store, args });
          baselineTimes.push(performance.now() - start); baselineBytes = Buffer.byteLength(JSON.stringify(current));
          assert.deepEqual(current.decisions, legacy.decisions, `${id}: repeated baseline admission`);
        };
        const scopedSample = async () => {
          const start = performance.now(), current = await hydrate(req);
          scopedTimes.push(performance.now() - start); scopedBytes = Buffer.byteLength(JSON.stringify(current));
          assert.equal(current.context_selection.status, status, `${id}: repeated selection status`);
          assert.deepEqual(current.artifacts.map((row) => row.unit_id), included, `${id}: repeated scope/closure`);
          assert.deepEqual(current.decisions, legacy.decisions, `${id}: repeated admission unchanged`);
          assert.equal(current.bundle_budget.total_bytes, scopedBytes, `${id}: repeated whole JSON count`);
          assert(current.artifacts.every((row) => row.content_state === "included"), `${id}: repeated complete units`);
        };
        if (sample % 2) { await scopedSample(); await baselineSample(); }
        else { await baselineSample(); await scopedSample(); }
      }
      const distribution = (values) => { const sorted = [...values].sort((a, b) => a - b); return {
        min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1) }; };
      report.measurements.push({ scenario: id, scoped_status: status, repetitions: 5, alternating_order: true,
        legacy_complete_json_bytes: baselineBytes, scoped_complete_json_bytes: scopedBytes,
        byte_difference: scopedBytes - baselineBytes, legacy_service_ms: distribution(baselineTimes), scoped_service_ms: distribution(scopedTimes),
        admission_unchanged: true, native_tokens: "UNAVAILABLE", native_context_presented: "UNAVAILABLE" });
    }
    const late = await hydrate(request(["invariants"]));
    check("late_exception_retained_utf8", late.artifacts[0].content_excerpt.includes("Été 😀"));
    check("fenced_heading_does_not_cut_unit", late.artifacts[0].content_excerpt.includes("## Not a heading"));
    check("complete_unit_hash", late.artifacts[0].unit_sha256, hash(late.artifacts[0].content_excerpt));
    check("legacy_still_truncates_prefix_as_baseline", legacy.artifacts.find((row) => row.path === "SPEC.md").content_state, "truncated");
    const historical = await hydrate(request(["hypothesis"], { purpose: "historical" }));
    check("historical_hypothesis_readable", historical.context_selection.status, "complete");
    check("historical_status_preserved", historical.artifacts[0].lifecycle_status, "hypothesis");
    const cross = structuredClone(units);
    cross.find((row) => row.id === "cycle-A").requires = [{ id: "cycle-B", reason: "explicit shared coordination dependency", crossWorkspace: true, crossWorktree: true }];
    adoption.extensions.contextUnits = cross;
    writeWorkflowAdapterConfig(temporary, { governanceAdoption: adoption });
    check("legitimate_cross_worktree_dependency", (await hydrate(request(["cycle-A"], { units: cross }))).artifacts.map((row) => row.unit_id), ["cycle-B", "cycle-A"]);
    cross.find((row) => row.id === "cycle-A").requires[0].crossWorkspace = false;
    writeWorkflowAdapterConfig(temporary, { governanceAdoption: adoption });
    check("cross_worktree_without_binding_refused", (await hydrate(request(["cycle-A"], { units: cross }))).context_selection.status, "blocked");
    cross.find((row) => row.id === "cycle-A").requires[0].crossWorkspace = true;
    cross.find((row) => row.id === "cycle-A").requires[0].crossWorktree = false;
    writeWorkflowAdapterConfig(temporary, { governanceAdoption: adoption });
    check("worktree_dependency_flag_required", (await hydrate(request(["cycle-A"], { units: cross }))).context_selection.errors[0].reason, "worktree_scope_mismatch");
    adoption.extensions.contextUnits = units;
    writeWorkflowAdapterConfig(temporary, { governanceAdoption: adoption });
    stage = "reserved-refusals-and-revision";
    const missing = await hydrate(request(["absent"]));
    check("missing_mandatory_refused", missing.context_selection.errors[0].reason, "mandatory_unavailable");
    check("missing_source_ignores_stale_cache", (await hydrate(request(["local"]), { indexFile: path.join(temporary, "absent.json") })).context_selection.errors[0].reason, "canonical_source_unavailable");
    const mutations = [
      ["source_hash", (u) => { u[0].sourceSha256 = "0".repeat(64); }],
      ["missing_heading", (u) => { u[0].heading = "## Absent"; }],
      ["revoked_unit", (u) => { u[0].status = "revoked"; }],
      ["project_scope", (u) => { u[0].scope.project_id = "another-project"; }],
      ["dependency_cycle", (u) => { u[0].requires = [{ id: "invariants", reason: "cycle must refuse" }]; }],
      ["unsafe_path", (u) => { u[0].path = "../SPEC.md"; }],
    ];
    for (const [name, mutate] of mutations) {
      const changed = structuredClone(units); mutate(changed);
      adoption.extensions.contextUnits = changed;
      writeWorkflowAdapterConfig(temporary, { governanceAdoption: adoption });
      check(`reserved_${name}_refused`, (await hydrate(request(["invariants"], { units: changed }))).context_selection.status, "blocked");
    }
    adoption.extensions.contextUnits = units;
    writeWorkflowAdapterConfig(temporary, { governanceAdoption: adoption });
    const attemptedRemoval = structuredClone(units);
    attemptedRemoval.find((row) => row.id === "local").requires = [];
    check("query_cannot_remove_accepted_obligations", (await hydrate(request(["local"], { units: attemptedRemoval }))).context_selection.errors[0].reason, "unaccepted_unit_binding");
    check("null_request_refused_read_only", (await hydrate(null)).context_selection.errors[0].reason, "invalid_selection_request");
    check("wrong_canonical_scope_refused", (await hydrate(request(["local"], { scope: { ...scope, workspace_id: "B" } }))).context_selection.errors[0].reason, "canonical_scope_mismatch");
    const withOptional = await hydrate(request(["invariants"], { optional: ["optional"] }), { bundleHardLimitBytes: 16384 });
    check("optional_units_removed_whole", withOptional.artifacts.map((row) => row.unit_id), ["invariants"]);
    check("optional_budget_omission_explicit", withOptional.context_selection.omissions.some((row) => row.reason === "optional_budget_omitted"));
    const tooLarge = await hydrate(request(["optional"]), { bundleHardLimitBytes: 8192 });
    check("mandatory_budget_refuses_no_partial", [tooLarge.context_selection.status, tooLarge.artifacts.length], ["blocked", 0]);
    check("budget_refusal_expansion_retained", tooLarge.context_selection.expansions[0].path, "optional.md");
    const big = await hydrate(request(["optional"]));
    for (const delta of [-1, 0, 1]) {
      const limit = big.bundle_budget.total_bytes + delta;
      const bounded = await hydrate(request(["optional"]), { bundleHardLimitBytes: limit });
      check(`whole_payload_boundary_${delta}`, bounded.context_selection.status === "blocked" || bounded.bundle_budget.total_bytes <= limit);
    }
    check("read_inputs_unchanged", hash(fs.readFileSync(index)), before);
    const revision = late.source_revision;
    const observedBackend = selectScopedContext({ payload, request: request(["invariants"]), adoption, backend: "sqlite" });
    check("backend_changes_revision", observedBackend.source_revision !== revision);
    check("read_policy_revision_changes_fingerprint", (await hydrate(request(["invariants"], { accessRevision: "observed-read-policy-r2" }))).source_revision !== revision);
    adoption.extensions = { ...adoption.extensions, authorityRevision: "fixture-only-r2" };
    writeWorkflowAdapterConfig(temporary, { governanceAdoption: adoption });
    check("authority_change_not_hidden_by_cache", (await hydrate(request(["invariants"]))).source_revision !== revision);
    payload.artifacts[0].content += "\nCanonical source changed.\n";
    payload.artifacts[0].sha256 = hash(payload.artifacts[0].content); writeIndex();
    check("changed_source_refuses_stale_request", (await hydrate(request(["invariants"]))).context_selection.errors[0].reason, "source_revision_mismatch");
    payload.artifacts[0].content = documents["SPEC.md"]; payload.artifacts[0].sha256 = hash(payload.artifacts[0].content); writeIndex();
    check("duplicate_heading_refused", completeMarkdownUnit("## Rule\none\n## Rule\ntwo\n", "## Rule"), null);
    stage = "public-cli-and-mode-parity";
    const schema = JSON.parse(fs.readFileSync(path.join(root, "src/core/contracts/cli-output/codex-hydrate-context.v1.schema.json")));
    const requestFile = path.join(temporary, "request.json");
    fs.writeFileSync(requestFile, JSON.stringify(request(["invariants"])));
    function cli(extra, expectedStatus = 0, env = {}) {
      const child = spawnSync(process.execPath, [path.join(root, "tools/codex/hydrate-context.mjs"), "--target", temporary, "--index-file", index,
        "--backend", "json", "--context-selection-file", requestFile, "--json", ...extra], { encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ...env } });
      if (child.status !== expectedStatus) {
        const failure = new Error("Scoped CLI child failed");
        failure.diagnostic = { exit_code: child.status, signal: child.signal, stdout_tail: redactDiagnostic(child.stdout ?? "").slice(-2000), stderr_tail: redactDiagnostic(child.stderr ?? "").slice(-2000) };
        throw failure;
      }
      return child;
    }
    for (const mode of ["files", "dual", "db-only"]) {
      const child = cli([], 0, { AIDN_STATE_MODE: mode });
      const result = JSON.parse(child.stdout.trim());
      check(`${mode}_cli_public_contract`, validateJsonSchema(result, schema).length, 0);
      check(`${mode}_cli_exact_byte_counter`, result.bundle_budget.total_bytes, Buffer.byteLength(child.stdout.trim()));
      check(`${mode}_cli_scope`, result.artifacts.map((row) => row.unit_id), ["invariants"]);
    }
    const sqliteFile = path.join(temporary, "canonical.sqlite");
    const sqlite = createRuntimeArtifactStore({ targetRoot: temporary, backend: "sqlite", sqliteFile });
    await sqlite.writeIndexProjection({ payload });
    const sqliteResult = await hydrate(request(["invariants"]), { backend: "sqlite", indexFile: sqliteFile });
    check("real_sqlite_scope_and_content", sqliteResult.artifacts.map((row) => row.content_excerpt), late.artifacts.map((row) => row.content_excerpt));
    check("real_sqlite_source_backend", sqliteResult.source_backend, "sqlite");
    for (const flag of ["--out", "--materialize-visible-artifacts", "--project-runtime-state"]) check(`cli_refuses_${flag}`, cli([flag, "unused"], 1).status, 1);
    check("cli_no_hidden_bundle_write", !fs.existsSync(path.join(temporary, ".aidn/runtime/context/hydrated-context.json")));
    check("cli_no_visible_projection_write", !fs.existsSync(path.join(temporary, "docs/audit/RUNTIME-STATE.md")));
    fs.appendFileSync(path.join(temporary, "docs/audit/SPEC.md"), "\nLive file changed without index refresh.\n");
    check("files_stale_index_cannot_override_live_rule", (await hydrate(request(["invariants"]))).context_selection.errors[0].reason, "source_revision_mismatch");
    fs.writeFileSync(path.join(temporary, "docs/audit/SPEC.md"), documents["SPEC.md"]);
    check("effect_policy_consultative_read_only", resolveCliEffectClass("aidn codex hydrate-context", ["--context-selection-file", requestFile, "--json"]), "read-only");
    fs.mkdirSync(path.join(temporary, ".aidn"), { recursive: true });
    fs.writeFileSync(path.join(temporary, ".aidn/config.json"), JSON.stringify({ version: 1, runtime: { persistence: { backend: "postgres", connectionRef: "fixture-unavailable" } } }));
    let backendConflict = false;
    try { await hydrate(request(["invariants"])); } catch (error) { backendConflict = error.message.includes("canonical PostgreSQL"); }
    check("configured_postgres_refuses_local_override", backendConflict);
    report.observations = { legacy_complete_json_bytes: Buffer.byteLength(JSON.stringify(legacy)), consulted_complete_json_bytes: late.bundle_budget.total_bytes,
      bytes_are_fixture_measurements: true, native_tokens: "UNAVAILABLE", canonical_revision: "observed snapshot fingerprint; not an authorization or database publication revision" };
    report.status = "PASS";
  } catch (error) {
    report.failure = { stage, message: error.message, child: error.diagnostic ?? null };
  } finally {
    const cleanup = temporary ? removePathWithRetry(temporary) : null;
    report.cleanup = { temporary_root_removed: Boolean(cleanup?.ok), attempts: cleanup?.attempts ?? 0 };
    if (temporary && !cleanup?.ok) report.status = "FAIL";
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "PASS") process.exitCode = 1;
}

await main();
