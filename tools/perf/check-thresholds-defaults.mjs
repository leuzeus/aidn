#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PERF_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(PERF_DIR, "..", "..");

const PRESETS = {
  index: {
    kpiFile: ".aidn/runtime/index/index-report.json",
    targets: "docs/performance/INDEX_TARGETS.json",
    out: ".aidn/runtime/index/index-thresholds.json",
  },
  "index-sync": {
    kpiFile: ".aidn/runtime/index/index-sync-report.json",
    targets: "docs/performance/INDEX_SYNC_TARGETS.json",
    out: ".aidn/runtime/index/index-sync-thresholds.json",
  },
  fallback: {
    kpiFile: ".aidn/runtime/perf/fallback-report.json",
    targets: "docs/performance/FALLBACK_TARGETS.json",
    out: ".aidn/runtime/perf/fallback-thresholds.json",
  },
  constraint: {
    kpiFile: ".aidn/runtime/perf/constraint-report.json",
    targets: "docs/performance/CONSTRAINT_TARGETS.json",
    out: ".aidn/runtime/perf/constraint-thresholds.json",
  },
  "constraint-trend": {
    kpiFile: ".aidn/runtime/perf/constraint-trend.json",
    targets: "docs/performance/CONSTRAINT_TREND_TARGETS.json",
    out: ".aidn/runtime/perf/constraint-trend-thresholds.json",
  },
};

function parseArgs(argv) {
  const args = {
    preset: "",
    target: ".",
    kpiFile: "",
    targets: "",
    out: "",
    strict: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--preset") {
      args.preset = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--kpi-file") {
      args.kpiFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--targets") {
      args.targets = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
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

  if (!args.preset || !Object.prototype.hasOwnProperty.call(PRESETS, args.preset)) {
    throw new Error("Invalid --preset. Expected index|index-sync|fallback|constraint|constraint-trend");
  }
  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/check-thresholds-defaults.mjs --preset index");
  console.log("  node tools/perf/check-thresholds-defaults.mjs --preset index-sync --target ../client");
  console.log("  node tools/perf/check-thresholds-defaults.mjs --preset fallback --json");
  console.log("  node tools/perf/check-thresholds-defaults.mjs --preset constraint --json");
  console.log("  node tools/perf/check-thresholds-defaults.mjs --preset constraint-trend --json");
  console.log("  node tools/perf/check-thresholds-defaults.mjs --preset index --kpi-file .aidn/runtime/index/index-report.json --targets docs/performance/INDEX_TARGETS.json --out .aidn/runtime/index/index-thresholds.json");
}

function resolveOutputPath(targetRoot, candidatePath) {
  if (path.isAbsolute(candidatePath)) {
    return candidatePath;
  }
  return path.resolve(targetRoot, candidatePath);
}

function resolveInputPath(targetRoot, candidatePath) {
  if (path.isAbsolute(candidatePath)) {
    return fs.existsSync(candidatePath) ? candidatePath : "";
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
  return "";
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const preset = PRESETS[args.preset];

    const kpiCandidate = args.kpiFile || preset.kpiFile;
    const targetsCandidate = args.targets || preset.targets;
    const outCandidate = args.out || preset.out;

    const kpiFile = resolveInputPath(targetRoot, kpiCandidate);
    if (!kpiFile) {
      throw new Error(`KPI file not found: ${kpiCandidate}`);
    }
    const targetsFile = resolveInputPath(targetRoot, targetsCandidate);
    if (!targetsFile) {
      throw new Error(`Targets file not found: ${targetsCandidate}`);
    }
    const outFile = resolveOutputPath(targetRoot, outCandidate);

    const checkScript = path.resolve(PERF_DIR, "check-thresholds.mjs");
    const commandArgs = [
      checkScript,
      "--kpi-file",
      kpiFile,
      "--targets",
      targetsFile,
      "--out",
      outFile,
    ];
    if (args.strict) {
      commandArgs.push("--strict");
    }
    if (args.json) {
      commandArgs.push("--json");
    }

    const stdout = execFileSync(process.execPath, commandArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    process.stdout.write(stdout);
  } catch (error) {
    const stderr = String(error?.stderr ?? "").trim();
    if (stderr) {
      console.error(stderr);
    }
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
