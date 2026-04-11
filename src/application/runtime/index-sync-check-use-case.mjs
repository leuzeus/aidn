import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createLocalProcessAdapter } from "../../adapters/runtime/local-process-adapter.mjs";
import {
  buildIndexSyncCheckReasonCodes,
  resolveIndexSyncDriftLevel,
} from "../../core/workflow/index-sync-check-policy.mjs";
import { resolveRuntimeTargetPath } from "./runtime-path-service.mjs";
import { runWorkflowIndexSync } from "./workflow-runtime-service.mjs";
import { detectRuntimeSnapshotBackend, readRuntimeSnapshot } from "./runtime-snapshot-service.mjs";

function sortBy(rows, keyFn) {
  return [...rows].sort((a, b) => keyFn(a).localeCompare(keyFn(b)));
}

function toNumberOrNull(value) {
  if (value == null) {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toMtimeMs(value, updatedAt) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) {
    return Math.trunc(n / 1_000_000);
  }
  const parsed = Date.parse(updatedAt ?? "");
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeObject(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeObject(item));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
      out[key] = normalizeObject(value[key]);
    }
    return out;
  }
  return value;
}

function normalizeCanonical(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    try {
      return normalizeObject(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (typeof value === "object") {
    return normalizeObject(value);
  }
  return null;
}

function projectForDigest(payload) {
  const cycles = sortBy(Array.isArray(payload?.cycles) ? payload.cycles : [], (row) => String(row?.cycle_id ?? ""));
  const artifacts = sortBy(Array.isArray(payload?.artifacts) ? payload.artifacts : [], (row) => String(row?.path ?? ""));
  const fileMap = sortBy(Array.isArray(payload?.file_map) ? payload.file_map : [], (row) => `${row?.cycle_id ?? ""}::${row?.path ?? ""}`);
  const tags = sortBy(Array.isArray(payload?.tags) ? payload.tags : [], (row) => String(row?.tag ?? ""));
  const artifactTags = sortBy(Array.isArray(payload?.artifact_tags) ? payload.artifact_tags : [], (row) => `${row?.path ?? ""}::${row?.tag ?? ""}`);
  const runMetrics = sortBy(Array.isArray(payload?.run_metrics) ? payload.run_metrics : [], (row) => String(row?.run_id ?? ""));
  const structureKind = payload?.summary?.structure_kind
    ?? payload?.structure_profile?.kind
    ?? "unknown";

  return {
    schema_version: Number(payload?.schema_version ?? 1),
    cycles: cycles.map((row) => ({
      cycle_id: row?.cycle_id ?? null,
      session_id: row?.session_id ?? null,
      state: row?.state ?? "UNKNOWN",
      outcome: row?.outcome ?? null,
      branch_name: row?.branch_name ?? null,
      dor_state: row?.dor_state ?? null,
      continuity_rule: row?.continuity_rule ?? null,
      continuity_base_branch: row?.continuity_base_branch ?? null,
      continuity_latest_cycle_branch: row?.continuity_latest_cycle_branch ?? null,
      updated_at: row?.updated_at ?? null,
    })),
    artifacts: artifacts.map((row) => ({
      path: row?.path ?? null,
      kind: row?.kind ?? null,
      family: row?.family ?? "unknown",
      subtype: row?.subtype ?? null,
      gate_relevance: Number(row?.gate_relevance ?? 0),
      classification_reason: row?.classification_reason ?? null,
      content_format: row?.content_format ?? null,
      content: row?.content ?? null,
      canonical_format: row?.canonical_format ?? null,
      canonical: normalizeCanonical(row?.canonical),
      sha256: row?.sha256 ?? null,
      size_bytes: Number(row?.size_bytes ?? 0),
      mtime_ms: toMtimeMs(row?.mtime_ns, row?.updated_at),
      session_id: row?.session_id ?? null,
      cycle_id: row?.cycle_id ?? null,
      updated_at: row?.updated_at ?? null,
    })),
    file_map: fileMap.map((row) => ({
      cycle_id: row?.cycle_id ?? null,
      path: row?.path ?? null,
      role: row?.role ?? null,
      relation: row?.relation ?? "unknown",
      last_seen_at: row?.last_seen_at ?? null,
    })),
    tags: tags.map((row) => ({
      tag: row?.tag ?? null,
    })),
    artifact_tags: artifactTags.map((row) => ({
      path: row?.path ?? null,
      tag: row?.tag ?? null,
    })),
    run_metrics: runMetrics.map((row) => ({
      run_id: row?.run_id ?? null,
      started_at: row?.started_at ?? null,
      ended_at: row?.ended_at ?? null,
      overhead_ratio: toNumberOrNull(row?.overhead_ratio),
      artifacts_churn: toNumberOrNull(row?.artifacts_churn),
      gates_frequency: toNumberOrNull(row?.gates_frequency),
    })),
    summary: {
      cycles_count: cycles.length,
      artifacts_count: artifacts.length,
      file_map_count: fileMap.length,
      tags_count: tags.length,
      run_metrics_count: runMetrics.length,
      structure_kind: structureKind,
      artifacts_with_content_count: artifacts.filter((row) => typeof row?.content === "string").length,
      artifacts_with_canonical_count: artifacts.filter((row) => normalizeCanonical(row?.canonical) != null).length,
    },
  };
}

function digestPayload(payload) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(projectForDigest(payload)))
    .digest("hex");
}

function detectBackend(indexFile, backend) {
  return detectRuntimeSnapshotBackend(indexFile, backend);
}

function resolveFileProjectionPath(indexFilePath) {
  const absolute = path.resolve(process.cwd(), indexFilePath);
  if (absolute.toLowerCase().endsWith(".json")) {
    return absolute;
  }
  return path.join(path.dirname(absolute), `${path.basename(absolute, path.extname(absolute))}.json`);
}

async function readIndex(targetRoot, indexFilePath, indexBackend) {
  const backend = detectBackend(indexFilePath, indexBackend);
  const absolute = path.resolve(process.cwd(), indexFilePath);
  if (backend !== "postgres" && !fs.existsSync(absolute)) {
    return { exists: false, absolute, digest: null, payload: null, backend };
  }
  if (backend !== "json") {
    const out = await readRuntimeSnapshot({
      indexFile: absolute,
      backend,
      targetRoot,
    });
    return {
      exists: true,
      absolute: out.absolute,
      payload: out.payload,
      digest: digestPayload(out.payload),
      backend,
    };
  }
  const payload = JSON.parse(fs.readFileSync(absolute, "utf8"));
  return {
    exists: true,
    absolute,
    payload,
    digest: digestPayload(payload),
    backend,
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

export async function runIndexSyncCheckUseCase({ args, targetRoot, runtimeDir }) {
  const processAdapter = createLocalProcessAdapter();
  const indexFilePath = resolveRuntimeTargetPath(targetRoot, args.indexFile);
  const indexBackend = detectBackend(indexFilePath, args.indexBackend);
  const fileProjectionPath = resolveFileProjectionPath(indexFilePath);
  const expected = runWorkflowIndexSync({
    processAdapter,
    runtimeDir,
    targetRoot,
    store: indexBackend === "sqlite" ? "sqlite" : "file",
    output: indexBackend === "sqlite"
      ? fileProjectionPath
      : (indexBackend === "postgres" ? fileProjectionPath : indexFilePath),
    sqliteOutput: indexBackend === "sqlite" ? indexFilePath : "",
    dryRun: true,
    includePayload: true,
  });
  const expectedDigest = expected?.payload
    ? digestPayload(expected.payload)
    : String(expected?.payload_digest ?? "");
  const current = await readIndex(targetRoot, indexFilePath, indexBackend);

  const summaryMismatches = current.exists
    ? compareSummary(expected.summary, current.payload)
    : [];
  const artifactCompare = current.exists
    ? compareArtifacts(expected.payload, current.payload)
    : { mismatches: [], summary: { missing_in_index: 0, stale_in_index: 0, digest_mismatch: 0 } };
  const digestMatch = current.exists && current.digest === expectedDigest;
  const digestComparable = indexBackend !== "sqlite";
  const effectiveDigestMatch = digestComparable ? digestMatch : true;
  const artifactMismatchCount = artifactCompare.mismatches.length;
  const totalMismatchCount = summaryMismatches.length + artifactMismatchCount;
  const inSync = current.exists
    && effectiveDigestMatch
    && summaryMismatches.length === 0
    && artifactMismatchCount === 0;
  const reasonCodes = buildIndexSyncCheckReasonCodes({
    currentExists: current.exists,
    digestMatch,
    digestComparable,
    summaryMismatches,
    artifactMismatchCount,
  });
  const driftLevel = resolveIndexSyncDriftLevel(reasonCodes, totalMismatchCount);

  const output = {
    ts: new Date().toISOString(),
    target_root: targetRoot,
    expected: {
      digest: expectedDigest,
      summary: expected.summary,
      structure_profile: expected.structure_profile,
    },
    current: {
      exists: current.exists,
      index_file: current.absolute,
      index_backend: current.backend,
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
      digest_comparable_numeric: digestComparable ? 1 : 0,
      mismatch_count: summaryMismatches.length,
      artifact_mismatch_count: artifactMismatchCount,
      total_mismatch_count: totalMismatchCount,
    },
    action: "none",
    apply_result: null,
  };

  if (!inSync && args.apply) {
    const applyOut = runWorkflowIndexSync({
      processAdapter,
      runtimeDir,
      targetRoot,
      store: indexBackend === "sqlite" ? "sqlite" : "file",
      output: indexBackend === "sqlite"
        ? fileProjectionPath
        : (indexBackend === "postgres" ? fileProjectionPath : indexFilePath),
      sqliteOutput: indexBackend === "sqlite" ? indexFilePath : "",
    });
    output.action = "applied";
    output.apply_result = {
      writes: applyOut.writes ?? { files_written_count: 0, bytes_written: 0 },
      outputs: applyOut.outputs ?? [],
    };
  } else if (!inSync) {
    output.action = "drift_detected";
  }

  return output;
}
