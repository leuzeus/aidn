#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SUPPORT_PREFIXES = ["reports/", "migration/", "backlog/", "incidents/"];

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/perf-structure/modern",
    indexFile: ".aidn/runtime/index/fixtures/support/workflow-index.json",
    sqlFile: ".aidn/runtime/index/fixtures/support/workflow-index.sql",
    sqliteFile: ".aidn/runtime/index/fixtures/support/workflow-index.sqlite",
    rebuildAuditRoot: ".aidn/runtime/index/fixtures/support/rebuild/docs/audit",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-file") {
      args.indexFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--sql-file") {
      args.sqlFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--sqlite-file") {
      args.sqliteFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--rebuild-audit-root") {
      args.rebuildAuditRoot = argv[i + 1] ?? "";
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
  if (!args.target || !args.indexFile || !args.sqlFile || !args.sqliteFile || !args.rebuildAuditRoot) {
    throw new Error("Missing required argument values");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-support-artifacts-fixtures.mjs");
  console.log("  node tools/perf/verify-support-artifacts-fixtures.mjs --target tests/fixtures/perf-structure/modern");
  console.log("  node tools/perf/verify-support-artifacts-fixtures.mjs --rebuild-audit-root .aidn/runtime/index/fixtures/support/rebuild/docs/audit");
}

function runJson(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
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

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const indexFilePath = resolveTargetPath(targetRoot, args.indexFile);
    const sqlFilePath = resolveTargetPath(targetRoot, args.sqlFile);
    const sqliteFilePath = resolveTargetPath(targetRoot, args.sqliteFile);
    const rebuildAuditRootPath = resolveTargetPath(targetRoot, args.rebuildAuditRoot);

    runNoJson("tools/perf/index-sync.mjs", [
      "--target",
      targetRoot,
      "--store",
      "all",
      "--no-content",
      "--output",
      indexFilePath,
      "--sql-output",
      sqlFilePath,
      "--sqlite-output",
      sqliteFilePath,
    ]);

    const indexPayload = readJsonFile(indexFilePath);
    const artifacts = Array.isArray(indexPayload?.artifacts) ? indexPayload.artifacts : [];
    const supportArtifacts = artifacts.filter((artifact) => {
      const rel = String(artifact?.path ?? "").replace(/\\/g, "/");
      return SUPPORT_PREFIXES.some((prefix) => rel.startsWith(prefix));
    });
    const coverageByPrefix = Object.fromEntries(
      SUPPORT_PREFIXES.map((prefix) => [
        prefix,
        supportArtifacts.filter((artifact) => String(artifact?.path ?? "").replace(/\\/g, "/").startsWith(prefix)).length,
      ]),
    );

    const rebuilt = runJson("tools/perf/index-export-files.mjs", [
      "--index-file",
      sqliteFilePath,
      "--backend",
      "sqlite",
      "--target",
      targetRoot,
      "--audit-root",
      rebuildAuditRootPath,
      "--json",
    ]);
    const rebuiltSecond = runJson("tools/perf/index-export-files.mjs", [
      "--index-file",
      sqliteFilePath,
      "--backend",
      "sqlite",
      "--target",
      targetRoot,
      "--audit-root",
      rebuildAuditRootPath,
      "--json",
    ]);
    const rebuiltThird = runJson("tools/perf/index-export-files.mjs", [
      "--index-file",
      sqliteFilePath,
      "--backend",
      "sqlite",
      "--target",
      targetRoot,
      "--audit-root",
      rebuildAuditRootPath,
      "--json",
    ]);

    const rebuiltSupportMissing = supportArtifacts
      .map((artifact) => String(artifact?.path ?? "").replace(/\//g, path.sep))
      .filter((rel) => !fs.existsSync(path.resolve(rebuildAuditRootPath, rel)));

    const checks = {
      support_artifacts_indexed: supportArtifacts.length,
      coverage_by_prefix: coverageByPrefix,
      support_artifacts_family_support: supportArtifacts.every((artifact) => String(artifact?.family ?? "") === "support"),
      support_artifacts_with_canonical: supportArtifacts.every((artifact) => artifact?.canonical && typeof artifact.canonical === "object"),
      rebuild_missing_content: Number(rebuilt?.summary?.missing_content ?? -1),
      rebuild_rendered_from_canonical: Number(rebuilt?.summary?.rendered_from_canonical ?? 0),
      rebuild_second_missing_content: Number(rebuiltSecond?.summary?.missing_content ?? -1),
      rebuild_second_unchanged: Number(rebuiltSecond?.summary?.unchanged ?? 0),
      rebuild_second_exported: Number(rebuiltSecond?.summary?.exported ?? 0),
      rebuild_second_incremental: Number(rebuiltSecond?.summary?.rendered_incremental_from_canonical ?? 0),
      rebuild_third_missing_content: Number(rebuiltThird?.summary?.missing_content ?? -1),
      rebuild_third_unchanged: Number(rebuiltThird?.summary?.unchanged ?? 0),
      rebuild_third_exported: Number(rebuiltThird?.summary?.exported ?? 0),
      rebuild_third_incremental: Number(rebuiltThird?.summary?.rendered_incremental_from_canonical ?? 0),
      rebuilt_support_missing_count: rebuiltSupportMissing.length,
    };
    const idempotentObservedSecond = checks.rebuild_second_exported === 0 && checks.rebuild_second_unchanged >= 1;
    const idempotentObservedThird = checks.rebuild_third_exported === 0 && checks.rebuild_third_unchanged >= 1;
    checks.idempotent_observed = idempotentObservedSecond || idempotentObservedThird;

    const pass = SUPPORT_PREFIXES.every((prefix) => Number(coverageByPrefix[prefix] ?? 0) >= 1)
      && checks.support_artifacts_family_support
      && checks.support_artifacts_with_canonical
      && checks.rebuild_missing_content === 0
      && checks.rebuild_second_missing_content === 0
      && checks.rebuild_third_missing_content === 0
      && checks.rebuild_second_incremental >= 1
      && checks.rebuild_third_incremental >= 1
      && checks.idempotent_observed
      && checks.rebuilt_support_missing_count === 0;

    const output = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      files: {
        index_file: indexFilePath,
        sql_file: sqlFilePath,
        sqlite_file: sqliteFilePath,
        rebuild_audit_root: rebuildAuditRootPath,
      },
      checks,
      missing_support_paths: rebuiltSupportMissing,
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${output.target_root}`);
      console.log(`Support artifacts indexed: ${checks.support_artifacts_indexed}`);
      for (const prefix of SUPPORT_PREFIXES) {
        console.log(`- ${prefix}: ${checks.coverage_by_prefix[prefix]}`);
      }
      console.log(`Family support: ${checks.support_artifacts_family_support ? "yes" : "no"}`);
      console.log(`Canonical present: ${checks.support_artifacts_with_canonical ? "yes" : "no"}`);
      console.log(`Rebuild missing content: ${checks.rebuild_missing_content}`);
      console.log(`Rebuild second missing content: ${checks.rebuild_second_missing_content}`);
      console.log(`Rebuild second unchanged: ${checks.rebuild_second_unchanged}`);
      console.log(`Rebuild second exported: ${checks.rebuild_second_exported}`);
      console.log(`Rebuild second incremental rendered: ${checks.rebuild_second_incremental}`);
      console.log(`Rebuild third missing content: ${checks.rebuild_third_missing_content}`);
      console.log(`Rebuild third unchanged: ${checks.rebuild_third_unchanged}`);
      console.log(`Rebuild third exported: ${checks.rebuild_third_exported}`);
      console.log(`Rebuild third incremental rendered: ${checks.rebuild_third_incremental}`);
      console.log(`Idempotent observed: ${checks.idempotent_observed ? "yes" : "no"}`);
      console.log(`Rebuilt support missing files: ${checks.rebuilt_support_missing_count}`);
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
