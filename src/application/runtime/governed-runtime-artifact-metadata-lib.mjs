import { evaluateSourceOfTruthPolicy } from "../../core/source-of-truth/source-of-truth-policy.mjs";

export const CRITICAL_MARKDOWN_CONTRACT_VERSION = "critical-markdown-v1";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

export function deriveGovernedRuntimeArtifactMetadata({
  workspace,
  runtimeStateMode,
  sourceOfTruthConcept = "runtime_digests",
  lifecycleStatus,
  owner,
  steward = "aidn-runtime",
} = {}) {
  const sourceOfTruth = evaluateSourceOfTruthPolicy(sourceOfTruthConcept, runtimeStateMode);
  return {
    contract_version: CRITICAL_MARKDOWN_CONTRACT_VERSION,
    source_of_truth: normalizeScalar(sourceOfTruth.source_of_truth) || "runtime store plus generated Markdown",
    source_mode: "explicit",
    lifecycle_status: normalizeScalar(lifecycleStatus) || "refreshed",
    owner: normalizeScalar(owner) || normalizeScalar(workspace?.project_id) || "unknown",
    steward: normalizeScalar(steward) || "aidn-runtime",
  };
}
