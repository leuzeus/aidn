import { createHash } from "node:crypto";
import { fingerprintAgentExecutionValue as fingerprint } from "../../core/agents/agent-execution-contracts.mjs";
import { getCodexSandboxValidationLaunchSupport } from "./codex-sandbox-validation-boundary.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const emptyHash = hash(Buffer.alloc(0));
const logon267 = Buffer.from("windows sandbox failed: CreateProcessWithLogonW failed: 267\n");
const logon267Hash = hash(logon267);
const sourceCommit = "0d9c7cbfa6cf1489f55a8a9542b75ddd2c061807";

// Derived evidence only. The caller must authenticate the operation, the exact
// original request/launch, pinned binary material and journal references. This
// observer does not retire an owner, append a result, or authorize another run.
// The reviewed debug_sandbox.rs prints this error before forwarding a session;
// runner_client.rs returns it when CreateProcessWithLogonW fails, before sending
// the command. Trampoline/check output cannot replace these startup observations.
export function observeCodexValidationStartupFailure({ configuration, operation }) {
  if (!configuration?.client || !configuration?.controller || !operation?.intent || !operation?.terminal
    || configuration.platform !== "win32" || !/^[a-f0-9]{64}$/.test(operation.request_sha256 ?? "")
    || !/^[a-f0-9]{64}$/.test(operation.intent.launch_sha256 ?? "")) return null;
  const support = getCodexSandboxValidationLaunchSupport(configuration);
  if (!support.available) return null;
  const reviewed = support.reviewed_client;
  const terminal = operation?.terminal, controller = terminal?.controller;
  const runner = controller?.runner, proof = controller?.termination_proof;
  if (!reviewed || reviewed.source_commit !== sourceCommit || !terminal || !controller || !runner || !proof
    || operation.configuration_sha256 !== fingerprint(configuration) || operation.intent.configuration_sha256 !== operation.configuration_sha256
    || terminal.configuration_sha256 !== operation.configuration_sha256 || operation.intent_sha256 !== fingerprint(operation.intent)
    || terminal.intent_sha256 !== operation.intent_sha256 || operation.intent.operation_id !== operation.operation_id
    || terminal.operation_id !== operation.operation_id || operation.operation_id !== fingerprint({ invocation_id: operation.invocation_id, request_sha256: operation.request_sha256 })
    || operation.intent.invocation_id !== operation.invocation_id || terminal.invocation_id !== operation.invocation_id
    || operation.intent.request_sha256 !== operation.request_sha256 || terminal.request_sha256 !== operation.request_sha256
    || terminal.membership !== null || terminal.child !== null || terminal.termination_state !== "unknown"
    || controller.outcome !== "failed" || controller.reason_code !== "PROCESS_FAILED" || controller.exit_code !== 1 || controller.signal !== null
    || controller.bytes?.stdout !== 0 || controller.hashes?.stdout_sha256 !== emptyHash
    || controller.bytes?.stderr !== logon267.length || controller.hashes?.stderr_sha256 !== logon267Hash
    || controller.termination_state !== "confirmed" || proof.method !== "windows-job-object" || proof.active_processes !== 0
    || runner.runner_id !== operation.invocation_id || proof.runner_id !== operation.invocation_id
    || runner.job_name !== operation.intent?.parent_job_name || proof.job_name !== runner.job_name
    || !Number.isSafeInteger(runner.pid) || runner.pid <= 0 || proof.pid !== runner.pid || proof.started_at !== runner.started_at
    || !Number.isFinite(Date.parse(proof.observed_at)) || !Number.isFinite(Date.parse(runner.started_at))
    || Date.parse(proof.observed_at) < Date.parse(runner.started_at)
    || runner.executable_sha256 !== configuration.client.sha256 || proof.helper_sha256 !== configuration.controller.helperSha256
    || runner.helper_sha256 !== proof.helper_sha256 || proof.source_sha256 !== configuration.controller.helperSourceSha256
    || runner.source_sha256 !== proof.source_sha256 || proof.candidate_sha256 !== configuration.controller.candidateSha256
    || runner.candidate_sha256 !== proof.candidate_sha256) return null;
  return {
    contract_version: "codex-validation-startup-failure.v1",
    operation_id: operation.operation_id,
    configuration_sha256: fingerprint(configuration),
    intent_sha256: fingerprint(operation.intent),
    terminal_sha256: fingerprint(terminal),
    request_sha256: operation.request_sha256,
    launch_sha256: operation.intent.launch_sha256,
    reviewed_client_sha256: reviewed.executable_sha256,
    reviewed_source_commit: sourceCommit,
    stderr_sha256: logon267Hash,
    sandbox_command_status: "not_started",
    outer_job_status: "closed",
    canonical_effect_reconciled: false,
  };
}
