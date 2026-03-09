#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { isJsonEquivalent, writeJsonIfChanged } from "../../src/lib/index/io-lib.mjs";

function parseArgs(argv) {
  const args = {
    kpiFile: ".aidn/runtime/perf/kpi-report.json",
    targets: "docs/performance/KPI_TARGETS.json",
    out: ".aidn/runtime/perf/kpi-thresholds.json",
    strict: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--kpi-file") {
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

  if (!args.kpiFile) {
    throw new Error("Missing value for --kpi-file");
  }
  if (!args.targets) {
    throw new Error("Missing value for --targets");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/check-thresholds.mjs");
  console.log("  node tools/perf/check-thresholds.mjs --kpi-file .aidn/runtime/perf/kpi-report.json --targets docs/performance/KPI_TARGETS.json");
  console.log("  node tools/perf/check-thresholds.mjs --strict");
}

function readJsonFile(filePath, label) {
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

function getByPath(obj, dottedPath) {
  const keys = dottedPath.split(".");
  let current = obj;
  for (const key of keys) {
    if (current == null || typeof current !== "object" || !(key in current)) {
      return { found: false, value: null };
    }
    current = current[key];
  }
  return { found: true, value: current };
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

function compare(op, actual, expected) {
  if (op === "<=") {
    return actual <= expected;
  }
  if (op === "<") {
    return actual < expected;
  }
  if (op === ">=") {
    return actual >= expected;
  }
  if (op === ">") {
    return actual > expected;
  }
  if (op === "==") {
    return actual === expected;
  }
  throw new Error(`Unsupported comparator: ${op}`);
}

function evaluateRules(kpi, targets) {
  const rules = Array.isArray(targets.rules) ? targets.rules : [];
  const checks = [];

  for (const rule of rules) {
    const id = String(rule.id ?? "").trim();
    const key = String(rule.key ?? "").trim();
    const op = String(rule.op ?? "").trim();
    const expectedRaw = rule.value;
    const severity = String(rule.severity ?? "warn").trim().toLowerCase();

    if (!id || !key || !op) {
      checks.push({
        id: id || "invalid_rule",
        status: "invalid",
        severity: "error",
        message: "Missing id/key/op",
      });
      continue;
    }

    const resolved = getByPath(kpi, key);
    if (!resolved.found) {
      checks.push({
        id,
        key,
        op,
        expected: expectedRaw,
        actual: null,
        status: "missing",
        severity,
        message: `Missing KPI path: ${key}`,
      });
      continue;
    }

    const actual = toNumber(resolved.value);
    const expected = toNumber(expectedRaw);
    if (actual == null || expected == null) {
      checks.push({
        id,
        key,
        op,
        expected: expectedRaw,
        actual: resolved.value,
        status: "invalid",
        severity,
        message: "Expected numeric KPI and numeric threshold",
      });
      continue;
    }

    const ok = compare(op, actual, expected);
    checks.push({
      id,
      key,
      op,
      expected,
      actual,
      status: ok ? "pass" : "fail",
      severity,
      message: ok ? "Threshold satisfied" : "Threshold violated",
    });
  }

  return checks;
}

function summarizeChecks(checks, strict) {
  let pass = 0;
  let fail = 0;
  let missing = 0;
  let invalid = 0;
  let blocking = 0;

  for (const check of checks) {
    if (check.status === "pass") {
      pass += 1;
      continue;
    }
    if (check.status === "fail") {
      fail += 1;
      if (check.severity === "error" || strict) {
        blocking += 1;
      }
      continue;
    }
    if (check.status === "missing") {
      missing += 1;
      if (check.severity === "error") {
        blocking += 1;
      }
      continue;
    }
    invalid += 1;
    blocking += 1;
  }

  const overallStatus = blocking > 0 ? "fail" : (fail > 0 ? "warn" : "pass");
  return {
    overall_status: overallStatus,
    pass,
    fail,
    missing,
    invalid,
    blocking,
  };
}

function formatNumber(value) {
  if (value == null || Number.isNaN(value)) {
    return "n/a";
  }
  return String(value);
}

function printHuman(summary, checks) {
  console.log(`Overall status: ${summary.overall_status.toUpperCase()}`);
  console.log(`Checks: pass=${summary.pass}, fail=${summary.fail}, missing=${summary.missing}, invalid=${summary.invalid}, blocking=${summary.blocking}`);
  console.log("");
  for (const check of checks) {
    const badge = check.status.toUpperCase();
    const left = `${check.id} [${check.severity}]`;
    const right = check.key
      ? `${formatNumber(check.actual)} ${check.op} ${formatNumber(check.expected)}`
      : check.message;
    console.log(`- ${badge} ${left}: ${right}`);
  }
}

function writeJson(filePath, payload) {
  return writeJsonIfChanged(filePath, payload, {
    isEquivalent(previousContent) {
      return isJsonEquivalent(previousContent, payload, ["ts"]);
    },
  });
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { absolute: kpiPath, data: kpiData } = readJsonFile(args.kpiFile, "KPI report");
    const { absolute: targetsPath, data: targetsData } = readJsonFile(args.targets, "Targets file");
    const checks = evaluateRules(kpiData, targetsData);
    const summary = summarizeChecks(checks, args.strict);
    const output = {
      ts: new Date().toISOString(),
      strict: args.strict,
      kpi_file: kpiPath,
      targets_file: targetsPath,
      summary,
      checks,
    };
    const outWrite = writeJson(args.out, output);
    output.output_file = outWrite.path;
    output.output_written = outWrite.written;

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      printHuman(summary, checks);
      console.log("");
      console.log(`Report file: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
    }

    if (summary.blocking > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
