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
  const levels = input.levels && typeof input.levels === "object" ? input.levels : {};
  const level1 = levels.level1 && typeof levels.level1 === "object" ? levels.level1 : {};
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
    gates_triggered: toArray(firstDefined(
      payload.gates_triggered,
      input.gates_triggered,
      gate.gates_triggered,
      null,
    )),
    mapping: firstDefined(payload.mapping, input.mapping, null),
    target: firstDefined(input.target, input.target_root, payload.target_root, options.targetRoot, null),
    repair_layer_open_count: Number(firstDefined(
      payloadSummary.repair_layer_open_count,
      payloadCheckpointSummary.repair_layer_open_count,
      inputSummary.repair_layer_open_count,
      0,
    )),
    repair_layer_blocking: toBooleanOrNull(firstDefined(
      payloadSummary.repair_layer_blocking,
      payloadCheckpointSummary.repair_layer_blocking,
      inputSummary.repair_layer_blocking,
      false,
    )) === true,
    repair_layer_top_findings: firstDefined(
      payloadSummary.repair_layer_top_findings,
      payloadCheckpointSummary.repair_layer_top_findings,
      inputSummary.repair_layer_top_findings,
      [],
    ),
    error,
    raw: input,
  };

  if (normalized.ok === false && normalized.error == null) {
    normalized.error = {
      message: "Hook execution failed",
      stdout: "",
      stderr: "",
      status: null,
    };
  }
  return normalized;
}
