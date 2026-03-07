import fs from "node:fs";
import path from "node:path";

function readTextArtifact(auditRoot, relativePath) {
  const absolute = path.resolve(auditRoot, relativePath);
  try {
    return fs.readFileSync(absolute, "utf8");
  } catch {
    return null;
  }
}

function extractCycleIdsFromText(text) {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }
  const matches = text.match(/\bC\d+\b/gi) ?? [];
  return Array.from(new Set(matches.map((item) => item.toUpperCase()))).sort((a, b) => a.localeCompare(b));
}

function extractSessionIdsFromText(text) {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }
  const matches = text.match(/\bS\d+\b/gi) ?? [];
  return Array.from(new Set(matches.map((item) => item.toUpperCase()))).sort((a, b) => a.localeCompare(b));
}

function extractSessionField(text, fieldName) {
  if (typeof text !== "string" || text.length === 0) {
    return null;
  }
  const pattern = new RegExp(`^[-*]?\\s*${fieldName}:\\s*` + "`?([^`\\n]+)`?", "im");
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

export function buildRepairLayerService({ auditRoot, targetRoot = null, artifacts, cycles }) {
  const now = new Date().toISOString();
  const sessionsMap = new Map();
  const artifactLinks = [];
  const sessionCycleLinks = [];
  const migrationFindings = [];
  const cycleStatusById = new Map();
  const sessionArtifactById = new Map();
  const knownArtifactPaths = new Set((Array.isArray(artifacts) ? artifacts : []).map((artifact) => artifact.path));
  const relationKeys = new Set();
  const findingKeys = new Set();

  for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
    if (artifact.kind === "cycle_status" && artifact.cycle_id) {
      cycleStatusById.set(artifact.cycle_id, artifact.path);
    }
    if (artifact.kind === "session" && artifact.session_id) {
      sessionArtifactById.set(artifact.session_id, artifact.path);
    }
  }

  function addSession(row) {
    if (!row?.session_id) {
      return;
    }
    const previous = sessionsMap.get(row.session_id);
    if (!previous) {
      sessionsMap.set(row.session_id, row);
      return;
    }
    sessionsMap.set(row.session_id, {
      ...previous,
      branch_name: previous.branch_name ?? row.branch_name ?? null,
      state: previous.state ?? row.state ?? null,
      owner: previous.owner ?? row.owner ?? null,
      started_at: previous.started_at ?? row.started_at ?? null,
      ended_at: previous.ended_at ?? row.ended_at ?? null,
      source_artifact_path: previous.source_artifact_path ?? row.source_artifact_path ?? null,
      source_confidence: Math.max(Number(previous.source_confidence ?? 0), Number(row.source_confidence ?? 0)),
      source_mode: previous.source_mode === "explicit" ? "explicit" : row.source_mode ?? previous.source_mode,
      updated_at: previous.updated_at ?? row.updated_at ?? now,
    });
  }

  function addArtifactLink(row) {
    if (!row?.source_path || !row?.target_path || !row?.relation_type) {
      return;
    }
    if (!knownArtifactPaths.has(row.source_path) || !knownArtifactPaths.has(row.target_path)) {
      return;
    }
    const key = `${row.source_path}::${row.target_path}::${row.relation_type}`;
    if (relationKeys.has(key)) {
      return;
    }
    relationKeys.add(key);
    artifactLinks.push(row);
  }

  function addSessionCycleLink(row) {
    if (!row?.session_id || !row?.cycle_id || !row?.relation_type) {
      return;
    }
    const key = `session::${row.session_id}::${row.cycle_id}::${row.relation_type}`;
    if (relationKeys.has(key)) {
      return;
    }
    relationKeys.add(key);
    sessionCycleLinks.push(row);
  }

  function addFinding(row) {
    if (!row?.finding_type || !row?.message) {
      return;
    }
    const key = [
      row.finding_type,
      row.entity_type ?? "",
      row.entity_id ?? "",
      row.artifact_path ?? "",
      row.message,
    ].join("::");
    if (findingKeys.has(key)) {
      return;
    }
    findingKeys.add(key);
    migrationFindings.push(row);
  }

  for (const cycle of Array.isArray(cycles) ? cycles : []) {
    if (!cycle?.session_id) {
      continue;
    }
    const statusPath = cycleStatusById.get(cycle.cycle_id) ?? null;
    addSession({
      session_id: cycle.session_id,
      branch_name: cycle.branch_name ?? null,
      state: null,
      owner: cycle.session_id,
      started_at: null,
      ended_at: null,
      source_artifact_path: statusPath,
      source_confidence: 0.8,
      source_mode: "inferred",
      updated_at: cycle.updated_at ?? now,
    });
    addSessionCycleLink({
      session_id: cycle.session_id,
      cycle_id: cycle.cycle_id,
      relation_type: "attached_cycle",
      confidence: 0.9,
      inference_source: "cycle_status_session_owner",
      source_mode: "inferred",
      updated_at: cycle.updated_at ?? now,
    });
  }

  for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
    if (artifact.kind === "session" && artifact.session_id) {
      const text = readTextArtifact(auditRoot, artifact.path);
      const attachedCycles = extractCycleIdsFromText(extractSessionField(text, "attached_cycles"));
      const sessionBranch = extractSessionField(text, "session_branch") ?? extractSessionField(text, "branch");
      addSession({
        session_id: artifact.session_id,
        branch_name: sessionBranch,
        state: null,
        owner: artifact.session_id,
        started_at: null,
        ended_at: null,
        source_artifact_path: artifact.path,
        source_confidence: 1.0,
        source_mode: "explicit",
        updated_at: artifact.updated_at ?? now,
      });
      for (const cycleId of attachedCycles) {
        addSessionCycleLink({
          session_id: artifact.session_id,
          cycle_id: cycleId,
          relation_type: "attached_cycle",
          confidence: 1.0,
          inference_source: "session_attached_cycles",
          source_mode: "explicit",
          updated_at: artifact.updated_at ?? now,
        });
        const statusPath = cycleStatusById.get(cycleId);
        if (statusPath) {
          addArtifactLink({
            source_path: artifact.path,
            target_path: statusPath,
            relation_type: "supports_cycle",
            confidence: 0.9,
            inference_source: "session_attached_cycles",
            source_mode: "inferred",
            updated_at: artifact.updated_at ?? now,
          });
        }
      }
      if (!sessionBranch || attachedCycles.length === 0) {
        addFinding({
          migration_run_id: "repair-layer-v1",
          severity: "info",
          finding_type: "SESSION_PARTIAL_METADATA",
          entity_type: "session",
          entity_id: artifact.session_id,
          artifact_path: artifact.path,
          message: "Session artifact is missing session_branch or attached_cycles metadata.",
          confidence: 1.0,
          suggested_action: "Complete session metadata to improve inferred session and cycle links.",
          created_at: artifact.updated_at ?? now,
        });
      }
    }

    if (artifact.cycle_id) {
      const statusPath = cycleStatusById.get(artifact.cycle_id);
      if (statusPath && artifact.path !== statusPath) {
        addArtifactLink({
          source_path: artifact.path,
          target_path: statusPath,
          relation_type: "supports_cycle",
          confidence: artifact.family === "support" ? 0.6 : 0.85,
          inference_source: "cycle_directory_membership",
          source_mode: artifact.source_mode === "legacy_repaired" ? "legacy_repaired" : "inferred",
          updated_at: artifact.updated_at ?? now,
        });
      }
    }

    if (artifact.source_mode === "legacy_repaired" && artifact.cycle_id) {
      addFinding({
        migration_run_id: "repair-layer-v1",
        severity: "warning",
        finding_type: "LEGACY_CYCLE_DIR_REPAIRED",
        entity_type: "cycle",
        entity_id: artifact.cycle_id,
        artifact_path: artifact.path,
        message: "Legacy cycle directory naming was repaired from path ownership.",
        confidence: Number(artifact.entity_confidence ?? 0.7),
        suggested_action: "Normalize the cycle directory layout to modern naming.",
        created_at: artifact.updated_at ?? now,
      });
    }

    if (artifact.kind === "snapshot" || artifact.kind === "baseline") {
      const text = readTextArtifact(auditRoot, artifact.path);
      const referencedCycleIds = extractCycleIdsFromText(text);
      const referencedSessionIds = extractSessionIdsFromText(text);
      for (const cycleId of referencedCycleIds) {
        const statusPath = cycleStatusById.get(cycleId);
        if (!statusPath) {
          addFinding({
            migration_run_id: "repair-layer-v1",
            severity: "warning",
            finding_type: "UNRESOLVED_CYCLE_REFERENCE",
            entity_type: "artifact",
            entity_id: artifact.path,
            artifact_path: artifact.path,
            message: `Artifact references cycle ${cycleId} but no cycle status artifact was indexed.`,
            confidence: 0.9,
            suggested_action: "Add or restore the referenced cycle status artifact.",
            created_at: artifact.updated_at ?? now,
          });
          continue;
        }
        addArtifactLink({
          source_path: artifact.path,
          target_path: statusPath,
          relation_type: "summarizes_cycle",
          confidence: artifact.kind === "snapshot" ? 0.85 : 0.75,
          inference_source: artifact.kind === "snapshot" ? "snapshot_cycle_reference" : "baseline_cycle_reference",
          source_mode: "inferred",
          updated_at: artifact.updated_at ?? now,
        });
      }
      if (artifact.kind === "snapshot") {
        for (const sessionId of referencedSessionIds) {
          addSession({
            session_id: sessionId,
            branch_name: null,
            state: null,
            owner: sessionId,
            started_at: null,
            ended_at: null,
            source_artifact_path: artifact.path,
            source_confidence: 0.7,
            source_mode: "inferred",
            updated_at: artifact.updated_at ?? now,
          });
          for (const cycleId of referencedCycleIds) {
            addSessionCycleLink({
              session_id: sessionId,
              cycle_id: cycleId,
              relation_type: "active_in_snapshot",
              confidence: 0.8,
              inference_source: "snapshot_active_cycles",
              source_mode: "inferred",
              updated_at: artifact.updated_at ?? now,
            });
          }
        }
      }
      if (artifact.kind === "baseline") {
        for (const sessionId of referencedSessionIds) {
          addSession({
            session_id: sessionId,
            branch_name: null,
            state: null,
            owner: sessionId,
            started_at: null,
            ended_at: null,
            source_artifact_path: artifact.path,
            source_confidence: 0.6,
            source_mode: "inferred",
            updated_at: artifact.updated_at ?? now,
          });
          for (const cycleId of referencedCycleIds) {
            addSessionCycleLink({
              session_id: sessionId,
              cycle_id: cycleId,
              relation_type: "included_in_baseline",
              confidence: 0.7,
              inference_source: "baseline_included_cycles",
              source_mode: "inferred",
              updated_at: artifact.updated_at ?? now,
            });
          }
        }
      }
    }

    if (artifact.session_id) {
      const sessionArtifactPath = sessionArtifactById.get(artifact.session_id);
      if (sessionArtifactPath && artifact.path !== sessionArtifactPath && artifact.path.startsWith(`sessions/${artifact.session_id}`)) {
        addArtifactLink({
          source_path: artifact.path,
          target_path: sessionArtifactPath,
          relation_type: "supports_session",
          confidence: 0.8,
          inference_source: "session_directory_membership",
          source_mode: "inferred",
          updated_at: artifact.updated_at ?? now,
        });
      }
    }

    if (artifact.path === "cycles/cycle-status.md") {
      addFinding({
        migration_run_id: "repair-layer-v1",
        severity: "warning",
        finding_type: "LEGACY_INDEX_PARTIAL_RELATIONS",
        entity_type: "artifact",
        entity_id: artifact.path,
        artifact_path: artifact.path,
        message: "Legacy cycle-status index remains only partially relational.",
        confidence: 0.5,
        suggested_action: "Split the legacy cycle index into per-cycle status artifacts when possible.",
        created_at: artifact.updated_at ?? now,
      });
    }
  }

  const latestObservedAt = (Array.isArray(artifacts) ? artifacts : [])
    .map((artifact) => artifact.updated_at)
    .filter((value) => typeof value === "string" && value.length > 0)
    .sort((a, b) => a.localeCompare(b))
    .at(-1) ?? now;

  return {
    sessions: Array.from(sessionsMap.values()).sort((a, b) => String(a.session_id).localeCompare(String(b.session_id))),
    artifact_links: artifactLinks.sort((a, b) => `${a.source_path}:${a.target_path}:${a.relation_type}`.localeCompare(`${b.source_path}:${b.target_path}:${b.relation_type}`)),
    session_cycle_links: sessionCycleLinks.sort((a, b) => `${a.session_id}:${a.cycle_id}:${a.relation_type}`.localeCompare(`${b.session_id}:${b.cycle_id}:${b.relation_type}`)),
    migration_runs: [{
      migration_run_id: "repair-layer-v1",
      engine_version: "repair-layer-v1",
      started_at: latestObservedAt,
      ended_at: latestObservedAt,
      status: "completed",
      target_root: targetRoot,
      notes: "Deterministic projection-time repair layer.",
    }],
    migration_findings: migrationFindings.sort((a, b) => `${a.finding_type}:${a.entity_id ?? ""}:${a.artifact_path ?? ""}`.localeCompare(`${b.finding_type}:${b.entity_id ?? ""}:${b.artifact_path ?? ""}`)),
  };
}
