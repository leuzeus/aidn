#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildConstraintActionsReport } from "../../src/application/observability/constraint-actions-report-use-case.mjs";
import { writeJsonIfChanged } from "../../src/lib/index/io-lib.mjs";

function parseArgs(argv) {
  const args = {
    reportFile: ".aidn/runtime/perf/constraint-report.json",
    thresholdsFile: "",
    out: ".aidn/runtime/perf/constraint-actions.json",
    topSkills: 5,
    maxActions: 8,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--report-file") {
      args.reportFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--thresholds-file") {
      args.thresholdsFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--top-skills") {
      const raw = argv[i + 1] ?? "";
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--top-skills must be an integer");
      }
      args.topSkills = Number(raw);
    } else if (token === "--max-actions") {
      const raw = argv[i + 1] ?? "";
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--max-actions must be an integer");
      }
      args.maxActions = Number(raw);
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.reportFile) {
    throw new Error("Missing value for --report-file");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/report-constraint-actions.mjs");
  console.log("  node tools/perf/report-constraint-actions.mjs --report-file .aidn/runtime/perf/constraint-report.json --out .aidn/runtime/perf/constraint-actions.json");
  console.log("  node tools/perf/report-constraint-actions.mjs --thresholds-file .aidn/runtime/perf/constraint-thresholds.json --json");
}

function readJson(filePath, label) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`${label} not found: ${absolute}`);
  }
  try {
    return { absolute, data: JSON.parse(fs.readFileSync(absolute, "utf8")) };
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
}

function readJsonOptional(filePath) {
  if (!filePath) {
    return null;
  }
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    return null;
  }
  try {
    return { absolute, data: JSON.parse(fs.readFileSync(absolute, "utf8")) };
  } catch {
    return null;
  }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = readJson(args.reportFile, "Constraint report");
    const thresholds = readJsonOptional(args.thresholdsFile);
    const built = buildConstraintActionsReport(report.data, thresholds?.data ?? null, args.topSkills, args.maxActions);

    const payload = {
      ts: new Date().toISOString(),
      source_report_file: report.absolute,
      source_thresholds_file: thresholds?.absolute ?? null,
      summary: built.summary,
      actions: built.actions,
    };

    const outWrite = writeJsonIfChanged(args.out, payload);
    payload.output_file = outWrite.path;
    payload.output_written = outWrite.written;

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(`Constraint report: ${payload.source_report_file}`);
    console.log(`Actions generated: ${payload.summary.generated_actions}`);
    console.log(`Quick wins: ${payload.summary.quick_wins}`);
    console.log(`Foundational: ${payload.summary.foundational}`);
    console.log(`Deep change: ${payload.summary.deep_change}`);
    if (payload.actions.length > 0) {
      console.log(`Top action: ${payload.actions[0].action_id} (priority=${payload.actions[0].priority_score})`);
    }
    console.log(`Output file: ${payload.output_file} (${payload.output_written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
