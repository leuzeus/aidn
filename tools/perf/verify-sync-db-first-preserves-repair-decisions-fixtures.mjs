#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

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
  console.log("  node tools/perf/verify-sync-db-first-preserves-repair-decisions-fixtures.mjs");
}

function runJson(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const sourceTarget = path.resolve(process.cwd(), args.target);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-sync-repair-decisions-"));
    const workingCopy = path.join(tempRoot, "repo");
    fs.cpSync(sourceTarget, workingCopy, { recursive: true });
    fs.rmSync(path.join(workingCopy, ".aidn"), { recursive: true, force: true });

    const firstSync = runJson("tools/runtime/sync-db-first.mjs", [
      "--target",
      workingCopy,
      "--state-mode",
      "db-only",
      "--json",
    ]);
    const sqliteFile = String(
      firstSync?.repair_layer_result?.index_file
      ?? firstSync?.payload?.outputs?.find?.((row) => String(row?.backend ?? "").toLowerCase() === "sqlite")?.path
      ?? path.resolve(workingCopy, ".aidn/runtime/index/workflow-index.sqlite"),
    );
    const indexBackend = String(firstSync?.repair_layer_result?.index_backend ?? "").trim() || "sqlite";

    const resolve = runJson("tools/runtime/repair-layer-resolve.mjs", [
      "--target",
      workingCopy,
      "--index-file",
      sqliteFile,
      "--index-backend",
      indexBackend,
      "--session-id",
      "S102",
      "--cycle-id",
      "C101",
      "--decision",
      "accepted",
      "--apply",
      "--json",
    ]);

    const secondSync = runJson("tools/runtime/sync-db-first.mjs", [
      "--target",
      workingCopy,
      "--state-mode",
      "db-only",
      "--json",
    ]);

    const strictQuery = runJson("tools/runtime/repair-layer-query.mjs", [
      "--target",
      workingCopy,
      "--index-file",
      sqliteFile,
      "--backend",
      indexBackend,
      "--query",
      "relevant-sessions-for-cycle",
      "--cycle-id",
      "C101",
      "--json",
    ]);

    const rows = Array.isArray(strictQuery?.result) ? strictQuery.result : [];
    const accepted = rows.find((row) => String(row?.session?.session_id ?? "") === "S102");

    const checks = {
      first_sync_ok: firstSync.ok === true,
      resolve_applied: String(resolve?.action ?? "") === "applied",
      second_sync_ok: secondSync.ok === true,
      second_sync_repair_layer_skipped: String(secondSync?.repair_layer_result?.action ?? "") === "skipped",
      accepted_relation_preserved: String(accepted?.link?.ambiguity_status ?? "") === "accepted",
      accepted_relation_reason_preserved: String(accepted?.link?.usability?.reason ?? "") === "accepted_override",
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      working_copy: workingCopy,
      checks,
      samples: {
        second_sync_action: secondSync?.repair_layer_result?.action ?? null,
        accepted_relation: accepted ?? null,
      },
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${sourceTarget}`);
      for (const [name, value] of Object.entries(checks)) {
        console.log(`${value ? "PASS" : "FAIL"} ${name}`);
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
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
