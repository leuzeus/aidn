#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const PERF_DIR = path.dirname(fileURLToPath(import.meta.url));

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

function runIndexSync(targetRoot, indexOutput, dryRun) {
  const script = path.join(PERF_DIR, "index-sync.mjs");
  const cmd = [script, "--target", targetRoot, "--output", indexOutput, "--json"];
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

function buildReasonCodes(currentExists, digestMatch, summaryMismatches) {
  const codes = [];
  if (!currentExists) {
    codes.push("INDEX_FILE_MISSING");
  }
  if (!digestMatch) {
    codes.push("DIGEST_MISMATCH");
  }
  if (summaryMismatches.length > 0) {
    codes.push("SUMMARY_MISMATCH");
  }
  return codes;
}

function toDriftLevel(reasonCodes, mismatchCount) {
  if (reasonCodes.length === 0) {
    return "none";
  }
  if (reasonCodes.includes("INDEX_FILE_MISSING") || mismatchCount >= 3) {
    return "high";
  }
  return "low";
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
    const targetRoot = path.resolve(process.cwd(), args.target);
    const indexFilePath = resolveTargetPath(targetRoot, args.indexFile);
    const expected = runIndexSync(targetRoot, indexFilePath, true);
    const current = readIndex(indexFilePath);

    const summaryMismatches = current.exists
      ? compareSummary(expected.summary, current.payload)
      : [];
    const digestMatch = current.exists && current.digest === expected.payload_digest;
    const inSync = current.exists
      && digestMatch
      && summaryMismatches.length === 0;
    const reasonCodes = buildReasonCodes(current.exists, digestMatch, summaryMismatches);
    const driftLevel = toDriftLevel(reasonCodes, summaryMismatches.length);

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
      reason_codes: reasonCodes,
      drift_level: driftLevel,
      summary_mismatches: summaryMismatches,
      summary: {
        in_sync_numeric: inSync ? 1 : 0,
        index_exists_numeric: current.exists ? 1 : 0,
        digest_match_numeric: digestMatch ? 1 : 0,
        mismatch_count: summaryMismatches.length,
      },
      action: "none",
      apply_result: null,
    };

    if (!inSync && args.apply) {
      const applyOut = runIndexSync(targetRoot, indexFilePath, false);
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
      console.log(`Drift level: ${output.drift_level}`);
      console.log(`Reason codes: ${output.reason_codes.length > 0 ? output.reason_codes.join(", ") : "none"}`);
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
