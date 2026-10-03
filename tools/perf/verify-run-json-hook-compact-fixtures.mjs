#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { removePathWithRetry, initGitRepo } from "./test-git-fixture-lib.mjs";
import { prepareActivationFixture } from "./test-activation-fixture-lib.mjs";
import { deriveGatingAction } from "../../src/core/gating/gating-policy.mjs";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/perf-structure/session-rich",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
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
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-run-json-hook-compact-fixtures.mjs");
}

function runRaw(script, scriptArgs, env = {}, expectStatus = 0) {
  const file = path.resolve(process.cwd(), script);
  const result = spawnSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
    },
  });
  if ((result.status ?? 1) !== expectStatus) {
    throw new Error([
      `Command failed: ${process.execPath} ${file} ${scriptArgs.join(" ")}`,
      `status=${result.status}`,
      String(result.stderr ?? "").trim(),
    ].filter(Boolean).join("\n"));
  }
  return String(result.stdout ?? "");
}

function runJson(script, scriptArgs, env = {}, expectStatus = 0) {
  return JSON.parse(runRaw(script, scriptArgs, env, expectStatus));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(Object(object), key);
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const sourceTarget = path.resolve(process.cwd(), args.target);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-run-json-hook-compact-"));
    const target = path.join(tempRoot, "repo");
    fs.cpSync(sourceTarget, target, { recursive: true });
    fs.rmSync(path.join(target, ".aidn"), { recursive: true, force: true });
    initGitRepo(target, { workingBranch: "fixture" });
    prepareActivationFixture(target);

    const baseArgs = [
      "--skill",
      "context-reload",
      "--mode",
      "THINKING",
      "--target",
      target,
      "--json",
    ];
    const compactText = runRaw("tools/codex/run-json-hook.mjs", baseArgs);
    const compact = JSON.parse(compactText);
    const verboseText = runRaw("tools/codex/run-json-hook.mjs", [...baseArgs, "--verbose"]);
    const verbose = JSON.parse(verboseText);
    const includeRaw = runJson("tools/codex/run-json-hook.mjs", [...baseArgs, "--include-raw"]);

    const reasonCases = [
      {
        name: "warning",
        payload: {
          ok: true,
          ...deriveGatingAction({ level2: { required: true }, level3: { required: false } }),
        },
        expectedReason: "L2_SIGNAL_TRIGGERED",
      },
      {
        name: "refusal",
        payload: {
          ok: false,
          ...deriveGatingAction({
            level2: { required: false },
            level3: { required: true, reason: "blocking_l1_reason" },
          }),
          error: { message: "A business refusal is not a command execution failure." },
        },
        expectedReason: "L3_BLOCKING",
      },
      {
        name: "no_gate_signal",
        payload: {
          ok: true,
          ...deriveGatingAction({ level2: { required: false }, level3: { required: false } }),
        },
        expectedReason: null,
      },
      {
        name: "explicit_diagnostic_without_status",
        payload: {
          ok: true,
          result: "warn",
          repair_layer_advice: "Review the explicit producer diagnostic.",
          repair_primary_reason: "Producer supplied a reason without a repair status.",
        },
        expectedReason: null,
      },
    ];
    const reasonChecks = {};
    for (const testCase of reasonCases) {
      for (const [mode, flags] of [["compact", []], ["verbose", ["--verbose"]], ["include_raw", ["--include-raw"]]]) {
        const output = runJson("tools/codex/run-json-hook.mjs", [
          ...baseArgs,
          ...flags,
          "--no-force-json",
          "--",
          process.execPath,
          "-e",
          `process.stdout.write(${JSON.stringify(JSON.stringify(testCase.payload))})`,
        ]);
        reasonChecks[`${testCase.name}_${mode}_reason_preserved`] = output.reason_code === testCase.expectedReason
          && output.normalized.reason_code === testCase.expectedReason
          && output.summary.reason_code === testCase.expectedReason;
        reasonChecks[`${testCase.name}_${mode}_result_preserved`] = output.result === testCase.payload.result
          && output.normalized.result === testCase.payload.result
          && output.summary.result === testCase.payload.result;
        reasonChecks[`${testCase.name}_${mode}_repair_diagnostics_preserved`] = output.summary.repair_layer_status === null
          && output.summary.repair_layer_advice === (testCase.payload.repair_layer_advice ?? null)
          && output.summary.repair_primary_reason === (testCase.payload.repair_primary_reason ?? null)
          && output.normalized.repair_layer_status === null;
      }
    }
    for (const [mode, flags] of [["compact", []], ["verbose", ["--verbose"]]]) {
      const output = runJson("tools/codex/run-json-hook.mjs", [
        ...baseArgs,
        ...flags,
        "--no-force-json",
        "--",
        process.execPath,
        "-e",
        "process.exitCode = 1",
      ]);
      reasonChecks[`command_failure_${mode}_reason_preserved`] = output.summary.reason_code === "HOOK_COMMAND_FAILED"
        && output.normalized.error != null
        && output.result === null
        && output.command_status === 1;
      reasonChecks[`command_failure_${mode}_unobserved_repair_stays_null`] = output.summary.repair_layer_status === null
        && output.summary.repair_layer_advice === null
        && output.summary.repair_primary_reason === null;
    }

    runJson("tools/perf/index-sync.mjs", [
      "--target",
      target,
      "--store",
      "sqlite",
      "--json",
    ]);
    const dbCompact = runJson("tools/codex/run-json-hook.mjs", [
      ...baseArgs,
      "--state-mode",
      "db-only",
      "--db-sync",
    ], {
      AIDN_INDEX_STORE_MODE: "sqlite",
    });

    const checks = {
      ...reasonChecks,
      compact_mode_default: compact.output_mode === "compact",
      compact_keeps_summary: compact.summary && typeof compact.summary === "object",
      compact_keeps_normalized_without_raw: compact.normalized
        && typeof compact.normalized === "object"
        && !hasOwn(compact.normalized, "raw"),
      compact_keeps_raw_reference: String(compact.raw_payload_ref ?? compact.raw_file ?? "").length > 0,
      verbose_mode_explicit: verbose.output_mode === "verbose",
      verbose_keeps_raw_payload: verbose.normalized
        && typeof verbose.normalized.raw === "object",
      include_raw_keeps_raw_payload: includeRaw.output_mode === "verbose"
        && includeRaw.normalized
        && typeof includeRaw.normalized.raw === "object",
      compact_smaller_than_verbose: Buffer.byteLength(compactText, "utf8") < Buffer.byteLength(verboseText, "utf8"),
      db_sync_payload_present: dbCompact.db_sync?.enabled === true
        && dbCompact.db_sync?.payload
        && typeof dbCompact.db_sync.payload === "object",
      db_sync_fast_path_decision_preserved: hasOwn(dbCompact.db_sync?.payload, "fast_path"),
      db_sync_repair_summary_preserved: dbCompact.db_sync?.payload?.repair_layer_result?.summary
        && typeof dbCompact.db_sync.payload.repair_layer_result.summary === "object",
      db_sync_triage_summary_preserved: dbCompact.db_sync?.payload?.repair_layer_triage_result?.triage?.summary
        && typeof dbCompact.db_sync.payload.repair_layer_triage_result.triage.summary === "object",
    };

    for (const [name, passed] of Object.entries(checks)) {
      assert(passed, `failed check: ${name}`);
    }

    const result = {
      ok: true,
      checks,
      byte_counts: {
        compact: Buffer.byteLength(compactText, "utf8"),
        verbose: Buffer.byteLength(verboseText, "utf8"),
      },
      sample: {
        output_mode: compact.output_mode,
        summary: compact.summary,
        db_sync_fast_path: dbCompact.db_sync?.payload?.fast_path ?? null,
      },
    };
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("PASS run-json-hook compact fixture checks");
      console.log(JSON.stringify(result, null, 2));
    }
  } finally {
    if (tempRoot) {
      removePathWithRetry(tempRoot);
    }
  }
}

main();
