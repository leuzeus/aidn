import { repairSourceModeRank } from "../../core/workflow/repair-layer-policy.mjs";

export const REPAIR_LAYER_NORMALIZATION_ENGINE_VERSION = "repair-layer-normalization-v1";

function stableClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function normalizePathValue(value) {
  return normalizeScalar(value).replace(/\\/g, "/");
}

function normalizeEntityIdValue(value) {
  const normalized = normalizeScalar(value).toUpperCase();
  return normalized;
}

function normalizeKeyValue(fieldName, value) {
  const normalizedFieldName = String(fieldName ?? "").trim().toLowerCase();
  if (normalizedFieldName.endsWith("_path") || normalizedFieldName === "path") {
    return normalizePathValue(value);
  }
  if (normalizedFieldName.endsWith("_id")) {
    return normalizeEntityIdValue(value);
  }
  return normalizeScalar(value);
}

function buildRowKey(row, keyFields) {
  const values = [];
  for (const field of keyFields) {
    const normalized = normalizeKeyValue(field, row?.[field]);
    if (!normalized) {
      return null;
    }
    values.push(normalized);
  }
  return values.join("::");
}

function countPresentFields(row, fieldNames) {
  return fieldNames.reduce((count, fieldName) => (
    row?.[fieldName] == null || row?.[fieldName] === ""
      ? count
      : count + 1
  ), 0);
}

function rowSignature(row, fieldNames) {
  return JSON.stringify(fieldNames.map((fieldName) => {
    const value = row?.[fieldName];
    if (value && typeof value === "object") {
      return { field: fieldName, value: stableClone(value) };
    }
    return { field: fieldName, value: value ?? null };
  }));
}

function normalizeConfidence(row) {
  const direct = Number(row?.confidence);
  if (Number.isFinite(direct)) {
    return direct;
  }
  const sourceConfidence = Number(row?.source_confidence);
  if (Number.isFinite(sourceConfidence)) {
    return sourceConfidence;
  }
  const entityConfidence = Number(row?.entity_confidence);
  if (Number.isFinite(entityConfidence)) {
    return entityConfidence;
  }
  return 0;
}

function compareRowPreference(left, right, fieldNames) {
  const leftRank = repairSourceModeRank(left?.source_mode);
  const rightRank = repairSourceModeRank(right?.source_mode);
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  const leftConfidence = normalizeConfidence(left);
  const rightConfidence = normalizeConfidence(right);
  if (leftConfidence !== rightConfidence) {
    return leftConfidence - rightConfidence;
  }

  const leftCompleteness = countPresentFields(left, fieldNames);
  const rightCompleteness = countPresentFields(right, fieldNames);
  if (leftCompleteness !== rightCompleteness) {
    return leftCompleteness - rightCompleteness;
  }

  const leftUpdatedAt = normalizeScalar(left?.updated_at);
  const rightUpdatedAt = normalizeScalar(right?.updated_at);
  if (leftUpdatedAt !== rightUpdatedAt) {
    return leftUpdatedAt.localeCompare(rightUpdatedAt);
  }

  return 0;
}

function selectPreferredRow(rows, fieldNames) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }
  return rows.slice().sort((left, right) => compareRowPreference(left, right, fieldNames)).at(-1) ?? null;
}

function isMissingRequiredFields(row, requiredFields) {
  return requiredFields.filter((fieldName) => row?.[fieldName] == null || row?.[fieldName] === "");
}

function buildStatusSummary(items) {
  const summary = {
    reconstructed: 0,
    inferred: 0,
    conflicted: 0,
    needs_review: 0,
  };
  const per_collection = {};
  for (const item of items) {
    const status = String(item?.status ?? "").trim();
    if (Object.prototype.hasOwnProperty.call(summary, status)) {
      summary[status] += 1;
    }
    const collection = String(item?.collection ?? "unknown");
    if (!per_collection[collection]) {
      per_collection[collection] = {
        reconstructed: 0,
        inferred: 0,
        conflicted: 0,
        needs_review: 0,
      };
    }
    if (Object.prototype.hasOwnProperty.call(per_collection[collection], status)) {
      per_collection[collection][status] += 1;
    }
  }
  return { ...summary, per_collection };
}

const COLLECTION_SPECS = Object.freeze({
  cycles: Object.freeze({
    keyFields: ["cycle_id"],
    compareFields: ["cycle_id", "session_id", "state", "outcome", "branch_name", "dor_state", "continuity_rule", "continuity_base_branch", "continuity_latest_cycle_branch", "continuity_decision_by", "updated_at"],
    requiredFields: ["cycle_id", "state"],
  }),
  sessions: Object.freeze({
    keyFields: ["session_id"],
    compareFields: ["session_id", "branch_name", "state", "owner", "parent_session", "branch_kind", "cycle_branch", "intermediate_branch", "integration_target_cycle", "carry_over_pending", "started_at", "ended_at", "source_artifact_path", "source_confidence", "source_mode", "updated_at"],
    requiredFields: ["session_id"],
  }),
  artifacts: Object.freeze({
    keyFields: ["path"],
    compareFields: ["path", "kind", "family", "subtype", "gate_relevance", "classification_reason", "content_format", "content", "canonical_format", "sha256", "size_bytes", "mtime_ns", "session_id", "cycle_id", "source_mode", "entity_confidence", "legacy_origin", "updated_at"],
    requiredFields: ["path", "sha256", "size_bytes", "mtime_ns"],
  }),
  file_map: Object.freeze({
    keyFields: ["cycle_id", "path", "role", "relation"],
    compareFields: ["cycle_id", "path", "role", "relation", "last_seen_at"],
    requiredFields: ["cycle_id", "path"],
  }),
  tags: Object.freeze({
    keyFields: ["tag"],
    compareFields: ["tag"],
    requiredFields: ["tag"],
  }),
  artifact_tags: Object.freeze({
    keyFields: ["path", "tag"],
    compareFields: ["path", "tag"],
    requiredFields: ["path", "tag"],
  }),
  run_metrics: Object.freeze({
    keyFields: ["run_id"],
    compareFields: ["run_id", "started_at", "ended_at", "overhead_ratio", "artifacts_churn", "gates_frequency"],
    requiredFields: ["run_id"],
  }),
  artifact_links: Object.freeze({
    keyFields: ["source_path", "target_path", "relation_type"],
    compareFields: ["source_path", "target_path", "relation_type", "confidence", "inference_source", "source_mode", "relation_status", "updated_at"],
    requiredFields: ["source_path", "target_path", "relation_type"],
  }),
  cycle_links: Object.freeze({
    keyFields: ["source_cycle_id", "target_cycle_id", "relation_type"],
    compareFields: ["source_cycle_id", "target_cycle_id", "relation_type", "confidence", "inference_source", "source_mode", "relation_status", "updated_at"],
    requiredFields: ["source_cycle_id", "target_cycle_id", "relation_type"],
  }),
  session_cycle_links: Object.freeze({
    keyFields: ["session_id", "cycle_id", "relation_type"],
    compareFields: ["session_id", "cycle_id", "relation_type", "confidence", "inference_source", "source_mode", "relation_status", "ambiguity_status", "updated_at"],
    requiredFields: ["session_id", "cycle_id", "relation_type"],
  }),
  session_links: Object.freeze({
    keyFields: ["source_session_id", "target_session_id", "relation_type"],
    compareFields: ["source_session_id", "target_session_id", "relation_type", "confidence", "inference_source", "source_mode", "relation_status", "updated_at"],
    requiredFields: ["source_session_id", "target_session_id", "relation_type"],
  }),
  repair_decisions: Object.freeze({
    keyFields: ["relation_scope", "source_ref", "target_ref", "relation_type"],
    compareFields: ["relation_scope", "source_ref", "target_ref", "relation_type", "decision", "decided_at", "decided_by", "notes"],
    requiredFields: ["relation_scope", "source_ref", "target_ref", "relation_type"],
  }),
  migration_runs: Object.freeze({
    keyFields: ["migration_run_id"],
    compareFields: ["migration_run_id", "engine_version", "started_at", "ended_at", "status", "target_root", "notes"],
    requiredFields: ["migration_run_id"],
  }),
  migration_findings: Object.freeze({
    keyFields: ["migration_run_id", "finding_type", "entity_type", "entity_id", "artifact_path", "message"],
    compareFields: ["migration_run_id", "severity", "finding_type", "entity_type", "entity_id", "artifact_path", "message", "confidence", "suggested_action", "created_at"],
    requiredFields: ["migration_run_id", "finding_type", "message"],
  }),
});

function normalizeCollectionRows(collectionName, rows, sourceRows = []) {
  const spec = COLLECTION_SPECS[collectionName];
  if (!spec) {
    return {
      rows: Array.isArray(rows) ? stableClone(rows) : [],
      items: [],
    };
  }

  const normalizedRows = [];
  const items = [];
  const sourceRowsByKey = new Map();

  for (const row of Array.isArray(sourceRows) ? sourceRows : []) {
    const key = buildRowKey(row, spec.keyFields);
    if (!key) {
      continue;
    }
    const current = sourceRowsByKey.get(key) ?? [];
    current.push(row);
    sourceRowsByKey.set(key, current);
  }

  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = buildRowKey(row, spec.keyFields);
    if (!key) {
      items.push({
        collection: collectionName,
        key: null,
        status: "needs_review",
        reason: "missing_logical_key",
        source_count: 0,
        normalized_count: 0,
        missing_fields: spec.requiredFields.filter((fieldName) => row?.[fieldName] == null || row?.[fieldName] === ""),
      });
      continue;
    }
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }

  for (const [key, groupRows] of [...groups.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    const preferred = selectPreferredRow(groupRows, spec.compareFields) ?? groupRows[0];
    const sourceGroup = sourceRowsByKey.get(key) ?? [];
    const sourceSignature = sourceGroup.length > 0 ? sourceGroup.map((row) => rowSignature(row, spec.compareFields)).sort().join("||") : "";
    const normalizedSignature = rowSignature(preferred, spec.compareFields);
    const allIdentical = groupRows.map((row) => rowSignature(row, spec.compareFields)).every((signature) => signature === normalizedSignature);
    const missingFields = isMissingRequiredFields(preferred, spec.requiredFields);

    let status = "inferred";
    let reason = "duplicate_rows_collapsed";

    if (sourceGroup.length === 0) {
      status = "reconstructed";
      reason = "absent_from_source_payload";
    } else if (sourceGroup.length > 1) {
      status = allIdentical ? "inferred" : "conflicted";
      reason = allIdentical ? "duplicate_rows_collapsed" : "conflicting_duplicate_rows";
    } else if (sourceGroup.length === 1) {
      const sourceRow = sourceGroup[0];
      const sourceSignatureSingle = rowSignature(sourceRow, spec.compareFields);
      if (sourceSignatureSingle !== normalizedSignature) {
        const sourceCompleteness = countPresentFields(sourceRow, spec.compareFields);
        const normalizedCompleteness = countPresentFields(preferred, spec.compareFields);
        if (normalizedCompleteness > sourceCompleteness) {
          status = "inferred";
          reason = "preferred_row_has_more_complete_evidence";
        } else {
          status = "conflicted";
          reason = "source_and_normalized_rows_disagree";
        }
      } else if (groupRows.length > 1) {
        status = "inferred";
        reason = "identical_duplicate_rows_collapsed";
      }
    }

    if (missingFields.length > 0) {
      status = status === "conflicted" ? "conflicted" : "needs_review";
      reason = "missing_required_fields";
    }

    normalizedRows.push(preferred);
    if (status !== "inferred" || groupRows.length > 1 || sourceGroup.length === 0 || missingFields.length > 0 || sourceSignature !== normalizedSignature) {
      items.push({
        collection: collectionName,
        key,
        status,
        reason,
        source_count: sourceGroup.length,
        normalized_count: groupRows.length,
        missing_fields: missingFields,
        preferred_source_mode: normalizeScalar(preferred?.source_mode) || null,
        preferred_confidence: normalizeConfidence(preferred),
        preferred_updated_at: normalizeScalar(preferred?.updated_at) || null,
      });
    }
  }

  return {
    rows: normalizedRows,
    items,
  };
}

function buildNormalizationReport({ sourcePayload, payload, dryRun }) {
  const items = [];
  const source = sourcePayload && typeof sourcePayload === "object" ? sourcePayload : {};
  const normalized = payload && typeof payload === "object" ? payload : {};

  for (const collectionName of Object.keys(COLLECTION_SPECS)) {
    const normalizedRows = Array.isArray(normalized[collectionName]) ? normalized[collectionName] : [];
    const sourceRows = Array.isArray(source[collectionName]) ? source[collectionName] : [];
    const result = normalizeCollectionRows(collectionName, normalizedRows, sourceRows);
    items.push(...result.items);
  }

  const summary = buildStatusSummary(items);
  return {
    engine_version: REPAIR_LAYER_NORMALIZATION_ENGINE_VERSION,
    dry_run: dryRun === true,
    summary,
    items: items.sort((left, right) => (
      `${left.collection}:${left.key ?? ""}:${left.status}:${left.reason}`
    ).localeCompare(
      `${right.collection}:${right.key ?? ""}:${right.status}:${right.reason}`,
    )),
  };
}

export function normalizeRepairLayerPayload({
  sourcePayload = {},
  payload = {},
  dryRun = false,
} = {}) {
  const normalized = stableClone(payload);
  const initialIssues = [];
  for (const collectionName of Object.keys(COLLECTION_SPECS)) {
    const result = normalizeCollectionRows(
      collectionName,
      Array.isArray(normalized[collectionName]) ? normalized[collectionName] : [],
      Array.isArray(sourcePayload?.[collectionName]) ? sourcePayload[collectionName] : [],
    );
    normalized[collectionName] = result.rows;
    initialIssues.push(...result.items.filter((item) => {
      const reason = String(item?.reason ?? "");
      return item?.key == null || reason.includes("duplicate");
    }));
  }
  const report = buildNormalizationReport({
    sourcePayload,
    payload: normalized,
    dryRun,
  });
  report.items = [
    ...initialIssues,
    ...report.items,
  ].sort((left, right) => (
    `${left.collection}:${left.key ?? ""}:${left.status}:${left.reason}`
  ).localeCompare(
    `${right.collection}:${right.key ?? ""}:${right.status}:${right.reason}`,
  ));
  report.summary = buildStatusSummary(report.items);
  return {
    payload: normalized,
    report,
  };
}
