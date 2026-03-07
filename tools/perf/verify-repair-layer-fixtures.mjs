#!/usr/bin/env node
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readIndexFromSqlite } from "../../src/lib/sqlite/index-sqlite-lib.mjs";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/perf-structure/mixed",
    sqliteFile: ".aidn/runtime/index/fixtures/repair-layer/workflow-index.sqlite",
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
  if (!args.target || !args.sqliteFile) {
    throw new Error("Missing required argument values");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-repair-layer-fixtures.mjs");
  console.log("  node tools/perf/verify-repair-layer-fixtures.mjs --target tests/fixtures/perf-structure/mixed");
}

function runNoJson(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
  execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
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

    runNoJson("tools/perf/index-sync.mjs", [
      "--target",
      target,
      "--store",
      "sqlite",
      "--sqlite-output",
      sqliteFile,
    ]);

    const index = readIndexFromSqlite(sqliteFile);
    const payload = index.payload;
    const repairedArtifact = (Array.isArray(payload.artifacts) ? payload.artifacts : [])
      .find((artifact) => String(artifact?.path ?? "").replace(/\\/g, "/") === "cycles/C001/status.md");
    const findings = Array.isArray(payload.migration_findings) ? payload.migration_findings : [];
    const findingTypes = new Set(findings.map((row) => String(row?.finding_type ?? "")));
    const checks = {
      schema_version_v2: Number(payload.schema_version ?? 0) === 2,
      has_migration_run: Array.isArray(payload.migration_runs) && payload.migration_runs.length >= 1,
      has_legacy_cycle_dir_repaired: findingTypes.has("LEGACY_CYCLE_DIR_REPAIRED"),
      has_legacy_index_partial_relations: findingTypes.has("LEGACY_INDEX_PARTIAL_RELATIONS"),
      repaired_artifact_present: Boolean(repairedArtifact),
      repaired_artifact_source_mode: String(repairedArtifact?.source_mode ?? "") === "legacy_repaired",
      repaired_artifact_legacy_origin: String(repairedArtifact?.legacy_origin ?? "") === "legacy_cycle_dir",
      repaired_artifact_confidence: Number(repairedArtifact?.entity_confidence ?? 0) >= 0.7,
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      target_root: target,
      sqlite_file: sqliteFile,
      checks,
      repaired_artifact: repairedArtifact ?? null,
      finding_types: Array.from(findingTypes).sort((a, b) => a.localeCompare(b)),
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${output.target_root}`);
      console.log(`SQLite file: ${output.sqlite_file}`);
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
