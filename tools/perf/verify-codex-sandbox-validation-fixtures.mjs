import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { fingerprintAgentExecutionValue as fingerprint } from "../../src/core/agents/agent-execution-contracts.mjs";
import { assertCodexSandboxValidationConfiguration as validate, fingerprintCodexSandboxValidationConfiguration,
  buildCodexSandboxValidationInvocation as build, createCodexValidationStreamParser as parser, getCodexSandboxValidationLaunchSupport,
  createCodexSandboxValidationBoundary, createCodexSandboxValidationJournal, inspectCodexSandboxValidationBinaryPins } from "../../src/adapters/runtime/codex-sandbox-validation-boundary.mjs";
import { buildCodexValidationQualificationPlan, executeCodexValidationQualificationCase } from "../verify/qualify-codex-validation-boundary.mjs";

const checks = [], H = "a".repeat(64);
async function check(name, fn) { try { await fn(); checks.push({ name, status: "PASS" }); } catch (error) { checks.push({ name, status: "FAIL", detail: String(error.stack ?? error).slice(0, 2000) }); } }
const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-sandbox-contract-")), token = "owned-fixture";
fs.writeFileSync(path.join(root, "owner"), token, { flag: "wx" });
function fixture() {
  const roots = { snapshots: path.join(root, "snapshots"), scratch: path.join(root, "scratch"), supervisor: path.join(root, "supervisor") };
  const home = path.join(root, "home"), executable = path.join(root, "fake.exe"), env = { SystemRoot: process.env.SystemRoot ?? path.join(root, "system"), TEMP: roots.scratch, TMP: roots.scratch };
  const effective = { windows_sandbox: "elevated", provisioning: "existing-only", network_enabled: false, filesystem: [
    { path: ":root", access: "deny" }, { path: ":minimal", access: "read" }, { path: roots.snapshots, access: "read" },
    { path: roots.scratch, access: "write" }, { path: roots.supervisor, access: "deny" }, { path: home, access: "deny" }] };
  const config = { contract_version: "codex-sandbox-validation-configuration.v1", boundary_id: "codex-sandbox-validation", platform: "win32", architecture: "x64",
    engine_sha256: H, verification_policy_sha256: H, environment_sha256: fingerprint(env), client: { executable, sha256: H }, runner: { executable, sha256: H },
    controller: { helperPath: executable, helperSha256: H, helperSourceSha256: H, candidateSha256: H }, trampoline: { executable, sha256: H, source_sha256: H },
    profile: { id: "aidn-fixture", home, home_identity_sha256: H, config_layers: [{ path: path.join(home, "config.toml"), present: false }],
      provisioning_files: [{ path: path.join(home, "existing-setup-marker"), present: true, bytes: 1, sha256: H }],
      environment_override_names: ["NODE_OPTIONS"], effective_policy: effective, effective_policy_sha256: fingerprint(effective) }, roots,
    launcher_environment: { ...env, CODEX_HOME: home } };
  const invocation = { invocation_id: "case.fixture", boundary_id: config.boundary_id, validation_id: "check.fixture", executable,
    executable_sha256: H, argv: ["check espace été.mjs"], cwd: path.join(roots.snapshots, "snapshot espace été"), environment_sha256: fingerprint(env), max_duration_ms: 30000, max_output_bytes: 1024 };
  return { config, request: { ...invocation, request_sha256: fingerprint(invocation), environment: env } };
}
const mutate = (input, fn) => { const next = structuredClone(input); fn(next); return next; };
const code = expected => error => error.code === expected;
const frame = (request, sequence, type, rest) => Buffer.from(JSON.stringify({ protocol: "aidn-validation-trampoline.v1", runner_id: request.invocation_id, request_sha256: request.request_sha256, sequence, type, ...rest }) + "\n");
const prepared = request => ({ pid: 71, started_at: "2026-01-01T00:00:00Z", job_name: `Local\\aidn-execution-${"b".repeat(32)}`, environment_sha256: request.environment_sha256, executable_sha256: request.executable_sha256, job_assigned: true,
  parent_job_name: `Local\\aidn-execution-${fingerprint({ invocation_id: request.invocation_id, request_sha256: request.request_sha256 }).slice(0, 32)}`, parent_job_member: true });
const terminal = request => ({ ...prepared(request), termination_state: "confirmed", active_processes: 0, exit_code: 0, outcome: "completed", observed_at: "2026-01-01T00:00:00Z" });

try {
await check("pure config and invocation preserve inputs and use exact structured argv", () => {
  const { config, request } = fixture(), before = structuredClone({ config, request });
  assert.equal(validate(config), true); const launch = build(config, request);
  assert.equal(fingerprintCodexSandboxValidationConfiguration(config), fingerprint(config));
  assert.deepEqual({ config, request }, before); assert.equal(launch.executable, config.client.executable);
  assert.deepEqual(launch.args.slice(0, 5), ["sandbox", "--permission-profile", "aidn-fixture", "--cd", request.cwd]);
  assert.equal(launch.args.at(-1), config.trampoline.executable); assert.equal(launch.args.at(-2), "--");
  assert(!launch.args.some(arg => /sandbox-state|full-access|setup|externalSandbox/.test(arg)));
  const input = JSON.parse(launch.stdin); assert.deepEqual(JSON.parse(input.environment_json), request.environment);
  assert.equal(input.environment_sha256, request.environment_sha256); assert(!Object.hasOwn(launch.env, "NODE_OPTIONS"));
});
for (const [name, transform] of [
  ["implicit setup", c => { c.profile.effective_policy.provisioning = "auto"; }],
  ["network enabled", c => { c.profile.effective_policy.network_enabled = true; }],
  ["weaker backend", c => { c.profile.effective_policy.windows_sandbox = "unelevated"; }],
  ["snapshot write grant", c => { c.profile.effective_policy.filesystem[2].access = "write"; }],
  ["missing supervisor deny", c => { c.profile.effective_policy.filesystem.splice(4, 1); }],
  ["missing home deny", c => { c.profile.effective_policy.filesystem.splice(5, 1); }],
  ["profile alias", c => { c.profile.id = "../default"; }],
  ["unobserved provisioning", c => { c.profile.provisioning_files[0] = { path: c.profile.provisioning_files[0].path, present: false }; }],
  ["empty config layers", c => { c.profile.config_layers = []; }],
  ["ambient credential launcher env", c => { c.launcher_environment.PGPASSWORD = "fixture"; }],
  ["case collision launcher env", c => { c.launcher_environment.temp = c.launcher_environment.TEMP; }],
  ["override reserved env", c => { c.profile.environment_override_names = ["codex_home"]; }],
  ["case collision overrides", c => { c.profile.environment_override_names = ["NODE_OPTIONS", "node_options"]; }],
]) await check(`configuration refuses ${name}`, () => {
  const { config } = fixture(); transform(config); config.profile.effective_policy_sha256 = fingerprint(config.profile.effective_policy); assert.throws(() => validate(config));
});
for (const [name, change] of [
  ["parent cwd", r => { r.cwd = root; }], ["another executable", r => { r.executable = process.execPath; }],
  ["nonpositive duration", r => { r.max_duration_ms = 0; }], ["unbounded output", r => { r.max_output_bytes = 0; }],
  ["NUL argv", r => { r.argv = ["x\0y"]; }], ["foreign boundary", r => { r.boundary_id = "other"; }],
]) await check(`request refuses ${name}`, () => { const { config, request } = fixture(); change(request);
  const { environment, request_sha256, ...invocation } = request; request.request_sha256 = fingerprint(invocation); assert.throws(() => build(config, request)); });
await check("child env cannot add startup injections even with recomputed request fingerprint", () => {
  const { config, request } = fixture(); request.environment.NODE_OPTIONS = "--import bad";
  request.environment_sha256 = fingerprint(request.environment); config.environment_sha256 = request.environment_sha256;
  const { environment, request_sha256, ...invocation } = request; request.request_sha256 = fingerprint(invocation);
  assert.throws(() => build(config, request), code("SANDBOX_ENVIRONMENT_REFUSED"));
});
await check("construction and unavailable qualification launch nothing and create nothing", async () => {
  const { config, request } = fixture(), before = fs.readdirSync(root).sort(), { publicKey } = generateKeyPairSync("ed25519");
  const boundary = createCodexSandboxValidationBoundary({ configuration: config, publicKey, evidenceRoot: root });
  assert.deepEqual(boundary.getDescriptor(), { boundary_id: config.boundary_id, qualification: null });
  assert.equal((await boundary.checkAvailability()).available, false);
  await assert.rejects(boundary.run(request)); assert.deepEqual(fs.readdirSync(root).sort(), before);
  await assert.rejects(boundary.run(request), code("SANDBOX_CLIENT_UNQUALIFIED"));
});
await check("reviewed client cannot launch even with signed positive declarative qualification", async () => {
  const { config, request } = fixture(), before = fs.readdirSync(root).sort(), { publicKey, privateKey } = generateKeyPairSync("ed25519");
  config.client.sha256 = "8f0554ede25bbc5450921897c468b2e84635aa513c5017457997af0954581f49";
  const payload = { contract_version: "agent-verification-boundary.v1", boundary_id: config.boundary_id, evidence_class: "native", platform: "win32",
    configuration_sha256: fingerprint(config), engine_sha256: config.engine_sha256, policy_sha256: config.verification_policy_sha256,
    executable_sha256: config.runner.sha256, environment_sha256: config.environment_sha256, snapshot_read_only: true,
    supervisor_resources_inaccessible: true, network_disabled: true, descendant_termination: true, child_environment_observed: true,
    host_preserved: true, provisioning_performed: false, qualification_plan_sha256: H,
    evidence: ["filesystem", "network", "timeout", "cancel", "callback"].map(name => ({ ref: `${name}.json`, sha256: H, bytes: 1 })) };
  const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
  const qualification = { payload, signature: sign(null, Buffer.from(canonical(payload)), privateKey).toString("base64") };
  const boundary = createCodexSandboxValidationBoundary({ configuration: config, qualification, publicKey, evidenceRoot: root });
  assert.equal(getCodexSandboxValidationLaunchSupport(config).reviewed_client.source_commit, "0d9c7cbfa6cf1489f55a8a9542b75ddd2c061807");
  assert.deepEqual(await boundary.checkAvailability(), { available: false, native: false, reason_code: "SANDBOX_EXISTING_ONLY_UNSUPPORTED" });
  await assert.rejects(boundary.run(request), code("SANDBOX_EXISTING_ONLY_UNSUPPORTED"));
  assert.deepEqual(await boundary.inspectOperations(), { operations: [], uncertain_read: null });
  assert.deepEqual(fs.readdirSync(root).sort(), before);
});
await check("unknown client never inherits reviewed support or launches a fallback", async () => {
  const { config, request } = fixture(), { publicKey } = generateKeyPairSync("ed25519"), before = fs.readdirSync(root).sort();
  const support = getCodexSandboxValidationLaunchSupport(config); assert.equal(support.reason_code, "SANDBOX_CLIENT_UNQUALIFIED");
  assert.equal(support.reviewed_client, null); assert.equal(support.available, false);
  const boundary = createCodexSandboxValidationBoundary({ configuration: config, publicKey, evidenceRoot: root });
  await assert.rejects(boundary.run(request), code("SANDBOX_CLIENT_UNQUALIFIED")); assert.deepEqual(fs.readdirSync(root).sort(), before);
});
await check("pre-cancelled invocation never requires executable or config files", async () => {
  const { config, request } = fixture(), { publicKey } = generateKeyPairSync("ed25519"), stop = new AbortController(); stop.abort();
  const boundary = createCodexSandboxValidationBoundary({ configuration: config, publicKey, evidenceRoot: root });
  const result = await boundary.run(request, { signal: stop.signal }); assert.equal(result.termination_state, "not_started"); assert.equal(result.reason_code, "SANDBOX_CANCELLED");
});
// Sparse fixture bytes are never retained in memory. NTFS needs its explicit
// per-file sparse flag; this does not configure any host or sandbox resource.
const binaryRoot = path.join(root, "binary-pins");
const smallBinary = path.join(binaryRoot, "small.exe"), largeBinary = path.join(binaryRoot, "sparse.exe");
await check("owned sparse binary fixture preparation", () => {
  fs.mkdirSync(binaryRoot); fs.writeFileSync(smallBinary, "pinned fixture"); fs.writeFileSync(largeBinary, "", { flag: "wx" });
  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot;
    assert(path.isAbsolute(systemRoot));
    const sparse = spawnSync(path.join(systemRoot, "System32", "fsutil.exe"), ["sparse", "setflag", largeBinary],
      { encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 4096, env: { SystemRoot: systemRoot } });
    assert.equal(sparse.error, undefined); assert.equal(sparse.status, 0, "owned sparse fixture setup failed");
  }
});
const zeroBlock = Buffer.alloc(65536), binaryBytes = 256 * 1024 * 1024 + 1;
const zeroHash = createHash("sha256");
for (let remaining = binaryBytes; remaining > 0; remaining -= zeroBlock.length) zeroHash.update(zeroBlock.subarray(0, Math.min(remaining, zeroBlock.length)));
const largeDigest = zeroHash.digest("hex"), smallDigest = createHash("sha256").update("pinned fixture").digest("hex");
function pinnedConfig() {
  const { config } = fixture();
  for (const entry of [config.client, config.runner, config.trampoline]) { entry.executable = smallBinary; entry.sha256 = smallDigest; }
  config.controller.helperPath = smallBinary; config.controller.helperSha256 = smallDigest;
  const sourcePin = relative => createHash("sha256").update(fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)))).digest("hex");
  config.trampoline.source_sha256 = sourcePin("../../src/adapters/runtime/codex-validation-trampoline.cs");
  config.controller.candidateSha256 = sourcePin("../../src/adapters/agents/process-tree/windows-process-tree-controller.mjs");
  config.controller.helperSourceSha256 = sourcePin("../../src/adapters/agents/process-tree/windows-job-helper.cs");
  return config;
}
await check("read-only client pin accepts a streamed binary larger than 256 MiB without native qualification", async () => {
  fs.truncateSync(largeBinary, binaryBytes);
  const config = pinnedConfig(); config.client = { executable: largeBinary, sha256: largeDigest };
  const before = fs.statSync(largeBinary); await inspectCodexSandboxValidationBinaryPins(config);
  const after = fs.statSync(largeBinary); assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(getCodexSandboxValidationLaunchSupport(config).available, false);
});
await check("streamed oversized client still rejects a mismatching pin", async () => {
  const config = pinnedConfig(); config.client = { executable: largeBinary, sha256: H };
  await assert.rejects(inspectCodexSandboxValidationBinaryPins(config), code("SANDBOX_BINARY_CHANGED"));
});
await check("runner and trampoline retain their 256 MiB binary limit", async () => {
  for (const role of ["runner", "trampoline"]) {
    const config = pinnedConfig(); config[role].executable = largeBinary; config[role].sha256 = largeDigest;
    await assert.rejects(inspectCodexSandboxValidationBinaryPins(config), code("SANDBOX_FILE_LIMIT"));
  }
});
await check("aliased client and runner pin objects cannot widen the runner limit", async () => {
  const config = pinnedConfig(); config.client = { executable: largeBinary, sha256: largeDigest }; config.runner = config.client;
  await assert.rejects(inspectCodexSandboxValidationBinaryPins(config), code("SANDBOX_FILE_LIMIT"));
});
await check("client inspection refuses bytes beyond 512 MiB before reading them", async () => {
  fs.truncateSync(largeBinary, 512 * 1024 * 1024 + 1);
  const config = pinnedConfig(); config.client = { executable: largeBinary, sha256: H };
  await assert.rejects(inspectCodexSandboxValidationBinaryPins(config), code("SANDBOX_FILE_LIMIT"));
});
await check("stream parser isolates candidate bytes and handles split multibyte frames", () => {
  const { request } = fixture(), stream = parser(request), expected = Buffer.from('é{"status":"passed"}');
  const content = Buffer.concat([frame(request, 1, "prepared", prepared(request)), frame(request, 2, "stdout", { data: expected.toString("base64") }), frame(request, 3, "terminal", terminal(request))]);
  for (let offset = 0; offset < content.length; offset += 7) stream.consume(content.subarray(offset, offset + 7));
  assert.deepEqual(stream.finish().stdout, expected);
});
for (const [name, make] of [
  ["foreign invocation", r => frame({ ...r, invocation_id: "foreign" }, 1, "prepared", prepared(r))],
  ["foreign env", r => frame(r, 1, "prepared", { ...prepared(r), environment_sha256: "0".repeat(64) })],
  ["no job membership", r => frame(r, 1, "prepared", { ...prepared(r), job_assigned: false })],
  ["no outer job membership", r => frame(r, 1, "prepared", { ...prepared(r), parent_job_member: false })],
  ["another outer job", r => frame(r, 1, "prepared", { ...prepared(r), parent_job_name: `Local\\aidn-execution-${"0".repeat(32)}` })],
  ["out of order event", r => frame(r, 2, "prepared", prepared(r))],
  ["arbitrary raw output", () => Buffer.from("worker output\n")],
]) await check(`stream refuses ${name}`, () => { const { request } = fixture(); assert.throws(() => parser(request).consume(make(request))); });
await check("unknown descendants never count as confirmed", () => { const { request } = fixture(), stream = parser(request);
  stream.consume(frame(request, 1, "prepared", prepared(request))); assert.throws(() => stream.consume(frame(request, 2, "terminal", { ...terminal(request), active_processes: 1 })), code("SANDBOX_STOP_UNCONFIRMED")); });
await check("output cap counts decoded candidate bytes", () => { const { request } = fixture(), stream = parser(request);
  stream.consume(frame(request, 1, "prepared", prepared(request))); assert.throws(() => stream.consume(frame(request, 2, "stdout", { data: Buffer.alloc(1025).toString("base64") })), code("SANDBOX_OUTPUT_LIMIT")); });
await check("terminal required and late emissions rejected", () => { const { request } = fixture(), stream = parser(request);
  stream.consume(frame(request, 1, "prepared", prepared(request))); assert.throws(() => stream.finish(), code("SANDBOX_STOP_UNCONFIRMED"));
  stream.consume(frame(request, 2, "terminal", terminal(request))); assert.throws(() => stream.consume(frame(request, 3, "stdout", { data: "" })), code("SANDBOX_PROTOCOL_INVALID")); });
await check("qualification preview is pure, pins effects and does not authorize execution", async () => {
  const { config, request } = fixture(), before = fs.readdirSync(root).sort();
  const hostBaseline = Object.fromEntries(["configuration_sha256", "provisioning_sha256", "accounts_sha256", "acl_sha256", "firewall_sha256"].map(key => [key, H]));
  const plan = buildCodexValidationQualificationPlan({ configuration: config, environment: request.environment, probe: { path: path.join(request.cwd, "probe.mjs"), sha256: H }, cwd: request.cwd,
    canaries: { snapshot_file: path.join(request.cwd, "canary"), scratch_file: path.join(config.roots.scratch, "canary"), supervisor_file: path.join(config.roots.supervisor, "canary") },
    networkPort: 34567, challenge: "11111111-1111-4111-8111-111111111111", hostBaseline, evidenceRoot: path.join(config.roots.supervisor, "evidence") });
  assert.equal(plan.cases.length, 5); assert(plan.prohibited_effects.includes("ACL changes"));
  await assert.rejects(executeCodexValidationQualificationCase({ configuration: config, plan, caseId: "filesystem" }), code("NATIVE_PROBE_EXACT_APPROVAL_REQUIRED"));
  assert.deepEqual(fs.readdirSync(root).sort(), before);
});
await check("exact native probe approval cannot bypass unsupported existing-only path", async () => {
  const { config, request } = fixture(), before = fs.readdirSync(root).sort();
  config.client.sha256 = "8f0554ede25bbc5450921897c468b2e84635aa513c5017457997af0954581f49";
  const hostBaseline = Object.fromEntries(["configuration_sha256", "provisioning_sha256", "accounts_sha256", "acl_sha256", "firewall_sha256"].map(key => [key, H]));
  const plan = buildCodexValidationQualificationPlan({ configuration: config, environment: request.environment, probe: { path: path.join(request.cwd, "probe.mjs"), sha256: H }, cwd: request.cwd,
    canaries: { snapshot_file: path.join(request.cwd, "canary"), scratch_file: path.join(config.roots.scratch, "canary"), supervisor_file: path.join(config.roots.supervisor, "canary") },
    networkPort: 34567, challenge: "11111111-1111-4111-8111-111111111111", hostBaseline, evidenceRoot: path.join(config.roots.supervisor, "evidence") });
  let observed = 0;
  await assert.rejects(executeCodexValidationQualificationCase({ configuration: config, plan, caseId: "network", execute: true, expectPlan: plan.plan_sha256,
    observeHost: () => { observed++; } }), code("SANDBOX_EXISTING_ONLY_UNSUPPORTED"));
  assert.equal(observed, 0); assert.deepEqual(fs.readdirSync(root).sort(), before);
});
await check("journal inspection creates nothing; durable intent survives an interrupted launch", async () => {
  const { config, request } = fixture(), evidenceRoot = path.join(root, "journal-crash"); fs.mkdirSync(evidenceRoot);
  const options = { evidenceRoot, configurationSha256: fingerprint(config) }, journal = createCodexSandboxValidationJournal(options);
  assert.deepEqual(await journal.inspect(), { operations: [], uncertain_read: null }); assert.deepEqual(fs.readdirSync(evidenceRoot), []);
  const preparedIntent = await journal.prepare({ invocationId: request.invocation_id, requestSha256: request.request_sha256, launch: build(config, request) });
  const restarted = await createCodexSandboxValidationJournal(options).inspect(); assert.equal(restarted.operations.length, 1);
  assert.equal(restarted.operations[0].intent_sha256, preparedIntent.evidence.sha256); assert.equal(restarted.operations[0].recovery_required, true);
  assert.equal(restarted.operations[0].termination_state, "unknown");
  await assert.rejects(journal.prepare({ invocationId: request.invocation_id, requestSha256: request.request_sha256, launch: build(config, request) }), error => error.code === "EEXIST");
});
await check("journal accepts only exact outer membership and retains both process proofs", async () => {
  const { config, request } = fixture(), evidenceRoot = path.join(root, "journal-closed"); fs.mkdirSync(evidenceRoot);
  const journal = createCodexSandboxValidationJournal({ evidenceRoot, configurationSha256: fingerprint(config) }), launch = build(config, request);
  const intent = await journal.prepare({ invocationId: request.invocation_id, requestSha256: request.request_sha256, launch });
  const started = "2026-01-01T00:00:00Z", member = JSON.parse(frame(request, 1, "prepared", prepared(request)));
  const controller = { termination_state: "confirmed", runner: { runner_id: request.invocation_id, pid: 71, started_at: started, job_name: launch.jobName },
    termination_proof: { method: "windows-job-object", runner_id: request.invocation_id, pid: 71, started_at: started, job_name: launch.jobName, active_processes: 0, observed_at: started } };
  await journal.record({ prepared: intent, controller, membership: member, child: terminal(request) });
  const observed = await journal.inspect(); assert.equal(observed.uncertain_read, null); assert.equal(observed.operations[0].recovery_required, false);
  assert.deepEqual(observed.operations[0].terminal.controller, controller); assert.equal(observed.operations[0].evidence.length, 2);
  const file = path.join(evidenceRoot, observed.operations[0].evidence[1].ref), corrupted = JSON.parse(fs.readFileSync(file)); corrupted.membership.parent_job_name = `Local\\aidn-execution-${"0".repeat(32)}`;
  fs.writeFileSync(file, JSON.stringify(corrupted)); assert.equal((await journal.inspect()).uncertain_read.reason_code, "SANDBOX_JOURNAL_TERMINAL_INVALID");
});
await check("closed CLI without exact child membership remains indeterminate in journal", async () => {
  const { config, request } = fixture(), evidenceRoot = path.join(root, "journal-unbound"); fs.mkdirSync(evidenceRoot);
  const journal = createCodexSandboxValidationJournal({ evidenceRoot, configurationSha256: fingerprint(config) });
  const intent = await journal.prepare({ invocationId: request.invocation_id, requestSha256: request.request_sha256, launch: build(config, request) });
  await journal.record({ prepared: intent, controller: { termination_state: "confirmed", termination_proof: { active_processes: 0 } }, membership: null, child: null });
  assert.equal((await journal.inspect()).operations[0].recovery_required, true);
});
} finally {
  await check("owned fixture cleanup", () => {
    const resolved = fs.realpathSync(root), temp = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(resolved), temp); assert(path.basename(resolved).startsWith("aidn-sandbox-contract-"));
    assert.equal(fs.readFileSync(path.join(resolved, "owner"), "utf8"), token); fs.rmSync(resolved, { recursive: true }); assert(!fs.existsSync(resolved));
  });
}
console.log(JSON.stringify({ status: checks.every(row => row.status === "PASS") ? "PASS" : "FAIL", checks,
  native_qualification: "NOT_EXECUTED", evidence: "contracts, bounded file pins and framed protocol fixtures; no Codex or process controller launched" }, null, 2));
if (checks.some(row => row.status === "FAIL")) process.exitCode = 1;
