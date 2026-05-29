function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function buildIndexSyncReport(runs) {
  const total = runs.length;
  const inSyncRuns = runs.filter((run) => run.in_sync === true).length;
  const driftRuns = runs.filter((run) => run.in_sync !== true).length;
  const appliedRuns = runs.filter((run) => String(run.action ?? "") === "applied").length;
  const mismatchTotal = runs.reduce((sum, run) => sum + toNumber(run.mismatch_count), 0);
  const avgMismatch = total > 0 ? mismatchTotal / total : 0;
  const inSyncRate = total > 0 ? inSyncRuns / total : 0;
  const highDriftRuns = runs.filter((run) => String(run.drift_level ?? "none") === "high").length;

  const keyCounts = new Map();
  const reasonCodeCounts = new Map();
  for (const run of runs) {
    const keys = Array.isArray(run.mismatch_keys) ? run.mismatch_keys : [];
    for (const key of keys) {
      const normalized = String(key).trim();
      if (!normalized) {
        continue;
      }
      keyCounts.set(normalized, (keyCounts.get(normalized) ?? 0) + 1);
    }
    const reasonCodes = Array.isArray(run.reason_codes) ? run.reason_codes : [];
    for (const code of reasonCodes) {
      const normalized = String(code).trim();
      if (!normalized) {
        continue;
      }
      reasonCodeCounts.set(normalized, (reasonCodeCounts.get(normalized) ?? 0) + 1);
    }
  }
  const topMismatchKeys = Array.from(keyCounts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, 10);
  const topReasonCodes = Array.from(reasonCodeCounts.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    .slice(0, 10);

  return {
    runs_analyzed: total,
    in_sync_runs: inSyncRuns,
    drift_runs: driftRuns,
    applied_runs: appliedRuns,
    high_drift_runs: highDriftRuns,
    in_sync_rate: inSyncRate,
    avg_mismatch_count: avgMismatch,
    top_mismatch_keys: topMismatchKeys,
    top_reason_codes: topReasonCodes,
  };
}
