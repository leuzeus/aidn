#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

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
