import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fingerprintAgentExecutionValue as H } from "../../src/core/agents/agent-execution-contracts.mjs";
import { observeCodexValidationStartupFailure } from "../../src/adapters/runtime/codex-validation-startup-failure.mjs";

export async function verifyCodexValidationStartupRecovery({ check, fixture }) {
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  function subject() {
    const { config: configuration } = fixture(), request = "a".repeat(64), invocation = "case.recovery";
    const operation_id = H({ invocation_id: invocation, request_sha256: request }), configuration_sha256 = H(configuration);
    const intent = { operation_id, invocation_id: invocation, request_sha256: request, configuration_sha256, launch_sha256: "b".repeat(64), parent_job_name: "fixture-job" };
    const runner = { runner_id: invocation, job_name: intent.parent_job_name, pid: 42, started_at: "2026-01-01T00:00:00.000Z",
      executable_sha256: configuration.client.sha256, helper_sha256: configuration.controller.helperSha256,
      source_sha256: configuration.controller.helperSourceSha256, candidate_sha256: configuration.controller.candidateSha256 };
    const controller = { outcome: "failed", reason_code: "PROCESS_FAILED", exit_code: 1, signal: null, termination_state: "confirmed",
      bytes: { stdout: 0, stderr: 60 }, hashes: { stdout_sha256: hash(""), stderr_sha256: hash("windows sandbox failed: CreateProcessWithLogonW failed: 267\n") }, runner,
      termination_proof: { ...runner, method: "windows-job-object", active_processes: 0, observed_at: "2026-01-01T00:00:01.000Z" } };
    const terminal = { operation_id, configuration_sha256, intent_sha256: H(intent), invocation_id: invocation, request_sha256: request,
      controller, membership: null, child: null, termination_state: "unknown" };
    return { configuration, operation: { operation_id, invocation_id: invocation, configuration_sha256, request_sha256: request, intent_sha256: H(intent), intent, terminal } };
  }
  await check("reviewed logon failure derives non-start evidence only", () => {
    const value = subject(), result = observeCodexValidationStartupFailure(value);
    assert.equal(result.sandbox_command_status, "not_started"); assert.equal(result.canonical_effect_reconciled, false);
    assert.equal(value.operation.terminal.termination_state, "unknown");
  });
  const mutations = {
    "unknown binary": x => { x.configuration.client.sha256 = "c".repeat(64); },
    "different error": x => { x.operation.terminal.controller.hashes.stderr_sha256 = "c".repeat(64); },
    "truncated error": x => { x.operation.terminal.controller.bytes.stderr--; },
    "child output": x => { x.operation.terminal.controller.bytes.stdout = 1; },
    "observed child": x => { x.operation.terminal.child = {}; },
    "observed membership": x => { x.operation.terminal.membership = {}; },
    "unclosed job": x => { x.operation.terminal.controller.termination_proof.active_processes = 1; },
    "wrong job": x => { x.operation.terminal.controller.termination_proof.job_name = "other"; },
    "wrong incarnation": x => { x.operation.terminal.controller.termination_proof.started_at = "2025-01-01T00:00:00.000Z"; },
    "wrong helper": x => { x.operation.terminal.controller.runner.helper_sha256 = "c".repeat(64); },
    "wrong request": x => { x.operation.request_sha256 = "c".repeat(64); },
    "wrong terminal": x => { x.operation.terminal.operation_id = "c".repeat(64); },
  };
  await check("startup recovery refuses twelve contradictory witnesses", () => {
    for (const [name, mutate] of Object.entries(mutations)) { const value = subject(); mutate(value); assert.equal(observeCodexValidationStartupFailure(value), null, name); }
  });
}
