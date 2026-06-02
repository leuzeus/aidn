import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  normalizeIndexStoreMode,
  normalizeStateMode,
  readAidnProjectConfig,
  resolveConfigIndexStore,
  resolveConfigRuntimePersistence,
  resolveConfigStateMode,
  stateModeFromIndexStore,
} from "../../lib/config/aidn-config-lib.mjs";
import {
  artifactRepairScore,
  evaluateRepairRelation,
  repairFindingPriorityScore,
  resolveRepairRelationThresholds,
} from "../../core/workflow/repair-layer-policy.mjs";
import { detectRuntimeSnapshotBackend, readRuntimeSnapshot } from "../runtime/runtime-snapshot-service.mjs";

function resolveTargetPath(targetRoot, candidate) {
  if (!candidate) {
    return "";
  }
  if (path.isAbsolute(candidate)) {
    return path.resolve(candidate);
  }
  return path.resolve(targetRoot, candidate);
}

function decodeArtifactContent(artifact) {
  if (typeof artifact?.content !== "string") {
    return null;
  }
  const format = String(artifact?.content_format ?? "utf8").toLowerCase();
  if (format === "utf8") {
    return Buffer.from(artifact.content, "utf8");
  }
  if (format === "base64") {
    return Buffer.from(artifact.content, "base64");
  }
  return null;
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function classifySelectionTier(reasons = []) {
  const set = new Set(Array.isArray(reasons) ? reasons : []);
  if (
    set.has("priority_artifact")
    || set.has("active_cycle_status")
    || set.has("repair_finding_artifact")
    || set.has("repair_finding_session")
    || set.has("repair_finding_cycle_status")
  ) {
    return "active";
  }
  if (
    set.has("linked_from_snapshot_or_baseline")
    || set.has("related_session")
    || set.has("continuity_session")
    || set.has("continuity_cycle_status")
    || set.has("latest_session_fallback")
  ) {
    return "continuity";
  }
  return "history";
}

function countSelectedArtifacts(selected, omittedCount, targetBytes, hardLimitBytes, maxArtifactBytes, maxArtifacts) {
  const totalBytes = Buffer.byteLength(JSON.stringify({ artifacts: selected }), "utf8");
  return {
    budget_status: totalBytes <= targetBytes ? "within-target" : "over-target",
    selected_count: selected.length,
    metadata_only_count: selected.filter((artifact) => artifact.content_state === "metadata_only").length,
    truncated_count: selected.filter((artifact) => artifact.content_state === "truncated").length,
    omitted_count: omittedCount,
    total_bytes: totalBytes,
    target_bytes: targetBytes,
    hard_limit_bytes: hardLimitBytes,
    max_artifact_bytes: maxArtifactBytes,
    max_artifacts: maxArtifacts,
  };
}

function enforceHardArtifactBudget(selected, omittedCount, targetBytes, hardLimitBytes, maxArtifactBytes, maxArtifacts) {
  const tierOrder = new Map([
    ["history", 0],
    ["continuity", 1],
    ["active", 2],
  ]);
  let budget = countSelectedArtifacts(selected, omittedCount, targetBytes, hardLimitBytes, maxArtifactBytes, maxArtifacts);
  if (budget.total_bytes <= hardLimitBytes) {
    return budget;
  }
  const candidates = selected
    .filter((artifact) => typeof artifact.content_excerpt === "string" && artifact.content_excerpt.length > 0)
    .sort((left, right) => {
      const tierDelta = Number(tierOrder.get(left.selection_tier) ?? 0) - Number(tierOrder.get(right.selection_tier) ?? 0);
      if (tierDelta !== 0) {
        return tierDelta;
      }
      return Number(left.selection_score ?? 0) - Number(right.selection_score ?? 0);
    });
  for (const artifact of candidates) {
    artifact.content_excerpt = null;
    artifact.content_state = "metadata_only";
    artifact.excerpt_bytes = 0;
    artifact.budget_trimmed = true;
    budget = countSelectedArtifacts(selected, omittedCount, targetBytes, hardLimitBytes, maxArtifactBytes, maxArtifacts);
    if (budget.total_bytes <= hardLimitBytes) {
      return {
        ...budget,
        budget_status: "hard-limit-trimmed",
      };
    }
  }
  return {
    ...budget,
    budget_status: "hard-limit-exceeded",
  };
}

function resolveArtifactSnapshotBackend(indexFile, backend, configData) {
  const configPersistence = resolveConfigRuntimePersistence(configData);
  const requested = String(backend ?? "").trim().toLowerCase();
  if (requested === "auto" && configPersistence?.backend) {
    return {
      backend: configPersistence.backend,
      connectionRef: configPersistence.connectionRef ?? "",
    };
  }
  const resolvedBackend = detectRuntimeSnapshotBackend(indexFile, backend);
  return {
    backend: resolvedBackend,
    connectionRef: resolvedBackend === "postgres" ? (configPersistence?.connectionRef ?? "") : "",
  };
}

function readJsonIndex(indexFile) {
  const absolute = path.resolve(process.cwd(), indexFile);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Index file not found: ${absolute}`);
  }
  const payload = JSON.parse(fs.readFileSync(absolute, "utf8"));
  return { absolute, payload };
}

function pushLimited(list, value, limit = 12) {
  if (!Array.isArray(list) || list.length >= limit) {
    return;
  }
  list.push(value);
}

function selectArtifacts(payload, maxArtifactBytes, options = {}) {
  const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
  const artifactLinks = Array.isArray(payload?.artifact_links) ? payload.artifact_links : [];
  const sessionCycleLinks = Array.isArray(payload?.session_cycle_links) ? payload.session_cycle_links : [];
  const sessionLinks = Array.isArray(payload?.session_links) ? payload.session_links : [];
  const migrationFindings = Array.isArray(payload?.migration_findings) ? payload.migration_findings : [];
  const relationThresholds = resolveRepairRelationThresholds({
    minConfidence: options.minRelationConfidence,
    relationThresholds: options.relationThresholds,
  });
  const maxArtifacts = Math.max(1, Math.floor(Number(options.maxArtifacts ?? 24)));
  const targetBytes = Math.max(8192, Math.floor(Number(options.bundleTargetBytes ?? 262144)));
  const hardLimitBytes = Math.max(targetBytes, Math.floor(Number(options.bundleHardLimitBytes ?? 1048576)));
  const relationEvaluation = {
    thresholds: relationThresholds,
    accepted_count: 0,
    rejected_count: 0,
    accepted_by_type: {},
    rejected_by_reason: {},
    accepted_samples: [],
    rejected_samples: [],
  };
  const priority = new Set([
    "baseline/current.md",
    "snapshots/context-snapshot.md",
    "WORKFLOW.md",
    "SPEC.md",
  ]);
  const findingsByArtifactPath = new Map();
  const findingCycleIds = new Set();
  const findingSessionIds = new Set();
  const prioritizedFindings = [];
  for (const row of migrationFindings) {
    const severity = String(row?.severity ?? "").toLowerCase();
    if (!["warning", "error"].includes(severity)) {
      continue;
    }
    const priorityScore = repairFindingPriorityScore(row);
    prioritizedFindings.push({
      severity: row?.severity ?? null,
      finding_type: row?.finding_type ?? null,
      entity_type: row?.entity_type ?? null,
      entity_id: row?.entity_id ?? null,
      artifact_path: row?.artifact_path ?? null,
      message: row?.message ?? null,
      confidence: Number(row?.confidence ?? 0),
      priority_score: priorityScore,
    });
    const artifactPath = String(row?.artifact_path ?? "").replace(/\\/g, "/");
    if (artifactPath) {
      const list = findingsByArtifactPath.get(artifactPath) ?? [];
      list.push({ ...row, priority_score: priorityScore });
      findingsByArtifactPath.set(artifactPath, list);
    }
    const entityType = String(row?.entity_type ?? "").toLowerCase();
    const entityId = String(row?.entity_id ?? "").toUpperCase();
    if (entityType === "cycle" && /^C\d+$/.test(entityId)) {
      findingCycleIds.add(entityId);
    }
    if (entityType === "session" && /^S\d+$/.test(entityId)) {
      findingSessionIds.add(entityId);
    }
  }
  const activeCycleIds = new Set(
    (Array.isArray(payload?.cycles) ? payload.cycles : [])
      .filter((cycle) => ["OPEN", "IMPLEMENTING", "VERIFYING"].includes(String(cycle?.state ?? "").toUpperCase()))
      .map((cycle) => String(cycle?.cycle_id ?? "")),
  );
  const cycleStatusTargets = new Set();
  const linkedCycleIds = new Set();
  const prioritySources = new Set(["baseline/current.md", "baseline/history.md", "snapshots/context-snapshot.md"]);
  for (const row of artifactLinks) {
    const evaluation = evaluateRepairRelation(row, {
      minConfidence: options.minRelationConfidence,
      relationThresholds: options.relationThresholds,
      allowAmbiguous: options.allowAmbiguousLinks,
    });
    if (!evaluation.usable) {
      relationEvaluation.rejected_count += 1;
      relationEvaluation.rejected_by_reason[evaluation.reason] = Number(relationEvaluation.rejected_by_reason[evaluation.reason] ?? 0) + 1;
      pushLimited(relationEvaluation.rejected_samples, {
        relation_type: evaluation.relation_type,
        source_mode: evaluation.source_mode,
        relation_status: evaluation.relation_status,
        confidence: evaluation.confidence,
        min_confidence: evaluation.min_confidence,
        reason: evaluation.reason,
        source_path: String(row?.source_path ?? "").replace(/\\/g, "/"),
        target_path: String(row?.target_path ?? "").replace(/\\/g, "/"),
      });
      continue;
    }
    relationEvaluation.accepted_count += 1;
    relationEvaluation.accepted_by_type[evaluation.relation_type] = Number(relationEvaluation.accepted_by_type[evaluation.relation_type] ?? 0) + 1;
    pushLimited(relationEvaluation.accepted_samples, {
      relation_type: evaluation.relation_type,
      source_mode: evaluation.source_mode,
      relation_status: evaluation.relation_status,
      confidence: evaluation.confidence,
      min_confidence: evaluation.min_confidence,
      source_path: String(row?.source_path ?? "").replace(/\\/g, "/"),
      target_path: String(row?.target_path ?? "").replace(/\\/g, "/"),
    });
    const sourcePath = String(row?.source_path ?? "").replace(/\\/g, "/");
    const targetPath = String(row?.target_path ?? "").replace(/\\/g, "/");
    const relationType = String(row?.relation_type ?? "");
    if (!prioritySources.has(sourcePath)) {
      continue;
    }
    if (!["summarizes_cycle", "supports_cycle"].includes(relationType)) {
      continue;
    }
    if (!/\/status\.md$/i.test(targetPath)) {
      continue;
    }
    cycleStatusTargets.add(targetPath);
    const targetArtifact = artifacts.find((artifact) => String(artifact?.path ?? "").replace(/\\/g, "/") === targetPath);
    if (targetArtifact?.cycle_id) {
      linkedCycleIds.add(String(targetArtifact.cycle_id));
    }
  }
  const relatedSessionIds = new Set();
  const continuitySessionIds = new Set();
  const continuityCycleIds = new Set();
  for (const row of sessionCycleLinks) {
    const evaluation = evaluateRepairRelation(row, {
      minConfidence: options.minRelationConfidence,
      relationThresholds: options.relationThresholds,
      allowAmbiguous: options.allowAmbiguousLinks,
    });
    if (!evaluation.usable) {
      relationEvaluation.rejected_count += 1;
      relationEvaluation.rejected_by_reason[evaluation.reason] = Number(relationEvaluation.rejected_by_reason[evaluation.reason] ?? 0) + 1;
      pushLimited(relationEvaluation.rejected_samples, {
        relation_type: evaluation.relation_type,
        source_mode: evaluation.source_mode,
        relation_status: evaluation.relation_status,
        confidence: evaluation.confidence,
        min_confidence: evaluation.min_confidence,
        reason: evaluation.reason,
        session_id: String(row?.session_id ?? ""),
        cycle_id: String(row?.cycle_id ?? ""),
      });
      continue;
    }
    relationEvaluation.accepted_count += 1;
    relationEvaluation.accepted_by_type[evaluation.relation_type] = Number(relationEvaluation.accepted_by_type[evaluation.relation_type] ?? 0) + 1;
    pushLimited(relationEvaluation.accepted_samples, {
      relation_type: evaluation.relation_type,
      source_mode: evaluation.source_mode,
      relation_status: evaluation.relation_status,
      confidence: evaluation.confidence,
      min_confidence: evaluation.min_confidence,
      session_id: String(row?.session_id ?? ""),
      cycle_id: String(row?.cycle_id ?? ""),
    });
    const cycleId = String(row?.cycle_id ?? "");
    if (!cycleId) {
      continue;
    }
    if (!activeCycleIds.has(cycleId) && !linkedCycleIds.has(cycleId)) {
      continue;
    }
    const sessionId = String(row?.session_id ?? "");
    if (sessionId) {
      relatedSessionIds.add(sessionId);
    }
  }
  for (const row of sessionLinks) {
    const evaluation = evaluateRepairRelation(row, {
      minConfidence: options.minRelationConfidence,
      relationThresholds: options.relationThresholds,
      allowAmbiguous: options.allowAmbiguousLinks,
    });
    if (!evaluation.usable) {
      relationEvaluation.rejected_count += 1;
      relationEvaluation.rejected_by_reason[evaluation.reason] = Number(relationEvaluation.rejected_by_reason[evaluation.reason] ?? 0) + 1;
      pushLimited(relationEvaluation.rejected_samples, {
        relation_type: evaluation.relation_type,
        source_mode: evaluation.source_mode,
        relation_status: evaluation.relation_status,
        confidence: evaluation.confidence,
        min_confidence: evaluation.min_confidence,
        reason: evaluation.reason,
        source_session_id: String(row?.source_session_id ?? ""),
        target_session_id: String(row?.target_session_id ?? ""),
      });
      continue;
    }
    relationEvaluation.accepted_count += 1;
    relationEvaluation.accepted_by_type[evaluation.relation_type] = Number(relationEvaluation.accepted_by_type[evaluation.relation_type] ?? 0) + 1;
    pushLimited(relationEvaluation.accepted_samples, {
      relation_type: evaluation.relation_type,
      source_mode: evaluation.source_mode,
      relation_status: evaluation.relation_status,
      confidence: evaluation.confidence,
      min_confidence: evaluation.min_confidence,
      source_session_id: String(row?.source_session_id ?? ""),
      target_session_id: String(row?.target_session_id ?? ""),
    });
    const sourceSessionId = String(row?.source_session_id ?? "");
    const targetSessionId = String(row?.target_session_id ?? "");
    if (relatedSessionIds.has(sourceSessionId) && targetSessionId) {
      continuitySessionIds.add(targetSessionId);
    }
    if (relatedSessionIds.has(targetSessionId) && sourceSessionId) {
      continuitySessionIds.add(sourceSessionId);
    }
  }
  for (const row of sessionCycleLinks) {
    const evaluation = evaluateRepairRelation(row, {
      minConfidence: options.minRelationConfidence,
      relationThresholds: options.relationThresholds,
      allowAmbiguous: options.allowAmbiguousLinks,
    });
    if (!evaluation.usable) {
      continue;
    }
    const sessionId = String(row?.session_id ?? "");
    const cycleId = String(row?.cycle_id ?? "");
    if (!cycleId) {
      continue;
    }
    if (continuitySessionIds.has(sessionId)) {
      continuityCycleIds.add(cycleId);
    }
  }

  const selected = [];
  const seen = new Set();
  const artifactScore = new Map();
  const artifactReasons = new Map();
  let excerptBudgetBytes = 0;

  const mark = (artifact, score, reason) => {
    if (!artifact || typeof artifact !== "object") {
      return;
    }
    const rel = String(artifact.path ?? "").replace(/\\/g, "/");
    if (!rel) {
      return;
    }
    const previousScore = Number(artifactScore.get(rel) ?? 0);
    artifactScore.set(rel, previousScore + score + artifactRepairScore(artifact));
    const reasons = artifactReasons.get(rel) ?? [];
    if (!reasons.includes(reason)) {
      reasons.push(reason);
      artifactReasons.set(rel, reasons);
    }
  };

  const pick = (artifact) => {
    if (!artifact || typeof artifact !== "object") {
      return;
    }
    const rel = String(artifact.path ?? "").replace(/\\/g, "/");
    if (!rel || seen.has(rel)) {
      return;
    }
    seen.add(rel);
    const selectionReasons = artifactReasons.get(rel) ?? [];
    const selectionScore = Number(artifactScore.get(rel) ?? 0);
    const content = decodeArtifactContent(artifact);
    const selectionTier = classifySelectionTier(selectionReasons);
    let excerpt = null;
    let excerptBytes = 0;
    let contentState = "metadata_only";
    if (content) {
      if (selectionTier === "history") {
        contentState = "metadata_only";
      } else if (excerptBudgetBytes >= hardLimitBytes) {
        contentState = "budget_omitted";
      } else {
        const bytes = content.length > maxArtifactBytes
        ? content.subarray(0, maxArtifactBytes)
        : content;
        if (excerptBudgetBytes + bytes.length <= hardLimitBytes) {
          excerpt = bytes.toString("utf8");
          excerptBytes = bytes.length;
          excerptBudgetBytes += bytes.length;
          contentState = content.length > maxArtifactBytes ? "truncated" : "included";
        } else {
          contentState = "budget_omitted";
        }
      }
    } else {
      contentState = "no_content";
    }
    selected.push({
      artifact_id: artifact.artifact_id ?? null,
      path: rel,
      kind: artifact.kind ?? "other",
      family: artifact.family ?? "unknown",
      cycle_id: artifact.cycle_id ?? null,
      session_id: artifact.session_id ?? null,
      source_mode: artifact.source_mode ?? "explicit",
      entity_confidence: Number(artifact.entity_confidence ?? 1),
      has_content: content != null,
      selection_score: selectionScore,
      selection_reasons: selectionReasons,
      selection_tier: selectionTier,
      content_state: contentState,
      excerpt_bytes: excerptBytes,
      size_bytes: Number(artifact.size_bytes ?? (content?.length ?? 0)),
      sha256: artifact.sha256 ?? (content ? sha256Text(content.toString("utf8")) : null),
      updated_at: artifact.updated_at ?? null,
      content_excerpt: excerpt,
      canonical: artifact.canonical ?? null,
    });
  };

  for (const artifact of artifacts) {
    const rel = String(artifact?.path ?? "").replace(/\\/g, "/");
    if (priority.has(rel)) {
      mark(artifact, 100, "priority_artifact");
    }
  }
  for (const artifact of artifacts) {
    if (activeCycleIds.has(String(artifact?.cycle_id ?? "")) && /\/status\.md$/i.test(String(artifact?.path ?? ""))) {
      mark(artifact, 80, "active_cycle_status");
    }
  }
  for (const artifact of artifacts) {
    const rel = String(artifact?.path ?? "").replace(/\\/g, "/");
    if (cycleStatusTargets.has(rel)) {
      mark(artifact, 70, "linked_from_snapshot_or_baseline");
    }
  }
  for (const artifact of artifacts) {
    if (String(artifact?.kind ?? "") === "session" && relatedSessionIds.has(String(artifact?.session_id ?? ""))) {
      mark(artifact, 65, "related_session");
    }
  }
  for (const artifact of artifacts) {
    if (String(artifact?.kind ?? "") === "session" && continuitySessionIds.has(String(artifact?.session_id ?? ""))) {
      mark(artifact, 58, "continuity_session");
    }
  }
  for (const artifact of artifacts) {
    const rel = String(artifact?.path ?? "").replace(/\\/g, "/");
    if (findingsByArtifactPath.has(rel)) {
      const findingScore = (findingsByArtifactPath.get(rel) ?? [])
        .reduce((max, row) => Math.max(max, Number(row?.priority_score ?? 0)), 0);
      mark(artifact, 40 + findingScore, "repair_finding_artifact");
    }
  }
  for (const artifact of artifacts) {
    if (findingSessionIds.has(String(artifact?.session_id ?? "")) && String(artifact?.kind ?? "") === "session") {
      const sessionScore = prioritizedFindings
        .filter((row) => String(row?.entity_type ?? "").toLowerCase() === "session" && String(row?.entity_id ?? "").toUpperCase() === String(artifact?.session_id ?? "").toUpperCase())
        .reduce((max, row) => Math.max(max, Number(row?.priority_score ?? 0)), 0);
      mark(artifact, 38 + sessionScore, "repair_finding_session");
    }
  }
  for (const artifact of artifacts) {
    if (findingCycleIds.has(String(artifact?.cycle_id ?? "")) && /\/status\.md$/i.test(String(artifact?.path ?? ""))) {
      const cycleScore = prioritizedFindings
        .filter((row) => String(row?.entity_type ?? "").toLowerCase() === "cycle" && String(row?.entity_id ?? "").toUpperCase() === String(artifact?.cycle_id ?? "").toUpperCase())
        .reduce((max, row) => Math.max(max, Number(row?.priority_score ?? 0)), 0);
      mark(artifact, 40 + cycleScore, "repair_finding_cycle_status");
    }
  }
  for (const artifact of artifacts) {
    if (continuityCycleIds.has(String(artifact?.cycle_id ?? "")) && /\/status\.md$/i.test(String(artifact?.path ?? ""))) {
      mark(artifact, 54, "continuity_cycle_status");
    }
  }
  const sessionCandidates = artifacts
    .filter((artifact) => String(artifact?.kind ?? "") === "session")
    .sort((a, b) => String(b?.updated_at ?? "").localeCompare(String(a?.updated_at ?? "")));
  if (sessionCandidates[0]) {
    mark(sessionCandidates[0], 40, "latest_session_fallback");
  }

  const selectedArtifacts = artifacts
    .filter((artifact) => artifactScore.has(String(artifact?.path ?? "").replace(/\\/g, "/")))
    .sort((left, right) => {
      const leftPath = String(left?.path ?? "").replace(/\\/g, "/");
      const rightPath = String(right?.path ?? "").replace(/\\/g, "/");
      const scoreDelta = Number(artifactScore.get(rightPath) ?? 0) - Number(artifactScore.get(leftPath) ?? 0);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return leftPath.localeCompare(rightPath);
    });

  const limitedArtifacts = selectedArtifacts.slice(0, maxArtifacts);
  const omittedCount = Math.max(0, selectedArtifacts.length - limitedArtifacts.length);
  for (const artifact of limitedArtifacts) {
    pick(artifact);
  }
  const bundleBudget = enforceHardArtifactBudget(
    selected,
    omittedCount,
    targetBytes,
    hardLimitBytes,
    maxArtifactBytes,
    maxArtifacts,
  );

  return {
    selected,
    bundle_budget: bundleBudget,
    source_revision: sha256Text(JSON.stringify({
      generated_at: payload?.generated_at ?? null,
      schema_version: payload?.schema_version ?? null,
      summary: {
        artifacts: artifacts.length,
        cycles: Array.isArray(payload?.cycles) ? payload.cycles.length : 0,
        sessions: Array.isArray(payload?.sessions) ? payload.sessions.length : 0,
        findings: migrationFindings.length,
      },
      selected: selected.map((artifact) => ({
        path: artifact.path,
        sha256: artifact.sha256,
        updated_at: artifact.updated_at,
      })),
    })),
    relation_evaluation: relationEvaluation,
    finding_focus: {
      artifact_paths: Array.from(findingsByArtifactPath.keys()).sort((a, b) => a.localeCompare(b)).slice(0, 10),
      cycle_ids: Array.from(findingCycleIds).sort((a, b) => a.localeCompare(b)).slice(0, 10),
      session_ids: Array.from(findingSessionIds).sort((a, b) => a.localeCompare(b)).slice(0, 10),
      prioritized_findings: prioritizedFindings
        .slice()
        .sort((left, right) => Number(right?.priority_score ?? 0) - Number(left?.priority_score ?? 0))
        .slice(0, 10),
    },
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function summarizeRepairLayer(payload, selection = null) {
  const migrationRuns = Array.isArray(payload?.migration_runs) ? payload.migration_runs : [];
  const migrationFindings = Array.isArray(payload?.migration_findings) ? payload.migration_findings : [];
  const severityCounts = {};
  const typeCounts = {};
  for (const row of migrationFindings) {
    const severity = String(row?.severity ?? "unknown");
    const type = String(row?.finding_type ?? "unknown");
    severityCounts[severity] = Number(severityCounts[severity] ?? 0) + 1;
    typeCounts[type] = Number(typeCounts[type] ?? 0) + 1;
  }
  const latestRun = migrationRuns
    .slice()
    .sort((left, right) => String(right?.started_at ?? "").localeCompare(String(left?.started_at ?? "")))[0] ?? null;
  return {
    migration_run_count: migrationRuns.length,
    finding_count: migrationFindings.length,
    session_link_count: Array.isArray(payload?.session_links) ? payload.session_links.length : 0,
    severity_counts: severityCounts,
    type_counts: typeCounts,
    latest_run: latestRun,
    top_findings: migrationFindings.slice(0, 5),
    relation_evaluation: selection?.relation_evaluation ?? null,
    finding_focus: selection?.finding_focus ?? null,
  };
}

function firstStateMode(latest) {
  for (const key of Object.keys(latest)) {
    const mode = latest[key]?.state_mode;
    if (typeof mode === "string" && mode.length > 0) {
      return mode;
    }
  }
  return null;
}

function resolveEffectiveStateMode(targetRoot, latest, requestedSkill) {
  const envStateMode = normalizeStateMode(process.env.AIDN_STATE_MODE);
  if (envStateMode) {
    return {
      mode: envStateMode,
      source: "env-state-mode",
    };
  }

  const config = readAidnProjectConfig(targetRoot);
  const configStateMode = resolveConfigStateMode(config.data);
  if (configStateMode) {
    return {
      mode: configStateMode,
      source: "config-state-mode",
    };
  }

  const envIndexStore = normalizeIndexStoreMode(process.env.AIDN_INDEX_STORE_MODE);
  if (envIndexStore) {
    return {
      mode: stateModeFromIndexStore(envIndexStore),
      source: "env-index-store",
    };
  }

  const configIndexStore = resolveConfigIndexStore(config.data);
  if (configIndexStore) {
    return {
      mode: stateModeFromIndexStore(configIndexStore),
      source: "config-index-store",
    };
  }

  const requestedSkillMode = normalizeStateMode(requestedSkill ? latest?.[requestedSkill]?.state_mode : "");
  if (requestedSkillMode) {
    return {
      mode: requestedSkillMode,
      source: "context-requested-skill",
    };
  }

  const historicalMode = normalizeStateMode(firstStateMode(latest));
  if (historicalMode) {
    return {
      mode: historicalMode,
      source: "context-history",
    };
  }

  return {
    mode: "files",
    source: "default",
  };
}

export async function runHydrateContextUseCase({ args, hookContextStore, targetRoot }) {
  const context = hookContextStore.readContext({
    targetRoot,
    contextFile: args.contextFile,
  });
  const store = context.exists ? context.store : { latest: {}, history: [] };
  const latest = store.latest && typeof store.latest === "object" ? store.latest : {};
  const history = Array.isArray(store.history) ? store.history : [];
  const filteredHistory = args.skill
    ? history.filter((entry) => String(entry?.skill ?? "") === args.skill)
    : history;
  const recentHistory = filteredHistory.slice(Math.max(0, filteredHistory.length - args.historyLimit));

  const skills = Object.keys(latest).sort((a, b) => a.localeCompare(b));
  const decisionBySkill = {};
  for (const skill of skills) {
    const entry = latest[skill];
    decisionBySkill[skill] = {
      ok: Boolean(entry?.ok),
      mode: entry?.mode ?? "UNKNOWN",
      state_mode: entry?.state_mode ?? "files",
      decision: entry?.decision ?? null,
      action: entry?.action ?? null,
      result: entry?.result ?? null,
      reason_codes: Array.isArray(entry?.reason_codes) ? entry.reason_codes : [],
      repair_layer_open_count: Number(entry?.repair_layer_open_count ?? 0),
      repair_layer_blocking: entry?.repair_layer_blocking === true,
      repair_layer_status: entry?.repair_layer_status ?? null,
      repair_layer_advice: entry?.repair_layer_advice ?? null,
      repair_primary_reason: entry?.repair_primary_reason ?? null,
      repair_layer_top_findings: Array.isArray(entry?.repair_layer_top_findings)
        ? entry.repair_layer_top_findings
        : [],
    };
  }

  const effectiveState = resolveEffectiveStateMode(targetRoot, latest, args.skill);
  const effectiveStateMode = effectiveState.mode;

  let artifactSource = null;
  let selectedArtifacts = [];
  let repairLayer = null;
  if (args.includeArtifacts) {
    const indexFile = resolveTargetPath(targetRoot, args.indexFile);
    const config = readAidnProjectConfig(targetRoot);
    const { backend, connectionRef } = resolveArtifactSnapshotBackend(indexFile, args.backend, config.data);
    const canReadArtifactSnapshot = backend === "postgres" || fs.existsSync(indexFile);
    if (canReadArtifactSnapshot) {
      const index = backend === "json"
        ? readJsonIndex(indexFile)
        : await readRuntimeSnapshot({
          indexFile,
          backend,
          targetRoot,
          connectionRef,
          configData: config.data,
        });
      artifactSource = {
        backend,
        file: index.absolute,
        runtime_scope_id: index.payload?.project_context?.runtime_scope_id ?? null,
        project_id: index.payload?.project_context?.project_id ?? null,
        workspace_id: index.payload?.project_context?.workspace_id ?? null,
      };
      const selection = selectArtifacts(index.payload, args.maxArtifactBytes, {
        minRelationConfidence: args.minRelationConfidence,
        relationThresholds: args.relationThresholds,
        allowAmbiguousLinks: args.allowAmbiguousLinks,
        maxArtifacts: args.maxArtifacts,
        bundleTargetBytes: args.bundleTargetBytes,
        bundleHardLimitBytes: args.bundleHardLimitBytes,
      });
      selectedArtifacts = selection.selected;
      repairLayer = summarizeRepairLayer(index.payload, selection);
      artifactSource.bundle_budget = selection.bundle_budget;
      artifactSource.source_revision = selection.source_revision;
    }
  }

  const hydrated = {
    ts: new Date().toISOString(),
    target_root: targetRoot,
    state_mode: effectiveStateMode,
    state_mode_source: effectiveState.source,
    context_file: context.context_file,
    requested_skill: args.skill || null,
    decisions: decisionBySkill,
    recent_history: recentHistory,
    artifact_source: artifactSource,
    repair_layer: repairLayer,
    bundle_budget: artifactSource?.bundle_budget ?? null,
    source_backend: artifactSource?.backend ?? null,
    runtime_scope_id: artifactSource?.runtime_scope_id ?? null,
    project_id: artifactSource?.project_id ?? null,
    workspace_id: artifactSource?.workspace_id ?? null,
    source_revision: artifactSource?.source_revision ?? null,
    artifacts: selectedArtifacts,
  };

  if (args.out) {
    const outFile = resolveTargetPath(targetRoot, args.out);
    writeJson(outFile, hydrated);
    hydrated.output_file = outFile;
  }

  return hydrated;
}
