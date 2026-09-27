import fs from "node:fs/promises";
import path from "node:path";
import { assertAgentLocalPath } from "../../core/agents/agent-local-path-policy.mjs";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { buildManagedSetupStartupPaths } from "../../core/agents/codex-managed-startup.mjs";
import { fingerprintAgentExecutionValue as fingerprint } from "../../core/agents/agent-execution-contracts.mjs";
import { assertManagedSetupBridgeRequest, MANAGED_SETUP_BRIDGE_SOURCE_FILES } from "../../adapters/agents/process-tree/codex-managed-setup-bridge.mjs";

const SELF = "src/application/runtime/controlled-codex-managed-setup.mjs";
const BRIDGE = "src/adapters/agents/process-tree/codex-managed-setup-bridge.mjs";
const HASH = /^[a-f0-9]{64}$/u, MAX_OUTPUT = 2 * 1024 * 1024;
class ManagedTreeFailure extends Error { constructor(code) { super(code); this.code = code; } }
const ensure = (ok, code) => { if (!ok) throw new ManagedTreeFailure(code); };
const exact = (value, fields) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("|") === [...fields].sort().join("|");
const absolute = value => typeof value === "string" && path.isAbsolute(value) && path.normalize(value) === value && !/[\x00-\x1f]/u.test(value);
const equalPath = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const snapshot = value => { fingerprint(value); return freeze(structuredClone(value)); };
const date = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

async function physical(file, directory) {
  assertAgentLocalPath(file);
  ensure(absolute(file), "MANAGED_TREE_PATH_INVALID");
  for (let cursor = file;;) {
    ensure(!(await fs.lstat(cursor)).isSymbolicLink(), "MANAGED_TREE_PATH_ALIAS");
    const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  const stat = await fs.lstat(file);
  ensure(directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1, "MANAGED_TREE_PATH_INVALID");
  ensure(equalPath(await fs.realpath(file), file), "MANAGED_TREE_PATH_ALIAS");
  return stat;
}
async function hashFile(file, checkpoint) {
  checkpoint(); const before = await physical(file, false);
  ensure(before.size <= 512 * 1024 * 1024, "MANAGED_TREE_FILE_LIMIT");
  const handle = await fs.open(file, "r"), digest = createHash("sha256"), buffer = Buffer.alloc(65536);
  let bytes = 0;
  try {
    const opened = await handle.stat();
    ensure(opened.dev === before.dev && opened.ino === before.ino, "MANAGED_TREE_FILE_CHANGED");
    for (;;) {
      checkpoint(); const read = await handle.read(buffer, 0, buffer.length, null);
      if (!read.bytesRead) break;
      bytes += read.bytesRead; ensure(bytes <= before.size, "MANAGED_TREE_FILE_CHANGED"); digest.update(buffer.subarray(0, read.bytesRead));
    }
    const after = await handle.stat(), final = await physical(file, false);
    ensure(bytes === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs
      && final.dev === before.dev && final.ino === before.ino && final.mtimeMs === before.mtimeMs && final.ctimeMs === before.ctimeMs, "MANAGED_TREE_FILE_CHANGED");
    checkpoint(); return { sha256: digest.digest("hex"), bytes };
  } finally { await handle.close(); }
}
function admissibleToken(value) {
  return value && Number.isSafeInteger(value.pid) && value.pid > 0
    && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}Z$/u.test(value.started_at ?? "")
    && value.elevated === true && value.admin_enabled === true && value.integrity_sid === "S-1-16-12288"
    && [1, 2].includes(value.elevation_type) && value.token_type === 1 && value.has_restrictions === false && value.restricted_sid_count === 0 && value.is_app_container === false;
}

/**
 * Candidate composition only; no registration in a native executor registry.
 * authorizeOperation, preflight and compareEffects are mandatory authority ports,
 * not caller booleans or a structural receipt masquerading as user permission.
 * Their production implementations must verify operator consent, effective
 * configuration, live process tokens and observed effects. Fixture doubles prove
 * only composition. Construction performs no I/O, probe, process or state write.
 *
 * run(envelope,{execute:true,expectRequestSha256,maxDurationMs,signal}) preserves
 * the inner channel result. Only the parent can establish the stopped Job. A
 * stopped tree never erases timeout, protocol failure or unobserved effects.
 */
export function createControlledCodexManagedSetup({ controller, authorizeOperation, preflight, compareEffects, inspectMaterial } = {}) {
  ensure(typeof controller?.run === "function" && typeof controller?.checkAvailability === "function"
    && [authorizeOperation, preflight, compareEffects].every(fn => typeof fn === "function")
    && (inspectMaterial === undefined || typeof inspectMaterial === "function"), "MANAGED_TREE_DEPENDENCIES_REQUIRED");
  let active = false, recoveryRequired = false;
  return async function run(envelope, { execute, expectRequestSha256, maxDurationMs, signal } = {}) {
    assertManagedSetupBridgeRequest(envelope);
    ensure(execute === true && expectRequestSha256 === envelope.request_sha256, "MANAGED_TREE_EXPLICIT_INTENT_REQUIRED");
    ensure(!active && !recoveryRequired, recoveryRequired ? "MANAGED_TREE_RECOVERY_REQUIRED" : "MANAGED_TREE_ALREADY_RUNNING");
    ensure(Number.isSafeInteger(maxDurationMs) && maxDurationMs >= 1000 && maxDurationMs <= 60000
      && (!signal || signal instanceof AbortSignal), "MANAGED_TREE_LIMIT_INVALID");
    const request = freeze(structuredClone(envelope));
    const { request_sha256: requestHash, ...body } = request;
    const names = Object.keys(body.source_inventory), inventoryHash = fingerprint(body.source_inventory);
    ensure([SELF, ...MANAGED_SETUP_BRIDGE_SOURCE_FILES].every(name => HASH.test(body.source_inventory[name] ?? "")), "MANAGED_TREE_INVENTORY_INVALID");
    const began = performance.now(), stop = new AbortController();
    const abort = () => stop.abort(); signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
    let live = true, launched = false, prepared = null, availability = null, processResult = null, bridgeResult = null;
    let effectResult = null, errorCode = null, bytes = 0, finalTimer = null, auxiliaryRecovery = null;
    const chunks = [];
    const checkpoint = () => {
      ensure(live && !stop.signal.aborted, "MANAGED_TREE_CANCELLED");
      ensure(performance.now() - began < maxDurationMs, "MANAGED_TREE_TIMEOUT");
    };
    async function bounded(fn) {
      checkpoint(); let timer, cancel;
      try {
        const value = await Promise.race([Promise.resolve().then(() => { checkpoint(); return fn(); }), new Promise((_, reject) => {
          cancel = () => reject(new ManagedTreeFailure("MANAGED_TREE_CANCELLED"));
          stop.signal.addEventListener("abort", cancel, { once: true });
          timer = setTimeout(() => { reject(new ManagedTreeFailure("MANAGED_TREE_TIMEOUT")); stop.abort(); }, Math.max(1, maxDurationMs - (performance.now() - began)));
        })]);
        checkpoint(); return value;
      } finally { clearTimeout(timer); stop.signal.removeEventListener("abort", cancel); }
    }
    async function material() {
      // The optional read-only material adapter is an explicit integration/test
      // seam. A supplied adapter is trusted, like the process controller; its
      // result is never independently authenticated native evidence.
      if (inspectMaterial) {
        checkpoint(); const seen = await inspectMaterial({ request, signal: stop.signal }); checkpoint(); fingerprint(seen);
        ensure(exact(seen, ["request_sha256", "inventory_sha256", "startup_sha256", "verified"]) && seen.request_sha256 === requestHash
          && seen.inventory_sha256 === inventoryHash && seen.startup_sha256 === fingerprint(body.startup) && seen.verified === true, "MANAGED_TREE_MATERIAL_REFUSED");
        return;
      }
      checkpoint(); await physical(body.candidate_root, true); await physical(body.cwd, true); await physical(body.protocol_config.expected_codex_home, true);
      for (const directory of Object.values(buildManagedSetupStartupPaths(body.startup))) { checkpoint(); await physical(directory, true); }
      for (const pin of [body.node, body.client, body.powershell, ...Object.values(body.sidecars), { executable: body.prerequisites.reference, sha256: body.prerequisites.sha256 }]) {
        ensure((await hashFile(pin.executable, checkpoint)).sha256 === pin.sha256, "MANAGED_TREE_PIN_CHANGED");
      }
      let total = 0; const actual = [];
      async function visit(directory, prefix = "") {
        checkpoint(); const entries = await fs.readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
          checkpoint(); const name = prefix + entry.name, file = path.join(directory, entry.name);
          ensure(!entry.isSymbolicLink(), "MANAGED_TREE_PATH_ALIAS");
          if (entry.isDirectory()) { await physical(file, true); await visit(file, `${name}/`); }
          else {
            ensure(entry.isFile() && actual.length < 20000 && HASH.test(body.source_inventory[name] ?? ""), "MANAGED_TREE_CANDIDATE_CHANGED");
            const record = await hashFile(file, checkpoint); total += record.bytes;
            ensure(total <= 512 * 1024 * 1024 && record.sha256 === body.source_inventory[name], "MANAGED_TREE_CANDIDATE_CHANGED"); actual.push(name);
          }
        }
      }
      await visit(body.candidate_root);
      ensure(actual.sort().join("|") === [...names].sort().join("|"), "MANAGED_TREE_CANDIDATE_CHANGED");
      ensure((await hashFile(import.meta.filename, checkpoint)).sha256 === body.source_inventory[SELF], "MANAGED_TREE_PRODUCER_CHANGED");
    }
    async function authorize(phase) {
      const result = snapshot(await bounded(() => authorizeOperation(Object.freeze({ request, phase, signal: stop.signal }))));
      checkpoint();
      ensure(exact(result, ["status", "request_sha256", "operation_sha256", "approval_sha256", "configuration_sha256", "effects_adequate", "expires_at"])
        && result.status === "AUTHORIZED" && result.request_sha256 === requestHash && result.operation_sha256 === body.operation_sha256
        && result.approval_sha256 === body.approval_sha256 && result.configuration_sha256 === body.configuration_sha256
        && result.effects_adequate === true && date(result.expires_at) && Date.parse(result.expires_at) > Date.now()
        && Date.parse(result.expires_at) - Date.now() <= 300000, "MANAGED_TREE_OPERATION_NOT_AUTHORIZED");
      return Date.parse(result.expires_at);
    }
    async function inspect(phase, runner = null) {
      let result;
      try { result = snapshot(await bounded(() => preflight(Object.freeze({ phase, request, runner, signal: stop.signal })))); }
      catch (error) {
        // A separate preflight Job may already exist even though the setup Job
        // has not been created. Preserve that uncertainty across retries.
        const auxiliary = error?.preflight;
        if (auxiliary?.contract_version === "aidn-managed-setup-parent-preflight-state.v1"
          && auxiliary.request_sha256 === requestHash && auxiliary.phase === phase && auxiliary.recovery_required === true) {
          auxiliaryRecovery = snapshot(auxiliary);
        }
        throw error;
      }
      checkpoint();
      ensure(result?.contract_version === "aidn-managed-setup-preflight.v1" && result.request_sha256 === requestHash
        && result.phase === phase && result.status === "OBSERVED" && date(result.observed_at)
        && Date.parse(result.observed_at) <= Date.now() && Date.now() - Date.parse(result.observed_at) <= 5000
        && Array.isArray(result.errors) && result.errors.length === 0 && result.helpers?.complete === true
        && Array.isArray(result.helpers.rows) && result.helpers.rows.length === 0
        && admissibleToken(result.launcher) && result.launcher.pid === process.pid, "MANAGED_TREE_PREFLIGHT_REFUSED");
      if (runner) ensure(admissibleToken(result.target) && result.target.pid === runner.pid && result.target.started_at === runner.started_at
        && result.target.job_member === true && result.target.job_name === body.job_name, "MANAGED_TREE_TARGET_TOKEN_REFUSED");
      else ensure(result.target === null, "MANAGED_TREE_PREFLIGHT_REFUSED");
    }
    function tree() {
      const runner = processResult?.runner, proof = processResult?.termination_proof;
      const confirmed = launched && prepared && runner && proof?.method === "windows-job-object" && proof.active_processes === 0
        && processResult.termination_state === "confirmed" && runner.runner_id === body.invocation_id && proof.runner_id === body.invocation_id
        && runner.pid === prepared.pid && proof.pid === runner.pid && runner.started_at === prepared.started_at && proof.started_at === runner.started_at
        && runner.job_name === body.job_name && proof.job_name === body.job_name && runner.executable_sha256 === body.node.sha256
        && ["helper_sha256", "source_sha256", "candidate_sha256"].every(key => HASH.test(availability?.[key] ?? "") && runner[key] === availability[key] && proof[key] === availability[key]);
      return { state: !launched ? "not_started" : confirmed ? "confirmed" : "unknown", runner: runner ?? null, proof: proof ?? null };
    }
    active = true;
    try {
      await bounded(material); const createExpiry = await authorize("before_create"); await inspect("before_create");
      availability = snapshot(await bounded(() => controller.checkAvailability(Object.freeze({ cwd: body.cwd, signal: stop.signal, executable: body.node.executable, executableSha256: body.node.sha256 }))));
      ensure(availability?.available === true && availability.candidate_sha256 === inventoryHash, "MANAGED_TREE_CONTROLLER_UNAVAILABLE");
      const stdin = JSON.stringify(request) + "\n";
      ensure(Buffer.byteLength(stdin) <= 262144, "MANAGED_TREE_INPUT_LIMIT");
      checkpoint(); const remaining = Math.floor(maxDurationMs - (performance.now() - began)); ensure(remaining > 1000, "MANAGED_TREE_TIMEOUT");
      ensure(Date.now() < createExpiry, "MANAGED_TREE_OPERATION_NOT_AUTHORIZED");
      launched = true;
      const controlled = Promise.resolve().then(() => { checkpoint(); ensure(Date.now() < createExpiry, "MANAGED_TREE_OPERATION_NOT_AUTHORIZED"); return controller.run(Object.freeze({ runnerId: body.invocation_id, jobName: body.job_name,
        executable: body.node.executable, executableSha256: body.node.sha256,
        args: [path.join(body.candidate_root, BRIDGE), "--execute", "--expect-request", requestHash], cwd: body.cwd, env: body.env, stdin,
        maxDurationMs: remaining, maxOutputBytes: MAX_OUTPUT, maxPendingBytes: MAX_OUTPUT, stopTimeoutMs: 5000 }), {
        signal: stop.signal, onEvent: async event => {
          checkpoint();
          if (event.type === "prepared") {
            ensure(!prepared && event.suspended === true && event.job_assigned === true && event.runner_id === body.invocation_id
              && event.job_name === body.job_name && event.executable_sha256 === body.node.sha256, "MANAGED_TREE_PREPARED_INVALID");
            prepared = snapshot(event);
            await bounded(material); const resumeExpiry = await authorize("before_resume"); await inspect("before_resume", prepared);
            ensure(Date.now() < resumeExpiry, "MANAGED_TREE_OPERATION_NOT_AUTHORIZED");
          } else if (event.type === "stdout") {
            ensure(prepared && Buffer.isBuffer(event.bytes), "MANAGED_TREE_OUTPUT_INVALID"); bytes += event.bytes.length;
            ensure(bytes <= MAX_OUTPUT, "MANAGED_TREE_OUTPUT_LIMIT"); chunks.push(Buffer.from(event.bytes));
          } else if (event.type === "stderr" && event.bytes?.length) ensure(false, "MANAGED_TREE_BRIDGE_DIAGNOSTIC");
          checkpoint();
        },
      }); });
      // Keep observing the controller's rejection after a bounded outer exit.
      const ended = await Promise.race([controlled.then(value => ({ value: snapshot(value) }), () => ({ failed: true })), new Promise(resolve => {
        finalTimer = setTimeout(() => { stop.abort(); resolve({ expired: true }); }, remaining + 6000);
      })]);
      ensure(ended.value, ended.expired ? "MANAGED_TREE_TERMINATION_TIMEOUT" : "MANAGED_TREE_CONTROLLER_FAILED");
      processResult = ended.value;
      ensure(tree().state === "confirmed", "MANAGED_TREE_TERMINATION_UNCONFIRMED");
      ensure(processResult.outcome === "completed" && processResult.exit_code === 0 && processResult.reason_code === "PROCESS_EXITED", "MANAGED_TREE_EXECUTION_NOT_COMPLETED");
      let parsed;
      try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes))); } catch { ensure(false, "MANAGED_TREE_ENVELOPE_INVALID"); }
      ensure(parsed?.protocol === body.protocol && parsed.invocation_id === body.invocation_id && parsed.request_sha256 === requestHash
        && parsed.operation_sha256 === body.operation_sha256 && parsed.ok === true, "MANAGED_TREE_ENVELOPE_INVALID");
      bridgeResult = snapshot(parsed);
      // A channel inside this Job cannot confirm termination of its own bridge.
      // The concrete envelope result is validated by the bridge contract below;
      // no inner timeout/stop/protocol error may be promoted by the outer Job.
      const channel = bridgeResult.result?.channel, direct = bridgeResult.result?.transport, inside = bridgeResult.result?.preflight;
      ensure(channel?.protocol?.phase === "completion_observed" && channel.reported_setup_result === "succeeded"
        && channel.reason_code === null && channel.stop_reason_code === null && channel.stdout_eof === true
        && inside?.target?.pid === prepared.pid && inside.target.started_at === prepared.started_at
        && inside.target.job_name === body.job_name && inside.target.job_member === true
        && direct?.closed === true && direct.forced === false && direct.stdout_ended === true
        && direct.exit_code === 0 && direct.signal === null && direct.reason_code === null, "MANAGED_TREE_BRIDGE_NOT_COMPLETED");
      effectResult = snapshot(await bounded(() => compareEffects(Object.freeze({ request, bridge: bridgeResult, process: processResult, signal: stop.signal }))));
      ensure(exact(effectResult, ["status", "operation_sha256", "comparison_sha256", "observed_at"])
        && effectResult.status === "MATCHED" && effectResult.operation_sha256 === body.operation_sha256 && HASH.test(effectResult.comparison_sha256)
        && date(effectResult.observed_at) && Date.parse(effectResult.observed_at) <= Date.now() && Date.now() - Date.parse(effectResult.observed_at) <= 5000,
      "MANAGED_TREE_EFFECTS_UNCONFIRMED");
    } catch (error) {
      errorCode = error instanceof ManagedTreeFailure ? error.code : "MANAGED_TREE_OPERATION_FAILED";
      stop.abort();
    } finally { live = false; clearTimeout(finalTimer); stop.abort(); signal?.removeEventListener("abort", abort); active = false; }
    const termination = tree();
    if (!errorCode && termination.state !== "confirmed") errorCode = "MANAGED_TREE_TERMINATION_UNCONFIRMED";
    recoveryRequired ||= auxiliaryRecovery?.recovery_required === true || launched && (Boolean(errorCode) || termination.state !== "confirmed");
    return freeze({ contract_version: "aidn-controlled-managed-setup-result.v1", request_sha256: requestHash,
      operation_sha256: body.operation_sha256, outcome: errorCode ? launched || recoveryRequired ? "indeterminate" : "refused" : "completed",
      reason_code: errorCode, bridge: bridgeResult, process: processResult, tree_termination: termination, effects: effectResult,
      recovery_required: recoveryRequired, ...(auxiliaryRecovery ? { preflight_recovery: auxiliaryRecovery } : {}), authorization_evidence: "EXTERNAL_AUTHORITY_PORT", native_qualified: false, execution_registered: false });
  };
}
