export function isWorkflowResultOk(result) {
  return result === "ok";
}

export function deriveRepairLayerStatus({ openCount, blocking }) {
  if (blocking === true) {
    return "block";
  }
  if (Number(openCount ?? 0) > 0) {
    return "warn";
  }
  return "clean";
}

export function deriveRepairLayerAdvice({ openCount, blocking, topFindings }) {
  const status = deriveRepairLayerStatus({ openCount, blocking });
  if (status === "block") {
    return "Resolve blocking repair findings before continuing db-backed execution.";
  }
  if (status === "warn") {
    const topFinding = Array.isArray(topFindings) ? topFindings[0] : null;
    const findingType = String(topFinding?.finding_type ?? "").trim();
    if (findingType.length > 0) {
      return `Review open repair findings, starting with ${findingType}.`;
    }
    return "Review open repair findings to improve context reliability.";
  }
  return "Repair layer is clean.";
}

export function deriveRepairPrimaryReason({ status, advice, topFindings }) {
  const topFinding = Array.isArray(topFindings) ? topFindings[0] : null;
  if (topFinding && typeof topFinding === "object") {
    const severity = String(topFinding.severity ?? "").trim().toLowerCase();
    const findingType = String(topFinding.finding_type ?? "").trim();
    const entityId = String(topFinding.entity_id ?? "").trim();
    const message = String(topFinding.message ?? "").trim();
    const parts = [];
    if (severity) parts.push(severity);
    if (findingType) parts.push(findingType);
    if (entityId) parts.push(entityId);
    if (message) parts.push(message);
    if (parts.length > 0) {
      return parts.join(": ");
    }
  }
  const normalizedAdvice = String(advice ?? "").trim();
  if (normalizedAdvice.length > 0) {
    return normalizedAdvice;
  }
  const normalizedStatus = String(status ?? "").trim().toLowerCase();
  if (normalizedStatus === "clean" || normalizedStatus === "ok") {
    return "Repair layer is clean.";
  }
  return "repair-layer reason is unknown";
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
  const repairLayerOpenCount = Number(level2.repair_layer_open_count ?? 0);
  const repairLayerBlocking = level3.repair_layer_blocking === true;
  const repairLayerTopFindings = Array.isArray(level2.repair_layer_top_findings)
    ? level2.repair_layer_top_findings
    : [];
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
    repair_layer_open_count: repairLayerOpenCount,
    repair_layer_blocking: repairLayerBlocking,
    repair_layer_status: deriveRepairLayerStatus({
      openCount: repairLayerOpenCount,
      blocking: repairLayerBlocking,
    }),
    repair_layer_advice: deriveRepairLayerAdvice({
      openCount: repairLayerOpenCount,
      blocking: repairLayerBlocking,
      topFindings: repairLayerTopFindings,
    }),
    repair_primary_reason: deriveRepairPrimaryReason({
      status: deriveRepairLayerStatus({
        openCount: repairLayerOpenCount,
        blocking: repairLayerBlocking,
      }),
      advice: deriveRepairLayerAdvice({
        openCount: repairLayerOpenCount,
        blocking: repairLayerBlocking,
        topFindings: repairLayerTopFindings,
      }),
      topFindings: repairLayerTopFindings,
    }),
    repair_layer_top_findings: repairLayerTopFindings,
  };
}

export function buildWorkflowHookSummary(result) {
  const checkpointSummary = result.checkpoint?.summary ?? {};
  const repairLayerOpenCount = Number(checkpointSummary.repair_layer_open_count ?? 0);
  const repairLayerBlocking = checkpointSummary.repair_layer_blocking === true;
  const repairLayerTopFindings = Array.isArray(checkpointSummary.repair_layer_top_findings)
    ? checkpointSummary.repair_layer_top_findings
    : [];
  return {
    result: result.result,
    reason_code: result.reason_code,
    phase: result.phase,
    checkpoint_ok: Boolean(result.checkpoint && !result.checkpoint_error),
    checkpoint_result: checkpointSummary.result ?? null,
    checkpoint_reason_code: checkpointSummary.reason_code ?? null,
    repair_layer_open_count: repairLayerOpenCount,
    repair_layer_blocking: repairLayerBlocking,
    repair_layer_status: deriveRepairLayerStatus({
      openCount: repairLayerOpenCount,
      blocking: repairLayerBlocking,
    }),
    repair_layer_advice: deriveRepairLayerAdvice({
      openCount: repairLayerOpenCount,
      blocking: repairLayerBlocking,
      topFindings: repairLayerTopFindings,
    }),
    repair_primary_reason: deriveRepairPrimaryReason({
      status: deriveRepairLayerStatus({
        openCount: repairLayerOpenCount,
        blocking: repairLayerBlocking,
      }),
      advice: deriveRepairLayerAdvice({
        openCount: repairLayerOpenCount,
        blocking: repairLayerBlocking,
        topFindings: repairLayerTopFindings,
      }),
      topFindings: repairLayerTopFindings,
    }),
    repair_layer_top_findings: repairLayerTopFindings,
    constraint_loop_required: result.constraint_loop_required === true,
    constraint_loop_ok: result.constraint_loop_required !== true || !result.constraint_loop_error,
  };
}

export function buildRunJsonHookSummary(result) {
  const repairLayerOpenCount = Number(result.normalized?.repair_layer_open_count ?? 0);
  const repairLayerBlocking = result.normalized?.repair_layer_blocking === true;
  const repairLayerTopFindings = Array.isArray(result.normalized?.repair_layer_top_findings)
    ? result.normalized.repair_layer_top_findings
    : [];
  const executionFailed = Boolean(result.error?.message) && result.result == null && result.action == null;
  return {
    result: result.result,
    reason_code: executionFailed ? "HOOK_COMMAND_FAILED" : null,
    state_mode: result.state_mode,
    db_sync_enabled: result.db_sync?.enabled === true,
    db_sync_ok: result.db_sync?.enabled !== true || !result.db_sync?.error,
    command_status: result.command_status,
    repair_layer_open_count: repairLayerOpenCount,
    repair_layer_blocking: repairLayerBlocking,
    repair_layer_status: deriveRepairLayerStatus({
      openCount: repairLayerOpenCount,
      blocking: repairLayerBlocking,
    }),
    repair_layer_advice: deriveRepairLayerAdvice({
      openCount: repairLayerOpenCount,
      blocking: repairLayerBlocking,
      topFindings: repairLayerTopFindings,
    }),
    repair_primary_reason: deriveRepairPrimaryReason({
      status: deriveRepairLayerStatus({
        openCount: repairLayerOpenCount,
        blocking: repairLayerBlocking,
      }),
      advice: deriveRepairLayerAdvice({
        openCount: repairLayerOpenCount,
        blocking: repairLayerBlocking,
        topFindings: repairLayerTopFindings,
      }),
      topFindings: repairLayerTopFindings,
    }),
    repair_layer_top_findings: repairLayerTopFindings,
  };
}
