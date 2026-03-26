#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/perf-structure/session-rich",
    sqliteFile: ".aidn/runtime/index/workflow-index.sqlite",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--sqlite-file") {
      args.sqliteFile = String(argv[i + 1] ?? "").trim();
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
  console.log("  node tools/perf/verify-repair-layer-resolution-fixtures.mjs");
}

function runJson(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function resolveTargetPath(targetRoot, candidatePath) {
  if (path.isAbsolute(candidatePath)) {
    return candidatePath;
  }
  return path.resolve(targetRoot, candidatePath);
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const sourceTarget = path.resolve(process.cwd(), args.target);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-repair-resolution-"));
    const target = path.join(tempRoot, "repo");
    fs.cpSync(sourceTarget, target, { recursive: true });
    fs.rmSync(path.join(target, ".aidn"), { recursive: true, force: true });
    const sqliteFile = resolveTargetPath(target, args.sqliteFile);
    const sqliteFileArg = path.relative(process.cwd(), sqliteFile);

    runJson("tools/perf/index-sync.mjs", [
      "--target",
      target,
      "--store",
      "sqlite",
      "--sqlite-output",
      sqliteFile,
      "--json",
    ]);

    const accept = runJson("tools/runtime/repair-layer-resolve.mjs", [
      "--target",
      target,
      "--index-file",
      sqliteFileArg,
      "--index-backend",
      "sqlite",
      "--session-id",
      "S102",
      "--cycle-id",
      "C101",
      "--decision",
      "accepted",
      "--apply",
      "--json",
    ]);

    const strictAccepted = runJson("tools/runtime/repair-layer-query.mjs", [
      "--target",
      target,
      "--index-file",
      sqliteFileArg,
      "--backend",
      "sqlite",
      "--query",
      "relevant-sessions-for-cycle",
      "--cycle-id",
      "C101",
      "--json",
    ]);

    const strictOtherCycle = runJson("tools/runtime/repair-layer-query.mjs", [
      "--target",
      target,
      "--index-file",
      sqliteFileArg,
      "--backend",
      "sqlite",
      "--query",
      "relevant-sessions-for-cycle",
      "--cycle-id",
      "C102",
      "--json",
    ]);

    const reject = runJson("tools/runtime/repair-layer-resolve.mjs", [
      "--target",
      target,
      "--index-file",
      sqliteFileArg,
      "--index-backend",
      "sqlite",
      "--session-id",
      "S102",
      "--cycle-id",
      "C102",
      "--decision",
      "rejected",
      "--apply",
      "--json",
    ]);

    const strictRejected = runJson("tools/runtime/repair-layer-query.mjs", [
      "--target",
      target,
      "--index-file",
      sqliteFileArg,
      "--backend",
      "sqlite",
      "--query",
      "relevant-sessions-for-cycle",
      "--cycle-id",
      "C102",
      "--json",
    ]);

    const acceptedRow = Array.isArray(strictAccepted.result)
      ? strictAccepted.result.find((row) => String(row?.session?.session_id ?? "") === "S102")
      : null;
    const openAmbiguousOtherCycle = Array.isArray(strictOtherCycle.result)
      ? strictOtherCycle.result.find((row) =>
        String(row?.session?.session_id ?? "") === "S102"
        && String(row?.link?.relation_type ?? "") === "attached_cycle")
      : null;
    const rejectedAmbiguousRow = Array.isArray(strictRejected.result)
      ? strictRejected.result.find((row) =>
        String(row?.session?.session_id ?? "") === "S102"
        && String(row?.link?.relation_type ?? "") === "attached_cycle")
      : null;

    const checks = {
      accept_applied: String(accept?.action ?? "") === "applied",
      accept_marks_promoted: String(accept?.resolved_link?.relation_status ?? "") === "promoted",
      accept_marks_ambiguity_status: String(accept?.resolved_link?.ambiguity_status ?? "") === "accepted",
      strict_query_includes_accepted_s102: Boolean(acceptedRow),
      strict_query_accepted_reason_override: String(acceptedRow?.link?.usability?.reason ?? "") === "accepted_override",
      strict_query_other_cycle_excludes_open_ambiguity: !openAmbiguousOtherCycle,
      reject_applied: String(reject?.action ?? "") === "applied",
      reject_marks_rejected: String(reject?.resolved_link?.ambiguity_status ?? "") === "rejected",
      strict_query_rejected_excludes_s102: !rejectedAmbiguousRow,
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      target_root: target,
      sqlite_file: sqliteFile,
      checks,
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${target}`);
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
      const cleanup = removePathWithRetry(tempRoot);
      if (!cleanup.ok) {
        throw cleanup.error;
      }
    }
  }
}

main();
