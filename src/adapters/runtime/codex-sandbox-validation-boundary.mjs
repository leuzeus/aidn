import fs from "node:fs/promises";
import path from "node:path";
import { createHash, createPublicKey, verify } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fingerprintAgentExecutionValue as fingerprint } from "../../core/agents/agent-execution-contracts.mjs";
import { createWindowsProcessTreeController } from "../agents/process-tree/windows-process-tree-controller.mjs";

const VERSION = "codex-sandbox-validation-configuration.v1";
const ID = "codex-sandbox-validation";
const REVIEWED_CLIENT = Object.freeze({
  version: "0.158.0-alpha.2.1",
  executable_sha256: "8f0554ede25bbc5450921897c468b2e84635aa513c5017457997af0954581f49",
  source_commit: "0d9c7cbfa6cf1489f55a8a9542b75ddd2c061807",
});
const SOURCE = path.join(import.meta.dirname, "codex-validation-trampoline.cs");
const CONTROLLER = path.resolve(import.meta.dirname, "../agents/process-tree/windows-process-tree-controller.mjs");
const HELPER_SOURCE = path.resolve(import.meta.dirname, "../agents/process-tree/windows-job-helper.cs");
const HASH = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/u;
const EXECUTION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const LAUNCH_NAMES = ["SYSTEMROOT", "WINDIR", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMDATA", "CODEX_HOME", "TEMP", "TMP"];
const CHILD_NAMES = ["SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "TZ", "NO_COLOR"];
const fail = code => { throw Object.assign(new Error(code), { code }); };
const requireThat = (condition, code) => { if (!condition) fail(code); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, names) => object(value) && Object.keys(value).sort().join("|") === [...names].sort().join("|");
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : object(value)
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const hash = content => createHash("sha256").update(content).digest("hex");
const positive = (value, maximum) => Number.isSafeInteger(value) && value > 0 && value <= maximum;
const absolute = value => typeof value === "string" && value.length <= 4096 && !/[\x00-\x1f\x7f]/u.test(value)
  && path.isAbsolute(value) && path.normalize(value) === value && (process.platform !== "win32" || /^[a-z]:\\/iu.test(value));
const equalPath = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const inside = (root, child) => { const relative = path.relative(root, child); return !relative || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`)); };
const filePin = value => exact(value, ["executable", "sha256"]) && absolute(value.executable) && HASH.test(value.sha256);
const envValue = (environment, name) => Object.entries(environment).find(([key]) => key.toUpperCase() === name)?.[1];
function environment(value, names) {
  requireThat(object(value) && Object.keys(value).length <= names.length && new Set(Object.keys(value).map(key => key.toUpperCase())).size === Object.keys(value).length
    && Object.entries(value).every(([key, text]) => names.includes(key.toUpperCase()) && typeof text === "string" && text.length <= 4096 && !/[\x00-\x1f\x7f]/u.test(text)), "SANDBOX_ENVIRONMENT_REFUSED");
}
function records(values) {
  return Array.isArray(values) && values.length > 0 && values.length <= 256 && new Set(values.map(row => row.path?.toLowerCase())).size === values.length
    && values.every(row => absolute(row.path) && (row.present === false && exact(row, ["path", "present"])
      || row.present === true && exact(row, ["path", "present", "sha256", "bytes"]) && HASH.test(row.sha256) && Number.isSafeInteger(row.bytes) && row.bytes >= 0 && row.bytes <= 8 * 1024 * 1024));
}

// This is a local pinned configuration, not a profile installer or an assertion
// that a named profile enforces its declared permissions on the current host.
export function assertCodexSandboxValidationConfiguration(config) {
  fingerprint(config);
  requireThat(exact(config, ["contract_version", "boundary_id", "platform", "architecture", "engine_sha256", "verification_policy_sha256", "environment_sha256", "client", "controller", "trampoline", "runner", "profile", "roots", "launcher_environment"])
    && config.contract_version === VERSION && config.boundary_id === ID && config.platform === "win32" && config.architecture === "x64"
    && [config.engine_sha256, config.verification_policy_sha256, config.environment_sha256].every(value => HASH.test(value))
    && filePin(config.client) && filePin(config.runner), "SANDBOX_CONFIGURATION_INVALID");
  requireThat(exact(config.controller, ["helperPath", "helperSha256", "helperSourceSha256", "candidateSha256"])
    && absolute(config.controller.helperPath) && [config.controller.helperSha256, config.controller.helperSourceSha256, config.controller.candidateSha256].every(value => HASH.test(value))
    && exact(config.trampoline, ["executable", "sha256", "source_sha256"]) && absolute(config.trampoline.executable)
    && HASH.test(config.trampoline.sha256) && HASH.test(config.trampoline.source_sha256), "SANDBOX_CONTROLLER_INVALID");
  const p = config.profile;
  requireThat(exact(p, ["id", "home", "home_identity_sha256", "config_layers", "provisioning_files", "environment_override_names", "effective_policy", "effective_policy_sha256"])
    && IDENTIFIER.test(p.id) && absolute(p.home) && HASH.test(p.home_identity_sha256) && records(p.config_layers) && records(p.provisioning_files)
    && p.provisioning_files.every(row => row.present) && HASH.test(p.effective_policy_sha256) && fingerprint(p.effective_policy) === p.effective_policy_sha256,
  "SANDBOX_PROFILE_INVALID");
  requireThat(Array.isArray(p.environment_override_names) && p.environment_override_names.length <= 128
    && new Set(p.environment_override_names.map(name => name.toUpperCase())).size === p.environment_override_names.length
    && p.environment_override_names.every(name => /^[A-Za-z_][A-Za-z0-9_]{0,255}$/u.test(name) && !LAUNCH_NAMES.includes(name.toUpperCase())), "SANDBOX_ENVIRONMENT_REFUSED");
  const e = p.effective_policy;
  requireThat(exact(e, ["windows_sandbox", "provisioning", "network_enabled", "filesystem"])
    && e.windows_sandbox === "elevated" && e.provisioning === "existing-only" && e.network_enabled === false
    && Array.isArray(e.filesystem) && e.filesystem.length <= 256 && e.filesystem.length >= 4
    && e.filesystem.every(row => exact(row, ["path", "access"]) && (absolute(row.path) || [":root", ":minimal", ":tmpdir", ":slash_tmp"].includes(row.path)) && ["read", "write", "deny"].includes(row.access))
    && new Set(e.filesystem.map(row => row.path.toLowerCase())).size === e.filesystem.length, "SANDBOX_EFFECTIVE_POLICY_REFUSED");
  requireThat(exact(config.roots, ["snapshots", "scratch", "supervisor"]) && Object.values(config.roots).every(absolute)
    && !inside(config.roots.snapshots, config.roots.scratch) && !inside(config.roots.scratch, config.roots.snapshots)
    && !equalPath(config.roots.supervisor, config.roots.snapshots) && !equalPath(config.roots.supervisor, config.roots.scratch)
    && !inside(config.roots.snapshots, p.home) && !inside(config.roots.scratch, p.home), "SANDBOX_ROOTS_INVALID");
  const rule = (target, access) => e.filesystem.some(row => equalPath(row.path, target) && row.access === access);
  requireThat(rule(":root", "deny") && rule(":minimal", "read") && rule(config.roots.snapshots, "read") && rule(config.roots.scratch, "write")
    && rule(config.roots.supervisor, "deny") && rule(p.home, "deny") && e.filesystem.filter(row => row.access === "write").every(row => equalPath(row.path, config.roots.scratch))
    && e.filesystem.every(row => row.access === "deny" || [":minimal", config.roots.snapshots, config.roots.scratch].some(allowed => equalPath(row.path, allowed))
      || row.access === "read" && absolute(row.path) && !inside(config.roots.supervisor, row.path) && !inside(p.home, row.path)), "SANDBOX_EFFECTIVE_POLICY_REFUSED");
  environment(config.launcher_environment, LAUNCH_NAMES);
  requireThat(envValue(config.launcher_environment, "CODEX_HOME") === p.home && envValue(config.launcher_environment, "TEMP") === config.roots.scratch
    && envValue(config.launcher_environment, "TMP") === config.roots.scratch && absolute(envValue(config.launcher_environment, "SYSTEMROOT")), "SANDBOX_ENVIRONMENT_REFUSED");
  return true;
}
export function fingerprintCodexSandboxValidationConfiguration(config) { assertCodexSandboxValidationConfiguration(config); return fingerprint(config); }

// Source review of rust-v0.158.0-alpha.2.1, commit 0d9c7cbfa6cf1489f55a8a9542b75ddd2c061807:
// cli/src/debug_sandbox.rs:573 -> windows-sandbox-rs/src/identity.rs:269-280
// unconditionally invokes setup refresh; setup.rs:335-413 launches the helper.
// Existing accounts and approval_policy=never do not suppress that path. The
// declared effective_policy is NOT an observation of the merged named profile.
// Therefore neither local markers nor signed declarative qualifications permit
// this client to run under AIDN's no-setup/no-ACL-change contract. Unknown clients
// have no fallback. A supported implementation needs a separately reviewed path.
// https://github.com/openai/codex/blob/0d9c7cbfa6cf1489f55a8a9542b75ddd2c061807/codex-rs/windows-sandbox-rs/src/identity.rs#L238
export function getCodexSandboxValidationLaunchSupport(config) {
  assertCodexSandboxValidationConfiguration(config);
  const reviewed = config.client.sha256 === REVIEWED_CLIENT.executable_sha256;
  return { available: false, native: false,
    reason_code: reviewed ? "SANDBOX_EXISTING_ONLY_UNSUPPORTED" : "SANDBOX_CLIENT_UNQUALIFIED",
    reviewed_client: reviewed ? { ...REVIEWED_CLIENT } : null };
}
export function assertCodexSandboxValidationLaunchSupported(config) {
  const support = getCodexSandboxValidationLaunchSupport(config);
  requireThat(support.available, support.reason_code);
}


async function physical(target, directory = false) {
  requireThat(absolute(target), "SANDBOX_PATH_INVALID");
  let cursor = target;
  for (;;) { const stat = await fs.lstat(cursor); requireThat(!stat.isSymbolicLink(), "SANDBOX_PATH_ALIAS"); const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent; }
  const stat = await fs.lstat(target);
  requireThat(directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1, "SANDBOX_PATH_INVALID");
  requireThat(equalPath(await fs.realpath(target), target), "SANDBOX_PATH_ALIAS"); return stat;
}
async function readFile(target, limit, signal, retain = false) {
  requireThat(!signal?.aborted, "SANDBOX_CANCELLED"); const before = await physical(target);
  requireThat(before.size <= limit, "SANDBOX_FILE_LIMIT"); const handle = await fs.open(target, "r"), digest = createHash("sha256"), chunks = []; let count = 0;
  try {
    const opened = await handle.stat(); requireThat(opened.dev === before.dev && opened.ino === before.ino, "SANDBOX_FILE_CHANGED");
    for (;;) { requireThat(!signal?.aborted, "SANDBOX_CANCELLED"); const buffer = Buffer.alloc(Math.min(65536, limit - count + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null); if (!bytesRead) break; count += bytesRead;
      requireThat(count <= limit, "SANDBOX_FILE_LIMIT"); const data = buffer.subarray(0, bytesRead); digest.update(data); if (retain) chunks.push(data); }
    const after = await handle.stat(), final = await physical(target);
    requireThat(count === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs
      && final.dev === before.dev && final.ino === before.ino, "SANDBOX_FILE_CHANGED");
    return { sha256: digest.digest("hex"), bytes: count, ...(retain ? { content: Buffer.concat(chunks, count) } : {}) };
  } finally { await handle.close(); }
}
async function verifyRecords(rows, signal) {
  for (const row of rows) {
    if (!row.present) { try { await fs.lstat(row.path); fail("SANDBOX_SOURCE_APPEARED"); } catch (cause) { if (cause.code !== "ENOENT") throw cause; } }
    else { const observed = await readFile(row.path, 8 * 1024 * 1024, signal); requireThat(observed.sha256 === row.sha256 && observed.bytes === row.bytes, "SANDBOX_SOURCE_CHANGED"); }
  }
}
function authority(key) { const publicKey = key?.type === "public" ? key : createPublicKey(Buffer.isBuffer(key) ? { key, format: "der", type: "spki" } : key); requireThat(publicKey.asymmetricKeyType === "ed25519", "SANDBOX_AUTHORITY_INVALID"); return publicKey; }
function checkQualification(envelope, config, key) {
  requireThat(exact(envelope, ["payload", "signature"]) && typeof envelope.signature === "string" && /^[A-Za-z0-9+/]{86}==$/u.test(envelope.signature), "SANDBOX_QUALIFICATION_REQUIRED");
  requireThat(verify(null, Buffer.from(canonical(envelope.payload)), key, Buffer.from(envelope.signature, "base64")), "SANDBOX_QUALIFICATION_SIGNATURE");
  const q = envelope.payload;
  requireThat(q.contract_version === "agent-verification-boundary.v1" && q.boundary_id === ID && q.evidence_class === "native"
    && q.platform === config.platform && q.configuration_sha256 === fingerprint(config) && q.engine_sha256 === config.engine_sha256
    && q.policy_sha256 === config.verification_policy_sha256 && q.executable_sha256 === config.runner.sha256 && q.environment_sha256 === config.environment_sha256
    && q.snapshot_read_only === true && q.supervisor_resources_inaccessible === true && q.network_disabled === true && q.descendant_termination === true
    && q.child_environment_observed === true && q.host_preserved === true && q.provisioning_performed === false
    && HASH.test(q.qualification_plan_sha256) && Array.isArray(q.evidence) && q.evidence.length === 5, "SANDBOX_QUALIFICATION_MISMATCH");
  return q;
}

function nativeCase(report, qualification, config) {
  const cases = ["filesystem", "network", "timeout", "cancel", "callback"], proof = report?.process?.termination_proof, member = report?.prepared;
  requireThat(report?.status === "READY_FOR_INDEPENDENT_REVIEW" && cases.includes(report.case_id) && report.native_availability === false
    && report.plan_sha256 === qualification.qualification_plan_sha256 && report.configuration_sha256 === fingerprint(config)
    && report.diagnostic === null && report.before?.phase === "before" && report.after?.phase === "after"
    && report.before.case_id === report.case_id && report.after.case_id === report.case_id
    && report.before.material && fingerprint(report.before.material) === fingerprint(report.after.material)
    && report.process.termination_state === "confirmed" && proof?.method === "windows-job-object" && proof.active_processes === 0
    && proof.helper_sha256 === config.controller.helperSha256 && proof.source_sha256 === config.controller.helperSourceSha256
    && proof.candidate_sha256 === config.controller.candidateSha256 && report.process.runner?.executable_sha256 === config.client.sha256
    && proof.runner_id === report.process.runner.runner_id && proof.pid === report.process.runner.pid && proof.started_at === report.process.runner.started_at
    && member?.runner_id === proof.runner_id && member.parent_job_member === true && member.parent_job_name === proof.job_name
    && member.environment_sha256 === config.environment_sha256 && member.executable_sha256 === config.runner.sha256
    && report.observation?.case_id === report.case_id && report.observation.environment_sha256 === config.environment_sha256,
  "SANDBOX_NATIVE_EVIDENCE_INVALID");
  const observations = report.observation.observations;
  if (["filesystem", "network", "timeout"].includes(report.case_id)) requireThat(report.child_terminal?.pid === member.pid
    && report.child_terminal.job_name === member.job_name && report.child_terminal.active_processes === 0
    && report.child_terminal.termination_state === "confirmed" && report.child_terminal.outcome === (report.case_id === "timeout" ? "timed_out" : "completed"), "SANDBOX_NATIVE_EVIDENCE_INVALID");
  if (report.case_id === "cancel") requireThat(report.process.reason_code === "PROCESS_CANCELLED", "SANDBOX_NATIVE_EVIDENCE_INVALID");
  if (report.case_id === "callback") requireThat(report.process.reason_code === "PROCESS_CALLBACK_FAILED", "SANDBOX_NATIVE_EVIDENCE_INVALID");
  if (report.case_id === "filesystem") requireThat(observations?.snapshot_write_denied === true && observations.supervisor_read_denied === true
    && observations.supervisor_write_denied === true && HASH.test(observations.snapshot_sha256) && HASH.test(observations.scratch_sha256), "SANDBOX_NATIVE_EVIDENCE_INVALID");
  if (report.case_id === "network") requireThat(["denied", "timed_out"].includes(observations?.network) && report.network?.positive_control === true
    && report.network.sandbox_connections === 0, "SANDBOX_NATIVE_EVIDENCE_INVALID");
  if (["timeout", "cancel", "callback"].includes(report.case_id)) requireThat(Number.isSafeInteger(observations?.descendant_pid) && observations.descendant_pid > 0, "SANDBOX_NATIVE_EVIDENCE_INVALID");
  return report.case_id;
}

// Structured argv only. No permission-profile fallback, unmanaged sandbox state,
// inherited child environment, profile write or sandbox setup is permitted here.
export function buildCodexSandboxValidationInvocation(config, request) {
  assertCodexSandboxValidationConfiguration(config);
  const { environment: env, request_sha256: requestHash, ...invocation } = request ?? {};
  requireThat(exact(invocation, ["invocation_id", "boundary_id", "validation_id", "executable", "executable_sha256", "argv", "cwd", "environment_sha256", "max_duration_ms", "max_output_bytes"])
    && EXECUTION_ID.test(invocation.invocation_id) && EXECUTION_ID.test(invocation.validation_id) && invocation.boundary_id === ID
    && invocation.executable === config.runner.executable && invocation.executable_sha256 === config.runner.sha256
    && absolute(invocation.cwd) && inside(config.roots.snapshots, invocation.cwd) && !equalPath(config.roots.snapshots, invocation.cwd)
    && invocation.environment_sha256 === config.environment_sha256 && requestHash === fingerprint(invocation)
    && positive(invocation.max_duration_ms, 86400000) && positive(invocation.max_output_bytes, 16 * 1024 * 1024)
    && Array.isArray(invocation.argv) && invocation.argv.length <= 128 && invocation.argv.every(arg => typeof arg === "string" && arg.length <= 8192 && !arg.includes("\0")), "SANDBOX_REQUEST_INVALID");
  environment(env, CHILD_NAMES); requireThat(fingerprint(env) === config.environment_sha256, "SANDBOX_ENVIRONMENT_REFUSED");
  for (const [name, value] of Object.entries(env)) if (["TEMP", "TMP", "TMPDIR"].includes(name.toUpperCase())) requireThat(value === config.roots.scratch, "SANDBOX_ENVIRONMENT_REFUSED");
  const settings = ['windows.sandbox="elevated"', 'approval_policy="never"', 'shell_environment_policy.inherit="all"', 'shell_environment_policy.ignore_default_excludes=true',
    `shell_environment_policy.set={${config.profile.environment_override_names.map(name => `${JSON.stringify(name)}=""`).join(",")}}`,
    `shell_environment_policy.filters={${Object.keys(config.launcher_environment).map(name => `${JSON.stringify(name)}="include"`).join(",")}}`];
  const args = ["sandbox", "--permission-profile", config.profile.id, "--cd", invocation.cwd, ...settings.flatMap(value => ["-c", value]), "--", config.trampoline.executable];
  const jobName = `Local\\aidn-execution-${fingerprint({ invocation_id: invocation.invocation_id, request_sha256: requestHash }).slice(0, 32)}`;
  const stdin = canonical({ protocol: "aidn-validation-trampoline.v1", runner_id: invocation.invocation_id, request_sha256: requestHash, parent_job_name: jobName,
    executable: invocation.executable, executable_sha256: invocation.executable_sha256, args: invocation.argv, cwd: invocation.cwd,
    environment_json: canonical(env), environment_sha256: fingerprint(env), max_duration_ms: Math.max(1, invocation.max_duration_ms - 6000),
    max_output_bytes: invocation.max_output_bytes }) + "\n";
  requireThat(Buffer.byteLength(stdin) <= 262144, "SANDBOX_REQUEST_LIMIT");
  return { runnerId: invocation.invocation_id, jobName, executable: config.client.executable, executableSha256: config.client.sha256,
    cwd: invocation.cwd, args, env: structuredClone(config.launcher_environment), stdin, maxDurationMs: invocation.max_duration_ms,
    maxOutputBytes: Math.min(1024 * 1024 * 1024, invocation.max_output_bytes * 2 + 65536), maxPendingBytes: 1024 * 1024, stopTimeoutMs: 5000 };
}

// Frames come from the pinned trampoline; candidate stdout is base64 data only.
export function createCodexValidationStreamParser(request) {
  let buffer = Buffer.alloc(0), sequence = 0, prepared = null, terminal = null, count = 0;
  const stdout = [], stderr = [];
  function consume(chunk) {
    requireThat(Buffer.isBuffer(chunk) && chunk.length <= 16384, "SANDBOX_PROTOCOL_LIMIT");
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) { const end = buffer.indexOf(10); if (end < 0) break; requireThat(end <= 16384, "SANDBOX_PROTOCOL_LIMIT");
      let frame; try { frame = JSON.parse(buffer.subarray(0, end).toString("utf8")); } catch { fail("SANDBOX_PROTOCOL_INVALID"); }
      buffer = buffer.subarray(end + 1);
      requireThat(object(frame) && frame.protocol === "aidn-validation-trampoline.v1" && frame.runner_id === request.invocation_id
        && frame.request_sha256 === request.request_sha256 && frame.sequence === ++sequence && !terminal, "SANDBOX_PROTOCOL_INVALID");
      if (frame.type === "prepared") { requireThat(!prepared && Number.isSafeInteger(frame.pid) && frame.pid > 0 && HASH.test(frame.environment_sha256)
          && frame.environment_sha256 === request.environment_sha256 && frame.executable_sha256 === request.executable_sha256
          && Number.isFinite(Date.parse(frame.started_at))
          && frame.job_assigned === true && frame.parent_job_member === true
          && frame.parent_job_name === `Local\\aidn-execution-${fingerprint({ invocation_id: request.invocation_id, request_sha256: request.request_sha256 }).slice(0, 32)}`
          && typeof frame.job_name === "string" && /^Local\\aidn-execution-[a-f0-9]{32}$/u.test(frame.job_name), "SANDBOX_CHILD_BINDING_INVALID"); prepared = frame; }
      else if (["stdout", "stderr"].includes(frame.type)) { requireThat(prepared && typeof frame.data === "string" && frame.data.length <= 5464
          && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(frame.data), "SANDBOX_PROTOCOL_INVALID");
        const content = Buffer.from(frame.data, "base64"); count += content.length; requireThat(count <= request.max_output_bytes, "SANDBOX_OUTPUT_LIMIT");
        (frame.type === "stdout" ? stdout : stderr).push(content); }
      else if (frame.type === "terminal") { requireThat(prepared && frame.pid === prepared.pid && frame.job_name === prepared.job_name
          && frame.started_at === prepared.started_at && frame.termination_state === "confirmed" && frame.active_processes === 0 && Number.isSafeInteger(frame.exit_code)
          && ["completed", "failed", "timed_out"].includes(frame.outcome) && Number.isFinite(Date.parse(frame.observed_at)), "SANDBOX_STOP_UNCONFIRMED"); terminal = frame; }
      else fail("SANDBOX_PROTOCOL_INVALID");
    }
    requireThat(buffer.length <= 16384, "SANDBOX_PROTOCOL_LIMIT");
  }
  return Object.freeze({ consume, observation: () => structuredClone(prepared), output: () => ({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }), finish() { requireThat(prepared && terminal && buffer.length === 0, "SANDBOX_STOP_UNCONFIRMED");
    return { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), prepared, terminal }; } });
}

// Durable local recovery facts, never a replacement for PostgreSQL ownership.
// No directory or record is created by construction or inspection.
export function createCodexSandboxValidationJournal({ evidenceRoot, configurationSha256 }) {
  requireThat(absolute(evidenceRoot) && HASH.test(configurationSha256), "SANDBOX_JOURNAL_CONFIGURATION_INVALID");
  const directory = path.join(evidenceRoot, "validation-boundary");
  const reference = (name, bytes) => ({ ref: `validation-boundary/${name}`, sha256: hash(bytes), bytes: bytes.length });
  async function write(name, value) {
    await physical(evidenceRoot, true); await fs.mkdir(directory, { recursive: true }); await physical(directory, true);
    const content = Buffer.from(canonical(value)); requireThat(content.length <= 1024 * 1024, "SANDBOX_JOURNAL_LIMIT");
    await fs.writeFile(path.join(directory, name), content, { flag: "wx" }); return reference(name, content);
  }
  function intentValid(value, operationId) {
    requireThat(exact(value, ["contract_version", "operation_id", "configuration_sha256", "invocation_id", "request_sha256", "launch_sha256", "parent_job_name", "observed_at"])
      && value.contract_version === "codex-validation-intent.v1" && value.operation_id === operationId && value.configuration_sha256 === configurationSha256
      && operationId === fingerprint({ invocation_id: value.invocation_id, request_sha256: value.request_sha256 })
      && EXECUTION_ID.test(value.invocation_id) && HASH.test(value.request_sha256) && HASH.test(value.launch_sha256)
      && value.parent_job_name === `Local\\aidn-execution-${fingerprint({ invocation_id: value.invocation_id, request_sha256: value.request_sha256 }).slice(0, 32)}`
      && Number.isFinite(Date.parse(value.observed_at)), "SANDBOX_JOURNAL_INTENT_INVALID");
  }
  function termination(intent, observed, member) {
    if (observed?.termination_state === "not_started" && observed.runner === null && observed.termination_proof === null) return "not_started";
    const proof = observed?.termination_proof;
    return observed?.termination_state === "confirmed" && proof?.method === "windows-job-object" && proof.active_processes === 0
      && proof.runner_id === intent.invocation_id && proof.job_name === intent.parent_job_name
      && observed.runner?.runner_id === intent.invocation_id && observed.runner.job_name === proof.job_name && observed.runner.pid === proof.pid
      && observed.runner.started_at === proof.started_at && Number.isSafeInteger(proof.pid) && proof.pid > 0 && Number.isFinite(Date.parse(proof.observed_at))
      && member?.parent_job_name === proof.job_name && member.parent_job_member === true && member.runner_id === intent.invocation_id
      && member.request_sha256 === intent.request_sha256 && member.job_assigned === true ? "confirmed" : "unknown";
  }
  async function prepare({ invocationId, requestSha256, launch }) {
    const operationId = fingerprint({ invocation_id: invocationId, request_sha256: requestSha256 });
    const intent = { contract_version: "codex-validation-intent.v1", operation_id: operationId, configuration_sha256: configurationSha256,
      invocation_id: invocationId, request_sha256: requestSha256, launch_sha256: fingerprint(launch), parent_job_name: launch.jobName, observed_at: new Date().toISOString() };
    intentValid(intent, operationId);
    return { intent, evidence: await write(`${operationId}.intent.json`, intent) };
  }
  async function record({ prepared, controller, membership, child }) {
    intentValid(prepared.intent, prepared.intent.operation_id);
    requireThat(exact(prepared.evidence, ["ref", "sha256", "bytes"]) && prepared.evidence.ref === `validation-boundary/${prepared.intent.operation_id}.intent.json`
      && HASH.test(prepared.evidence.sha256) && positive(prepared.evidence.bytes, 1024 * 1024), "SANDBOX_JOURNAL_INTENT_CHANGED");
    const reread = await readFile(path.join(evidenceRoot, prepared.evidence.ref), 1024 * 1024, undefined, true);
    requireThat(reread.sha256 === prepared.evidence.sha256 && reread.bytes === prepared.evidence.bytes
      && fingerprint(JSON.parse(reread.content)) === fingerprint(prepared.intent), "SANDBOX_JOURNAL_INTENT_CHANGED");
    const value = { contract_version: "codex-validation-terminal.v1", operation_id: prepared.intent.operation_id, intent_sha256: prepared.evidence.sha256,
      configuration_sha256: configurationSha256, invocation_id: prepared.intent.invocation_id, request_sha256: prepared.intent.request_sha256,
      termination_state: termination(prepared.intent, controller, membership), controller: structuredClone(controller), membership: structuredClone(membership), child: structuredClone(child), observed_at: new Date().toISOString() };
    return { terminal: value, evidence: await write(`${prepared.intent.operation_id}.terminal.json`, value) };
  }
  async function inspect() {
    const operations = [];
    try {
      await physical(evidenceRoot, true);
      try { await fs.lstat(directory); } catch (cause) { if (cause.code === "ENOENT") return { operations, uncertain_read: null }; throw cause; }
      await physical(directory, true); const names = await fs.readdir(directory);
      requireThat(names.length <= 8192 && names.every(name => /^[a-f0-9]{64}\.(?:intent|terminal)\.json$/u.test(name)), "SANDBOX_JOURNAL_INVALID");
      for (const name of names.filter(value => value.endsWith(".terminal.json"))) requireThat(names.includes(name.replace(".terminal.json", ".intent.json")), "SANDBOX_JOURNAL_ORPHAN_TERMINAL");
      for (const name of names.filter(value => value.endsWith(".intent.json")).sort()) {
        const operationId = name.slice(0, 64), read = await readFile(path.join(directory, name), 1024 * 1024, undefined, true), intent = JSON.parse(read.content);
        intentValid(intent, operationId); let terminal = null, terminalEvidence = null;
        const terminalName = `${operationId}.terminal.json`;
        if (names.includes(terminalName)) {
          const closed = await readFile(path.join(directory, terminalName), 1024 * 1024, undefined, true); terminal = JSON.parse(closed.content);
          requireThat(exact(terminal, ["contract_version", "operation_id", "intent_sha256", "configuration_sha256", "invocation_id", "request_sha256", "termination_state", "controller", "membership", "child", "observed_at"])
            && terminal.contract_version === "codex-validation-terminal.v1" && terminal.operation_id === operationId && terminal.intent_sha256 === read.sha256
            && terminal.configuration_sha256 === configurationSha256 && terminal.invocation_id === intent.invocation_id && terminal.request_sha256 === intent.request_sha256
            && Number.isFinite(Date.parse(terminal.observed_at)) && terminal.termination_state === termination(intent, terminal.controller, terminal.membership), "SANDBOX_JOURNAL_TERMINAL_INVALID");
          terminalEvidence = reference(terminalName, closed.content);
        }
        operations.push({ operation_id: operationId, invocation_id: intent.invocation_id, request_sha256: intent.request_sha256,
          configuration_sha256: configurationSha256, intent_sha256: read.sha256, intent, terminal, evidence: [reference(name, read.content), ...(terminalEvidence ? [terminalEvidence] : [])],
          termination_state: terminal?.termination_state ?? "unknown", recovery_required: !terminal || terminal.termination_state === "unknown" });
      }
      return { operations, uncertain_read: null };
    } catch (cause) { return { operations, uncertain_read: { reason_code: cause.code ?? "SANDBOX_JOURNAL_UNREADABLE" } }; }
  }
  return Object.freeze({ prepare, record, inspect });
}

// File-pin inspection is read-only and platform-independent. It neither probes
// the client nor grants launch availability, including for a matching hash.
export async function inspectCodexSandboxValidationBinaryPins(config, { signal } = {}) {
  assertCodexSandboxValidationConfiguration(config);
  // Match the worker client bound without widening runner/helper/source limits.
  requireThat((await readFile(config.client.executable, 512 * 1024 * 1024, signal)).sha256 === config.client.sha256, "SANDBOX_BINARY_CHANGED");
  for (const row of [config.runner, config.trampoline, { executable: SOURCE, sha256: config.trampoline.source_sha256 },
    { executable: CONTROLLER, sha256: config.controller.candidateSha256 }, { executable: HELPER_SOURCE, sha256: config.controller.helperSourceSha256 },
    { executable: config.controller.helperPath, sha256: config.controller.helperSha256 }]) {
    requireThat((await readFile(row.executable, 256 * 1024 * 1024, signal)).sha256 === row.sha256, "SANDBOX_BINARY_CHANGED");
  }
}

// Read-only preflight shared by runtime and the explicit qualification tool.
// It establishes pinned material, never native availability on its own.
export async function inspectCodexSandboxValidationConfiguration(config, { cwd, signal } = {}) {
  assertCodexSandboxValidationConfiguration(config);
  requireThat(process.platform === config.platform && process.arch === config.architecture, "SANDBOX_PLATFORM_UNQUALIFIED");
  await inspectCodexSandboxValidationBinaryPins(config, { signal });
  for (const root of Object.values(config.roots)) await physical(root, true);
  const home = await physical(config.profile.home, true);
  requireThat(fingerprint({ physical_path: await fs.realpath(config.profile.home), device: home.dev, inode: home.ino, birthtime_ms: home.birthtimeMs }) === config.profile.home_identity_sha256, "SANDBOX_HOME_CHANGED");
  await verifyRecords(config.profile.config_layers, signal); await verifyRecords(config.profile.provisioning_files, signal);
  if (cwd) {
    await physical(cwd, true); requireThat(inside(config.roots.snapshots, cwd), "SANDBOX_SNAPSHOT_INVALID");
    const required = new Set([path.join(config.profile.home, "config.toml")]); let cursor = cwd;
    for (;;) { required.add(path.join(cursor, ".codex", "config.toml")); const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent; }
    for (const file of required) {
      if (inside(config.roots.snapshots, file) && !config.profile.config_layers.some(row => equalPath(row.path, file))) {
        // Snapshot names are allocated after plan freeze. Their configuration
        // layers must be absent, rather than added to a frozen allowlist later.
        await verifyRecords([{ path: file, present: false }], signal);
      } else requireThat(config.profile.config_layers.some(row => equalPath(row.path, file)), "SANDBOX_CONFIG_LAYER_UNOBSERVED");
    }
  }
  return { configuration_sha256: fingerprint(config), native: false };
}


export function createCodexSandboxValidationBoundary({ configuration, qualification = null, publicKey, evidenceRoot } = {}) {
  const config = structuredClone(configuration); assertCodexSandboxValidationConfiguration(config);
  requireThat(absolute(evidenceRoot), "SANDBOX_EVIDENCE_ROOT_INVALID");
  const envelope = structuredClone(qualification), key = authority(publicKey), controller = createWindowsProcessTreeController(config.controller);
  const journal = createCodexSandboxValidationJournal({ evidenceRoot, configurationSha256: fingerprint(config) });
  const active = new Map(), finished = new Map(), used = new Set();
  let busy = false;
  async function inspect({ cwd, signal } = {}) {
    assertCodexSandboxValidationLaunchSupported(config);
    requireThat(process.platform === config.platform && process.arch === config.architecture, "SANDBOX_PLATFORM_UNQUALIFIED");
    const q = checkQualification(envelope, config, key);
    await inspectCodexSandboxValidationConfiguration(config, { cwd, signal });
    const qualifiedCases = [];
    for (const reference of q.evidence) {
      requireThat(exact(reference, ["ref", "sha256", "bytes"]) && typeof reference.ref === "string" && !path.isAbsolute(reference.ref)
        && /^[a-zA-Z0-9._/-]+$/u.test(reference.ref) && reference.ref.split("/").every(part => part && part !== "." && part !== ".." && !part.endsWith(".")
          && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)) && HASH.test(reference.sha256)
        && positive(reference.bytes, 8 * 1024 * 1024), "SANDBOX_EVIDENCE_INVALID");
      const observed = await readFile(path.join(evidenceRoot, reference.ref), 8 * 1024 * 1024, signal, true);
      requireThat(observed.sha256 === reference.sha256 && observed.bytes === reference.bytes, "SANDBOX_EVIDENCE_CHANGED");
      qualifiedCases.push(nativeCase(JSON.parse(observed.content), q, config));
    }
    requireThat(qualifiedCases.sort().join("|") === "callback|cancel|filesystem|network|timeout", "SANDBOX_NATIVE_EVIDENCE_INCOMPLETE");
    return { available: true, native: true, configuration_sha256: fingerprint(config) };
  }
  const failure = (request, reason, termination = "not_started") => ({ boundary_id: ID, invocation_id: request.invocation_id,
    request_sha256: request.request_sha256, termination_state: termination, outcome: termination === "unknown" ? "indeterminate" : "failed",
    exit_code: null, signal: null, reason_code: reason, stdout: "", stderr: "" });
  async function run(request, { signal } = {}) {
    const input = structuredClone(request), began = performance.now(), launch = buildCodexSandboxValidationInvocation(config, input);
    requireThat(!used.has(input.invocation_id), "SANDBOX_INVOCATION_ALREADY_USED");
    requireThat(signal === undefined || signal instanceof AbortSignal, "SANDBOX_SIGNAL_INVALID");
    if (signal?.aborted) return failure(input, "SANDBOX_CANCELLED");
    assertCodexSandboxValidationLaunchSupported(config);
    requireThat(!busy, "SANDBOX_BOUNDARY_BUSY"); busy = true;
    try {
    used.add(input.invocation_id);
    await inspect({ cwd: input.cwd, signal });
    const prior = await journal.inspect();
    requireThat(!prior.uncertain_read && prior.operations.every(row => !row.recovery_required) && active.size === 0, "SANDBOX_RECOVERY_REQUIRED");
    const durable = await journal.prepare({ invocationId: input.invocation_id, requestSha256: input.request_sha256, launch });
    const remaining = input.max_duration_ms - (performance.now() - began); requireThat(remaining > 0 && !signal?.aborted, "SANDBOX_CANCELLED");
    const stop = new AbortController(), abort = () => stop.abort(signal.reason); signal?.addEventListener("abort", abort, { once: true });
    const entry = { requestHash: input.request_sha256, stop, result: null, done: null }; active.set(input.invocation_id, entry);
    entry.done = (async () => {
      const parser = createCodexValidationStreamParser(input); let protocolFailed = null;
      const observed = await controller.run({ ...launch, maxDurationMs: Math.max(1, Math.floor(remaining)) }, { signal: stop.signal, async onEvent(event) {
        if (event.type === "prepared") { await inspect({ cwd: input.cwd, signal: stop.signal }); requireThat(performance.now() - began < input.max_duration_ms, "SANDBOX_CANCELLED"); }
        if (event.type === "stdout") { try { parser.consume(event.bytes); } catch (cause) { protocolFailed = cause.code; throw cause; } }
      } });
      let decoded; try { decoded = parser.finish(); } catch (cause) { protocolFailed ??= cause.code; }
      const closed = await journal.record({ prepared: durable, controller: observed, membership: parser.observation(), child: decoded?.terminal ?? null });
      if (protocolFailed || observed.termination_state !== "confirmed" || observed.outcome !== "completed") {
        // A closed CLI alone is insufficient. A prepared frame attests that
        // BOTH trampoline and runner belonged to this exact outer Job before
        // resume. Its zero-process proof then covers interrupted inner output.
        return failure(input, protocolFailed ?? observed.reason_code, closed.terminal.termination_state);
      }
      await inspect({ cwd: input.cwd, signal });
      return { ...failure(input, decoded.terminal.outcome === "completed" ? "SANDBOX_EXECUTED" : "SANDBOX_CHILD_FAILED", "confirmed"),
        outcome: decoded.terminal.outcome, exit_code: decoded.terminal.exit_code, stdout: decoded.stdout, stderr: decoded.stderr,
        process_evidence: { controller: observed.termination_proof, child: decoded.terminal, environment: decoded.prepared.environment_sha256 } };
    })().catch(cause => failure(input, cause.code ?? "SANDBOX_FAILED", "unknown")).finally(() => {
      signal?.removeEventListener("abort", abort); active.delete(input.invocation_id);
    });
    entry.result = await entry.done; finished.set(input.invocation_id, entry.result); return structuredClone(entry.result);
    } finally { busy = false; }
  }
  return Object.freeze({ getDescriptor: () => ({ boundary_id: ID, qualification: structuredClone(envelope) }),
    inspectOperations: journal.inspect,
    async checkAvailability(input) { try { return await inspect(input); } catch (cause) { return { available: false, native: false, reason_code: cause.code ?? "SANDBOX_UNAVAILABLE" }; } }, run,
    async requestStop({ invocationId, requestSha256 }) {
      const entry = active.get(invocationId), previous = finished.get(invocationId);
      requireThat(entry?.requestHash === requestSha256 || previous?.request_sha256 === requestSha256, "SANDBOX_STOP_IDENTITY_MISMATCH");
      if (previous) return structuredClone(previous); entry.stop.abort();
      let timer; try { return await Promise.race([entry.done, new Promise(resolve => { timer = setTimeout(() => resolve(failure({ invocation_id: invocationId, request_sha256: requestSha256 }, "SANDBOX_STOP_UNCONFIRMED", "unknown")), 750); })]); }
      finally { clearTimeout(timer); }
    } });
}
