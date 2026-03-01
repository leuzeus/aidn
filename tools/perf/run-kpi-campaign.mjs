#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { writeJsonIfChanged } from "./io-lib.mjs";

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

function runJson(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function runNoJson(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
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
    const startedAt = Date.now();

    if (args.reset) {
      runNoJson("tools/perf/reset-runtime.mjs", []);
    }

    const runs = [];
    for (let i = 0; i < args.iterations; i += 1) {
      const sessionStart = runJson("tools/perf/workflow-hook.mjs", [
        "--phase",
        "session-start",
        "--target",
        targetRoot,
        "--mode",
        args.mode,
        "--index-store",
        args.indexStore,
        "--event-file",
        args.eventFile,
        "--json",
      ]);

      runNoJson("tools/perf/delivery-window.mjs", [
        "--action",
        "start",
        "--target",
        targetRoot,
        "--mode",
        args.mode,
        "--file",
        args.eventFile,
      ]);
      if (args.sleepMs > 0) {
        await sleep(args.sleepMs);
      }
      runNoJson("tools/perf/delivery-window.mjs", [
        "--action",
        "end",
        "--target",
        targetRoot,
        "--mode",
        args.mode,
        "--file",
        args.eventFile,
      ]);

      const sessionClose = runJson("tools/perf/workflow-hook.mjs", [
        "--phase",
        "session-close",
        "--target",
        targetRoot,
        "--mode",
        args.mode,
        "--index-store",
        args.indexStore,
        "--event-file",
        args.eventFile,
        "--json",
      ]);

      runs.push({
        index: i + 1,
        run_id: sessionClose.run_id ?? sessionStart.run_id ?? null,
        start_result: sessionStart.result ?? null,
        close_result: sessionClose.result ?? null,
      });
    }

    const kpi = runJson("tools/perf/report-kpi.mjs", [
      "--file",
      args.eventFile,
      "--run-prefix",
      "session-",
      "--require-delivery",
      "--limit",
      String(args.iterations * 5),
      "--json",
    ]);
    const kpiWrite = writeJson(args.kpiFile, kpi);

    const thresholds = runJson("tools/perf/check-thresholds.mjs", [
      "--kpi-file",
      args.kpiFile,
      "--targets",
      args.targetsFile,
      "--out",
      args.thresholdsFile,
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
      event_file: path.resolve(process.cwd(), args.eventFile),
      kpi_file: kpiWrite.path,
      kpi_written: kpiWrite.written,
      thresholds_file: path.resolve(process.cwd(), args.thresholdsFile),
      kpi_summary: kpi.summary ?? null,
      thresholds_summary: thresholds.summary ?? null,
      run_sample: runs.slice(-5),
      duration_ms: Date.now() - startedAt,
    };

    const outWrite = writeJson(args.out, payload);
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
