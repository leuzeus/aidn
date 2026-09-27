import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createManagedSetupParentPreflight } from "../../src/adapters/agents/process-tree/codex-managed-setup-parent-preflight.mjs";
import { MANAGED_SETUP_BRIDGE_SOURCE_FILES } from "../../src/adapters/agents/process-tree/codex-managed-setup-bridge.mjs";
import { buildManagedSetupArguments } from "../../src/adapters/agents/codex-managed-setup-transport.mjs";
import { fingerprintAgentExecutionValue as hash } from "../../src/core/agents/agent-execution-contracts.mjs";
const H = "a".repeat(64), OTHER = "b".repeat(64), checks = [];
const timestamp = new Date().toISOString().replace("Z", "0000Z");
const digest = b => createHash("sha256").update(b).digest("hex");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-parent-preflight-fixture-"));
const temporaryParent = fs.realpathSync(os.tmpdir());
const scriptName = "src/adapters/agents/process-tree/codex-managed-setup-preflight.ps1";
const realSource = fs.readFileSync(path.resolve(import.meta.dirname, "../..", scriptName));
const script = path.join(temporary, "candidate", scriptName);
fs.mkdirSync(path.dirname(script), { recursive: true }); fs.writeFileSync(script, realSource);
async function check(name, fn) { try { await fn(); checks.push({ name, status: "PASS" }); }
  catch (e) { checks.push({ name, status: "FAIL", detail: String(e.stack).slice(0, 1600) }); } }
function fixture(change = null, options = {}) {
  const events = [], records = [], parentIdentity = { pid: process.pid, started_at: timestamp };
  const token = (identity, job = null) => ({ ...identity, elevated: true, admin_enabled: true, integrity_sid: "S-1-16-12288",
    elevation_type: 2, token_type: 1, has_restrictions: false, restricted_sid_count: 0, is_app_container: false, job_name: job, job_member: job ? true : null });
  const startup = { state_root: path.join(temporary, "state"), mcp_server_ids: [], plugin_ids: [], app_ids: [], environment_override_names: [] };
  const cwd = path.join(temporary, "work"), home = path.join(temporary, "profile");
  const inventory = Object.fromEntries(MANAGED_SETUP_BRIDGE_SOURCE_FILES.map(k => [k, k === scriptName ? digest(realSource) : H]));
  const body = { protocol: "aidn-controlled-managed-setup.v2", intent: "execute-managed-setup", invocation_id: "fixture.managed.setup",
    operation_sha256: H, configuration_sha256: H, approval_sha256: H,
    protocol_config: { operation_sha256: H, client_sha256: H, cwd, expected_codex_home: home,
      limits: { initialize_timeout_ms: 500, setup_timeout_ms: 1000, max_duration_ms: 2000, max_frame_bytes: 8192, max_total_bytes: 65536, max_frames: 16 } },
    node: { executable: path.join(temporary, "node.exe"), sha256: H }, powershell: { executable: path.join(temporary, "pwsh.exe"), sha256: H },
    job_name: "Local\\aidn-execution-" + "a".repeat(32), candidate_root: path.join(temporary, "candidate"), source_inventory: inventory,
    client: { executable: path.join(temporary, "codex.exe"), sha256: H, args: buildManagedSetupArguments(startup) },
    sidecars: { setup: { executable: path.join(temporary, "setup.exe"), sha256: H }, command_runner: { executable: path.join(temporary, "runner.exe"), sha256: H } },
    cwd, startup, env: { CODEX_HOME: home, TEMP: startup.state_root, TMP: startup.state_root },
    limits: { max_stdout_bytes: 65536, max_stderr_bytes: 16384, max_pending_bytes: 65536, stop_timeout_ms: 500 },
    prerequisites: { reference: path.join(temporary, "prerequisites.json"), sha256: H } };
  const request = { ...body, request_sha256: hash(body) };
  const availability = { available: true, helper_sha256: H, source_sha256: H, candidate_sha256: hash(inventory) };
  const expectedEnv = structuredClone(body.env), expectedParent = structuredClone(parentIdentity);
  const controller = {
    checkAvailability: async () => { events.push("check"); await options.onCheck?.(); return availability; },
    run: async (req, { onEvent }) => {
      events.push("create");
      if (change === "controller-throws") throw new Error("private diagnostic");
      assert.deepEqual(req.env, expectedEnv);
      assert.notEqual(req.jobName, body.job_name); assert.notEqual(req.runnerId, body.invocation_id);
      assert.equal(req.args[3], "-File"); assert.equal(req.args[4], script);
      assert.equal(req.args[5], "-RequestBase64"); assert.equal(req.executable, body.powershell.executable);
      assert.equal(req.stdin, ""); assert.equal(req.maxDurationMs, 7000);
      const input = JSON.parse(Buffer.from(req.args[6], "base64").toString());
      assert.equal(input.max_duration_ms, 5000); assert.deepEqual(input.launcher, expectedParent);
      const observedRunner = { runner_id: req.runnerId, job_name: req.jobName, pid: 12345, helper_pid: 12346, started_at: timestamp,
        executable_sha256: H, helper_sha256: H, source_sha256: H, candidate_sha256: hash(inventory) };
      if (change === "prepared-invalid-pid") observedRunner.pid = 0;
      if (change === "prepared-invalid-date") observedRunner.started_at = new Date().toISOString();
      if (change === "prepared-missing-helper") delete observedRunner.helper_pid;
      if (change === "prepared-wrong-source") observedRunner.source_sha256 = OTHER;
      if (change === "prepared-wrong-executable") observedRunner.executable_sha256 = OTHER;
      if (change === "prepared-malformed-hash") observedRunner.helper_sha256 = "";
      await options.beforePrepared?.();
      await onEvent({ ...observedRunner, type: "prepared", suspended: true, job_assigned: true });
      events.push("resumed");
      const out = { contract_version: "aidn-managed-setup-preflight.v1", request_sha256: input.request_sha256, phase: input.phase,
        observed_at: new Date().toISOString(), status: "OBSERVED", launcher: token(expectedParent),
        target: input.target ? token({ pid: input.target.pid, started_at: input.target.started_at }, input.target.job_name) : null,
        helpers: { complete: true, rows: [] }, errors: [] };
      if (change === "foreign-request") out.request_sha256 = OTHER;
      if (change === "wrong-phase") out.phase = "inside_bridge";
      if (change === "restricted-token") out.launcher.has_restrictions = true;
      if (change === "100ns-identity") out.launcher.started_at = timestamp.replace(/\dZ$/u, "1Z");
      if (change === "external-helper") out.helpers.rows.push({ pid: 7 });
      if (change === "future") out.observed_at = new Date(Date.now() + 60000).toISOString();
      if (change === "stale") out.observed_at = new Date(Date.now() - 60000).toISOString();
      if (change === "extra") out.approved = true;
      if (change === "target-job") out.target.job_member = false;
      if (change === "unexpected-target") out.target = token(parentIdentity);
      const bytes = Buffer.from(JSON.stringify(out)); await onEvent({ type: "stdout", bytes });
      if (change === "stderr") await onEvent({ type: "stderr", bytes: Buffer.from("warning") });
      const proof = { method: "windows-job-object", active_processes: 0, observed_at: timestamp, ...observedRunner };
      if (change === "nonempty-job") proof.active_processes = 1;
      if (change === "foreign-proof") proof.runner_id = "foreign";
      const result = { outcome: "completed", reason_code: "PROCESS_EXITED", termination_state: "confirmed", exit_code: 0, signal: null,
        runner: observedRunner, termination_proof: proof, bytes: { stdout: bytes.length, stderr: 0 },
        hashes: { helper_sha256: H, source_sha256: H, candidate_sha256: hash(inventory), executable_sha256: H, stdout_sha256: digest(bytes), stderr_sha256: digest(Buffer.alloc(0)) } };
      if (change === "wrong-digest") result.hashes.stdout_sha256 = OTHER;
      if (change === "process-failed") result.outcome = "failed";
      if (change === "unknown-tree") result.termination_state = "unknown";
      if (change === "wrong-candidate") proof.candidate_sha256 = OTHER;
      if (change === "missing-result-source") delete result.hashes.source_sha256;
      if (change === "missing-proof-source") delete proof.source_sha256;
      if (change === "missing-proof-date") delete proof.observed_at;
      if (change === "missing-result-executable") delete result.hashes.executable_sha256;
      if (change === "wrong-result-executable") result.hashes.executable_sha256 = OTHER;
      if (change === "wrong-result-helper") result.runner = { ...result.runner, helper_pid: 999 };
      if (change === "wrong-result-start") result.runner = { ...result.runner, started_at: timestamp.replace(/\dZ$/u, "1Z") };
      if (change === "signal-present") result.signal = "SIGTERM";
      if (change === "missing-signal") delete result.signal;
      if (change === "wrong-stderr-digest") result.hashes.stderr_sha256 = OTHER;
      if (change === "wrong-byte-count") result.bytes.stdout++;
      if (change === "oversized-process") result.unexpected = "x".repeat(65536);
      await options.beforeReturn?.({ onEvent, result });
      return result;
    }
  };
  const recordEvidence = async record => {
    assert(Object.isFrozen(record));
    records.push(record); events.push("journal:" + record.kind);
    await options.recordEvidence?.(record);
  };
  const preflight = createManagedSetupParentPreflight({ controller, parentIdentity, recordEvidence });
  const runner = { runner_id: request.invocation_id, pid: 789, started_at: timestamp, job_name: request.job_name };
  return { request, preflight, runner, events, records, controller, parentIdentity, availability, recordEvidence };
}
try {
  await check("construction is pure and requires the actual parent identity", () => {
    const f = fixture(); assert.deepEqual(f.events, []);
    assert.throws(() => createManagedSetupParentPreflight({ controller: f.controller, parentIdentity: { ...f.parentIdentity, pid: process.pid + 1 }, recordEvidence: f.recordEvidence }), /DEPENDENCIES/u);
  });
  for (const phase of ["before_create", "before_resume"]) await check("fixed read-only native request and proof: " + phase, async () => {
    const f = fixture(), r = await f.preflight({ request: f.request, phase, runner: phase === "before_create" ? null : f.runner, signal: new AbortController().signal });
    assert.equal(r.phase, phase); assert.equal(r.status, "OBSERVED"); assert(Object.isFrozen(r.launcher));
    assert.deepEqual(f.events, ["check", "journal:intent", "create", "journal:prepared", "resumed", "journal:terminal"]);
    assert.equal(f.records[0].payload_sha256, hash(f.records[0].payload));
    assert.equal(f.records[2].output.stdout_sha256, digest(Buffer.from(f.records[2].output.stdout_base64, "base64")));
    assert.equal(f.records[2].termination_state, "confirmed");
    assert(Object.isFrozen(f.records[2].process.runner));
    for (const row of f.records) {
      assert.equal(row.request_sha256, f.request.request_sha256); assert.equal(row.phase, phase);
      assert.equal(row.runner_id, f.records[0].runner_id); assert.equal(row.job_name, f.records[0].job_name);
      assert.notEqual(row.job_name, f.request.job_name);
    }
  });
  for (const change of ["foreign-request", "wrong-phase", "restricted-token", "100ns-identity", "external-helper", "future", "stale", "extra", "target-job",
    "stderr", "nonempty-job", "foreign-proof", "wrong-digest", "process-failed", "unknown-tree", "wrong-candidate",
    "prepared-invalid-pid", "prepared-invalid-date", "prepared-missing-helper", "prepared-wrong-source", "prepared-wrong-executable",
    "prepared-malformed-hash", "missing-result-source", "missing-proof-source", "missing-proof-date", "missing-result-executable",
    "wrong-result-executable", "wrong-result-helper", "wrong-result-start", "signal-present", "missing-signal", "wrong-stderr-digest", "wrong-byte-count"]) await check("rejects " + change, async () => {
    const f = fixture(change); await assert.rejects(f.preflight({ request: f.request, phase: "before_resume", runner: f.runner, signal: new AbortController().signal }));
  });
  await check("a persistence port is mandatory", () => {
    const f = fixture();
    assert.throws(() => createManagedSetupParentPreflight({ controller: f.controller, parentIdentity: f.parentIdentity }), /DEPENDENCIES/u);
  });
  const invoke = (f, signal = new AbortController().signal) => f.preflight({ request: f.request, phase: "before_create", signal });
  const capture = async promise => { try { await promise; assert.fail("expected refusal"); } catch (e) { assert(e.preflight); return e; } };
  const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
  for (const kind of ["intent", "prepared", "terminal"]) await check("awaited serialized journal: " + kind, async () => {
    const reached = deferred(), release = deferred(); let active = 0, maximum = 0, settled = false;
    const f = fixture(null, { recordEvidence: async record => {
      maximum = Math.max(maximum, ++active);
      try { if (record.kind === kind) { reached.resolve(); await release.promise; } }
      finally { active--; }
    } });
    const pending = invoke(f).finally(() => { settled = true; });
    await reached.promise;
    assert.equal(settled, false);
    if (kind === "intent") assert(!f.events.includes("create"));
    if (kind === "prepared") assert(!f.events.includes("resumed"));
    release.resolve(); await pending;
    assert.equal(maximum, 1); assert.equal(active, 0);
  });
  for (const kind of ["intent", "prepared", "terminal"]) await check("failed sink is quarantined: " + kind, async () => {
    const f = fixture(null, { recordEvidence: record => { if (record.kind === kind) throw new Error("private sink details"); } });
    const error = await capture(invoke(f)), state = error.preflight;
    assert.equal(state.recovery_required, true); assert.equal(state.journal_complete, false);
    assert.equal(state.requested, kind !== "intent");
    assert.equal(state.termination_state, kind === "intent" ? "not_started" : kind === "prepared" ? "unknown" : "confirmed");
    assert.equal(f.records.filter(r => r.kind === "terminal").length, 1);
    if (kind === "intent") assert(!f.events.includes("create"));
    if (kind === "prepared") { assert(!f.events.includes("resumed")); assert(state.prepared); }
    assert(Object.isFrozen(state)); assert(!error.message.includes("private"));
  });
  await check("controller throw preserves auxiliary intent and requests reconciliation", async () => {
    const f = fixture("controller-throws"), error = await capture(invoke(f));
    assert.equal(error.preflight.requested, true); assert.equal(error.preflight.process, null);
    assert.equal(error.preflight.termination_state, "unknown"); assert.equal(error.preflight.recovery_required, true);
    assert.equal(error.preflight.journal_complete, true);
    assert.equal(f.records.at(-1).controller_error, "MANAGED_PREFLIGHT_CONTROLLER_FAILED");
  });
  await check("oversized controller result preserves bounded reconciliation evidence", async () => {
    const f = fixture("oversized-process"), error = await capture(invoke(f));
    assert.equal(error.preflight.process, null); assert(error.preflight.prepared);
    assert.equal(error.preflight.termination_state, "unknown"); assert.equal(error.preflight.recovery_required, true);
    assert.equal(error.preflight.journal_complete, true);
    assert.equal(f.records.at(-1).controller_error, "MANAGED_PREFLIGHT_EVIDENCE_LIMIT");
    assert(Buffer.byteLength(JSON.stringify(error.preflight)) < 262144);
  });
  await check("unknown termination retains the exact immutable process result", async () => {
    const f = fixture("unknown-tree"), error = await capture(invoke(f));
    assert.equal(error.preflight.process.termination_state, "unknown"); assert.equal(error.preflight.recovery_required, true);
    assert.equal(error.preflight.journal_complete, true);
    assert.deepEqual(error.preflight.process, f.records.at(-1).process);
    assert(Object.isFrozen(error.preflight.process.runner));
    assert.throws(() => { error.preflight.process.runner.pid = 1; }, TypeError);
  });
  await check("observation refusal happens after its terminal bytes are retained", async () => {
    const f = fixture("foreign-request"), error = await capture(invoke(f));
    assert.equal(error.preflight.termination_state, "confirmed"); assert.equal(error.preflight.recovery_required, false);
    assert.equal(error.preflight.journal_complete, true);
    const output = f.records.at(-1).output, bytes = Buffer.from(output.stdout_base64, "base64");
    assert.equal(output.stdout_bytes, bytes.length); assert.equal(output.stdout_sha256, digest(bytes));
    assert.equal(JSON.parse(bytes).request_sha256, OTHER);
  });
  for (const key of ["helper_sha256", "source_sha256", "candidate_sha256"]) await check("availability pin required: " + key, async () => {
    const f = fixture(); delete f.availability[key]; const error = await capture(invoke(f));
    assert.equal(error.preflight.requested, false); assert.equal(error.preflight.recovery_required, false);
    assert.deepEqual(f.events, ["check"]);
  });
  await check("cancellation during availability prevents intent and process creation", async () => {
    const abort = new AbortController(), f = fixture(null, { onCheck: () => abort.abort() });
    const error = await capture(invoke(f, abort.signal));
    assert.equal(error.preflight.requested, false); assert.deepEqual(f.events, ["check"]);
  });
  await check("cancellation during prepared persistence preserves auxiliary uncertainty", async () => {
    const abort = new AbortController(), f = fixture(null, { recordEvidence: r => { if (r.kind === "prepared") abort.abort(); } });
    const error = await capture(invoke(f, abort.signal));
    assert.equal(error.preflight.requested, true); assert.equal(error.preflight.recovery_required, true);
    assert(error.preflight.prepared); assert.equal(error.preflight.journal_complete, true);
    assert(!f.events.includes("resumed")); assert.equal(f.records.at(-1).kind, "terminal");
  });
  await check("request, parent and target inputs are copied before the first await", async () => {
    let f; const expectedTarget = { pid: 789, started_at: timestamp };
    f = fixture(null, { onCheck: () => {
      f.request.env.TEMP = path.join(temporary, "changed"); f.request.request_sha256 = OTHER;
      f.parentIdentity.started_at = "changed"; f.runner.pid = 999; f.runner.started_at = "changed";
    } });
    const expectedHash = f.request.request_sha256;
    const result = await f.preflight({ request: f.request, phase: "before_resume", runner: f.runner, signal: new AbortController().signal });
    assert.equal(result.request_sha256, expectedHash); assert.equal(result.launcher.started_at, timestamp);
    assert.equal(result.target.pid, expectedTarget.pid); assert.equal(result.target.started_at, expectedTarget.started_at);
  });
  await check("changed source after creation refuses resume and retains prepared identity", async () => {
    const f = fixture(null, { beforePrepared: () => fs.appendFileSync(script, "\n# drift\n") });
    try {
      const error = await capture(invoke(f)); assert(error.preflight.prepared);
      assert.equal(error.preflight.recovery_required, true); assert(!f.events.includes("resumed"));
      assert.equal(f.records.at(-1).prepared.pid, 12345); assert.equal(f.records.at(-1).kind, "terminal");
    } finally { fs.writeFileSync(script, realSource); }
  });
  await check("late controller callback cannot emit evidence after terminal", async () => {
    let event; const f = fixture(null, { beforeReturn: value => { event = value.onEvent; } });
    await invoke(f); const count = f.records.length;
    await assert.rejects(event({ type: "prepared" }), /EVENTS_CLOSED/u);
    assert.equal(f.records.length, count);
  });
  await check("abandoned prepared callback cannot persist after terminal", async () => {
    const f = fixture(); let callback;
    f.controller.run = async (req, { onEvent }) => {
      callback = onEvent({ type: "prepared", runner_id: req.runnerId, job_name: req.jobName,
        pid: 12345, helper_pid: 12346, started_at: timestamp, executable_sha256: H,
        ...Object.fromEntries(["helper_sha256", "source_sha256", "candidate_sha256"].map(k => [k, f.availability[k]])),
        suspended: true, job_assigned: true }).catch(error => error);
      return { outcome: "indeterminate", termination_state: "unknown", runner: null, termination_proof: null };
    };
    const error = await capture(invoke(f)); await callback;
    assert.equal(error.preflight.recovery_required, true);
    assert.deepEqual(f.records.map(row => row.kind), ["intent", "terminal"]);
  });
  await check("no target permitted before creation", async () => {
    const f = fixture("unexpected-target"); await assert.rejects(f.preflight({ request: f.request, phase: "before_create", signal: new AbortController().signal }), /TARGET_UNEXPECTED/u);
  });
  await check("changed script pin refuses before any process", async () => {
    const f = fixture(); fs.appendFileSync(script, "\n# changed\n");
    try { await assert.rejects(f.preflight({ request: f.request, phase: "before_create", signal: new AbortController().signal }), /SOURCE_CHANGED/u);
      assert.deepEqual(f.events, []); } finally { fs.writeFileSync(script, realSource); }
  });
  await check("aborted request has no port effects", async () => {
    const f = fixture(), abort = new AbortController(); abort.abort();
    await assert.rejects(f.preflight({ request: f.request, phase: "before_create", signal: abort.signal })); assert.deepEqual(f.events, []);
  });
} finally {
  await check("disposable corpus cleanup", () => {
    assert.equal(path.dirname(fs.realpathSync(temporary)), temporaryParent); assert(path.basename(temporary).startsWith("aidn-parent-preflight-fixture-"));
    fs.rmSync(temporary, { recursive: true, force: false }); assert(!fs.existsSync(temporary));
  });
}
const fail = checks.filter(r => r.status === "FAIL").length;
console.log(JSON.stringify({ ok: fail === 0, pass: checks.length - fail, fail, skip: 0, checks, process_boundary: "fixture-controller", native_setup: "NOT_RUN" }, null, 2));
process.exitCode = fail ? 1 : 0;
