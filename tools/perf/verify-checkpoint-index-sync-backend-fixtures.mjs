#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/repo-installed-core",
    tmpRoot: "tests/fixtures",
    keepTmp: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--tmp-root") {
      args.tmpRoot = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--keep-tmp") {
      args.keepTmp = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.target || !args.tmpRoot) {
    throw new Error("Missing required argument values");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-checkpoint-index-sync-backend-fixtures.mjs");
  console.log("  node tools/perf/verify-checkpoint-index-sync-backend-fixtures.mjs --target tests/fixtures/repo-installed-core");
  console.log("  node tools/perf/verify-checkpoint-index-sync-backend-fixtures.mjs --tmp-root tests/fixtures --keep-tmp");
}

function copyFixtureToTmp(source, tmpRoot) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const destination = path.resolve(tmpRoot, `tmp-checkpoint-sync-backend-${stamp}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
  return destination;
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
  let tmpTarget = null;
  let keepTmp = false;
  try {
    const args = parseArgs(process.argv.slice(2));
    keepTmp = args.keepTmp === true;
    const sourceTarget = path.resolve(process.cwd(), args.target);
    const tmpRoot = path.resolve(process.cwd(), args.tmpRoot);
    tmpTarget = copyFixtureToTmp(sourceTarget, tmpRoot);

    const dual = runJson("tools/perf/checkpoint.mjs", [
      "--target",
      tmpTarget,
      "--mode",
      "COMMITTING",
      "--index-store",
      "dual",
      "--index-sync-check",
      "--json",
    ]);
    const sqlite = runJson("tools/perf/checkpoint.mjs", [
      "--target",
      tmpTarget,
      "--mode",
      "COMMITTING",
      "--index-store",
      "sqlite",
      "--index-sync-check",
      "--json",
    ]);

    const checks = {
      dual_enabled: dual?.index_sync_check?.enabled === true,
      dual_backend_json: String(dual?.index_sync_check?.index_backend ?? "") === "json",
      dual_index_file_json: String(dual?.index_sync_check?.index_file ?? "").toLowerCase().endsWith("workflow-index.json"),
      dual_output_exists: fs.existsSync(String(dual?.index_sync_check?.output_file ?? "")),
      sqlite_enabled: sqlite?.index_sync_check?.enabled === true,
      sqlite_backend_sqlite: String(sqlite?.index_sync_check?.index_backend ?? "") === "sqlite",
      sqlite_index_file_sqlite: String(sqlite?.index_sync_check?.index_file ?? "").toLowerCase().endsWith("workflow-index.sqlite"),
      sqlite_output_exists: fs.existsSync(String(sqlite?.index_sync_check?.output_file ?? "")),
    };

    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      target_root: tmpTarget,
      checks,
      samples: {
        dual: {
          in_sync: dual?.index_sync_check?.in_sync ?? null,
          action: dual?.index_sync_check?.action ?? null,
          skipped: dual?.index_sync_check?.skipped ?? null,
        },
        sqlite: {
          in_sync: sqlite?.index_sync_check?.in_sync ?? null,
          action: sqlite?.index_sync_check?.action ?? null,
          skipped: sqlite?.index_sync_check?.skipped ?? null,
        },
      },
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${output.source_target}`);
      console.log(`Working copy: ${output.target_root}`);
      console.log(`Dual backend json: ${checks.dual_backend_json ? "yes" : "no"}`);
      console.log(`SQLite backend sqlite: ${checks.sqlite_backend_sqlite ? "yes" : "no"}`);
      console.log(`Result: ${pass ? "PASS" : "FAIL"}`);
    }

    if (!keepTmp) {
      fs.rmSync(tmpTarget, { recursive: true, force: true });
      tmpTarget = null;
    }

    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    if (tmpTarget != null && !keepTmp) {
      fs.rmSync(tmpTarget, { recursive: true, force: true });
    }
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
