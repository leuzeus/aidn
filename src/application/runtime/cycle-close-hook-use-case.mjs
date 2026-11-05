import path from "node:path";
import { runCheckpointUseCase } from "./checkpoint-use-case.mjs";
import { runCycleCloseAdmitUseCase } from "./cycle-close-admit-use-case.mjs";

// Shared production hook; only the owning application host supplies a live
// completion reader. CLI arguments never carry this capability.
export function defaultCycleCloseHookArguments(runtimeDir) {
  const envStore = String(process.env.AIDN_INDEX_STORE_MODE ?? "").trim().toLowerCase();
  const envStateMode = String(process.env.AIDN_STATE_MODE ?? "").trim().toLowerCase();
  return {
    target: ".",
    cache: ".aidn/runtime/cache/reload-state.json",
    eventFile: ".aidn/runtime/perf/workflow-events.ndjson",
    indexOutput: ".aidn/runtime/index/workflow-index.json",
    indexStore: envStore || "",
    indexStoreExplicit: false,
    stateMode: envStateMode || "files",
    indexSqlOutput: ".aidn/runtime/index/workflow-index.sql",
    indexSqliteOutput: ".aidn/runtime/index/workflow-index.sqlite",
    indexSchemaFile: path.join(runtimeDir, "sql", "schema.sql"),
    indexIncludeSchema: true,
    indexKpiFile: "",
    indexSyncCheck: false,
    indexSyncCheckStrict: false,
    indexSyncCheckOut: ".aidn/runtime/index/index-sync-check.json",
    mode: "COMMITTING",
    runId: "",
    json: false,
    emitSummaryEvent: true,
    skipIndexOnIncremental: true,
    skipGateEvaluate: false,
    autoSkipGateOnNoSignal: true,
  };
}

function buildSummary(result) {
  const checkpointSummary = result.checkpoint?.summary ?? {};
  return {
    result: result.result,
    reason_code: result.reason_code ?? null,
    action: result.action,
    admitted: result.admission?.ok === true,
    checkpoint_ran: result.checkpoint != null,
    checkpoint_result: checkpointSummary.result ?? null,
    repair_layer_open_count: Number(checkpointSummary.repair_layer_open_count ?? 0),
    repair_layer_blocking: checkpointSummary.repair_layer_blocking === true,
    repair_layer_status: checkpointSummary.repair_layer_status ?? "clean",
    repair_layer_advice: checkpointSummary.repair_layer_advice ?? "Repair layer is clean.",
    repair_primary_reason: checkpointSummary.repair_primary_reason ?? checkpointSummary.repair_layer_advice ?? "Repair layer is clean.",
    repair_layer_top_findings: Array.isArray(checkpointSummary.repair_layer_top_findings)
      ? checkpointSummary.repair_layer_top_findings
      : [],
  };
}

export async function runCycleCloseHookUseCase({ args, runtimeDir, targetRoot, readObjectiveCompletion = null, assertEffectAuthorized = null }) {
  const admission = await runCycleCloseAdmitUseCase({
    targetRoot,
    mode: args.mode,
  });
  const checkpoint = admission.action === "cycle_close_allowed"
    ? await runCheckpointUseCase({
      args,
      runtimeDir,
      readObjectiveCompletion,
      assertEffectAuthorized,
      targetRoot,
      completionCycleId: ["DONE", "NO_GO", "DROPPED"].includes(admission.target_cycle?.state)
        ? admission.target_cycle.cycle_id : null,
    })
    : null;
  const effective = admission.ok === true && checkpoint ? checkpoint.gate : admission;
  const result = {
    ts: new Date().toISOString(),
    ok: admission.ok === true && effective.result === "ok" && (checkpoint ? checkpoint.ok === true : true),
    skill: "cycle-close",
    target_root: targetRoot,
    mode: args.mode,
    state_mode: checkpoint?.state_mode ?? args.stateMode,
    action: effective.result === "ok" ? admission.action : effective.action,
    result: effective.result,
    reason_code: effective.reason_code,
    blocking_reasons: admission.ok !== true ? admission.blocking_reasons
      : effective.result === "ok" ? [] : checkpoint.reload.reason_codes,
    recommended_next_action: effective.result === "ok" ? admission.recommended_next_action
      : admission.ok !== true ? admission.recommended_next_action : "Resolve the checkpoint refusal before continuing closure or integrating the branch.",
    branch: admission.branch,
    branch_kind: admission.branch_kind,
    admission,
    checkpoint,
    summary: null,
  };
  result.summary = buildSummary(result);
  return result;
}
