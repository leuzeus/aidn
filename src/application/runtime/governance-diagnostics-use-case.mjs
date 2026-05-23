import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listCliEffectPolicies } from "../../core/cli/effect-policy.mjs";
import { getMetadataPolicy, listMetadataPolicies } from "../../core/metadata/metadata-policy.mjs";
import { getSourceOfTruthPolicy, listSourceOfTruthPolicies } from "../../core/source-of-truth/source-of-truth-policy.mjs";

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
    concept: "cli_output_contract",
    source_of_truth_concept: "cli_output_contracts",
    metadata_concept: "artifact_contract",
    required: ["source_of_truth", "metadata"],
  },
]);

function contractExists(fileName) {
  return Boolean(fileName) && fs.existsSync(path.join(CONTRACT_DIR, fileName));
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

export function projectGovernanceDiagnostics({ targetRoot = ".", workspace = null } = {}) {
  const concepts = GOVERNED_CONCEPTS.map(evaluateGovernedConcept);
  const issues = [
    ...concepts.flatMap((item) => item.issues),
    ...findGovernanceContractCoverageIssues(),
    ...findGovernanceRegistryCoverageIssues(),
  ];
  const summary = summarizeGovernedConcepts(concepts);
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
      cli_contract_directory: "src/core/contracts/cli-output",
    },
    concepts,
    issues,
    operations: deriveGovernanceOperations({
      concepts,
      issues,
    }),
  };
}
