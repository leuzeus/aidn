export function buildNoChangeFastPath(reloadResult, changedFiles) {
  return reloadResult.decision === "incremental"
    && reloadResult.fallback !== true
    && Array.isArray(reloadResult.reason_codes)
    && reloadResult.reason_codes.length === 0
    && changedFiles.length === 0;
}

export function detectGatingSignals({
  sessionObjective,
  cycleGoal,
  changedFiles,
  mode,
  thresholdFiles,
  thresholdMinutes,
  latestDriftMs,
  reloadReasonCodes,
  indexSyncCheckExists,
  indexSyncTargetMatch,
  indexSyncInSync,
  noChangeFastPath,
}) {
  const signal = {
    objective_delta: false,
    scope_growth: false,
    cross_domain_touch: false,
    time_since_last_drift_check: false,
    uncertain_intent: false,
    structure_mixed: false,
    index_sync_drift: false,
  };

  if (!noChangeFastPath && sessionObjective && cycleGoal) {
    const left = sessionObjective.toLowerCase().trim();
    const right = cycleGoal.toLowerCase().trim();
    signal.objective_delta = left !== right && !left.includes(right) && !right.includes(left);
  }

  if (!noChangeFastPath) {
    signal.scope_growth = changedFiles.length > thresholdFiles;
    signal.cross_domain_touch = changedFiles.some((file) =>
      /(db|database|schema|migration|auth|security|api)/i.test(file),
    );
  }

  if (!noChangeFastPath && mode === "COMMITTING") {
    if (latestDriftMs == null) {
      signal.time_since_last_drift_check = true;
    } else {
      const elapsedMinutes = (Date.now() - latestDriftMs) / (1000 * 60);
      signal.time_since_last_drift_check = elapsedMinutes > thresholdMinutes;
    }
  }

  if (!noChangeFastPath) {
    signal.uncertain_intent = !sessionObjective || sessionObjective.trim().length < 15;
    signal.structure_mixed = (reloadReasonCodes ?? []).some((code) =>
      code === "STRUCTURE_MIXED_PROFILE" || code === "STRUCTURE_PROFILE_UNKNOWN" || code === "DECLARED_VERSION_STALE",
    );
  }

  signal.index_sync_drift = indexSyncCheckExists && indexSyncTargetMatch && !indexSyncInSync;
  return signal;
}

export function deriveGatingLevels({
  reloadResult,
  signal,
  changedFiles,
  indexSyncCheckAbsolute,
  indexSyncCheckExists,
  indexSyncTargetMatch,
  indexSyncInSync,
  fallbackRecentCount,
  indexSyncDriftLevel,
  mode,
}) {
  const activeSignals = Object.entries(signal)
    .filter(([, active]) => active)
    .map(([name]) => name);

  const criticalSignals = activeSignals.filter((name) =>
    name === "cross_domain_touch"
      || name === "index_sync_drift"
      || (name === "scope_growth" && mode === "COMMITTING"),
  );

  const level1 = {
    decision: reloadResult.decision,
    fallback: reloadResult.fallback,
    reason_codes: reloadResult.reason_codes ?? [],
  };

  const level2 = {
    required: activeSignals.length > 0,
    active_signals: activeSignals,
    critical_signals: criticalSignals,
    changed_files_count: changedFiles.length,
    changed_files_sample: changedFiles.slice(0, 20),
    index_sync_check_file: indexSyncCheckAbsolute,
    index_sync_check_exists: indexSyncCheckExists,
    index_sync_target_match: indexSyncTargetMatch,
    index_sync_in_sync: indexSyncInSync,
  };

  const hasBlockingReason = level1.reason_codes.some((code) =>
    code === "MAPPING_AMBIGUOUS" || code === "MAPPING_MISSING" || code === "REQUIRED_ARTIFACT_MISSING",
  );

  const level3 = {
    required: hasBlockingReason
      || fallbackRecentCount >= 3
      || (indexSyncTargetMatch && indexSyncDriftLevel === "high"),
    reason: hasBlockingReason
      ? "blocking_l1_reason"
      : (fallbackRecentCount >= 3
        ? "repeated_fallbacks"
        : (indexSyncTargetMatch && indexSyncDriftLevel === "high" ? "index_sync_high_drift" : null)),
    fallback_recent_count: fallbackRecentCount,
    index_sync_drift_level: indexSyncDriftLevel ?? null,
  };

  return { level1, level2, level3 };
}
