import fs from "node:fs";
import path from "node:path";
import { readIndexFromSqlite } from "../../lib/sqlite/index-sqlite-lib.mjs";
import { evaluateRepairRelation } from "../../core/workflow/repair-layer-policy.mjs";

function resolveTargetPath(targetRoot, candidatePath) {
  if (!candidatePath) {
    return "";
  }
  if (path.isAbsolute(candidatePath)) {
    return path.resolve(candidatePath);
  }
  return path.resolve(targetRoot, candidatePath);
}

function detectBackend(indexFile, backend) {
  if (backend === "json" || backend === "sqlite") {
    return backend;
  }
  return String(indexFile).toLowerCase().endsWith(".sqlite") ? "sqlite" : "json";
}

function readJsonIndex(indexFile) {
  const absolute = path.resolve(process.cwd(), indexFile);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Index file not found: ${absolute}`);
  }
  const payload = JSON.parse(fs.readFileSync(absolute, "utf8"));
  return { absolute, payload };
}

function usableRelation(row, args) {
  return evaluateRepairRelation(row, {
    minConfidence: args.minRelationConfidence,
    relationThresholds: args.relationThresholds,
    allowAmbiguous: args.allowAmbiguousLinks,
  });
}

function buildLinkView(row, evaluation) {
  return {
    ...row,
    confidence: Number(row?.confidence ?? 1),
    relation_status: row?.relation_status ?? evaluation.relation_status,
    ambiguity_status: row?.ambiguity_status ?? evaluation.ambiguity_status ?? null,
    usability: {
      usable: evaluation.usable,
      reason: evaluation.reason,
      min_confidence: evaluation.min_confidence,
    },
  };
}

function queryRelevantCyclesForSession(payload, args) {
  const sessionId = String(args.sessionId ?? "").trim();
  const cycles = Array.isArray(payload?.cycles) ? payload.cycles : [];
  const links = Array.isArray(payload?.session_cycle_links) ? payload.session_cycle_links : [];
  const cycleById = new Map(cycles.map((row) => [String(row?.cycle_id ?? ""), row]));
  return links
    .filter((row) => String(row?.session_id ?? "") === sessionId)
    .map((row) => ({ row, evaluation: usableRelation(row, args) }))
    .filter(({ evaluation }) => evaluation.usable)
    .sort((left, right) => Number(right.row?.confidence ?? 0) - Number(left.row?.confidence ?? 0))
    .map(({ row, evaluation }) => ({
      cycle: cycleById.get(String(row?.cycle_id ?? "")) ?? null,
      link: buildLinkView(row, evaluation),
    }));
}

function queryRelevantSessionsForCycle(payload, args) {
  const cycleId = String(args.cycleId ?? "").trim();
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  const links = Array.isArray(payload?.session_cycle_links) ? payload.session_cycle_links : [];
  const sessionById = new Map(sessions.map((row) => [String(row?.session_id ?? ""), row]));
  return links
    .filter((row) => String(row?.cycle_id ?? "") === cycleId)
    .map((row) => ({ row, evaluation: usableRelation(row, args) }))
    .filter(({ evaluation }) => evaluation.usable)
    .sort((left, right) => Number(right.row?.confidence ?? 0) - Number(left.row?.confidence ?? 0))
    .map(({ row, evaluation }) => ({
      session: sessionById.get(String(row?.session_id ?? "")) ?? null,
      link: buildLinkView(row, evaluation),
    }));
}

function queryContextByArtifact(payload, args, artifactPath) {
  const normalizedArtifactPath = String(artifactPath ?? "").replace(/\\/g, "/");
  const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
  const artifactLinks = Array.isArray(payload?.artifact_links) ? payload.artifact_links : [];
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  const sessionLinks = Array.isArray(payload?.session_cycle_links) ? payload.session_cycle_links : [];
  const targetArtifact = artifacts.find((row) => String(row?.path ?? "").replace(/\\/g, "/") === normalizedArtifactPath) ?? null;
  const linkedArtifactRows = artifactLinks
    .filter((row) => String(row?.source_path ?? "").replace(/\\/g, "/") === normalizedArtifactPath)
    .map((row) => ({ row, evaluation: usableRelation(row, args) }))
    .filter(({ evaluation }) => evaluation.usable)
    .map(({ row, evaluation }) => ({
      artifact: artifacts.find((artifact) => String(artifact?.path ?? "").replace(/\\/g, "/") === String(row?.target_path ?? "").replace(/\\/g, "/")) ?? null,
      link: buildLinkView(row, evaluation),
    }));
  const linkedCycleIds = new Set(linkedArtifactRows.map((row) => String(row?.artifact?.cycle_id ?? "")).filter(Boolean));
  const linkedSessions = sessionLinks
    .filter((row) => linkedCycleIds.has(String(row?.cycle_id ?? "")))
    .map((row) => ({ row, evaluation: usableRelation(row, args) }))
    .filter(({ evaluation }) => evaluation.usable)
    .map(({ row, evaluation }) => ({
      session: sessions.find((session) => String(session?.session_id ?? "") === String(row?.session_id ?? "")) ?? null,
      link: buildLinkView(row, evaluation),
    }));
  return {
    artifact: targetArtifact,
    linked_artifacts: linkedArtifactRows,
    linked_sessions: linkedSessions,
  };
}

function runRepairLayerQuery(payload, args) {
  if (args.query === "relevant-cycles-for-session") {
    return queryRelevantCyclesForSession(payload, args);
  }
  if (args.query === "relevant-sessions-for-cycle") {
    return queryRelevantSessionsForCycle(payload, args);
  }
  if (args.query === "baseline-context") {
    return queryContextByArtifact(payload, args, "baseline/current.md");
  }
  if (args.query === "snapshot-context") {
    return queryContextByArtifact(payload, args, "snapshots/context-snapshot.md");
  }
  throw new Error(`Unsupported repair-layer query: ${args.query}`);
}

export function runRepairLayerQueryUseCase({ args, targetRoot }) {
  const indexFile = resolveTargetPath(targetRoot, args.indexFile);
  const backend = detectBackend(indexFile, args.backend);
  const index = backend === "sqlite"
    ? readIndexFromSqlite(indexFile)
    : readJsonIndex(indexFile);
  const result = runRepairLayerQuery(index.payload, args);
  return {
    ts: new Date().toISOString(),
    target_root: targetRoot,
    index_file: index.absolute,
    backend,
    query: args.query,
    session_id: args.sessionId || null,
    cycle_id: args.cycleId || null,
    result,
  };
}
