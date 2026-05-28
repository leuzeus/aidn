import { listGovernanceCoverageExceptions } from "../governance/concept-coverage.mjs";

const STATE_MODES = Object.freeze(["files", "dual", "db-only"]);

function freezeDeep(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  for (const nested of Object.values(value)) {
    freezeDeep(nested);
  }
  return Object.freeze(value);
}

function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeStateMode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "files" || normalized === "dual" || normalized === "db-only") {
    return normalized;
  }
  return null;
}

function policy({
  concept,
  label,
  files,
  dual,
  dbOnly,
  projection = "none",
  sharedRuntime = "not_shared",
  notes = "",
}) {
  return freezeDeep({
    concept: normalizeKey(concept),
    label,
    by_mode: {
      files,
      dual,
      "db-only": dbOnly,
    },
    projection,
    shared_runtime: sharedRuntime,
    notes,
  });
}

const SOURCE_OF_TRUTH_POLICIES = freezeDeep([
  policy({
    concept: "workflow_rules",
    label: "Workflow rules",
    files: "docs/audit/SPEC.md projected from package docs/SPEC.md",
    dual: "docs/audit/SPEC.md projected from package docs/SPEC.md",
    dbOnly: "docs/audit/SPEC.md projected from package docs/SPEC.md",
    projection: "WORKFLOW_SUMMARY.md and WORKFLOW-KERNEL.md are generated summaries",
    notes: "Rules remain checkout-bound in every mode.",
  }),
  policy({
    concept: "project_policy",
    label: "Project policy",
    files: ".aidn/project/workflow.adapter.json",
    dual: ".aidn/project/workflow.adapter.json",
    dbOnly: ".aidn/project/workflow.adapter.json",
    projection: "WORKFLOW.md, CODEX_ONLINE.md and index.md",
    notes: "Project policy may be versioned by the installed client repository.",
  }),
  policy({
    concept: "runtime_defaults",
    label: "Runtime defaults",
    files: ".aidn/config.json",
    dual: ".aidn/config.json",
    dbOnly: ".aidn/config.json",
    projection: "runtime status outputs",
    notes: "Host-local defaults are not the shared runtime contract.",
  }),
  policy({
    concept: "workspace_identity",
    label: "Workspace identity",
    files: "Git plus workspace resolver",
    dual: "Git plus workspace resolver and local runtime context",
    dbOnly: "Git plus workspace resolver and local runtime context",
    projection: "workspace fields in runtime JSON",
    sharedRuntime: "workspace/worktree registry metadata only when explicitly configured",
  }),
  policy({
    concept: "runtime_project_context",
    label: "Runtime project context",
    files: "workspace resolver with optional shared-runtime locator or env identity",
    dual: "runtime_scope_registry plus workspace resolver",
    dbOnly: "runtime_scope_registry plus workspace resolver",
    projection: "project_context fields in runtime JSON status outputs",
    sharedRuntime: "project_id/workspace_id/worktree_id registry metadata when explicitly configured",
    notes: "PostgreSQL runtime rows use runtime_scope_id as the durable partition key; absolute path scope is legacy migration evidence only.",
  }),
  policy({
    concept: "session_state",
    label: "Session state",
    files: "docs/audit/sessions/S*.md",
    dual: "runtime DB/index canonical state with required Markdown projection",
    dbOnly: "runtime DB canonical state materialized to Markdown on demand",
    projection: "CURRENT-STATE.md and runtime heads",
  }),
  policy({
    concept: "cycle_state",
    label: "Cycle state",
    files: "docs/audit/cycles/*/status.md",
    dual: "runtime DB/index canonical state with required Markdown projection",
    dbOnly: "runtime DB canonical state materialized to Markdown on demand",
    projection: "CURRENT-STATE.md and runtime heads",
  }),
  policy({
    concept: "artifact_inventory",
    label: "Artifact inventory",
    files: "checkout scan of docs/audit/*",
    dual: "runtime artifact store",
    dbOnly: "runtime artifact store",
    projection: "SQLite/local exports and materialized docs",
    notes: "Local SQLite remains target-root anchored unless an explicit shared locator is configured.",
  }),
  policy({
    concept: "decision",
    label: "Decision",
    files: "docs/audit/USER-ARBITRATION.md and coordination history markdown",
    dual: "coordination_records runtime tables with required Markdown projection",
    dbOnly: "coordination_records runtime tables with required Markdown projection",
    projection: "USER-ARBITRATION.md and COORDINATION-SUMMARY.md",
    sharedRuntime: "coordination_records table only when explicitly configured",
    notes: "Decision outcomes are tracked through the coordination record family rather than a separate shared surface.",
  }),
  policy({
    concept: "incident",
    label: "Incident",
    files: "docs/audit/incidents/*.md",
    dual: "repair findings runtime tables with required Markdown projection",
    dbOnly: "repair findings runtime tables with required Markdown projection",
    projection: "incident reports and repair summaries",
    sharedRuntime: "repair findings table only when explicitly configured",
    notes: "Incidents are operational records derived from repair findings and incident reports.",
  }),
  policy({
    concept: "coordination_summary",
    label: "Coordination summary",
    files: "docs/audit/COORDINATION-SUMMARY.md",
    dual: "coordination_records runtime tables with required Markdown projection",
    dbOnly: "coordination_records runtime tables with required Markdown projection",
    projection: "COORDINATION-SUMMARY.md",
    sharedRuntime: "coordination_records table only when explicitly configured",
    notes: "Coordination summaries remain local projections unless an explicit shared backend is configured.",
  }),
  policy({
    concept: "coordination_log",
    label: "Coordination log",
    files: "docs/audit/COORDINATION-LOG.md",
    dual: "coordination_records runtime tables with required Markdown projection",
    dbOnly: "coordination_records runtime tables with required Markdown projection",
    projection: "COORDINATION-LOG.md",
    sharedRuntime: "coordination_records table only when explicitly configured",
    notes: "Coordination logs remain local projections unless an explicit shared backend is configured.",
  }),
  policy({
    concept: "user_arbitration",
    label: "User arbitration",
    files: "docs/audit/USER-ARBITRATION.md",
    dual: "coordination_records runtime tables with required Markdown projection",
    dbOnly: "coordination_records runtime tables with required Markdown projection",
    projection: "USER-ARBITRATION.md",
    sharedRuntime: "coordination_records table only when explicitly configured",
    notes: "User arbitration records remain local projections unless an explicit shared backend is configured.",
  }),
  policy({
    concept: "baseline",
    label: "Baseline",
    files: "docs/audit/baseline/current.md and docs/audit/baseline/history.md",
    dual: "local snapshot store with required Markdown projection",
    dbOnly: "local snapshot store with required Markdown projection",
    projection: "baseline/current.md and baseline/history.md",
    notes: "Baseline is a local-first reference artifact family and is not shared by default.",
  }),
  policy({
    concept: "snapshot",
    label: "Snapshot",
    files: "docs/audit/snapshots/context-snapshot.md",
    dual: "local snapshot store with required Markdown projection",
    dbOnly: "local snapshot store with required Markdown projection",
    projection: "snapshots/context-snapshot.md",
    notes: "Snapshot is a point-in-time local projection used by hydration and reload workflows.",
  }),
  policy({
    concept: "runtime_digests",
    label: "Runtime digests",
    files: "generated Markdown digest files",
    dual: "runtime store plus generated Markdown",
    dbOnly: "runtime store plus generated Markdown on demand",
    projection: "RUNTIME-STATE.md and HANDOFF-PACKET.md",
  }),
  policy({
    concept: "repair_findings",
    label: "Repair findings",
    files: "local scan or report",
    dual: "repair-layer runtime tables",
    dbOnly: "repair-layer runtime tables",
    projection: "repair reports and summaries",
  }),
  policy({
    concept: "coordination_records",
    label: "Coordination records",
    files: ".aidn/runtime/context/*",
    dual: "local runtime context or explicit shared backend",
    dbOnly: "local runtime context or explicit shared backend",
    projection: "COORDINATION-LOG.md and COORDINATION-SUMMARY.md",
    sharedRuntime: "coordination_records table only when explicitly configured",
  }),
  policy({
    concept: "agent_roster",
    label: "Agent roster",
    files: "docs/audit/AGENT-ROSTER.md",
    dual: "docs/audit/AGENT-ROSTER.md",
    dbOnly: "docs/audit/AGENT-ROSTER.md",
    projection: "agent health and selection summaries",
  }),
  policy({
    concept: "cli_output_contracts",
    label: "CLI output contracts",
    files: "package src/core/contracts/cli-output/*.schema.json",
    dual: "package src/core/contracts/cli-output/*.schema.json",
    dbOnly: "package src/core/contracts/cli-output/*.schema.json",
    projection: "future generated CLI contract docs",
  }),
]);

export function listStateModes() {
  return [...STATE_MODES];
}

export function listSourceOfTruthPolicies() {
  return SOURCE_OF_TRUTH_POLICIES.map((item) => ({
    ...item,
    by_mode: { ...item.by_mode },
  }));
}

export function getSourceOfTruthPolicy(concept, stateMode = null) {
  const normalizedConcept = normalizeKey(concept);
  const item = SOURCE_OF_TRUTH_POLICIES.find((candidate) => candidate.concept === normalizedConcept) ?? null;
  if (!item) {
    return null;
  }
  const normalizedMode = normalizeStateMode(stateMode);
  if (!normalizedMode) {
    return {
      ...item,
      by_mode: { ...item.by_mode },
    };
  }
  return {
    concept: item.concept,
    label: item.label,
    state_mode: normalizedMode,
    source_of_truth: item.by_mode[normalizedMode],
    projection: item.projection,
    shared_runtime: item.shared_runtime,
    notes: item.notes,
  };
}

export function evaluateSourceOfTruthPolicy(concept, stateMode = null) {
  const resolved = getSourceOfTruthPolicy(concept, stateMode);
  if (!resolved) {
    return {
      concept: normalizeKey(concept),
      source_of_truth_status: "missing",
      source_of_truth: null,
    };
  }
  return {
    ...resolved,
    source_of_truth_status: stateMode
      ? (String(resolved.source_of_truth ?? "").trim() ? "covered" : "missing")
      : "covered",
  };
}

export function validateSourceOfTruthPolicies() {
  const issues = [];
  const seen = new Set();
  for (const item of SOURCE_OF_TRUTH_POLICIES) {
    if (!item.concept) {
      issues.push("policy missing concept");
    }
    if (seen.has(item.concept)) {
      issues.push(`duplicate concept: ${item.concept}`);
    }
    seen.add(item.concept);
    for (const mode of STATE_MODES) {
      if (!String(item.by_mode?.[mode] ?? "").trim()) {
        issues.push(`${item.concept}: missing source for ${mode}`);
      }
    }
    if (String(item.shared_runtime ?? "").trim().length === 0) {
      issues.push(`${item.concept}: missing shared_runtime policy`);
    }
  }
  return {
    ok: issues.length === 0,
    policy_count: SOURCE_OF_TRUTH_POLICIES.length,
    state_modes: listStateModes(),
    issues,
  };
}

export { listGovernanceCoverageExceptions };
