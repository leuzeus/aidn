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

const CONCEPT_GOVERNANCE = freezeDeep({
  workflow_rules: {
    owner: "workflow policy maintainer",
    lifecycle: "authored -> active -> superseded -> archived",
    scope: "package workflow rules and installed project rule projections",
    retention: "retain every active rule version and its supersession record",
    migration: "replace rule projections only through an explicit pack install or upgrade",
    replacement: "no implicit replacement; successor rules must name the superseded rule set",
    evidence_targets: ["docs/agents/01-architecture-executable.md"],
  },
  project_policy: {
    owner: "project policy maintainer",
    lifecycle: "initialized -> active -> migrated -> archived",
    scope: "one installed project's workflow adapter policy",
    retention: "retain while the project is governed and archive with project policy history",
    migration: "use project config migration with explicit --write",
    replacement: "a successor adapter file replaces the prior version through an explicit migration",
    evidence_targets: ["src/lib/config/workflow-adapter-config-lib.mjs"],
  },
  runtime_defaults: {
    owner: "runtime configuration maintainer",
    lifecycle: "initialized -> active -> revised -> retired",
    scope: "host-local defaults for one installed project",
    retention: "retain the active config; preserve previous values only in explicit migration evidence",
    migration: "use config generation or migration with explicit --write",
    replacement: "a newer config contract explicitly replaces the active version",
    evidence_targets: ["src/lib/config/aidn-config-lib.mjs"],
  },
  workspace_identity: {
    owner: "workspace identity maintainer",
    lifecycle: "discovered -> active -> detached -> archived",
    scope: "Git project, workspace and worktree identity",
    retention: "retain active identity and detach records while referenced by runtime state",
    migration: "re-resolve identity and explicitly migrate legacy path-derived keys",
    replacement: "runtime scope identity replaces legacy path identity after verified migration",
    evidence_targets: ["src/application/runtime/workspace-resolution-service.mjs"],
  },
  runtime_project_context: {
    owner: "runtime scope identity maintainer",
    lifecycle: "resolved -> active -> migrated -> archived",
    scope: "project_id, workspace_id, worktree_id and runtime_scope_id for one runtime partition",
    retention: "retain active scope rows and migration aliases until no runtime record references them",
    migration: "migrate legacy scope keys through the explicit runtime project-context migrator",
    replacement: "runtime_scope_id replaces absolute-path partition keys after provenance checks",
    evidence_targets: ["src/application/runtime/runtime-project-context-service.mjs"],
  },
  session_state: {
    owner: "session governance maintainer",
    lifecycle: "draft -> active -> closing -> closed -> archived",
    scope: "one governed development session",
    retention: "retain closed sessions as audit history according to project policy",
    migration: "migrate session state only through state-mode migration or explicit import",
    replacement: "a resumed or successor session links to, but does not overwrite, its predecessor",
    evidence_targets: ["tools/perf/start-session-hook.mjs"],
  },
  cycle_state: {
    owner: "cycle governance maintainer",
    lifecycle: "open -> implementing -> verifying -> done -> promoted|archived",
    scope: "one governed delivery or investigation cycle",
    retention: "retain completed cycle status and traceability with the project audit history",
    migration: "migrate cycle state through explicit state-mode migration",
    replacement: "a replacement cycle must preserve the superseded cycle identifier in traceability",
    evidence_targets: ["tools/perf/cycle-create-hook.mjs"],
  },
  artifact_inventory: {
    owner: "runtime artifact inventory maintainer",
    lifecycle: "observed -> active -> verified -> superseded|archived",
    scope: "governed artifacts for one runtime project scope",
    retention: "retain active artifact heads and immutable versions according to artifact policy",
    migration: "use explicit artifact import, materialization or state-mode migration",
    replacement: "new artifact versions replace heads without rewriting immutable provenance",
    evidence_targets: ["src/adapters/runtime/artifact-store.mjs"],
  },
  decision: {
    owner: "decision governance maintainer",
    lifecycle: "proposed -> accepted|rejected -> superseded",
    scope: "one user or coordinator governance decision",
    retention: "retain accepted and rejected decisions with their traceability links",
    migration: "import decisions as coordination records without inventing missing provenance",
    replacement: "a superseding decision explicitly references the prior decision",
    evidence_targets: ["tools/runtime/coordinator-record-arbitration.mjs"],
  },
  incident: {
    owner: "incident governance maintainer",
    lifecycle: "opened -> triaged -> mitigated -> closed -> archived",
    scope: "one local project incident report",
    retention: "retain closed incident reports under the project incident retention policy",
    migration: "migrate incident reports as local project artifacts, never as shared repair findings",
    replacement: "a follow-up incident links to the earlier report instead of replacing it implicitly",
    evidence_targets: ["scaffold/docs_audit/incidents/TEMPLATE_INC_TMP.md"],
  },
  coordination_summary: {
    owner: "coordination summary maintainer",
    lifecycle: "refreshed -> stale -> superseded",
    scope: "local projection of coordination records for one runtime scope",
    retention: "retain the current projection; canonical records govern historical retention",
    migration: "regenerate from canonical coordination records after explicit backend migration",
    replacement: "each refreshed projection supersedes the earlier projection",
    evidence_targets: ["tools/runtime/project-coordination-summary.mjs"],
  },
  coordination_log: {
    owner: "coordination log maintainer",
    lifecycle: "refreshed -> stale -> superseded",
    scope: "local chronological projection for one runtime scope",
    retention: "retain projected history only as long as required by canonical coordination records",
    migration: "regenerate the log from canonical coordination records",
    replacement: "a regenerated log supersedes the prior projection",
    evidence_targets: ["scaffold/docs_audit/COORDINATION-LOG.md"],
  },
  user_arbitration: {
    owner: "user arbitration maintainer",
    lifecycle: "requested -> decided -> superseded|archived",
    scope: "user arbitration outcomes for one project runtime scope",
    retention: "retain decisions and their provenance according to decision retention",
    migration: "migrate arbitration rows only with coordination record provenance",
    replacement: "a new arbitration outcome explicitly supersedes the prior outcome",
    evidence_targets: ["scaffold/docs_audit/USER-ARBITRATION.md"],
  },
  baseline: {
    owner: "baseline governance maintainer",
    lifecycle: "candidate -> current -> superseded -> archived",
    scope: "one project's promoted audit baseline",
    retention: "retain current and historical promoted baselines",
    migration: "migrate baselines as explicit immutable project artifacts",
    replacement: "promotion explicitly moves the prior current baseline to history",
    evidence_targets: ["tools/perf/promote-baseline-hook.mjs"],
  },
  snapshot: {
    owner: "context snapshot maintainer",
    lifecycle: "captured -> current -> stale -> archived",
    scope: "one point-in-time project context projection",
    retention: "retain the latest snapshot and any snapshots required by open traceability",
    migration: "regenerate snapshots after canonical state migration",
    replacement: "a newer capture supersedes an older context projection",
    evidence_targets: ["tools/perf/reload-check.mjs"],
  },
  runtime_digests: {
    owner: "runtime digest maintainer",
    lifecycle: "generated -> fresh -> stale -> superseded",
    scope: "CURRENT-STATE, RUNTIME-STATE and HANDOFF projections for one project",
    retention: "retain current projections; canonical runtime state owns history",
    migration: "reanchor digests from canonical evidence with explicit --write",
    replacement: "newly generated digests supersede stale projections",
    evidence_targets: ["tools/runtime/project-runtime-state.mjs"],
  },
  repair_findings: {
    owner: "repair layer maintainer",
    lifecycle: "open -> triaged -> resolved|waived -> archived",
    scope: "local repair findings for one project runtime scope",
    retention: "retain open findings and resolved finding provenance under project policy",
    migration: "migrate repair findings only inside the local runtime backend",
    replacement: "a new finding may supersede an earlier one only with an explicit relation",
    evidence_targets: ["src/application/runtime/repair-layer-use-case.mjs"],
  },
  coordination_records: {
    owner: "shared coordination maintainer",
    lifecycle: "created -> processed -> archived",
    scope: "opt-in coordination, planning and handoff records for one workspace",
    retention: "retain shared records under the configured shared coordination policy",
    migration: "use explicit shared coordination backup, migrate or restore commands",
    replacement: "immutable records are superseded by later records, never overwritten implicitly",
    evidence_targets: ["src/core/ports/shared-coordination-store-port.mjs"],
  },
  agent_roster: {
    owner: "agent roster maintainer",
    lifecycle: "declared -> verified -> unavailable|retired",
    scope: "configured agent identities and bounded roles for one project",
    retention: "retain active roster entries and retirement evidence while referenced",
    migration: "migrate roster entries through explicit installed-client configuration changes",
    replacement: "a replacement agent entry names the retired identity and preserved role boundary",
    evidence_targets: ["tools/runtime/verify-agent-roster.mjs"],
  },
  cli_output_contracts: {
    owner: "CLI contract maintainer",
    lifecycle: "proposed -> active -> deprecated -> retired",
    scope: "versioned public JSON output schemas shipped by the package",
    retention: "retain active contracts and deprecated schemas for their documented compatibility window",
    migration: "publish a versioned successor schema and migration note",
    replacement: "successor contracts explicitly identify deprecated predecessors",
    evidence_targets: ["src/core/contracts/cli-output"],
  },
});

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
  const normalizedConcept = normalizeKey(concept);
  const governance = CONCEPT_GOVERNANCE[normalizedConcept];
  if (!governance) {
    throw new Error(`Missing concept-specific governance for ${normalizedConcept}`);
  }
  return freezeDeep({
    concept: normalizedConcept,
    label,
    by_mode: {
      files,
      dual,
      "db-only": dbOnly,
    },
    canonical_mode_by_state: {
      files: "files",
      dual: "dual",
      "db-only": "db-only",
    },
    owner: governance.owner,
    lifecycle: governance.lifecycle,
    scope: governance.scope,
    retention: governance.retention,
    projection,
    projection_is_canonical: false,
    projections: projection === "none" ? [] : [projection],
    migration: governance.migration,
    replacement: governance.replacement,
    evidence_targets: governance.evidence_targets,
    proof_classes: ["source", "scaffold", "fixture", "installed-client", "external-pilot"],
    postgresql: "optional",
    shared_sync: "opt-in",
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
    dbOnly: "protected workflow bootstrap rules, hidden runtime config and minimal re-anchor anchors; detailed visible runtime state is materialized on demand",
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
    sharedRuntime: "workspace_registry and worktree_registry metadata only when explicitly configured",
  }),
  policy({
    concept: "runtime_project_context",
    label: "Runtime project context",
    files: "workspace resolver with optional shared-runtime locator or env identity",
    dual: "runtime_scope_registry plus workspace resolver",
    dbOnly: "runtime_scope_registry plus workspace resolver",
    projection: "project_context fields in runtime JSON status outputs",
    sharedRuntime: "workspace_registry and worktree_registry project context metadata when explicitly configured",
    notes: "PostgreSQL runtime rows use runtime_scope_id as the durable partition key; absolute path scope is legacy migration evidence only.",
  }),
  policy({
    concept: "session_state",
    label: "Session state",
    files: "docs/audit/sessions/S*.md",
    dual: "runtime DB/index canonical state with visible Markdown projection",
    dbOnly: "runtime DB canonical state with protected minimal Markdown re-anchor pointer",
    projection: "CURRENT-STATE.md and runtime heads",
  }),
  policy({
    concept: "cycle_state",
    label: "Cycle state",
    files: "docs/audit/cycles/*/status.md",
    dual: "runtime DB/index canonical state with visible Markdown projection",
    dbOnly: "runtime DB canonical state with protected minimal Markdown re-anchor pointer",
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
    dual: "coordination_records runtime tables with visible Markdown projection",
    dbOnly: "coordination_records runtime tables with visible Markdown materialization on demand",
    projection: "USER-ARBITRATION.md and COORDINATION-SUMMARY.md",
    sharedRuntime: "coordination_records table only when explicitly configured",
    notes: "Decision outcomes are tracked through the coordination record family rather than a separate shared surface.",
  }),
  policy({
    concept: "incident",
    label: "Incident",
    files: "docs/audit/incidents/*.md",
    dual: "repair findings runtime tables with visible Markdown projection",
    dbOnly: "repair findings runtime tables with visible Markdown materialization on demand",
    projection: "incident reports and repair summaries",
    sharedRuntime: "not_shared",
    notes: "Incidents and repair findings remain project-local unless a future ADR and shared port explicitly add them.",
  }),
  policy({
    concept: "coordination_summary",
    label: "Coordination summary",
    files: "docs/audit/COORDINATION-SUMMARY.md",
    dual: "coordination_records runtime tables with visible Markdown projection",
    dbOnly: "coordination_records runtime tables with visible Markdown materialization on demand",
    projection: "COORDINATION-SUMMARY.md",
    sharedRuntime: "coordination_records table only when explicitly configured",
    notes: "Coordination summaries remain local projections unless an explicit shared backend is configured.",
  }),
  policy({
    concept: "coordination_log",
    label: "Coordination log",
    files: "docs/audit/COORDINATION-LOG.md",
    dual: "coordination_records runtime tables with visible Markdown projection",
    dbOnly: "coordination_records runtime tables with visible Markdown materialization on demand",
    projection: "COORDINATION-LOG.md",
    sharedRuntime: "coordination_records table only when explicitly configured",
    notes: "Coordination logs remain local projections unless an explicit shared backend is configured.",
  }),
  policy({
    concept: "user_arbitration",
    label: "User arbitration",
    files: "docs/audit/USER-ARBITRATION.md",
    dual: "coordination_records runtime tables with visible Markdown projection",
    dbOnly: "coordination_records runtime tables with visible Markdown materialization on demand",
    projection: "USER-ARBITRATION.md",
    sharedRuntime: "coordination_records table only when explicitly configured",
    notes: "User arbitration records remain local projections unless an explicit shared backend is configured.",
  }),
  policy({
    concept: "baseline",
    label: "Baseline",
    files: "docs/audit/baseline/current.md and docs/audit/baseline/history.md",
    dual: "local snapshot store with visible Markdown projection",
    dbOnly: "runtime snapshot store with visible Markdown materialization on demand",
    projection: "baseline/current.md and baseline/history.md",
    notes: "Baseline is a local-first reference artifact family and is not shared by default.",
  }),
  policy({
    concept: "snapshot",
    label: "Snapshot",
    files: "docs/audit/snapshots/context-snapshot.md",
    dual: "local snapshot store with visible Markdown projection",
    dbOnly: "runtime snapshot store with visible Markdown materialization on demand",
    projection: "snapshots/context-snapshot.md",
    notes: "Snapshot is a point-in-time local projection used by hydration and reload workflows.",
  }),
  policy({
    concept: "runtime_digests",
    label: "Runtime digests",
    files: "generated Markdown digest files",
    dual: "runtime store plus generated Markdown",
    dbOnly: "runtime store plus protected minimal digest anchors and generated Markdown on demand",
    projection: "RUNTIME-STATE.md and HANDOFF-PACKET.md; aidn runtime state-reanchor repairs CURRENT-STATE.md, RUNTIME-STATE.md and HANDOFF-PACKET.md from canonical runtime evidence",
    notes: "The runtime backend wins over stale visible digest anchors. Reanchor writes are explicit and require --write.",
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
    dbOnly: "runtime/configured agent registry with visible Markdown materialization on demand",
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
    canonical_mode_by_state: { ...item.canonical_mode_by_state },
    projections: [...item.projections],
    proof_classes: [...item.proof_classes],
    evidence_targets: [...item.evidence_targets],
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
      canonical_mode_by_state: { ...item.canonical_mode_by_state },
      projections: [...item.projections],
      proof_classes: [...item.proof_classes],
      evidence_targets: [...item.evidence_targets],
    };
  }
  return {
    concept: item.concept,
    label: item.label,
    state_mode: normalizedMode,
    source_of_truth: item.by_mode[normalizedMode],
    canonical_mode: item.canonical_mode_by_state[normalizedMode],
    owner: item.owner,
    lifecycle: item.lifecycle,
    scope: item.scope,
    retention: item.retention,
    projection: item.projection,
    projection_is_canonical: item.projection_is_canonical,
    projections: [...item.projections],
    migration: item.migration,
    replacement: item.replacement,
    proof_classes: [...item.proof_classes],
    evidence_targets: [...item.evidence_targets],
    postgresql: item.postgresql,
    shared_sync: item.shared_sync,
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
    for (const field of ["owner", "lifecycle", "scope", "retention", "migration", "replacement"]) {
      if (!String(item[field] ?? "").trim()) {
        issues.push(`${item.concept}: missing ${field}`);
      }
    }
    if (!Array.isArray(item.evidence_targets) || item.evidence_targets.length === 0) {
      issues.push(`${item.concept}: missing concept-specific evidence_targets`);
    }
    if (String(item.owner).includes("information governance steward")
      || String(item.retention).startsWith("retain while active")
      || String(item.migration).startsWith("State-mode changes use")) {
      issues.push(`${item.concept}: generic governance defaults are forbidden`);
    }
    if (item.projection_is_canonical !== false) {
      issues.push(`${item.concept}: projections must not be implicitly canonical`);
    }
    if (item.postgresql !== "optional") {
      issues.push(`${item.concept}: PostgreSQL must remain optional`);
    }
    if (item.shared_sync !== "opt-in") {
      issues.push(`${item.concept}: shared sync must remain opt-in`);
    }
    if (JSON.stringify(item.proof_classes) !== JSON.stringify(["source", "scaffold", "fixture", "installed-client", "external-pilot"])) {
      issues.push(`${item.concept}: proof class boundary is incomplete`);
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
