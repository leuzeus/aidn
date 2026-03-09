#!/usr/bin/env node
import path from "node:path";
import { spawnSync } from "node:child_process";

const FIXTURES = [
  { target: "tests/fixtures/repo-installed-core", expectPass: true },
  { target: "tests/fixtures/perf-current-state/active", expectPass: true },
  { target: "tests/fixtures/perf-current-state/inconsistent", expectPass: false },
  { target: "tests/fixtures/perf-current-state/dor-mismatch", expectPass: false },
  { target: "tests/fixtures/perf-current-state/branch-mismatch", expectPass: false },
  { target: "tests/fixtures/perf-current-state/missing-session", expectPass: false },
  { target: "tests/fixtures/perf-current-state/missing-cycle", expectPass: false },
  { target: "tests/fixtures/perf-current-state/stale-current-state", expectPass: false },
  { target: "tests/fixtures/perf-current-state/mode-branch-mismatch", expectPass: false },
];

function parseArgs(argv) {
  const args = {
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-current-state-consistency-fixtures.mjs");
  console.log("  node tools/perf/verify-current-state-consistency-fixtures.mjs --json");
}

function runOne(spec) {
  const target = spec.target;
  const script = path.resolve(process.cwd(), "tools", "perf", "verify-current-state-consistency.mjs");
  const result = spawnSync(process.execPath, [script, "--target", target, "--json"], {
    cwd: process.cwd(),
    env: { ...process.env },
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 20 * 1024 * 1024,
  });

  if ((result.status ?? 1) !== 0) {
    let payload = null;
    try {
      payload = JSON.parse(String(result.stdout ?? "{}"));
    } catch {
      payload = null;
    }
    return {
      target,
      expect_pass: spec.expectPass,
      observed_pass: payload?.pass === true,
      pass: spec.expectPass === false ? payload?.pass === false : false,
      status: result.status ?? 1,
      payload,
      stderr: String(result.stderr ?? ""),
    };
  }

  try {
    const payload = JSON.parse(String(result.stdout ?? "{}"));
    return {
      target,
      expect_pass: spec.expectPass,
      observed_pass: payload?.pass === true,
      pass: payload?.pass === spec.expectPass,
      status: 0,
      payload,
      stderr: String(result.stderr ?? ""),
    };
  } catch (error) {
    return {
      target,
      expect_pass: spec.expectPass,
      observed_pass: false,
      pass: false,
      status: 1,
      payload: null,
      stderr: `invalid JSON: ${error.message}`,
    };
  }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const checks = FIXTURES.map((spec) => runOne(spec));
    const pass = checks.every((item) => item.pass === true);
    const output = {
      ts: new Date().toISOString(),
      checks,
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      for (const item of checks) {
        console.log(`${item.pass ? "PASS" : "FAIL"} ${item.target} (expected=${item.expect_pass ? "pass" : "fail"} observed=${item.observed_pass ? "pass" : "fail"})`);
      }
      console.log(`Result: ${pass ? "PASS" : "FAIL"}`);
    }

    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
