import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { evaluateRepairRelation } from "../../core/workflow/repair-layer-policy.mjs";
import { resolveRuntimePath } from "./runtime-path-resolution.mjs";

const require = createRequire(import.meta.url);

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

function getDatabaseSync() {
  try {
    return require("node:sqlite").DatabaseSync;
  } catch (error) {
    throw new Error(`SQLite backend unavailable: ${error.message}`);
  }
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

function mapCycleFromContextRow(row) {
  return {
    cycle_id: row?.cycle_id ?? null,
    state: row?.cycle_state ?? null,
    outcome: row?.cycle_outcome ?? null,
    branch_name: row?.cycle_branch_name ?? null,
    updated_at: row?.cycle_updated_at ?? null,
  };
}

function mapSessionFromContextRow(row) {
  return {
    session_id: row?.session_id ?? null,
    branch_name: row?.session_branch_name ?? null,
    state: row?.session_state ?? null,
    owner: row?.session_owner ?? null,
    source_mode: row?.session_source_mode ?? null,
    source_confidence: Number(row?.session_source_confidence ?? 1),
  };
}

function openSqliteQueryContext(indexFile) {
  const DatabaseSync = getDatabaseSync();
  const absolute = path.resolve(process.cwd(), indexFile);
  if (!fs.existsSync(absolute)) {
    throw new Error(`SQLite index file not found: ${absolute}`);
  }
  return {
    absolute,
    db: new DatabaseSync(absolute),
  };
}

function querySessionCycleContextRows(db, whereSql, params) {
  return db.prepare(`
    SELECT *
    FROM v_session_cycle_context
    ${whereSql}
    ORDER BY confidence DESC, session_id ASC, cycle_id ASC, relation_type ASC
  `).all(...params);
}

function queryArtifactLinkContextRows(db, sourcePath) {
  return db.prepare(`
    SELECT *
    FROM v_artifact_link_context
    WHERE source_path = ?
    ORDER BY confidence DESC, target_path ASC, relation_type ASC
  `).all(sourcePath);
}

function queryArtifactByPath(db, artifactPath) {
  return db.prepare(`
    SELECT path, kind, family, subtype, cycle_id, session_id, source_mode, entity_confidence, updated_at
    FROM artifacts
    WHERE path = ?
  `).get(artifactPath) ?? null;
}

function queryLinkedSessionsByCycleIds(db, cycleIds) {
  if (!Array.isArray(cycleIds) || cycleIds.length === 0) {
    return [];
  }
  const placeholders = cycleIds.map(() => "?").join(", ");
  return db.prepare(`
    SELECT *
    FROM v_session_cycle_context
    WHERE cycle_id IN (${placeholders})
    ORDER BY confidence DESC, session_id ASC, cycle_id ASC, relation_type ASC
  `).all(...cycleIds);
}

function queryRelevantCyclesForSessionSqlite(db, args) {
  const sessionId = String(args.sessionId ?? "").trim();
  return querySessionCycleContextRows(db, "WHERE session_id = ?", [sessionId])
    .map((row) => ({ row, evaluation: usableRelation(row, args) }))
    .filter(({ evaluation }) => evaluation.usable)
    .map(({ row, evaluation }) => ({
      cycle: mapCycleFromContextRow(row),
      link: buildLinkView(row, evaluation),
    }));
}

function queryRelevantSessionsForCycleSqlite(db, args) {
  const cycleId = String(args.cycleId ?? "").trim();
  return querySessionCycleContextRows(db, "WHERE cycle_id = ?", [cycleId])
    .map((row) => ({ row, evaluation: usableRelation(row, args) }))
    .filter(({ evaluation }) => evaluation.usable)
    .map(({ row, evaluation }) => ({
      session: mapSessionFromContextRow(row),
      link: buildLinkView(row, evaluation),
    }));
}

function querySessionContinuitySqlite(db, args) {
  const sessionId = String(args.sessionId ?? "").trim();
  const continuityLinks = db.prepare(`
    SELECT *
    FROM v_session_link_context
    WHERE source_session_id = ? OR target_session_id = ?
    ORDER BY confidence DESC, source_session_id ASC, target_session_id ASC, relation_type ASC
  `).all(sessionId, sessionId)
    .map((row) => ({ row, evaluation: usableRelation(row, args) }))
    .filter(({ evaluation }) => evaluation.usable)
    .map(({ row, evaluation }) => ({
      direction: String(row?.source_session_id ?? "") === sessionId ? "outbound" : "inbound",
      related_session: {
        session_id: String(row?.source_session_id ?? "") === sessionId ? (row?.target_session_id ?? null) : (row?.source_session_id ?? null),
        branch_name: String(row?.source_session_id ?? "") === sessionId ? (row?.target_branch_name ?? null) : (row?.source_branch_name ?? null),
        state: String(row?.source_session_id ?? "") === sessionId ? (row?.target_state ?? null) : (row?.source_state ?? null),
      },
      link: buildLinkView(row, evaluation),
    }));
  const continuitySessionIds = Array.from(new Set([
    sessionId,
    ...continuityLinks.map((row) => String(row?.related_session?.session_id ?? "")).filter(Boolean),
  ]));
  const placeholders = continuitySessionIds.map(() => "?").join(", ");
  const continuityCycles = db.prepare(`
    SELECT *
    FROM v_session_cycle_context
    WHERE session_id IN (${placeholders})
    ORDER BY confidence DESC, session_id ASC, cycle_id ASC, relation_type ASC
  `).all(...continuitySessionIds)
    .map((row) => ({ row, evaluation: usableRelation(row, args) }))
    .filter(({ evaluation }) => evaluation.usable)
    .map(({ row, evaluation }) => ({
      cycle: mapCycleFromContextRow(row),
      link: buildLinkView(row, evaluation),
    }));
  const session = db.prepare(`
    SELECT session_id, branch_name, state, owner, parent_session, branch_kind, cycle_branch, intermediate_branch, integration_target_cycle, carry_over_pending
    FROM sessions
    WHERE session_id = ?
  `).get(sessionId) ?? null;
  return {
    session,
    continuity_links: continuityLinks,
    continuity_cycles: continuityCycles,
  };
}

function queryContextByArtifactSqlite(db, args, artifactPath) {
  const normalizedArtifactPath = String(artifactPath ?? "").replace(/\\/g, "/");
  const targetArtifact = queryArtifactByPath(db, normalizedArtifactPath);
  const linkedArtifactRows = queryArtifactLinkContextRows(db, normalizedArtifactPath)
    .map((row) => ({ row, evaluation: usableRelation(row, args) }))
    .filter(({ evaluation }) => evaluation.usable)
    .map(({ row, evaluation }) => ({
      artifact: {
        path: row?.target_path ?? null,
        kind: row?.target_kind ?? null,
        family: row?.target_family ?? null,
        subtype: row?.target_subtype ?? null,
        cycle_id: row?.target_cycle_id ?? null,
        session_id: row?.target_session_id ?? null,
        source_mode: row?.target_source_mode ?? null,
        entity_confidence: Number(row?.target_entity_confidence ?? 1),
        updated_at: row?.target_updated_at ?? null,
      },
      link: buildLinkView(row, evaluation),
    }));
  const linkedCycleIds = Array.from(new Set(
    linkedArtifactRows
      .map((row) => String(row?.artifact?.cycle_id ?? ""))
      .filter(Boolean),
  ));
  const linkedSessions = queryLinkedSessionsByCycleIds(db, linkedCycleIds)
    .map((row) => ({ row, evaluation: usableRelation(row, args) }))
    .filter(({ evaluation }) => evaluation.usable)
    .map(({ row, evaluation }) => ({
      session: mapSessionFromContextRow(row),
      link: buildLinkView(row, evaluation),
    }));
  return {
    artifact: targetArtifact,
    linked_artifacts: linkedArtifactRows,
    linked_sessions: linkedSessions,
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

function querySessionContinuity(payload, args) {
  const sessionId = String(args.sessionId ?? "").trim();
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  const sessionLinks = Array.isArray(payload?.session_links) ? payload.session_links : [];
  const sessionCycleLinks = Array.isArray(payload?.session_cycle_links) ? payload.session_cycle_links : [];
  const cycles = Array.isArray(payload?.cycles) ? payload.cycles : [];
  const sessionById = new Map(sessions.map((row) => [String(row?.session_id ?? ""), row]));
  const cycleById = new Map(cycles.map((row) => [String(row?.cycle_id ?? ""), row]));
  const continuityLinks = sessionLinks
    .filter((row) => String(row?.source_session_id ?? "") === sessionId || String(row?.target_session_id ?? "") === sessionId)
    .map((row) => ({ row, evaluation: usableRelation(row, args) }))
    .filter(({ evaluation }) => evaluation.usable)
    .map(({ row, evaluation }) => ({
      direction: String(row?.source_session_id ?? "") === sessionId ? "outbound" : "inbound",
      related_session: sessionById.get(
        String(row?.source_session_id ?? "") === sessionId
          ? String(row?.target_session_id ?? "")
          : String(row?.source_session_id ?? ""),
      ) ?? null,
      link: buildLinkView(row, evaluation),
    }));
  const continuitySessionIds = new Set([
    sessionId,
    ...continuityLinks.map((row) => String(row?.related_session?.session_id ?? "")).filter(Boolean),
  ]);
  const continuityCycles = sessionCycleLinks
    .filter((row) => continuitySessionIds.has(String(row?.session_id ?? "")))
    .map((row) => ({ row, evaluation: usableRelation(row, args) }))
    .filter(({ evaluation }) => evaluation.usable)
    .map(({ row, evaluation }) => ({
      cycle: cycleById.get(String(row?.cycle_id ?? "")) ?? null,
      link: buildLinkView(row, evaluation),
    }));
  return {
    session: sessionById.get(sessionId) ?? null,
    continuity_links: continuityLinks,
    continuity_cycles: continuityCycles,
  };
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
  if (args.query === "session-continuity") {
    return querySessionContinuity(payload, args);
  }
  throw new Error(`Unsupported repair-layer query: ${args.query}`);
}

function runRepairLayerQuerySqlite(db, args) {
  if (args.query === "relevant-cycles-for-session") {
    return queryRelevantCyclesForSessionSqlite(db, args);
  }
  if (args.query === "relevant-sessions-for-cycle") {
    return queryRelevantSessionsForCycleSqlite(db, args);
  }
  if (args.query === "baseline-context") {
    return queryContextByArtifactSqlite(db, args, "baseline/current.md");
  }
  if (args.query === "snapshot-context") {
    return queryContextByArtifactSqlite(db, args, "snapshots/context-snapshot.md");
  }
  if (args.query === "session-continuity") {
    return querySessionContinuitySqlite(db, args);
  }
  throw new Error(`Unsupported repair-layer query: ${args.query}`);
}

export function runRepairLayerQueryUseCase({ args, targetRoot }) {
  const indexFile = resolveRuntimePath(targetRoot, args.indexFile);
  const backend = detectBackend(indexFile, args.backend);
  let indexAbsolute = null;
  let result;
  if (backend === "sqlite") {
    const sqlite = openSqliteQueryContext(indexFile);
    indexAbsolute = sqlite.absolute;
    try {
      result = runRepairLayerQuerySqlite(sqlite.db, args);
    } finally {
      sqlite.db.close();
    }
  } else {
    const index = readJsonIndex(indexFile);
    indexAbsolute = index.absolute;
    result = runRepairLayerQuery(index.payload, args);
  }
  return {
    ts: new Date().toISOString(),
    target_root: targetRoot,
    index_file: indexAbsolute,
    backend,
    query: args.query,
    session_id: args.sessionId || null,
    cycle_id: args.cycleId || null,
    result,
  };
}
