#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    file: ".aidn/runtime/perf/workflow-events.ndjson",
    event: "",
    stdin: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--file") {
      args.file = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--event") {
      args.event = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--stdin") {
      args.stdin = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.event && !args.stdin) {
    throw new Error("Provide one input source: --event '<json>' or --stdin");
  }
  if (args.event && args.stdin) {
    throw new Error("Use only one input source at a time (--event or --stdin)");
  }
  if (!args.file) {
    throw new Error("Missing value for --file");
  }

  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/collect-event.mjs --event '{\"skill\":\"context-reload\",\"phase\":\"end\",\"event\":\"reload\",\"duration_ms\":800}'");
  console.log("  node tools/perf/collect-event.mjs --stdin < events.ndjson");
  console.log("  node tools/perf/collect-event.mjs --file .aidn/runtime/perf/workflow-events.ndjson --event '{...}'");
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", (error) => reject(error));
  });
}

function parseInputEvents(raw) {
  const text = raw.trim();
  if (!text) {
    return [];
  }

  if (text.startsWith("[")) {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error("JSON input starting with '[' must be an array");
    }
    return parsed;
  }

  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 1) {
    return [JSON.parse(lines[0])];
  }
  return lines.map((line) => JSON.parse(line));
}

function toInt(value, fallback = 0) {
  if (value == null || value === "") {
    return fallback;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return fallback;
}

function toNullableString(value) {
  if (value == null) {
    return null;
  }
  const text = String(value).trim();
  return text ? text : null;
}

function detectBranch() {
  try {
    const output = execSync("git branch --show-current", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output || "unknown";
  } catch {
    return "unknown";
  }
}

function defaultRunId(sessionId) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return sessionId ? `${sessionId}-${stamp}` : `run-${stamp}`;
}

function normalizeGates(gates) {
  if (!Array.isArray(gates)) {
    return [];
  }
  const out = [];
  for (const gate of gates) {
    const normalized = String(gate ?? "").trim();
    if (!normalized) {
      continue;
    }
    out.push(normalized);
  }
  return out;
}

function normalizeEvent(rawEvent) {
  if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
    throw new Error("Each event must be a JSON object");
  }

  const skill = toNullableString(rawEvent.skill);
  const phase = toNullableString(rawEvent.phase);
  const event = toNullableString(rawEvent.event);
  if (!skill || !phase || !event) {
    throw new Error("Event requires non-empty skill, phase, and event");
  }

  const sessionId = toNullableString(rawEvent.session_id);
  const cycleId = toNullableString(rawEvent.cycle_id);
  const runId = toNullableString(rawEvent.run_id) ?? defaultRunId(sessionId);

  return {
    ts: toNullableString(rawEvent.ts) ?? new Date().toISOString(),
    run_id: runId,
    session_id: sessionId,
    cycle_id: cycleId,
    branch: toNullableString(rawEvent.branch) ?? detectBranch(),
    mode: toNullableString(rawEvent.mode) ?? "UNKNOWN",
    skill,
    phase,
    event,
    duration_ms: toInt(rawEvent.duration_ms, 0),
    files_read_count: toInt(rawEvent.files_read_count, 0),
    bytes_read: toInt(rawEvent.bytes_read, 0),
    files_written_count: toInt(rawEvent.files_written_count, 0),
    bytes_written: toInt(rawEvent.bytes_written, 0),
    gates_triggered: normalizeGates(rawEvent.gates_triggered),
    result: toNullableString(rawEvent.result) ?? "ok",
    reason_code: toNullableString(rawEvent.reason_code),
    trace_id: toNullableString(rawEvent.trace_id) ?? `tr-${crypto.randomBytes(4).toString("hex")}`,
  };
}

function appendEvents(filePath, events) {
  const outputPath = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const payload = events.map((event) => `${JSON.stringify(event)}\n`).join("");
  fs.appendFileSync(outputPath, payload, "utf8");
  return outputPath;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const rawInput = args.stdin ? await readStdin() : args.event;
    const parsed = parseInputEvents(rawInput);
    if (parsed.length === 0) {
      console.log("No events to append.");
      process.exit(0);
    }
    const normalized = parsed.map((entry) => normalizeEvent(entry));
    const outputPath = appendEvents(args.file, normalized);

    console.log(`Appended ${normalized.length} event(s).`);
    console.log(`File: ${outputPath}`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
