import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fingerprintAgentExecutionValue as hash } from "../../../core/agents/agent-execution-contracts.mjs";
import { assertManagedSetupBridgeRequest } from "./codex-managed-setup-bridge.mjs";

const SCRIPT = "src/adapters/agents/process-tree/codex-managed-setup-preflight.ps1";
const MAX = 65536;
const exact = (v, keys) => v && typeof v === "object" && !Array.isArray(v)
  && Object.keys(v).sort().join("|") === [...keys].sort().join("|");
const fail = code => { throw Object.assign(new Error(code), { code }); };
const ensure = (ok, code) => { if (!ok) fail(code); };
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const stamp = s => typeof s === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}Z$/u.test(s)
  && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s.replace(/(\.\d{3})\d{4}Z$/u, "$1Z");
function frozen(v) { if (v && typeof v === "object") { Object.values(v).forEach(frozen); Object.freeze(v); } return v; }

async function scriptBytes(file, expected) {
  for (let item = file;; item = path.dirname(item)) {
    const info = await fs.lstat(item);
    ensure(!info.isSymbolicLink(), "MANAGED_PREFLIGHT_SOURCE_ALIAS");
    if (path.dirname(item) === item) break;
  }
  const before = await fs.lstat(file);
  ensure(before.isFile() && before.nlink === 1 && before.size <= 1024 * 1024
    && (await fs.realpath(file)).toLowerCase() === file.toLowerCase(), "MANAGED_PREFLIGHT_SOURCE_INVALID");
  const handle = await fs.open(file, "r");
  try {
    const opened = await handle.stat();
    ensure(before.dev === opened.dev && before.ino === opened.ino, "MANAGED_PREFLIGHT_SOURCE_CHANGED");
    const bytes = Buffer.alloc(before.size + 1); let count = 0;
    while (count < bytes.length) {
      const read = await handle.read(bytes, count, bytes.length - count, null);
      if (!read.bytesRead) break;
      count += read.bytesRead;
    }
    const after = await handle.stat(), current = await fs.lstat(file);
    ensure(count === before.size && [after, current].every(row => row.dev === before.dev && row.ino === before.ino
      && row.size === before.size && row.mtimeMs === before.mtimeMs && row.ctimeMs === before.ctimeMs)
      && digest(bytes.subarray(0, count)) === expected, "MANAGED_PREFLIGHT_SOURCE_CHANGED");
  } finally { await handle.close(); }
}
function token(row, identity, job = null) {
  ensure(exact(row, ["pid", "started_at", "elevated", "admin_enabled", "integrity_sid", "elevation_type", "token_type",
    "has_restrictions", "restricted_sid_count", "is_app_container", "job_name", "job_member"])
    && row.pid === identity.pid && row.started_at === identity.started_at && stamp(row.started_at)
    && row.elevated === true && row.admin_enabled === true && row.integrity_sid === "S-1-16-12288"
    && [1, 2].includes(row.elevation_type) && row.token_type === 1 && row.has_restrictions === false
    && row.restricted_sid_count === 0 && row.is_app_container === false && row.job_name === job
    && row.job_member === (job === null ? null : true), "MANAGED_PREFLIGHT_TOKEN_REFUSED");
}

/** Parent-side native producer. Only the fixed read-only PowerShell script is
 * executed, under a separate bounded Job. Import and construction perform no
 * I/O. The controlling Windows Job implementation remains the trusted native
 * boundary; fixture controllers cannot establish native evidence.
 *
 * recordEvidence is a trusted parent persistence port: it must resolve only
 * after the immutable record is durable. Intent precedes creation, prepared
 * precedes resume, and terminal evidence precedes acceptance. A failed write
 * is never retried here, since its persistence may be indeterminate. Failures
 * carry a frozen error.preflight for the parent's reconciliation journal. */
export function createManagedSetupParentPreflight({ controller, parentIdentity, recordEvidence } = {}) {
  ensure(typeof controller?.run === "function" && typeof controller?.checkAvailability === "function" && typeof recordEvidence === "function"
    && exact(parentIdentity, ["pid", "started_at"]) && parentIdentity.pid === process.pid && stamp(parentIdentity.started_at),
  "MANAGED_PREFLIGHT_DEPENDENCIES_REQUIRED");
  const parent = frozen(structuredClone(parentIdentity));
  const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
  const retain = (value, maximum = 262144) => { hash(value); ensure(Buffer.byteLength(JSON.stringify(value)) <= maximum, "MANAGED_PREFLIGHT_EVIDENCE_LIMIT"); return frozen(structuredClone(value)); };
  return async function preflight({ request, phase, runner = null, signal }) {
    assertManagedSetupBridgeRequest(request);
    request = retain(request); runner = runner === null ? null : retain(runner, 16384);
    ensure(signal instanceof AbortSignal && !signal.aborted && ["before_create", "before_resume"].includes(phase)
      && (phase === "before_create" ? runner === null : runner && runner.runner_id === request.invocation_id
        && runner.job_name === request.job_name && Number.isSafeInteger(runner.pid) && runner.pid > 0 && stamp(runner.started_at)),
    "MANAGED_PREFLIGHT_INPUT_INVALID");
    const script = path.join(request.candidate_root, SCRIPT), expected = request.source_inventory[SCRIPT];
    const invocation = randomUUID(), jobName = "Local\\aidn-execution-" + randomUUID().replaceAll("-", "");
    const identity = { contract_version: "aidn-managed-setup-parent-preflight-evidence.v1",
      request_sha256: request.request_sha256, phase, runner_id: invocation, job_name: jobName };
    const payload = { contract_version: "aidn-managed-setup-preflight-request.v1", request_sha256: request.request_sha256,
      phase, launcher: parent, target: runner ? { pid: runner.pid, started_at: runner.started_at, job_name: request.job_name } : null,
      max_duration_ms: 5000 };
    let available = null, prepared = null, processResult = null, requested = false, controllerError = null;
    let intentRecorded = false, preparedRecorded = false, terminalRecorded = false, journalAttempted = false, sinkFailed = false, terminalAttempted = false, eventsClosed = false;
    let evidenceQueue = Promise.resolve(), stdoutBytes = 0, stderrBytes = 0; const chunks = [];
    const checkpoint = () => ensure(!signal.aborted, "MANAGED_PREFLIGHT_CANCELLED");
    // The sink is a mandatory trusted parent port. Its persisted receipt is not
    // inferred from a Boolean in the request. Writes remain serialized even
    // when a failed write is followed by terminal reconciliation evidence.
    async function record(kind, fields) {
      journalAttempted = true;
      const event = retain({ ...identity, kind, ...fields });
      const next = evidenceQueue.then(() => recordEvidence(event));
      evidenceQueue = next.then(() => undefined, () => undefined);
      try { await next; } catch { sinkFailed = true; fail("MANAGED_PREFLIGHT_EVIDENCE_FAILED"); }
    }
    function validPrepared(value) {
      return value && value.runner_id === invocation && value.job_name === jobName
        && Number.isSafeInteger(value.pid) && value.pid > 0 && stamp(value.started_at)
        && Number.isSafeInteger(value.helper_pid) && value.helper_pid > 0
        && value.executable_sha256 === request.powershell.sha256
        && ["helper_sha256", "source_sha256", "candidate_sha256"].every(k => sha(value[k]) && value[k] === available?.[k]);
    }
    function termination() {
      if (!requested) return "not_started";
      if (!prepared && processResult?.termination_state === "not_started"
        && processResult.runner === null && processResult.termination_proof === null) return "not_started";
      const proof = processResult?.termination_proof, observed = processResult?.runner;
      return prepared && validPrepared(prepared) && validPrepared(observed) && proof?.method === "windows-job-object"
        && processResult.termination_state === "confirmed" && proof.active_processes === 0 && stamp(proof.observed_at)
        && ["runner_id", "pid", "started_at", "job_name"].every(k => prepared[k] === observed[k] && proof[k] === observed[k])
        && prepared.helper_pid === observed.helper_pid
        && ["helper_sha256", "source_sha256", "candidate_sha256"].every(k => sha(proof[k]) && prepared[k] === observed[k]
          && observed[k] === proof[k] && proof[k] === available[k] && processResult.hashes?.[k] === available[k])
        && processResult.hashes?.executable_sha256 === request.powershell.sha256 ? "confirmed" : "unknown";
    }
    function state() {
      const terminationState = termination();
      return retain({ contract_version: "aidn-managed-setup-parent-preflight-state.v1",
        request_sha256: request.request_sha256, phase, requested, prepared, process: processResult,
        runner_id: invocation, job_name: jobName, termination_state: terminationState,
        journal_complete: !journalAttempted || intentRecorded && terminalRecorded && (!prepared || preparedRecorded),
        recovery_required: sinkFailed || requested && terminationState === "unknown" });
    }
    async function terminal() {
      terminalAttempted = true;
      await record("terminal", { prepared, process: processResult, controller_error: controllerError,
        termination_state: termination(), output: { stdout_base64: Buffer.concat(chunks, stdoutBytes).toString("base64"),
          stdout_sha256: digest(Buffer.concat(chunks, stdoutBytes)), stdout_bytes: stdoutBytes, stderr_bytes: stderrBytes } });
      terminalRecorded = true;
    }
    try {
      checkpoint(); await scriptBytes(script, expected); checkpoint();
      available = retain(await controller.checkAvailability({ cwd: request.cwd, signal,
        executable: request.powershell.executable, executableSha256: request.powershell.sha256 }), 16384);
      checkpoint();
      ensure(available.available === true && ["helper_sha256", "source_sha256", "candidate_sha256"].every(k => sha(available[k]))
        && available.candidate_sha256 === hash(request.source_inventory), "MANAGED_PREFLIGHT_CONTROLLER_UNAVAILABLE");
      await record("intent", { payload, payload_sha256: hash(payload), script_sha256: expected,
        powershell_sha256: request.powershell.sha256, candidate_inventory_sha256: hash(request.source_inventory) });
      intentRecorded = true; checkpoint();
      requested = true;
      try {
        processResult = retain(await controller.run({ runnerId: invocation, jobName, executable: request.powershell.executable,
          executableSha256: request.powershell.sha256,
          args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", script, "-RequestBase64", Buffer.from(JSON.stringify(payload)).toString("base64")],
          cwd: request.cwd, env: request.env, stdin: "", maxDurationMs: 7000, maxOutputBytes: MAX,
          maxPendingBytes: MAX, stopTimeoutMs: 1000 }, { signal, onEvent: async event => {
          checkpoint(); ensure(!eventsClosed, "MANAGED_PREFLIGHT_EVENTS_CLOSED");
          if (event.type === "prepared") {
            ensure(!prepared && validPrepared(event) && event.suspended === true && event.job_assigned === true, "MANAGED_PREFLIGHT_PREPARED_INVALID");
            prepared = retain(event, 16384);
            await scriptBytes(script, expected); checkpoint();
            ensure(!eventsClosed, "MANAGED_PREFLIGHT_EVENTS_CLOSED");
            await record("prepared", { prepared, script_sha256: expected });
            preparedRecorded = true; checkpoint();
          } else if (event.type === "stdout" || event.type === "stderr") {
            ensure(prepared && Buffer.isBuffer(event.bytes), "MANAGED_PREFLIGHT_STREAM_INVALID");
            if (event.type === "stdout") {
              ensure(stdoutBytes + event.bytes.length <= MAX, "MANAGED_PREFLIGHT_OUTPUT_LIMIT");
              stdoutBytes += event.bytes.length; chunks.push(Buffer.from(event.bytes));
            } else { stderrBytes += event.bytes.length; ensure(stderrBytes === 0, "MANAGED_PREFLIGHT_DIAGNOSTIC"); }
          }
        } }), 65536);
      } catch (error) { controllerError = typeof error?.code === "string" && /^MANAGED_PREFLIGHT_[A-Z_]+$/u.test(error.code)
        ? error.code : "MANAGED_PREFLIGHT_CONTROLLER_FAILED"; }
      eventsClosed = true;
      // Preserve every terminal result before checks that can reject it.
      await terminal();
      checkpoint();
      ensure(!controllerError && termination() === "confirmed" && processResult.outcome === "completed" && processResult.exit_code === 0
        && processResult.signal === null && processResult.reason_code === "PROCESS_EXITED", "MANAGED_PREFLIGHT_TERMINATION_UNCONFIRMED");
      const bytes = Buffer.concat(chunks, stdoutBytes);
      ensure(processResult.hashes?.stdout_sha256 === digest(bytes) && processResult.hashes?.stderr_sha256 === digest(Buffer.alloc(0))
        && processResult.bytes?.stdout === stdoutBytes && processResult.bytes?.stderr === 0 && stderrBytes === 0, "MANAGED_PREFLIGHT_OUTPUT_BINDING");
      let observation;
      try { observation = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail("MANAGED_PREFLIGHT_JSON_INVALID"); }
      ensure(exact(observation, ["contract_version", "request_sha256", "phase", "observed_at", "status", "launcher", "target", "helpers", "errors"])
        && observation.contract_version === "aidn-managed-setup-preflight.v1" && observation.request_sha256 === request.request_sha256
        && observation.phase === phase && observation.status === "OBSERVED" && Number.isFinite(Date.parse(observation.observed_at))
        && new Date(observation.observed_at).toISOString() === observation.observed_at
        && Date.parse(observation.observed_at) <= Date.now() && Date.now() - Date.parse(observation.observed_at) <= 5000
        && exact(observation.helpers, ["complete", "rows"]) && observation.helpers.complete === true
        && Array.isArray(observation.helpers.rows) && observation.helpers.rows.length === 0
        && Array.isArray(observation.errors) && observation.errors.length === 0, "MANAGED_PREFLIGHT_OBSERVATION_REFUSED");
      token(observation.launcher, parent);
      if (runner) token(observation.target, runner, request.job_name);
      else ensure(observation.target === null, "MANAGED_PREFLIGHT_TARGET_UNEXPECTED");
      return retain(observation);
    } catch (cause) {
      eventsClosed = true;
      if (journalAttempted && !terminalAttempted) { try { await terminal(); } catch {} }
      const error = Object.assign(new Error(typeof cause?.code === "string" && /^MANAGED_PREFLIGHT_[A-Z_]+$/u.test(cause.code)
        ? cause.code : "MANAGED_PREFLIGHT_FAILED"), { preflight: state() });
      error.code = error.message; throw error;
    }
  };
}
