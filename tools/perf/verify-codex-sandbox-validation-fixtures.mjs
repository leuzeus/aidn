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
  createCodexSandboxValidationBoundary, createCodexSandboxValidationJournal, inspectCodexSandboxValidationBinaryPins,
  assertCodexSandboxProtectedBaseline, assertCodexSandboxValidationQualificationPayload, assertCodexSandboxNativeCase } from "../../src/adapters/runtime/codex-sandbox-validation-boundary.mjs";
import { assertAgentVerificationQualificationVersion } from "../../src/adapters/runtime/local-agent-verification.mjs";
import { buildCodexValidationQualificationPlan, executeCodexValidationQualificationCase,
  createCodexValidationProbeStderr, assertCodexValidationProbeTermination } from "../verify/qualify-codex-validation-boundary.mjs";

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

function managedFixture() {
  const value = fixture(), config = value.config;
  config.contract_version = "codex-sandbox-validation-configuration.v2";
  config.client.sha256 = "8f0554ede25bbc5450921897c468b2e84635aa513c5017457997af0954581f49";
  config.profile.effective_policy.provisioning = "codex-managed";
  config.profile.effective_policy.filesystem.find(row => row.path === ":root").access = "read";
  config.profile.effective_policy_sha256 = fingerprint(config.profile.effective_policy);
  config.protected_resources = ["configuration", "data", "git", "runtime"].map(category => ({ id: category,
    category, path: path.join(root, "protected", category), kind: category === "configuration" ? "file" : "directory" }));
  return value;
}
function protectedBaseline(config) { return { protected_resources_sha256: fingerprint(config.protected_resources),
  observations: config.protected_resources.map(row => ({ resource_id: row.id, sha256: H })) }; }
function managedQualification(config) { return { contract_version: "agent-verification-boundary.v2", boundary_id: config.boundary_id,
  evidence_class: "native", platform: "win32", configuration_sha256: fingerprint(config), engine_sha256: config.engine_sha256,
  policy_sha256: config.verification_policy_sha256, executable_sha256: config.runner.sha256, environment_sha256: config.environment_sha256,
  snapshot_read_only: true, supervisor_resources_inaccessible: true, network_disabled: true, descendant_termination: true,
  child_environment_observed: true, sandbox_maintenance: "codex-managed", protected_resources_preserved: true,
  protected_resources_sha256: fingerprint(config.protected_resources), qualification_plan_sha256: H,
  evidence: ["filesystem", "network", "timeout", "cancel", "callback"].map(name => ({ ref: `${name}.json`, sha256: H, bytes: 1 })) }; }
function managedReport(config, q, caseId) {
  const identity = { runner_id: "fixture.native", pid: 71, started_at: "2026-01-01T00:00:00Z", job_name: "Local\\fixture" };
  const proof = { ...identity, method: "windows-job-object", active_processes: 0, helper_sha256: config.controller.helperSha256,
    source_sha256: config.controller.helperSourceSha256, candidate_sha256: config.controller.candidateSha256 };
  return { status: "READY_FOR_INDEPENDENT_REVIEW", case_id: caseId, native_availability: false,
    plan_sha256: q.qualification_plan_sha256, configuration_sha256: fingerprint(config), diagnostic: null,
    sandbox_maintenance: "codex-managed", protected_resources_sha256: fingerprint(config.protected_resources),
    before: { phase: "before", case_id: caseId, material: protectedBaseline(config) },
    after: { phase: "after", case_id: caseId, material: protectedBaseline(config) },
    process: { termination_state: "confirmed", termination_proof: proof, runner: { ...identity, executable_sha256: config.client.sha256 },
      reason_code: caseId === "cancel" ? "PROCESS_CANCELLED" : "PROCESS_CALLBACK_FAILED" },
    prepared: { ...identity, parent_job_member: true, parent_job_name: identity.job_name,
      environment_sha256: config.environment_sha256, executable_sha256: config.runner.sha256 },
    child_terminal: { ...identity, active_processes: 0, termination_state: "confirmed", outcome: caseId === "timeout" ? "timed_out" : "completed" },
    observation: { case_id: caseId, environment_sha256: config.environment_sha256, observations: {
      snapshot_write_denied: true, supervisor_read_denied: true, supervisor_write_denied: true, snapshot_sha256: H, scratch_sha256: H,
      network: "denied", descendant_pid: 72 } }, network: { positive_control: true, sandbox_connections: 0 } };
}
function managedPlan(config, request, hostBaseline = protectedBaseline(config)) {
  return buildCodexValidationQualificationPlan({ configuration: config, environment: request.environment,
    probe: { path: path.join(request.cwd, "probe.mjs"), sha256: H }, cwd: request.cwd,
    canaries: { snapshot_file: path.join(request.cwd, "canary"), scratch_file: path.join(config.roots.scratch, "canary"),
      supervisor_file: path.join(config.roots.supervisor, "canary") }, networkPort: 34567,
    challenge: "11111111-1111-4111-8111-111111111111", hostBaseline, evidenceRoot: path.join(config.roots.supervisor, "evidence") });
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

await check("v2 refuses reviewed shared deny-read semantics without any native availability", async () => {
  const { config, request } = managedFixture(), before = structuredClone(config), names = fs.readdirSync(root).sort();
  assert.equal(validate(config), true);
  assert.deepEqual(getCodexSandboxValidationLaunchSupport(config), { available: false, native: false,
    reason_code: "SANDBOX_SHARED_DENY_READ_UNSUPPORTED", reviewed_client: { version: "0.158.0-alpha.2.1",
      executable_sha256: config.client.sha256, source_commit: "0d9c7cbfa6cf1489f55a8a9542b75ddd2c061807" } });
  const { publicKey } = generateKeyPairSync("ed25519"), boundary = createCodexSandboxValidationBoundary({ configuration: config, publicKey, evidenceRoot: root });
  assert.deepEqual(await boundary.checkAvailability(), { available: false, native: false, reason_code: "SANDBOX_SHARED_DENY_READ_UNSUPPORTED" });
  await assert.rejects(boundary.run(request), code("SANDBOX_SHARED_DENY_READ_UNSUPPORTED"));
  assert.deepEqual(config, before); assert.deepEqual(fs.readdirSync(root).sort(), names);
  config.client.sha256 = H; assert.equal(getCodexSandboxValidationLaunchSupport(config).available, false);
  assert.equal(getCodexSandboxValidationLaunchSupport(config).reason_code, "SANDBOX_CLIENT_UNQUALIFIED");
});
await check("signed positive v2 qualification cannot override shared deny-read refusal", async () => {
  const { config, request } = managedFixture(), names = fs.readdirSync(root).sort(), { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const payload = managedQualification(config);
  const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
  const qualification = { payload, signature: sign(null, Buffer.from(canonical(payload)), privateKey).toString("base64") };
  const boundary = createCodexSandboxValidationBoundary({ configuration: config, qualification, publicKey, evidenceRoot: root });
  assert.deepEqual(await boundary.checkAvailability(), { available: false, native: false, reason_code: "SANDBOX_SHARED_DENY_READ_UNSUPPORTED" });
  await assert.rejects(boundary.run(request), code("SANDBOX_SHARED_DENY_READ_UNSUPPORTED"));
  assert.deepEqual(await boundary.inspectOperations(), { operations: [], uncertain_read: null });
  assert.deepEqual(fs.readdirSync(root).sort(), names);
});
await check("exact v2 native probe approval refuses before observations, material reads or intent", async () => {
  const { config, request } = managedFixture(), plan = managedPlan(config, request), names = fs.readdirSync(root).sort(); let observed = 0;
  await assert.rejects(executeCodexValidationQualificationCase({ configuration: config, plan, caseId: "network", execute: true,
    expectPlan: plan.plan_sha256, observeHost: () => { observed++; throw new Error("observer must not run"); } }), code("SANDBOX_SHARED_DENY_READ_UNSUPPORTED"));
  assert.equal(observed, 0); assert.deepEqual(fs.readdirSync(root).sort(), names);
});
await check("v2 supplies the exact permission table through official CLI arguments", () => {
  const { config, request } = managedFixture(), launch = build(config, request);
  const table = `permissions={${JSON.stringify(config.profile.id)}={filesystem={${config.profile.effective_policy.filesystem.map(row =>
    `${JSON.stringify(row.path)}=${JSON.stringify(row.access === "deny" ? "none" : row.access)}`).join(",")}},network={enabled=false}}}`;
  assert(table.includes('":root"="read"')); assert(table.includes(`${JSON.stringify(config.profile.home)}="none"`));
  assert(table.includes(`${JSON.stringify(config.roots.supervisor)}="none"`));
  assert.equal(launch.args.filter(arg => arg.startsWith("permissions=")).length, 1); assert(launch.args.includes(table));
  assert.equal(launch.args[launch.args.indexOf(table) - 1], "-c"); assert.equal(launch.args[launch.args.indexOf("--permission-profile") + 1], config.profile.id);
  const changed = structuredClone(config); changed.profile.effective_policy.filesystem.push({ path: path.join(root, "tools espace été"), access: "read" });
  changed.profile.effective_policy_sha256 = fingerprint(changed.profile.effective_policy);
  assert.notEqual(fingerprint(build(changed, request)), fingerprint(launch));
  assert(!launch.args.some(arg => /setupStart|full-access|unelevated/.test(arg)));
});
for (const [name, change] of [
  ["root denied", c => { c.profile.effective_policy.filesystem[0].access = "deny"; }],
  ["root writable", c => { c.profile.effective_policy.filesystem[0].access = "write"; }],
  ["root missing", c => { c.profile.effective_policy.filesystem.shift(); }],
  ["snapshot writable", c => { c.profile.effective_policy.filesystem[2].access = "write"; }],
  ["supervisor readable", c => { c.profile.effective_policy.filesystem[4].access = "read"; }],
  ["home readable", c => { c.profile.effective_policy.filesystem[5].access = "read"; }],
  ["additional writable directory", c => { c.profile.effective_policy.filesystem.push({ path: path.join(root, "extra-write"), access: "write" }); }],
  ["network access", c => { c.profile.effective_policy.network_enabled = true; }],
  ["missing category", c => { c.protected_resources.pop(); }],
  ["duplicate ID", c => { c.protected_resources[1].id = c.protected_resources[0].id; }],
  ["same path", c => { c.protected_resources[1].path = c.protected_resources[0].path; }],
  ["nested path", c => { c.protected_resources[1].path = path.join(c.protected_resources[2].path, "child"); }],
  ["scratch child", c => { c.protected_resources[1].path = path.join(c.roots.scratch, "data"); }],
  ["snapshot root", c => { c.protected_resources[1].path = c.roots.snapshots; }],
  ["ancestor of scratch", c => { c.protected_resources[1].path = root; }],
  ["profile enumeration", c => { c.protected_resources[1].path = c.profile.home; }],
  ["configuration directory", c => { c.protected_resources[0].kind = "directory"; }],
  ["relative path", c => { c.protected_resources[1].path = "relative/data"; }],
  ["OneDrive", c => { c.protected_resources[1].path = path.join(root, "OneDrive", "data"); }],
  ["short alias", c => { c.protected_resources[1].path = path.join(root, "ALIAS~1"); }],
  ["unknown field", c => { c.protected_resources[1].optional = true; }],
  ["v1 permission under v2", c => { c.profile.effective_policy.provisioning = "existing-only"; }],
  ["v2 permission under v1", c => { c.contract_version = "codex-sandbox-validation-configuration.v1"; delete c.protected_resources; }],
]) await check(`v2 refuses ${name} without observation`, () => {
  const { config } = managedFixture(); change(config); config.profile.effective_policy_sha256 = fingerprint(config.profile.effective_policy);
  assert.throws(() => validate(config));
});
await check("v1 continues to reject root read and permits no reinterpretation as v2", () => {
  const { config, request } = fixture();
  assert(!build(config, request).args.some(arg => arg.startsWith("permissions=")));
  config.profile.effective_policy.filesystem[0].access = "read";
  config.profile.effective_policy_sha256 = fingerprint(config.profile.effective_policy);
  assert.throws(() => validate(config), code("SANDBOX_EFFECTIVE_POLICY_REFUSED"));
});
await check("v2 plan binds the entire protected set and retains five independent native cases", () => {
  const { config, request } = managedFixture(), before = fs.readdirSync(root).sort(), plan = managedPlan(config, request);
  assert.equal(plan.contract_version, "codex-validation-native-plan.v2"); assert.equal(plan.sandbox_maintenance, "codex-managed");
  assert.deepEqual(plan.protected_resources, config.protected_resources); assert.equal(plan.cases.length, 5);
  assert(!plan.prohibited_effects.includes("ACL changes")); assert(plan.prohibited_effects.includes("protected resource changes"));
  for (const field of ["path", "id", "kind"]) {
    const next = structuredClone(config);
    next.protected_resources[1][field] = field === "path" ? path.join(root, "another-data") : field === "kind" ? "file" : "changed-data";
    assert.notEqual(managedPlan(next, request).plan_sha256, plan.plan_sha256);
  }
  const changed = protectedBaseline(config); changed.observations[1].sha256 = "b".repeat(64);
  assert.notEqual(managedPlan(config, request, changed).plan_sha256, plan.plan_sha256);
  assert.deepEqual(fs.readdirSync(root).sort(), before);
});
for (const [name, change] of [
  ["empty", b => { b.observations = []; }], ["omitted", b => { b.observations.pop(); }],
  ["wrong set", b => { b.protected_resources_sha256 = H; }], ["foreign ID", b => { b.observations[0].resource_id = "foreign"; }],
  ["reordered", b => { b.observations.reverse(); }], ["unmeasured", b => { delete b.observations[0].sha256; }],
  ["Windows catch-all", b => { b.accounts_sha256 = H; }],
]) await check(`v2 refuses ${name} protected baseline`, () => {
  const { config } = managedFixture(), value = protectedBaseline(config); change(value);
  assert.throws(() => assertCodexSandboxProtectedBaseline(value, config));
});
await check("v2 pure qualification shape retains protections without claiming global Windows immutability", () => {
  const { config } = managedFixture(), q = managedQualification(config);
  assert.equal(assertAgentVerificationQualificationVersion(q), true);
  assert.deepEqual(assertCodexSandboxValidationQualificationPayload(q, config), q);
  for (const caseId of ["filesystem", "network", "timeout", "cancel", "callback"])
    assert.equal(assertCodexSandboxNativeCase(managedReport(config, q, caseId), q, config), caseId);
});
for (const [name, change] of [
  ["legacy proof", q => { q.contract_version = "agent-verification-boundary.v1"; }],
  ["maintenance missing", q => { delete q.sandbox_maintenance; }], ["no protected preservation", q => { q.protected_resources_preserved = false; }],
  ["foreign protected set", q => { q.protected_resources_sha256 = H; }], ["global host claim", q => { q.host_preserved = true; }],
  ["provisioning absent claim", q => { q.provisioning_performed = false; }], ["writable snapshot", q => { q.snapshot_read_only = false; }],
  ["readable secrets", q => { q.supervisor_resources_inaccessible = false; }], ["network enabled", q => { q.network_disabled = false; }],
  ["unknown descendants", q => { q.descendant_termination = false; }], ["missing fifth proof", q => { q.evidence.pop(); }],
  ["another configuration", q => { q.configuration_sha256 = H; }],
]) await check(`v2 qualification rejects ${name}`, () => {
  const { config } = managedFixture(), q = managedQualification(config); change(q);
  assert.throws(() => assertCodexSandboxValidationQualificationPayload(q, config));
});
for (const [name, change] of [
  ["changed protected bytes", r => { r.after.material.observations[1].sha256 = "b".repeat(64); }],
  ["another protected set", r => { r.before.material.protected_resources_sha256 = H; }],
  ["live descendant", r => { r.process.termination_proof.active_processes = 1; }],
  ["wrong outer Job", r => { r.prepared.parent_job_name = "foreign"; }],
  ["supervisor readable", r => { r.observation.observations.supervisor_read_denied = false; }],
  ["snapshot canary writable", r => { r.observation.observations.snapshot_write_denied = false; }],
  ["supervisor canary writable", r => { r.observation.observations.supervisor_write_denied = false; }],
  ["missing after", r => { delete r.after; }],
]) await check(`v2 native report shape rejects ${name}`, () => {
  const { config } = managedFixture(), q = managedQualification(config), report = managedReport(config, q, "filesystem"); change(report);
  assert.throws(() => assertCodexSandboxNativeCase(report, q, config));
});
await check("generic verifier refuses malformed or downgraded v2 declarations", () => {
  const { config } = managedFixture(), q = managedQualification(config);
  for (const field of ["sandbox_maintenance", "protected_resources_preserved", "protected_resources_sha256"])
    assert.throws(() => assertAgentVerificationQualificationVersion(mutate(q, next => { delete next[field]; })));
  assert.throws(() => assertAgentVerificationQualificationVersion(mutate(q, next => { next.evidence_class = "fixture"; })));
  assert.throws(() => assertAgentVerificationQualificationVersion(mutate(q, next => { next.boundary_id = "another-boundary"; })));
});


await check("native failure retains bounded stderr and full controller evidence", () => {
  const capture = createCodexValidationProbeStderr(), content = Buffer.from("Codex: invalid permission profile é\n");
  capture.consume(content.subarray(0, 7)); capture.consume(content.subarray(7));
  const sha256 = createHash("sha256").update(content).digest("hex"), result = capture.snapshot({ bytes: { stderr: content.length }, hashes: { stderr_sha256: sha256 } });
  assert.equal(result.total_bytes, content.length); assert.equal(result.sha256, sha256); assert.equal(result.retained_bytes, content.length);
  assert.equal(result.tail_utf8, content.toString("utf8")); assert.deepEqual(Buffer.from(result.tail_base64, "base64"), content); assert.equal(result.truncated, false);
});
await check("native stderr tail is capped at 4096 raw bytes including abundant and partial delivery", () => {
  const capture = createCodexValidationProbeStderr(); capture.consume(Buffer.alloc(8000, 97)); capture.consume(Buffer.from("final diagnostic"));
  const result = capture.snapshot({ bytes: { stderr: 9000 }, hashes: { stderr_sha256: H } });
  assert.equal(result.total_bytes, 9000); assert.equal(result.sha256, H); assert.equal(result.observed_bytes, 8016);
  assert.equal(result.retained_bytes, 4096); assert.equal(Buffer.from(result.tail_base64, "base64").length, 4096);
  assert.equal(result.truncated, true); assert(result.tail_utf8.endsWith("final diagnostic"));
});
await check("native stderr split UTF-8 never loses raw tail or expands its diagnostic bound", () => {
  const capture = createCodexValidationProbeStderr(), content = Buffer.from("é".repeat(3000) + "x"); capture.consume(content);
  const result = capture.snapshot({ bytes: { stderr: content.length }, hashes: { stderr_sha256: H } });
  assert.equal(result.retained_bytes, 4096); assert(Buffer.byteLength(result.tail_utf8) <= 4096); assert(!result.tail_utf8.includes("�"));
  capture.consume(Buffer.from([255])); const invalid = capture.snapshot(); assert.equal(invalid.tail_utf8, null);
  assert.equal(Buffer.from(invalid.tail_base64, "base64").at(-1), 255);
});
await check("Job0 without child handshake reports missing child evidence rather than live descendants", () => {
  const process = { termination_state: "confirmed", exit_code: 1, termination_proof: { job_name: "fixture.job", active_processes: 0 } };
  assert.throws(() => assertCodexValidationProbeTermination(process, null, "fixture.job"), code("NATIVE_PROBE_CHILD_NOT_OBSERVED"));
  assert.equal(process.termination_state, "confirmed");
  assert.throws(() => assertCodexValidationProbeTermination({ ...process, termination_state: "unknown" }, null, "fixture.job"), code("NATIVE_PROBE_TERMINATION_UNCONFIRMED"));
  assert.throws(() => assertCodexValidationProbeTermination({ ...process, termination_proof: { job_name: "fixture.job", active_processes: 1 } }, null, "fixture.job"), code("NATIVE_PROBE_TERMINATION_UNCONFIRMED"));
  assert.throws(() => assertCodexValidationProbeTermination(process, { parent_job_member: true, parent_job_name: "other" }, "fixture.job"), code("NATIVE_PROBE_CHILD_MEMBERSHIP_UNCONFIRMED"));
  assert.equal(assertCodexValidationProbeTermination(process, { parent_job_member: true, parent_job_name: "fixture.job" }, "fixture.job"), true);
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
