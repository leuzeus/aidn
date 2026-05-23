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
  recommended = [],
  legacyTolerated = [],
  lifecycle = "draft -> active -> verified -> archived",
  notes = "",
}) {
  return freezeDeep({
    concept: normalizeKey(concept),
    label,
    policy_version: METADATA_POLICY_VERSION,
    required_fields: [...required].map(normalizeKey).filter(Boolean),
    recommended_fields: [...recommended].map(normalizeKey).filter(Boolean),
    legacy_tolerated_missing_fields: [...legacyTolerated].map(normalizeKey).filter(Boolean),
    lifecycle,
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
    concept: "project",
    label: "Project",
    required: ["project_id", "owner", "source_of_truth", "updated_at", "lifecycle_status"],
    recommended: ["steward", "privacy_classification", "retention_policy"],
    lifecycle: "draft -> active -> archived",
  }),
  policy({
    concept: "workspace",
    label: "Workspace",
    required: ["workspace_id", "worktree_id", "source_of_truth", "updated_at", "lifecycle_status"],
    recommended: ["owner", "shared_runtime_mode", "privacy_classification"],
    lifecycle: "discovered -> active -> archived",
  }),
  policy({
    concept: "session",
    label: "Session",
    required: ["session_id", "contract_version", "owner", "state", "updated_at", "source_of_truth", "lifecycle_status"],
    recommended: ["steward", "privacy_classification", "retention_policy"],
    legacyTolerated: ["owner", "source_of_truth", "lifecycle_status", "privacy_classification", "retention_policy"],
    lifecycle: "draft -> active -> closing -> closed -> archived",
  }),
  policy({
    concept: "cycle_status",
    label: "Cycle status",
    required: ["cycle_id", "contract_version", "owner", "state", "branch_name", "dor_state", "updated_at", "source_of_truth", "lifecycle_status"],
    recommended: ["steward", "privacy_classification", "retention_policy"],
    legacyTolerated: ["cycle_id", "owner", "updated_at", "source_of_truth", "lifecycle_status", "privacy_classification", "retention_policy"],
    lifecycle: "open -> implementing -> verifying -> done -> promoted|archived",
  }),
  policy({
    concept: "artifact",
    label: "Artifact",
    required: [...COMMON_OPERATIONAL_FIELDS, "sha256", "scope"],
    recommended: [...GOVERNED_CONTENT_FIELDS, "confidence"],
    legacyTolerated: ["owner", "steward", "privacy_classification", "retention_policy"],
    lifecycle: "draft -> active -> verified -> promoted|archived -> superseded",
  }),
  policy({
    concept: "current_state",
    label: "Current state digest",
    required: ["contract_version", "updated_at", "runtime_state_mode", "active_session", "active_cycle", "source_of_truth", "source_mode", "lifecycle_status"],
    recommended: ["owner", "steward", "privacy_classification", "retention_policy"],
    legacyTolerated: ["source_of_truth", "source_mode", "lifecycle_status", "owner", "steward", "privacy_classification", "retention_policy"],
    lifecycle: "refreshed -> stale -> superseded",
  }),
  policy({
    concept: "runtime_state",
    label: "Runtime state digest",
    required: ["contract_version", "updated_at", "runtime_state_mode", "repair_layer_status", "source_of_truth", "source_mode", "lifecycle_status"],
    recommended: ["owner", "steward", "privacy_classification", "retention_policy"],
    legacyTolerated: ["source_of_truth", "source_mode", "lifecycle_status", "owner", "steward", "privacy_classification", "retention_policy"],
    lifecycle: "refreshed -> stale -> superseded",
  }),
  policy({
    concept: "handoff_packet",
    label: "Handoff packet",
    required: ["contract_version", "updated_at", "handoff_status", "active_session", "active_cycle", "source_of_truth", "source_mode", "lifecycle_status"],
    recommended: ["owner", "steward", "privacy_classification", "retention_policy"],
    legacyTolerated: ["source_of_truth", "source_mode", "lifecycle_status", "owner", "steward", "privacy_classification", "retention_policy"],
    lifecycle: "draft -> ready -> consumed -> archived",
  }),
  policy({
    concept: "artifact_contract",
    label: "Artifact contract",
    required: ["artifact_type", "contract_version", "required_fields", "owner", "source_of_truth", "lifecycle_status"],
    recommended: ["steward", "deprecation_policy"],
    lifecycle: "proposed -> active -> deprecated -> retired",
  }),
  policy({
    concept: "decision",
    label: "Decision",
    required: ["decision_id", "type", "owner", "decided_at", "source_of_truth", "lifecycle_status"],
    recommended: ["steward", "linked_session", "linked_cycle", "traceability_links"],
    legacyTolerated: ["owner", "source_of_truth", "lifecycle_status"],
    lifecycle: "proposed -> accepted|rejected -> superseded",
  }),
  policy({
    concept: "incident",
    label: "Incident",
    required: ["incident_id", "severity", "owner", "status", "created_at", "updated_at", "source_of_truth", "lifecycle_status"],
    recommended: ["steward", "resolution", "privacy_classification", "retention_policy"],
    legacyTolerated: ["source_of_truth", "lifecycle_status", "privacy_classification", "retention_policy"],
    lifecycle: "opened -> triaged -> mitigated -> closed -> archived",
  }),
  policy({
    concept: "repair_finding",
    label: "Repair finding",
    required: ["finding_id", "finding_type", "severity", "status", "source_of_truth", "updated_at", "lifecycle_status"],
    recommended: ["owner", "steward", "repair_action", "traceability_links"],
    lifecycle: "open -> triaged -> resolved|waived -> archived",
  }),
  policy({
    concept: "coordination_record",
    label: "Coordination record",
    required: ["record_id", "agent_id", "action", "status", "created_at", "source_of_truth", "lifecycle_status"],
    recommended: ["session_id", "cycle_id", "result_ref", "privacy_classification", "retention_policy"],
    lifecycle: "created -> processed -> archived",
  }),
  policy({
    concept: "coordination_summary",
    label: "Coordination summary",
    required: ["contract_version", "updated_at", "history_status", "source_of_truth", "source_mode", "lifecycle_status"],
    recommended: ["owner", "steward", "privacy_classification", "retention_policy"],
    legacyTolerated: ["source_of_truth", "source_mode", "lifecycle_status", "owner", "steward", "privacy_classification", "retention_policy"],
    lifecycle: "refreshed -> stale -> superseded",
  }),
  policy({
    concept: "coordination_log",
    label: "Coordination log",
    required: ["contract_version", "updated_at", "source_of_truth", "source_mode", "lifecycle_status"],
    recommended: ["owner", "steward", "privacy_classification", "retention_policy"],
    legacyTolerated: ["source_of_truth", "source_mode", "lifecycle_status", "owner", "steward", "privacy_classification", "retention_policy"],
    lifecycle: "refreshed -> stale -> superseded",
  }),
  policy({
    concept: "user_arbitration",
    label: "User arbitration log",
    required: ["contract_version", "updated_at", "source_of_truth", "source_mode", "lifecycle_status"],
    recommended: ["owner", "steward", "privacy_classification", "retention_policy"],
    legacyTolerated: ["source_of_truth", "source_mode", "lifecycle_status", "owner", "steward", "privacy_classification", "retention_policy"],
    lifecycle: "refreshed -> stale -> superseded",
  }),
]);

export function listMetadataPolicies() {
  return METADATA_POLICIES.map((item) => ({
    ...item,
    required_fields: [...item.required_fields],
    recommended_fields: [...item.recommended_fields],
    legacy_tolerated_missing_fields: [...item.legacy_tolerated_missing_fields],
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
    for (const fieldName of ["policy_version", "required_fields", "lifecycle"]) {
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
