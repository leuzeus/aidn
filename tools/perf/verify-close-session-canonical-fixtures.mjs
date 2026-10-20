import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runCloseSessionAdmitUseCase } from "../../src/application/runtime/close-session-admit-use-case.mjs";
import { readCanonicalCloseSessionContext } from "../../src/application/runtime/close-session-context-service.mjs";
import { runWorkflowHookUseCase } from "../../src/application/runtime/workflow-hook-use-case.mjs";
import { createRuntimeArtifactStore } from "../../src/application/runtime/runtime-persistence-service.mjs";
import { loadSharedStateSnapshot } from "../../src/application/runtime/shared-state-backend-service.mjs";
import { createRuntimePersistenceFakePgClientFactory } from "./runtime-persistence-fake-pg-lib.mjs";
import { createTrackedFixtureFilter, initGitRepo, removePathWithRetry } from "./test-git-fixture-lib.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
export async function verifyCanonicalSessionClose() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-close-canonical-"));
  const runs = [];
  const write = (name, value) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  const config = (backend, mode = "db-only") => write(".aidn/config.json", JSON.stringify({ runtime: {
    stateMode: mode, persistence: { backend, connectionRef: "env:AIDN_SESSION_FIXTURE_PG" } } }));
  const check = async (id, fn) => { await fn(); runs.push({ id, pass: true }); };
  try {
    const source = path.resolve("tests/fixtures/perf-handoff/ready");
    fs.cpSync(source, root, { recursive: true, filter: createTrackedFixtureFilter(source) });
    initGitRepo(root, { workingBranch: "feature/C101-alpha" });
    const run = execFileSync(process.execPath, ["tools/perf/index-sync.mjs", "--target", root,
      "--store", "sqlite", "--with-content", "--json"], { encoding: "utf8", windowsHide: true });
    assert(JSON.parse(run));
    const original = loadSharedStateSnapshot({ targetRoot: root }).payload;
    const payload = structuredClone(original);
    const edit = (data, pattern, fn) => { const artifact = data.artifacts.find(a => pattern.test(a.path));
      assert(artifact, String(pattern)); artifact.content = fn(artifact.content); artifact.sha256 = sha(artifact.content); };
    const terminal = data => {
      data.cycles.find(row => row.cycle_id === "C101").state = "DONE";
      edit(data, /cycles\/C101[^/]*\/status\.md$/, text => text.replace("state: IMPLEMENTING", "state: DONE"));
      edit(data, /CURRENT-STATE\.md$/, text => text.replace(/active_cycle:.*$/m, "active_cycle: none"));
      edit(data, /sessions\/S101.*\.md$/, text => text + "\nstate: CLOSED\n### Session close gate satisfied?\n- [x] Yes\n### Snapshot updated?\n- [x] Yes\n");
    };
    terminal(payload);
    const fake = createRuntimePersistenceFakePgClientFactory();
    const options = { connectionString: "postgres://fixture/close-session", clientFactory: fake.factory };
    const store = createRuntimeArtifactStore({ targetRoot: root, backend: "postgres", ...options });
    const admit = () => runCloseSessionAdmitUseCase({ targetRoot: root, mode: "COMMITTING", persistenceOptions: options });
    config("postgres");
    for (const name of ["CURRENT-STATE.md", "sessions/S101-alpha.md", "cycles/C101-feature-alpha/status.md"])
      write(`docs/audit/${name}`, "# Stale bootstrap\nmode: unknown\nactive_session: none\nactive_cycle: C999\nstate: UNKNOWN\n");
    const stale = ["CURRENT-STATE.md", "sessions/S101-alpha.md", "cycles/C101-feature-alpha/status.md"]
      .map(name => [name, sha(fs.readFileSync(path.join(root, "docs/audit", name)))]);
    await check("postgres_final_session_uses_canonical_closed_state_and_owner", async () => {
      await store.writeIndexProjection({ payload });
      await readCanonicalCloseSessionContext({ targetRoot: root, auditRoot: path.join(root, "docs/audit"), persistenceOptions: options });
      const result = await admit();
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.mapped_session.session_id, "S101");
      assert.equal(result.mapped_cycle.state, "DONE"); assert.equal(result.active_cycle, "none");
    });
    await check("cleared_session_focus_resolves_only_explicit_closed_terminal_owner", async () => {
      const data = structuredClone(payload); edit(data, /CURRENT-STATE\.md$/, text => text.replace(/active_session:.*$/m, "active_session: none"));
      await store.writeIndexProjection({ payload: data }); assert.equal((await admit()).ok, true);
      edit(data, /sessions\/S101.*\.md$/, text => text.replace("state: CLOSED", "state: OPEN"));
      await store.writeIndexProjection({ payload: data }); assert.equal((await admit()).ok, false);
    });
    await check("postgres_unavailable_refuses_valid_sqlite_and_visible_fallback", async () => {
      const result = await runCloseSessionAdmitUseCase({ targetRoot: root, persistenceOptions: { ...options,
        clientFactory: () => { throw Error("PostgreSQL unavailable"); } } });
      assert.equal(result.ok, false); assert.equal(result.reason_code, "CLOSE_SESSION_CANONICAL_RUNTIME_INVALID");
    });
    for (const [id, mutate] of [
      ["duplicate_session", data => data.artifacts.push({ ...data.artifacts.find(a => /sessions\/S101/.test(a.path)), path: "sessions/S101-other.md" })],
      ["duplicate_cycle", data => data.artifacts.push({ ...data.artifacts.find(a => /cycles\/C101.*status/.test(a.path)), path: "cycles/C101-other/status.md" })],
      ["missing_current", data => { data.artifacts = data.artifacts.filter(a => !/CURRENT-STATE\.md$/.test(a.path)); }],
      ["foreign_cycle_owner", data => edit(data, /cycles\/C101.*status/, text => text.replace("session_owner: S101", "session_owner: S999"))],
    ]) await check(`${id}_fails_closed`, async () => {
      const data = structuredClone(payload); mutate(data); await store.writeIndexProjection({ payload: data });
      assert.equal((await admit()).ok, false);
    });
    await check("canonical_open_cycle_still_requires_resolution_decision", async () => {
      await store.writeIndexProjection({ payload: original }); const result = await admit();
      assert.equal(result.ok, false); assert.equal(result.action, "blocked_open_cycles_require_resolution");
    });
    await check("sqlite_db_only_preserves_canonical_close_admission", async () => {
      config("sqlite"); const sqlite = createRuntimeArtifactStore({ targetRoot: root, backend: "sqlite" });
      await sqlite.writeIndexProjection({ payload }); assert.equal((await admit()).ok, true);
    });
    await check("files_preserve_visible_authority", async () => {
      config("sqlite", "files"); assert.equal((await admit()).ok, false);
      for (const [name, hash] of stale) assert.equal(sha(fs.readFileSync(path.join(root, "docs/audit", name))), hash);
    });
    await check("nested_checkpoint_failure_cannot_be_reported_as_success", async () => {
      assert.throws(() => runWorkflowHookUseCase({ targetRoot: root, runtimeDir: path.resolve("tools/perf"),
        args: { stateMode: "files", indexStore: "file", strict: true, phase: "session-close", mode: "COMMITTING",
          eventFile: ".aidn/runtime/perf/workflow-events.ndjson", runIdFile: ".aidn/runtime/perf/run-id.txt",
          indexOutput: "index.json", indexSqlOutput: "index.sql", indexSqliteOutput: "index.sqlite", indexSyncCheckOut: "check.json" },
        completedCheckpoint: { ok: false, gate: { result: "stop" }, summary: { result: "stop" } },
      }), /did not pass all nested checks/);
    });
    return runs;
  } finally { assert.equal(removePathWithRetry(root).ok, true); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const run of await verifyCanonicalSessionClose()) console.log(`PASS ${run.id}`);
}
