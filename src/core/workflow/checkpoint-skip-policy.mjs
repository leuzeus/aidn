export function shouldSkipCheckpointIndex({
  skipIndexOnIncremental,
  reload,
  indexKpiFile,
  hasIndexOutputs,
  hasIndexFileForSyncCheck,
}) {
  return skipIndexOnIncremental
    && reload?.decision === "incremental"
    && reload?.fallback !== true
    && !indexKpiFile
    && hasIndexOutputs
    && hasIndexFileForSyncCheck;
}

export function buildSkippedIndexSyncCheckPayload({ targetRoot }) {
  return {
    ts: new Date().toISOString(),
    target_root: targetRoot,
    in_sync: true,
    action: "skipped_no_signal",
    reason_codes: ["SKIPPED_NO_RELOAD_SIGNAL"],
    summary_mismatches: [],
    summary: {
      missing_in_index: 0,
      stale_in_index: 0,
      digest_mismatch: 0,
    },
    skipped: true,
  };
}
