import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createWindowsProcessTreeController } from "../../adapters/agents/process-tree/windows-process-tree-controller.mjs";
import { processFail as fail } from "../../core/workflow/agentic-process-model.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { createProjectAgenticProcessExecution } from "./agentic-process-execution-composition.mjs";
import { createAgenticProcessWorkerEnvironment } from "./agentic-process-persistence.mjs";

const worker = fileURLToPath(new URL("../../adapters/agents/agentic-process-worker.mjs", import.meta.url));
const sha = data => createHash("sha256").update(data).digest("hex");
const hashFile = file => sha(fs.readFileSync(file));
const validHash = value => /^[a-f0-9]{64}$/.test(value ?? "");

// Only this entry owns the complete worker + native-client descendant tree.
// A controller double is a test seam, never selectable through configuration.
export async function runOwnedAgenticProcess({ configuration, authorization, execute = false, signal }, { controllerFactory = createWindowsProcessTreeController, environment = process.env } = {}) {
  const allocatedAt = Date.now(), allocatedMono = performance.now();
  const preview = createProjectAgenticProcessExecution(configuration, { environment }).preview();
  if (!execute) return preview;
  if (authorization?.approved !== true || authorization.model_allowed !== true || authorization.configuration_sha256 !== shadowHash(configuration)
    || !Number.isSafeInteger(authorization.authorized_at_ms) || authorization.authorized_at_ms > allocatedAt
    || !Number.isSafeInteger(authorization.global_deadline_ms) || authorization.global_deadline_ms <= allocatedAt
    || authorization.global_deadline_ms - authorization.authorized_at_ms > 10800000
    || !Number.isSafeInteger(authorization.workflow_deadline_ms) || authorization.workflow_deadline_ms > authorization.global_deadline_ms
    || authorization.workflow_deadline_ms <= allocatedAt || !Number.isSafeInteger(authorization.max_turn_ms)
    || authorization.max_turn_ms < 1 || authorization.max_turn_ms > 2700000
    || !Number.isSafeInteger(authorization.max_responses) || authorization.max_responses < 1 || authorization.max_responses > 120
    || !Number.isSafeInteger(authorization.max_bytes) || authorization.max_bytes < 1048576 || authorization.max_bytes > 471859200)
    fail("PROCESS_EXECUTION_EXPLICIT_AUTHORIZATION_REQUIRED");
  const pins = configuration.controller;
  if (!pins || !validHash(pins.worker_sha256) || hashFile(worker) !== pins.worker_sha256
    || !validHash(pins.node_sha256) || hashFile(process.execPath) !== pins.node_sha256) fail("PROCESS_EXECUTION_CONTROLLER_PIN_INVALID");
  const controller = controllerFactory({ helperPath: pins.helper_path, helperSha256: pins.helper_sha256,
    helperSourceSha256: pins.helper_source_sha256, candidateSha256: pins.worker_sha256 });
  const cwd = configuration.control_root;
  const availability = await controller.checkAvailability({ cwd, executable: process.execPath, executableSha256: pins.node_sha256, signal });
  if (!availability.available) fail("PROCESS_EXECUTION_TREE_CONTROL_UNAVAILABLE");
  const remaining = Math.floor(authorization.global_deadline_ms - allocatedAt - (performance.now() - allocatedMono));
  if (remaining <= 30000) fail("PROCESS_EXECUTION_CLOSURE_RESERVE");
  let stdout = Buffer.alloc(0), firstFailure = null;
  const workerEnvironment = createAgenticProcessWorkerEnvironment({ targetRoot: configuration.target_root,
    expectedBinding: preview.persistence.binding_sha256, env: environment });
  const proof = await controller.run({ runnerId: `agentic-${randomUUID()}`, executable: process.execPath, executableSha256: pins.node_sha256,
    args: [worker], cwd, env: { ...workerEnvironment, TEMP: cwd, TMP: cwd },
    stdin: JSON.stringify({ configuration, authorization, persistenceBinding: preview.persistence.binding_sha256 }), maxDurationMs: remaining - 10000, maxOutputBytes: 131072,
    maxPendingBytes: 131072, stopTimeoutMs: 3000 }, { signal, onEvent(event) {
      if (event.type === "prepared") {
        if (Date.now() >= authorization.global_deadline_ms - 20000 || hashFile(worker) !== pins.worker_sha256) fail("PROCESS_EXECUTION_PREPARED_BINDING_CHANGED");
      } else if (event.type === "stdout") {
        if (stdout.length + event.bytes.length > 65536) { firstFailure ??= "PROCESS_EXECUTION_WORKER_OUTPUT_LIMIT"; fail(firstFailure); }
        stdout = Buffer.concat([stdout, event.bytes]);
      }
    } });
  let result = null;
  try { result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stdout)); }
  catch { firstFailure ??= "PROCESS_EXECUTION_WORKER_SUMMARY_MISSING"; }
  if (result?.contract_version !== "agentic-process-execution-result.v1" || result?.global_deadline_ms !== authorization.global_deadline_ms)
    firstFailure ??= "PROCESS_EXECUTION_WORKER_SUMMARY_INVALID";
  if (proof.termination_state !== "confirmed" || proof.termination_proof?.active_processes !== 0) firstFailure ??= "PROCESS_EXECUTION_TREE_CLOSE_UNCONFIRMED";
  if (proof.outcome !== "completed") firstFailure ??= proof.reason_code;
  if (Date.now() >= authorization.global_deadline_ms) firstFailure ??= "PROCESS_EXECUTION_GLOBAL_DEADLINE";
  const final = { contract_version: "agentic-process-owned-result.v1", status: firstFailure || result?.first_failure ? "FAILED" : result.status,
    first_failure: result?.first_failure ?? firstFailure, worker_result: result, process_tree: proof,
    global_deadline_ms: authorization.global_deadline_ms, authorized_at_ms: authorization.authorized_at_ms,
    elapsed_global_ms: Date.now() - authorization.authorized_at_ms, retry: false };
  const file = path.join(cwd, `${configuration.instance_id}-CLOSURE.json`);
  const footer = Buffer.from(JSON.stringify(final) + "\n"), workerFooter = path.join(cwd, configuration.instance_id, "RESULT.json");
  const used = result?.storage_budget_debit_bytes ?? result?.bytes_retained;
  if (["STDOUT_ONLY_STORAGE_LIMIT", "STDOUT_ONLY_STORAGE_UNVERIFIABLE", "STDOUT_ONLY_WRITE_FAILED"].includes(result?.seal)) {
    final.first_failure ??= "PROCESS_EXECUTION_SEAL_STORAGE_LIMIT"; final.status = "FAILED"; final.seal = result.seal;
  } else {
    let workerFooterBytes = null;
    try { if (Number.isSafeInteger(used) && used >= 0) workerFooterBytes = fs.existsSync(workerFooter) ? fs.statSync(workerFooter).size : 0; }
    catch { /* Unknown storage must retain the structured result without another write. */ }
    if (workerFooterBytes === null) {
      final.first_failure ??= "PROCESS_EXECUTION_STORAGE_UNVERIFIABLE"; final.status = "FAILED"; final.seal = "STDOUT_ONLY_STORAGE_UNVERIFIABLE";
    } else if (used + workerFooterBytes + footer.length > authorization.max_bytes) {
      final.first_failure ??= "PROCESS_EXECUTION_SEAL_STORAGE_LIMIT"; final.status = "FAILED"; final.seal = "STDOUT_ONLY_STORAGE_LIMIT";
    } else try { fs.writeFileSync(file, footer, { flag: "wx" }); }
    catch { final.first_failure ??= "PROCESS_EXECUTION_SEAL_WRITE_FAILED"; final.status = "FAILED"; final.seal = "STDOUT_ONLY_WRITE_FAILED"; }
  }
  return final;
}
