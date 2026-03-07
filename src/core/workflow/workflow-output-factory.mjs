export function isWorkflowResultOk(result) {
  return result === "ok";
}

export function buildGatingSummary(result) {
  return {
    action: result.action,
    result: result.result,
    reason_code: result.reason_code,
    gates_triggered_count: Array.isArray(result.gates_triggered) ? result.gates_triggered.length : 0,
    level2_required: result.levels?.level2?.required === true,
    level3_required: result.levels?.level3?.required === true,
  };
}

export function buildCheckpointSummary(result) {
  const gateLevels = result.gate?.levels ?? {};
  const level2 = gateLevels.level2 ?? {};
  const level3 = gateLevels.level3 ?? {};
  return {
    result: result.gate?.result === "stop" ? "stop" : "ok",
    reason_code: result.index_sync_check?.enabled && result.index_sync_check.in_sync === false
      ? "INDEX_SYNC_DRIFT"
      : (result.gate?.reason_code ?? null),
    reload_decision: result.reload?.decision ?? null,
    gate_action: result.gate?.action ?? null,
    index_skipped: result.index?.skipped === true,
    index_sync_check_enabled: result.index_sync_check?.enabled === true,
    index_sync_in_sync: result.index_sync_check?.in_sync ?? null,
    repair_layer_open_count: Number(level2.repair_layer_open_count ?? 0),
    repair_layer_blocking: level3.repair_layer_blocking === true,
    repair_layer_top_findings: Array.isArray(level2.repair_layer_top_findings)
      ? level2.repair_layer_top_findings
      : [],
  };
}

export function buildWorkflowHookSummary(result) {
  const checkpointSummary = result.checkpoint?.summary ?? {};
  return {
    result: result.result,
    reason_code: result.reason_code,
    phase: result.phase,
    checkpoint_ok: Boolean(result.checkpoint && !result.checkpoint_error),
    checkpoint_result: checkpointSummary.result ?? null,
    checkpoint_reason_code: checkpointSummary.reason_code ?? null,
    repair_layer_open_count: Number(checkpointSummary.repair_layer_open_count ?? 0),
    repair_layer_blocking: checkpointSummary.repair_layer_blocking === true,
    repair_layer_top_findings: Array.isArray(checkpointSummary.repair_layer_top_findings)
      ? checkpointSummary.repair_layer_top_findings
      : [],
    constraint_loop_required: result.constraint_loop_required === true,
    constraint_loop_ok: result.constraint_loop_required !== true || !result.constraint_loop_error,
  };
}

export function buildRunJsonHookSummary(result) {
  return {
    result: result.result,
    reason_code: result.error?.message ? "HOOK_COMMAND_FAILED" : null,
    state_mode: result.state_mode,
    db_sync_enabled: result.db_sync?.enabled === true,
    db_sync_ok: result.db_sync?.enabled !== true || !result.db_sync?.error,
    command_status: result.command_status,
    repair_layer_open_count: Number(result.normalized?.repair_layer_open_count ?? 0),
    repair_layer_blocking: result.normalized?.repair_layer_blocking === true,
    repair_layer_top_findings: Array.isArray(result.normalized?.repair_layer_top_findings)
      ? result.normalized.repair_layer_top_findings
      : [],
  };
}
