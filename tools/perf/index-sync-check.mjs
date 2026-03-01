#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    target: ".",
    indexFile: ".aidn/runtime/index/workflow-index.json",
    apply: false,
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
    } else if (token === "--apply") {
      args.apply = true;
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
  if (!args.indexFile) {
    throw new Error("Missing value for --index-file");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/index-sync-check.mjs --target ../client-repo");
  console.log("  node tools/perf/index-sync-check.mjs --target ../client-repo --strict");
  console.log("  node tools/perf/index-sync-check.mjs --target ../client-repo --apply");
  console.log("  node tools/perf/index-sync-check.mjs --target ../client-repo --json");
}

function stableProjection(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  const clone = JSON.parse(JSON.stringify(payload));
  delete clone.generated_at;
  return clone;
}

function digestPayload(payload) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(stableProjection(payload)))
    .digest("hex");
}

function runIndexSync(targetRoot, dryRun) {
  const script = path.resolve(process.cwd(), "tools/perf/index-sync.mjs");
  const cmd = [script, "--target", targetRoot, "--json"];
  if (dryRun) {
    cmd.push("--dry-run");
  }
  const stdout = execFileSync(process.execPath, cmd, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function readIndex(indexFilePath) {
  const absolute = path.resolve(process.cwd(), indexFilePath);
  if (!fs.existsSync(absolute)) {
    return { exists: false, absolute, digest: null, payload: null };
  }
  const payload = JSON.parse(fs.readFileSync(absolute, "utf8"));
  return {
    exists: true,
    absolute,
    payload,
    digest: digestPayload(payload),
  };
}

function compareSummary(expectedSummary, currentPayload) {
  const current = currentPayload?.summary ?? {};
  const mismatches = [];
  const keys = [
    "cycles_count",
    "artifacts_count",
    "file_map_count",
    "tags_count",
    "run_metrics_count",
    "structure_kind",
  ];
  for (const key of keys) {
    const left = expectedSummary?.[key] ?? null;
    const right = current?.[key] ?? null;
    if (left !== right) {
      mismatches.push({
        key,
        expected: left,
        current: right,
      });
    }
  }
  return mismatches;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const expected = runIndexSync(targetRoot, true);
    const current = readIndex(args.indexFile);

    const summaryMismatches = current.exists
      ? compareSummary(expected.summary, current.payload)
      : [];
    const inSync = current.exists
      && current.digest === expected.payload_digest
      && summaryMismatches.length === 0;

    const output = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      expected: {
        digest: expected.payload_digest,
        summary: expected.summary,
        structure_profile: expected.structure_profile,
      },
      current: {
        exists: current.exists,
        index_file: current.absolute,
        digest: current.digest,
      },
      in_sync: inSync,
      summary_mismatches: summaryMismatches,
      action: "none",
      apply_result: null,
    };

    if (!inSync && args.apply) {
      const applyOut = runIndexSync(targetRoot, false);
      output.action = "applied";
      output.apply_result = {
        writes: applyOut.writes ?? { files_written_count: 0, bytes_written: 0 },
        outputs: applyOut.outputs ?? [],
      };
    } else if (!inSync) {
      output.action = "drift_detected";
    }

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${output.target_root}`);
      console.log(`Index file: ${output.current.index_file}`);
      console.log(`In sync: ${output.in_sync ? "yes" : "no"}`);
      console.log(`Expected digest: ${output.expected.digest}`);
      console.log(`Current digest: ${output.current.digest ?? "missing"}`);
      if (output.summary_mismatches.length > 0) {
        console.log("Summary mismatches:");
        for (const item of output.summary_mismatches) {
          console.log(`- ${item.key}: expected=${item.expected} current=${item.current}`);
        }
      }
      if (output.action === "applied") {
        console.log(
          `Apply: files_written=${output.apply_result.writes.files_written_count}, bytes_written=${output.apply_result.writes.bytes_written}`,
        );
      } else if (output.action === "drift_detected") {
        console.log("Apply: not executed (use --apply)");
      }
    }

    if (!output.in_sync && args.strict && !args.apply) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
