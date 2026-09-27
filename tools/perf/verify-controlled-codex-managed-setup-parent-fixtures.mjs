import assert from "node:assert/strict";
import { createControlledCodexManagedSetup } from "../../src/application/runtime/controlled-codex-managed-setup.mjs";
import { MANAGED_SETUP_BRIDGE_SOURCE_FILES } from "../../src/adapters/agents/process-tree/codex-managed-setup-bridge.mjs";
import { buildManagedSetupArguments } from "../../src/adapters/agents/codex-managed-setup-transport.mjs";
import { fingerprintAgentExecutionValue as hash } from "../../src/core/agents/agent-execution-contracts.mjs";

const H = "a".repeat(64), OTHER = "b".repeat(64), checks = [];
const self = "src/application/runtime/controlled-codex-managed-setup.mjs";
const at = () => new Date().toISOString();
const created = "2026-09-27T12:00:00.1234567Z";
const copy = value => structuredClone(value);
async function check(name, fn) { try { await fn(); checks.push({ name, status: "PASS" }); } catch (error) { checks.push({ name, status: "FAIL", detail: String(error.stack ?? error).slice(0, 1800) }); } }
function fixture() {
  const inventory = Object.fromEntries([...MANAGED_SETUP_BRIDGE_SOURCE_FILES, self].map(name => [name, H]));
  const cwd = "C:\\Fixture Workspace", home = "C:\\Fixture Profile";
  const startup = { state_root: "C:\\Fixture State", mcp_server_ids: [], plugin_ids: [], app_ids: [], environment_override_names: [] };
  const body = { protocol: "aidn-controlled-managed-setup.v2", intent: "execute-managed-setup", invocation_id: "fixture.managed.setup",
    operation_sha256: H, configuration_sha256: H, approval_sha256: H,
    protocol_config: { operation_sha256: H, client_sha256: H, cwd, expected_codex_home: home,
      limits: { initialize_timeout_ms: 500, setup_timeout_ms: 1000, max_duration_ms: 2000, max_frame_bytes: 8192, max_total_bytes: 65536, max_frames: 16 } },
    node: { executable: "C:\\Fixture Bin\\node.exe", sha256: H }, powershell: { executable: "C:\\Fixture Bin\\pwsh.exe", sha256: H },
    job_name: "Local\\aidn-execution-" + "a".repeat(32), candidate_root: "C:\\Fixture Candidate", source_inventory: inventory,
    client: { executable: "C:\\Fixture Bin\\codex.exe", sha256: H, args: buildManagedSetupArguments(startup) },
    sidecars: { setup: { executable: "C:\\Fixture Bin\\setup.exe", sha256: H }, command_runner: { executable: "C:\\Fixture Bin\\runner.exe", sha256: H } },
    cwd, startup, env: { CODEX_HOME: home, TEMP: startup.state_root, TMP: startup.state_root }, limits: { max_stdout_bytes: 65536, max_stderr_bytes: 16384, max_pending_bytes: 65536, stop_timeout_ms: 500 },
    prerequisites: { reference: "C:\\Fixture Review\\prerequisites.json", sha256: H } };
  const request = { ...body, request_sha256: hash(body) }, events = [];
  const token = (pid, job = null) => ({ pid, started_at: created, elevated: true, admin_enabled: true,
    integrity_sid: "S-1-16-12288", elevation_type: 2, token_type: 1, has_restrictions: false,
    restricted_sid_count: 0, is_app_container: false, job_name: job, job_member: job ? true : null });
  const availability = { available: true, helper_sha256: H, source_sha256: H, candidate_sha256: hash(inventory) };
  const runner = { runner_id: body.invocation_id, pid: 12345, started_at: created, job_name: body.job_name, executable_sha256: H,
    helper_sha256: H, source_sha256: H, candidate_sha256: hash(inventory) };
  const processResult = { outcome: "completed", reason_code: "PROCESS_EXITED", exit_code: 0, signal: null, termination_state: "confirmed", runner,
    termination_proof: { method: "windows-job-object", active_processes: 0, ...runner } };
  const channel = { protocol: { phase: "completion_observed" }, reported_setup_result: "succeeded", reason_code: null, stop_reason_code: null,
    stdout_eof: true, outcome: "indeterminate", process_termination: "unconfirmed" };
  const bridge = { protocol: body.protocol, invocation_id: body.invocation_id, request_sha256: request.request_sha256, operation_sha256: body.operation_sha256, ok: true,
    result: { channel, transport: { closed: true, forced: false, stdout_ended: true, exit_code: 0, signal: null, reason_code: null }, preflight: { target: token(runner.pid, body.job_name) } } };
  const ports = {
    inspectMaterial: async ({ request: req }) => { events.push("material"); return { verified: true, request_sha256: req.request_sha256, inventory_sha256: hash(req.source_inventory), startup_sha256: hash(req.startup) }; },
    authorizeOperation: async ({ request: req, phase }) => { events.push(phase + ":authorize"); return { status: "AUTHORIZED", request_sha256: req.request_sha256,
      operation_sha256: req.operation_sha256, approval_sha256: req.approval_sha256, configuration_sha256: req.configuration_sha256,
      effects_adequate: true, expires_at: new Date(Date.now() + 120000).toISOString() }; },
    preflight: async ({ request: req, phase, runner: target }) => { events.push(phase + ":preflight"); return { contract_version: "aidn-managed-setup-preflight.v1", request_sha256: req.request_sha256,
      phase, observed_at: at(), status: "OBSERVED", launcher: token(process.pid), target: target ? token(target.pid, target.job_name) : null,
      helpers: { complete: true, rows: [] }, errors: [] }; },
    compareEffects: async ({ request: req }) => { events.push("effects"); return { status: "MATCHED", operation_sha256: req.operation_sha256, comparison_sha256: H, observed_at: at() }; },
    controller: { checkAvailability: async () => { events.push("availability"); return availability; },
      run: async (req, { onEvent }) => {
        events.push("create"); assert.equal(req.jobName, body.job_name); assert.equal(req.stdin, JSON.stringify(request) + "\n");
        assert.deepEqual(req.args.slice(1), ["--execute", "--expect-request", request.request_sha256]);
        try { await onEvent({ type: "prepared", ...runner, suspended: true, job_assigned: true }); }
        catch { return { ...processResult, outcome: "failed", reason_code: "PROCESS_CALLBACK_FAILED", exit_code: 125 }; }
        events.push("resumed"); await onEvent({ type: "stdout", bytes: Buffer.from(JSON.stringify(bridge)) }); events.push("job-empty");
        return processResult;
      } },
  };
  const options = { execute: true, expectRequestSha256: request.request_sha256, maxDurationMs: 3000 };
  return { request, ports, options, events, processResult, bridge, runner, availability };
}
await check("construction has no port effects and all authority ports are required", () => {
  const f = fixture(); createControlledCodexManagedSetup(f.ports); assert.deepEqual(f.events, []);
  assert.throws(() => createControlledCodexManagedSetup({ ...f.ports, authorizeOperation: undefined }), /DEPENDENCIES_REQUIRED/u);
});
await check("explicit intent and exact request required before any operation", async () => {
  const f = fixture(), run = createControlledCodexManagedSetup(f.ports);
  await assert.rejects(run(f.request, { ...f.options, execute: false }), /EXPLICIT_INTENT/u);
  await assert.rejects(run(f.request, { ...f.options, expectRequestSha256: OTHER }), /EXPLICIT_INTENT/u); assert.deepEqual(f.events, []);
});
await check("natural empty Job plus matching effects preserves inner indeterminate channel", async () => {
  const f = fixture(), before = copy(f.request), result = await createControlledCodexManagedSetup(f.ports)(f.request, f.options);
  assert.equal(result.outcome, "completed"); assert.equal(result.tree_termination.state, "confirmed");
  assert.equal(result.bridge.result.channel.outcome, "indeterminate"); assert.equal(result.native_qualified, false);
  assert.equal(result.execution_registered, false); assert.equal(result.recovery_required, false); assert.deepEqual(f.request, before);
  assert.deepEqual(f.events, ["material", "before_create:authorize", "before_create:preflight", "availability", "create", "material", "before_resume:authorize", "before_resume:preflight", "resumed", "job-empty", "effects"]);
});
for (const change of ["missing-authority", "wrong-approval", "inadequate-effects", "expired-approval", "restricted-launcher", "external-helper", "wrong-candidate"]) await check("refuses before create: " + change, async () => {
  const f = fixture(), authorizer = f.ports.authorizeOperation, preflight = f.ports.preflight;
  if (change === "wrong-candidate") f.availability.candidate_sha256 = OTHER;
  else if (["restricted-launcher", "external-helper"].includes(change)) f.ports.preflight = async input => { const r = await preflight(input); if (change === "external-helper") r.helpers.rows.push({ pid: 45, started_at: created }); else r.launcher.has_restrictions = true; return r; };
  else f.ports.authorizeOperation = async input => { const r = await authorizer(input); if (change === "missing-authority") r.status = "REFUSED";
    if (change === "wrong-approval") r.approval_sha256 = OTHER; if (change === "inadequate-effects") r.effects_adequate = false;
    if (change === "expired-approval") r.expires_at = "2020-01-01T00:00:00.000Z"; return r; };
  const result = await createControlledCodexManagedSetup(f.ports)(f.request, f.options);
  assert.equal(result.outcome, "refused"); assert(!f.events.includes("create")); assert.equal(result.tree_termination.state, "not_started");
});
for (const change of ["pid", "creation-100ns", "job", "token", "elevation-type"]) await check("prepared target refuses " + change, async () => {
  const f = fixture(), preflight = f.ports.preflight;
  f.ports.preflight = async input => { const r = await preflight(input); if (r.target) { if (change === "pid") r.target.pid++;
    if (change === "creation-100ns") r.target.started_at = "2026-09-27T12:00:00.1234568Z";
    if (change === "job") r.target.job_member = false; if (change === "token") r.target.admin_enabled = false;
    if (change === "elevation-type") r.target.elevation_type = 3; } return r; };
  const result = await createControlledCodexManagedSetup(f.ports)(f.request, f.options);
  assert.equal(result.outcome, "indeterminate"); assert(!f.events.includes("resumed")); assert(!f.events.includes("effects"));
});
for (const change of ["timeout", "forced", "wrong-proof", "missing-proof", "protocol", "drain", "wrong-envelope", "wrong-operation", "wrong-inside-pid", "effects", "app-exit-code", "app-signal", "transport-fault", "transport-eof"]) await check("Job0 cannot accept " + change, async () => {
  const f = fixture();
  if (change === "timeout") { f.processResult.outcome = "timed_out"; f.processResult.reason_code = "TIMEOUT"; }
  if (change === "forced") f.bridge.result.transport.forced = true;
  if (change === "wrong-proof") f.processResult.termination_proof.started_at = "2026-09-27T12:00:00.1234568Z";
  if (change === "missing-proof") f.processResult.termination_proof = null;
  if (change === "protocol") f.bridge.result.channel.reason_code = "PROTOCOL_REFUSED";
  if (change === "drain") f.bridge.result.channel.stdout_eof = false;
  if (change === "wrong-envelope") f.bridge.request_sha256 = OTHER;
  if (change === "wrong-operation") f.bridge.operation_sha256 = OTHER;
  if (change === "wrong-inside-pid") f.bridge.result.preflight.target.pid++;
  if (change === "app-exit-code") f.bridge.result.transport.exit_code = 23;
  if (change === "app-signal") f.bridge.result.transport.signal = "SIGTERM";
  if (change === "transport-fault") f.bridge.result.transport.reason_code = "MANAGED_SETUP_STDIN_FAILED";
  if (change === "transport-eof") f.bridge.result.transport.stdout_ended = false;
  if (change === "effects") f.ports.compareEffects = async () => ({ status: "INCOMPLETE", operation_sha256: H, comparison_sha256: H, observed_at: at() });
  const run = createControlledCodexManagedSetup(f.ports), result = await run(f.request, f.options);
  assert.equal(result.outcome, "indeterminate"); assert.equal(result.recovery_required, true);
  await assert.rejects(run(f.request, f.options), /RECOVERY_REQUIRED/u);
});
for (const phase of ["before_create", "before_resume"]) await check("authorization expiry during " + phase + " preflight blocks launch or resume", async () => {
  const f = fixture(), authorize = f.ports.authorizeOperation, inspect = f.ports.preflight, now = Date.now;
  let offset = 0;
  Date.now = () => now() + offset;
  try {
    f.ports.authorizeOperation = async input => { const result = await authorize(input); if (input.phase === phase) result.expires_at = new Date(Date.now() + 100).toISOString(); return result; };
    f.ports.preflight = async input => { const result = await inspect(input); if (input.phase === phase) offset = 200; return result; };
    const result = await createControlledCodexManagedSetup(f.ports)(f.request, f.options);
    assert.equal(result.outcome, phase === "before_create" ? "refused" : "indeterminate");
    assert(!f.events.includes(phase === "before_create" ? "create" : "resumed"));
  } finally { Date.now = now; }
});
await check("validated observations are immutable detached snapshots across effects await", async () => {
  const f = fixture(), compare = f.ports.compareEffects;
  f.ports.compareEffects = async input => {
    assert(Object.isFrozen(input)); assert(Object.isFrozen(input.process.runner)); assert(Object.isFrozen(input.bridge.result.channel));
    assert.throws(() => { input.process.termination_proof.active_processes = 1; }, TypeError);
    assert.throws(() => { input.bridge.result.channel.stdout_eof = false; }, TypeError);
    f.processResult.termination_proof.active_processes = 3; f.availability.helper_sha256 = OTHER;
    f.bridge.result.channel.reason_code = "LATE_MUTATION";
    await Promise.resolve(); return compare(input);
  };
  const result = await createControlledCodexManagedSetup(f.ports)(f.request, f.options);
  assert.equal(result.outcome, "completed"); assert.equal(result.tree_termination.state, "confirmed");
  assert.equal(result.process.termination_proof.active_processes, 0); assert.equal(result.bridge.result.channel.reason_code, null);
});
for (const phase of ["before_create", "before_resume"]) await check("startup material digest mismatch refuses " + phase, async () => {
  const f = fixture(), inspect = f.ports.inspectMaterial; let calls = 0;
  f.ports.inspectMaterial = async input => { const record = await inspect(input); calls++;
    if (calls === (phase === "before_create" ? 1 : 2)) record.startup_sha256 = OTHER; return record; };
  const result = await createControlledCodexManagedSetup(f.ports)(f.request, f.options);
  assert.equal(result.outcome, phase === "before_create" ? "refused" : "indeterminate");
  assert(!f.events.includes(phase === "before_create" ? "create" : "resumed"));
});
await check("v1 startup cannot enter the parent authority ports", async () => {
  const f = fixture(); f.request.protocol = "aidn-controlled-managed-setup.v1";
  const { request_sha256, ...body } = f.request; f.request.request_sha256 = hash(body); f.options.expectRequestSha256 = f.request.request_sha256;
  await assert.rejects(createControlledCodexManagedSetup(f.ports)(f.request, f.options), /SETUP_BRIDGE_REQUEST_INVALID/u);
  assert.deepEqual(f.events, []);
});
await check("changed material at prepared prevents resumption", async () => {
  const f = fixture(); let calls = 0;
  f.ports.inspectMaterial = async ({ request }) => ({ request_sha256: request.request_sha256, inventory_sha256: hash(request.source_inventory), startup_sha256: hash(request.startup), verified: ++calls === 1 });
  const result = await createControlledCodexManagedSetup(f.ports)(f.request, f.options); assert.equal(result.outcome, "indeterminate"); assert(!f.events.includes("resumed"));
});
await check("foreign error code never leaks through authority port", async () => {
  const f = fixture(); f.ports.authorizeOperation = async () => { throw Object.assign(new Error("PRIVATE"), { code: "MANAGED_TREE_PRIVATE_VALUE" }); };
  const result = await createControlledCodexManagedSetup(f.ports)(f.request, f.options); assert.equal(result.reason_code, "MANAGED_TREE_OPERATION_FAILED"); assert(!JSON.stringify(result).includes("PRIVATE"));
});
await check("cancel before create leaves no process and no implicit retry", async () => {
  const f = fixture(), stop = new AbortController(); stop.abort();
  const result = await createControlledCodexManagedSetup(f.ports)(f.request, { ...f.options, signal: stop.signal });
  assert.equal(result.outcome, "refused"); assert.equal(result.reason_code, "MANAGED_TREE_CANCELLED"); assert.deepEqual(f.events, []);
});
const fail = checks.filter(row => row.status === "FAIL").length;
console.log(JSON.stringify({ status: fail ? "FAIL" : "PASS", checks, pass: checks.length - fail, fail, native: "NOT_RUN", system_effects: "NOT_RUN", cleanup: { status: "PASS", created_resources: 0 } }, null, 2));
process.exitCode = fail ? 1 : 0;
