export function buildDefaultCheckpointGate(reload) {
  return {
    action: "proceed_l1_fast_checks_only",
    result: "ok",
    reason_code: null,
    gates_triggered: [],
    levels: {
      level1: {
        decision: reload.decision,
        fallback: reload.fallback,
        reason_codes: reload.reason_codes ?? [],
      },
      level2: {
        required: false,
        active_signals: [],
        critical_signals: [],
        changed_files_count: 0,
        changed_files_sample: [],
        index_sync_check_file: null,
        index_sync_check_exists: false,
        index_sync_target_match: false,
        index_sync_in_sync: null,
      },
      level3: {
        required: false,
        reason: null,
        fallback_recent_count: 0,
        index_sync_drift_level: null,
      },
    },
  };
}

export function buildDefaultCheckpointIndex({ targetRoot, stateMode, store }) {
  return {
    ts: new Date().toISOString(),
    target_root: targetRoot,
    store,
    state_mode: stateMode,
    skipped: true,
    skip_reason: "SKIPPED_NO_RELOAD_SIGNAL",
    outputs: [],
    writes: {
      files_written_count: 0,
      bytes_written: 0,
    },
  };
}

export function buildDefaultCheckpointIndexSyncCheck({ strict }) {
  return {
    enabled: false,
    strict,
    in_sync: null,
    action: null,
    mismatch_count: 0,
    duration_ms: 0,
    output_file: null,
    index_file: null,
    index_backend: null,
    skipped: false,
    skip_reason: null,
  };
}

export function buildCheckpointIndexSyncCheckResult({
  strict,
  syncCheckOut,
  durationMs,
  outputFile,
  indexFile,
  indexBackend,
  skipped = false,
  skipReason = null,
}) {
  return {
    enabled: true,
    strict,
    in_sync: syncCheckOut.in_sync === true,
    action: syncCheckOut.action ?? null,
    mismatch_count: Array.isArray(syncCheckOut.summary_mismatches)
      ? syncCheckOut.summary_mismatches.length
      : 0,
    duration_ms: durationMs,
    output_file: outputFile,
    index_file: indexFile,
    index_backend: indexBackend,
    skipped,
    skip_reason: skipReason,
  };
}
