#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createArtifactStore } from "../../src/adapters/runtime/artifact-store.mjs";
import { buildCheckpointSummary } from "../../src/core/workflow/workflow-output-factory.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

// The real CLI and persistence/continuity routing run against an injected
// PostgreSQL artifact-store boundary. This is fixture evidence, not live
// PostgreSQL or native execution qualification.
const repoRoot = path.resolve(import.meta.dirname, "../..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-gating-source-"));
const checks = [];
const objective = "deliver the selected fixture change";
const unrelated = "replace the unrelated billing system";
const sha = value => createHash("sha256").update(value).digest("hex");
const env = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => !/^(?:GIT_|AIDN_)|^NODE_OPTIONS$/i.test(key)));
env.GIT_OPTIONAL_LOCKS = "0";
let sequence = 0;

function put(root, relative, value) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  return file;
}

function git(root, args) {
  const child = spawnSync("git", ["-C", root, "-c", "user.name=aidn-fixture",
    "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgSign=false",
    "-c", `core.hooksPath=${path.join(tempRoot, "no-hooks")}`, ...args],
  { env, encoding: "utf8", windowsHide: true, timeout: 15000 });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
  return child.stdout;
}

function current(sessionId = "S1", cycleId = "C1") {
  return `# Current State\nmode: THINKING\nbranch_kind: cycle\nactive_session: ${sessionId}\nactive_cycle: ${cycleId}\n`;
}

function session(id = "S1", value = objective, state = "OPEN") {
  return `# Session ${id}\nsession_id: ${id}\nstate: ${state}\nmode: THINKING\nsession_branch: ${id}-fixture\nbranch_kind: session\nsession_objective: ${value}\n`;
}

function cycle(id = "C1", owner = "S1", goal = objective, state = "OPEN") {
  return `# Cycle ${id}\ncycle_id: ${id}\nstate: ${state}\nbranch_name: feature/${id}-fixture\nsession_owner: ${owner}\n${goal === null ? "" : `current_goal: ${goal}\n`}`;
}

function artifact(name, content, id) {
  return { path: name, content, content_format: "utf8", sha256: sha(content), artifact_id: id };
}

function snapshot({ sessionObjective = objective, cycleGoal = objective,
  sessionId = "S1", cycleId = "C1", currentPath = "CURRENT-STATE.md" } = {}) {
  const artifacts = [artifact(currentPath, current(sessionId, cycleId), 1),
    artifact(`sessions/${sessionId}.md`, session(sessionId, sessionObjective), 2),
    artifact(`cycles/${cycleId}-fixture/status.md`, cycle(cycleId, sessionId, cycleGoal), 3)];
  return { exists: true, payload: { artifacts,
    sessions: [{ session_id: sessionId, state: "OPEN", branch_name: `${sessionId}-fixture`,
      source_artifact_path: artifacts[1].path }],
    cycles: [{ cycle_id: cycleId, session_id: sessionId, state: "OPEN",
      branch_name: `feature/${cycleId}-fixture`, source_artifact_path: artifacts[2].path }],
    migration_findings: [] },
  runtimeHeads: { current_state: { head_key: "current_state", artifact_path: currentPath,
    artifact_id: 1, artifact_sha256: artifacts[0].sha256 } } };
}

function checkoutSnapshot(root) {
  const entries = [];
  function visit(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      if (directory === root && item.name === ".git") continue;
      const file = path.join(directory, item.name);
      const relative = path.relative(root, file).replaceAll("\\", "/");
      const mode = fs.lstatSync(file).mode;
      if (item.isSymbolicLink()) entries.push([relative, "link", fs.readlinkSync(file), mode]);
      else if (item.isDirectory()) { entries.push([relative, "directory", mode]); visit(file); }
      else entries.push([relative, "file", sha(fs.readFileSync(file)), mode]);
    }
  }
  visit(root);
  return { entries, index: sha(fs.readFileSync(path.join(root, ".git/index"))),
    head: git(root, ["rev-parse", "HEAD"]).trim(),
    status: git(root, ["status", "--porcelain=v1", "--untracked-files=all"]) };
}

const boundaryFile = put(tempRoot, "postgres-boundary.mjs", `
import fs from "node:fs";
export function createPostgresRuntimeArtifactStore(options = {}) {
  return {
    describeBackend() { return { backend_kind: "postgres", connection_ref: options.connectionRef || null }; },
    async loadSnapshot(snapshotOptions = {}) {
      fs.appendFileSync(process.env.AIDN_TEST_GATING_READ_LOG, JSON.stringify({
        options: snapshotOptions, backend: "postgres", target: options.targetRoot,
      }) + "\\n");
      const value = JSON.parse(fs.readFileSync(process.env.AIDN_TEST_GATING_SNAPSHOT, "utf8"));
      if (value.error) {
        const error = new Error(value.error.message); if (value.error.code) error.code = value.error.code;
        throw error;
      }
      return value.snapshot;
    },
  };
}
`);
const loaderFile = put(tempRoot, "loader.mjs", `
const production = ${JSON.stringify(pathToFileURL(path.join(repoRoot, "src/adapters/runtime/postgres-runtime-artifact-store.mjs")).href)};
const boundary = ${JSON.stringify(pathToFileURL(boundaryFile).href)};
export async function resolve(specifier, context, next) {
  const result = await next(specifier, context);
  return result.url === production ? { url: boundary, shortCircuit: true } : result;
}
`);
const preloadFile = put(tempRoot, "preload.mjs", `import { register } from "node:module"; register(${JSON.stringify(pathToFileURL(loaderFile).href)}, import.meta.url);\n`);
const collectDriver = put(tempRoot, "collect-driver.mjs", `
import fs from "node:fs";
import { collectGatingObservations } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, "src/application/runtime/gating-observation-service.mjs")).href)};
import { createLocalGitAdapter } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, "src/adapters/runtime/local-git-adapter.mjs")).href)};
const input = JSON.parse(fs.readFileSync(process.env.AIDN_TEST_GATING_COLLECT, "utf8"));
const observations = [];
for (const value of input.sequence) {
  fs.writeFileSync(process.env.AIDN_TEST_GATING_SNAPSHOT, JSON.stringify(value));
  observations.push(await collectGatingObservations({ ...input.options, gitAdapter: createLocalGitAdapter() }));
}
console.log(JSON.stringify(observations));
`);

function fixture(name, { stateMode = "db-only", backend = "postgres", visible = true,
  visibleObjective = objective, visibleGoal = objective, data = snapshot() } = {}) {
  const directory = `${String(++sequence).padStart(2, "0")}-${name}`;
  const root = path.join(tempRoot, directory, "repo");
  const control = path.join(tempRoot, directory, "control");
  fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(control);
  put(root, "fixture.txt", "neutral fixture\n");
  put(root, ".aidn/config.json", { version: 1, runtime: { stateMode,
    persistence: { backend, connectionRef: "env:AIDN_TEST_GATING_NEVER_CONNECT" } } });
  if (visible) {
    put(root, "docs/audit/CURRENT-STATE.md", current());
    put(root, "docs/audit/sessions/S1.md", session("S1", visibleObjective));
    put(root, "docs/audit/cycles/C1-fixture/status.md", cycle("C1", "S1", visibleGoal));
  }
  const snapshotFile = put(control, "snapshot.json", { snapshot: data });
  const logFile = put(control, "reads.ndjson", "");
  git(root, ["init", "--quiet", "--initial-branch=main"]);
  git(root, ["add", "."]); git(root, ["commit", "--quiet", "-m", "fixture"]);
  return { root, control, snapshotFile, logFile, stateMode };
}

function invoke(f, { args = [], environment = {}, driverInput = null } = {}) {
  put(f.control, "reads.ndjson", "");
  const before = checkoutSnapshot(f.root);
  const command = driverInput ? [collectDriver] : [path.join(repoRoot, "tools/perf/gating-evaluate.mjs"),
    "--target", f.root, "--state-mode", f.stateMode, "--index-backend", "auto",
    "--mode", "THINKING", "--reload-decision", "full", "--reload-fallback", "false",
    "--reload-reason-codes", "", "--no-emit-event", "--json", ...args];
  const collectFile = driverInput ? put(f.control, "collect.json", driverInput) : "";
  const child = spawnSync(process.execPath, ["--import", pathToFileURL(preloadFile).href, ...command],
  { cwd: repoRoot, env: { ...env, AIDN_STATE_MODE: "", AIDN_INDEX_STORE_MODE: "",
    AIDN_TEST_GATING_SNAPSHOT: f.snapshotFile, AIDN_TEST_GATING_READ_LOG: f.logFile,
    AIDN_TEST_GATING_COLLECT: collectFile, ...environment }, encoding: "utf8",
    windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(child.error, undefined, child.error?.message);
  assert.deepEqual(checkoutSnapshot(f.root), before, "gating changed checkout bytes, Git index, HEAD or status");
  const reads = fs.readFileSync(f.logFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  let payload = null;
  try { payload = JSON.parse(child.stdout); } catch { /* Unknown errors must retain their CLI diagnostics. */ }
  return { child, payload, reads };
}

function successful(result, expected = "ok") {
  assert.equal(result.child.status, 0, result.child.stderr);
  assert(result.payload && !Array.isArray(result.payload), "CLI must emit one JSON result");
  assert.equal(result.payload.result, expected);
  assert.equal(result.payload.ok, expected === "ok");
  return result.payload;
}

function canonicalReadOnce(result) {
  assert.equal(result.reads.length, 1, "each observation must read the canonical snapshot exactly once");
  assert.equal(result.reads[0].backend, "postgres");
  assert.equal(result.reads[0].options.includePayload, true);
  assert.equal(result.reads[0].options.includeRuntimeHeads, true, "canonical intent needs runtime heads");
}

function stopped(result, reason) {
  const payload = successful(result, "stop");
  assert.equal(payload.reason_code, "L3_BLOCKING");
  assert.equal(payload.levels.level1.decision, "stop");
  assert(payload.levels.level1.reason_codes.includes(reason), JSON.stringify(payload.levels.level1.reason_codes));
  assert.equal(payload.levels.level3.reason, "blocking_l1_reason");
  canonicalReadOnce(result);
}

function check(name, action) {
  try { action(); checks.push({ name, status: "PASS" }); }
  catch (error) { checks.push({ name, status: "FAIL", message: String(error.message).slice(0, 1600) }); }
}

function collectOptions(f, extra = {}) {
  return { targetRoot: f.root, eventFile: path.join(f.root, ".aidn/runtime/perf/events.ndjson"),
    indexSyncCheckFile: path.join(f.root, ".aidn/runtime/index/check.json"),
    indexFile: path.join(f.root, ".aidn/runtime/index/workflow-index.sqlite"),
    indexBackend: "postgres", stateMode: f.stateMode, mode: "THINKING",
    reloadResult: { decision: "full", fallback: false, reason_codes: [] }, ...extra };
}

let cleanup = false;
try {
  for (const mode of ["files", "dual", "db-only"]) {
    check(`postgres_${mode}_canonical_agreement_prevents_false_warning`, () => {
      const f = fixture("agreement", { stateMode: mode, visibleObjective: unrelated });
      const result = invoke(f); const payload = successful(result);
      assert.deepEqual(payload.levels.level2.active_signals, []); canonicalReadOnce(result);
    });
    check(`postgres_${mode}_canonical_disagreement_prevents_false_ok`, () => {
      const f = fixture("disagreement", { stateMode: mode, data: snapshot({ sessionObjective: unrelated }) });
      const result = invoke(f); const payload = successful(result, "warn");
      assert.deepEqual(payload.levels.level2.active_signals, ["objective_delta"]); canonicalReadOnce(result);
    });
  }
  for (const mode of ["files", "db-only"]) check(`postgres_${mode}_without_visible_audit`, () => {
    const f = fixture("fileless", { stateMode: mode, visible: false });
    const result = invoke(f); successful(result); canonicalReadOnce(result);
    assert(!fs.existsSync(path.join(f.root, "docs/audit")), "gating materialized visible audit files");
  });
  for (const [name, data] of [["unknown_objective", snapshot({ sessionObjective: "unknown" })],
    ["empty_objective", snapshot({ sessionObjective: "" })],
    ["missing_goal", snapshot({ cycleGoal: null })],
    ["empty_goal", snapshot({ cycleGoal: "" })],
    ["unknown_goal", snapshot({ cycleGoal: "unknown" })]]) check(`postgres_${name}_cannot_use_visible_intent`, () => {
    const f = fixture(name, { data }); const result = invoke(f); const payload = successful(result, "warn");
    assert(payload.levels.level2.active_signals.includes("uncertain_intent")); canonicalReadOnce(result);
  });
  for (const [name, alter, reason] of [
    ["missing_session_artifact", data => data.payload.artifacts.splice(1, 1), "REQUIRED_ARTIFACT_MISSING"],
    ["missing_cycle_artifact", data => data.payload.artifacts.splice(2, 1), "REQUIRED_ARTIFACT_MISSING"],
    ["missing_current_artifact", data => data.payload.artifacts.shift(), "MAPPING_MISSING"],
    ["duplicate_session_id", data => data.payload.sessions.push({ ...data.payload.sessions[0] }), "MAPPING_AMBIGUOUS"],
    ["duplicate_cycle_id", data => data.payload.cycles.push({ ...data.payload.cycles[0] }), "MAPPING_AMBIGUOUS"],
    ["duplicate_session_artifact", data => data.payload.artifacts.push(artifact("sessions/S1-copy.md", session(), 4)), "MAPPING_AMBIGUOUS"],
    ["duplicate_cycle_artifact", data => data.payload.artifacts.push(artifact("cycles/C1-copy/status.md", cycle(), 4)), "MAPPING_AMBIGUOUS"],
    ["head_id_mismatch", data => { data.runtimeHeads.current_state.artifact_id = 99; }, "MAPPING_MISSING"],
    ["head_hash_mismatch", data => { data.runtimeHeads.current_state.artifact_sha256 = "invalid"; }, "MAPPING_MISSING"],
    ["head_path_missing", data => { data.runtimeHeads.current_state.artifact_path = "history/missing.md"; }, "MAPPING_MISSING"],
    ["head_path_ambiguous", data => data.payload.artifacts.push({ ...data.payload.artifacts[0], artifact_id: 4 }), "MAPPING_MISSING"],
  ]) check(`postgres_${name}_fails_closed`, () => {
    const data = snapshot(); alter(data); const f = fixture(name, { data }); stopped(invoke(f), reason);
  });
  check("postgres_exact_S1_and_S10_selection", () => {
    const data = snapshot();
    data.payload.sessions.unshift({ session_id: "S10", state: "OPEN", branch_name: "S10-fixture", source_artifact_path: "sessions/S10.md" });
    data.payload.artifacts.unshift(artifact("sessions/S10.md", session("S10", unrelated), 4));
    const f = fixture("exact-session", { data });
    git(f.root, ["checkout", "--quiet", "-b", "S1-fixture"]);
    const result = invoke(f); successful(result); canonicalReadOnce(result);
    assert.equal(result.payload.branch, "S1-fixture");
  });
  check("postgres_exact_C1_and_C10_selection", () => {
    const data = snapshot();
    data.payload.cycles.unshift({ cycle_id: "C10", session_id: "S1", state: "OPEN",
      branch_name: "feature/C10-fixture", source_artifact_path: "cycles/C10-fixture/status.md" });
    data.payload.artifacts.unshift(artifact("cycles/C10-fixture/status.md", cycle("C10", "S1", unrelated), 4));
    const f = fixture("exact-cycle", { data });
    git(f.root, ["checkout", "--quiet", "-b", "feature/C1-fixture"]);
    const result = invoke(f); successful(result); canonicalReadOnce(result);
    assert.equal(result.payload.branch, "feature/C1-fixture");
  });
  check("postgres_multiple_active_cycles_require_arbitration", () => {
    const data = snapshot();
    data.payload.artifacts[0] = artifact("CURRENT-STATE.md", current("S1", "none"), 1);
    data.runtimeHeads.current_state.artifact_sha256 = data.payload.artifacts[0].sha256;
    data.payload.artifacts.push(artifact("cycles/C10-fixture/status.md", cycle("C10"), 4));
    data.payload.cycles.push({ cycle_id: "C10", session_id: "S1", state: "OPEN",
      branch_name: "feature/C10-fixture", source_artifact_path: "cycles/C10-fixture/status.md" });
    const f = fixture("ambiguous-active-cycles", { data }); stopped(invoke(f), "MAPPING_AMBIGUOUS");
  });
  check("postgres_selected_head_precedes_historical_current_state", () => {
    const data = snapshot({ currentPath: "history/selected-current.md" });
    data.payload.artifacts.unshift(artifact("CURRENT-STATE.md", current("S10", "C10"), 4));
    const f = fixture("selected-head", { data }); const result = invoke(f); successful(result); canonicalReadOnce(result);
  });
  check("postgres_outage_refuses_visible_fallback", () => {
    const f = fixture("outage"); put(f.control, "snapshot.json", { snapshot: { exists: false, payload: null, warning: "canonical backend unavailable" } });
    const result = invoke(f); stopped(result, "REQUIRED_ARTIFACT_MISSING");
    assert.equal(result.payload.summary.repair_layer_status, null);
    assert.equal(result.payload.summary.repair_layer_advice, null);
    assert.equal(result.payload.summary.repair_primary_reason, null);
    // The checkpoint consumes this actual gating result without mistaking its
    // compatibility count/bool defaults for a measured clean repair layer.
    const checkpointSummary = buildCheckpointSummary({ gate: result.payload });
    assert.equal(checkpointSummary.result, "stop");
    assert.equal(checkpointSummary.repair_layer_status, null);
    assert.equal(checkpointSummary.repair_layer_advice, null);
    assert.equal(checkpointSummary.repair_primary_reason, null);
  });
  check("postgres_unknown_error_propagates", () => {
    const f = fixture("unknown-error"); put(f.control, "snapshot.json", { error: { code: "FIXTURE_UNKNOWN", message: "FIXTURE_UNKNOWN_GATING_ERROR" } });
    const result = invoke(f); assert.equal(result.child.status, 1);
    assert.match(result.child.stderr, /FIXTURE_UNKNOWN_GATING_ERROR/); assert.equal(result.payload, null);
    assert.equal(result.reads.length, 1);
  });
  check("postgres_configuration_overrides_conflicting_runtime_environment", () => {
    const f = fixture("conflicting-environment", { stateMode: "files", visibleObjective: unrelated });
    const result = invoke(f, { environment: { AIDN_RUNTIME_PERSISTENCE_BACKEND: "sqlite", AIDN_INDEX_STORE_MODE: "json" } });
    successful(result); canonicalReadOnce(result);
  });
  check("postgres_explicit_incompatible_backend_hint_refuses_before_read", () => {
    const f = fixture("conflicting-backend"); const result = invoke(f, { args: ["--index-backend", "sqlite"] });
    assert.equal(result.child.status, 1); assert.match(result.child.stderr, /conflicts with canonical PostgreSQL/);
    assert.equal(result.reads.length, 0);
  });
  check("postgres_no_change_preserves_signal_suppression", () => {
    const f = fixture("no-change", { data: snapshot({ sessionObjective: unrelated }) });
    const result = invoke(f, { args: ["--reload-decision", "incremental"] });
    assert.deepEqual(successful(result).levels.level2.active_signals, []); canonicalReadOnce(result);
  });
  check("postgres_no_change_still_refuses_unavailable_authority", () => {
    const f = fixture("no-change-outage", { data: { exists: false, payload: null } });
    stopped(invoke(f, { args: ["--reload-decision", "incremental"] }), "REQUIRED_ARTIFACT_MISSING");
  });
  for (const severity of ["warning", "error"]) check(`postgres_${severity}_repair_findings_share_one_canonical_snapshot`, () => {
    const data = snapshot(); data.payload.migration_findings.push({ severity, finding_type: "FIXTURE_REPAIR", message: "fixture repair finding" });
    const f = fixture("repair", { data }); const result = invoke(f);
    const payload = successful(result, severity === "error" ? "stop" : "warn");
    assert.equal(payload.levels.level2.repair_layer_open_count, 1);
    if (severity === "error") assert.equal(payload.reason_code, "L3_REPAIR_FINDINGS");
    assert(payload.levels.level2.active_signals.includes("repair_findings_open")); canonicalReadOnce(result);
  });
  check("postgres_empty_context_reads_once_without_visible_fallback", () => {
    const f = fixture("empty", { data: { exists: true, payload: { artifacts: [], sessions: [], cycles: [], migration_findings: [] }, runtimeHeads: {} } });
    const result = invoke(f); const payload = successful(result, "warn");
    assert(payload.levels.level2.active_signals.includes("uncertain_intent")); canonicalReadOnce(result);
    assert.equal(payload.summary.repair_layer_status, "clean");
    assert.equal(payload.summary.repair_layer_advice, "Repair layer is clean.");
    assert.equal(buildCheckpointSummary({ gate: payload }).repair_layer_status, "clean");
  });
  check("postgres_snapshot_is_fresh_on_the_next_collect", () => {
    const f = fixture("freshness"); const result = invoke(f, { driverInput: {
      options: collectOptions(f), sequence: [{ snapshot: snapshot() }, { snapshot: snapshot({ sessionObjective: unrelated }) }],
    } });
    assert.equal(result.child.status, 0, result.child.stderr);
    assert.equal(result.payload[0].sessionObjective, objective); assert.equal(result.payload[1].sessionObjective, unrelated);
    assert.equal(result.payload[0].cycleGoal, objective); assert.equal(result.payload[1].cycleGoal, objective);
    assert.equal(result.reads.length, 2, "each fresh collection must perform one new snapshot read");
  });
  check("postgres_completion_context_keeps_terminal_cycle_intent", () => {
    const data = snapshot(); data.payload.artifacts[2] = artifact("cycles/C1-fixture/status.md", cycle("C1", "S1", objective, "DONE"), 3);
    data.payload.cycles[0].state = "DONE";
    // A competing active cycle with a different intent must not replace the
    // terminal cycle that completion admission already selected.
    data.payload.artifacts.unshift(artifact("cycles/C10-fixture/status.md", cycle("C10", "S1", unrelated), 4));
    data.payload.cycles.unshift({ cycle_id: "C10", session_id: "S1", state: "OPEN",
      branch_name: "feature/C10-fixture", source_artifact_path: "cycles/C10-fixture/status.md" });
    const f = fixture("completion", { data }); const result = invoke(f, { driverInput: {
      options: collectOptions(f, { completionContext: { cycle_id: "C1", cycle_dir: "C1-fixture", session_id: "S1", state: "DONE" } }),
      sequence: [{ snapshot: data }],
    } });
    assert.equal(result.child.status, 0, result.child.stderr);
    assert.equal(result.payload[0].sessionObjective, objective); assert.equal(result.payload[0].cycleGoal, objective);
    canonicalReadOnce(result);
  });
  check("files_mode_keeps_checkout_intent_without_loading_postgres", () => {
    const f = fixture("files-local", { stateMode: "files", backend: "sqlite", visibleObjective: unrelated });
    const result = invoke(f); const payload = successful(result, "warn");
    assert.deepEqual(payload.levels.level2.active_signals, ["objective_delta"]);
    assert.equal(result.reads.length, 0);
  });
  for (const mode of ["dual", "db-only"]) check(mode === "dual"
    ? "sqlite_dual_preserves_checkout_intent_with_custom_index"
    : "sqlite_db_only_honors_custom_canonical_index", () => {
    const f = fixture("custom-sqlite", { stateMode: mode, backend: "sqlite", visibleObjective: unrelated });
    const indexFile = path.join(f.root, "custom/canonical.sqlite");
    const store = createArtifactStore({ sqliteFile: indexFile });
    try { for (const row of snapshot().payload.artifacts) store.upsertArtifact({
      ...row, kind: row.path.startsWith("sessions/") ? "session" : "other", family: "normative",
    }); } finally { store.close(); }
    // A divergent default index proves that the explicitly selected file wins.
    const defaultStore = createArtifactStore({ sqliteFile: path.join(f.root, ".aidn/runtime/index/workflow-index.sqlite") });
    try { for (const row of snapshot({ sessionObjective: unrelated }).payload.artifacts) defaultStore.upsertArtifact({
      ...row, kind: row.path.startsWith("sessions/") ? "session" : "other", family: "normative",
    }); } finally { defaultStore.close(); }
    git(f.root, ["add", "."]); git(f.root, ["commit", "--quiet", "-m", "canonical fixture indices"]);
    const result = invoke(f, { args: ["--index-file", indexFile, "--index-backend", "sqlite"] });
    const payload = successful(result, mode === "dual" ? "warn" : "ok");
    assert.deepEqual(payload.levels.level2.active_signals, mode === "dual" ? ["objective_delta"] : []);
    assert.equal(result.reads.length, 0);
  });
  check("json_db_only_honors_explicit_canonical_index", () => {
    const f = fixture("explicit-json", { backend: "sqlite", visibleObjective: unrelated });
    const indexFile = put(f.root, "custom/canonical.json", snapshot().payload);
    git(f.root, ["add", "."]); git(f.root, ["commit", "--quiet", "-m", "canonical fixture JSON"]);
    const result = invoke(f, { args: ["--index-file", indexFile, "--index-backend", "json"] });
    assert.deepEqual(successful(result).levels.level2.active_signals, []); assert.equal(result.reads.length, 0);
  });
} finally {
  const result = removePathWithRetry(tempRoot);
  cleanup = result.ok && !fs.existsSync(tempRoot);
  if (!cleanup) checks.push({ name: "owned_temporary_fixture_cleanup", status: "FAIL", message: result.error?.message ?? "temporary fixture still exists" });
}

const pass = checks.every(item => item.status === "PASS") && cleanup;
console.log(JSON.stringify({ pass, proof_class: "cli-and-canonical-boundary-fixtures", checks,
  cleanup, live_postgres: "SKIP: injected canonical reader", native_qualification: "SKIP: not exercised" }, null, 2));
if (!pass) process.exitCode = 1;
