import { evaluateMetadataPolicy } from "../../core/metadata/metadata-policy.mjs";
import { evaluateSourceOfTruthPolicy } from "../../core/source-of-truth/source-of-truth-policy.mjs";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

export const SHARED_COORDINATION_ARTIFACT_CONTRACT_VERSION = "shared-coordination-read-v1";

export function deriveSharedCoordinationWorkspaceLifecycleStatus({
  backendStatus,
  hasSharedRecords,
} = {}) {
  if (backendStatus === "ready" || hasSharedRecords) {
    return "active";
  }
  return "discovered";
}

export function deriveSharedCoordinationGovernance({
  workspace,
  backend,
  updatedAt,
  hasSharedRecords = false,
} = {}) {
  const sourceOfTruth = evaluateSourceOfTruthPolicy("coordination_records");
  const metadata = evaluateMetadataPolicy("workspace", {
    workspace_id: workspace?.workspace_id,
    worktree_id: workspace?.worktree_id,
    source_of_truth: sourceOfTruth.concept,
    updated_at: normalizeScalar(updatedAt) || new Date().toISOString(),
    lifecycle_status: deriveSharedCoordinationWorkspaceLifecycleStatus({
      backendStatus: backend?.status,
      hasSharedRecords,
    }),
    owner: workspace?.project_id,
    shared_runtime_mode: workspace?.shared_runtime_mode,
  });
  return {
    source_of_truth: sourceOfTruth,
    metadata,
  };
}

export function deriveSharedCoordinationArtifactReadGovernance({
  workspace,
  family,
  readStatus,
  primaryTimestamp,
  recordCount = 0,
} = {}) {
  const sourceOfTruth = evaluateSourceOfTruthPolicy("coordination_records");
  return {
    contract_version: SHARED_COORDINATION_ARTIFACT_CONTRACT_VERSION,
    artifact_family: normalizeScalar(family) || "shared_coordination_read",
    source_of_truth_concept: sourceOfTruth.concept,
    source_of_truth: normalizeScalar(sourceOfTruth.source_of_truth) || ".aidn/runtime/context/*",
    source_of_truth_status: sourceOfTruth.source_of_truth_status,
    source_mode: "explicit",
    lifecycle_status: normalizeScalar(readStatus) === "found" ? "active" : (normalizeScalar(readStatus) === "empty" ? "empty" : "unknown"),
    owner: normalizeScalar(workspace?.project_id) || "unknown",
    steward: "aidn-runtime",
    updated_at: normalizeScalar(primaryTimestamp) || "",
    record_count: Number(recordCount) || 0,
  };
}

export function deriveSharedCoordinationArtifactWriteGovernance({
  workspace,
  family,
  writeStatus,
  primaryTimestamp,
  recordCount = 0,
} = {}) {
  const sourceOfTruth = evaluateSourceOfTruthPolicy("coordination_records");
  return {
    contract_version: SHARED_COORDINATION_ARTIFACT_CONTRACT_VERSION,
    artifact_family: normalizeScalar(family) || "shared_coordination_write",
    source_of_truth_concept: sourceOfTruth.concept,
    source_of_truth: normalizeScalar(sourceOfTruth.source_of_truth) || ".aidn/runtime/context/*",
    source_of_truth_status: sourceOfTruth.source_of_truth_status,
    source_mode: "explicit",
    lifecycle_status: normalizeScalar(writeStatus) === "synced" ? "active" : "unknown",
    owner: normalizeScalar(workspace?.project_id) || "unknown",
    steward: "aidn-runtime",
    updated_at: normalizeScalar(primaryTimestamp) || "",
    record_count: Number(recordCount) || 0,
  };
}
