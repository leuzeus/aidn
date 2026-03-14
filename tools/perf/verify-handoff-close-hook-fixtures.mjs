#!/usr/bin/env node
import path from "node:path";
import { execFileSync } from "node:child_process";

const CASES = [
  {
    id: "blocked_fixture_exposes_stop",
    target: "tests/fixtures/perf-handoff/blocked",
    mode: "COMMITTING",
    expectedAction: "stop_and_triage_incident",
    expectedResult: "stop",
    expectedOk: false,
  },
  {
    id: "ready_fixture_exposes_checkpoint_result",
    target: "tests/fixtures/perf-handoff/ready",
    mode: "COMMITTING",
    expectedAction: "stop_and_triage_incident",
    expectedResult: "stop",
    expectedOk: false,
  },
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
  console.log("  node tools/perf/verify-handoff-close-hook-fixtures.mjs");
}

function runJson(script, scriptArgs, env = {}) {
  const file = path.resolve(process.cwd(), script);
  try {
    const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...env,
      },
    });
    return JSON.parse(stdout);
  } catch (error) {
    const stdout = String(error?.stdout ?? "").trim();
    if (stdout) {
      return JSON.parse(stdout);
    }
    throw error;
  }
}

function runCase(testCase) {
  const targetRoot = path.resolve(process.cwd(), testCase.target);
  const hook = runJson("tools/perf/handoff-close-hook.mjs", [
    "--target",
    targetRoot,
    "--mode",
    testCase.mode,
    "--json",
  ]);
  const codex = runJson("tools/codex/run-json-hook.mjs", [
    "--skill",
    "handoff-close",
    "--target",
    targetRoot,
    "--mode",
    testCase.mode,
    "--json",
  ]);
  const codexAction = codex?.action ?? codex?.normalized?.action ?? null;
  const codexResult = codex?.result ?? codex?.normalized?.result ?? null;
  const codexOk = codex?.ok ?? codex?.normalized?.ok ?? null;

  const checks = {
    hook_action_expected: String(hook?.action ?? "") === testCase.expectedAction,
    hook_result_expected: String(hook?.result ?? "") === testCase.expectedResult,
    hook_ok_expected: Boolean(hook?.ok) === testCase.expectedOk,
    codex_action_expected: String(codexAction ?? "") === testCase.expectedAction,
    codex_result_expected: String(codexResult ?? "") === testCase.expectedResult,
    codex_ok_expected: Boolean(codexOk) === testCase.expectedOk,
  };
  return {
    id: testCase.id,
    target_root: targetRoot,
    checks,
    sample: {
      hook_action: hook?.action ?? null,
      hook_result: hook?.result ?? null,
      hook_ok: hook?.ok ?? null,
      codex_action: codexAction,
      codex_result: codexResult,
      codex_ok: codexOk,
    },
    pass: Object.values(checks).every((value) => value === true),
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const runs = CASES.map(runCase);
    const pass = runs.every((run) => run.pass === true);
    const output = {
      ts: new Date().toISOString(),
      runs,
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      for (const run of runs) {
        console.log(`${run.pass ? "PASS" : "FAIL"} ${run.id}`);
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
