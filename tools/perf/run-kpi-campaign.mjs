#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeJsonIfChanged } from "../../src/lib/index/io-lib.mjs";

const PERF_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(PERF_DIR, "..", "..");

function parseArgs(argv) {
  const args = {
    iterations: 30,
    target: "tests/fixtures/repo-installed-core",
    mode: "COMMITTING",
    indexStore: "all",
    sleepMs: 1000,
    reset: true,
    eventFile: ".aidn/runtime/perf/workflow-events.ndjson",
    kpiFile: ".aidn/runtime/perf/kpi-report.json",
    thresholdsFile: ".aidn/runtime/perf/kpi-thresholds.json",
    targetsFile: "docs/performance/KPI_TARGETS.json",
    out: ".aidn/runtime/perf/campaign-report.json",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--iterations") {
      args.iterations = Number(argv[i + 1] ?? "");
      i += 1;
    } else if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--mode") {
      args.mode = String(argv[i + 1] ?? "").toUpperCase();
      i += 1;
    } else if (token === "--index-store") {
      args.indexStore = String(argv[i + 1] ?? "").toLowerCase();
      i += 1;
    } else if (token === "--sleep-ms") {
      args.sleepMs = Number(argv[i + 1] ?? "");
      i += 1;
    } else if (token === "--no-reset") {
      args.reset = false;
    } else if (token === "--event-file") {
      args.eventFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--kpi-file") {
      args.kpiFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--thresholds-file") {
      args.thresholdsFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--targets-file") {
      args.targetsFile = argv[i + 1] ?? "";
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

  if (!Number.isFinite(args.iterations) || args.iterations <= 0) {
    throw new Error("Invalid --iterations. Expected positive integer.");
  }
  if (!Number.isFinite(args.sleepMs) || args.sleepMs < 0) {
    throw new Error("Invalid --sleep-ms. Expected integer >= 0.");
  }
  if (!["THINKING", "EXPLORING", "COMMITTING", "UNKNOWN"].includes(args.mode)) {
    throw new Error("Invalid --mode. Expected THINKING|EXPLORING|COMMITTING|UNKNOWN");
  }
  if (!["file", "sql", "dual", "sqlite", "dual-sqlite", "all"].includes(args.indexStore)) {
    throw new Error("Invalid --index-store. Expected file|sql|dual|sqlite|dual-sqlite|all");
  }
  if (!args.target || !args.eventFile || !args.kpiFile || !args.thresholdsFile || !args.targetsFile || !args.out) {
    throw new Error("Missing required argument values");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/run-kpi-campaign.mjs");
  console.log("  node tools/perf/run-kpi-campaign.mjs --iterations 30 --target tests/fixtures/repo-installed-core");
  console.log("  node tools/perf/run-kpi-campaign.mjs --iterations 10 --sleep-ms 500 --index-store all --json");
}

function resolveScript(script) {
  if (path.isAbsolute(script)) {
    return script;
  }
  let normalized = String(script ?? "").replace(/\\/g, "/");
  if (normalized.startsWith("tools/perf/")) {
    normalized = normalized.slice("tools/perf/".length);
  }
  return path.resolve(PERF_DIR, normalized);
}

function resolveInputPath(targetRoot, candidatePath) {
  if (!candidatePath) {
    return "";
  }
  if (path.isAbsolute(candidatePath)) {
    return candidatePath;
  }
  const fromTarget = path.resolve(targetRoot, candidatePath);
  if (fs.existsSync(fromTarget)) {
    return fromTarget;
  }
  const fromCwd = path.resolve(process.cwd(), candidatePath);
  if (fs.existsSync(fromCwd)) {
    return fromCwd;
  }
  const fromPackage = path.resolve(PACKAGE_ROOT, candidatePath);
  if (fs.existsSync(fromPackage)) {
    return fromPackage;
  }
  return fromTarget;
}

function resolveOutputPath(targetRoot, candidatePath) {
  if (!candidatePath) {
    return "";
  }
  if (path.isAbsolute(candidatePath)) {
    return candidatePath;
  }
  return path.resolve(targetRoot, candidatePath);
}

function runJson(script, scriptArgs) {
  const file = resolveScript(script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function runNoJson(script, scriptArgs) {
  const file = resolveScript(script);
  execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function writeJson(filePath, payload) {
  return writeJsonIfChanged(filePath, payload, {
    isEquivalent(previousContent) {
      try {
        const previous = JSON.parse(previousContent);
        const a = JSON.parse(JSON.stringify(previous));
        const b = JSON.parse(JSON.stringify(payload));
        delete a.ts;
        delete b.ts;
        return JSON.stringify(a) === JSON.stringify(b);
      } catch {
        return false;
      }
    },
  });
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const eventFilePath = resolveOutputPath(targetRoot, args.eventFile);
    const kpiFilePath = resolveOutputPath(targetRoot, args.kpiFile);
    const thresholdsFilePath = resolveOutputPath(targetRoot, args.thresholdsFile);
    const outFilePath = resolveOutputPath(targetRoot, args.out);
    const targetsFilePath = resolveInputPath(targetRoot, args.targetsFile);
    const startedAt = Date.now();

    if (args.reset) {
      runNoJson("reset-runtime.mjs", [
        "--root",
        path.resolve(targetRoot, ".aidn", "runtime"),
      ]);
    }

    const runs = [];
    for (let i = 0; i < args.iterations; i += 1) {
      const sessionStart = runJson("workflow-hook.mjs", [
        "--phase",
        "session-start",
        "--target",
        targetRoot,
        "--mode",
        args.mode,
        "--index-store",
        args.indexStore,
        "--event-file",
        eventFilePath,
        "--json",
      ]);

      runNoJson("delivery-window.mjs", [
        "--action",
        "start",
        "--target",
        targetRoot,
        "--mode",
        args.mode,
        "--file",
        eventFilePath,
      ]);
      if (args.sleepMs > 0) {
        await sleep(args.sleepMs);
      }
      runNoJson("delivery-window.mjs", [
        "--action",
        "end",
        "--target",
        targetRoot,
        "--mode",
        args.mode,
        "--file",
        eventFilePath,
      ]);

      const sessionClose = runJson("workflow-hook.mjs", [
        "--phase",
        "session-close",
        "--target",
        targetRoot,
        "--mode",
        args.mode,
        "--index-store",
        args.indexStore,
        "--event-file",
        eventFilePath,
        "--json",
      ]);

      runs.push({
        index: i + 1,
        run_id: sessionClose.run_id ?? sessionStart.run_id ?? null,
        start_result: sessionStart.result ?? null,
        close_result: sessionClose.result ?? null,
      });
    }

    const kpi = runJson("report-kpi.mjs", [
      "--file",
      eventFilePath,
      "--run-prefix",
      "session-",
      "--require-delivery",
      "--limit",
      String(args.iterations * 5),
      "--json",
    ]);
    const kpiWrite = writeJson(kpiFilePath, kpi);

    const thresholds = runJson("check-thresholds.mjs", [
      "--kpi-file",
      kpiFilePath,
      "--targets",
      targetsFilePath,
      "--out",
      thresholdsFilePath,
      "--json",
    ]);

    const payload = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      iterations_requested: args.iterations,
      iterations_completed: runs.length,
      index_store: args.indexStore,
      sleep_ms: args.sleepMs,
      reset: args.reset,
      event_file: eventFilePath,
      kpi_file: kpiWrite.path,
      kpi_written: kpiWrite.written,
      thresholds_file: thresholdsFilePath,
      targets_file: targetsFilePath,
      kpi_summary: kpi.summary ?? null,
      thresholds_summary: thresholds.summary ?? null,
      run_sample: runs.slice(-5),
      duration_ms: Date.now() - startedAt,
    };

    const outWrite = writeJson(outFilePath, payload);
    payload.output_file = outWrite.path;
    payload.output_written = outWrite.written;

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(`Campaign completed: ${runs.length}/${args.iterations}`);
    console.log(`Target: ${targetRoot}`);
    console.log(`Index store: ${args.indexStore}`);
    console.log(`Duration: ${payload.duration_ms}ms`);
    console.log(`KPI runs analyzed: ${payload.kpi_summary?.runs_analyzed ?? "n/a"}`);
    console.log(
      `KPI overhead mean/median/p90: ${payload.kpi_summary?.overhead_ratio?.mean ?? "n/a"} / ${payload.kpi_summary?.overhead_ratio?.median ?? "n/a"} / ${payload.kpi_summary?.overhead_ratio?.p90 ?? "n/a"}`,
    );
    console.log(
      `KPI churn mean/median/p90: ${payload.kpi_summary?.artifacts_churn?.mean ?? "n/a"} / ${payload.kpi_summary?.artifacts_churn?.median ?? "n/a"} / ${payload.kpi_summary?.artifacts_churn?.p90 ?? "n/a"}`,
    );
    console.log(
      `KPI gates mean/median/p90: ${payload.kpi_summary?.gates_frequency?.mean ?? "n/a"} / ${payload.kpi_summary?.gates_frequency?.median ?? "n/a"} / ${payload.kpi_summary?.gates_frequency?.p90 ?? "n/a"}`,
    );
    console.log(`Threshold status: ${payload.thresholds_summary?.overall_status ?? "n/a"}`);
    console.log(`Output: ${payload.output_file} (${payload.output_written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

await main();
