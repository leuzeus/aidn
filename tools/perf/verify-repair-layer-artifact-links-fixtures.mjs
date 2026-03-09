#!/usr/bin/env node
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readIndexFromSqlite } from "../../src/lib/sqlite/index-sqlite-lib.mjs";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/perf-structure/session-rich",
    sqliteFile: ".aidn/runtime/index/fixtures/repair-layer-artifact-links/workflow-index.sqlite",
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
  console.log("  node tools/perf/verify-repair-layer-artifact-links-fixtures.mjs");
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
  try {
    const args = parseArgs(process.argv.slice(2));
    const target = path.resolve(process.cwd(), args.target);
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

    const payload = readIndexFromSqlite(sqliteFile).payload;
    const links = Array.isArray(payload.artifact_links) ? payload.artifact_links : [];
    const linkFor = (sourcePath, targetPath, relationType) => links.find((row) =>
      String(row?.source_path ?? "") === sourcePath
      && String(row?.target_path ?? "") === targetPath
      && String(row?.relation_type ?? "") === relationType);

    const checks = {
      support_artifact_links_status: Boolean(linkFor("cycles/C101-feature-alpha/notes.md", "cycles/C101-feature-alpha/status.md", "supports_artifact")),
      support_artifact_links_status_explicit: String(linkFor("cycles/C101-feature-alpha/notes.md", "cycles/C101-feature-alpha/status.md", "supports_artifact")?.source_mode ?? "") === "explicit",
      support_artifact_links_status_relation_status: String(linkFor("cycles/C101-feature-alpha/notes.md", "cycles/C101-feature-alpha/status.md", "supports_artifact")?.relation_status ?? "") === "explicit",
      support_artifact_supports_spec: Boolean(linkFor("cycles/C101-feature-alpha/notes.md", "SPEC.md", "supports_artifact")),
      baseline_references_status: Boolean(linkFor("baseline/current.md", "cycles/C101-feature-alpha/status.md", "references_artifact")),
      baseline_references_spec: Boolean(linkFor("baseline/current.md", "SPEC.md", "references_artifact")),
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
  }
}

main();
