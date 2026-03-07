export function resolveReloadEventResult(reload) {
  if (reload?.decision === "stop") {
    return "stop";
  }
  if (reload?.fallback === true) {
    return "fallback";
  }
  return "ok";
}

export function resolveCheckpointResult({ gateResult }) {
  if (gateResult === "stop") {
    return "stop";
  }
  return "ok";
}

export function resolveCheckpointReasonCode({ gateReasonCode, indexSyncCheck }) {
  if (indexSyncCheck?.enabled && indexSyncCheck.in_sync === false) {
    return "INDEX_SYNC_DRIFT";
  }
  return gateReasonCode ?? null;
}

export function resolveHookResult({ strict, checkpointError }) {
  if (!checkpointError) {
    return "ok";
  }
  return strict ? "stop" : "warn";
}

export function resolveHookReasonCode({ checkpointError }) {
  if (!checkpointError) {
    return null;
  }
  return "HOOK_CHECKPOINT_FAILED";
}
