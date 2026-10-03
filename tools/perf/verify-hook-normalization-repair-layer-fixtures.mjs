#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { normalizeHookPayload } from "../../src/application/codex/normalize-hook-payload.mjs";
import {
  buildRunJsonHookSummary,
  buildGatingSummary,
  buildCheckpointSummary,
  buildWorkflowHookSummary,
} from "../../src/core/workflow/workflow-output-factory.mjs";
import { deriveGatingAction } from "../../src/core/gating/gating-policy.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/perf-structure/session-rich",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-hook-normalization-repair-layer-fixtures.mjs");
}

function runJson(script, scriptArgs, env = {}) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
    },
  });
  return JSON.parse(stdout);
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const sourceTarget = path.resolve(process.cwd(), args.target);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-hook-normalize-repair-"));
    const target = path.join(tempRoot, "repo");
    fs.cpSync(sourceTarget, target, { recursive: true });
    fs.rmSync(path.join(target, ".aidn"), { recursive: true, force: true });

    runJson("tools/perf/index-sync.mjs", [
      "--target",
      target,
      "--store",
      "sqlite",
      "--json",
    ]);

    const env = {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    };
    fs.appendFileSync(
      path.join(target, "docs", "audit", "baseline", "current.md"),
      "\n<!-- normalize-repair-layer-signal -->\n",
      "utf8",
    );

    const checkpoint = runJson("tools/perf/checkpoint.mjs", [
      "--target",
      target,
      "--mode",
      "COMMITTING",
      "--index-store",
      "sqlite",
      "--no-auto-skip-gate",
      "--json",
    ], env);
    const workflowHook = runJson("tools/perf/workflow-hook.mjs", [
      "--phase",
      "session-close",
      "--target",
      target,
      "--mode",
      "COMMITTING",
      "--index-store",
      "sqlite",
      "--no-auto-skip-gate",
      "--json",
    ], env);

    const normalizedCheckpoint = normalizeHookPayload(checkpoint, {
      skill: "checkpoint",
      mode: "COMMITTING",
      stateMode: "db-only",
      strictRequested: true,
      targetRoot: target,
    });
    const normalizedWorkflowHook = normalizeHookPayload(workflowHook, {
      skill: "close-session",
      mode: "COMMITTING",
      stateMode: "db-only",
      strictRequested: true,
      targetRoot: target,
    });

    const hookSummary = buildRunJsonHookSummary({
      result: normalizedWorkflowHook.result,
      error: normalizedWorkflowHook.error,
      state_mode: normalizedWorkflowHook.state_mode,
      command_status: 0,
      db_sync: { enabled: false, error: null },
      normalized: normalizedWorkflowHook,
    });

    const warning = deriveGatingAction({
      level2: { required: true },
      level3: { required: false },
    });
    const refusal = deriveGatingAction({
      level2: { required: false },
      level3: { required: true, reason: "blocking_l1_reason" },
    });
    const warningSummary = buildRunJsonHookSummary({ ...warning, normalized: warning });
    const refusalSummary = buildRunJsonHookSummary({
      ...refusal,
      error: { message: "A business refusal is not a command execution failure." },
      normalized: refusal,
    });
    const normalizedOnlySummary = buildRunJsonHookSummary({
      result: warning.result,
      reason_code: null,
      normalized: warning,
    });
    const commandFailureSummary = buildRunJsonHookSummary({
      error: { message: "Fixture command failed." },
      reason_code: warning.reason_code,
      normalized: refusal,
    });
    const rootReasonSummary = buildRunJsonHookSummary({ ...warning, normalized: refusal });
    const noReasonSummary = buildRunJsonHookSummary({ result: "ok", normalized: { reason_code: null } });
    const unobservedRepairSummary = buildRunJsonHookSummary({
      result: "ok",
      normalized: { repair_layer_open_count: 0, repair_layer_blocking: false, repair_layer_status: null },
    });
    const explicitRepair = {
      repair_layer_open_count: 0,
      repair_layer_blocking: false,
      repair_layer_status: "warn",
      repair_layer_advice: "Review the producer's diagnostic.",
      repair_primary_reason: "Producer diagnostic retained.",
    };
    const explicitRepairSummary = buildRunJsonHookSummary({ result: "warn", normalized: explicitRepair });
    const explicitUnknownRepair = { ...explicitRepair, repair_layer_status: null };
    const explicitUnknownSummary = buildRunJsonHookSummary({ result: "warn", normalized: explicitUnknownRepair });
    const absentCheckpoint = buildCheckpointSummary({});
    const failedWorkflow = buildWorkflowHookSummary({ result: "stop", reason_code: "HOOK_CHECKPOINT_FAILED" });
    const unknownCheckpointWorkflow = buildWorkflowHookSummary({ checkpoint: { summary: {
      repair_layer_open_count: 0, repair_layer_blocking: false, repair_layer_status: null,
    } } });
    const partialCheckpoint = buildCheckpointSummary({ gate: { levels: {
      level2: { repair_layer_open_count: 0 },
    } } });
    const malformedCheckpoint = buildCheckpointSummary({ gate: { levels: {
      level2: { repair_layer_open_count: false }, level3: { repair_layer_blocking: false },
    } } });
    const observedCleanCheckpoint = buildCheckpointSummary({ gate: { levels: {
      level2: { repair_layer_open_count: 0 }, level3: { repair_layer_blocking: false },
    } } });
    const explicitUnknownWorkflow = buildWorkflowHookSummary({ checkpoint: { summary: explicitUnknownRepair } });
    const normalizedFailedWorkflow = normalizeHookPayload(failedWorkflow);
    const normalizedUnknownCheckpoint = normalizeHookPayload({ summary: absentCheckpoint });
    const compatibleEmptyLevels = {
      level2: { repair_layer_open_count: 0, repair_layer_top_findings: [] },
      level3: { repair_layer_blocking: false },
    };
    const unavailableGateSummary = buildGatingSummary({ levels: compatibleEmptyLevels }, { repairLayerObserved: false });
    const emptyObservedGateSummary = buildGatingSummary({ levels: compatibleEmptyLevels }, { repairLayerObserved: true });
    const unavailableGateCheckpoint = buildCheckpointSummary({ gate: {
      levels: compatibleEmptyLevels, summary: unavailableGateSummary,
    } });
    const unavailableGateNormalized = normalizeHookPayload({ levels: compatibleEmptyLevels, summary: unavailableGateSummary });
    const noRepairDiagnostic = (summary) => summary.repair_layer_status === null
      && summary.repair_layer_advice === null && summary.repair_primary_reason === null;

    const checks = {
      checkpoint_open_count_present: Number(normalizedCheckpoint.repair_layer_open_count ?? 0) >= 1,
      checkpoint_top_findings_present: Array.isArray(normalizedCheckpoint.repair_layer_top_findings)
        && normalizedCheckpoint.repair_layer_top_findings.length >= 1,
      workflow_hook_open_count_present: Number(normalizedWorkflowHook.repair_layer_open_count ?? 0) >= 1,
      workflow_hook_top_findings_present: Array.isArray(normalizedWorkflowHook.repair_layer_top_findings)
        && normalizedWorkflowHook.repair_layer_top_findings.length >= 1,
      hook_summary_open_count_present: Number(hookSummary.repair_layer_open_count ?? 0) >= 1,
      hook_summary_top_findings_present: Array.isArray(hookSummary.repair_layer_top_findings)
        && hookSummary.repair_layer_top_findings.length >= 1,
      hook_summary_reason_matches_normalized: hookSummary.reason_code === normalizedWorkflowHook.reason_code,
      warning_reason_preserved: warningSummary.reason_code === "L2_SIGNAL_TRIGGERED",
      refusal_reason_preserved_despite_business_error: refusalSummary.reason_code === "L3_BLOCKING",
      normalized_reason_fallback_preserved: normalizedOnlySummary.reason_code === "L2_SIGNAL_TRIGGERED",
      command_failure_reason_takes_precedence: commandFailureSummary.reason_code === "HOOK_COMMAND_FAILED",
      root_reason_takes_precedence: rootReasonSummary.reason_code === "L2_SIGNAL_TRIGGERED",
      absent_reason_remains_null: noReasonSummary.reason_code === null,
      unobserved_repair_status_remains_null: unobservedRepairSummary.repair_layer_status === null,
      unobserved_repair_advice_remains_null: unobservedRepairSummary.repair_layer_advice === null,
      unobserved_repair_primary_reason_remains_null: unobservedRepairSummary.repair_primary_reason === null,
      explicit_repair_status_preserved: explicitRepairSummary.repair_layer_status === explicitRepair.repair_layer_status,
      explicit_repair_advice_preserved: explicitRepairSummary.repair_layer_advice === explicitRepair.repair_layer_advice,
      explicit_repair_primary_reason_preserved: explicitRepairSummary.repair_primary_reason === explicitRepair.repair_primary_reason,
      observed_repair_status_matches_normalized: hookSummary.repair_layer_status === normalizedWorkflowHook.repair_layer_status,
      explicit_unknown_summary_keeps_advice: explicitUnknownSummary.repair_layer_advice === explicitUnknownRepair.repair_layer_advice,
      explicit_unknown_summary_keeps_primary_reason: explicitUnknownSummary.repair_primary_reason === explicitUnknownRepair.repair_primary_reason,
      absent_checkpoint_cannot_claim_clean: noRepairDiagnostic(absentCheckpoint),
      failed_workflow_cannot_claim_clean: noRepairDiagnostic(failedWorkflow),
      failed_workflow_preserves_refusal: failedWorkflow.result === "stop" && failedWorkflow.reason_code === "HOOK_CHECKPOINT_FAILED",
      unknown_checkpoint_workflow_cannot_claim_clean: noRepairDiagnostic(unknownCheckpointWorkflow),
      partial_checkpoint_cannot_claim_clean: noRepairDiagnostic(partialCheckpoint),
      malformed_checkpoint_cannot_claim_clean: noRepairDiagnostic(malformedCheckpoint),
      observed_checkpoint_keeps_clean: observedCleanCheckpoint.repair_layer_status === "clean",
      explicit_unknown_workflow_keeps_diagnostics: explicitUnknownWorkflow.repair_layer_status === null
        && explicitUnknownWorkflow.repair_layer_advice === explicitUnknownRepair.repair_layer_advice
        && explicitUnknownWorkflow.repair_primary_reason === explicitUnknownRepair.repair_primary_reason,
      normalization_does_not_upgrade_unknown_workflow: noRepairDiagnostic(normalizedFailedWorkflow),
      normalization_does_not_upgrade_unknown_checkpoint: noRepairDiagnostic(normalizedUnknownCheckpoint),
      unobserved_gate_cannot_claim_clean: noRepairDiagnostic(unavailableGateSummary),
      observed_empty_gate_keeps_clean: emptyObservedGateSummary.repair_layer_status === "clean",
      checkpoint_preserves_unobserved_gate: noRepairDiagnostic(unavailableGateCheckpoint),
      normalization_preserves_unobserved_gate: noRepairDiagnostic(unavailableGateNormalized),
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      target_root: target,
      checks,
      samples: {
        checkpoint_open_count: normalizedCheckpoint.repair_layer_open_count ?? null,
        workflow_hook_open_count: normalizedWorkflowHook.repair_layer_open_count ?? null,
        hook_summary_open_count: hookSummary.repair_layer_open_count ?? null,
        workflow_hook_reason_code: normalizedWorkflowHook.reason_code,
        hook_summary_reason_code: hookSummary.reason_code,
        warning_reason_code: warningSummary.reason_code,
        refusal_reason_code: refusalSummary.reason_code,
        unobserved_repair_status: unobservedRepairSummary.repair_layer_status,
        explicit_repair_status: explicitRepairSummary.repair_layer_status,
      },
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${sourceTarget}`);
      for (const [name, value] of Object.entries(checks)) {
        console.log(`${value ? "PASS" : "FAIL"} ${name}`);
      }
      console.log(`Result: ${pass ? "PASS" : "FAIL"}`);
    }

    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      const cleanup = removePathWithRetry(tempRoot);
      if (!cleanup.ok) {
        throw cleanup.error;
      }
    }
  }
}

main();
