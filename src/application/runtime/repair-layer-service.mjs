import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { deriveRepairRelationStatus, normalizeRepairConfidence, repairSourceModeRank } from "../../core/workflow/repair-layer-policy.mjs";
import { REPAIR_LAYER_ENGINE_VERSION } from "./repair-layer-payload-lib.mjs";

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

function extractMarkdownLinks(text) {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }
  const links = [];
  const pattern = /\[[^\]]*]\(([^)]+)\)/g;
  for (const match of text.matchAll(pattern)) {
    const raw = String(match[1] ?? "").trim();
    if (!raw || raw.startsWith("#") || /^[a-z]+:/i.test(raw)) {
      continue;
    }
    links.push(raw);
  }
  return Array.from(new Set(links));
}

function resolveArtifactLinkTarget(sourcePath, rawLink) {
  const normalized = String(rawLink ?? "").split("#", 1)[0].split("?", 1)[0].trim().replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/")) {
    return null;
  }
  const sourceDir = path.posix.dirname(String(sourcePath ?? "").replace(/\\/g, "/"));
  const resolved = path.posix.normalize(path.posix.join(sourceDir, normalized));
  if (resolved.startsWith("../")) {
    return null;
  }
  return resolved;
}

function extractSessionField(text, fieldName) {
  if (typeof text !== "string" || text.length === 0) {
    return null;
  }
  const pattern = new RegExp(`^[-*]?\\s*${fieldName}:\\s*` + "`?([^`\\n]+)`?", "im");
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

function hasSessionField(text, fieldName) {
  if (typeof text !== "string" || text.length === 0) {
    return false;
  }
  const pattern = new RegExp(`^[-*]?\\s*${fieldName}:\\s*`, "im");
  return pattern.test(text);
}

function extractSessionListField(text, fieldName, itemExtractor = (value) => splitEntityList(value)) {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }
  const lines = String(text).split(/\r?\n/);
  const items = [];
  const inlinePattern = new RegExp(`^[-*]?\\s*${fieldName}:\\s*(.*)$`, "i");
  let collecting = false;

  for (const line of lines) {
    const inlineMatch = line.match(inlinePattern);
    if (!collecting && inlineMatch) {
      const remainder = String(inlineMatch[1] ?? "").trim();
      if (remainder.length > 0) {
        items.push(...itemExtractor(remainder));
        break;
      }
      collecting = true;
      continue;
    }
    if (!collecting) {
      continue;
    }
    if (/^##\s+/.test(line) || /^[-*]?\s*[a-zA-Z0-9_]+:\s*/.test(line)) {
      break;
    }
    const bulletMatch = line.match(/^\s*-\s+(.+)$/);
    if (!bulletMatch) {
      continue;
    }
    items.push(...itemExtractor(String(bulletMatch[1] ?? "").trim()));
  }

  return Array.from(new Set(items.map((item) => String(item ?? "").trim()).filter(Boolean)));
}

function extractSessionMode(text) {
  if (typeof text !== "string" || text.length === 0) {
    return null;
  }
  if (/\[\s*x\s*\]\s*COMMITTING/i.test(text)) return "COMMITTING";
  if (/\[\s*x\s*\]\s*EXPLORING/i.test(text)) return "EXPLORING";
  if (/\[\s*x\s*\]\s*THINKING/i.test(text)) return "THINKING";
  return null;
}

function splitEntityList(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }
  const normalized = value.replace(/[`|]/g, " ").trim();
  if (/^none$/i.test(normalized)) {
    return [];
  }
  return normalized
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseSessionMetadata(text) {
  const sessionBranch = extractSessionField(text, "session_branch");
  const parentSession = extractSessionField(text, "parent_session");
  const branchKind = extractSessionField(text, "branch_kind");
  const cycleBranch = extractSessionField(text, "cycle_branch");
  const intermediateBranch = extractSessionField(text, "intermediate_branch");
  const integrationTargetCycleLegacy = extractSessionField(text, "integration_target_cycle");
  const integrationTargetCycles = extractSessionListField(text, "integration_target_cycles", (value) =>
    extractCycleIdsFromText(splitEntityList(value).join(" ")));
  const primaryFocusCycleRaw = extractSessionField(text, "primary_focus_cycle");
  const attachedCycles = extractSessionListField(text, "attached_cycles", (value) =>
    extractCycleIdsFromText(splitEntityList(value).join(" ")));
  const reportedCycles = extractSessionListField(text, "reported_from_previous_session", (value) =>
    extractCycleIdsFromText(splitEntityList(value).join(" ")));
  const carryOverPending = extractSessionField(text, "carry_over_pending");
  const sessionMode = extractSessionMode(text);
  const legacyIntegrationTargetCycles = extractCycleIdsFromText(splitEntityList(integrationTargetCycleLegacy).join(" "));
  const effectiveIntegrationTargetCycles = integrationTargetCycles.length > 0
    ? integrationTargetCycles
    : legacyIntegrationTargetCycles;
  const primaryFocusCycle = extractCycleIdsFromText(primaryFocusCycleRaw ?? "").at(0)
    ?? (effectiveIntegrationTargetCycles.length === 1 ? effectiveIntegrationTargetCycles[0] : null);
  const cycleBranchCycles = extractCycleIdsFromText([cycleBranch, intermediateBranch].filter(Boolean).join(" "));
  return {
    session_branch: sessionBranch,
    parent_session: parentSession,
    branch_kind: branchKind,
    cycle_branch: cycleBranch,
    intermediate_branch: intermediateBranch,
    integration_target_cycle: primaryFocusCycle ?? (legacyIntegrationTargetCycles.length === 1 ? integrationTargetCycleLegacy : null),
    integration_target_cycles: effectiveIntegrationTargetCycles,
    integration_target_cycles_declared: hasSessionField(text, "integration_target_cycles"),
    primary_focus_cycle: primaryFocusCycle,
    legacy_integration_target_cycle: integrationTargetCycleLegacy,
    legacy_multi_target_scalar: integrationTargetCycles.length === 0 && legacyIntegrationTargetCycles.length > 1,
    attached_cycles: attachedCycles,
    reported_cycles: reportedCycles,
    branch_cycles: cycleBranchCycles,
    carry_over_pending: carryOverPending,
    mode: sessionMode,
  };
}

function extractCycleIdFromDirName(cycleDirName) {
  const match = String(cycleDirName ?? "").match(/(C\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

function walkFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  const files = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
      }
    }
  }
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function readTrackedRepoPaths(targetRoot) {
  if (!targetRoot) {
    return null;
  }
  try {
    const stdout = execFileSync("git", ["-C", targetRoot, "ls-files", "-z", "--", "docs/audit/cycles"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return new Set(stdout
      .split("\0")
      .map((item) => item.trim().replace(/\\/g, "/"))
      .filter((item) => item.length > 0));
  } catch {
    return null;
  }
}

function collectLocalCycleStatusCandidates(auditRoot, targetRoot) {
  const cycleRoot = path.join(auditRoot, "cycles");
  const trackedRepoPaths = readTrackedRepoPaths(targetRoot);
  const candidatesById = new Map();

  for (const absolute of walkFiles(cycleRoot)) {
    const relativeAuditPath = path.relative(auditRoot, absolute).replace(/\\/g, "/");
    if (!/^cycles\/[^/]+\/status\.md$/i.test(relativeAuditPath)) {
      continue;
    }
    const parts = relativeAuditPath.split("/");
    const cycleId = extractCycleIdFromDirName(parts[1]);
    if (!cycleId) {
      continue;
    }
    const repoPath = `docs/audit/${relativeAuditPath}`;
    const gitTracking = trackedRepoPaths == null
      ? "unknown"
      : trackedRepoPaths.has(repoPath)
        ? "tracked"
        : "untracked";
    const current = candidatesById.get(cycleId) ?? [];
    current.push({
      cycle_id: cycleId,
      artifact_path: relativeAuditPath,
      repo_path: repoPath,
      git_tracking: gitTracking,
    });
    candidatesById.set(cycleId, current);
  }

  for (const rows of candidatesById.values()) {
    rows.sort((left, right) => {
      const trackingRank = (value) => (value === "tracked" ? 2 : value === "unknown" ? 1 : 0);
      const trackingDelta = trackingRank(right.git_tracking) - trackingRank(left.git_tracking);
      if (trackingDelta !== 0) {
        return trackingDelta;
      }
      return String(left.artifact_path).localeCompare(String(right.artifact_path));
    });
  }

  return candidatesById;
}

export function buildRepairLayerService({ auditRoot, targetRoot = null, artifacts, cycles, repairDecisions = [] }) {
  const now = new Date().toISOString();
  const sessionsMap = new Map();
  const artifactLinks = [];
  const sessionCycleLinks = [];
  const sessionLinks = [];
  const migrationFindings = [];
  const cycleStatusById = new Map();
  const sessionArtifactById = new Map();
  const artifactByPath = new Map();
  const knownArtifactPaths = new Set((Array.isArray(artifacts) ? artifacts : []).map((artifact) => artifact.path));
  const relationKeys = new Set();
  const sessionCycleLinkIndex = new Map();
  const sessionLinkIndex = new Map();
  const findingKeys = new Set();
  const decisionIndex = new Map();
  const localCycleStatusCandidatesById = collectLocalCycleStatusCandidates(auditRoot, targetRoot);

  for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
    if (artifact.kind === "cycle_status" && artifact.cycle_id) {
      cycleStatusById.set(artifact.cycle_id, artifact.path);
    }
    if (artifact.kind === "session" && artifact.session_id) {
      sessionArtifactById.set(artifact.session_id, artifact.path);
    }
    if (artifact?.path) {
      artifactByPath.set(artifact.path, artifact);
    }
  }

  for (const row of repairDecisions) {
    if (String(row?.relation_scope ?? "") !== "session_cycle_link") {
      continue;
    }
    const key = [
      "session_cycle_link",
      String(row?.source_ref ?? ""),
      String(row?.target_ref ?? ""),
      String(row?.relation_type ?? ""),
    ].join("::");
    decisionIndex.set(key, row);
  }

  function resolveCycleStatusReference(cycleId) {
    const normalizedCycleId = String(cycleId ?? "").trim().toUpperCase();
    const indexedPath = cycleStatusById.get(normalizedCycleId) ?? null;
    if (indexedPath) {
      return {
        cycle_id: normalizedCycleId,
        resolution_state: "indexed",
        indexed_artifact_path: indexedPath,
        local_artifact_path: indexedPath,
        git_tracking: "tracked",
      };
    }
    const localCandidates = localCycleStatusCandidatesById.get(normalizedCycleId) ?? [];
    if (localCandidates.length === 0) {
      return {
        cycle_id: normalizedCycleId,
        resolution_state: "missing",
        indexed_artifact_path: null,
        local_artifact_path: null,
        git_tracking: "missing",
      };
    }
    const preferred = localCandidates[0];
    return {
      cycle_id: normalizedCycleId,
      resolution_state: preferred.git_tracking === "tracked" ? "tracked_not_indexed" : "present_local_untracked",
      indexed_artifact_path: null,
      local_artifact_path: preferred.artifact_path,
      git_tracking: preferred.git_tracking,
    };
  }

  function addCycleReferenceFinding({
    cycleId,
    artifact,
    entityType,
    entityId,
    missingFindingType,
    missingMessagePrefix,
    localMessagePrefix,
    createdAt,
  }) {
    const resolution = resolveCycleStatusReference(cycleId);
    if (resolution.resolution_state === "indexed") {
      return resolution;
    }
    if (resolution.resolution_state === "tracked_not_indexed") {
      addFinding({
        migration_run_id: REPAIR_LAYER_ENGINE_VERSION,
        severity: "warning",
        finding_type: "UNINDEXED_CYCLE_STATUS_REFERENCE",
        entity_type: entityType,
        entity_id: entityId,
        artifact_path: artifact.path,
        referenced_cycle_id: cycleId,
        reference_resolution_state: resolution.resolution_state,
        local_artifact_path: resolution.local_artifact_path,
        git_tracking: resolution.git_tracking,
        message: `${localMessagePrefix} ${cycleId}; matching cycle status artifact ${resolution.local_artifact_path} exists locally and is tracked, but it is not visible in the current index.`,
        confidence: 0.9,
        suggested_action: "Refresh or rebuild the runtime index so the tracked cycle status artifact is materialized.",
        created_at: createdAt,
      });
      return resolution;
    }
    if (resolution.resolution_state === "missing") {
      addFinding({
        migration_run_id: REPAIR_LAYER_ENGINE_VERSION,
        severity: "warning",
        finding_type: missingFindingType,
        entity_type: entityType,
        entity_id: entityId,
        artifact_path: artifact.path,
        referenced_cycle_id: cycleId,
        reference_resolution_state: "missing",
        local_artifact_path: null,
        git_tracking: "missing",
        message: `${missingMessagePrefix} ${cycleId} but no matching cycle status artifact was found in the index or on disk.`,
        confidence: 0.9,
        suggested_action: "Add or restore the referenced cycle status artifact.",
        created_at: createdAt,
      });
      return resolution;
    }
    addFinding({
      migration_run_id: REPAIR_LAYER_ENGINE_VERSION,
      severity: "warning",
      finding_type: "UNTRACKED_CYCLE_STATUS_REFERENCE",
      entity_type: entityType,
      entity_id: entityId,
      artifact_path: artifact.path,
      referenced_cycle_id: cycleId,
      reference_resolution_state: resolution.resolution_state,
      local_artifact_path: resolution.local_artifact_path,
      git_tracking: resolution.git_tracking,
      message: `${localMessagePrefix} ${cycleId}; matching cycle status artifact ${resolution.local_artifact_path} exists locally, but it is not tracked/materialized in the current index.`,
      confidence: 0.85,
      suggested_action: "Track the local cycle status artifact and refresh the runtime index.",
      created_at: createdAt,
    });
    return resolution;
  }

  function inferArtifactRelationType(sourceArtifact, targetArtifact) {
    if ((sourceArtifact?.family ?? "") === "support" && (targetArtifact?.family ?? "") === "normative") {
      return "supports_artifact";
    }
    if (targetArtifact?.kind === "baseline") {
      return "references_baseline";
    }
    if (targetArtifact?.kind === "snapshot") {
      return "references_snapshot";
    }
    return "references_artifact";
  }

  function isPreferredSessionSource(candidate, current) {
    const candidateConfidence = normalizeRepairConfidence(candidate?.source_confidence, 0);
    const currentConfidence = normalizeRepairConfidence(current?.source_confidence, 0);
    if (candidateConfidence !== currentConfidence) {
      return candidateConfidence > currentConfidence;
    }
    const candidateRank = repairSourceModeRank(candidate?.source_mode);
    const currentRank = repairSourceModeRank(current?.source_mode);
    if (candidateRank !== currentRank) {
      return candidateRank > currentRank;
    }
    return Boolean(candidate?.source_artifact_path) && !current?.source_artifact_path;
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
    const preferRow = isPreferredSessionSource(row, previous);
      sessionsMap.set(row.session_id, {
        ...previous,
      branch_name: preferRow ? (row.branch_name ?? previous.branch_name ?? null) : (previous.branch_name ?? row.branch_name ?? null),
      state: preferRow ? (row.state ?? previous.state ?? null) : (previous.state ?? row.state ?? null),
      owner: preferRow ? (row.owner ?? previous.owner ?? null) : (previous.owner ?? row.owner ?? null),
      parent_session: preferRow ? (row.parent_session ?? previous.parent_session ?? null) : (previous.parent_session ?? row.parent_session ?? null),
      branch_kind: preferRow ? (row.branch_kind ?? previous.branch_kind ?? null) : (previous.branch_kind ?? row.branch_kind ?? null),
      cycle_branch: preferRow ? (row.cycle_branch ?? previous.cycle_branch ?? null) : (previous.cycle_branch ?? row.cycle_branch ?? null),
      intermediate_branch: preferRow ? (row.intermediate_branch ?? previous.intermediate_branch ?? null) : (previous.intermediate_branch ?? row.intermediate_branch ?? null),
      integration_target_cycle: preferRow ? (row.integration_target_cycle ?? previous.integration_target_cycle ?? null) : (previous.integration_target_cycle ?? row.integration_target_cycle ?? null),
      carry_over_pending: preferRow ? (row.carry_over_pending ?? previous.carry_over_pending ?? null) : (previous.carry_over_pending ?? row.carry_over_pending ?? null),
      started_at: preferRow ? (row.started_at ?? previous.started_at ?? null) : (previous.started_at ?? row.started_at ?? null),
      ended_at: preferRow ? (row.ended_at ?? previous.ended_at ?? null) : (previous.ended_at ?? row.ended_at ?? null),
      source_artifact_path: preferRow ? (row.source_artifact_path ?? previous.source_artifact_path ?? null) : (previous.source_artifact_path ?? row.source_artifact_path ?? null),
      source_confidence: Math.max(
        normalizeRepairConfidence(previous.source_confidence, 0),
        normalizeRepairConfidence(row.source_confidence, 0),
      ),
      source_mode: preferRow
        ? (row.source_mode ?? previous.source_mode ?? null)
        : (previous.source_mode ?? row.source_mode ?? null),
      updated_at: preferRow ? (row.updated_at ?? previous.updated_at ?? now) : (previous.updated_at ?? row.updated_at ?? now),
    });
  }

  function addSessionLink(row) {
    if (!row?.source_session_id || !row?.target_session_id || !row?.relation_type) {
      return;
    }
    const key = `${row.source_session_id}::${row.target_session_id}::${row.relation_type}`;
    const existingIndex = sessionLinkIndex.get(key);
    if (typeof existingIndex === "number") {
      const previous = sessionLinks[existingIndex];
      const candidatePreferred = isPreferredSessionSource({
        source_confidence: row.confidence,
        source_mode: row.source_mode,
      }, {
        source_confidence: previous?.confidence,
        source_mode: previous?.source_mode,
      });
      if (!candidatePreferred) {
        return;
      }
      sessionLinks[existingIndex] = {
        ...row,
        relation_status: row.relation_status ?? deriveRepairRelationStatus(row),
      };
      return;
    }
    sessionLinkIndex.set(key, sessionLinks.length);
    sessionLinks.push({
      ...row,
      relation_status: row.relation_status ?? deriveRepairRelationStatus(row),
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
    artifactLinks.push({
      ...row,
      relation_status: row.relation_status ?? deriveRepairRelationStatus(row),
    });
  }

  function addSessionCycleLink(row) {
    if (!row?.session_id || !row?.cycle_id || !row?.relation_type) {
      return;
    }
    const decisionKey = [
      "session_cycle_link",
      String(row?.session_id ?? ""),
      String(row?.cycle_id ?? ""),
      String(row?.relation_type ?? ""),
    ].join("::");
    const decision = decisionIndex.get(decisionKey) ?? null;
    const ambiguityStatus = String(row?.source_mode ?? "") === "ambiguous"
      ? (decision?.decision === "accepted"
        ? "accepted"
        : decision?.decision === "rejected"
          ? "rejected"
          : "open")
      : null;
    const relationStatus = ambiguityStatus === "accepted"
      ? "promoted"
      : ambiguityStatus === "rejected"
        ? "rejected"
        : row.relation_status ?? deriveRepairRelationStatus(row);
    const key = `session::${row.session_id}::${row.cycle_id}::${row.relation_type}`;
    const existingIndex = sessionCycleLinkIndex.get(key);
    if (typeof existingIndex === "number") {
      const previous = sessionCycleLinks[existingIndex];
      const candidatePreferred = isPreferredSessionSource({
        source_confidence: row.confidence,
        source_mode: row.source_mode,
      }, {
        source_confidence: previous?.confidence,
        source_mode: previous?.source_mode,
      });
      if (!candidatePreferred) {
        return;
      }
      sessionCycleLinks[existingIndex] = {
        ...row,
        relation_status: relationStatus,
        ambiguity_status: ambiguityStatus,
      };
      return;
    }
    relationKeys.add(key);
    sessionCycleLinkIndex.set(key, sessionCycleLinks.length);
    sessionCycleLinks.push({
      ...row,
      relation_status: relationStatus,
      ambiguity_status: ambiguityStatus,
    });
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
    const text = String(readTextArtifact(auditRoot, artifact.path) ?? "");
    for (const rawLink of extractMarkdownLinks(text)) {
      const targetPath = resolveArtifactLinkTarget(artifact.path, rawLink);
      if (!targetPath || !knownArtifactPaths.has(targetPath) || targetPath === artifact.path) {
        continue;
      }
      const targetArtifact = artifactByPath.get(targetPath);
      addArtifactLink({
        source_path: artifact.path,
        target_path: targetPath,
        relation_type: inferArtifactRelationType(artifact, targetArtifact),
        confidence: 1.0,
        inference_source: "markdown_explicit_link",
        source_mode: "explicit",
        updated_at: artifact.updated_at ?? now,
      });
    }

    if (artifact.kind === "session" && artifact.session_id) {
      const metadata = parseSessionMetadata(text);
      const attachedCycles = metadata.attached_cycles;
      const integrationTargetCycles = metadata.integration_target_cycles;
      const sessionBranch = metadata.session_branch ?? extractSessionField(text, "branch");
      const branchCycleCandidates = metadata.branch_cycles;
      const reportedCycles = metadata.reported_cycles;
      const explicitTopologyCycles = new Set([...attachedCycles, ...integrationTargetCycles]);
      const suppressImplicitAmbiguity = attachedCycles.length > 0 || metadata.integration_target_cycles_declared || metadata.legacy_multi_target_scalar;
      const implicitCandidateCycleSet = new Set([...branchCycleCandidates, ...reportedCycles]);
      const candidateCycleSet = new Set([...explicitTopologyCycles, ...implicitCandidateCycleSet]);
      addSession({
        session_id: artifact.session_id,
        branch_name: sessionBranch,
        state: metadata.mode,
        owner: artifact.session_id,
        parent_session: metadata.parent_session ?? null,
        branch_kind: metadata.branch_kind ?? null,
        cycle_branch: metadata.cycle_branch ?? null,
        intermediate_branch: metadata.intermediate_branch ?? null,
        integration_target_cycle: metadata.primary_focus_cycle ?? metadata.integration_target_cycle ?? null,
        carry_over_pending: metadata.carry_over_pending ?? null,
        started_at: null,
        ended_at: null,
        source_artifact_path: artifact.path,
        source_confidence: 1.0,
        source_mode: "explicit",
        updated_at: artifact.updated_at ?? now,
      });
      if (metadata.parent_session) {
        addSession({
          session_id: metadata.parent_session,
          branch_name: null,
          state: null,
          owner: metadata.parent_session,
          parent_session: null,
          branch_kind: null,
          cycle_branch: null,
          intermediate_branch: null,
          integration_target_cycle: null,
          carry_over_pending: null,
          started_at: null,
          ended_at: null,
          source_artifact_path: artifact.path,
          source_confidence: 0.6,
          source_mode: "inferred",
          updated_at: artifact.updated_at ?? now,
        });
        addSessionLink({
          source_session_id: artifact.session_id,
          target_session_id: metadata.parent_session,
          relation_type: "continues_from_session",
          confidence: 1.0,
          inference_source: "session_parent_session",
          source_mode: "explicit",
          updated_at: artifact.updated_at ?? now,
        });
        if (String(metadata.carry_over_pending ?? "").toLowerCase() === "yes") {
          addSessionLink({
            source_session_id: artifact.session_id,
            target_session_id: metadata.parent_session,
            relation_type: "carry_over_pending_from_session",
            confidence: 0.95,
            inference_source: "session_carry_over_pending",
            source_mode: "explicit",
            updated_at: artifact.updated_at ?? now,
          });
        }
        if (!sessionArtifactById.has(metadata.parent_session)) {
          addFinding({
            migration_run_id: REPAIR_LAYER_ENGINE_VERSION,
            severity: "info",
            finding_type: "UNRESOLVED_PARENT_SESSION",
            entity_type: "session",
            entity_id: artifact.session_id,
            artifact_path: artifact.path,
            message: `Session references parent session ${metadata.parent_session} but no session artifact was indexed.`,
            confidence: 0.8,
            suggested_action: "Add or restore the parent session artifact to improve continuity context.",
            created_at: artifact.updated_at ?? now,
          });
        }
      }
      if (metadata.legacy_multi_target_scalar) {
        addFinding({
          migration_run_id: REPAIR_LAYER_ENGINE_VERSION,
          severity: "info",
          finding_type: "SESSION_METADATA_NORMALIZATION_RECOMMENDED",
          entity_type: "session",
          entity_id: artifact.session_id,
          artifact_path: artifact.path,
          message: "Session uses comma-separated legacy integration_target_cycle; prefer integration_target_cycles for explicit multi-cycle topology.",
          confidence: 0.95,
          suggested_action: "Replace legacy integration_target_cycle with integration_target_cycles and optional primary_focus_cycle.",
          created_at: artifact.updated_at ?? now,
        });
      }
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
      if (!suppressImplicitAmbiguity && attachedCycles.length === 0 && implicitCandidateCycleSet.size === 1) {
        const [onlyCycleId] = Array.from(implicitCandidateCycleSet);
        addSessionCycleLink({
          session_id: artifact.session_id,
          cycle_id: onlyCycleId,
          relation_type: "attached_cycle",
          confidence: 0.85,
          inference_source: "session_branch_context",
          source_mode: "inferred",
          updated_at: artifact.updated_at ?? now,
        });
      }
      if (!suppressImplicitAmbiguity && attachedCycles.length === 0 && implicitCandidateCycleSet.size > 1) {
        const candidateCycleIds = Array.from(implicitCandidateCycleSet).sort((a, b) => a.localeCompare(b));
        for (const cycleId of candidateCycleIds) {
          addSessionCycleLink({
            session_id: artifact.session_id,
            cycle_id: cycleId,
            relation_type: "attached_cycle",
            confidence: 0.4,
            inference_source: "session_ambiguous_cycle_candidates",
            source_mode: "ambiguous",
            updated_at: artifact.updated_at ?? now,
          });
        }
        const effectiveCycleIds = candidateCycleIds.filter((cycleId) => {
          const decisionKey = [
            "session_cycle_link",
            String(artifact.session_id ?? ""),
            cycleId,
            "attached_cycle",
          ].join("::");
          return String(decisionIndex.get(decisionKey)?.decision ?? "").toLowerCase() !== "rejected";
        });
        if (effectiveCycleIds.length > 1) {
          addFinding({
            migration_run_id: REPAIR_LAYER_ENGINE_VERSION,
            severity: "warning",
            finding_type: "AMBIGUOUS_RELATION",
            entity_type: "session",
            entity_id: artifact.session_id,
            artifact_path: artifact.path,
            message: `Session has multiple candidate cycles: ${effectiveCycleIds.join(", ")}.`,
            confidence: 0.4,
            suggested_action: "Resolve attached_cycles or integration_target_cycles explicitly in the session artifact, and use primary_focus_cycle only when one local focus is required.",
            created_at: artifact.updated_at ?? now,
          });
        }
      }
      for (const cycleId of Array.from(candidateCycleSet).sort((a, b) => a.localeCompare(b))) {
        const resolution = resolveCycleStatusReference(cycleId);
        if (resolution.resolution_state === "indexed") {
          continue;
        }
        addCycleReferenceFinding({
          cycleId,
          artifact,
          entityType: "session",
          entityId: artifact.session_id,
          missingFindingType: "UNRESOLVED_SESSION_CYCLE",
          missingMessagePrefix: "Session references cycle",
          localMessagePrefix: "Session references cycle",
          createdAt: artifact.updated_at ?? now,
        });
      }
      for (const cycleId of reportedCycles) {
        addSessionCycleLink({
          session_id: artifact.session_id,
          cycle_id: cycleId,
          relation_type: "reported_from_previous_session",
          confidence: 0.8,
          inference_source: "session_reported_from_previous_session",
          source_mode: "explicit",
          updated_at: artifact.updated_at ?? now,
        });
      }
      for (const cycleId of integrationTargetCycles) {
        addSessionCycleLink({
          session_id: artifact.session_id,
          cycle_id: cycleId,
          relation_type: "integration_target_cycle",
          confidence: 0.95,
          inference_source: "session_integration_target_cycle",
          source_mode: "explicit",
          updated_at: artifact.updated_at ?? now,
        });
      }
      if (!sessionBranch || (!suppressImplicitAmbiguity && explicitTopologyCycles.size === 0)) {
        addFinding({
          migration_run_id: REPAIR_LAYER_ENGINE_VERSION,
          severity: "info",
          finding_type: "SESSION_PARTIAL_METADATA",
          entity_type: "session",
          entity_id: artifact.session_id,
          artifact_path: artifact.path,
          message: "Session artifact is missing session_branch or explicit multi-cycle topology metadata.",
          confidence: 1.0,
          suggested_action: "Complete session metadata with session_branch plus attached_cycles or integration_target_cycles.",
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
        migration_run_id: REPAIR_LAYER_ENGINE_VERSION,
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
        const resolution = resolveCycleStatusReference(cycleId);
        if (resolution.resolution_state !== "indexed") {
          addCycleReferenceFinding({
            cycleId,
            artifact,
            entityType: "artifact",
            entityId: artifact.path,
            missingFindingType: "UNRESOLVED_CYCLE_REFERENCE",
            missingMessagePrefix: "Artifact references cycle",
            localMessagePrefix: "Artifact references cycle",
            createdAt: artifact.updated_at ?? now,
          });
          continue;
        }
        addArtifactLink({
          source_path: artifact.path,
          target_path: resolution.indexed_artifact_path,
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
    session_links: sessionLinks.sort((a, b) => `${a.source_session_id}:${a.target_session_id}:${a.relation_type}`.localeCompare(`${b.source_session_id}:${b.target_session_id}:${b.relation_type}`)),
    migration_runs: [{
      migration_run_id: REPAIR_LAYER_ENGINE_VERSION,
      engine_version: REPAIR_LAYER_ENGINE_VERSION,
      started_at: latestObservedAt,
      ended_at: latestObservedAt,
      status: "completed",
      target_root: targetRoot,
      notes: "Deterministic projection-time repair layer.",
    }],
    migration_findings: migrationFindings.sort((a, b) => `${a.finding_type}:${a.entity_id ?? ""}:${a.artifact_path ?? ""}`.localeCompare(`${b.finding_type}:${b.entity_id ?? ""}:${b.artifact_path ?? ""}`)),
  };
}
