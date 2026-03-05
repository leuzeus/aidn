#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { writeJsonIfChanged } from "./io-lib.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    eventFile: ".aidn/runtime/perf/workflow-events.ndjson",
    contextFile: ".aidn/runtime/context/codex-context.json",
    out: ".aidn/runtime/perf/audit-review.json",
    maxFallbackRate: 0.35,
    maxStopRate: 0.25,
    minContextEntries: 1,
    strict: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--event-file") {
      args.eventFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--context-file") {
      args.contextFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--max-fallback-rate") {
      args.maxFallbackRate = Number(argv[i + 1] ?? 0.35);
      i += 1;
    } else if (token === "--max-stop-rate") {
      args.maxStopRate = Number(argv[i + 1] ?? 0.25);
      i += 1;
    } else if (token === "--min-context-entries") {
      args.minContextEntries = Number(argv[i + 1] ?? 1);
      i += 1;
    } else if (token === "--strict") {
      args.strict = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  if (!args.eventFile) {
    throw new Error("Missing value for --event-file");
  }
  if (!args.contextFile) {
    throw new Error("Missing value for --context-file");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/audit-review.mjs --target . --json");
  console.log("  node tools/perf/audit-review.mjs --target . --max-fallback-rate 0.30 --max-stop-rate 0.20 --strict");
}

function resolveTargetPath(targetRoot, candidate) {
  if (path.isAbsolute(candidate)) {
    return path.resolve(candidate);
  }
  return path.resolve(targetRoot, candidate);
}

function readEvents(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const lines = fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const events = [];
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      events.push(event);
    } catch {
      // ignore malformed lines
    }
  }
  return events;
}

function readContext(filePath) {
  if (!fs.existsSync(filePath)) {
    return { latest: {}, history: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      latest: parsed?.latest && typeof parsed.latest === "object" ? parsed.latest : {},
      history: Array.isArray(parsed?.history) ? parsed.history : [],
    };
  } catch {
    return { latest: {}, history: [] };
  }
}

function ratio(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function evaluateStatus(metrics, thresholds) {
  const findings = [];

  if (metrics.context_entries < thresholds.min_context_entries) {
    findings.push({
      severity: "fail",
      code: "CONTEXT_INJECTION_MISSING",
      message: `Context entries ${metrics.context_entries} < ${thresholds.min_context_entries}`,
    });
  }
  if (metrics.fallback_rate > thresholds.max_fallback_rate) {
    findings.push({
      severity: "warn",
      code: "FALLBACK_RATE_HIGH",
      message: `Fallback rate ${metrics.fallback_rate.toFixed(3)} > ${thresholds.max_fallback_rate.toFixed(3)}`,
    });
  }
  if (metrics.stop_rate > thresholds.max_stop_rate) {
    findings.push({
      severity: "warn",
      code: "STOP_RATE_HIGH",
      message: `Stop/block rate ${metrics.stop_rate.toFixed(3)} > ${thresholds.max_stop_rate.toFixed(3)}`,
    });
  }

  let status = "PASS";
  if (findings.some((item) => item.severity === "fail")) {
    status = "FAIL";
  } else if (findings.length > 0) {
    status = "WARN";
  }
  return { status, findings };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const eventFile = resolveTargetPath(targetRoot, args.eventFile);
    const contextFile = resolveTargetPath(targetRoot, args.contextFile);
    const outFile = resolveTargetPath(targetRoot, args.out);

    const events = readEvents(eventFile);
    const context = readContext(contextFile);

    const reloadEvents = events.filter((event) => String(event?.skill ?? "").includes("reload"));
    const fallbackEvents = reloadEvents.filter((event) => String(event?.result ?? "").toLowerCase() === "fallback");
    const stopEvents = events.filter((event) => {
      const result = String(event?.result ?? "").toLowerCase();
      return result === "stop" || result === "block";
    });

    const metrics = {
      events_total: events.length,
      reload_events_total: reloadEvents.length,
      fallback_events_total: fallbackEvents.length,
      fallback_rate: ratio(fallbackEvents.length, reloadEvents.length),
      stop_events_total: stopEvents.length,
      stop_rate: ratio(stopEvents.length, events.length),
      context_entries: Array.isArray(context.history) ? context.history.length : 0,
      skills_with_context: Object.keys(context.latest ?? {}).length,
    };

    const thresholds = {
      max_fallback_rate: Number(args.maxFallbackRate),
      max_stop_rate: Number(args.maxStopRate),
      min_context_entries: Number(args.minContextEntries),
    };
    const evaluation = evaluateStatus(metrics, thresholds);
    const report = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      event_file: eventFile,
      context_file: contextFile,
      out_file: outFile,
      thresholds,
      metrics,
      status: evaluation.status,
      findings: evaluation.findings,
      decision: evaluation.status === "PASS" ? "stabilise" : "replanifier",
    };

    const writeResult = writeJsonIfChanged(outFile, report);
    report.written = writeResult.written;

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`Audit review: ${report.status}`);
      console.log(`Decision: ${report.decision}`);
      console.log(`Report: ${outFile}`);
    }

    if (args.strict && report.status !== "PASS") {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
