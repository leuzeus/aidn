import { deriveGovernedRuntimeArtifactMetadata } from "./governed-runtime-artifact-metadata-lib.mjs";

export function buildRuntimeStateMarkdown(digest) {
  const lines = [];
  lines.push("# Runtime State Digest");
  lines.push("");
  lines.push("Purpose:");
  lines.push("");
  lines.push("- keep runtime-specific operational signals short and easy to reload");
  lines.push("- avoid scattering `dual` / `db-only` runtime facts across multiple hidden files");
  lines.push("- surface whether `CURRENT-STATE.md` still looks trustworthy");
  lines.push("");
  lines.push("Rule/State boundary:");
  lines.push("");
  lines.push("- this file is a state digest, not a canonical workflow rules file");
  lines.push("- keep canonical workflow rules in `docs/audit/SPEC.md`");
  lines.push("- keep local policy extensions in `docs/audit/WORKFLOW.md`");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`contract_version: ${digest.contract_version}`);
  lines.push(`updated_at: ${digest.updated_at}`);
  lines.push(`project_id: ${digest.project_id}`);
  lines.push(`project_id_source: ${digest.project_id_source}`);
  lines.push(`project_root: ${digest.project_root}`);
  lines.push(`workspace_id: ${digest.workspace_id}`);
  lines.push(`worktree_id: ${digest.worktree_id}`);
  lines.push(`runtime_state_mode: ${digest.runtime_state_mode}`);
  lines.push(`repair_layer_status: ${digest.repair_layer_status}`);
  lines.push(`repair_layer_advice: ${digest.repair_layer_advice}`);
  lines.push(`repair_primary_reason: ${digest.repair_primary_reason}`);
  lines.push(`repair_routing_hint: ${digest.repair_routing_hint}`);
  lines.push(`repair_routing_reason: ${digest.repair_routing_reason}`);
  lines.push(`shared_runtime_validation_status: ${digest.shared_runtime_validation_status}`);
  lines.push(`active_backlog: ${digest.active_backlog}`);
  lines.push(`backlog_status: ${digest.backlog_status}`);
  lines.push(`backlog_next_step: ${digest.backlog_next_step}`);
  lines.push(`planning_arbitration_status: ${digest.planning_arbitration_status}`);
  lines.push(`shared_planning_source: ${digest.shared_planning_source}`);
  lines.push(`shared_planning_read_status: ${digest.shared_planning_read_status}`);
  lines.push(`source_of_truth: ${digest.source_of_truth}`);
  lines.push(`source_mode: ${digest.source_mode}`);
  lines.push(`lifecycle_status: ${digest.lifecycle_status}`);
  lines.push(`owner: ${digest.owner}`);
  lines.push(`steward: ${digest.steward}`);
  lines.push("");
  lines.push("## Current State Freshness");
  lines.push("");
  lines.push(`current_state_freshness: ${digest.current_state_freshness}`);
  lines.push(`current_state_freshness_basis: ${digest.current_state_freshness_basis}`);
  lines.push("");
  lines.push("Meaning:");
  lines.push("");
  lines.push("- `ok`: `CURRENT-STATE.md` is not older than the active cycle timestamps currently checked");
  lines.push("- `stale`: `CURRENT-STATE.md` is older than the active cycle timestamps currently checked");
  lines.push("- `unknown`: no active cycle, missing timestamps, or freshness not evaluated yet");
  lines.push("");
  lines.push("## Blocking Findings");
  lines.push("");
  lines.push("blocking_findings:");
  if (digest.blocking_findings.length === 0) {
    lines.push("- none");
  } else {
    for (const finding of digest.blocking_findings) {
      lines.push(`- ${finding}`);
    }
  }
  lines.push("");
  lines.push("## Prioritized Reads");
  lines.push("");
  lines.push("prioritized_artifacts:");
  for (const item of digest.prioritized_artifacts) {
    lines.push(`- \`${item}\``);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push(`- Source context file: \`${digest.context_source}\``);
  if (digest.consistency_status === "fail") {
    lines.push("- `CURRENT-STATE.md` consistency check did not fully pass; read the detailed checks before relying on this digest.");
  } else {
    lines.push("- `CURRENT-STATE.md` consistency check passed for the currently evaluated signals.");
  }
  lines.push("- In `files` mode, this digest may remain minimal.");
  lines.push("- In `dual` / `db-only`, refresh this digest whenever runtime hydration or repair-layer triage reveals new blocking facts.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function canonicalNone(value) {
  const normalized = normalizeScalar(value).toLowerCase();
  return normalized === "none" || normalized === "(none)";
}

function canonicalUnknown(value) {
  return normalizeScalar(value).toLowerCase() === "unknown";
}

function uniqueItems(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function collectDecisionEntries(payload) {
  const entries = payload && typeof payload.decisions === "object"
    ? Object.entries(payload.decisions)
    : [];
  return entries
    .filter(([, entry]) => entry && typeof entry === "object")
    .map(([skill, entry]) => ({ skill, ...entry }));
}

function repairCandidateRank(entry) {
  if (!entry || typeof entry !== "object") {
    return 0;
  }
  let rank = 0;
  if (!canonicalUnknown(entry.repair_layer_status) && normalizeScalar(entry.repair_layer_status)) {
    rank += entry.repair_layer_status_inferred ? 2 : 4;
  }
  if (!canonicalUnknown(entry.repair_layer_advice) && normalizeScalar(entry.repair_layer_advice)) {
    rank += entry.repair_layer_advice_inferred ? 1 : 3;
  }
  if (Array.isArray(entry.repair_layer_top_findings) && entry.repair_layer_top_findings.length > 0) {
    rank += 1;
  }
  if (entry.repair_layer_blocking === true) {
    rank += 2;
  }
  return rank;
}

function repairCandidateHasKnownStatus(entry) {
  return !canonicalUnknown(entry?.repair_layer_status) && normalizeScalar(entry?.repair_layer_status).length > 0;
}

function latestRepairCandidate(entries) {
  return entries
    .slice()
    .sort((left, right) => {
      const knownStatusDelta = Number(repairCandidateHasKnownStatus(right)) - Number(repairCandidateHasKnownStatus(left));
      if (knownStatusDelta !== 0) {
        return knownStatusDelta;
      }
      const leftTs = Date.parse(String(left?.ts ?? left?.updated_at ?? ""));
      const rightTs = Date.parse(String(right?.ts ?? right?.updated_at ?? ""));
      const tsDelta = (Number.isNaN(rightTs) ? 0 : rightTs) - (Number.isNaN(leftTs) ? 0 : leftTs);
      if (tsDelta !== 0) {
        return tsDelta;
      }
      return repairCandidateRank(right) - repairCandidateRank(left);
    })[0] ?? null;
}

function inferRepairStatus(status, findings, blocking) {
  const normalizedStatus = String(status ?? "").trim().toLowerCase();
  if (normalizedStatus) {
    return normalizedStatus;
  }
  if (blocking === true) {
    return "block";
  }
  const severities = Array.isArray(findings)
    ? findings.map((item) => normalizeScalar(item?.severity).toLowerCase()).filter(Boolean)
    : [];
  if (severities.includes("error") || severities.includes("warning")) {
    return "warn";
  }
  if (severities.length > 0) {
    return "clean";
  }
  return "";
}

function inferRepairAdvice(advice, status) {
  const normalizedAdvice = String(advice ?? "").trim();
  if (normalizedAdvice) {
    return normalizedAdvice;
  }
  const normalizedStatus = String(status ?? "").trim().toLowerCase();
  if (normalizedStatus === "clean" || normalizedStatus === "ok") {
    return "Repair layer is clean.";
  }
  if (normalizedStatus === "warn") {
    return "Review open repair findings.";
  }
  if (normalizedStatus === "block") {
    return "Resolve blocking repair findings before continuing.";
  }
  return "";
}

function normalizeRepairCandidate(entry, defaults = {}) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const rawStatus = String(
    entry.repair_layer_status
      ?? entry.status
      ?? defaults.status
      ?? "",
  ).trim();
  const rawAdvice = String(
    entry.repair_layer_advice
      ?? entry.advice
      ?? defaults.advice
      ?? "",
  ).trim();
  const findings = Array.isArray(entry.repair_layer_top_findings)
    ? entry.repair_layer_top_findings
    : (Array.isArray(entry.top_findings) ? entry.top_findings : []);
  const blocking = entry.repair_layer_blocking === true
    || entry.blocking === true
    || defaults.blocking === true;
  const status = inferRepairStatus(rawStatus, findings, blocking);
  const advice = inferRepairAdvice(rawAdvice, status);
  const ts = String(
    entry.ts
      ?? entry.updated_at
      ?? defaults.ts
      ?? "",
  ).trim();
  if (!status && !advice && findings.length === 0 && !blocking) {
    return null;
  }
  return {
    ts,
    repair_layer_status: status || "unknown",
    repair_layer_status_inferred: !rawStatus,
    repair_layer_advice: advice || "unknown",
    repair_layer_advice_inferred: !rawAdvice,
    repair_layer_top_findings: findings,
    repair_layer_blocking: blocking,
  };
}

export function deriveRuntimeStateRepairSummary(hydrated, fallbackContext) {
  const repairLayer = hydrated?.repair_layer && typeof hydrated.repair_layer === "object"
    ? hydrated.repair_layer
    : null;
  const history = Array.isArray(hydrated?.recent_history) ? hydrated.recent_history : [];
  const decisions = collectDecisionEntries(hydrated);
  const fallbackEntries = fallbackContext?.latest && typeof fallbackContext.latest === "object"
    ? Object.values(fallbackContext.latest).filter((entry) => entry && typeof entry === "object")
    : [];
  const source = latestRepairCandidate([
    normalizeRepairCandidate(repairLayer, {
      ts: hydrated?.ts,
      blocking: repairLayer?.blocking === true,
    }),
    ...history.map((entry) => normalizeRepairCandidate(entry)),
    ...decisions.map((entry) => normalizeRepairCandidate(entry)),
    ...fallbackEntries.map((entry) => normalizeRepairCandidate(entry)),
  ].filter(Boolean));
  return {
    status: String(source?.repair_layer_status ?? "unknown").trim() || "unknown",
    advice: String(source?.repair_layer_advice ?? "unknown").trim() || "unknown",
    findings: Array.isArray(source?.repair_layer_top_findings) ? source.repair_layer_top_findings : [],
    blocking: source?.repair_layer_blocking === true,
  };
}

export function deriveRuntimeStateFreshness(consistency) {
  const activeCycle = normalizeScalar(consistency?.current_state?.active_cycle ?? "");
  if (!activeCycle || canonicalNone(activeCycle) || canonicalUnknown(activeCycle)) {
    return {
      freshness: "unknown",
      basis: "no active cycle declared in CURRENT-STATE.md",
    };
  }
  const staleKeys = [
    "updated_at_not_older_than_status",
    "updated_at_not_older_than_dor_check",
  ];
  for (const key of staleKeys) {
    const check = consistency?.checks?.[key];
    if (check?.pass === false) {
      return {
        freshness: "stale",
        basis: check.details || key,
      };
    }
  }
  const parseable = consistency?.checks?.updated_at_parseable?.pass === true;
  const statusKnown = consistency?.checks?.active_cycle_status_exists?.pass === true;
  if (parseable && statusKnown) {
    return {
      freshness: "ok",
      basis: "CURRENT-STATE.md.updated_at is aligned with active cycle status timestamps",
    };
  }
  return {
    freshness: "unknown",
    basis: "freshness prerequisites missing or not evaluable",
  };
}

function formatFinding(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const severity = String(item.severity ?? "").trim().toLowerCase();
  const type = String(item.finding_type ?? item.type ?? "").trim();
  const entity = String(item.entity_id ?? "").trim();
  const message = String(item.message ?? "").trim();
  const parts = [];
  if (severity) {
    parts.push(severity);
  }
  if (type) {
    parts.push(type);
  }
  if (entity) {
    parts.push(entity);
  }
  if (message) {
    parts.push(message);
  }
  return parts.join(": ");
}

function deriveRepairPrimaryReason({ status, advice, findings }) {
  const normalizedStatus = normalizeScalar(status).toLowerCase();
  if (normalizedStatus === "clean" || normalizedStatus === "ok") {
    return "repair layer reports no blocking findings for the current relay";
  }
  const topFinding = Array.isArray(findings) ? findings[0] : null;
  const topFormatted = formatFinding(topFinding);
  if (topFormatted) {
    return topFormatted;
  }
  const normalizedAdvice = normalizeScalar(advice);
  if (normalizedAdvice && !canonicalUnknown(normalizedAdvice)) {
    return normalizedAdvice;
  }
  return "repair-layer reason is unknown";
}

function normalizeBacklogArtifactPath(activeBacklog) {
  const normalized = normalizeScalar(activeBacklog);
  if (!normalized || canonicalNone(normalized) || canonicalUnknown(normalized)) {
    return "";
  }
  return normalized.startsWith("docs/")
    ? normalized.replace(/\\/g, "/")
    : `docs/audit/${normalized.replace(/\\/g, "/").replace(/^\/+/, "")}`;
}

export function deriveRuntimeStatePrioritizedArtifacts(consistency, hydrated, options = {}) {
  const values = [
    "docs/audit/HANDOFF-PACKET.md",
    "docs/audit/CURRENT-STATE.md",
    "docs/audit/snapshots/context-snapshot.md",
  ];
  const activeCycle = normalizeScalar(consistency?.current_state?.active_cycle ?? "");
  const activeSession = normalizeScalar(consistency?.current_state?.active_session ?? "");
  if (activeCycle && !canonicalNone(activeCycle) && !canonicalUnknown(activeCycle)) {
    values.push(`docs/audit/cycles/${activeCycle}-*/status.md`);
  }
  if (activeSession && !canonicalNone(activeSession) && !canonicalUnknown(activeSession)) {
    values.push(`docs/audit/sessions/${activeSession}*.md`);
  }
  if (options.hydratedFile) {
    values.push(String(options.hydratedFile).replace(/\\/g, "/"));
  }
  if (options.contextFile) {
    values.push(String(options.contextFile).replace(/\\/g, "/"));
  }
  const artifactPaths = Array.isArray(hydrated?.artifacts)
    ? hydrated.artifacts.map((artifact) => String(artifact?.path ?? "").trim()).filter(Boolean)
    : [];
  return uniqueItems([...values, ...artifactPaths.slice(0, 6)]);
}

export function prepareRuntimeStateProjection({
  workspace,
  dbBackedMode = false,
  effectiveStateMode = "",
  hydrated = null,
  fallbackContext = null,
  repairRouting,
  sharedRuntimeValidation,
  sharedPlanning,
  consistency,
  currentStateResolution,
  sessionResolution,
  cycleStatusResolution,
  contextSource = "none",
  hydratedFile = "",
  contextFile = "",
} = {}) {
  const repairSummary = deriveRuntimeStateRepairSummary(hydrated, fallbackContext);
  const freshness = deriveRuntimeStateFreshness(consistency);
  const prioritizedFindings = Array.isArray(repairSummary.findings)
    ? repairSummary.findings.filter((item) => {
      const severity = normalizeScalar(item?.severity).toLowerCase();
      return severity === "warning" || severity === "error";
    })
    : [];
  const blockingFindings = uniqueItems(
    prioritizedFindings
      .map((item) => formatFinding(item))
      .filter(Boolean)
      .slice(0, 5),
  );
  if (repairSummary.blocking && blockingFindings.length === 0) {
    blockingFindings.push("repair layer marked blocking without detailed findings");
  }
  return buildRuntimeStateDigest({
    workspace,
    dbBackedMode,
    effectiveStateMode,
    hydrated,
    repairSummary,
    repairPrimaryReason: deriveRepairPrimaryReason(repairSummary),
    repairRouting,
    sharedRuntimeValidation,
    sharedPlanning,
    freshness,
    blockingFindings,
    prioritizedArtifacts: uniqueItems([
      ...deriveRuntimeStatePrioritizedArtifacts(consistency, hydrated, {
        hydratedFile,
        contextFile,
      }),
      normalizeBacklogArtifactPath(sharedPlanning.active_backlog),
    ]),
    contextSource,
    consistency,
    currentStateResolution,
    sessionResolution,
    cycleStatusResolution,
  });
}

export function buildRuntimeStateDigest({
  updatedAt,
  workspace,
  dbBackedMode = false,
  effectiveStateMode = "",
  hydrated = null,
  repairSummary,
  repairPrimaryReason,
  repairRouting,
  sharedRuntimeValidation,
  sharedPlanning,
  freshness,
  blockingFindings = [],
  prioritizedArtifacts = [],
  contextSource = "none",
  consistency,
  currentStateResolution,
  sessionResolution,
  cycleStatusResolution,
} = {}) {
  const runtimeStateMode = String(dbBackedMode ? effectiveStateMode : (hydrated?.state_mode ?? "files"));
  const governanceMetadata = deriveGovernedRuntimeArtifactMetadata({
    workspace,
    runtimeStateMode,
    lifecycleStatus: freshness.freshness === "stale" ? "stale" : "refreshed",
  });
  return {
    contract_version: governanceMetadata.contract_version,
    updated_at: updatedAt ?? new Date().toISOString(),
    project_id: workspace.project_id,
    project_id_source: workspace.project_id_source,
    project_root: workspace.project_root,
    workspace_id: workspace.workspace_id,
    worktree_id: workspace.worktree_id,
    runtime_state_mode: runtimeStateMode,
    repair_layer_status: repairSummary.status,
    repair_layer_advice: repairSummary.advice,
    repair_primary_reason: repairPrimaryReason,
    repair_routing_hint: repairRouting.routing_hint,
    repair_routing_reason: repairRouting.routing_reason,
    shared_runtime_validation_status: sharedRuntimeValidation.status,
    active_backlog: sharedPlanning.active_backlog,
    backlog_status: sharedPlanning.backlog_status,
    backlog_next_step: sharedPlanning.backlog_next_step,
    planning_arbitration_status: sharedPlanning.planning_arbitration_status,
    shared_planning_source: sharedPlanning.shared_planning_source,
    shared_planning_read_status: sharedPlanning.shared_planning_read_status,
    source_of_truth: governanceMetadata.source_of_truth,
    source_mode: governanceMetadata.source_mode,
    lifecycle_status: governanceMetadata.lifecycle_status,
    owner: governanceMetadata.owner,
    steward: governanceMetadata.steward,
    current_state_freshness: freshness.freshness,
    current_state_freshness_basis: freshness.basis,
    blocking_findings: blockingFindings,
    prioritized_artifacts: prioritizedArtifacts,
    context_source: contextSource,
    consistency_status: consistency.pass ? "pass" : "fail",
    current_state_source: currentStateResolution.source,
    session_artifact_source: sessionResolution.source,
    cycle_status_source: cycleStatusResolution.source,
  };
}
