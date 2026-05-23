import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listCliEffectPolicies } from "../../core/cli/effect-policy.mjs";
import { evaluateMetadataPolicy, getMetadataPolicy, listMetadataPolicies } from "../../core/metadata/metadata-policy.mjs";
import { evaluateSourceOfTruthPolicy, getSourceOfTruthPolicy, listSourceOfTruthPolicies } from "../../core/source-of-truth/source-of-truth-policy.mjs";
import {
  loadSqliteIndexPayloadSafe,
  resolveAuditArtifactText,
  resolveDbArtifactSourceName,
  resolveDbBackedMode,
} from "../../../tools/runtime/db-first-runtime-view-lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CONTRACT_DIR = path.join(REPO_ROOT, "src", "core", "contracts", "cli-output");

export const GOVERNED_CONCEPTS = Object.freeze([
  {
    concept: "project",
    source_of_truth_concept: "project_policy",
    metadata_concept: "project",
    required: ["source_of_truth", "metadata"],
  },
  {
    concept: "workspace",
    source_of_truth_concept: "workspace_identity",
    metadata_concept: "workspace",
    required: ["source_of_truth", "metadata"],
  },
  {
    concept: "session",
    source_of_truth_concept: "session_state",
    metadata_concept: "session",
    required: ["source_of_truth", "metadata"],
  },
  {
    concept: "cycle",
    source_of_truth_concept: "cycle_state",
    metadata_concept: "cycle_status",
    required: ["source_of_truth", "metadata"],
  },
  {
    concept: "artifact",
    source_of_truth_concept: "artifact_inventory",
    metadata_concept: "artifact",
    required: ["source_of_truth", "metadata"],
  },
  {
    concept: "current_state",
    source_of_truth_concept: "runtime_digests",
    metadata_concept: "current_state",
    required: ["source_of_truth", "metadata"],
  },
  {
    concept: "runtime_state",
    source_of_truth_concept: "runtime_digests",
    metadata_concept: "runtime_state",
    cli_contract: "runtime-project-runtime-state.v1.schema.json",
    required: ["source_of_truth", "metadata", "cli_contract"],
  },
  {
    concept: "handoff_packet",
    source_of_truth_concept: "runtime_digests",
    metadata_concept: "handoff_packet",
    cli_contract: "runtime-project-handoff-packet.v1.schema.json",
    required: ["source_of_truth", "metadata", "cli_contract"],
  },
  {
    concept: "agent_roster",
    source_of_truth_concept: "agent_roster",
    cli_contract: "runtime-verify-agent-roster.v1.schema.json",
    required: ["source_of_truth", "cli_contract"],
  },
  {
    concept: "repair_finding",
    source_of_truth_concept: "repair_findings",
    metadata_concept: "repair_finding",
    required: ["source_of_truth", "metadata"],
  },
  {
    concept: "coordination_record",
    source_of_truth_concept: "coordination_records",
    metadata_concept: "coordination_record",
    required: ["source_of_truth", "metadata"],
  },
  {
    concept: "coordination_summary",
    source_of_truth_concept: "coordination_records",
    metadata_concept: "coordination_summary",
    required: ["source_of_truth", "metadata"],
  },
  {
    concept: "coordination_log",
    source_of_truth_concept: "coordination_records",
    metadata_concept: "coordination_log",
    required: ["source_of_truth", "metadata"],
  },
  {
    concept: "user_arbitration",
    source_of_truth_concept: "coordination_records",
    metadata_concept: "user_arbitration",
    required: ["source_of_truth", "metadata"],
  },
  {
    concept: "cli_output_contract",
    source_of_truth_concept: "cli_output_contracts",
    metadata_concept: "artifact_contract",
    required: ["source_of_truth", "metadata"],
  },
]);

export const GOVERNANCE_RUNTIME_SURFACES = Object.freeze([
  { id: "runtime-db-status", linked_concepts: ["workspace", "coordination_record"] },
  { id: "runtime-persistence-status", linked_concepts: ["workspace", "coordination_record"] },
  { id: "runtime-persistence-adopt", linked_concepts: ["workspace", "coordination_record"] },
  { id: "runtime-persistence-source-normalize", linked_concepts: ["cycle", "session", "workspace"] },
  { id: "runtime-db-migrate", linked_concepts: ["workspace", "coordination_record"] },
  { id: "runtime-persistence-migrate", linked_concepts: ["workspace", "coordination_record"] },
  { id: "runtime-db-backup", linked_concepts: ["workspace", "coordination_record"] },
  { id: "runtime-persistence-backup", linked_concepts: ["workspace", "coordination_record"] },
  { id: "runtime-persistence-source-diagnose", linked_concepts: ["workspace", "coordination_record"] },
  { id: "runtime-shared-coordination-migrate", linked_concepts: ["workspace", "coordination_record"] },
  { id: "runtime-shared-coordination-status", linked_concepts: ["workspace", "coordination_record"] },
  { id: "runtime-shared-coordination-backup", linked_concepts: ["workspace", "coordination_record"] },
  { id: "runtime-shared-coordination-restore", linked_concepts: ["workspace", "coordination_record"] },
  { id: "runtime-shared-coordination-doctor", linked_concepts: ["workspace", "coordination_record"] },
  { id: "runtime-shared-runtime-reanchor", linked_concepts: ["workspace"] },
  { id: "runtime-shared-coordination-bootstrap", linked_concepts: ["workspace", "coordination_record"] },
  { id: "runtime-governance-diagnostics", linked_concepts: ["cli_output_contract", "workspace"] },
  { id: "runtime-coordinator-select-agent", linked_concepts: ["agent_roster", "workspace"] },
  { id: "runtime-project-agent-health-summary", linked_concepts: ["agent_roster", "workspace"] },
  { id: "runtime-project-agent-selection-summary", linked_concepts: ["agent_roster", "workspace"] },
  { id: "runtime-project-integration-risk", linked_concepts: ["current_state", "cycle", "session"] },
  { id: "runtime-project-multi-agent-status", linked_concepts: ["agent_roster", "current_state", "coordination_summary"] },
  { id: "runtime-project-coordination-summary", linked_concepts: ["coordination_summary", "coordination_record"] },
  { id: "runtime-sync-db-first", linked_concepts: ["artifact", "workspace"] },
  { id: "runtime-sync-db-first-selective", linked_concepts: ["artifact", "workspace"] },
  { id: "runtime-mode-migrate", linked_concepts: ["artifact", "workspace"] },
  { id: "runtime-pre-write-admit", linked_concepts: ["workspace", "session", "cycle"] },
  { id: "runtime-handoff-admit", linked_concepts: ["handoff_packet", "session", "cycle"] },
  { id: "runtime-coordinator-next-action", linked_concepts: ["current_state", "runtime_state", "handoff_packet"] },
  { id: "runtime-coordinator-loop", linked_concepts: ["current_state", "runtime_state", "handoff_packet", "coordination_summary"] },
  { id: "runtime-coordinator-dispatch-plan", linked_concepts: ["current_state", "runtime_state", "handoff_packet", "coordination_record"] },
  { id: "runtime-coordinator-dispatch-execute", linked_concepts: ["coordination_record", "coordination_summary", "coordination_log", "runtime_state"] },
  { id: "runtime-coordinator-orchestrate", linked_concepts: ["coordination_record", "handoff_packet", "runtime_state"] },
  { id: "runtime-coordinator-resume", linked_concepts: ["coordination_record", "handoff_packet", "runtime_state"] },
  { id: "runtime-coordinator-suggest-arbitration", linked_concepts: ["coordination_record", "handoff_packet", "runtime_state"] },
  { id: "runtime-coordinator-record-arbitration", linked_concepts: ["coordination_record", "user_arbitration", "coordination_summary"] },
  { id: "runtime-project-runtime-state", linked_concepts: ["runtime_state", "current_state"] },
  { id: "runtime-project-handoff-packet", linked_concepts: ["handoff_packet", "session", "cycle"] },
  { id: "runtime-verify-agent-roster", linked_concepts: ["agent_roster"] },
]);

const OBSERVED_GOVERNANCE_ARTIFACTS = Object.freeze([
  {
    id: "current_state",
    concept: "current_state",
    source_of_truth_concept: "runtime_digests",
    relative_path: "docs/audit/CURRENT-STATE.md",
  },
  {
    id: "runtime_state",
    concept: "runtime_state",
    source_of_truth_concept: "runtime_digests",
    relative_path: "docs/audit/RUNTIME-STATE.md",
  },
  {
    id: "handoff_packet",
    concept: "handoff_packet",
    source_of_truth_concept: "runtime_digests",
    relative_path: "docs/audit/HANDOFF-PACKET.md",
  },
  {
    id: "coordination_summary",
    concept: "coordination_summary",
    source_of_truth_concept: "coordination_records",
    relative_path: "docs/audit/COORDINATION-SUMMARY.md",
  },
  {
    id: "coordination_log",
    concept: "coordination_log",
    source_of_truth_concept: "coordination_records",
    relative_path: "docs/audit/COORDINATION-LOG.md",
  },
  {
    id: "user_arbitration",
    concept: "user_arbitration",
    source_of_truth_concept: "coordination_records",
    relative_path: "docs/audit/USER-ARBITRATION.md",
  },
]);

function contractExists(fileName) {
  return Boolean(fileName) && fs.existsSync(path.join(CONTRACT_DIR, fileName));
}

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function parseSimpleMap(text) {
  const map = new Map();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z0-9_]+):\s*(.+)$/);
    if (!match) {
      continue;
    }
    map.set(match[1], normalizeScalar(match[2]));
  }
  return map;
}

function deriveStatus({ required, checks }) {
  const missing = required.filter((key) => checks[key] !== true);
  if (missing.length === 0) {
    return "complete";
  }
  if (missing.length < required.length) {
    return "partial";
  }
  return "missing";
}

export function evaluateGovernedConcept(entry) {
  const sourceOfTruth = entry.source_of_truth_concept
    ? getSourceOfTruthPolicy(entry.source_of_truth_concept)
    : null;
  const metadata = entry.metadata_concept
    ? getMetadataPolicy(entry.metadata_concept)
    : null;
  const cliContract = entry.cli_contract
    ? contractExists(entry.cli_contract)
    : false;
  const checks = {
    source_of_truth: Boolean(sourceOfTruth),
    metadata: Boolean(metadata),
    cli_contract: entry.cli_contract ? cliContract : true,
  };
  const required = entry.required ?? [];
  const status = deriveStatus({ required, checks });
  return {
    concept: entry.concept,
    status,
    required,
    source_of_truth_concept: entry.source_of_truth_concept ?? "",
    source_of_truth_status: checks.source_of_truth ? "covered" : "missing",
    metadata_concept: entry.metadata_concept ?? "",
    metadata_status: entry.metadata_concept ? (checks.metadata ? "covered" : "missing") : "not_applicable",
    cli_contract: entry.cli_contract ?? "",
    cli_contract_status: entry.cli_contract ? (cliContract ? "covered" : "missing") : "not_applicable",
    issues: required
      .filter((key) => checks[key] !== true)
      .map((key) => `${entry.concept}: missing ${key}`),
  };
}

export function findGovernanceContractCoverageIssues() {
  const policies = listCliEffectPolicies();
  const issues = [];
  for (const policy of policies) {
    if (!policy.json_contract) {
      continue;
    }
    if (!contractExists(policy.json_contract)) {
      issues.push(`${policy.id}: missing CLI JSON contract ${policy.json_contract}`);
    }
  }
  return issues;
}

export function findGovernanceRegistryCoverageIssues() {
  const issues = [];
  const sotConcepts = new Set(listSourceOfTruthPolicies().map((item) => item.concept));
  const metadataConcepts = new Set(listMetadataPolicies().map((item) => item.concept));
  for (const entry of GOVERNED_CONCEPTS) {
    if (entry.source_of_truth_concept && !sotConcepts.has(entry.source_of_truth_concept)) {
      issues.push(`${entry.concept}: source-of-truth concept is not registered: ${entry.source_of_truth_concept}`);
    }
    if (entry.metadata_concept && !metadataConcepts.has(entry.metadata_concept)) {
      issues.push(`${entry.concept}: metadata concept is not registered: ${entry.metadata_concept}`);
    }
  }
  return issues;
}

export function summarizeGovernedConcepts(items) {
  const summary = {
    complete: 0,
    partial: 0,
    missing: 0,
  };
  for (const item of items) {
    summary[item.status] = (summary[item.status] ?? 0) + 1;
  }
  return summary;
}

export function evaluateGovernanceRuntimeSurface(entry, conceptIndex = new Map()) {
  const policy = listCliEffectPolicies().find((item) => item.id === entry.id) ?? null;
  const linkedConcepts = (entry.linked_concepts ?? []).map((conceptId) => {
    const concept = conceptIndex.get(conceptId) ?? null;
    return {
      concept: conceptId,
      status: concept?.status ?? "missing",
    };
  });
  const linkedStatuses = linkedConcepts.map((item) => item.status);
  const linkedConceptCoverageStatus = linkedStatuses.includes("missing")
    ? "gaps-detected"
    : (linkedStatuses.includes("partial") ? "partial" : "covered");
  const issues = [];
  if (!policy) {
    issues.push(`${entry.id}: missing CLI effect policy`);
  }
  if (policy && !policy.json_contract) {
    issues.push(`${entry.id}: missing CLI JSON contract mapping`);
  }
  if (policy?.json_contract && !contractExists(policy.json_contract)) {
    issues.push(`${entry.id}: missing CLI JSON contract file ${policy.json_contract}`);
  }
  for (const linkedConcept of linkedConcepts) {
    if (linkedConcept.status !== "complete") {
      issues.push(`${entry.id}: linked concept ${linkedConcept.concept} is ${linkedConcept.status}`);
    }
  }
  const status = issues.length === 0
    ? "covered"
    : (policy ? "partial" : "missing");
  return {
    id: entry.id,
    command: policy?.command ?? "",
    effect_class: policy?.effect_class ?? "missing",
    stability: policy?.stability ?? "missing",
    json_contract: policy?.json_contract ?? "",
    json_contract_status: policy?.json_contract
      ? (contractExists(policy.json_contract) ? "covered" : "missing")
      : "missing",
    linked_concepts: linkedConcepts,
    linked_concept_coverage_status: linkedConceptCoverageStatus,
    status,
    issues,
  };
}

function createObservedArtifactResolver(targetRoot) {
  const absoluteTargetRoot = path.resolve(targetRoot);
  const { dbBackedMode } = resolveDbBackedMode(absoluteTargetRoot);
  const sqliteIndex = dbBackedMode
    ? loadSqliteIndexPayloadSafe(absoluteTargetRoot)
    : { payload: null, runtimeHeads: null, backend: null };
  const dbSource = resolveDbArtifactSourceName(sqliteIndex.backend);
  return (relativePath) => resolveAuditArtifactText({
    targetRoot: absoluteTargetRoot,
    candidatePath: relativePath,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteIndex.payload,
    sqliteRuntimeHeads: sqliteIndex.runtimeHeads,
    dbSource,
  });
}

export function evaluateObservedGovernanceArtifact(entry, targetRoot, resolveArtifactText = null) {
  const resolution = typeof resolveArtifactText === "function"
    ? resolveArtifactText(entry.relative_path)
    : resolveAuditArtifactText({
      targetRoot: path.resolve(targetRoot),
      candidatePath: entry.relative_path,
    });
  const fields = parseSimpleMap(resolution.text);
  const runtimeStateMode = normalizeScalar(fields.get("runtime_state_mode") ?? "files") || "files";
  const sourceOfTruth = evaluateSourceOfTruthPolicy(entry.source_of_truth_concept, runtimeStateMode);
  const metadata = evaluateMetadataPolicy(entry.concept, {
    contract_version: normalizeScalar(fields.get("contract_version") ?? ""),
    updated_at: normalizeScalar(fields.get("updated_at") ?? ""),
    history_status: normalizeScalar(fields.get("history_status") ?? ""),
    runtime_state_mode: normalizeScalar(fields.get("runtime_state_mode") ?? ""),
    active_session: normalizeScalar(fields.get("active_session") ?? ""),
    active_cycle: normalizeScalar(fields.get("active_cycle") ?? ""),
    handoff_status: normalizeScalar(fields.get("handoff_status") ?? ""),
    repair_layer_status: normalizeScalar(fields.get("repair_layer_status") ?? ""),
    source_of_truth: normalizeScalar(fields.get("source_of_truth") ?? ""),
    source_mode: normalizeScalar(fields.get("source_mode") ?? ""),
    lifecycle_status: normalizeScalar(fields.get("lifecycle_status") ?? ""),
    owner: normalizeScalar(fields.get("owner") ?? ""),
    steward: normalizeScalar(fields.get("steward") ?? ""),
    privacy_classification: normalizeScalar(fields.get("privacy_classification") ?? ""),
    retention_policy: normalizeScalar(fields.get("retention_policy") ?? ""),
  });
  const issues = [];
  if (!resolution.exists) {
    issues.push(`${entry.id}: artifact missing at ${entry.relative_path}`);
  }
  if (metadata.metadata_status !== "complete") {
    issues.push(...metadata.metadata_findings.map((item) => `${entry.id}: ${item.code}:${item.field}`));
  }
  return {
    id: entry.id,
    concept: entry.concept,
    relative_path: entry.relative_path,
    exists: resolution.exists,
    source: resolution.source,
    runtime_state_mode: runtimeStateMode,
    source_of_truth: {
      concept: sourceOfTruth.concept,
      source_of_truth_status: sourceOfTruth.source_of_truth_status,
      source_of_truth: sourceOfTruth.source_of_truth ?? null,
    },
    metadata: {
      concept: metadata.concept,
      metadata_status: metadata.metadata_status,
      missing_required_fields: metadata.missing_required_fields,
      missing_recommended_fields: metadata.missing_recommended_fields,
      surfaced_fields: metadata.surfaced_fields,
    },
    issues,
  };
}

function deriveCoverageStatus(summary, field) {
  const total = (summary.complete ?? 0) + (summary.partial ?? 0) + (summary.missing ?? 0);
  if (total === 0) {
    return "unknown";
  }
  if ((summary.missing ?? 0) > 0) {
    return field === "overall" ? "incomplete" : "gaps-detected";
  }
  if ((summary.partial ?? 0) > 0) {
    return "partial";
  }
  return "covered";
}

export function deriveGovernanceOperations({ concepts, issues }) {
  const sourceOfTruthSummary = summarizeGovernedConcepts(concepts.map((item) => ({
    status: item.source_of_truth_status === "covered" ? "complete" : "missing",
  })));
  const metadataSummary = summarizeGovernedConcepts(concepts
    .filter((item) => item.metadata_status !== "not_applicable")
    .map((item) => ({
      status: item.metadata_status === "covered" ? "complete" : "missing",
    })));
  const cliContractSummary = summarizeGovernedConcepts(concepts
    .filter((item) => item.cli_contract_status !== "not_applicable")
    .map((item) => ({
      status: item.cli_contract_status === "covered" ? "complete" : "missing",
    })));
  const recommendedActions = [];
  if (issues.length > 0) {
    recommendedActions.push("review the missing source-of-truth, metadata, or CLI contract coverage before expanding runtime surfaces");
    recommendedActions.push("run npm run perf:verify-governance-completeness after each governance remediation");
  } else {
    recommendedActions.push("governance coverage is complete for the currently tracked concepts");
  }
  return {
    local_first: true,
    source_of_truth_coverage_status: deriveCoverageStatus(sourceOfTruthSummary, "source_of_truth"),
    metadata_coverage_status: deriveCoverageStatus(metadataSummary, "metadata"),
    cli_contract_coverage_status: deriveCoverageStatus(cliContractSummary, "cli_contract"),
    overall_status: issues.length === 0 ? "covered" : "gaps-detected",
    governed_concept_count: concepts.length,
    issue_count: issues.length,
    recommended_actions: recommendedActions,
  };
}

export function summarizeGovernanceRuntimeSurfaces(items) {
  const summary = {
    covered: 0,
    partial: 0,
    missing: 0,
  };
  for (const item of items) {
    summary[item.status] = (summary[item.status] ?? 0) + 1;
  }
  return summary;
}

function deriveRuntimeSurfaceCoverageStatus(summary) {
  if ((summary.missing ?? 0) > 0) {
    return "gaps-detected";
  }
  if ((summary.partial ?? 0) > 0) {
    return "partial";
  }
  return "covered";
}

function summarizeObservedArtifacts(items) {
  const summary = {
    complete: 0,
    partial: 0,
    missing: 0,
  };
  for (const item of items) {
    const status = !item.exists
      ? "missing"
      : (item.metadata.metadata_status === "complete" ? "complete" : "partial");
    summary[status] = (summary[status] ?? 0) + 1;
  }
  return summary;
}

export function projectGovernanceDiagnostics({ targetRoot = ".", workspace = null, includeObservedArtifacts = true } = {}) {
  const concepts = GOVERNED_CONCEPTS.map(evaluateGovernedConcept);
  const conceptIndex = new Map(concepts.map((item) => [item.concept, item]));
  const runtimeSurfaces = GOVERNANCE_RUNTIME_SURFACES.map((entry) => evaluateGovernanceRuntimeSurface(entry, conceptIndex));
  const resolveObservedArtifactText = includeObservedArtifacts
    ? createObservedArtifactResolver(targetRoot)
    : null;
  const observedArtifacts = includeObservedArtifacts
    ? OBSERVED_GOVERNANCE_ARTIFACTS.map((entry) => evaluateObservedGovernanceArtifact(entry, targetRoot, resolveObservedArtifactText))
    : [];
  const issues = [
    ...concepts.flatMap((item) => item.issues),
    ...runtimeSurfaces.flatMap((item) => item.issues),
    ...observedArtifacts.flatMap((item) => item.issues),
    ...findGovernanceContractCoverageIssues(),
    ...findGovernanceRegistryCoverageIssues(),
  ];
  const summary = summarizeGovernedConcepts(concepts);
  const runtimeSurfaceSummary = summarizeGovernanceRuntimeSurfaces(runtimeSurfaces);
  const observedArtifactSummary = summarizeObservedArtifacts(observedArtifacts);
  const operations = deriveGovernanceOperations({
    concepts,
    issues,
  });
  return {
    ts: new Date().toISOString(),
    target_root: targetRoot,
    workspace,
    ok: issues.length === 0,
    governed_concepts: concepts.length,
    summary,
    registry: {
      source_of_truth_policy_count: listSourceOfTruthPolicies().length,
      metadata_policy_count: listMetadataPolicies().length,
      cli_effect_policy_count: listCliEffectPolicies().length,
      runtime_surface_count: runtimeSurfaces.length,
      observed_artifact_count: observedArtifacts.length,
      observed_artifacts_included: includeObservedArtifacts,
      cli_contract_directory: "src/core/contracts/cli-output",
    },
    concepts,
    runtime_surfaces: runtimeSurfaces,
    runtime_surface_summary: runtimeSurfaceSummary,
    observed_artifacts: observedArtifacts,
    observed_artifact_summary: observedArtifactSummary,
    issues,
    operations: {
      ...operations,
      runtime_surface_coverage_status: deriveRuntimeSurfaceCoverageStatus(runtimeSurfaceSummary),
      observed_artifact_coverage_status: includeObservedArtifacts
        ? deriveCoverageStatus(observedArtifactSummary, "overall")
        : "not_included",
    },
  };
}
