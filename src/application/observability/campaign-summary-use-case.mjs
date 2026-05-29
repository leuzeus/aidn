function fmt(value, digits = 3) {
  if (value == null || Number.isNaN(value)) {
    return "n/a";
  }
  return Number(value).toFixed(digits);
}

function buildTrendLines(runs) {
  if (!Array.isArray(runs) || runs.length < 2) {
    return [
      "- Trend: insufficient history (need at least 2 runs).",
    ];
  }

  const latest = runs[0];
  const history = runs.slice(1);
  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  }
  function pctDelta(latestValue, baselineValue) {
    if (latestValue == null || baselineValue == null || baselineValue === 0) {
      return null;
    }
    return ((latestValue - baselineValue) / baselineValue) * 100;
  }
  function metricValues(metric) {
    return history.map((run) => run?.[metric]).filter((v) => typeof v === "number" && Number.isFinite(v));
  }

  const overheadMedian = median(metricValues("overhead_ratio"));
  const churnMedian = median(metricValues("artifacts_churn"));
  const gatesMedian = median(metricValues("gates_frequency"));
  const overheadDelta = pctDelta(latest?.overhead_ratio, overheadMedian);
  const churnDelta = pctDelta(latest?.artifacts_churn, churnMedian);
  const gatesDelta = pctDelta(latest?.gates_frequency, gatesMedian);

  function fmtPct(value) {
    if (value == null || Number.isNaN(value)) {
      return "n/a";
    }
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
  }

  return [
    `- Latest run: ${latest?.run_id ?? "n/a"}`,
    `- Overhead trend vs history median: ${fmtPct(overheadDelta)} (latest=${fmt(latest?.overhead_ratio)}, median=${fmt(overheadMedian)})`,
    `- Churn trend vs history median: ${fmtPct(churnDelta)} (latest=${fmt(latest?.artifacts_churn, 2)}, median=${fmt(churnMedian, 2)})`,
    `- Gates trend vs history median: ${fmtPct(gatesDelta)} (latest=${fmt(latest?.gates_frequency, 2)}, median=${fmt(gatesMedian, 2)})`,
  ];
}

export function mergeCampaignRuns(currentRuns, historyRuns) {
  const byRunId = new Map();
  for (const run of historyRuns) {
    const runId = String(run?.run_id ?? "").trim();
    if (!runId) {
      continue;
    }
    byRunId.set(runId, run);
  }
  for (const run of currentRuns) {
    const runId = String(run?.run_id ?? "").trim();
    if (!runId) {
      continue;
    }
    byRunId.set(runId, run);
  }
  return Array.from(byRunId.values()).sort((a, b) => String(b.started_at ?? "").localeCompare(String(a.started_at ?? "")));
}

export function buildCampaignSummaryMarkdown(kpi, mergedRuns, thresholds = null, regression = null, fallbackReport = null, fallbackThresholds = null, maxRuns = 10) {
  const summary = kpi.summary ?? {};
  const overhead = summary.overhead_ratio ?? {};
  const churn = summary.artifacts_churn ?? {};
  const gates = summary.gates_frequency ?? {};
  const thresholdStatus = thresholds?.summary?.overall_status ?? "not-generated";
  const regressionStatus = regression?.summary?.overall_status ?? "not-generated";
  const fallbackStatus = fallbackThresholds?.summary?.overall_status ?? "not-generated";
  const checks = Array.isArray(thresholds?.checks) ? thresholds.checks : [];
  const regressionChecks = Array.isArray(regression?.checks) ? regression.checks : [];
  const fallbackChecks = Array.isArray(fallbackThresholds?.checks) ? fallbackThresholds.checks : [];
  const fallbackSummary = fallbackReport?.summary ?? {};

  const lines = [];
  lines.push("## Perf KPI Summary");
  lines.push("");
  lines.push(`- Runs analyzed: ${summary.runs_analyzed ?? 0}`);
  lines.push(`- Overhead ratio (mean/median/p90): ${fmt(overhead.mean)} / ${fmt(overhead.median)} / ${fmt(overhead.p90)}`);
  lines.push(`- Artifacts churn (mean/median/p90): ${fmt(churn.mean, 2)} / ${fmt(churn.median, 2)} / ${fmt(churn.p90, 2)}`);
  lines.push(`- Gates frequency (mean/median/p90): ${fmt(gates.mean, 2)} / ${fmt(gates.median, 2)} / ${fmt(gates.p90, 2)}`);
  lines.push(`- Threshold status: ${thresholdStatus}`);
  lines.push(`- Regression status: ${regressionStatus}`);
  lines.push(`- Fallback status: ${fallbackStatus}`);
  lines.push(`- Trend runs (current+history): ${Array.isArray(mergedRuns) ? mergedRuns.length : 0}`);
  lines.push(`- Fallback adjusted-total / adjusted-run-rate / adjusted-storm-runs: ${fallbackSummary.adjusted_fallback_total ?? 0} / ${fmt(fallbackSummary.adjusted_fallback_run_rate, 3)} / ${fallbackSummary.adjusted_storm_runs ?? 0}`);
  lines.push(`- Fallback raw-total / cold-start-total: ${fallbackSummary.fallback_total ?? 0} / ${fallbackSummary.cold_start_fallback_total ?? 0}`);
  lines.push("");

  if (checks.length > 0) {
    lines.push("### Threshold Checks");
    lines.push("");
    lines.push("| id | status | severity | actual | op | expected |");
    lines.push("|---|---|---|---:|---|---:|");
    for (const check of checks) {
      lines.push(`| ${check.id ?? "n/a"} | ${check.status ?? "n/a"} | ${check.severity ?? "n/a"} | ${check.actual ?? "n/a"} | ${check.op ?? "n/a"} | ${check.expected ?? "n/a"} |`);
    }
    lines.push("");
  }

  if (regressionChecks.length > 0) {
    lines.push("### Regression Checks");
    lines.push("");
    lines.push("| id | status | severity | metric | latest | baseline | delta_pct | max_increase_pct | effective_max | warmup | warmup_source |");
    lines.push("|---|---|---|---|---:|---:|---:|---:|---:|---|---|");
    for (const check of regressionChecks) {
      lines.push(`| ${check.id ?? "n/a"} | ${check.status ?? "n/a"} | ${check.severity ?? "n/a"} | ${check.metric ?? "n/a"} | ${check.latest_value ?? "n/a"} | ${check.baseline_median ?? "n/a"} | ${check.increase_pct ?? "n/a"} | ${check.max_increase_pct ?? "n/a"} | ${check.effective_max_increase_pct ?? "n/a"} | ${check.warmup_applied === true ? "yes" : "no"} | ${check.warmup_source ?? "n/a"} |`);
    }
    lines.push("");
  }

  if (fallbackChecks.length > 0) {
    lines.push("### Fallback Checks");
    lines.push("");
    lines.push("| id | status | severity | actual | op | expected |");
    lines.push("|---|---|---|---:|---|---:|");
    for (const check of fallbackChecks) {
      lines.push(`| ${check.id ?? "n/a"} | ${check.status ?? "n/a"} | ${check.severity ?? "n/a"} | ${check.actual ?? "n/a"} | ${check.op ?? "n/a"} | ${check.expected ?? "n/a"} |`);
    }
    lines.push("");
  }

  const runs = Array.isArray(mergedRuns) ? mergedRuns.slice(0, maxRuns) : [];
  const trendLines = buildTrendLines(Array.isArray(mergedRuns) ? mergedRuns : []);
  lines.push("### Trends");
  lines.push("");
  lines.push(...trendLines);
  lines.push("");

  if (runs.length > 0) {
    lines.push("### Top Runs");
    lines.push("");
    lines.push("| run_id | overhead_ratio | artifacts_churn | gates_frequency | events |");
    lines.push("|---|---:|---:|---:|---:|");
    for (const run of runs) {
      lines.push(`| ${run.run_id ?? "n/a"} | ${fmt(run.overhead_ratio)} | ${run.artifacts_churn ?? "n/a"} | ${run.gates_frequency ?? "n/a"} | ${run.events_count ?? "n/a"} |`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
