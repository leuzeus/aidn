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

function runIndexSync(targetRoot, indexOutput, dryRun, includePayload = false) {
  const script = path.join(PERF_DIR, "index-sync.mjs");
  const cmd = [script, "--target", targetRoot, "--output", indexOutput, "--json"];
  if (dryRun) {
    cmd.push("--dry-run");
  }
  if (includePayload) {
    cmd.push("--include-payload");
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

function mapArtifactsByPath(payload) {
  const map = new Map();
  const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
  for (const artifact of artifacts) {
    const rel = String(artifact?.path ?? "").replace(/\\/g, "/");
    if (!rel) {
      continue;
    }
    if (!map.has(rel)) {
      map.set(rel, artifact);
    }
  }
  return map;
}

function compareArtifacts(expectedPayload, currentPayload) {
  const expectedMap = mapArtifactsByPath(expectedPayload);
  const currentMap = mapArtifactsByPath(currentPayload);
  const mismatches = [];
  let missingInIndex = 0;
  let staleInIndex = 0;
  let digestMismatch = 0;

  for (const [rel, expectedArtifact] of expectedMap.entries()) {
    const currentArtifact = currentMap.get(rel);
    if (!currentArtifact) {
      missingInIndex += 1;
      mismatches.push({
        type: "missing_in_index",
        path: rel,
        expected_sha256: String(expectedArtifact?.sha256 ?? ""),
        current_sha256: null,
      });
      continue;
    }
    const expectedSha = String(expectedArtifact?.sha256 ?? "");
    const currentSha = String(currentArtifact?.sha256 ?? "");
    if (expectedSha !== currentSha) {
      digestMismatch += 1;
      mismatches.push({
        type: "digest_mismatch",
        path: rel,
        expected_sha256: expectedSha,
        current_sha256: currentSha,
      });
    }
  }

  for (const [rel, currentArtifact] of currentMap.entries()) {
    if (expectedMap.has(rel)) {
      continue;
    }
    staleInIndex += 1;
    mismatches.push({
      type: "stale_in_index",
      path: rel,
      expected_sha256: null,
      current_sha256: String(currentArtifact?.sha256 ?? ""),
    });
  }

  mismatches.sort((a, b) => {
    const byPath = String(a.path).localeCompare(String(b.path));
    if (byPath !== 0) {
      return byPath;
    }
    return String(a.type).localeCompare(String(b.type));
  });

  return {
    mismatches,
    summary: {
      missing_in_index: missingInIndex,
      stale_in_index: staleInIndex,
      digest_mismatch: digestMismatch,
    },
  };
}

function buildReasonCodes(currentExists, digestMatch, summaryMismatches, artifactMismatchCount) {
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
  if (artifactMismatchCount > 0) {
    codes.push("ARTIFACT_MISMATCH");
  }
  return codes;
}

function toDriftLevel(reasonCodes, totalMismatchCount) {
  if (reasonCodes.length === 0) {
    return "none";
  }
  if (reasonCodes.includes("INDEX_FILE_MISSING") || totalMismatchCount >= 3) {
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
    const expected = runIndexSync(targetRoot, indexFilePath, true, true);
    const current = readIndex(indexFilePath);

    const summaryMismatches = current.exists
      ? compareSummary(expected.summary, current.payload)
      : [];
    const artifactCompare = current.exists
      ? compareArtifacts(expected.payload, current.payload)
      : { mismatches: [], summary: { missing_in_index: 0, stale_in_index: 0, digest_mismatch: 0 } };
    const digestMatch = current.exists && current.digest === expected.payload_digest;
    const artifactMismatchCount = artifactCompare.mismatches.length;
    const totalMismatchCount = summaryMismatches.length + artifactMismatchCount;
    const inSync = current.exists
      && digestMatch
      && summaryMismatches.length === 0
      && artifactMismatchCount === 0;
    const reasonCodes = buildReasonCodes(current.exists, digestMatch, summaryMismatches, artifactMismatchCount);
    const driftLevel = toDriftLevel(reasonCodes, totalMismatchCount);

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
      artifact_mismatches: artifactCompare.mismatches,
      artifact_summary: artifactCompare.summary,
      summary: {
        in_sync_numeric: inSync ? 1 : 0,
        index_exists_numeric: current.exists ? 1 : 0,
        digest_match_numeric: digestMatch ? 1 : 0,
        mismatch_count: summaryMismatches.length,
        artifact_mismatch_count: artifactMismatchCount,
        total_mismatch_count: totalMismatchCount,
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
      if (output.artifact_mismatches.length > 0) {
        console.log("Artifact mismatches:");
        for (const item of output.artifact_mismatches.slice(0, 20)) {
          console.log(`- ${item.type}: ${item.path}`);
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
