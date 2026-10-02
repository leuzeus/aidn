import { listGovernanceCoverageExceptions } from "../governance/concept-coverage.mjs";
import { getSourceOfTruthPolicy } from "../source-of-truth/source-of-truth-policy.mjs";

const METADATA_POLICY_VERSION = "metadata-policy-v1";

function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function freezeDeep(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  for (const nested of Object.values(value)) {
    freezeDeep(nested);
  }
  return Object.freeze(value);
}

function policy({
  concept,
  label,
  required,
  sourceOfTruthConcept,
  evidenceTargets,
  recommended = [],
  legacyTolerated = [],
  lifecycle = "draft -> active -> verified -> archived",
  notes = "",
}) {
  const sourcePolicy = getSourceOfTruthPolicy(sourceOfTruthConcept);
  if (!sourcePolicy) {
    throw new Error(`Missing source-of-truth policy for metadata concept ${concept}: ${sourceOfTruthConcept}`);
  }
  if (!Array.isArray(evidenceTargets) || evidenceTargets.length === 0) {
    throw new Error(`Missing concept-specific evidence targets for metadata concept ${concept}`);
  }
  return freezeDeep({
    concept: normalizeKey(concept),
    label,
    policy_version: METADATA_POLICY_VERSION,
    required_fields: [...required].map(normalizeKey).filter(Boolean),
    recommended_fields: [...recommended].map(normalizeKey).filter(Boolean),
    legacy_tolerated_missing_fields: [...legacyTolerated].map(normalizeKey).filter(Boolean),
    lifecycle,
    source_of_truth_concept: sourcePolicy.concept,
    owner: sourcePolicy.owner,
    scope: sourcePolicy.scope,
    retention: sourcePolicy.retention,
    migration: sourcePolicy.migration,
    replacement: sourcePolicy.replacement,
    ...(sourcePolicy.coverage_kind ? { coverage_kind: sourcePolicy.coverage_kind } : {}),
    ...(sourcePolicy.authority_backend ? { authority_backend: sourcePolicy.authority_backend } : {}),
    evidence_targets: [...evidenceTargets],
    notes,
  });
}

const COMMON_OPERATIONAL_FIELDS = Object.freeze([
  "id",
  "type",
  "updated_at",
  "source_of_truth",
  "source_mode",
  "lifecycle_status",
]);

const GOVERNED_CONTENT_FIELDS = Object.freeze([
  "contract_version",
  "owner",
  "steward",
  "privacy_classification",
  "retention_policy",
]);

const METADATA_POLICIES = freezeDeep([
  policy({
    concept: "workflow_instance", label: "Durable workflow instance",
    required: ["contract_version", "instance_id", "revision", "definition", "compilation", "scope", "events", "instance_sha256"],
    sourceOfTruthConcept: "workflow_instance",
    evidenceTargets: ["src/core/contracts/workflow-definition/workflow-instance.v1.schema.json", "src/core/workflow/workflow-instance.mjs", "src/application/runtime/workflow-instance-service.mjs"],
    lifecycle: "waiting -> reconciliation_required -> waiting|terminal",
    notes: "Pinned definition, compilation and context with ordered human decisions, segment intents and observed supervisor results. Revision equals event count plus one. Run identities cannot repeat within an instance. CAS rejects competing revisions; abandoned file locks and uncertain effects require explicit reconciliation. Preserve execution, acceptance, integration, validation and cleanup distinctions. Internal API and durable fixtures do not establish native qualification.",
  }),
  policy({
    concept: "execution_run",
    label: "Bounded execution run",
    required: ["contract_version", "run_id", "plan_id", "plan_sha256", "authority_backend", "canonical", "task_ids", "lifecycle_status"],
    sourceOfTruthConcept: "execution_run",
    evidenceTargets: ["src/core/agents/agent-execution-contracts.mjs", "src/core/contracts/agent-execution", "src/core/ports/agent-execution-store-port.mjs", "src/adapters/runtime/postgres-agent-execution-store.mjs", "tools/perf/sql/shared-coordination-postgres-v3.sql", "tools/perf/sql/shared-coordination-postgres-v4.sql", "tools/perf/sql/shared-coordination-postgres-v5.sql", "tools/perf/sql/shared-coordination-postgres-v6.sql", "src/application/runtime/agent-run-lifecycle-service.mjs", "src/core/workflow/workflow-segment-binding.mjs", "src/core/contracts/workflow-definition/workflow-segment-binding.v1.schema.json", "src/application/runtime/agent-run-cleanup-service.mjs", "src/core/contracts/cli-output/runtime-agent-run.v1.schema.json", "src/adapters/runtime/local-agent-verification.mjs", "src/application/runtime/agent-run-supervisor.mjs", "src/application/runtime/agent-task-integration-service.mjs"],
    lifecycle: "planned -> running -> completed|failed|cancelled|recovery_required",
    notes: "PostgreSQL supervision metadata with a fenced supervisor generation and durable run deadline. Public agent-run, agent-run-status, agent-run-resume, agent-run-cancel and agent-run-cleanup form a conditional native prototype requiring explicit pinned configuration and matching qualification. Explicit configuration v2 retains a run-local workflow segment binding under the frozen plan configuration hash; retain the exact configuration with evidence. It grants no macro progress or admission and introduces no new information authority. Reservation binds canonical runtime and shared planning in one transaction. Supervisor ownership, frozen verification controls and proof authority, authenticated final validation and exact integrated SHA belong to the run. Immutable cancellation requests and cleanup resource journals with independently fenced cleaner generations belong to this concept. Validation, integration and cleanup remain separate from execution status; completed-only cleanup retains archives, transcripts and refs with no automatic purge. Codex supplies and configures its sandbox outside the AIDN lifecycle. AIDN retains run authority and native qualification evidence, not host setup journals or Windows administration. Missing or incompatible native prerequisites refuse execution without repair or fallback. Preserve superseded records without automatic purge.",
  }),
  policy({
    concept: "delegated_task",
    label: "Delegated task",
    required: ["contract_version", "run_id", "task_id", "plan_sha256", "task_contract_sha256", "objective", "scope", "acceptance_criteria", "max_duration_ms"],
    sourceOfTruthConcept: "delegated_task",
    evidenceTargets: ["src/core/agents/agent-execution-contracts.mjs", "src/core/contracts/agent-execution", "src/core/ports/agent-execution-store-port.mjs", "src/adapters/runtime/postgres-agent-execution-store.mjs", "tools/perf/sql/shared-coordination-postgres-v3.sql", "tools/perf/sql/shared-coordination-postgres-v4.sql", "tools/perf/sql/shared-coordination-postgres-v5.sql", "tools/perf/sql/shared-coordination-postgres-v6.sql", "src/application/runtime/agent-run-lifecycle-service.mjs", "src/application/runtime/agent-run-cleanup-service.mjs", "src/core/contracts/cli-output/runtime-agent-run.v1.schema.json", "src/adapters/runtime/local-agent-verification.mjs", "src/application/runtime/agent-run-supervisor.mjs", "src/application/runtime/agent-task-integration-service.mjs"],
    lifecycle: "pending -> ready -> running -> accepted|failed|blocked|cancelled",
    notes: "Frozen task descriptor with dependencies, exact scope and optional validation selection. Omitted validation_ids retains all plan validations; final run validation always covers the full plan. The scheduler admits a dependent only after accepted predecessors have applied integration records. Integration intent and prepared/applied evidence belong to the task within the run, remain durable and never replace its immutable acceptance. Public lifecycle commands are a conditional native prototype; metadata completeness does not establish native qualification or a runtime task instance. Cancellation and cleanup remain records of the parent run; no automatic purge.",
  }),
  policy({
    concept: "execution_attempt",
    label: "Execution attempt",
    required: ["contract_version", "run_id", "task_id", "attempt_id", "ordinal", "plan_sha256", "task_contract_sha256", "input_sha", "worktree", "activation", "ownership", "lifecycle_status"],
    sourceOfTruthConcept: "execution_attempt",
    evidenceTargets: ["src/core/agents/agent-execution-contracts.mjs", "src/core/contracts/agent-execution", "src/core/ports/agent-task-executor-port.mjs", "src/core/ports/agent-execution-store-port.mjs", "src/adapters/runtime/postgres-agent-execution-store.mjs", "tools/perf/sql/shared-coordination-postgres-v3.sql", "tools/perf/sql/shared-coordination-postgres-v4.sql", "tools/perf/sql/shared-coordination-postgres-v5.sql", "tools/perf/sql/shared-coordination-postgres-v6.sql", "src/application/runtime/agent-run-lifecycle-service.mjs", "src/application/runtime/agent-run-cleanup-service.mjs", "src/core/contracts/cli-output/runtime-agent-run.v1.schema.json", "src/adapters/runtime/local-agent-verification.mjs", "src/application/runtime/agent-run-supervisor.mjs", "src/application/runtime/agent-task-integration-service.mjs"],
    lifecycle: "launch_intended -> running -> completed|failed|cancelled|timed_out|recovery_required",
    notes: "Attempt with PostgreSQL-timed ownership, durable preparation and launch intent, immutable events, terminal result and acceptance. Preparation evidence is separate from worker event sequences and is reloaded without rerunning a worker or bootstrap. Authenticated verification observations bind acceptance to the actual task commit. Exit zero is not acceptance; stale ownership and unconfirmed descendants require reconciliation without automatic reassignment. Cancellation suppresses new worker tools while allowing termination facts. Run-owned cleanup requires completed, accepted and integrated results; failed or uncertain resources remain retained. Bulk output remains local with bounded hash and size references and no automatic purge. The conditional native prototype and injected verifier fixtures do not establish native qualification.",
  }),
  policy({
    concept: "project_activation",
    label: "Project workflow activation",
    required: ["schema_version", "scope", "authority_id", "revision", "status", "integrity_sha256"],
    sourceOfTruthConcept: "project_activation",
    evidenceTargets: ["src/application/install/project-activation-service.mjs"],
    lifecycle: "absent -> authorized -> revoked",
    notes: "Repository-local authorization revision is distinct from each worktree installation receipt and native client trust. Integrity checks detect corruption, not an adversarial local editor. Public diagnostics expose only state, active, scope, authority_id, revision and errors.",
  }),
  policy({
    concept: "install_assets",
    label: "Local installation ownership",
    required: ["schema_version", "scope", "root_id", "package", "assets", "last_transaction", "last_action"],
    sourceOfTruthConcept: "install_assets",
    evidenceTargets: ["src/application/install/codex-assets-service.mjs", "src/application/install/installation-ownership-service.mjs", "tools/setup/global-project-provision.mjs"],
    recommended: ["installation", "installation_last_transaction", "installation_last_action", "global_skills_migration", "global_runtime"],
    lifecycle: "planned -> applying -> installed|interrupted -> repaired|rolled_back|uninstalled",
    notes: "Receipt carries package binding, owned object hashes and optional installation completion metadata; legacy Codex-only receipts remain valid. install.aidnVersion in config is a projection of the last complete successful installation, never native trust or current asset integrity. Transaction pre-images stay local and are omitted from public plans. Explicit global_skills_migration binds an absolute host and config pre/post-images in the same receipt; restoration requires unchanged post-image. Optional global_runtime records schema_version, home, installation_id and integration_revision; host state owns active/previous generation pointers, verified file manifests and Codex asset hashes, separately from the project's historical installation version.",
  }),
  policy({
    concept: "workflow_rules",
    label: "Workflow rules",
    required: ["contract_version", "owner", "source_of_truth", "updated_at", "lifecycle_status"],
    sourceOfTruthConcept: "workflow_rules",
    evidenceTargets: ["docs/agents/01-architecture-executable.md"],
    recommended: ["steward", "retention_policy"],
    lifecycle: "authored -> active -> superseded -> archived",
  }),
  policy({
    concept: "project",
    label: "Project",
    required: ["project_id", "owner", "source_of_truth", "updated_at", "lifecycle_status"],
    sourceOfTruthConcept: "project_policy",
    evidenceTargets: ["src/lib/config/workflow-adapter-config-lib.mjs"],
    recommended: ["steward", "privacy_classification", "retention_policy"],
    lifecycle: "draft -> active -> archived",
  }),
  policy({
    concept: "workspace",
    label: "Workspace",
    required: ["workspace_id", "worktree_id", "source_of_truth", "updated_at", "lifecycle_status"],
    sourceOfTruthConcept: "workspace_identity",
    evidenceTargets: ["src/application/runtime/workspace-resolution-service.mjs"],
    recommended: ["owner", "shared_runtime_mode", "privacy_classification"],
    lifecycle: "discovered -> active -> archived",
  }),
  policy({
    concept: "runtime_project_context",
    label: "Runtime project context",
    required: ["project_id", "workspace_id", "worktree_id", "runtime_scope_id", "source_of_truth", "updated_at", "lifecycle_status"],
    sourceOfTruthConcept: "runtime_project_context",
    evidenceTargets: ["src/application/runtime/runtime-project-context-service.mjs"],
    recommended: ["identity_source", "legacy_scope_key", "privacy_classification"],
    lifecycle: "resolved -> active -> migrated -> archived",
  }),
  policy({
    concept: "session",
    label: "Session",
    required: ["session_id", "contract_version", "owner", "state", "updated_at", "source_of_truth", "lifecycle_status"],
    sourceOfTruthConcept: "session_state",
    evidenceTargets: ["tools/perf/start-session-hook.mjs"],
    recommended: ["steward", "privacy_classification", "retention_policy"],
    legacyTolerated: ["owner", "source_of_truth", "lifecycle_status", "privacy_classification", "retention_policy"],
    lifecycle: "draft -> active -> closing -> closed -> archived",
  }),
  policy({
    concept: "cycle_status",
    label: "Cycle status",
    required: ["cycle_id", "contract_version", "owner", "state", "branch_name", "dor_state", "updated_at", "source_of_truth", "lifecycle_status"],
    sourceOfTruthConcept: "cycle_state",
    evidenceTargets: ["tools/perf/cycle-create-hook.mjs"],
    recommended: ["steward", "privacy_classification", "retention_policy"],
    legacyTolerated: ["cycle_id", "owner", "updated_at", "source_of_truth", "lifecycle_status", "privacy_classification", "retention_policy"],
    lifecycle: "open -> implementing -> verifying -> done -> promoted|archived",
  }),
  policy({
    concept: "artifact",
    label: "Artifact",
    required: [...COMMON_OPERATIONAL_FIELDS, "sha256", "scope"],
    sourceOfTruthConcept: "artifact_inventory",
    evidenceTargets: ["src/adapters/runtime/artifact-store.mjs"],
    recommended: [...GOVERNED_CONTENT_FIELDS, "confidence"],
    notes: "A canonical cycle plan may contain Native write scope version 1: tasks bind exact task text, implementation/exploration intent and explicit paths/operations. It is plan content in the existing artifact store, not a second authority or authorization cache.",
    legacyTolerated: ["owner", "steward", "privacy_classification", "retention_policy"],
    lifecycle: "draft -> active -> verified -> promoted|archived -> superseded",
  }),
  policy({
    concept: "current_state",
    label: "Current state digest",
    required: ["contract_version", "updated_at", "runtime_state_mode", "active_session", "active_cycle", "source_of_truth", "source_mode", "lifecycle_status"],
    sourceOfTruthConcept: "runtime_digests",
    evidenceTargets: ["tools/runtime/state-reanchor.mjs"],
    recommended: ["owner", "steward", "privacy_classification", "retention_policy"],
    legacyTolerated: ["source_of_truth", "source_mode", "lifecycle_status", "owner", "steward", "privacy_classification", "retention_policy"],
    lifecycle: "refreshed -> stale -> superseded",
  }),
  policy({
    concept: "runtime_state",
    label: "Runtime state digest",
    required: ["contract_version", "updated_at", "runtime_state_mode", "repair_layer_status", "source_of_truth", "source_mode", "lifecycle_status"],
    sourceOfTruthConcept: "runtime_digests",
    evidenceTargets: ["tools/runtime/project-runtime-state.mjs"],
    recommended: ["owner", "steward", "privacy_classification", "retention_policy"],
    legacyTolerated: ["source_of_truth", "source_mode", "lifecycle_status", "owner", "steward", "privacy_classification", "retention_policy"],
    lifecycle: "refreshed -> stale -> superseded",
  }),
  policy({
    concept: "handoff_packet",
    label: "Handoff packet",
    required: ["contract_version", "updated_at", "handoff_status", "active_session", "active_cycle", "source_of_truth", "source_mode", "lifecycle_status"],
    sourceOfTruthConcept: "runtime_digests",
    evidenceTargets: ["tools/runtime/project-handoff-packet.mjs"],
    recommended: ["owner", "steward", "privacy_classification", "retention_policy"],
    legacyTolerated: ["source_of_truth", "source_mode", "lifecycle_status", "owner", "steward", "privacy_classification", "retention_policy"],
    lifecycle: "draft -> ready -> consumed -> archived",
  }),
  policy({
    concept: "artifact_contract",
    label: "Artifact contract",
    required: ["artifact_type", "contract_version", "required_fields", "owner", "source_of_truth", "lifecycle_status"],
    sourceOfTruthConcept: "cli_output_contracts",
    evidenceTargets: ["src/core/contracts/cli-output"],
    recommended: ["steward", "deprecation_policy"],
    lifecycle: "proposed -> active -> deprecated -> retired",
  }),
  policy({
    concept: "decision",
    label: "Decision",
    required: ["decision_id", "type", "owner", "decided_at", "source_of_truth", "lifecycle_status"],
    sourceOfTruthConcept: "decision",
    evidenceTargets: ["tools/runtime/coordinator-record-arbitration.mjs"],
    recommended: ["steward", "linked_session", "linked_cycle", "traceability_links"],
    legacyTolerated: ["owner", "source_of_truth", "lifecycle_status"],
    lifecycle: "proposed -> accepted|rejected -> superseded",
  }),
  policy({
    concept: "incident",
    label: "Incident",
    required: ["incident_id", "severity", "owner", "status", "created_at", "updated_at", "source_of_truth", "lifecycle_status"],
    sourceOfTruthConcept: "incident",
    evidenceTargets: ["scaffold/docs_audit/incidents/TEMPLATE_INC_TMP.md"],
    recommended: ["steward", "resolution", "privacy_classification", "retention_policy"],
    legacyTolerated: ["source_of_truth", "lifecycle_status", "privacy_classification", "retention_policy"],
    lifecycle: "opened -> triaged -> mitigated -> closed -> archived",
  }),
  policy({
    concept: "repair_finding",
    label: "Repair finding",
    required: ["finding_id", "finding_type", "severity", "status", "source_of_truth", "updated_at", "lifecycle_status"],
    sourceOfTruthConcept: "repair_findings",
    evidenceTargets: ["src/application/runtime/repair-layer-use-case.mjs"],
    recommended: ["owner", "steward", "repair_action", "traceability_links"],
    lifecycle: "open -> triaged -> resolved|waived -> archived",
  }),
  policy({
    concept: "coordination_record",
    label: "Coordination record",
    required: ["record_id", "agent_id", "action", "status", "created_at", "source_of_truth", "lifecycle_status"],
    sourceOfTruthConcept: "coordination_records",
    evidenceTargets: ["src/core/ports/shared-coordination-store-port.mjs"],
    recommended: ["session_id", "cycle_id", "result_ref", "privacy_classification", "retention_policy"],
    lifecycle: "created -> processed -> archived",
  }),
  policy({
    concept: "coordination_summary",
    label: "Coordination summary",
    required: ["contract_version", "updated_at", "history_status", "source_of_truth", "source_mode", "lifecycle_status"],
    sourceOfTruthConcept: "coordination_summary",
    evidenceTargets: ["tools/runtime/project-coordination-summary.mjs"],
    recommended: ["owner", "steward", "privacy_classification", "retention_policy"],
    legacyTolerated: ["source_of_truth", "source_mode", "lifecycle_status", "owner", "steward", "privacy_classification", "retention_policy"],
    lifecycle: "refreshed -> stale -> superseded",
  }),
  policy({
    concept: "coordination_log",
    label: "Coordination log",
    required: ["contract_version", "updated_at", "source_of_truth", "source_mode", "lifecycle_status"],
    sourceOfTruthConcept: "coordination_log",
    evidenceTargets: ["scaffold/docs_audit/COORDINATION-LOG.md"],
    recommended: ["owner", "steward", "privacy_classification", "retention_policy"],
    legacyTolerated: ["source_of_truth", "source_mode", "lifecycle_status", "owner", "steward", "privacy_classification", "retention_policy"],
    lifecycle: "refreshed -> stale -> superseded",
  }),
  policy({
    concept: "user_arbitration",
    label: "User arbitration log",
    required: ["contract_version", "updated_at", "source_of_truth", "source_mode", "lifecycle_status"],
    sourceOfTruthConcept: "user_arbitration",
    evidenceTargets: ["scaffold/docs_audit/USER-ARBITRATION.md"],
    recommended: ["owner", "steward", "privacy_classification", "retention_policy"],
    legacyTolerated: ["source_of_truth", "source_mode", "lifecycle_status", "owner", "steward", "privacy_classification", "retention_policy"],
    lifecycle: "refreshed -> stale -> superseded",
  }),
  policy({
    concept: "runtime_defaults",
    label: "Runtime defaults",
    required: ["contract_version", "owner", "source_of_truth", "updated_at", "lifecycle_status"],
    sourceOfTruthConcept: "runtime_defaults",
    evidenceTargets: ["src/lib/config/aidn-config-lib.mjs"],
    recommended: ["steward", "retention_policy"],
    lifecycle: "initialized -> active -> revised -> retired",
    notes: "Root version is config schema 1, not product SemVer; absent version or install sections remain legacy-compatible. Optional install.aidnVersion is a semantic product version supplied from the executing package VERSION only after complete successful installation and bound to the local receipt.",
  }),
  policy({
    concept: "baseline",
    label: "Baseline",
    required: ["contract_version", "owner", "source_of_truth", "updated_at", "lifecycle_status"],
    sourceOfTruthConcept: "baseline",
    evidenceTargets: ["tools/perf/promote-baseline-hook.mjs"],
    recommended: ["steward", "retention_policy"],
    lifecycle: "candidate -> current -> superseded -> archived",
  }),
  policy({
    concept: "snapshot",
    label: "Snapshot",
    required: ["contract_version", "owner", "source_of_truth", "updated_at", "lifecycle_status"],
    sourceOfTruthConcept: "snapshot",
    evidenceTargets: ["tools/perf/reload-check.mjs"],
    recommended: ["steward", "retention_policy"],
    lifecycle: "captured -> current -> stale -> archived",
  }),
  policy({
    concept: "agent_roster",
    label: "Agent roster",
    required: ["contract_version", "owner", "source_of_truth", "updated_at", "lifecycle_status"],
    sourceOfTruthConcept: "agent_roster",
    evidenceTargets: ["tools/runtime/verify-agent-roster.mjs"],
    recommended: ["steward", "retention_policy"],
    lifecycle: "declared -> verified -> unavailable|retired",
  }),
]);

export function listMetadataPolicies() {
  return METADATA_POLICIES.map((item) => ({
    ...item,
    required_fields: [...item.required_fields],
    recommended_fields: [...item.recommended_fields],
    legacy_tolerated_missing_fields: [...item.legacy_tolerated_missing_fields],
    evidence_targets: [...item.evidence_targets],
  }));
}

export function getMetadataPolicy(concept) {
  const normalized = normalizeKey(concept);
  const item = METADATA_POLICIES.find((candidate) => candidate.concept === normalized) ?? null;
  if (!item) {
    return null;
  }
  return {
    ...item,
    required_fields: [...item.required_fields],
    recommended_fields: [...item.recommended_fields],
    legacy_tolerated_missing_fields: [...item.legacy_tolerated_missing_fields],
    evidence_targets: [...item.evidence_targets],
  };
}

export function listRequiredMetadataFields(concept) {
  return getMetadataPolicy(concept)?.required_fields ?? [];
}

function hasGovernedValue(value) {
  if (value == null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

export function evaluateMetadataPolicy(concept, subject = {}) {
  const policy = getMetadataPolicy(concept);
  if (!policy) {
    return {
      concept: normalizeKey(concept),
      metadata_status: "not_governed",
      metadata_findings: [],
      required_fields: [],
      recommended_fields: [],
      legacy_tolerated_missing_fields: [],
      surfaced_fields: {},
    };
  }

  const missingRequiredFields = [];
  const missingRecommendedFields = [];
  const metadataFindings = [];
  const surfacedFields = {};

  for (const fieldName of policy.required_fields) {
    if (hasGovernedValue(subject[fieldName])) {
      surfacedFields[fieldName] = subject[fieldName];
      continue;
    }
    missingRequiredFields.push(fieldName);
    metadataFindings.push({
      severity: policy.legacy_tolerated_missing_fields.includes(fieldName) ? "warn" : "error",
      code: policy.legacy_tolerated_missing_fields.includes(fieldName)
        ? "MISSING_GOVERNED_METADATA_LEGACY_TOLERATED"
        : "MISSING_GOVERNED_METADATA",
      field: fieldName,
    });
  }

  for (const fieldName of policy.recommended_fields) {
    if (hasGovernedValue(subject[fieldName])) {
      surfacedFields[fieldName] = subject[fieldName];
      continue;
    }
    missingRecommendedFields.push(fieldName);
  }

  const metadataStatus = missingRequiredFields.length === 0
    ? "complete"
    : missingRequiredFields.every((fieldName) => policy.legacy_tolerated_missing_fields.includes(fieldName))
      ? "legacy_tolerated"
      : "missing";

  return {
    concept: policy.concept,
    label: policy.label,
    policy_version: policy.policy_version,
    metadata_status: metadataStatus,
    metadata_findings: metadataFindings,
    required_fields: [...policy.required_fields],
    recommended_fields: [...policy.recommended_fields],
    legacy_tolerated_missing_fields: [...policy.legacy_tolerated_missing_fields],
    missing_required_fields: missingRequiredFields,
    missing_recommended_fields: missingRecommendedFields,
    surfaced_fields: surfacedFields,
    lifecycle: policy.lifecycle,
    source_of_truth_concept: policy.source_of_truth_concept,
    owner: policy.owner,
    scope: policy.scope,
    retention: policy.retention,
    migration: policy.migration,
    replacement: policy.replacement,
    evidence_targets: [...policy.evidence_targets],
    notes: policy.notes,
  };
}

export function validateMetadataPolicies() {
  const issues = [];
  const seen = new Set();
  for (const item of METADATA_POLICIES) {
    if (!item.concept) {
      issues.push("policy missing concept");
    }
    if (seen.has(item.concept)) {
      issues.push(`duplicate concept: ${item.concept}`);
    }
    seen.add(item.concept);
    for (const fieldName of [
      "policy_version",
      "required_fields",
      "lifecycle",
      "source_of_truth_concept",
      "owner",
      "scope",
      "retention",
      "migration",
      "replacement",
      "evidence_targets",
    ]) {
      if (!item[fieldName] || (Array.isArray(item[fieldName]) && item[fieldName].length === 0)) {
        issues.push(`${item.concept}: missing ${fieldName}`);
      }
    }
  }
  return {
    ok: issues.length === 0,
    policy_version: METADATA_POLICY_VERSION,
    policy_count: METADATA_POLICIES.length,
    issues,
  };
}

export { listGovernanceCoverageExceptions };
