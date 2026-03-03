#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const PERF_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {
    target: ".",
    indexFile: ".aidn/runtime/index/workflow-index.json",
    indexBackend: "auto",
    checkFile: ".aidn/runtime/index/index-sync-check.json",
    pathsFile: ".aidn/runtime/index/export-paths.txt",
    auditRoot: "docs/audit",
    includeTypes: "missing_in_index,digest_mismatch",
    maxPaths: 0,
    apply: true,
    strict: false,
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
    } else if (token === "--index-backend") {
      args.indexBackend = String(argv[i + 1] ?? "").toLowerCase();
      i += 1;
    } else if (token === "--check-file") {
      args.checkFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--paths-file") {
      args.pathsFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--audit-root") {
      args.auditRoot = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--include-types") {
      args.includeTypes = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--max-paths") {
      const raw = String(argv[i + 1] ?? "").trim();
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--max-paths must be an integer >= 0");
      }
      args.maxPaths = Number(raw);
    } else if (token === "--no-apply") {
      args.apply = false;
    } else if (token === "--strict") {
      args.strict = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  if (!["auto", "json", "sqlite"].includes(args.indexBackend)) {
    throw new Error("Invalid --index-backend. Expected auto|json|sqlite");
  }
  if (!args.indexFile || !args.checkFile || !args.pathsFile || !args.auditRoot) {
    throw new Error("Missing required path argument values");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/index-sync-reconcile.mjs --target ../client");
  console.log("  node tools/perf/index-sync-reconcile.mjs --target ../client --index-file .aidn/runtime/index/workflow-index.json");
  console.log("  node tools/perf/index-sync-reconcile.mjs --target ../client --index-file .aidn/runtime/index/workflow-index.sqlite --index-backend sqlite");
  console.log("  node tools/perf/index-sync-reconcile.mjs --target ../client --audit-root docs/audit --include-types missing_in_index,digest_mismatch,stale_in_index");
  console.log("  node tools/perf/index-sync-reconcile.mjs --target ../client --no-apply");
  console.log("  node tools/perf/index-sync-reconcile.mjs --json");
}

function resolveTargetPath(targetRoot, candidatePath) {
  if (path.isAbsolute(candidatePath)) {
    return candidatePath;
  }
  return path.resolve(targetRoot, candidatePath);
}

function runJson(scriptName, scriptArgs) {
  const file = path.join(PERF_DIR, scriptName);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function main() {
  try {
    const started = Date.now();
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const indexFilePath = resolveTargetPath(targetRoot, args.indexFile);
    const checkFilePath = resolveTargetPath(targetRoot, args.checkFile);
    const pathsFilePath = resolveTargetPath(targetRoot, args.pathsFile);
    const auditRootPath = resolveTargetPath(targetRoot, args.auditRoot);

    const initialCheck = runJson("index-sync-check.mjs", [
      "--target",
      targetRoot,
      "--index-file",
      indexFilePath,
      "--index-backend",
      args.indexBackend,
      "--json",
    ]);
    fs.mkdirSync(path.dirname(checkFilePath), { recursive: true });
    fs.writeFileSync(checkFilePath, `${JSON.stringify(initialCheck, null, 2)}\n`, "utf8");

    const selection = runJson("index-sync-select-paths.mjs", [
      "--target",
      targetRoot,
      "--check-file",
      checkFilePath,
      "--out",
      pathsFilePath,
      "--include-types",
      args.includeTypes,
      "--max-paths",
      String(args.maxPaths),
      "--json",
    ]);

    let applyCheck = null;
    if (initialCheck.in_sync !== true && args.apply) {
      applyCheck = runJson("index-sync-check.mjs", [
        "--target",
        targetRoot,
        "--index-file",
        indexFilePath,
        "--index-backend",
        args.indexBackend,
        "--apply",
        "--json",
      ]);
    }

    let exportResult = null;
    if (Number(selection.selected_paths_count ?? 0) > 0) {
      exportResult = runJson("index-export-files.mjs", [
        "--index-file",
        indexFilePath,
        "--backend",
        args.indexBackend,
        "--target",
        targetRoot,
        "--audit-root",
        auditRootPath,
        "--paths-file",
        pathsFilePath,
        "--json",
      ]);
    }

    const summary = {
      initial_in_sync: initialCheck.in_sync === true,
      initial_reason_codes: Array.isArray(initialCheck.reason_codes) ? initialCheck.reason_codes : [],
      selected_paths_count: Number(selection.selected_paths_count ?? 0),
      apply_executed: applyCheck != null,
      apply_action: applyCheck?.action ?? null,
      export_executed: exportResult != null,
      export_missing_content: Number(exportResult?.summary?.missing_content ?? 0),
      export_selected_filter_missing: Number(exportResult?.summary?.selected_paths_filter_missing_count ?? 0),
    };

    const pass = (summary.initial_in_sync || summary.apply_executed)
      && (!summary.export_executed || (summary.export_missing_content === 0 && summary.export_selected_filter_missing === 0));

    const output = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      files: {
        index_file: indexFilePath,
        index_backend: args.indexBackend,
        check_file: checkFilePath,
        paths_file: pathsFilePath,
        audit_root: auditRootPath,
      },
      strict: args.strict,
      apply: args.apply,
      include_types: args.includeTypes,
      max_paths: args.maxPaths,
      initial_check: initialCheck,
      selection,
      apply_check: applyCheck,
      export_result: exportResult,
      summary,
      pass,
      duration_ms: Date.now() - started,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${output.target_root}`);
      console.log(`Initial in sync: ${summary.initial_in_sync ? "yes" : "no"}`);
      console.log(`Selected paths: ${summary.selected_paths_count}`);
      console.log(`Apply executed: ${summary.apply_executed ? "yes" : "no"}`);
      console.log(`Export executed: ${summary.export_executed ? "yes" : "no"}`);
      if (summary.export_executed) {
        console.log(`Export missing content: ${summary.export_missing_content}`);
        console.log(`Export selected filter missing: ${summary.export_selected_filter_missing}`);
      }
      console.log(`Result: ${pass ? "PASS" : "FAIL"}`);
    }

    if (args.strict && !pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
