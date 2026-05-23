import { evaluateMetadataPolicy } from "../../core/metadata/metadata-policy.mjs";
import { evaluateSourceOfTruthPolicy } from "../../core/source-of-truth/source-of-truth-policy.mjs";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

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
