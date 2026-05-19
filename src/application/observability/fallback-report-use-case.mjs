const COLD_START_REASON_CODES = new Set([
  "MISSING_CACHE",
  "CORRUPT_CACHE",
]);

function toIso(value) {
  const ms = Date.parse(String(value ?? ""));
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function buildFallbackRunBuckets(events, options = {}) {
  const runIdFilter = String(options.runId ?? "");
  const runPrefix = String(options.runPrefix ?? "session-");
  const limitRuns = Number(options.limitRuns ?? 30);
  const buckets = new Map();
  for (const event of events) {
    const runId = String(event.run_id ?? "unknown");
    if (runIdFilter && runId !== runIdFilter) {
      continue;
    }
    if (runPrefix && !runId.startsWith(runPrefix)) {
      continue;
    }
    if (!buckets.has(runId)) {
      buckets.set(runId, {
        run_id: runId,
        started_at: null,
        ended_at: null,
        fallback_count: 0,
        cold_start_fallback_count: 0,
        adjusted_fallback_count: 0,
        l3_repeated_fallback_count: 0,
      });
    }
    const bucket = buckets.get(runId);

    const ts = toIso(event.ts);
    if (ts && (!bucket.started_at || ts < bucket.started_at)) {
      bucket.started_at = ts;
    }
    if (ts && (!bucket.ended_at || ts > bucket.ended_at)) {
      bucket.ended_at = ts;
    }

    if (String(event.skill ?? "") === "reload-check" && String(event.result ?? "") === "fallback") {
      bucket.fallback_count += 1;
      if (COLD_START_REASON_CODES.has(String(event.reason_code ?? ""))) {
        bucket.cold_start_fallback_count += 1;
      }
    }
    if (String(event.reason_code ?? "") === "L3_REPEATED_FALLBACK") {
      bucket.l3_repeated_fallback_count += 1;
    }
  }

  const runs = Array.from(buckets.values())
    .map((run) => ({
      ...run,
      adjusted_fallback_count: Math.max(0, run.fallback_count - run.cold_start_fallback_count),
    }))
    .sort((a, b) => String(b.started_at ?? "").localeCompare(String(a.started_at ?? "")));
  if (limitRuns > 0 && runs.length > limitRuns) {
    return runs.slice(0, limitRuns);
  }
  return runs;
}

export function summarizeFallbackRuns(runs, stormThreshold = 2) {
  const fallbackTotal = runs.reduce((sum, run) => sum + run.fallback_count, 0);
  const coldStartFallbackTotal = runs.reduce((sum, run) => sum + run.cold_start_fallback_count, 0);
  const adjustedFallbackTotal = runs.reduce((sum, run) => sum + run.adjusted_fallback_count, 0);
  const runsWithFallback = runs.filter((run) => run.fallback_count > 0).length;
  const runsWithAdjustedFallback = runs.filter((run) => run.adjusted_fallback_count > 0).length;
  const stormRuns = runs.filter((run) => run.fallback_count >= stormThreshold).length;
  const adjustedStormRuns = runs.filter((run) => run.adjusted_fallback_count >= stormThreshold).length;
  const l3RepeatedFallback = runs.reduce((sum, run) => sum + run.l3_repeated_fallback_count, 0);
  const maxFallbackPerRun = runs.reduce((max, run) => Math.max(max, run.fallback_count), 0);
  const adjustedMaxFallbackPerRun = runs.reduce((max, run) => Math.max(max, run.adjusted_fallback_count), 0);
  const runCount = runs.length;
  return {
    runs_analyzed: runCount,
    fallback_total: fallbackTotal,
    cold_start_fallback_total: coldStartFallbackTotal,
    adjusted_fallback_total: adjustedFallbackTotal,
    runs_with_fallback: runsWithFallback,
    runs_with_adjusted_fallback: runsWithAdjustedFallback,
    fallback_run_rate: runCount > 0 ? runsWithFallback / runCount : 0,
    adjusted_fallback_run_rate: runCount > 0 ? runsWithAdjustedFallback / runCount : 0,
    storm_runs: stormRuns,
    adjusted_storm_runs: adjustedStormRuns,
    max_fallback_per_run: maxFallbackPerRun,
    adjusted_max_fallback_per_run: adjustedMaxFallbackPerRun,
    l3_repeated_fallback: l3RepeatedFallback,
    storm_threshold_per_run: stormThreshold,
  };
}
