#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { writeJsonIfChanged } from "./io-lib.mjs";

const CONTROL_SKILLS = new Set([
  "context-reload",
  "start-session",
  "branch-cycle-audit",
  "drift-check",
  "close-session",
]);

function parseArgs(argv) {
  const args = {
    file: ".aidn/runtime/perf/workflow-events.ndjson",
    runId: "",
    runPrefix: "",
    out: "",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--file") {
      args.file = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--run-id") {
      args.runId = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--run-prefix") {
      args.runPrefix = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.file) {
    throw new Error("Missing value for --file");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/report-constraints.mjs");
  console.log("  node tools/perf/report-constraints.mjs --file .aidn/runtime/perf/workflow-events.ndjson");
  console.log("  node tools/perf/report-constraints.mjs --run-prefix session- --out .aidn/runtime/perf/constraint-report.json");
  console.log("  node tools/perf/report-constraints.mjs --json");
}

function parseNdjson(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`NDJSON file not found: ${absolute}`);
  }
  const lines = fs.readFileSync(absolute, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const events = [];
  for (let i = 0; i < lines.length; i += 1) {
    try {
      events.push(JSON.parse(lines[i]));
    } catch (error) {
      throw new Error(`Invalid JSON at line ${i + 1}: ${error.message}`);
    }
  }
  return { events, absolute };
}

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

function p90(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1);
  return sorted[index];
}

function topReasonCodes(mapLike, limit = 3) {
  return Array.from(mapLike.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([reasonCode, count]) => ({ reason_code: reasonCode, count }));
}

function recommendationForSkill(skill) {
  if (skill === "context-reload") {
    return "Increase incremental cache hit-rate and reduce fallback triggers on reload.";
  }
  if (skill === "branch-cycle-audit") {
    return "Skip branch-cycle-audit when git mapping and branch digest are unchanged.";
  }
  if (skill === "drift-check") {
    return "Run drift-check conditionally on strong signals only (L2), not every iteration.";
  }
  if (skill === "start-session" || skill === "close-session") {
    return "Reduce session hook write volume with write-on-change and selective checkpoints.";
  }
  return "Reduce repeated control invocations and optimize heavy parsing paths for this skill.";
}

function severityFromShare(share) {
  if (!Number.isFinite(share)) {
    return "low";
  }
  if (share >= 0.5) {
    return "high";
  }
  if (share >= 0.3) {
    return "medium";
  }
  return "low";
}

function summarize(events) {
  const skillAgg = new Map();
  const runIds = new Set();
  let durationTotalMs = 0;
  let controlDurationMs = 0;
  let deliveryDurationMs = 0;

  for (const event of events) {
    const skill = String(event.skill ?? "").trim() || "unknown";
    const durationMs = toInt(event.duration_ms, 0);
    const isControl = eventIsControl(event);
    const runId = String(event.run_id ?? "").trim();
    const result = String(event.result ?? "").toLowerCase();
    const gatesTriggered = Array.isArray(event.gates_triggered) ? event.gates_triggered.length : 0;
    const reasonCode = String(event.reason_code ?? "").trim();

    if (runId) {
      runIds.add(runId);
    }

    durationTotalMs += durationMs;
    if (isControl) {
      controlDurationMs += durationMs;
    } else {
      deliveryDurationMs += durationMs;
    }

    if (!skillAgg.has(skill)) {
      skillAgg.set(skill, {
        skill,
        events: 0,
        duration_ms: 0,
        control_duration_ms: 0,
        delivery_duration_ms: 0,
        durations: [],
        gates_triggered_total: 0,
        stop_events: 0,
        fallback_events: 0,
        reason_codes: new Map(),
      });
    }

    const bucket = skillAgg.get(skill);
    bucket.events += 1;
    bucket.duration_ms += durationMs;
    bucket.durations.push(durationMs);
    bucket.gates_triggered_total += gatesTriggered;
    if (result === "stop") {
      bucket.stop_events += 1;
    }
    if (result === "fallback" || String(event.phase ?? "").toLowerCase() === "fallback") {
      bucket.fallback_events += 1;
    }
    if (reasonCode) {
      bucket.reason_codes.set(reasonCode, (bucket.reason_codes.get(reasonCode) ?? 0) + 1);
    }
    if (isControl) {
      bucket.control_duration_ms += durationMs;
    } else {
      bucket.delivery_duration_ms += durationMs;
    }
  }

  const skills = Array.from(skillAgg.values())
    .map((bucket) => ({
      skill: bucket.skill,
      events: bucket.events,
      duration_ms: bucket.duration_ms,
      duration_share_of_total: durationTotalMs > 0 ? bucket.duration_ms / durationTotalMs : 0,
      control_duration_ms: bucket.control_duration_ms,
      control_share_of_control: controlDurationMs > 0 ? bucket.control_duration_ms / controlDurationMs : 0,
      delivery_duration_ms: bucket.delivery_duration_ms,
      avg_duration_ms: bucket.events > 0 ? bucket.duration_ms / bucket.events : 0,
      p90_duration_ms: p90(bucket.durations),
      gates_triggered_total: bucket.gates_triggered_total,
      stop_events: bucket.stop_events,
      fallback_events: bucket.fallback_events,
      top_reason_codes: topReasonCodes(bucket.reason_codes),
    }))
    .sort((left, right) => {
      if (right.control_duration_ms !== left.control_duration_ms) {
        return right.control_duration_ms - left.control_duration_ms;
      }
      return right.duration_ms - left.duration_ms;
    });

  const constraintCandidate = skills[0] ?? null;
  let activeConstraint = null;
  if (constraintCandidate != null) {
    const signal = controlDurationMs > 0 ? "control_duration_ms" : "duration_ms";
    const share = signal === "control_duration_ms"
      ? constraintCandidate.control_share_of_control
      : constraintCandidate.duration_share_of_total;
    activeConstraint = {
      skill: constraintCandidate.skill,
      signal,
      share,
      severity: severityFromShare(share),
      recommendation: recommendationForSkill(constraintCandidate.skill),
    };
  }

  return {
    summary: {
      events_analyzed: events.length,
      runs_analyzed: runIds.size,
      duration_total_ms: durationTotalMs,
      control_duration_ms: controlDurationMs,
      delivery_duration_ms: deliveryDurationMs,
      control_share_of_total: durationTotalMs > 0 ? controlDurationMs / durationTotalMs : 0,
      active_constraint: activeConstraint,
    },
    skills,
  };
}

function formatPct(value) {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${(value * 100).toFixed(2)}%`;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { events, absolute } = parseNdjson(args.file);
    let filtered = [...events];
    if (args.runId) {
      filtered = filtered.filter((event) => String(event.run_id ?? "") === args.runId);
    }
    if (args.runPrefix) {
      filtered = filtered.filter((event) => String(event.run_id ?? "").startsWith(args.runPrefix));
    }

    const summarized = summarize(filtered);
    const payload = {
      ts: new Date().toISOString(),
      source_file: absolute,
      filters: {
        run_id: args.runId || null,
        run_prefix: args.runPrefix || null,
      },
      summary: summarized.summary,
      skills: summarized.skills,
    };

    let outWrite = null;
    if (args.out) {
      outWrite = writeJsonIfChanged(args.out, payload);
      payload.output_file = outWrite.path;
      payload.output_written = outWrite.written;
    }

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(`Source: ${payload.source_file}`);
    console.log(`Events analyzed: ${payload.summary.events_analyzed}`);
    console.log(`Runs analyzed: ${payload.summary.runs_analyzed}`);
    console.log(`Control share of total duration: ${formatPct(payload.summary.control_share_of_total)}`);
    if (payload.summary.active_constraint) {
      console.log(`Active constraint: ${payload.summary.active_constraint.skill} (${payload.summary.active_constraint.signal}, share=${formatPct(payload.summary.active_constraint.share)}, severity=${payload.summary.active_constraint.severity})`);
      console.log(`Recommendation: ${payload.summary.active_constraint.recommendation}`);
    } else {
      console.log("Active constraint: n/a");
    }
    if (outWrite != null) {
      console.log(`Report file: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
