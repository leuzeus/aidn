import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prepareActivationFixture } from "./test-activation-fixture-lib.mjs";
import { runPromoteBaselineAdmitUseCase } from "../../src/application/runtime/promote-baseline-admit-use-case.mjs";
import { createRuntimeArtifactStore, resolveRuntimeSqliteFile } from "../../src/application/runtime/runtime-persistence-service.mjs";
import { loadSharedStateSnapshot } from "../../src/application/runtime/shared-state-backend-service.mjs";
import { createRuntimePersistenceFakePgClientFactory } from "./runtime-persistence-fake-pg-lib.mjs";
import { createTrackedFixtureFilter, initGitRepo, removePathWithRetry } from "./test-git-fixture-lib.mjs";
const sha = value => createHash("sha256").update(value).digest("hex");
export async function verifyCanonicalBaselinePromotion() {
  const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, "aidn-promote-canonical-")), checks = [];
  const write = (name, text) => { const p = path.join(root, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  const configure = (backend, mode = "db-only") => write(".aidn/config.json", JSON.stringify({ runtime: { stateMode: mode, persistence: { backend, connectionRef: "env:AIDN_PROMOTION_FIXTURE_PG" } } }));
  const check = async (name, fn) => { await fn(); checks.push({ id: name, pass: true }); };
  try {
    const source = path.resolve("tests/fixtures/perf-handoff/ready");
    fs.cpSync(source, root, { recursive: true, filter: createTrackedFixtureFilter(source) });
    initGitRepo(root, { workingBranch: "feature/C101-alpha" });
    JSON.parse(execFileSync(process.execPath, ["tools/perf/index-sync.mjs", "--target", root, "--store", "sqlite", "--with-content", "--json"], { encoding: "utf8", windowsHide: true }));
    const original = loadSharedStateSnapshot({ targetRoot: root }).payload, payload = structuredClone(original);
    const edit = (data, pattern, fn) => { const a = data.artifacts.find(row => pattern.test(row.path)); assert.ok(a); a.content = fn(a.content); a.sha256 = sha(a.content); };
    const statusPattern = /cycles\/C101[^/]*\/status\.md$/;
    payload.cycles.find(row => row.cycle_id === "C101").state = "DONE";
    edit(payload, statusPattern, text => text.replace("state: IMPLEMENTING", "state: DONE"));
    edit(payload, /CURRENT-STATE\.md$/, text => text.replace(/active_cycle:.*$/m, "active_cycle: none"));
    const traceText = "# Traceability\n\n| REQ | TEST | Evidence |\n| REQ-001 | TEST-001 | fixture |\n";
    const tracePath = payload.artifacts.find(row => statusPattern.test(row.path)).path.replace("status.md", "traceability.md");
    payload.artifacts = payload.artifacts.filter(row => row.path !== tracePath);
    payload.artifacts.push({ path: tracePath, kind: "other", family: "normative", content_format: "utf8", content: traceText, sha256: sha(traceText), cycle_id: "C101", session_id: "S101" });
    const fake = createRuntimePersistenceFakePgClientFactory(), options = { connectionString: "postgres://fixture/promotion", clientFactory: fake.factory };
    const sqlite = createRuntimeArtifactStore({ targetRoot: root, backend: "sqlite" });
    const pg = createRuntimeArtifactStore({ targetRoot: root, backend: "postgres", ...options });
    const admit = extra => runPromoteBaselineAdmitUseCase({ targetRoot: root, mode: "COMMITTING", persistenceOptions: options, ...extra });
    for (const name of ["CURRENT-STATE.md", "cycles/C101-feature-alpha/status.md", "cycles/C101-feature-alpha/traceability.md"])
      write("docs/audit/" + name, "# Stale visible projection\nactive_session: none\nactive_cycle: C999\nstate: IMPLEMENTING\n");
    const visible = ["CURRENT-STATE.md", "cycles/C101-feature-alpha/status.md", "cycles/C101-feature-alpha/traceability.md"].map(name => [name, sha(fs.readFileSync(path.join(root, "docs/audit", name)))]);
    for (const mode of ["db-only", "dual"]) await check(`sqlite_${mode}_uses_canonical_done_and_traceability`, async () => {
      configure("sqlite", mode); await sqlite.writeIndexProjection({ payload });
      const file = resolveRuntimeSqliteFile({ targetRoot: root }), before = sha(fs.readFileSync(file));
      const result = await admit(); assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.target_cycle.cycle_id, "C101");
      assert.equal(sha(fs.readFileSync(file)), before);
    });
    await check("postgres_uses_one_canonical_snapshot_despite_visible_files", async () => {
      configure("postgres"); await pg.writeIndexProjection({ payload });
      const result = await admit(); assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.target_cycle.cycle_id, "C101");
    });
    await check("configured_postgres_remains_canonical_in_files_mode", async () => {
      configure("postgres", "files"); await pg.writeIndexProjection({ payload });
      assert.equal((await admit()).ok, true); configure("postgres");
    });
    await check("unavailable_postgres_never_falls_back_to_valid_sqlite", async () => {
      const result = await admit({ persistenceOptions: { ...options, clientFactory: () => { throw Error("fixture unavailable"); } } });
      assert.equal(result.ok, false); assert.equal(result.reason_code, "PROMOTE_BASELINE_CANONICAL_RUNTIME_INVALID");
    });
    await check("canonical_no_go_is_not_promoted", async () => {
      const data = structuredClone(payload); data.cycles.find(row => row.cycle_id === "C101").state = "NO_GO";
      edit(data, statusPattern, text => text.replace("state: DONE", "state: NO_GO")); await pg.writeIndexProjection({ payload: data });
      const result = await admit({ cycleId: "C101" }); assert.equal(result.ok, false); assert.equal(result.reason_code, "PROMOTE_BASELINE_CYCLE_NOT_DONE");
    });
    await check("explicit_selection_resolves_multiple_done_without_mutating_focus", async () => {
      const data = structuredClone(payload), first = data.artifacts.find(row => statusPattern.test(row.path));
      data.artifacts.push({ ...first, path: first.path.replaceAll("C101", "C102"), cycle_id: "C102", content: first.content.replaceAll("C101", "C102"), sha256: sha(first.content.replaceAll("C101", "C102")) });
      const c = data.cycles.find(row => row.cycle_id === "C101"); data.cycles.push({ ...c, cycle_id: "C102", branch_name: c.branch_name.replaceAll("C101", "C102"), source_artifact_path: c.source_artifact_path?.replaceAll("C101", "C102") });
      await pg.writeIndexProjection({ payload: data }); assert.equal((await admit()).action, "choose_cycle");
      const result = await admit({ cycleId: "C101" }); assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.active_cycle, "none");
    });
    for (const [name, mutate] of [
      ["duplicate_cycle", data => data.artifacts.push({ ...data.artifacts.find(row => statusPattern.test(row.path)), path: "cycles/C101-other/status.md" })],
      ["missing_current", data => { data.artifacts = data.artifacts.filter(row => !/CURRENT-STATE\.md$/.test(row.path)); }],
      ["foreign_cycle_owner", data => edit(data, statusPattern, text => text.replace("session_owner: S101", "session_owner: S999"))],
    ]) await check(name + "_fails_closed", async () => { const data = structuredClone(payload); mutate(data); await pg.writeIndexProjection({ payload: data }); assert.equal((await admit()).reason_code, "PROMOTE_BASELINE_CANONICAL_RUNTIME_INVALID"); });
    await check("missing_canonical_trace_cannot_use_a_visible_projection", async () => {
      const data = structuredClone(payload); data.artifacts = data.artifacts.filter(row => !/cycles\/C101[^/]*\/traceability\.md$/.test(row.path));
      await pg.writeIndexProjection({ payload: data }); assert.equal((await admit()).reason_code, "PROMOTE_BASELINE_TRACEABILITY_INCOMPLETE");
    });
    await check("canonical_open_gap_blocks_a_favorable_visible_projection", async () => {
      const data = structuredClone(payload), name = tracePath.replace("traceability.md", "gap-report.md"), text = "# Gaps\n- Status: open\n";
      data.artifacts = data.artifacts.filter(row => row.path !== name); data.artifacts.push({ path: name, kind: "other", family: "normative", content_format: "utf8", content: text, sha256: sha(text) });
      await pg.writeIndexProjection({ payload: data }); assert.equal((await admit()).reason_code, "PROMOTE_BASELINE_OPEN_GAPS");
    });
    await check("canonical_shared_usage_requires_verified_evidence", async () => {
      const data = structuredClone(payload); edit(data, statusPattern, text => text + "\nusage_matrix_scope: shared\nusage_matrix_state: NOT_DEFINED\n");
      await pg.writeIndexProjection({ payload: data }); assert.equal((await admit()).reason_code, "PROMOTE_BASELINE_USAGE_MATRIX_INCOMPLETE");
    });
    await check("invalid_and_missing_explicit_targets_cannot_fall_back_to_another_done_cycle", async () => {
      await pg.writeIndexProjection({ payload });
      for (const cycleId of ["", " ", "../C101"]) assert.equal((await admit({ cycleId })).reason_code, "PROMOTE_BASELINE_TARGET_CYCLE_INVALID");
      assert.equal((await admit({ cycleId: "C999" })).reason_code, "PROMOTE_BASELINE_TARGET_CYCLE_MISSING");
    });
    await check("missing_canonical_sqlite_is_not_bootstrapped_by_admission", async () => {
      configure("sqlite"); await sqlite.writeIndexProjection({ payload });
      const file = resolveRuntimeSqliteFile({ targetRoot: root }), backup = file + ".fixture-save";
      assert.ok(path.resolve(file).startsWith(path.resolve(root) + path.sep)); fs.renameSync(file, backup);
      try { assert.equal((await admit()).reason_code, "PROMOTE_BASELINE_CANONICAL_RUNTIME_INVALID"); assert.equal(fs.existsSync(file), false); }
      finally { fs.renameSync(backup, file); }
    });
    await check("actual_wrapper_refusal_never_imports_stale_projections", async () => {
      configure("sqlite", "dual"); prepareActivationFixture(root);
      const data = structuredClone(payload); data.cycles.find(row => row.cycle_id === "C101").state = "NO_GO";
      edit(data, statusPattern, text => text.replace("state: DONE", "state: NO_GO"));
      edit(data, /CURRENT-STATE\.md$/, text => text.replace(/active_cycle:.*$/m, "active_cycle: C101")); await sqlite.writeIndexProjection({ payload: data });
      const file = resolveRuntimeSqliteFile({ targetRoot: root }), before = sha(fs.readFileSync(file));
      for (const [skill, flags] of [["promote-baseline", []], ["aidn-promote-baseline", ["--db-sync"]]]) {
        let result;
        try { result = JSON.parse(execFileSync(process.execPath, ["tools/codex/run-json-hook.mjs", "--target", root, "--skill", skill, "--mode", "COMMITTING", "--json", ...flags], { encoding: "utf8", windowsHide: true, stdio: "pipe" })); }
        catch (cause) { assert.ok(cause.stdout); result = JSON.parse(String(cause.stdout)); }
        assert.equal(result.action, "blocked_cycle_not_done", JSON.stringify(result)); assert.equal(result.reason_code, "PROMOTE_BASELINE_CYCLE_NOT_DONE");
        assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.db_sync.skipped, true); assert.equal(result.db_sync.reason, "baseline_promotion_not_completed");
        assert.equal(sha(fs.readFileSync(file)), before);
      }
    });
    await check("files_keep_visible_authority_and_every_read_preserves_projections", async () => {
      configure("sqlite", "files"); assert.equal((await admit()).ok, false);
      for (const [name, hash] of visible) assert.equal(sha(fs.readFileSync(path.join(root, "docs/audit", name))), hash);
    });
    return checks;
  } finally {
    const resolved = fs.realpathSync(root); assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith("aidn-promote-canonical-"));
    assert.equal(removePathWithRetry(resolved).ok, true);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checks = await verifyCanonicalBaselinePromotion();
  for (const c of checks) console.log("PASS " + c.id);
  console.log(JSON.stringify({ status: "PASS", checks: checks.length, proof: "canonical-promotion-admission", actual_promotion: "NOT_RUN", postgres_transport: "fixture", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
}
