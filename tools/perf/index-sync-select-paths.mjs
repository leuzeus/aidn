#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const VALID_TYPES = new Set(["missing_in_index", "digest_mismatch", "stale_in_index"]);

function parseArgs(argv) {
  const args = {
    target: ".",
    checkFile: ".aidn/runtime/index/index-sync-check.json",
    out: ".aidn/runtime/index/export-paths.txt",
    includeTypes: ["missing_in_index", "digest_mismatch"],
    maxPaths: 0,
    dryRun: false,
    strict: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--check-file") {
      args.checkFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--include-types") {
      const raw = String(argv[i + 1] ?? "").trim();
      i += 1;
      args.includeTypes = raw.length === 0
        ? []
        : raw.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
    } else if (token === "--max-paths") {
      const raw = String(argv[i + 1] ?? "").trim();
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--max-paths must be an integer >= 0");
      }
      args.maxPaths = Number(raw);
    } else if (token === "--dry-run") {
      args.dryRun = true;
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
  if (!args.checkFile) {
    throw new Error("Missing value for --check-file");
  }
  if (!args.out) {
    throw new Error("Missing value for --out");
  }
  for (const type of args.includeTypes) {
    if (!VALID_TYPES.has(type)) {
      throw new Error(`Invalid include type: ${type}. Expected missing_in_index|digest_mismatch|stale_in_index`);
    }
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/index-sync-select-paths.mjs --target ../client");
  console.log("  node tools/perf/index-sync-select-paths.mjs --target ../client --check-file .aidn/runtime/index/index-sync-check.json --out .aidn/runtime/index/export-paths.txt");
  console.log("  node tools/perf/index-sync-select-paths.mjs --include-types missing_in_index,digest_mismatch");
  console.log("  node tools/perf/index-sync-select-paths.mjs --include-types missing_in_index,digest_mismatch,stale_in_index --max-paths 200");
  console.log("  node tools/perf/index-sync-select-paths.mjs --json");
}

function resolveTargetPath(targetRoot, candidatePath) {
  if (path.isAbsolute(candidatePath)) {
    return candidatePath;
  }
  return path.resolve(targetRoot, candidatePath);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`JSON file not found: ${filePath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON file ${filePath}: ${error.message}`);
  }
}

function isSafeRelativePath(rel) {
  if (!rel || path.isAbsolute(rel)) {
    return false;
  }
  const normalized = rel.replace(/\\/g, "/");
  if (normalized.startsWith("../") || normalized.includes("/../") || normalized === "..") {
    return false;
  }
  return true;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const checkFilePath = resolveTargetPath(targetRoot, args.checkFile);
    const outPath = resolveTargetPath(targetRoot, args.out);
    const check = readJson(checkFilePath);
    const includeTypesSet = new Set(args.includeTypes);
    const mismatches = Array.isArray(check?.artifact_mismatches) ? check.artifact_mismatches : [];

    const selected = [];
    const seen = new Set();
    let skippedUnsafe = 0;
    for (const mismatch of mismatches) {
      const type = String(mismatch?.type ?? "");
      const rel = String(mismatch?.path ?? "").replace(/\\/g, "/");
      if (!includeTypesSet.has(type)) {
        continue;
      }
      if (!isSafeRelativePath(rel)) {
        skippedUnsafe += 1;
        continue;
      }
      if (seen.has(rel)) {
        continue;
      }
      seen.add(rel);
      selected.push(rel);
    }

    selected.sort((a, b) => a.localeCompare(b));
    const limited = args.maxPaths > 0 ? selected.slice(0, args.maxPaths) : selected;
    if (!args.dryRun) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, limited.length > 0 ? `${limited.join("\n")}\n` : "", "utf8");
    }

    const output = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      check_file: checkFilePath,
      out_file: outPath,
      dry_run: args.dryRun,
      strict: args.strict,
      include_types: args.includeTypes,
      max_paths: args.maxPaths,
      in_sync: check?.in_sync === true,
      drift_level: check?.drift_level ?? null,
      source_mismatches_count: mismatches.length,
      selected_paths_count: limited.length,
      selected_paths_dropped_by_limit: selected.length - limited.length,
      skipped_unsafe_paths: skippedUnsafe,
      selected_paths: limited,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Check file: ${output.check_file}`);
      console.log(`Out file: ${output.out_file}`);
      console.log(`In sync: ${output.in_sync ? "yes" : "no"}`);
      console.log(`Drift level: ${output.drift_level ?? "n/a"}`);
      console.log(`Selected paths: ${output.selected_paths_count}`);
      console.log(`Skipped unsafe paths: ${output.skipped_unsafe_paths}`);
      if (output.selected_paths_count > 0) {
        console.log("Selected sample:");
        for (const rel of output.selected_paths.slice(0, 20)) {
          console.log(`- ${rel}`);
        }
      }
    }

    if (args.strict && check?.in_sync !== true && output.selected_paths_count === 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
