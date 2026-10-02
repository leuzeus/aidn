# ADR-0015 - Shadow workflow definition

## Status

Proposed for review. Lot 1 implements reference data and compatibility checks
only. It does not transfer production authority or introduce an execution path.

## Date

2026-10-01

## Context

The 0.11.0 runtime already owns session/cycle admission, canonical continuity,
explicit effects and bounded agent execution. A reusable workflow description
must first preserve those decisions and the obligations in SPEC-R01 through
SPEC-R11. A macro graph is distinct from an agent-execution plan's frozen DAG.

## Decision for this lot

Keep `docs/SPEC.md` canonical in package source and the installed SPEC canonical
under the existing workflow-rules policy. Introduce the internal
`workflow-definition.v1` schema in its own `workflow-definition` validation
profile. It is outside the public CLI-output and agent-execution registries.
The profile reuses the existing deterministic schema validator; no new schema
keywords or production consumers are added.

Store both descriptors and the rule/parity matrix under
`tests/fixtures/workflow-shadow/`. They are versioned, maintainer-owned
`reference_data`, excluded from live workflow governance under ADR-0006.
Their authority is explicitly `shadow`, lifecycle `reference_only`, execution
`unsupported`. They create no project configuration, binding, instance,
reservation, permission or persisted runtime object. The existing
source-of-truth, metadata, adapter and runtime policies retain their authority.

The matrix classifies the primary ownership of each SPEC rule as engine
invariant, audit-informed profile or project policy. Its boundary column keeps
cross-cutting obligations explicit: classification never moves or weakens a
rule. In particular, project-adaptive DoR cannot override mandatory core DoR,
and current session/cycle handlers retain their existing preconditions.

The descriptor names steps, symbolic outcomes, transitions, source references,
rule references, evidence requirements and terminal outcomes. These outcome
names describe macro decisions; they are not new CLI reason codes. Independent
helper fixtures pin actual actions, reason codes, choices, warnings and mapped
identities. The verification tool lints references and graphs but neither
evaluates workflow conditions nor dispatches handlers.

Sequence, incident, drift, convergence and human review obligations retain
procedural evidence requirements. A linked suite or source paragraph is not
reported as an executed assertion. Existing admission, lifecycle and state-mode
suites supply complementary behavior evidence when run.

## Second macro path

The second reference descriptor is diagnosis -> human approval -> correction
segment -> human review -> completion. Rejection returns to correction at most
twice; exhaustion stops. A failed segment or rejected initial approval stops.
This is a declaration of the candidate limit, not an implemented retry policy.
The same schema represents both graphs without a workflow-specific engine
branch. It proves expressibility only; compilation and actual bounded execution
remain subsequent lots. No fake session/cycle or agent-run is created.

## Future authority and activation boundary

Binding/storage paths, parameter resolution and compiler/handler versions are
deferred until the compilation lot; this lot intentionally has no parameters
or binding precedence to resolve. A project binding is not inferred from the
presence of a descriptor, and the existing adapter retains project policy.
No runtime consumer discovers these fixtures. Clients without a binding keep
the existing execution path. Explicit binding compatibility is unimplemented.

Before a definition can acquire production authority, require an accepted ADR,
rule-to-contract-to-test closure, semantic validation and demonstrated parity.
Any canonical switch must designate one authority and make the superseded
representation a projection. No simultaneous normative SPEC/definition pair.

Future activation must be explicit at a safe session/cycle/run boundary.
Instances must pin definition revision and hash; changes cannot silently
migrate active work. Resume rechecks current authority and revocation. Migration
and rollback require separately reviewed operations, preserving custom history;
deleting a binding must never remap an active custom run to the default.
Existing identities, planning revisions, scope admission and agent contracts
remain authoritative. PostgreSQL stays optional for existing sequential paths;
supervised execution keeps its current exclusive PostgreSQL authority.

## Validation and rollback

The cataloged `contracts-workflow-shadow` gate checks the closed schema, both
descriptors, all eleven rule links, representative helper parity and rejecting
fixtures. It performs no dispatch or checkout writes. Existing workflow,
canonical-admission, state-mode, schema and governance checks bound compatibility.
Fixture results do not qualify a native executor or a live PostgreSQL server.

Removing the reference corpus, its schema/profile and gate rolls back this lot.
No data migration, installed-client modification or active-run conversion is
needed. The authority-transfer and execution decisions remain unaccepted.
