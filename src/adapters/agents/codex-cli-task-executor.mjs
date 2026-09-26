import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { assertAgentExecutionContract, fingerprintAgentExecutionValue } from "../../core/agents/agent-execution-contracts.mjs";
import { createAgentTaskEventChannel } from "../../core/ports/agent-task-executor-port.mjs";
import { createCodexJsonlProtocol } from "./codex-jsonl-protocol.mjs";

const EXECUTOR = "codex-cli-task";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => fingerprintAgentExecutionValue(a) === fingerprintAgentExecutionValue(b);
const descriptor = Object.freeze({ contract_version: "agent-task-executor.v1", executor_id: EXECUTOR,
  executor_version: "1", capabilities: Object.freeze({ events: true, cancellation: true, explicit_cwd: true }) });
const fail = code => { throw Object.assign(new Error(code), { code }); };
function boundedCallback(operation, { signal, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let timer, settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(new Error("CODEX_CALLBACK_CANCELLED"));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => finish(new Error("CODEX_CALLBACK_TIMEOUT")), timeoutMs);
    Promise.resolve().then(operation).then(value => finish(null, value), error => finish(error));
  });
}

export function buildCodexTaskArguments(request) {
  assertAgentExecutionContract("request", request);
  if (request.execution.executor_id !== EXECUTOR) fail("CODEX_EXECUTOR_MISMATCH");
  // Read only the explicitly isolated profile: its native project/hook trust
  // must remain visible. --ignore-user-config would also hide project trust.
  return ["exec", "--json", "--ephemeral", "--strict-config",
    "--cd", request.cwd, "--sandbox", request.execution.sandbox, "--model", request.execution.model,
    "-c", `model_reasoning_effort=${JSON.stringify(request.execution.effort)}`, "-c", "agents.enabled=false",
    // Loading the isolated profile preserves native trust, not permission to
    // widen this worker's filesystem, temporary-directory or network boundary.
    "-c", 'approval_policy="never"', "-c", "sandbox_workspace_write.writable_roots=[]",
    "-c", "sandbox_workspace_write.network_access=false",
    "-c", "sandbox_workspace_write.exclude_tmpdir_env_var=true",
    "-c", "sandbox_workspace_write.exclude_slash_tmp=true",
    ...(process.platform === "win32" ? ["-c", 'windows.sandbox="elevated"'] : []), "-"];
}

// Explicit allowlist: do not copy process.env, PG credentials, API keys, Git
// redirections or user configuration overrides into a delegated worker.
export function createCodexWorkerEnvironment({ host = process.env, codexHome, tempDirectory, admission } = {}) {
  if (!path.isAbsolute(codexHome ?? "") || !path.isAbsolute(tempDirectory ?? "")
      || !admission || !/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/v1\/admit$/.test(admission.endpoint ?? "")
      || Number(new URL(admission.endpoint).port) > 65535 || !/^[a-f0-9]{64}$/.test(admission.token ?? "")
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(admission.attemptId ?? "")
      || !/^[a-f0-9]{64}$/.test(admission.requestSha256 ?? "")) fail("CODEX_ENVIRONMENT_INVALID");
  const names = new Set(["systemroot", "windir", "comspec", "path", "pathext", "userprofile", "localappdata", "appdata", "programdata"]);
  const env = Object.fromEntries(Object.entries(host).filter(([key, value]) => names.has(key.toLowerCase()) && typeof value === "string"));
  return { ...env, CODEX_HOME: codexHome, TEMP: tempDirectory, TMP: tempDirectory,
    AIDN_AGENT_ADMISSION_ENDPOINT: admission.endpoint, AIDN_AGENT_ADMISSION_TOKEN: admission.token,
    AIDN_AGENT_ATTEMPT_ID: admission.attemptId, AIDN_AGENT_REQUEST_SHA256: admission.requestSha256 };
}

function verifyExecutable(runtime) {
  if (!path.isAbsolute(runtime.executable ?? "") || !/^[a-f0-9]{64}$/.test(runtime.sha256 ?? "")) fail("CODEX_EXECUTABLE_INVALID");
  const stat = fs.lstatSync(runtime.executable);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || hash(fs.readFileSync(runtime.executable)) !== runtime.sha256) fail("CODEX_EXECUTABLE_CHANGED");
}

// Dependencies are supplied by the supervisor. No default executor is registered.
// qualify is an explicit read-only check of native evidence bound to this exact
// runtime/candidate/OS/hooks. Preparation, durable launch intent and observed PID
// recording remain required canonical supervisor operations, never worker calls.
export function createCodexCliTaskExecutor({ runtime, controller, qualify, prepare, recordLaunchIntent,
  observeRunner, openEvidence, callbackTimeoutMs = 5000 } = {}) {
  for (const callback of [qualify, prepare, recordLaunchIntent, observeRunner, openEvidence]) {
    if (typeof callback !== "function") throw new TypeError("CODEX_SUPERVISOR_DEPENDENCY_REQUIRED");
  }
  if (!runtime || !controller || typeof controller.run !== "function" || typeof controller.checkAvailability !== "function") throw new TypeError("CODEX_PROCESS_CONTROLLER_REQUIRED");
  if (!path.isAbsolute(runtime.codexHome ?? "")) throw new TypeError("CODEX_PROFILE_REQUIRED");
  if (!Number.isSafeInteger(callbackTimeoutMs) || callbackTimeoutMs < 1 || callbackTimeoutMs > 5000) throw new TypeError("CODEX_CALLBACK_LIMIT_INVALID");
  const frozenRuntime = structuredClone(runtime);
  let active = false;
  async function availability({ cwd, signal } = {}) {
    let reason = "qualified_prerequisites", available = false;
    try {
      if (!path.isAbsolute(cwd ?? "") || signal?.aborted) fail("CODEX_AVAILABILITY_CANCELLED_OR_INVALID");
      verifyExecutable(frozenRuntime);
      if (!fs.statSync(cwd).isDirectory()) fail("CODEX_CWD_INVALID");
      const availabilitySignal = signal ?? new AbortController().signal;
      const processAvailability = await boundedCallback(() => controller.checkAvailability({ cwd, signal: availabilitySignal }),
        { signal: availabilitySignal, timeoutMs: callbackTimeoutMs });
      if (processAvailability.available !== true) fail("CODEX_PROCESS_CONTROL_UNAVAILABLE");
      const qualification = await boundedCallback(() => qualify({ runtime: structuredClone(frozenRuntime), cwd, signal: availabilitySignal }),
        { signal: availabilitySignal, timeoutMs: callbackTimeoutMs });
      if (qualification?.qualified !== true) fail("CODEX_NATIVE_QUALIFICATION_REQUIRED");
      available = true;
    } catch (error) { reason = /^CODEX_[A-Z_]+$/.test(error.code ?? error.message) ? (error.code ?? error.message) : "CODEX_PREREQUISITE_UNAVAILABLE"; }
    return { contract_version: "agent-task-availability.v1", executor_id: EXECUTOR,
      status: available ? "available" : "unavailable", reason_code: reason };
  }
  return Object.freeze({
    getDescriptor() { return structuredClone(descriptor); },
    checkAvailability: availability,
    async runTask(input, { signal, onEvent } = {}) {
      assertAgentExecutionContract("request", input);
      const request = structuredClone(input), args = buildCodexTaskArguments(request);
      if (!same(request.execution.engine, frozenRuntime.engine)) fail("CODEX_CANDIDATE_MISMATCH");
      if (active) fail("CODEX_EXECUTOR_ALREADY_RUNNING");
      if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError("CODEX_SIGNAL_INVALID");
      if (onEvent !== undefined && typeof onEvent !== "function") throw new TypeError("Agent task event channel requires callbacks");
      const stop = new AbortController();
      const bounded = operation => boundedCallback(operation, { signal: stop.signal,
        timeoutMs: Math.min(callbackTimeoutMs, request.limits.max_duration_ms) });
      const channel = createAgentTaskEventChannel({ onEvent: event => bounded(() => onEvent?.(event, { signal: stop.signal })), requestStop: () => stop.abort() });
      active = true;
      let deadlineReached = false;
      const deadlineTimer = setTimeout(() => { deadlineReached = true; stop.abort(); }, Math.min(request.limits.max_duration_ms, 86400000));
      const abort = () => stop.abort();
      if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
      let sequence = 0, processResult = null, evidence = null, protocol = null, called = false, failure = null;
      const parser = createCodexJsonlProtocol();
      const emit = async (type, message) => channel.emit({ contract_version: "agent-task-event.v1",
        event_id: randomUUID(), run_id: request.run_id, task_id: request.task_id, attempt_id: request.attempt_id,
        plan_sha256: request.plan_sha256, sequence: ++sequence, type, message, evidence: [] });
      try {
        const available = await bounded(() => availability({ cwd: request.cwd, signal: stop.signal }));
        if (available.status !== "available") fail(available.reason_code);
        const prepared = await bounded(() => prepare(structuredClone(request), { signal: stop.signal }));
        if (!prepared || prepared.request_sha256 !== fingerprintAgentExecutionValue(request)
            || !prepared.env || typeof prepared.env !== "object") fail("CODEX_PREPARATION_INVALID");
        // The environment must be produced by the allowlist builder, not inherited.
        const allowed = /^(?:systemroot|windir|comspec|path|pathext|userprofile|localappdata|appdata|programdata|CODEX_HOME|TEMP|TMP|AIDN_AGENT_ADMISSION_ENDPOINT|AIDN_AGENT_ADMISSION_TOKEN|AIDN_AGENT_ATTEMPT_ID|AIDN_AGENT_REQUEST_SHA256)$/i;
        if (Object.entries(prepared.env).some(([key, value]) => !allowed.test(key) || typeof value !== "string")
            || prepared.env.AIDN_AGENT_ATTEMPT_ID !== request.attempt_id
            || prepared.env.AIDN_AGENT_REQUEST_SHA256 !== fingerprintAgentExecutionValue(request)) fail("CODEX_ENVIRONMENT_INVALID");
        const rebuilt = createCodexWorkerEnvironment({ host: prepared.env, codexHome: prepared.env.CODEX_HOME,
          tempDirectory: prepared.env.TEMP, admission: { endpoint: prepared.env.AIDN_AGENT_ADMISSION_ENDPOINT,
            token: prepared.env.AIDN_AGENT_ADMISSION_TOKEN, attemptId: request.attempt_id,
            requestSha256: fingerprintAgentExecutionValue(request) } });
        if (!same(rebuilt, prepared.env) || prepared.env.CODEX_HOME !== frozenRuntime.codexHome) fail("CODEX_ENVIRONMENT_INVALID");
        for (const directory of [prepared.env.CODEX_HOME, prepared.env.TEMP]) {
          const relative = path.relative(request.cwd, directory);
          if (!relative || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))) fail("CODEX_PROFILE_INSIDE_WORKER");
        }
        const recheckQualification = async () => {
          const checked = await bounded(() => availability({ cwd: request.cwd, signal: stop.signal }));
          if (checked.status !== "available") fail(checked.reason_code);
        };
        await recheckQualification();
        evidence = await bounded(() => openEvidence(structuredClone(request), { signal: stop.signal }));
        if (typeof evidence?.append !== "function" || typeof evidence?.finish !== "function") fail("CODEX_EVIDENCE_INVALID");
        if (stop.signal.aborted) fail("CODEX_CANCELLED_BEFORE_LAUNCH");
        await bounded(() => recordLaunchIntent(structuredClone(request), { signal: stop.signal }));
        verifyExecutable(frozenRuntime);
        called = true;
        processResult = await controller.run({ runnerId: randomUUID(), executable: frozenRuntime.executable,
          executableSha256: frozenRuntime.sha256, args, cwd: request.cwd, env: prepared.env,
          stdin: request.instruction, maxDurationMs: request.limits.max_duration_ms,
          maxOutputBytes: 16 * 1024 * 1024, maxPendingBytes: 1024 * 1024, stopTimeoutMs: 5000 }, {
          signal: stop.signal,
          async onEvent(event) {
            if (event.type === "prepared") {
              await bounded(() => observeRunner(structuredClone(request), event, { signal: stop.signal }));
              await recheckQualification();
            }
            else if (event.type === "resumed") await emit("started", "Codex task process started");
            else if (["stdout", "stderr"].includes(event.type)) {
              await bounded(() => evidence.append(event.type, event.bytes));
              if (event.type === "stdout") await parser.push(event.bytes, async type => emit("progress", `Codex ${type}`));
            } else fail("CODEX_PROCESS_EVENT_INVALID");
          },
        });
        try { protocol = parser.finish(); } catch (error) { failure = error.message; }
      } catch (error) {
        failure = /^CODEX_[A-Z_]+$/.test(error.code ?? error.message) ? (error.code ?? error.message) : "CODEX_EXECUTION_FAILED";
        stop.abort();
      } finally {
        try { await channel.close(); } catch { failure = "CODEX_EVENT_CALLBACK_FAILED"; }
        signal?.removeEventListener("abort", abort);
        clearTimeout(deadlineTimer);
      }
      let refs = [];
      try { if (evidence) refs = await boundedCallback(() => evidence.finish({ process: processResult, protocol }),
        { signal: new AbortController().signal, timeoutMs: callbackTimeoutMs }); }
      catch { failure = "CODEX_EVIDENCE_FAILED"; }
      active = false;
      let reason = failure ?? (/^[A-Z_]+$/.test(processResult?.reason_code ?? "") ? processResult.reason_code : "CODEX_PROCESS_FAILED");
      const termination = processResult?.termination_state ?? (called ? "unknown" : "not_started");
      let outcome = termination === "unknown" ? "indeterminate" : "failed";
      if (termination !== "unknown") {
        if (processResult?.outcome === "timed_out" || deadlineReached) { outcome = "timed_out"; reason = "CODEX_TIMED_OUT"; }
        else if (signal?.aborted) { outcome = "cancelled"; reason = "CODEX_CANCELLED"; }
        else if (processResult?.outcome === "completed" && processResult?.exit_code === 0 && termination === "confirmed" && protocol?.terminal === "completed"
            && !channel.getFailure() && !failure) { outcome = "completed"; reason = "CODEX_COMPLETED"; }
        else if (protocol?.terminal === "failed") reason = "CODEX_REPORTED_FAILURE";
      }
      const result = { contract_version: "agent-task-result.v1", run_id: request.run_id, task_id: request.task_id,
        attempt_id: request.attempt_id, plan_sha256: request.plan_sha256, task_contract_sha256: request.task_contract_sha256,
        input_sha: request.input_sha, delegation_id: request.delegation_id, ownership: request.ownership,
        request_sha256: fingerprintAgentExecutionValue(request), outcome, reason_code: reason, termination_state: termination,
        process: { exit_code: termination === "not_started" ? null : processResult?.exit_code ?? null,
          signal: termination === "not_started" ? null : processResult?.signal ?? null }, evidence: refs };
      assertAgentExecutionContract("result", result);
      return result;
    },
  });
}
