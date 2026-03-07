#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/perf-structure/session-rich",
    sqliteFile: ".aidn/runtime/index/fixtures/repair-layer-query/workflow-index.sqlite",
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
  console.log("  node tools/perf/verify-repair-layer-query-fixtures.mjs");
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
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-repair-query-"));
    const target = path.join(tempRoot, "repo");
    fs.cpSync(sourceTarget, target, { recursive: true });
    fs.rmSync(path.join(target, ".aidn"), { recursive: true, force: true });
    const sqliteFile = resolveTargetPath(target, args.sqliteFile);

    runJson("tools/perf/index-sync.mjs", [
      "--target",
      target,
      "--store",
      "sqlite",
      "--sqlite-output",
      sqliteFile,
      "--json",
    ]);

    const sessionStrict = runJson("tools/runtime/repair-layer-query.mjs", [
      "--target",
      target,
      "--index-file",
      sqliteFile,
      "--backend",
      "sqlite",
      "--query",
      "relevant-cycles-for-session",
      "--session-id",
      "S101",
      "--json",
    ]);

    const cycleStrict = runJson("tools/runtime/repair-layer-query.mjs", [
      "--target",
      target,
      "--index-file",
      sqliteFile,
      "--backend",
      "sqlite",
      "--query",
      "relevant-sessions-for-cycle",
      "--cycle-id",
      "C101",
      "--json",
    ]);

    const cycleRelaxed = runJson("tools/runtime/repair-layer-query.mjs", [
      "--target",
      target,
      "--index-file",
      sqliteFile,
      "--backend",
      "sqlite",
      "--query",
      "relevant-sessions-for-cycle",
      "--cycle-id",
      "C101",
      "--allow-ambiguous-links",
      "--relation-threshold",
      "attached_cycle=0.35",
      "--json",
    ]);

    const baseline = runJson("tools/runtime/repair-layer-query.mjs", [
      "--target",
      target,
      "--index-file",
      sqliteFile,
      "--backend",
      "sqlite",
      "--query",
      "baseline-context",
      "--json",
    ]);

    const checks = {
      session_query_returns_c101: Array.isArray(sessionStrict.result)
        && sessionStrict.result.some((row) => String(row?.cycle?.cycle_id ?? "") === "C101" && String(row?.link?.relation_status ?? "") === "explicit"),
      cycle_query_strict_has_s101: Array.isArray(cycleStrict.result)
        && cycleStrict.result.some((row) => String(row?.session?.session_id ?? "") === "S101"),
      cycle_query_strict_excludes_s102_ambiguous: Array.isArray(cycleStrict.result)
        && !cycleStrict.result.some((row) => String(row?.session?.session_id ?? "") === "S102"),
      cycle_query_relaxed_includes_s102_ambiguous: Array.isArray(cycleRelaxed.result)
        && cycleRelaxed.result.some((row) => String(row?.session?.session_id ?? "") === "S102" && String(row?.link?.relation_status ?? "") === "ambiguous"),
      baseline_context_links_c101: String(baseline?.result?.artifact?.path ?? "") === "baseline/current.md"
        && Array.isArray(baseline?.result?.linked_artifacts)
        && baseline.result.linked_artifacts.some((row) => String(row?.artifact?.cycle_id ?? "") === "C101"),
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
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
