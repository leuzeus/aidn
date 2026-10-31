# ADR-0022 — Structured agentic process and constrained resource assignment

## Status

Implemented as an opt-in internal source API and explicit owned native
composition, verified offline. Native execution remains NOT_RUN. No default
client activation or general BPMN interpreter.

## Context

ADR-0021 separates compatible sequential role reuse from physical identity and
independent review. Existing shadow definitions and sequential workflow instances
do not implement structured concurrent gateway occurrences. Roles, participants,
skills, sessions and technical executions must not be conflated to fill this gap.

## Decision

Add distinct `agentic-process-model.v1` and `agentic-process-instance.v1` formats
and profile `structured-agentic-process.v1`. The model is a bounded tree;
sequence, structured XOR/AND/OR, exclusive event race, bounded loop,
multi-instance and same-participant calls are executable control semantics.
Complex/mixed/instantiating gateways and autonomous participant review remain
descriptive and refuse execution. Arbitrary graphs, cross-pool sequence and XML
import are rejected, never translated silently.

The reducer uses stable scoped occurrences, distinct flow identities, recorded
conditions and replayed events. Concurrency is logical readiness, not an agent
count. A join never reconciles contents. Failure/cancellation never masquerades
as completion. Host-delivered events race through canonical CAS; no model polls
an event or performs deterministic gateway routing.

The application service consumes the existing authenticated assignment policy
and fixed host authority/binding/result ports. It persists an eligible resource
decision before work; it creates no executor. Result consumption authenticates
the original execution and reviewed work, refreshes binding/eligibility and
preserves rejections/refusals. Skills can be shared; context, rights and excluded
contributors remain binding. No profile is silently weakened and no new session
or participant is assumed independent.

The governed `agentic_process_instance` concept uses existing project artifact
storage, explicit writes, canonical compare-and-swap, locks, reservation fence
and projection rules in files/dual/db-only. There is no new shared coordination
surface/table, migration or remote service. Historical formats, public CLI
contracts and source-defined skill/write admission are unchanged. Host capability,
identity, access and cleanup remain the responsibility of the supplied ports;
authored JSON never provides those guarantees.

The production composition constructs those authorities around actual native
sessions and a protected result channel. Compatible activities retain one
thread; independent review receives a distinct resource and curated read-only
snapshot. The existing Windows tree controller owns the fixed worker and native
descendants. Permission/profile/configuration mismatches fail closed; readiness
does not provision or approve anything. Absolute global/workflow deadlines and
response/storage accounting remain explicit, with first failure preserved and
no automatic retry. This profile does not weaken ADR-0014's separate fresh
supervised-attempt rule, provide general OS confinement, replace human review,
or extend native qualification from fixtures. Its exact scope and remaining
native observations are documented in `docs/AGENTIC_PROCESS.md`.

## Validation and rollback

The required `runtime-agentic-process` gate executes portable contracts, reducer,
service, durable-store and production-composition/fake-wire fixtures. The existing agent-reuse and workflow-instance
suites remain separate regression checks. G03, XML, message review and unsupported
gateway semantics are not claimed as implemented; their boundaries are published
in `docs/AGENTIC_PROCESS.md`. No native qualification or cost claim is made.

Adoption is explicit composition, never automatic instance conversion. Stop new
writes to disable adoption and retain the versioned reader for historical state.
Neither rollback nor a new model hash weakens required policy pins or approves
old verdicts for new revisions.

## Canonical backend compatibility correction

The owned runner follows ADR-0007's existing SQLite/PostgreSQL resolver. The
temporary SQLite-only execution restriction was an implementation deviation,
not a change to governance, and is removed. Configured PostgreSQL remains
canonical even in files mode; it never falls back to a local database on outage.
Backend/reference changes stop an allocated execution. The shared record store
pins its selection before every read, CAS and materialization, retaining the
existing backend's own locking, reservation and transaction rules.

SQLite supports local files or local transactional persistence; it does not
inherit PostgreSQL's shared supervision or concurrency guarantees. No new table,
schema migration, adoption or provider-specific SQL writer is introduced.
Bulk projections protect process-instance checkpoints as well as historical
instances/definitions. Failed derived projection requires reconciliation after
the canonical commit, before any further model activity.

Connection material is confined to trusted runtime, PostgreSQL artifact workers
and the author's pinned admission-hook host. Model-shell environments, independent
review and retained metadata exclude it. A verified installation receipt supplies
the global hook runtime home, rather than an arbitrary inherited home.
Logical canonical-payload budget debits and physical server storage are distinct;
unobserved PostgreSQL pages/indexes/WAL remain NON_MESURE. Offline SQLite and SQL
transport fixtures establish compatibility contracts, not live PostgreSQL
concurrency or native-client qualification. The PostgreSQL benchmark lots already
closed remain unchanged and are not rerun by this correction.
