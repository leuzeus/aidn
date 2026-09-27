import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { assertManagedSetupStartup, buildManagedSetupStartupPaths } from "../../src/core/agents/codex-managed-startup.mjs";
import { buildCodexStartupArguments, CODEX_STARTUP_ENVIRONMENT_PROFILES } from "../../src/core/agents/codex-startup-arguments.mjs";
import { createManagedSetupTransport, buildManagedSetupArguments } from "../../src/adapters/agents/codex-managed-setup-transport.mjs";
import { assertManagedSetupBridgeRequest, runManagedSetupBridge, verifyManagedSetupContainingJob,
  MANAGED_SETUP_BRIDGE_SOURCE_FILES } from "../../src/adapters/agents/process-tree/codex-managed-setup-bridge.mjs";

const checks = [], A = "a".repeat(64), B = "b".repeat(64), C = "c".repeat(64);
const AT = "2026-09-27T12:00:00.000Z", CREATED = "2026-09-27T11:59:59.1234567Z";
const root = path.resolve(import.meta.dirname, "../..");
const canonical = value => Array.isArray(value) ? "[" + value.map(canonical).join(",") + "]"
  : value !== null && typeof value === "object" ? "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}" : JSON.stringify(value);
const hash = value => createHash("sha256").update(value).digest("hex");
const fingerprint = value => hash(canonical(value));
const seal = body => ({ ...body, request_sha256: fingerprint(body) });
const bodyOf = value => { const { request_sha256, ...body } = value; return body; };
const wire = value => Buffer.from(JSON.stringify(value) + "\n");
async function check(name, action) {
  try { await action(); checks.push({ name, status: "PASS" }); }
  catch (error) { checks.push({ name, status: "FAIL", detail: String(error.stack ?? error).slice(0, 1800) }); }
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async (count = 120) => { for (let i = 0; i < count; i++) await Promise.resolve(); };
async function finish(promise) {
  let done = false, result, error; promise.then(value => { done = true; result = value; }, cause => { done = true; error = cause; });
  for (let i = 0; i < 20000 && !done; i++) await Promise.resolve();
  assert(done, "fixture did not settle within bounded microtasks"); if (error) throw error; return result;
}
function clockFixture() {
  let at = 0; const timers = new Set();
  return {
    timers, now: () => at,
    advance(next) { at = next; for (const timer of [...timers]) if (at >= timer.until) timer.resolve(); },
    waitUntil(until, { signal }) {
      return new Promise((resolve, reject) => {
        const cleanup = () => { timers.delete(timer); signal.removeEventListener("abort", abort); };
        const timer = { until, resolve() { cleanup(); resolve(); } };
        const abort = () => { cleanup(); reject(Error("timer aborted")); };
        timers.add(timer); signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort(); else if (at >= until) timer.resolve();
      });
    },
  };
}
function fixture() {
  const cwd = "C:\\fixture\\travail été", home = "C:\\fixture\\profil";
  const startup = { state_root: "C:\\fixture\\state", mcp_server_ids: ["fixture.mcp"], plugin_ids: ["fixture.plugin"], app_ids: ["fixture.app"], environment_override_names: ["FIXTURE_ENV"] };
  const body = {
    protocol: "aidn-controlled-managed-setup.v2", intent: "execute-managed-setup", invocation_id: "fixture-invocation",
    operation_sha256: A, configuration_sha256: C, approval_sha256: C,
    protocol_config: { operation_sha256: A, client_sha256: B, cwd, expected_codex_home: home,
      limits: { initialize_timeout_ms: 1000, setup_timeout_ms: 8000, max_duration_ms: 10000, max_frame_bytes: 4096, max_total_bytes: 16384, max_frames: 8 } },
    node: { executable: process.execPath, sha256: A },
    powershell: { executable: "C:\\fixture\\pwsh.exe", sha256: A }, job_name: "Local\\aidn-execution-" + "a".repeat(32),
    candidate_root: root, source_inventory: Object.fromEntries(MANAGED_SETUP_BRIDGE_SOURCE_FILES.map(name => [name, C])),
    client: { executable: "C:\\fixture\\codex.exe", sha256: B, args: buildManagedSetupArguments(startup) },
    sidecars: { setup: { executable: "C:\\fixture\\setup.exe", sha256: A }, command_runner: { executable: "C:\\fixture\\runner.exe", sha256: A } },
    cwd, startup, env: { CODEX_HOME: home, TEMP: startup.state_root, TMP: startup.state_root, SystemRoot: "C:\\Windows" },
    limits: { max_stdout_bytes: 16384, max_stderr_bytes: 1024, max_pending_bytes: 4096, stop_timeout_ms: 50 },
    prerequisites: { reference: "C:\\fixture\\prerequisites.json", sha256: A },
  };
  const record = {
    contract_version: "aidn-managed-setup-prerequisites.v2", operation_sha256: A, client_sha256: B, configuration_sha256: C,
    cwd, profile_root: home, node_sha256: A, candidate_inventory_sha256: fingerprint(body.source_inventory),
    environment_sha256: fingerprint(body.env), client_arguments_sha256: fingerprint(body.client.args), startup_sha256: fingerprint(startup), approval_sha256: C,
    observed_at: AT, expires_at: "2026-09-27T12:05:00.000Z", route: { service_enabled: false, registered_core_requested: false },
  };
  const content = Buffer.from(JSON.stringify(record)); body.prerequisites.sha256 = hash(content);
  return { request: seal(body), record, content };
}
function preflight(request) {
  const row = { pid: process.pid, started_at: CREATED, elevated: true, admin_enabled: true, integrity_sid: "S-1-16-12288",
    elevation_type: 2, token_type: 1, has_restrictions: false, restricted_sid_count: 0, is_app_container: false,
    job_name: null, job_member: null };
  return { contract_version: "aidn-managed-setup-preflight.v1", request_sha256: request.request_sha256, phase: "inside_bridge",
    observed_at: AT, status: "OBSERVED", launcher: { ...row }, target: { ...row, job_name: request.job_name, job_member: true },
    helpers: { complete: true, rows: [] }, errors: [] };
}
function fakeProcess(options = {}) {
  const launches = [], writes = []; let kills = 0, child;
  function spawnProcess(executable, args, settings) {
    child = new EventEmitter(); child.pid = 456; child.exitCode = null; child.signalCode = null;
    child.stdin = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin.destroyed = false; child.stdin.writableEnded = false;
    const close = code => { if (child.exitCode !== null) return; child.exitCode = code; child.stdout.emit("end"); child.stderr.emit("end"); child.emit("exit", code, null); child.emit("close", code, null); };
    child.stdin.end = () => { child.stdin.writableEnded = true; if (options.naturalClose !== false) queueMicrotask(() => close(0)); };
    child.kill = () => { kills++; if (options.killCloses !== false) queueMicrotask(() => close(1)); return true; };
    child.stdin.write = (bytes, callback) => {
      writes.push(Buffer.from(bytes));
      if (options.write) return options.write({ child, bytes: Buffer.from(bytes), callback, close });
      const frame = JSON.parse(bytes.toString("utf8"));
      queueMicrotask(() => {
        if (frame.method === "initialize") child.stdout.emit("data", wire({ id: frame.id, result: {
          codexHome: settings.env.CODEX_HOME, platformFamily: "windows", platformOs: "windows", userAgent: "fixture-codex" } }));
        if (frame.method === "windowsSandbox/setupStart") child.stdout.emit("data", Buffer.concat([
          wire({ id: frame.id, result: { started: true } }),
          wire({ method: "windowsSandbox/setupCompleted", params: { mode: "elevated", success: true, error: null } }),
        ]));
        callback();
      });
      return true;
    };
    launches.push({ executable, args: structuredClone(args), settings: structuredClone(settings) });
    if (options.onSpawn) options.onSpawn(child, close, args);
    return child;
  }
  return { spawnProcess, launches, writes, get child() { return child; }, get kills() { return kills; } };
}
function ports(input, fake = fakeProcess()) {
  const clock = clockFixture(), inspections = [];
  return {
    fake, clock, inspections,
    options: {
      spawnProcess: fake.spawnProcess, clock, at: AT,
      async inspectDirectory(file) { inspections.push(file); return { kind: "directory", physical_path: file }; },
      async inspectFile(file, { maxBytes, keepBytes }) {
        inspections.push(file);
        let sha256 = C, bytes = 10, content;
        if (file === input.request.prerequisites.reference) { content = input.content; sha256 = hash(content); bytes = content.length; }
        else if (file === input.request.client.executable) sha256 = B;
        else if ([input.request.node, input.request.powershell, ...Object.values(input.request.sidecars)].some(pin => pin.executable === file)) sha256 = A;
        assert(bytes <= maxBytes);
        return { kind: "file", physical_path: file, sha256, bytes, ...(keepBytes ? { content } : {}) };
      },
      async verifyContainingJob({ request }) { return preflight(request); },
    },
  };
}
function transportOptions(input, fake) {
  return { client: input.request.client, cwd: input.request.cwd, env: input.request.env, startup: input.request.startup, spawnProcess: fake.spawnProcess,
    limits: { max_stdout_bytes: input.request.limits.max_stdout_bytes, max_stderr_bytes: input.request.limits.max_stderr_bytes, max_pending_bytes: input.request.limits.max_pending_bytes } };
}
const initial = () => wire({ id: "aidn.managed-setup.initialize.1", method: "initialize", params: { clientInfo: { name: "aidn_managed_setup_protocol", version: "0.1.0-preparation" } } });

await check("request validation and transport construction have no spawn or file effect", () => {
  const input = fixture(), fake = fakeProcess(); assert.equal(assertManagedSetupBridgeRequest(input.request), true);
  createManagedSetupTransport(transportOptions(input, fake)); assert.equal(fake.launches.length, 0);
});
await check("bridge success retains inner unconfirmed tree and separate actual observation", async () => {
  const input = fixture(), p = ports(input), result = await finish(runManagedSetupBridge(input.request, p.options));
  assert.equal(result.ok, true); assert.equal(result.result.channel.outcome, "indeterminate");
  assert.equal(result.result.channel.reported_setup_result, "succeeded"); assert.equal(result.result.channel.reason_code, null);
  assert.equal(result.result.transport.closed, true); assert.equal(result.result.transport.forced, false);
  assert.equal(result.result.preflight.target.pid, process.pid); assert.equal(result.result.preflight.target.started_at, CREATED);
  assert.equal(result.qualified, false); assert.equal(result.execution_available, false); assert.equal(result.admission_available, false);
  assert.equal(p.fake.launches.length, 1); assert.equal(p.clock.timers.size, 0);
  assert.equal(p.fake.launches[0].settings.shell, false); assert.equal(p.fake.launches[0].settings.detached, false);
  assert.deepEqual(p.fake.launches[0].args, buildManagedSetupArguments(input.request.startup));
});
await check("fixed permission arguments cannot be replaced by a free command", () => {
  const input = fixture(), fake = fakeProcess(), options = transportOptions(input, fake);
  options.client = { ...options.client, args: ["exec", "private"] };
  assert.throws(() => createManagedSetupTransport(options), { code: "SETUP_TRANSPORT_CLIENT_INVALID" });
  assert.equal(fake.launches.length, 0);
});
for (const name of ["NODE_OPTIONS", "CODEX_WINDOWS_REGISTERED_CORE", "HTTPS_PROXY", "AIDN_PG_URL"]) {
  await check("closed environment rejects " + name, () => {
    const input = fixture(), fake = fakeProcess(), options = transportOptions(input, fake);
    options.env = { ...options.env, [name]: "private" };
    assert.throws(() => createManagedSetupTransport(options), { code: "SETUP_TRANSPORT_ENVIRONMENT_INVALID" });
    assert.equal(fake.launches.length, 0);
  });
}
await check("constructor cannot be tricked by hidden args toJSON", () => {
  const input = fixture(), fake = fakeProcess(), options = transportOptions(input, fake), args = ["exec", "forbidden"];
  Object.defineProperty(args, "toJSON", { value: () => buildManagedSetupArguments(input.request.startup) }); options.client = { ...options.client, args };
  assert.throws(() => createManagedSetupTransport(options), { code: "SETUP_TRANSPORT_DATA_INVALID" }); assert.equal(fake.launches.length, 0);
});
await check("wrong method and out of order frame are refused before lazy spawn", async () => {
  const input = fixture(), fake = fakeProcess(), transport = createManagedSetupTransport(transportOptions(input, fake));
  await assert.rejects(transport.send(wire({ method: "turn/start" }), { signal: new AbortController().signal }), { code: "SETUP_TRANSPORT_FRAME_REFUSED" });
  await assert.rejects(transport.send(wire({ method: "initialized" }), { signal: new AbortController().signal }), { code: "SETUP_TRANSPORT_FRAME_REFUSED" });
  assert.equal(fake.launches.length, 0);
});
await check("stdin waits for both write callback and drain", async () => {
  let written; const input = fixture(), fake = fakeProcess({ write(value) { written = value; return false; } });
  const transport = createManagedSetupTransport(transportOptions(input, fake)); let settled = false;
  const sending = transport.send(initial(), { signal: new AbortController().signal }); sending.then(() => { settled = true; });
  await flush(); written.callback(); await flush(); assert.equal(settled, false);
  written.child.stdin.emit("drain"); await finish(sending); assert.equal(settled, true);
  await transport.requestStop({ reason: "SETUP_PROTOCOL_TERMINAL", signal: new AbortController().signal });
});
await check("concurrent send and duplicate frames cannot cross stdin", async () => {
  let written; const input = fixture(), fake = fakeProcess({ write(value) { written = value; return true; } });
  const transport = createManagedSetupTransport(transportOptions(input, fake)), signal = new AbortController().signal;
  const sending = transport.send(initial(), { signal });
  await assert.rejects(transport.send(initial(), { signal }), { code: "SETUP_TRANSPORT_FRAME_REFUSED" });
  written.callback(); await finish(sending);
  await assert.rejects(transport.send(initial(), { signal }), { code: "SETUP_TRANSPORT_FRAME_REFUSED" });
  assert.equal(fake.writes.length, 1); await transport.requestStop({ reason: "SETUP_PROTOCOL_TERMINAL", signal });
});
await check("normal stop closes stdin without kill and never confirms Job", async () => {
  const input = fixture(), fake = fakeProcess(), transport = createManagedSetupTransport(transportOptions(input, fake));
  await transport.send(initial(), { signal: new AbortController().signal });
  const result = await transport.requestStop({ reason: "SETUP_PROTOCOL_TERMINAL", signal: new AbortController().signal });
  assert.deepEqual(result, { termination: "unconfirmed" }); assert.equal(fake.kills, 0);
  assert.equal(transport.getObservation().closed, true); assert.equal(transport.getObservation().forced, false);
});
await check("stop expiry attempts only direct kill and records forced", async () => {
  const input = fixture(), fake = fakeProcess({ naturalClose: false }), transport = createManagedSetupTransport(transportOptions(input, fake));
  await transport.send(initial(), { signal: new AbortController().signal });
  const stop = new AbortController(), pending = transport.requestStop({ reason: "SETUP_PROTOCOL_TERMINAL", signal: stop.signal });
  await flush(); assert.equal(fake.kills, 0); stop.abort(); await finish(pending);
  assert.equal(fake.kills, 1); assert.equal(transport.getObservation().forced, true);
});
await check("stderr limit retains counts without raw private bytes", async () => {
  const input = fixture(), fake = fakeProcess({ write({ child, callback }) {
    child.stderr.emit("data", Buffer.from("private".repeat(200))); callback(); return true;
  } }), p = ports(input, fake);
  const result = await finish(runManagedSetupBridge(input.request, p.options));
  assert.equal(result.result.transport.reason_code, "SETUP_TRANSPORT_STDERR_LIMIT"); assert.equal(result.result.transport.forced, true);
  assert(!JSON.stringify(result).includes("private")); assert.equal(fake.kills, 1);
});
await check("stdout pending queue is bounded even before consumer reads", async () => {
  const input = fixture(), fake = fakeProcess({ write({ child, callback }) {
    child.stdout.emit("data", Buffer.alloc(4097, 32)); callback(); return true;
  } });
  const transport = createManagedSetupTransport(transportOptions(input, fake));
  await assert.rejects(transport.send(initial(), { signal: new AbortController().signal }));
  assert.equal(transport.getObservation().reason_code, "SETUP_TRANSPORT_PENDING_LIMIT");
  assert.equal(transport.getObservation().pending_bytes, 0);
});
await check("single stdout consumer is enforced", () => {
  const input = fixture(), transport = createManagedSetupTransport(transportOptions(input, fakeProcess()));
  transport.stdout[Symbol.asyncIterator]();
  assert.throws(() => transport.stdout[Symbol.asyncIterator](), { code: "SETUP_TRANSPORT_READER_ALREADY_CLAIMED" });
});
await check("stale envelope request hash is refused without inspecting or spawning", async () => {
  const input = fixture(), p = ports(input); input.request.cwd = "C:\\fixture\\foreign";
  const result = await finish(runManagedSetupBridge(input.request, p.options)); assert.equal(result.ok, false);
  assert.equal(p.inspections.length, 0); assert.equal(p.fake.launches.length, 0);
});
for (const [name, edit] of [
  ["node", body => { body.node.sha256 = B; }],
  ["client", body => { body.client.sha256 = C; body.protocol_config.client_sha256 = C; }],
  ["source", body => { body.source_inventory[MANAGED_SETUP_BRIDGE_SOURCE_FILES[0]] = B; }],
  ["sidecar", body => { body.sidecars.setup.sha256 = B; }],
]) await check("changed " + name + " pin refuses spawn", async () => {
  const input = fixture(), p = ports(input), body = bodyOf(input.request); edit(body); input.request = seal(body);
  const result = await finish(runManagedSetupBridge(input.request, p.options)); assert.equal(result.ok, false); assert.equal(p.fake.launches.length, 0);
});
await check("missing prerequisite and malformed UTF8 refuse before preflight", async () => {
  for (const content of [Buffer.from("{}"), Buffer.from([0xff])]) {
    const input = fixture(), p = ports(input), body = bodyOf(input.request); input.content = content;
    body.prerequisites.sha256 = hash(content); input.request = seal(body);
    const result = await finish(runManagedSetupBridge(input.request, p.options)); assert.equal(result.ok, false); assert.equal(p.fake.launches.length, 0);
  }
});
for (const [name, mutate] of [
  ["expired", record => { record.expires_at = AT; }],
  ["future", record => { record.observed_at = "2026-09-27T12:01:00.000Z"; }],
  ["wrong operation", record => { record.operation_sha256 = C; }],
  ["service route", record => { record.route.service_enabled = true; }],
  ["registered core", record => { record.route.registered_core_requested = true; }],
  ["wrong approval", record => { record.approval_sha256 = B; }],
  ["wrong arguments", record => { record.client_arguments_sha256 = B; }],
]) await check("prerequisite " + name + " refuses before app-server", async () => {
  const input = fixture(), p = ports(input); mutate(input.record); input.content = Buffer.from(JSON.stringify(input.record));
  const body = bodyOf(input.request); body.prerequisites.sha256 = hash(input.content); input.request = seal(body);
  const result = await finish(runManagedSetupBridge(input.request, p.options)); assert.equal(result.ok, false); assert.equal(p.fake.launches.length, 0);
});
for (const [name, mutate] of [
  ["boolean", () => true], ["wrong job", report => { report.target.job_name += "f"; return report; }],
  ["not member", report => { report.target.job_member = false; return report; }],
  ["restricted", report => { report.target.has_restrictions = true; return report; }],
  ["medium integrity", report => { report.launcher.integrity_sid = "S-1-16-8192"; return report; }],
  ["admin disabled", report => { report.target.admin_enabled = false; return report; }],
  ["foreign pid", report => { report.target.pid++; return report; }],
  ["outside helper", report => { report.helpers.rows.push({ pid: 789, started_at: CREATED }); return report; }],
  ["invalid creation date", report => { report.target.started_at = "2026-02-31T11:59:59.1234567Z"; return report; }],
  ["partial helpers", report => { report.helpers.complete = false; return report; }],
  ["private extra field", report => { report.secret = "private-value"; return report; }],
]) await check("live preflight " + name + " cannot launch app-server", async () => {
  const input = fixture(), p = ports(input); p.options.verifyContainingJob = async ({ request }) => mutate(preflight(request));
  const result = await finish(runManagedSetupBridge(input.request, p.options)); assert.equal(result.ok, false); assert.equal(p.fake.launches.length, 0);
  assert.equal(result.result.preflight, null); assert(!JSON.stringify(result).includes("private-value"));
});
await check("required live verifier is never inferred from a prerequisite file", async () => {
  const input = fixture(), p = ports(input); delete p.options.verifyContainingJob;
  const result = await finish(runManagedSetupBridge(input.request, p.options));
  assert.equal(result.error.code, "SETUP_BRIDGE_DEPENDENCY_REQUIRED"); assert.equal(p.fake.launches.length, 0);
});
await check("cancelled material check starts no native child", async () => {
  const input = fixture(), p = ports(input), abort = new AbortController(); abort.abort();
  const result = await finish(runManagedSetupBridge(input.request, { ...p.options, signal: abort.signal }));
  assert.equal(result.ok, false); assert.equal(p.fake.launches.length, 0); assert.equal(p.clock.timers.size, 0);
});
await check("native verifier fake spawn uses only pinned PowerShell and exact closed request", async () => {
  const input = fixture(), clock = clockFixture();
  const fake = fakeProcess({ onSpawn(child, close, args) {
    const encoded = args.at(-1), decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    assert.equal(decoded.phase, "inside_bridge"); assert.equal(decoded.target.pid, process.pid); assert.equal(decoded.target.job_name, input.request.job_name);
    queueMicrotask(() => { child.stdout.emit("data", wire(preflight(input.request))); close(0); });
  } });
  const observed = await finish(verifyManagedSetupContainingJob({ request: input.request, signal: new AbortController().signal, spawnProcess: fake.spawnProcess, clock }));
  assert.equal(observed.target.pid, process.pid); assert.equal(fake.launches[0].executable, input.request.powershell.executable);
  assert.deepEqual(fake.launches[0].args.slice(0, 4), ["-NoLogo", "-NoProfile", "-NonInteractive", "-File"]);
  assert.equal(fake.launches[0].settings.stdio[0], "ignore"); assert.equal(clock.timers.size, 0);
});
await check("native verifier refuses late close before deadline waiter settles", async () => {
  for (const elapsed of [5000, 5001]) {
    const input = fixture(); let current = 0;
    const clock = { now: () => current, waitUntil: () => new Promise(() => {}) };
    const fake = fakeProcess({ onSpawn(child, close) {
      queueMicrotask(() => { child.stdout.emit("data", wire(preflight(input.request))); current = elapsed; close(0); });
    } });
    await assert.rejects(finish(verifyManagedSetupContainingJob({ request: input.request,
      signal: new AbortController().signal, spawnProcess: fake.spawnProcess, clock })), { code: "SETUP_BRIDGE_PREFLIGHT_TIMEOUT" });
    assert.equal(fake.kills, 0); assert.equal(fake.launches.length, 1);
  }
});
await check("native verifier refuses a clock regression at final close", async () => {
  const input = fixture(); let current = 10;
  const clock = { now: () => current, waitUntil: () => new Promise(() => {}) };
  const fake = fakeProcess({ onSpawn(child, close) {
    queueMicrotask(() => { child.stdout.emit("data", wire(preflight(input.request))); current = 9; close(0); });
  } });
  await assert.rejects(finish(verifyManagedSetupContainingJob({ request: input.request,
    signal: new AbortController().signal, spawnProcess: fake.spawnProcess, clock })), { code: "SETUP_BRIDGE_CLOCK_INVALID" });
});
await check("native verifier refuses cancellation accompanying normal close", async () => {
  const input = fixture(), clock = clockFixture(), abort = new AbortController();
  const fake = fakeProcess({ onSpawn(child, close) {
    queueMicrotask(() => { child.stdout.emit("data", wire(preflight(input.request))); close(0); abort.abort(); });
  } });
  await assert.rejects(finish(verifyManagedSetupContainingJob({ request: input.request,
    signal: abort.signal, spawnProcess: fake.spawnProcess, clock })), { code: "SETUP_BRIDGE_CANCELLED" });
  assert.equal(fake.kills, 0);
});
await check("native verifier timeout kills direct fake preflight without setup", async () => {
  const input = fixture(), clock = clockFixture(), fake = fakeProcess();
  const task = verifyManagedSetupContainingJob({ request: input.request, signal: new AbortController().signal, spawnProcess: fake.spawnProcess, clock });
  await flush(); clock.advance(5000);
  await assert.rejects(finish(task), { code: "SETUP_BRIDGE_PREFLIGHT_TIMEOUT" });
  assert.equal(fake.kills, 1); assert.equal(fake.launches.length, 1); assert.equal(fake.launches[0].executable, input.request.powershell.executable);
});
await check("native verifier stdout and raw errors never become a success receipt", async () => {
  const input = fixture(), clock = clockFixture(), fake = fakeProcess({ onSpawn(child, close) {
    queueMicrotask(() => { child.stdout.emit("data", Buffer.alloc(65537, 32)); close(1); });
  } });
  await assert.rejects(finish(verifyManagedSetupContainingJob({ request: input.request, signal: new AbortController().signal, spawnProcess: fake.spawnProcess, clock })),
    { code: "SETUP_BRIDGE_PREFLIGHT_OUTPUT_LIMIT" });
});

await check("expiry reached during live preflight forbids lazy app-server spawn", async () => {
  const input = fixture(), p = ports(input); input.record.expires_at = "2026-09-27T12:00:01.000Z";
  input.content = Buffer.from(JSON.stringify(input.record)); const body = bodyOf(input.request);
  body.prerequisites.sha256 = hash(input.content); input.request = seal(body);
  p.options.verifyContainingJob = async ({ request }) => { p.clock.advance(1500); return preflight(request); };
  const result = await finish(runManagedSetupBridge(input.request, p.options));
  assert.equal(result.error.code, "SETUP_BRIDGE_PREREQUISITE_STALE"); assert.equal(p.fake.launches.length, 0);
});
await check("client is checked again after native preflight", async () => {
  const input = fixture(), p = ports(input), inspect = p.options.inspectFile; let checked = 0;
  p.options.inspectFile = async (file, options) => {
    const result = await inspect(file, options); if (file === input.request.client.executable && ++checked === 2) result.sha256 = C;
    return result;
  };
  const result = await finish(runManagedSetupBridge(input.request, p.options));
  assert.equal(result.error.code, "SETUP_BRIDGE_FILE_PIN_MISMATCH"); assert.equal(checked, 2); assert.equal(p.fake.launches.length, 0);
});
await check("preflight time cannot extend the whole bridge deadline", async () => {
  const input = fixture(), fake = fakeProcess({ write({ child, bytes, callback }) {
    const frame = JSON.parse(bytes.toString("utf8"));
    queueMicrotask(() => {
      if (frame.method === "initialize") child.stdout.emit("data", wire({ id: frame.id, result: {
        codexHome: input.request.protocol_config.expected_codex_home, platformFamily: "windows", platformOs: "windows", userAgent: "fixture" } }));
      if (frame.method === "windowsSandbox/setupStart") child.stdout.emit("data", wire({ id: frame.id, result: { started: true } }));
      callback();
    });
    return true;
  } }), p = ports(input, fake);
  p.options.verifyContainingJob = async ({ request }) => { p.clock.advance(4000); return preflight(request); };
  const task = runManagedSetupBridge(input.request, p.options);
  await flush(1200); assert.equal(fake.launches.length, 1); p.clock.advance(10000);
  const result = await finish(task); assert.equal(result.ok, false); assert.equal(result.error.code, "SETUP_BRIDGE_TIMEOUT");
  assert.equal(result.result.channel.reported_setup_result, null); assert.equal(fake.kills, 1); assert.equal(p.clock.timers.size, 0);
});
await check("native verifier cancellation uses one-second stop bound for a nonclosing child", async () => {
  const input = fixture(), clock = clockFixture(), fake = fakeProcess({ killCloses: false }), abort = new AbortController();
  const task = verifyManagedSetupContainingJob({ request: input.request, signal: abort.signal, spawnProcess: fake.spawnProcess, clock });
  await flush(); abort.abort(); await flush(); assert.equal(fake.kills, 1); clock.advance(1000);
  await assert.rejects(finish(task), { code: "SETUP_BRIDGE_PREFLIGHT_STOP_UNCONFIRMED" });
  assert.equal(fake.launches.length, 1);
});
await check("no transport restart after stop and no implicit launch from stdout read", async () => {
  const input = fixture(), fake = fakeProcess(), transport = createManagedSetupTransport(transportOptions(input, fake));
  const next = transport.stdout[Symbol.asyncIterator]().next(); assert.equal(fake.launches.length, 0);
  await transport.requestStop({ reason: "cancel", signal: new AbortController().signal });
  assert.equal((await next).done, true);
  await assert.rejects(transport.send(initial(), { signal: new AbortController().signal }), { code: "SETUP_TRANSPORT_CANCELLED" });
  assert.equal(fake.launches.length, 0);
});
await check("sparse arguments cannot masquerade as the closed vector", () => {
  const input = fixture(), fake = fakeProcess(), options = transportOptions(input, fake), args = buildManagedSetupArguments(input.request.startup);
  delete args[0]; args["4294967295"] = "extra"; options.client = { ...options.client, args };
  assert.throws(() => createManagedSetupTransport(options), { code: "SETUP_TRANSPORT_DATA_INVALID" }); assert.equal(fake.launches.length, 0);
});
await check("cyclic plain input is refused before transport activity", () => {
  const input = fixture(), fake = fakeProcess(), options = transportOptions(input, fake); options.env.self = options.env;
  assert.throws(() => createManagedSetupTransport(options), { code: "SETUP_TRANSPORT_DATA_INVALID" }); assert.equal(fake.launches.length, 0);
});
await check("boolean and limited elevation type cannot substitute a primary elevated token", async () => {
  for (const elevation of [true, "full", 3]) {
    const input = fixture(), p = ports(input);
    p.options.verifyContainingJob = async ({ request }) => { const observed = preflight(request); observed.target.elevation_type = elevation; return observed; };
    const result = await finish(runManagedSetupBridge(input.request, p.options)); assert.equal(result.ok, false); assert.equal(p.fake.launches.length, 0);
  }
});
await check("source identity is pinned to the bridge actually imported", async () => {
  const input = fixture(), p = ports(input), body = bodyOf(input.request); body.candidate_root = "C:\\fixture\\foreign-source";
  const result = await finish(runManagedSetupBridge(seal(body), p.options));
  assert.equal(result.error.code, "SETUP_BRIDGE_SOURCE_IDENTITY"); assert.equal(p.fake.launches.length, 0);
});
await check("client-specific bound is 512 MiB and nonclient bound remains 256 MiB", async () => {
  const input = fixture(), p = ports(input), inspect = p.options.inspectFile;
  const seen = new Map();
  p.options.inspectFile = async (file, options) => { seen.set(file, options.maxBytes); return inspect(file, options); };
  assert.equal((await finish(runManagedSetupBridge(input.request, p.options))).ok, true);
  assert.equal(seen.get(input.request.client.executable), 512 * 1024 * 1024);
  assert.equal(seen.get(input.request.sidecars.command_runner.executable), 256 * 1024 * 1024);
  assert.equal(seen.get(input.request.powershell.executable), 256 * 1024 * 1024);
});
await check("startup is closed explicit and produces matching observation/setup settings", () => {
  const { request } = fixture(), original = structuredClone(request.startup);
  assert.equal(assertManagedSetupStartup(request.startup, { cwd: request.cwd, profile_root: request.env.CODEX_HOME, candidate_root: request.candidate_root }), true);
  const paths = buildManagedSetupStartupPaths(request.startup), args = buildManagedSetupArguments(request.startup);
  const common = buildCodexStartupArguments({ ...Object.fromEntries(Object.entries(request.startup).filter(([key]) => key !== "state_root")),
    environment_names: CODEX_STARTUP_ENVIRONMENT_PROFILES.managed, log_dir: paths.log_dir, sqlite_home: paths.sqlite_home });
  assert.deepEqual(args.slice(18, -3), common); assert.deepEqual(args.slice(-3), ["app-server", "--listen", "stdio://"]);
  assert(args.includes("agents.enabled=false")); assert(args.includes('log_dir="C:\\\\fixture\\\\state\\\\logs"'));
  assert(args.includes('sqlite_home="C:\\\\fixture\\\\state\\\\sqlite"'));
  assert(!args.some(value => /^(model|model_reasoning_effort|reasoning_effort)=/u.test(value)));
  assert.deepEqual(request.startup, original);
  assert.throws(() => buildManagedSetupArguments());
  assert.throws(() => assertManagedSetupStartup({ ...request.startup, model: "fallback" }));
});
await check("startup path derivation is pure across Windows and POSIX", () => {
  const { request } = fixture(), startup = { ...request.startup, state_root: "/fixture/state été" };
  assert.deepEqual(buildManagedSetupStartupPaths(startup), { state_root: "/fixture/state été", log_dir: "/fixture/state été/logs", sqlite_home: "/fixture/state été/sqlite" });
  assert.equal(assertManagedSetupStartup(startup, { cwd: "/fixture/work", profile_root: "/fixture/profile", candidate_root: "/fixture/candidate" }), true);
});
for (const stateRoot of ["relative", "C:state", "C:\\fixture\\state\\..", "C:\\fixture\\state.", "C:\\fixture\\state ", "C:\\fixture\\CON", "C:\\fixture\\state:stream", "\\\\server\\share\\state", "\\\\?\\C:\\state", "/fixture/../state", "/fixture/state/", "/fixture\\state"]) await check("startup rejects path alias " + stateRoot, () => {
  const { request } = fixture(); assert.throws(() => buildManagedSetupStartupPaths({ ...request.startup, state_root: stateRoot }), /MANAGED_STARTUP_PATH_INVALID/u);
});
await check("startup refuses getters and sparse arrays without executing them", () => {
  const { request } = fixture(), startup = { ...request.startup }; let observed = false;
  Object.defineProperty(startup, "state_root", { enumerable: true, get() { observed = true; return "C:\\fixture\\state"; } });
  assert.throws(() => assertManagedSetupStartup(startup), /MANAGED_STARTUP_DATA_INVALID/u); assert.equal(observed, false);
  const ids = ["one", "two"]; delete ids[0]; ids["4294967295"] = "hidden";
  assert.throws(() => assertManagedSetupStartup({ ...request.startup, mcp_server_ids: ids }), /MANAGED_STARTUP_DATA_INVALID/u);
});
for (const field of ["cwd", "profile_root", "candidate_root"]) await check("startup requires disjoint " + field + " in both directions", () => {
  const { request } = fixture(), context = { cwd: request.cwd, profile_root: request.env.CODEX_HOME, candidate_root: request.candidate_root };
  for (const overlap of [request.startup.state_root, request.startup.state_root + "\\child", "C:\\FIXTURE"]) {
    assert.throws(() => assertManagedSetupStartup(request.startup, { ...context, [field]: overlap }), /MANAGED_STARTUP_ROOT_OVERLAP/u);
  }
  assert.throws(() => assertManagedSetupStartup(request.startup, { cwd: request.cwd }), /MANAGED_STARTUP_CONTEXT_INVALID/u);
});
await check("legacy v1 and missing startup cannot reach inspectors or launch", async () => {
  for (const variant of ["v1", "missing"]) {
    const input = fixture(), p = ports(input), body = bodyOf(input.request);
    if (variant === "v1") body.protocol = "aidn-controlled-managed-setup.v1"; else delete body.startup;
    const result = await finish(runManagedSetupBridge(seal(body), p.options)); assert.equal(result.ok, false);
    assert.equal(p.inspections.length, 0); assert.equal(p.fake.launches.length, 0);
  }
});
for (const changed of ["state", "integration", "temp", "tmp", "home", "candidate", "common-pin"]) await check("startup mismatch " + changed + " refuses before any inspection", async () => {
  const input = fixture(), p = ports(input), body = bodyOf(input.request);
  if (changed === "state") body.startup = { ...body.startup, state_root: "C:\\fixture\\other-state" };
  if (changed === "integration") body.startup = { ...body.startup, mcp_server_ids: ["different"] };
  if (changed === "temp") body.env = { ...body.env, TEMP: "C:\\fixture\\ambient" };
  if (changed === "tmp") body.env = { ...body.env, TMP: "C:\\fixture\\ambient" };
  if (changed === "home") { body.env = { ...body.env, CODEX_HOME: body.startup.state_root }; body.protocol_config = { ...body.protocol_config, expected_codex_home: body.startup.state_root }; }
  if (changed === "candidate") body.candidate_root = body.startup.state_root;
  if (changed === "common-pin") { body.source_inventory = { ...body.source_inventory }; delete body.source_inventory["src/core/agents/codex-startup-arguments.mjs"]; }
  const result = await finish(runManagedSetupBridge(seal(body), p.options)); assert.equal(result.ok, false);
  assert.equal(p.inspections.length, 0); assert.equal(p.fake.launches.length, 0);
});
await check("v2 prerequisite binds startup and never accepts v1", async () => {
  for (const change of ["version", "startup"]) {
    const input = fixture(), p = ports(input);
    if (change === "version") input.record.contract_version = "aidn-managed-setup-prerequisites.v1"; else input.record.startup_sha256 = C;
    input.content = Buffer.from(JSON.stringify(input.record)); const body = bodyOf(input.request); body.prerequisites.sha256 = hash(input.content); input.request = seal(body);
    const result = await finish(runManagedSetupBridge(input.request, p.options)); assert.equal(result.ok, false); assert.equal(p.fake.launches.length, 0);
  }
});
await check("startup directories must already exist and are rechecked after live preflight", async () => {
  for (const stage of [1, 2]) for (const field of ["state_root", "log_dir", "sqlite_home"]) {
    const input = fixture(), p = ports(input), selected = buildManagedSetupStartupPaths(input.request.startup)[field]; let count = 0;
    p.options.inspectDirectory = async directory => {
      if (directory === selected && ++count === stage) return { kind: "missing", physical_path: directory };
      return { kind: "directory", physical_path: directory };
    };
    const result = await finish(runManagedSetupBridge(input.request, p.options)); assert.equal(result.error.code, "SETUP_BRIDGE_DIRECTORY_MISMATCH");
    assert.equal(p.fake.launches.length, 0); assert.equal(count, stage);
  }
});
await check("startup directory alias cannot satisfy a physical observation", async () => {
  const input = fixture(), p = ports(input), selected = buildManagedSetupStartupPaths(input.request.startup).log_dir;
  p.options.inspectDirectory = async directory => ({ kind: "directory", physical_path: directory === selected ? "C:\\fixture\\foreign" : directory });
  assert.equal((await finish(runManagedSetupBridge(input.request, p.options))).error.code, "SETUP_BRIDGE_DIRECTORY_MISMATCH");
  assert.equal(p.fake.launches.length, 0);
});
await check("module import and injected execution do not write spawn real children or access network", async () => {
  const fs = (await import("node:fs")).default, cp = (await import("node:child_process")).default;
  const net = (await import("node:net")).default, { syncBuiltinESMExports } = await import("node:module");
  const saved = [], forbidden = () => { throw Error("UNEXPECTED_REAL_EFFECT"); };
  for (const [object, names] of [[fs, ["writeFileSync", "writeFile", "mkdirSync", "mkdir", "rmSync", "rm", "unlink", "unlinkSync", "rename", "renameSync"]],
    [fs.promises, ["writeFile", "mkdir", "rm", "unlink", "rename"]], [cp, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]],
    [net, ["connect", "createConnection", "createServer"]], [globalThis, ["fetch"]]]) {
    for (const name of names) { saved.push([object, name, object[name]]); object[name] = forbidden; }
  }
  syncBuiltinESMExports();
  try {
    const bridge = await import("../../src/adapters/agents/process-tree/codex-managed-setup-bridge.mjs?purity");
    const input = fixture(), p = ports(input);
    assert.equal((await finish(bridge.runManagedSetupBridge(input.request, p.options))).ok, true);
  } finally { for (const [object, name, original] of saved) object[name] = original; syncBuiltinESMExports(); }
});

const failed = checks.filter(row => row.status === "FAIL");
process.stdout.write(JSON.stringify({ status: failed.length ? "FAIL" : "PASS", checks, pass: checks.length - failed.length, fail: failed.length,
  cleanup: { status: "PASS", created_resources: 0 }, evidence: "portable in-memory inspection, spawn and process doubles",
  native_processes: "NOT_RUN", native_codex: "NOT_EXECUTED", native_setup: "NOT_EXECUTED", qualification: "NOT_RUN" }, null, 2) + "\n");
if (failed.length) process.exitCode = 1;
