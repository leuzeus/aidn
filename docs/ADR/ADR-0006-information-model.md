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
