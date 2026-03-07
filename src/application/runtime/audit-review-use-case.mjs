import fs from "node:fs";
import { writeJsonIfChanged } from "../../lib/index/io-lib.mjs";
import { resolveRuntimeTargetPath } from "./runtime-path-service.mjs";

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

export function runAuditReviewUseCase({ args, targetRoot }) {
  const eventFile = resolveRuntimeTargetPath(targetRoot, args.eventFile);
  const contextFile = resolveRuntimeTargetPath(targetRoot, args.contextFile);
  const outFile = resolveRuntimeTargetPath(targetRoot, args.out);

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
  return report;
}
