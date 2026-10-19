import {
  deriveRepairLayerStatus,
  deriveRepairLayerAdvice,
  deriveRepairPrimaryReason,
} from "../../core/workflow/workflow-output-factory.mjs";

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return null;
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== null && item !== undefined).map((item) => String(item));
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
  }
  return [];
}

function toBooleanOrNull(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no"].includes(normalized)) {
      return false;
    }
  }
  return null;
}

function normalizeError(input) {
  if (!input || typeof input !== "object") {
    return null;
  }
  const message = firstDefined(input.message, input.error_message, null);
  const stdout = firstDefined(input.stdout, null);
  const stderr = firstDefined(input.stderr, null);
  const status = Number(firstDefined(input.status, input.code, null));
  if (message == null && stdout == null && stderr == null && Number.isNaN(status)) {
    return null;
  }
  return {
    message: message == null ? "" : String(message),
    stdout: stdout == null ? "" : String(stdout),
    stderr: stderr == null ? "" : String(stderr),
    status: Number.isFinite(status) ? status : null,
  };
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function resolveObservedLevels(input, payload) {
  const candidates = [
    input.levels, payload.levels,
    input.gate?.levels, payload.gate?.levels,
    input.gating?.levels, payload.gating?.levels,
    input.checkpoint?.gate?.levels, payload.checkpoint?.gate?.levels,
    input.workflow_hook?.checkpoint?.gate?.levels, payload.workflow_hook?.checkpoint?.gate?.levels,
  ];
  // Keep one gate's observations together; an incomplete gate does not borrow
  // repair evidence from another nested execution.
  return candidates.find((value) => value && typeof value === "object" && !Array.isArray(value)
    && ["level1", "level2", "level3"].some((key) => Object.hasOwn(value, key))) ?? {};
}

function projectRepairEvidence(input, payload, summaries, levels) {
  const level2 = objectOrEmpty(levels.level2);
  const level3 = objectOrEmpty(levels.level3);
  const summaryField = (key) => firstDefined(...summaries.map((summary) => summary[key]));
  const explicitStatus = firstDefined(summaryField("repair_layer_status"), input.repair_layer_status, payload.repair_layer_status);
  const measurementSources = [...summaries, {
    repair_layer_open_count: level2.repair_layer_open_count,
    repair_layer_blocking: level3.repair_layer_blocking,
    repair_layer_top_findings: level2.repair_layer_top_findings,
  }, input, payload];
  const countSource = measurementSources.find((source) => source.repair_layer_open_count != null);
  const blockingSource = measurementSources.find((source) => source.repair_layer_blocking != null);
  const observedCount = countSource?.repair_layer_open_count;
  const observedBlocking = toBooleanOrNull(blockingSource?.repair_layer_blocking);
  const count = typeof observedCount === "number"
    || typeof observedCount === "string" && observedCount.trim() !== "" ? Number(observedCount) : null;
  const unknownStatus = countSource && Object.hasOwn(countSource, "repair_layer_status") && countSource.repair_layer_status == null;
  const measured = countSource === blockingSource && !unknownStatus
    && Number.isFinite(count) && count >= 0 && observedBlocking != null;
  const topFindings = firstDefined(summaryField("repair_layer_top_findings"), level2.repair_layer_top_findings,
    input.repair_layer_top_findings, payload.repair_layer_top_findings, []);
  const measuredFindings = measured ? firstDefined(countSource.repair_layer_top_findings, []) : [];
  const measuredStatus = measured ? deriveRepairLayerStatus({ openCount: count, blocking: observedBlocking }) : null;
  const status = explicitStatus ?? measuredStatus;
  const canDeriveAdvice = measured && (explicitStatus == null || explicitStatus === measuredStatus);
  const advice = firstDefined(summaryField("repair_layer_advice"), input.repair_layer_advice, payload.repair_layer_advice,
    canDeriveAdvice ? deriveRepairLayerAdvice({ openCount: count, blocking: observedBlocking, topFindings: measuredFindings }) : null);
  const primaryReason = firstDefined(summaryField("repair_primary_reason"), input.repair_primary_reason, payload.repair_primary_reason,
    canDeriveAdvice ? deriveRepairPrimaryReason({ status, advice, topFindings: measuredFindings }) : null);
  return {
    repair_layer_open_count: Number.isFinite(count) && count >= 0 ? count : 0,
    repair_layer_blocking: observedBlocking === true,
    repair_layer_top_findings: topFindings,
    repair_layer_status: status,
    repair_layer_advice: advice,
    repair_primary_reason: primaryReason,
  };
}

export function normalizeHookPayload(rawInput, options = {}) {
  const now = new Date().toISOString();
  const input = rawInput && typeof rawInput === "object" ? rawInput : {};
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const inputSummary = input.summary && typeof input.summary === "object" ? input.summary : {};
  const payloadSummary = payload.summary && typeof payload.summary === "object" ? payload.summary : {};
  const payloadCheckpoint = payload.checkpoint && typeof payload.checkpoint === "object" ? payload.checkpoint : {};
  const payloadCheckpointSummary = payloadCheckpoint.summary && typeof payloadCheckpoint.summary === "object"
    ? payloadCheckpoint.summary
    : {};
  const gate = input.gate && typeof input.gate === "object" ? input.gate : {};
  const reload = input.reload && typeof input.reload === "object" ? input.reload : {};
  const levels = resolveObservedLevels(input, payload);
  const level1 = levels.level1 && typeof levels.level1 === "object" ? levels.level1 : {};
  const repair = projectRepairEvidence(input, payload, [
    payloadSummary, payloadCheckpointSummary, inputSummary,
    objectOrEmpty(input.checkpoint?.summary),
    objectOrEmpty(payload.workflow_hook?.summary), objectOrEmpty(input.workflow_hook?.summary),
  ], levels);
  const error = normalizeError(firstDefined(input.error, payload.error, null));

  const stateMode = firstDefined(
    options.stateMode,
    input.state_mode,
    payload.state_mode,
    "files",
  );

  const strictRequested = Boolean(options.strictRequested);
  const inputStrictRequested = toBooleanOrNull(firstDefined(input.strict_requested, null));
  let strict = toBooleanOrNull(firstDefined(
    input.strict,
    input.strict_required_by_state,
    null,
  ));
  if (strict == null) {
    strict = strictRequested || stateMode === "dual" || stateMode === "db-only";
  } else if (strictRequested && strict !== true) {
    strict = true;
  }

  const explicitOk = typeof input.ok === "boolean" ? input.ok : null;
  const inferredOk = explicitOk != null ? explicitOk : error == null;

  const normalized = {
    ts: String(firstDefined(input.ts, payload.ts, now)),
    ok: inferredOk,
    skill: String(firstDefined(input.skill, options.skill, "unknown")),
    mode: String(firstDefined(input.mode, options.mode, "UNKNOWN")),
    tool: firstDefined(input.tool, options.tool, null),
    command: firstDefined(options.command, input.command, null),
    state_mode: String(stateMode),
    strict: Boolean(strict),
    strict_requested: strictRequested || inputStrictRequested === true,
    strict_required_by_state: stateMode === "dual" || stateMode === "db-only",
    decision: firstDefined(
      payload.decision,
      input.decision,
      reload.decision,
      level1.decision,
      null,
    ),
    fallback: toBooleanOrNull(firstDefined(
      payload.fallback,
      input.fallback,
      reload.fallback,
      level1.fallback,
      null,
    )),
    reason_codes: toArray(firstDefined(
      payload.reason_codes,
      input.reason_codes,
      reload.reason_codes,
      payload.reload?.reason_codes,
      input.checkpoint?.reload?.reason_codes,
      payloadCheckpoint.reload?.reason_codes,
      input.workflow_hook?.checkpoint?.reload?.reason_codes,
      payload.workflow_hook?.checkpoint?.reload?.reason_codes,
      level1.reason_codes,
      null,
    )),
    action: firstDefined(
      payload.action,
      input.action,
      gate.action,
      null,
    ),
    result: firstDefined(
      payload.result,
      input.result,
      gate.result,
      null,
    ),
    reason_code: firstDefined(
      payload.reason_code,
      input.reason_code,
      gate.reason_code,
      null,
    ),
    blocking_reasons: toArray(firstDefined(
      payload.blocking_reasons,
      payload.admission?.blocking_reasons,
      input.blocking_reasons,
      [],
    )),
    recommended_next_action: firstDefined(
      payload.recommended_next_action,
      payload.admission?.recommended_next_action,
      input.recommended_next_action,
      null,
    ),
    gates_triggered: toArray(firstDefined(
      payload.gates_triggered,
      input.gates_triggered,
      gate.gates_triggered,
      null,
    )),
    mapping: firstDefined(payload.mapping, input.mapping, null),
    target: firstDefined(input.target, input.target_root, payload.target_root, options.targetRoot, null),
    ...repair,
    error,
    raw: input,
  };

  if (normalized.ok === false && normalized.error == null && normalized.result == null && normalized.action == null) {
    normalized.error = {
      message: "Hook execution failed",
      stdout: "",
      stderr: "",
      status: null,
    };
  }
  return normalized;
}
