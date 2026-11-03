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
  standard_workflow_model: {
    owner: "package workflow model maintainer",
    lifecycle: "authored package component -> verified component; complete standard integration remains separately qualified",
    scope: "versioned package IR and catalog; never inferred from runtime default-engine selection",
    retention: "retain source revisions and distributed archives; instances embed their exact model and journals retain the source descriptor",
    migration: "explicit future selection only; no historical instance conversion or automatic pin refresh",
    replacement: "reviewed model/catalog source update; implementation-only refresh increments revision and refuses changed authority or binding semantics",
    evidence_targets: ["src/application/runtime/standard-session-pr-successor-authority.mjs", "src/application/runtime/standard-session-pr-checkpoint.mjs", "src/application/runtime/standard-session-pr-update-push.mjs", "src/core/contracts/workflow-definition/standard-session-pr-checkpoint-input.v1.schema.json", "src/core/contracts/workflow-definition/standard-session-pr-checkpoint-plan.v1.schema.json", "src/core/contracts/workflow-definition/standard-session-pr-checkpoint-output.v1.schema.json", "src/core/contracts/workflow-definition/standard-session-pr-update-push-input.v1.schema.json", "src/core/contracts/workflow-definition/standard-session-pr-update-push-plan.v1.schema.json", "src/core/contracts/workflow-definition/standard-session-pr-update-push-output.v1.schema.json", "tools/perf/verify-standard-process-binding-input-fixtures.mjs", "tools/perf/standard-session-pr-successor-fixture-lib.mjs", "tools/perf/verify-standard-session-pr-successor-fixtures.mjs", "src/application/runtime/standard-session-pr-record.mjs", "src/application/runtime/standard-session-pr-record-authority.mjs", "src/core/workflow/standard-session-pr-record.mjs", "src/core/contracts/workflow-definition/standard-session-pr-record-input.v1.schema.json", "src/core/contracts/workflow-definition/standard-session-pr-record-plan.v1.schema.json", "src/core/contracts/workflow-definition/standard-session-pr-record-output.v1.schema.json", "tools/perf/verify-standard-session-pr-record-fixtures.mjs", "tools/perf/verify-standard-session-pr-record-authority-fixtures.mjs", "src/application/runtime/standard-session-pr-open.mjs", "src/adapters/git-provider/github-pull-request-open.mjs", "src/core/contracts/workflow-definition/standard-session-pr-open-input.v1.schema.json", "src/core/contracts/workflow-definition/standard-session-pr-open-plan.v1.schema.json", "src/core/contracts/workflow-definition/standard-session-pr-open-output.v1.schema.json", "src/core/contracts/workflow-definition/github-pr-open-request.v1.schema.json", "src/core/contracts/workflow-definition/github-pr-open-plan.v1.schema.json", "src/core/contracts/workflow-definition/github-pr-link.v1.schema.json", "tools/perf/verify-github-pr-open-fixtures.mjs", "tools/perf/verify-standard-session-pr-open-fixtures.mjs", "src/application/runtime/standard-session-push.mjs", "src/adapters/runtime/local-workflow-session-push.mjs", "src/core/contracts/workflow-definition/standard-session-push-input.v1.schema.json", "src/core/contracts/workflow-definition/standard-session-push-plan.v1.schema.json", "src/core/contracts/workflow-definition/standard-session-push-output.v1.schema.json", "tools/perf/verify-standard-session-push-fixtures.mjs", "src/application/runtime/standard-session-pr-admission.mjs", "src/core/contracts/workflow-definition/standard-session-pr-admission-input.v1.schema.json", "src/core/contracts/workflow-definition/standard-session-pr-admission-output.v1.schema.json", "tools/perf/verify-standard-session-pr-admission-fixtures.mjs", "src/application/runtime/standard-session-branch-integration.mjs", "src/application/runtime/standard-session-branch-integration-authority.mjs", "src/core/workflow/standard-session-branch-integration-decision.mjs", "src/core/contracts/workflow-definition/process-decision-inbox.v6.schema.json", "tools/perf/verify-standard-session-branch-integration-human-fixtures.mjs", "tools/perf/verify-standard-session-branch-integration-port-fixtures.mjs", "tools/perf/verify-standard-session-branch-integration-authority-fixtures.mjs", "src/application/runtime/standard-session-delivery-checkpoint.mjs", "src/application/runtime/standard-session-preclose-checkpoint.mjs", "tools/perf/verify-standard-session-preclose-checkpoint-fixtures.mjs", "tools/perf/verify-standard-session-closure-human-fixtures.mjs", "tools/perf/verify-standard-session-closure-context-fixtures.mjs", "src/application/runtime/standard-session-closure-review.mjs", "src/application/runtime/standard-session-closure-authority.mjs", "src/application/runtime/standard-session-close-record.mjs", "src/application/runtime/standard-session-close-checkpoint.mjs", "src/application/runtime/standard-session-close-hook.mjs", "src/core/workflow/standard-session-close-render.mjs", "src/application/runtime/standard-session-closure-context.mjs", "src/core/workflow/standard-session-closure-decision.mjs", "src/core/contracts/workflow-definition/process-decision-inbox.v5.schema.json", "tools/perf/verify-standard-drift-session-scope-fixtures.mjs", "tools/perf/verify-standard-session-close-admission-fixtures.mjs", "src/application/runtime/close-session-admit-use-case.mjs", "src/application/runtime/close-session-context-service.mjs", "src/core/contracts/workflow-definition/standard-session-close-admission-output.v1.schema.json", "tools/perf/verify-standard-baseline-promotion-checkpoint-contract-fixtures.mjs", "src/application/runtime/standard-baseline-promotion-checkpoint.mjs", "src/core/contracts/workflow-definition/standard-baseline-promotion-checkpoint-input.v1.schema.json", "src/core/contracts/workflow-definition/standard-baseline-promotion-checkpoint-plan.v1.schema.json", "src/core/contracts/workflow-definition/standard-baseline-promotion-checkpoint-output.v1.schema.json", "tools/perf/verify-standard-cycle-terminal-checkpoint-contract-fixtures.mjs", "src/application/runtime/standard-cycle-terminal-checkpoint.mjs", "src/core/contracts/workflow-definition/standard-cycle-terminal-checkpoint-input.v1.schema.json", "src/core/contracts/workflow-definition/standard-cycle-terminal-checkpoint-plan.v1.schema.json", "src/core/contracts/workflow-definition/standard-cycle-terminal-checkpoint-output.v1.schema.json", "package/catalogs/process-models/aidn-standard.v1.json", "package/catalogs/standard-workflow.v1.json", "src/application/runtime/standard-workflow-git-checkpoint.mjs", "src/adapters/runtime/local-workflow-git-checkpoint.mjs", "tools/perf/verify-workflow-git-checkpoint-port-fixtures.mjs", "src/application/runtime/standard-workflow-composition.mjs", "tools/perf/verify-standard-workflow-composition-fixtures.mjs", "tools/perf/verify-standard-workflow-composition-prefix-fixtures.mjs", "package/catalogs/process-models/aidn-standard-startup.v1.json", "package/catalogs/standard-workflow-startup.v1.json", "src/application/runtime/standard-workflow-startup-composition.mjs", "tools/perf/verify-standard-workflow-model-fixtures.mjs", "tools/perf/verify-standard-workflow-mode-fixtures.mjs", "package/catalogs/process-models/aidn-standard-cycle-create.v1.json", "package/catalogs/standard-workflow-cycle-create.v1.json", "src/application/runtime/standard-workflow-cycle-composition.mjs", "tools/perf/verify-standard-workflow-cycle-fixtures.mjs"],
  },
  native_allocation_journal: {
    owner: "trusted owned native allocation supervisor",
    lifecycle: "reserved -> closed|failed|unresolved; unknown termination or recording requires explicit reconciliation",
    scope: "one physical process scope and instance; up to 32 allocation generations under the original ceilings",
    retention: "retain signed generation reservations, closure observations and protected checkpoint references without automatic purge",
    migration: "new explicit artifact records only; no adoption of unsigned host snapshots or historical instance conversion",
    replacement: "canonical artifact CAS and host MAC; no PID, elapsed-time takeover, deadline reset or automatic retry",
    evidence_targets: ["src/core/workflow/native-activity-output.mjs", "src/application/runtime/standard-cycle-plan-context.mjs", "tools/perf/cycle-planning-fixture-lib.mjs", "src/core/workflow/native-allocation-journal.mjs", "src/adapters/runtime/native-allocation-journal-store.mjs", "src/application/runtime/journaled-native-allocation.mjs", "src/application/runtime/native-allocation-worker-authority.mjs", "src/application/runtime/native-allocation-evidence.mjs", "src/application/runtime/native-allocation-controls.mjs", "tools/perf/verify-agentic-process-execution-fixtures.mjs", "tools/perf/verify-workflow-record-storage-fixtures.mjs"],
  },
  process_control_inbox: {
    owner: "trusted process human/external delivery host",
    lifecycle: "reserved after source verification -> delivered; missing acknowledgement is reconciled from the canonical event",
    scope: "physical project, source event identity and exact pinned occurrence/revision/context",
    retention: "retain immutable source, request, delivery, deduplication identity and delivery checkpoint without automatic purge",
    migration: "new explicit inbox records; no inference from historical messages or silent instance conversion",
    replacement: "signed artifact CAS; a source event cannot authorize a different request and accepted effects are never replayed",
    evidence_targets: ["src/core/workflow/process-control-inbox.mjs", "src/adapters/runtime/process-control-inbox-store.mjs", "src/application/runtime/standard-workflow-control-inbox.mjs", "tools/perf/verify-standard-workflow-control-fixtures.mjs"],
  },
  process_decision_inbox: {
    owner: "trusted human decision capture host",
    lifecycle: "reserved -> receipted; absent or unverified source never completes an operation",
    scope: "physical project, authenticated source event and exact process operation/question",
    retention: "retain immutable source, deduplication identity and receipt acknowledgement without automatic purge",
    migration: "typed inbox versions v1-v6 coexist; v6 records explicit local session integration consent; never infer a decision from retain/promotion/CLOSED or convert historical instances",
    replacement: "signed canonical artifact CAS; source identity cannot be reused for another operation",
    evidence_targets: ["src/application/runtime/standard-session-branch-integration.mjs", "src/application/runtime/standard-session-branch-integration-authority.mjs", "src/core/workflow/standard-session-branch-integration-decision.mjs", "src/core/contracts/workflow-definition/process-decision-inbox.v6.schema.json", "tools/perf/verify-standard-session-branch-integration-human-fixtures.mjs", "tools/perf/verify-standard-session-branch-integration-port-fixtures.mjs", "tools/perf/verify-standard-session-branch-integration-authority-fixtures.mjs", "src/application/runtime/standard-drift-recovery.mjs", "tools/perf/verify-drift-recovery-fixtures.mjs", "src/core/workflow/process-decision-inbox.mjs", "src/adapters/runtime/process-decision-inbox-store.mjs", "src/application/runtime/standard-workflow-human-decisions.mjs", "tools/perf/verify-standard-workflow-mode-fixtures.mjs"],
  },
  process_operation_journal: {
    owner: "trusted operation execution host",
    lifecycle: "staged -> dispatching -> receipted; interrupted dispatch remains explicitly unresolved",
    scope: "one pinned process occurrence, physical project and canonical runtime authority",
    retention: "retain signed previews, intent, dispatch owner and authenticated results without automatic purge",
    migration: "new versioned artifact records; no historical instance conversion or key rotation fallback",
    replacement: "canonical artifact CAS, trusted host authentication and explicit phase progression; no dispatch takeover by PID or time",
    evidence_targets: ["src/core/workflow/standard-cycle-work.mjs", "tools/perf/cycle-work-contract-fixture-lib.mjs", "src/core/workflow/standard-cycle-readiness.mjs", "src/application/runtime/standard-cycle-implementation.mjs", "src/application/runtime/standard-cycle-plan-context.mjs", "src/application/runtime/standard-cycle-plan-record.mjs", "tools/perf/cycle-planning-fixture-lib.mjs", "src/application/runtime/standard-cycle-checkpoint.mjs", "tools/perf/verify-standard-workflow-cycle-fixtures.mjs", "src/application/runtime/standard-drift-cycle.mjs", "tools/perf/drift-cycle-fixture-lib.mjs", "src/application/runtime/standard-drift-change-request.mjs", "tools/perf/verify-drift-recovery-fixtures.mjs", "src/core/workflow/process-operation-journal.mjs", "src/adapters/runtime/process-operation-journal-store.mjs", "src/application/runtime/standard-workflow-operation-host.mjs", "tools/perf/verify-standard-workflow-host-fixtures.mjs", "tools/perf/verify-workflow-record-storage-fixtures.mjs"],
  },
  process_local_effect_owner: {
    owner: "trusted local workflow operation or mixed native allocation host",
    lifecycle: "absent -> exclusively acquired -> released|retained for explicit reconciliation",
    scope: "one physical worktree; cooperative local serialization only, independent of business artifact backend",
    retention: "release after confirmed completion or before-effect refusal; retain after unknown effects or process death",
    migration: "new versioned local lock; never convert historical instances or transfer canonical business authority",
    replacement: "exclusive filesystem create; no PID or time based takeover and no implicit retry",
    evidence_targets: ["src/application/runtime/standard-workflow-artifacts.mjs", "tools/perf/verify-standard-workflow-ports-fixtures.mjs"],
  },
  agent_working_memory: {
    owner: "checkpointing agent",
    lifecycle: "captured -> current|stale|invalid -> explicitly recaptured",
    scope: "one agent in one worktree; local advisory context only",
    retention: "five checkpoint observations per agent; raw evidence retained by the existing hook store",
    migration: "reconstruct by explicit checkpoint from typed agent input and current evidence; no database migration",
    replacement: "a new admitted checkpoint replaces the latest pointer; stale capsules never supply actionable context",
    evidence_targets: ["src/application/runtime/agent-working-memory-service.mjs", "tools/perf/verify-agent-working-memory-fixtures.mjs"],
  },
  workflow_selection: {
    owner: "project workflow maintainer",
    lifecycle: "proposed -> reviewed -> explicitly selected -> superseded; existing instances remain pinned",
    scope: "one workflow identity in a physical target and canonical runtime scope with pinned activation",
    retention: "retain the canonical seed, every selected proposal and its exact review evidence; no automatic purge",
    migration: "no authority transfer from SPEC and no automatic instance, definition or compiler migration",
    replacement: "fresh deterministic preview, permission ceiling, exact review hash and canonical compare-and-swap",
    evidence_targets: ["src/core/workflow/workflow-candidate.mjs", "src/core/workflow/workflow-selection.mjs", "src/application/runtime/workflow-candidate-composition.mjs"],
  },
  workflow_instance: {
    owner: "project workflow maintainer",
    lifecycle: "waiting -> reconciliation_required -> waiting|terminal; unsupported handlers remain unavailable",
    scope: "explicit physical target, runtime scope and activation revision; one pinned definition and compilation",
    retention: "retain typed decisions, effect intents and supervisor proof references without automatic purge",
    migration: "no automatic definition, compiler or context migration; historical inspection remains read-only",
    replacement: "compare canonical content hash and append a typed checkpoint; ambiguous effects require supervisor reconciliation",
    evidence_targets: ["src/core/workflow/workflow-instance.mjs", "src/adapters/runtime/workflow-instance-store.mjs", "src/application/runtime/workflow-instance-composition.mjs"],
  },
  agentic_process_instance: {
    owner: "project workflow maintainer and trusted execution host",
    lifecycle: "READY|RUNNING|WAITING -> COMPLETED|FAILED|CANCELLED; admitted assignments and authenticated results remain distinct",
    scope: "one canonical runtime scope, pinned model/profile, policy fingerprints and scoped activity occurrences",
    retention: "retain declared immutable initial parameters with ordered routing, assignment, result and cancellation events; no automatic purge",
    migration: "separate versioned format; no conversion of existing instances or automatic installation activation",
    replacement: "explicit write and canonical artifact compare-and-swap; historical instances retain their model and policy pins",
    evidence_targets: ["src/core/workflow/agentic-process.mjs", "src/adapters/runtime/agentic-process-store.mjs", "src/application/runtime/agentic-process-service.mjs", "src/application/workflow/bpmn-process-service.mjs", "src/core/workflow/agentic-process-simulation.mjs", "src/core/workflow/process-data-contracts.mjs", "src/core/contracts/workflow-definition/process-data-bindings.v1.schema.json"],
  },
  project_activation: {
    owner: "project maintainer",
    lifecycle: "absent -> authorized -> revoked; local preparation determines active or degraded status",
    scope: "one physical Git repository common directory, with validated per-worktree assets; local physical directory when Git is absent",
    retention: "retain authorization revision and revocation locally; never project into shared workflow state",
    migration: "validated legacy receipts remain distinguishable as legacy-active; explicit authorization binds them to repository scope",
    replacement: "explicit authorize or revoke after preview; authority revision and byte preconditions are compared under a common lock",
    evidence_targets: ["src/application/install/project-activation-service.mjs"],
  },
  install_assets: {
    owner: "local installation maintainer",
    lifecycle: "planned -> applying -> installed|interrupted -> repaired|rolled_back|uninstalled",
    scope: "AIDN-owned project assets, explicitly bound host Codex assets and host runtime generations; project activation and workflow data remain local",
    retention: "retain transaction pre-images and receipts locally after rollback or uninstall; never include in shared runtime",
    migration: "adopt only exact known legacy fingerprints or identical package assets; divergent assets require resolution",
    replacement: "compare recorded post-images before changing owned files, blocks, hook entries or an explicitly bound host skills configuration",
    evidence_targets: ["src/application/install/codex-assets-service.mjs", "src/application/install/installation-ownership-service.mjs", "src/application/install/global-runtime-store.mjs", "tools/setup/global-project-provision.mjs"],
  },
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
    scope: "one installed project's workflow adapter policy; package source adoption has its own explicitly scoped declaration",
    retention: "retain while the project is governed and archive with project policy history; retain adoption revisions and immutable predecessor references without automatic purge",
    migration: "use project config migration with explicit --write",
    replacement: "a successor adapter file replaces the prior version through an explicit migration",
    evidence_targets: ["src/lib/config/workflow-adapter-config-lib.mjs", "src/core/governance/adoption-policy.mjs", "package/governance/gfd-adoption.v1.json"],
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
    evidence_targets: ["src/adapters/runtime/artifact-store.mjs", "src/application/runtime/project-artifact-store-service.mjs", "src/application/runtime/artifact-query-service.mjs", "src/application/runtime/artifact-query-catalog.mjs", "src/application/runtime/artifact-task-query-service.mjs", "tools/perf/verify-artifact-task-query-fixtures.mjs"],
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
    replacement: "legacy shared rows may be upserted and do not establish immutable attempt evidence; execution_events have a separate append-only contract",
    evidence_targets: ["src/core/ports/shared-coordination-store-port.mjs", "src/core/agents/agent-reuse-policy.mjs", "src/application/runtime/agent-reuse-decision-service.mjs"],
  },
  execution_run: {
    owner: "supervising coordinator",
    lifecycle: "planned -> running -> completed|failed|cancelled|recovery_required",
    scope: "one admitted canonical task and frozen plan on one supervisor host; at most one mutating run per canonical scope",
    retention: "retain run identity, frozen plan and exact configuration including any workflow segment binding, cancellation request, cleanup generations and exact resource outcomes with acceptance evidence; archives, transcripts and Git refs remain retained; no automatic purge in V1",
    migration: "explicit additive shared PostgreSQL schema 2 to 3 to 4 to 5 to 6 migrations; readiness and normal writes never apply DDL",
    replacement: "a changed plan requires a new run identity and fingerprint; never overwrite prior run evidence",
    evidence_targets: ["src/core/agents/agent-execution-contracts.mjs", "src/core/contracts/agent-execution", "src/core/ports/agent-execution-store-port.mjs", "src/adapters/runtime/postgres-agent-execution-store.mjs", "tools/perf/sql/shared-coordination-postgres-v3.sql", "tools/perf/sql/shared-coordination-postgres-v4.sql", "tools/perf/sql/shared-coordination-postgres-v5.sql", "tools/perf/sql/shared-coordination-postgres-v6.sql", "src/application/runtime/agent-run-lifecycle-service.mjs", "src/core/workflow/workflow-segment-binding.mjs", "src/core/contracts/workflow-definition/workflow-segment-binding.v1.schema.json", "src/application/runtime/agent-run-cleanup-service.mjs", "src/core/contracts/cli-output/runtime-agent-run.v1.schema.json", "src/adapters/runtime/local-agent-verification.mjs", "src/application/runtime/agent-run-supervisor.mjs", "src/application/runtime/agent-task-integration-service.mjs", "docs/ADR/ADR-0014-bounded-agent-orchestration.md"],
  },
  delegated_task: {
    owner: "supervising coordinator",
    lifecycle: "pending -> ready -> running -> accepted|failed|blocked|cancelled",
    scope: "one task identity within a run, bounded by exact file operations and the existing canonical session, cycle and task",
    retention: "retain dependencies, scope and acceptance contract with the parent run; no automatic purge in V1",
    migration: "explicit additive shared PostgreSQL schema 2 to 3 to 4 to 5 to 6 migrations; no synthetic sessions or local fallback task store",
    replacement: "scope or objective changes require a new frozen plan; delegated identifiers never replace canonical task identity",
    evidence_targets: ["src/core/agents/agent-execution-contracts.mjs", "src/core/contracts/agent-execution", "src/core/ports/agent-execution-store-port.mjs", "src/adapters/runtime/postgres-agent-execution-store.mjs", "tools/perf/sql/shared-coordination-postgres-v3.sql", "tools/perf/sql/shared-coordination-postgres-v4.sql", "tools/perf/sql/shared-coordination-postgres-v5.sql", "tools/perf/sql/shared-coordination-postgres-v6.sql", "src/application/runtime/agent-run-lifecycle-service.mjs", "src/application/runtime/agent-run-cleanup-service.mjs", "src/core/contracts/cli-output/runtime-agent-run.v1.schema.json", "src/adapters/runtime/local-agent-verification.mjs", "src/application/runtime/agent-run-supervisor.mjs", "src/application/runtime/agent-task-integration-service.mjs", "docs/ADR/ADR-0014-bounded-agent-orchestration.md"],
  },
  execution_attempt: {
    owner: "supervising coordinator; executor owns process observations only",
    lifecycle: "launch_intended -> running -> completed|failed|cancelled|timed_out|recovery_required",
    scope: "one ordinal attempt for one delegated task; delegation, ownership and terminal result bind to that attempt",
    retention: "retain attempt evidence and local transcripts; no automatic purge in V1; shared results contain references, byte counts and hashes only",
    migration: "explicit additive shared PostgreSQL schema 2 to 3 to 4 to 5 to 6 migrations; local evidence files are never ownership authority",
    replacement: "new attempt identity after explicit reconciliation; late or ownership-stale results cannot replace accepted evidence",
    evidence_targets: ["src/core/agents/agent-execution-contracts.mjs", "src/core/ports/agent-task-executor-port.mjs", "src/core/contracts/agent-execution", "src/core/ports/agent-execution-store-port.mjs", "src/adapters/runtime/postgres-agent-execution-store.mjs", "tools/perf/sql/shared-coordination-postgres-v3.sql", "tools/perf/sql/shared-coordination-postgres-v4.sql", "tools/perf/sql/shared-coordination-postgres-v5.sql", "tools/perf/sql/shared-coordination-postgres-v6.sql", "src/application/runtime/agent-run-lifecycle-service.mjs", "src/application/runtime/agent-run-cleanup-service.mjs", "src/core/contracts/cli-output/runtime-agent-run.v1.schema.json", "src/adapters/runtime/local-agent-verification.mjs", "src/application/runtime/agent-run-supervisor.mjs", "src/application/runtime/agent-task-integration-service.mjs"],
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
  coverageKind = null,
  authorityBackend = null,
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
    ...(coverageKind ? { coverage_kind: coverageKind } : {}),
    ...(authorityBackend ? { authority_backend: authorityBackend } : {}),
    notes,
  });
}

const SOURCE_OF_TRUTH_POLICIES = freezeDeep([
  policy({
    concept: "agent_working_memory", label: "Derived agent working memory",
    files: "referenced checkout evidence and agent-authored checkpoint input",
    dual: "configured canonical runtime snapshot and referenced checkout evidence; fresh revision binding required",
    dbOnly: "configured canonical runtime snapshot and referenced checkout evidence; fresh revision binding required",
    projection: ".aidn/runtime/context/agents/* hook store and explicit handoff resume_capsule",
    notes: "Advisory and reconstructible. Never permission, admission, canonical decisions or shared coordination. DB reuse binds to fresh coherent canonical payload and heads; PostgreSQL unavailability refuses without fallback. Metrics remain diagnostic.",
  }),
  policy({
    concept: "workflow_selection", label: "Reviewed workflow definition selection",
    files: "docs/audit/workflows/definitions/<workflow-id>.json; configured PostgreSQL remains canonical",
    dual: "configured runtime artifact store; visible JSON is derived",
    dbOnly: "configured runtime artifact store; no automatic visible projection",
    projection: "definition JSON, deterministic Markdown/Mermaid and the derived CLI/dashboard view carrying compiler identities and hashes",
    notes: "ADR-0019 internal opt-in selection for future instances. Initial baseline is a terminal canonical instance; later proposals use the current selection. Suggestions cannot grant permissions or replace SPEC. Current activation, context and canonical artifact CAS remain required. Shared coordination boundaries and existing run reservation fencing are unchanged.",
  }),
  policy({
    concept: "workflow_instance", label: "Durable workflow instance",
    files: "docs/audit/workflows/instances/<id>.json; configured PostgreSQL remains canonical",
    dual: "configured runtime artifact store; visible JSON is a derived projection",
    dbOnly: "configured runtime artifact store; no automatic visible projection",
    projection: "docs/audit/workflows/instances/<id>.json in dual or files with configured PostgreSQL; common CLI/dashboard read model is derived, never write authority",
    notes: "ADR-0018 internal opt-in composition; SPEC remains rule authority. SQLite uses existing artifact tables; PostgreSQL uses existing contextual artifacts and reservation fence. Sequential human checkpoints require no PostgreSQL. Agent segments retain exclusive existing supervisor admission. No new shared coordination table or automatic client activation.",
  }),
  policy({
    concept: "agentic_process_instance", label: "Structured agentic process instance",
    files: "docs/audit/workflows/process-instances/<id>.json; configured PostgreSQL remains canonical",
    dual: "configured runtime artifact store; visible JSON is a derived projection",
    dbOnly: "configured runtime artifact store; no automatic visible projection",
    projection: "workflows/process-instances/<id>.json only through the existing explicit artifact materialization",
    notes: "ADR-0022/ADR-0023/ADR-0024/ADR-0025. Default engine for every new workflow, including direct JSON. Existing project artifact CAS/fence and backend selection. Historical sequential and v1 process instances retain their readers. V2 operation intentions and authenticated receipts are events inside this same governed instance, not a new shared table or an independent registry. Versioned host bindings are configuration inputs, never self-issued permission. The instance pins canonical IR and policy hashes; authored BPMN and in-memory compilation/source maps are modeling inputs and derived values, never native authority. Synthetic simulation traces are reference evidence, not canonical process state. Trusted assignment/result and operation-authority ports remain mandatory. The standard model and actual business adapters remain a separate unfinished delivery; no implicit activation.",
  }),
  policy({
    concept: "process_local_effect_owner", label: "Local process operation owner",
    files: ".aidn/runtime/standard-workflow/effects.lock",
    dual: ".aidn/runtime/standard-workflow/effects.lock",
    dbOnly: ".aidn/runtime/standard-workflow/effects.lock",
    projection: "none; machine-local collision guard only",
    notes: "Versioned token, process id, physical-root hash, exact plan hash and acquisition time. The token grants no admission or permission. It neither fences external tools nor supplies a durable effect journal or distributed ownership. Unknown effects retain the record; the L4 recovery protocol remains required before ordinary workflow integration.",
  }),
  policy({
    concept: "standard_workflow_model", label: "Packaged standard process model components",
    files: "versioned package/catalogs/standard-workflow-{startup,cycle-create}.v1.json and their exact package/catalogs/process-models/aidn-standard-{startup,cycle-create}.v1.json",
    dual: "same versioned package assets; project instances and operation journals use their configured canonical artifact store",
    dbOnly: "same versioned package assets; no fallback from canonical project state to package fixtures",
    projection: "source descriptor retained in signed operation previews; component IR embedded in its process instance",
    notes: "Fresh-session startup and cycle scaffold components only, not the complete standard model, full cycle-create skill or ordinary default workflow selection. Catalog pins model, exact code bindings, SPEC and skill sources. Loading refuses changed bytes instead of repairing pins. Metadata never grants effects, human identity or native qualification. No new runtime table.",
  }),
  policy({
    concept: "native_allocation_journal", label: "Authenticated native allocation journal",
    files: "docs/audit/workflows/native-allocations/<id>.json; configured PostgreSQL remains canonical",
    dual: "configured runtime artifact store; visible JSON is derived",
    dbOnly: "configured runtime artifact store; no automatic visible projection",
    projection: "workflows/native-allocations/<id>.json only when the configured projection is required",
    notes: "Canonical CAS reservation precedes owned worker launch. A trusted key authenticates actual supervisor closure and bounded checkpoint references, not business approval. Unknown or failed allocations cannot retry. Ordinary start preserves its pristine guard; explicit continuation verifies closed history and signed controls, current context and required projections, debits retained ceilings and uses fresh resources. The opt-in standard-mixed.v1 scope additionally authenticates operation history and uses the existing worktree effect owner. The fixed trusted worker receives an ephemeral private verification capability, never a model-selected key. Long-wait budget authority, provider identity, full standard integration and live native/installed qualification remain separate. Existing artifact backend only, no shared coordination table or anti-rollback guarantee.",
  }),
  policy({
    concept: "process_control_inbox", label: "Authenticated process control inbox",
    files: "docs/audit/workflows/control-inbox/<id>.json; configured PostgreSQL remains canonical",
    dual: "configured runtime artifact store; visible JSON is derived",
    dbOnly: "configured runtime artifact store; no automatic visible projection",
    projection: "workflows/control-inbox/<id>.json only when the configured derived projection is required",
    notes: "Existing canonical artifact CAS, no shared coordination table. A trusted source verifies identity and an exact request including instance, correlation, available events, branch/head and context hash. Signed reservation precedes the reducer event, acknowledgement follows it. Reopening authenticates both operation and control histories. Missing sources wait without polling or model allocation. Generic delivery is not proof of a GitHub adapter, provider freshness, business approval or native mixed resume.",
  }),
  policy({
    concept: "process_decision_inbox", label: "Authenticated human decision inbox",
    files: "docs/audit/workflows/decision-inbox/<id>.json; configured PostgreSQL remains canonical",
    dual: "configured runtime artifact store; visible JSON is derived",
    dbOnly: "configured runtime artifact store; no automatic visible projection",
    projection: "workflows/decision-inbox/<id>.json for required dual projection only",
    notes: "Existing artifact CAS, no new coordination table. Source identity and exact question are verified through trusted host capabilities, then retained under the host MAC. No raw model/user JSON authenticates itself. Absence waits; refusal, deferral and cancellation have explicit non-success receipts. Native human channel, provider events and general effect-owner recovery remain separate qualifications.",
  }),
  policy({
    concept: "process_operation_journal", label: "Authenticated process operation journal",
    files: "docs/audit/workflows/operation-records/<id>.json; configured PostgreSQL remains canonical",
    dual: "configured runtime artifact store; visible JSON is derived",
    dbOnly: "configured runtime artifact store; no automatic visible projection",
    projection: "workflows/operation-records/<id>.json for required dual projection only",
    notes: "No shared coordination table. Trusted host signs exact preview/intent, owner and output/receipt using an out-of-product key capability. Optional declarative input resolution is retained inside that same signed preview, with source identities/hashes and fixed input normalization; it grants no authority. Hashes alone do not authenticate results or human decisions. A receipted result can be accepted after restart without dispatch; dispatching requires reconciliation, never automatic retry. Native host, key isolation, distributed ownership and provider recovery remain separately qualified.",
  }),
  ...["execution_run", "delegated_task", "execution_attempt"].map((concept) => policy({
    concept,
    label: { execution_run: "Bounded execution run", delegated_task: "Delegated task", execution_attempt: "Execution attempt" }[concept],
    files: "PostgreSQL supervised execution authority; canonical runtime must share the same transaction; explicit qualified composition required",
    dual: "PostgreSQL supervised execution authority; canonical runtime must share the same transaction; explicit qualified composition required",
    dbOnly: "PostgreSQL supervised execution authority; canonical runtime must share the same transaction; explicit qualified composition required",
    projection: "read-only runtime agent-run* JSON status and action previews",
    sharedRuntime: { execution_run: "execution_runs, execution_supervisors, execution_run_validations, execution_cancel_requests, execution_cleanup_operations and execution_cleanup_resources", delegated_task: "execution_tasks, execution_integration_intents and execution_integrations", execution_attempt: "execution_attempts, execution_events and execution_acceptances" }[concept],
    coverageKind: "supervision_candidate",
    authorityBackend: "postgres",
    notes: "Bounded scheduler, durable supervisor generations, pre-Git intent, authenticated acceptance and Git integration. Public agent-run, agent-run-status, agent-run-resume, agent-run-cancel and agent-run-cleanup are a conditional native prototype, unavailable without explicit configuration and matching native qualification. PostgreSQL remains optional for existing workflows and exclusive for supervision in the same transaction as canonical runtime. Cancellation and cleanup journals belong to execution_run, not independent information concepts. Codex supplies and configures its sandbox outside the AIDN lifecycle. AIDN retains run authority and native qualification evidence, not host setup journals or Windows administration. Missing or incompatible native prerequisites refuse execution without repair or fallback. Cleanup requires a completed run, proven termination, retained exact resources and integrated commits; failed resources and evidence remain retained. No files, SQLite or in-memory authority fallback, inferred runtime instances, implicit writes or automatic purge. Expiration requires reconciliation of the supervisor, descendants and Git operations before transfer. Fixture verifiers do not establish native qualification.",
  })),
  policy({
    concept: "project_activation",
    label: "Project workflow activation",
    files: "Git common directory aidn/authorization.json; non-Git fallback .aidn/install/authorization.json",
    dual: "Git common directory aidn/authorization.json; non-Git fallback .aidn/install/authorization.json",
    dbOnly: "Git common directory aidn/authorization.json; non-Git fallback .aidn/install/authorization.json",
    projection: "compact activation in bootstrap diagnostics and runtime admission",
    notes: "Authorization and per-worktree preparation are both required; copied configuration, stale cache and native trust are not activation authority. Revocation dominates local receipts and cannot be undone implicitly by asset recovery.",
  }),
  policy({
    concept: "install_assets",
    label: "Local installation ownership",
    files: ".aidn/install/receipt.json and referenced local transactions",
    dual: ".aidn/install/receipt.json and referenced local transactions",
    dbOnly: ".aidn/install/receipt.json and referenced local transactions",
    projection: "bootstrap asset plans, installation diagnostics and config install.aidnVersion",
    notes: "Local installation recovery and completion authority only; never workflow admission or runtime state. VERSION in the executing package is the sole product version authority; the receipt binds the last complete successful installation and config install.aidnVersion projects that fact. For explicitly migrated projects, receipt.global_runtime binds the host installation identity and integration revision; AIDN_HOME/runtime.json, the verified generation manifest and transaction journal determine the active engine, not the historical project package marker. See ADR-0013 for the incomplete public rollout boundary.",
  }),
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
    notes: "Project policy may be versioned by the installed client repository. Optional governanceAdoption remains explicit, scoped and locally canonical in every mode; no detection, install default or source declaration accepts it for a client. Package-source adoption is scoped separately in package/governance/gfd-adoption.v1.json under ADR-0010. Read-only governance diagnostics project the two declarations separately; optional controlCoverage classifies declared references without executing controls, resolving semantic authority conflicts or establishing conformance. Declaration validity grants no runtime permission.",
  }),
  policy({
    concept: "runtime_defaults",
    label: "Runtime defaults",
    files: ".aidn/config.json",
    dual: ".aidn/config.json",
    dbOnly: ".aidn/config.json",
    projection: "runtime status outputs",
    notes: "Host-local defaults are not the shared runtime contract. Root config version is schema 1. Optional install.aidnVersion is derived from complete successful installation evidence under install_assets; absent legacy markers mean unknown, not an inferred installed product version.",
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
    notes: "Local SQLite remains target-root anchored unless an explicit shared locator is configured. Native write scope is canonical plan artifact content; DB-backed admission must not authorize from a stale visible plan projection.",
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
    ...(item.coverage_kind ? { coverage_kind: item.coverage_kind } : {}),
    ...(item.authority_backend ? { authority_backend: item.authority_backend } : {}),
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
