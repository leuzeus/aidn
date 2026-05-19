const CONTROL_SKILLS = new Set([
  "context-reload",
  "start-session",
  "branch-cycle-audit",
  "drift-check",
  "close-session",
]);

function toInt(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return fallback;
}

function eventIsControl(event) {
  if (typeof event.control === "boolean") {
    return event.control;
  }
  if (Array.isArray(event.gates_triggered) && event.gates_triggered.length > 0) {
    return true;
  }
  if (CONTROL_SKILLS.has(String(event.skill ?? ""))) {
    return true;
  }
  const phase = String(event.phase ?? "").toLowerCase();
  if (phase === "check" || phase === "fallback" || phase === "write") {
    return true;
  }
  return false;
}

export function computeCampaignRuns(events) {
  const runs = new Map();
  for (const event of events) {
    const runId = String(event.run_id ?? "unknown");
    if (!runs.has(runId)) {
      runs.set(runId, {
        run_id: runId,
        started_at: event.ts ?? null,
        ended_at: event.ts ?? null,
        control_time_ms: 0,
        delivery_time_ms: 0,
        gates_executed: 0,
        stops: 0,
        churn_ops: 0,
        events_count: 0,
      });
    }

    const bucket = runs.get(runId);
    const durationMs = toInt(event.duration_ms, 0);
    const gatesTriggered = Array.isArray(event.gates_triggered) ? event.gates_triggered.length : 0;
    const stops = String(event.result ?? "").toLowerCase() === "stop" ? 1 : 0;
    const artifactWrites = toInt(event.artifact_writes, 0);
    const artifactRewrites = toInt(event.artifact_rewrites, 0);
    const artifactDeletes = toInt(event.artifact_deletes, 0);
    const filesWritten = toInt(event.files_written_count, 0);
    const churnOps = artifactWrites + artifactRewrites + artifactDeletes + filesWritten;

    if (eventIsControl(event)) {
      bucket.control_time_ms += durationMs;
    } else {
      bucket.delivery_time_ms += durationMs;
    }
    bucket.gates_executed += gatesTriggered;
    bucket.stops += stops;
    bucket.churn_ops += churnOps;
    bucket.events_count += 1;

    if (event.ts && (!bucket.started_at || event.ts < bucket.started_at)) {
      bucket.started_at = event.ts;
    }
    if (event.ts && (!bucket.ended_at || event.ts > bucket.ended_at)) {
      bucket.ended_at = event.ts;
    }
  }

  const out = [];
  for (const run of runs.values()) {
    const overheadRatio = run.delivery_time_ms > 0
      ? run.control_time_ms / run.delivery_time_ms
      : null;
    const artifactsChurn = run.churn_ops;
    const gatesFrequency = run.gates_executed;
    const gatesStopRate = run.gates_executed > 0
      ? run.stops / run.gates_executed
      : 0;

    out.push({
      ...run,
      overhead_ratio: overheadRatio,
      artifacts_churn: artifactsChurn,
      gates_frequency: gatesFrequency,
      gates_stop_rate: gatesStopRate,
    });
  }

  out.sort((a, b) => String(b.started_at ?? "").localeCompare(String(a.started_at ?? "")));
  return out;
}

function mean(values) {
  if (!values.length) {
    return null;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function median(values) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function p90(values) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1);
  return sorted[index];
}

export function summarizeCampaignRuns(runs) {
  const overheadValues = runs.map((run) => run.overhead_ratio).filter((value) => value != null);
  const churnValues = runs.map((run) => run.artifacts_churn);
  const gatesValues = runs.map((run) => run.gates_frequency);

  return {
    runs_analyzed: runs.length,
    overhead_ratio: {
      mean: mean(overheadValues),
      median: median(overheadValues),
      p90: p90(overheadValues),
    },
    artifacts_churn: {
      mean: mean(churnValues),
      median: median(churnValues),
      p90: p90(churnValues),
    },
    gates_frequency: {
      mean: mean(gatesValues),
      median: median(gatesValues),
      p90: p90(gatesValues),
    },
  };
}
