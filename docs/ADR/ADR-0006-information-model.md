# ADR-0006 - Information Model

## Status

Accepted

## Date

2026-05-18

## Context

AIDN manipulates sessions, cycles, runtime digests, handoff packets, artifacts, repair findings, decisions, incidents, coordination records, baselines, snapshots and CLI contracts. Historically, the effective model was inferred from Markdown templates, parsers, SQL schemas, runtime payloads and CLI output.

This makes governance expensive: a field can exist in a projection without a clear owner, lifecycle, metadata policy or source of truth.

## Decision

AIDN will treat the information model as a governed product asset.

Rules:

- the conceptual model lives in `docs/PLAN_AIDN_ENTERPRISE_INFORMATION_ARCHITECTURE_2026-05-18.md`
- source-of-truth rules live in `src/core/source-of-truth/source-of-truth-policy.mjs`
- governed metadata rules live in `src/core/metadata/metadata-policy.mjs`
- critical Markdown contracts live in `src/lib/workflow/markdown-contract-registry-lib.mjs`
- public CLI JSON contracts live under `src/core/contracts/cli-output/`
- runtime projections may expose derived views, but must not become undocumented canonical sources
- baseline and snapshot are governed as local-first artifact families, not as implicit shared runtime primitives
- decision, incident and coordination records are governed through explicit source-of-truth policies and metadata rules, even when the runtime stores are shared-opt-in only
- `runtime_project_context` is governed explicitly so durable
  `runtime_scope_id` partitioning cannot be confused with legacy absolute-path evidence
- each policy carries concept-specific owner, retention, migration, replacement
  and evidence targets
- the governance gate closes the registries bidirectionally across
  source-of-truth policy, metadata policy, governed diagnostics and public
  JSON/effect surfaces

The current core governance model deliberately stops short of promoting every operational object to a first-class concept.
Some items are surfaced as residual coverage because they are represented by a parent surface or belong to an orthogonal telemetry layer.

Residual coverage classification:

| Concept | Classification | Rationale |
|---|---|---|
| `worktree` | subsumed | Covered through workspace identity and shared-boundary locator rules. |
| `handoff_relay` | subsumed | Covered through handoff packet and coordination-record projections. |
| `repair_decision` | subsumed | Covered through repair findings and coordination history, not a separate product concept. |
| `migration_run` | excluded | Operational telemetry for migrations, not governed product state. |
| `gate_result` | excluded | CI workflow telemetry, not part of the runtime information model. |
| `reference_data` | excluded | Fixture and test-corpus material, not live workflow state. |

## Installation ownership extension (2026-09-23)

Codex installation ownership is governed as `install_assets`. Its local receipt
and transaction pre-images authorize recovery of owned files, AGENTS blocks and
hook entries in one physical worktree. The same local authority applies in
files, dual and db-only modes. It never authorizes workflow admission or replaces
runtime state. Public diagnostics expose hashes and conflicts, not pre-image
contents. Recovery compares current content before writing and preserves
transaction history after uninstall. See ADR-0011 for the integration boundary.

## Bounded supervision extension (2026-09-26)

ADR-0014 adds `execution_run`, `delegated_task` and `execution_attempt` with
`model_only` coverage in Lot 2 and `persistence_only` coverage in Lot 3.
`AgentExecutionStore` and its PostgreSQL adapter persist the frozen run/task
descriptors, attempt ownership, delegation, results and immutable events in
shared schema 3. Lot 5 extends their coverage to `supervision_candidate` and
shared schema 4: supervisor generations and final validation belong to the run,
integration belongs to the delegated task, and preparation and acceptance belong
to the attempt. Lot 6 adds schema 5 integration intentions to the delegated task
and authenticated verification observations to acceptance and final validation.
The plan pins verification controls and its proof authority; bulky signed proofs
remain local with immutable references. The internal scheduler requires explicitly injected dependencies;
public supervised commands remain unavailable. The run preserves
canonical session/cycle/task context without creating synthetic sessions;
reservation requires canonical runtime and shared planning in the same database
transaction. There is no SQLite, file or in-memory authority fallback.
Local bulky evidence is retained by reference, size and hash; no V1 automatic
purge is permitted. Diagnostics do not infer observed instances from policy
completeness. The schemas remain in the internal `agent-execution` namespace,
outside the public CLI output registry. Native activation and termination
qualification remain separate from persistence fixture evidence.

## Scoped method adoption extension (2026-10-02)

GFD references are governed within `project_policy`, not a separate concept or
runtime store. Package-source adoption lives in the explicitly scoped
`package/governance/gfd-adoption.v1.json`; a client's optional
`governanceAdoption` remains in its existing durable workflow adapter. Owner,
scope, pinned method, explicit acceptance, lifecycle, section bindings, omissions,
review triggers and immutable prior-record references have a versioned validator.
Proposed detection is never promoted to an effective rule. Source acceptance is
not inherited by clients, and metadata validity cannot grant runtime authority.
The complete GFD attempt/outcome schemas and retrospective migration are not
adopted. `gate_result` remains excluded telemetry and supervised
`execution_attempt` retains its existing contracts. See ADR-0010 and
[the adoption guide](../GFD_ADOPTION.md) for the accepted scope and limits.

## Options Compared

| Option | Result |
|---|---|
| Documentation-only model | Easy to read, but quickly diverges from code. |
| SQL-only model | Precise for runtime persistence, but misses Markdown and CLI contracts. |
| Parser-derived model | Backward compatible, but keeps concepts implicit. |
| Governed model plus code policies | More maintenance, but gives agents and maintainers stable ownership boundaries. |

## Criteria

- local-first behavior stays understandable
- fields have explicit ownership, source and lifecycle semantics
- legacy artifacts remain tolerated when declared
- contracts are testable without requiring a cloud service

## Consequences

Positive:

- clearer source-of-truth decisions
- less cognitive debt around artifact metadata
- safer refactoring of runtime and CLI layers

Negative:

- policy modules and docs must be kept synchronized
- legacy tolerance must not become permanent ambiguity

## Risks

- overfitting the model to current fixtures
- treating projections as canonical because they are easier for agents to read
- adding metadata fields without corresponding quality gates

## Follow-Up

- continue extracting runtime use cases from CLI wrappers
- expand metadata completeness gates from critical Markdown artifacts to decisions/incidents
- keep ADR-0006 aligned with source-of-truth and metadata policy tests
