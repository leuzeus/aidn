# ADR-0017 - Explicit workflow segment selection

## Status

Proposed; opt-in segment integration. Portable and PostgreSQL fixtures do not
qualify native Codex execution. ADR-0014 retains its native qualification gate.
This decision does not promote the shadow definition over `docs/SPEC.md`.

## Context

ADR-0016 compiles descriptive macro graphs without executing them. A selected
agent segment now needs a concrete connection to the existing frozen execution
plan, exact action approval and run lifecycle. The package source repository is
not an installed client and needs no live session or cycle for its fixture tests.

## Decision

`agent-run-configuration.v2` adds one required `workflow` field containing a
closed `workflow-segment-binding.v1`. V1 remains closed and unchanged. Selection
is explicit for one run and one `agent_segment`; it does not traverse the graph,
assert predecessor completion or create a durable macro cursor.

The pure binding factory compiles the definition with the existing registry and
freezes its definition, context, revision, selected step, compiler/registry pins
and canonical task digest. `agent-execution-contracts` still validates the
unmodified plan schema, scopes, DAG, execution profile and canonical identities.
The configuration digest enters `plan.supervision.configuration_sha256`; the
plan digest is returned in the separate selection envelope. This order avoids
a circular hash and leaves historical plan schemas and fingerprints unchanged.

Public `agent-run*` previews project `workflow-segment-selection.v1` at
`action.preconditions.workflow`. The existing action digest covers this envelope
and the whole configuration digest. Launch and productive resume recompile with
the current registry and compare pins, executing product version and configured
state mode. Any difference requires explicit new preparation and a new run; an
active run never silently migrates. Status, cancellation, cleanup and resume
of an already cancelled run preserve structural, canonical and configuration
pins while marking the compilation `retained`, so compiler drift cannot prevent
historical inspection or stopping work.

The public composition and lifecycle retain canonical readiness, current
activation, exact scope, shared planning revision, native qualification and
double observation before application. Transactional reservation remains the
final admission before scheduling. Binding a definition grants no capability,
lease, approval, additional scope or native availability. PostgreSQL remains
optional for definition/compilation and existing sequential workflows; bounded
supervision still requires the existing PostgreSQL schema 6 authority.

Selection provenance belongs to `execution_run` through its frozen configuration
pin. The operator retains that exact configuration, including the definition,
alongside existing run evidence. No new project authority, state table,
migration, handler dispatcher or scheduler is introduced. Execution, acceptance,
integration, final validation and cleanup keep their distinct existing results.

## Verification and boundary

The required lifecycle gate includes closed contracts, compatibility, immutable
pins, stale approval, revocation, scope/DAG refusal, absent PostgreSQL and a full
selected segment through the existing scheduler with injected adapters. The
required PostgreSQL fixture checks JSONB retention, public preview/status/cancel,
context drift and explicit missing native prerequisites without native launch.
These are fixture proofs. Real native qualification remains unexecuted here.

Durable macro instances, transition admission, bounded macro returns, crash
recovery across segments and generated projections belong to subsequent lots.
The macro still compiles as `execution_available: false`; only the separately
admitted selected plan may execute through the existing lifecycle.
