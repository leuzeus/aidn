# ADR-0018 - Durable workflow instances

## Status

Proposed; internal opt-in composition. SPEC remains the rule authority. This
extends ADR-0017 without changing default execution, public CLI selection or
native qualification requirements. Source and disposable fixtures are distinct
from an installed pilot or a qualified native Codex run.

ADR-0020 adds the experimental CLI/dashboard consumer and an optional expected
result hash for exact-preview checkpoint application. Default execution remains
unchanged; the internal services retain admission and CAS authority.

## Decision

`workflow_instance` is a governed canonical artifact with the closed internal
`workflow-instance.v1` contract. It retains one definition, compiled graph,
context, physical target fingerprint, runtime scope, persistence configuration
fingerprint and activation revision. The ordered typed event history determines
the cursor and bounded-return counters. Revision equals event count plus one;
the instance hash covers the whole record. There is no silent migration or
definition rebinding, and the instance grants no execution permission.

The initial supported handlers are explicit human `approval` and `review`,
`agent_segment`, and `terminal`. Other registered primitives are retained but
report `handler_unavailable`; their outcomes cannot be supplied as a substitute
for executing a missing handler. Human decisions require retained evidence
references and hashes. They do not replace the supervisor's action approval.
The first contract bounds history to 256 events and fails before overflow.

The internal project composition reads current activation and context before
each productive checkpoint. Writes require `write: true`, an expected instance
hash for existing records, and canonical content compare-and-swap. PostgreSQL
uses the existing artifact transaction, table/scope lock order and execution
reservation fence. SQLite uses an immediate transaction on the existing schema;
this composition performs no implicit initialization or migration. Existing
artifact upsert callers retain their behavior.

In `files`, the visible JSON artifact is canonical unless PostgreSQL is
explicitly configured. File writers use an exclusive adjacent lock and atomic
replacement. A process-abandoned lock is retained and reported as
`WORKFLOW_INSTANCE_LOCK_RECONCILIATION_REQUIRED`; PID existence never authorizes
automatic deletion. This is process-interruption evidence, not a power-loss
durability guarantee. `dual` reads its configured canonical artifact store and
materializes JSON after commit. A projection failure reports a committed
checkpoint with `projection: reconciliation_required`; it cannot replay the
decision. `db-only` produces no automatic detailed visible projection. Configured
PostgreSQL never falls back to files or SQLite. No table, database, shared
coordination entity, event bus or background worker is introduced.

Before execution, the instance records a segment intent with immutable run,
plan, configuration and binding hashes and retained configuration/plan paths.
The existing action preview must be produced **after** this checkpoint because
the checkpoint changes the canonical digest. Productive dispatch reuses the
existing public lifecycle with the retained hashes checked on both of its
context reads. The immutable run reservation prevents duplicate launch. The
same run identity cannot be used for a subsequent visit to a macro step.

Interruption before or after dispatch leaves the same pending intent. Inspection
never dispatches. Reconciliation reads `agent-run-status`, and advances only
from a terminal supervisor result with matching identities. A completed edge
requires accepted tasks, no pending integration, and passed final validation on
the exact integrated SHA. Failed or cancelled runs take the failed edge only
after the canonical reservation permits a checkpoint. Execution, acceptance,
integration, final validation and cleanup remain separate retained evidence.
An uncertain or missing run stays `reconciliation_required`; the operator uses
explicit preview and approved start/resume/cancel for that same run. No new run
or synthetic successful result is created during recovery.

Historical status and cancellation remain available after compiler drift or
revocation. Cancellation recovery can use existing resume semantics. Recording
a new macro checkpoint still requires current matching instance authorization;
revocation cannot be bypassed by classifying a write as reconciliation. There
is no distributed atomic transaction between canonical artifacts, PostgreSQL,
Git and native processes. Supervisor journals remain the effect authority.

## Validation and limits

`perf:verify-workflow-instance` covers contracts, typed decisions, bounded
returns, immutable run IDs, stale writers, files/SQLite reconnection, retained
locks, before/after-effect process exits, status-only reconciliation, projection
authority, real project composition with a disposable activation fixture, and
revocation. The required PostgreSQL suite adds concurrent connections, actual
JSON persistence, rollback, no DDL and reservation fencing. Existing segment
and lifecycle suites retain their scheduler and public admission coverage.
Fixture activation and injected effect evidence do not qualify native Codex.
No installed client session or cycle is created in the package source repository.
