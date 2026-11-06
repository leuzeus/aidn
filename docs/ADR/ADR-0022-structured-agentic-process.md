# ADR-0022 — Structured agentic process and constrained resource assignment

## Replay-local canonical suffix buffers, 2026-11-06

The historical prefix hasher encodes the fixed canonical fields before/after
`revision` once within a synchronous replay. Each digest still hashes every
canonical suffix byte, the exact revision and ordered event prefix. Fingerprint
format, historical validation, event bounds and all authority/CAS observations
remain unchanged; no buffer or result crosses replay calls or awaits.

A complete-step instrumented fixture diagnostic located this path, followed by
a separate pure comparison against independent canonical hashes for 442
prefixes and additional hashing shapes. The buffer candidate met the frozen
eight alternating batch criteria. These observations support this local change,
not a complete-workflow speedup. Current-source qualification remains required
under the original bounds, with productive STANDARD and L1–L8/A1–A10 incomplete.

## Embedded reusable call candidate, 2026-11-06

V2 may explicitly retain a root `call_targets` library of complete immutable v2
models, identified by `model_id`, `revision` and `model_sha256`. A new call uses
`target`; historical `child` calls keep their existing tree semantics, bytes and
events. Each local target keeps the 256-node bound. The common reducer validates
expanded ancestry, rejects recursion and resolves local nodes by pinned model
and occurrence, with the existing depth, JSON, ID, 1024-occurrence and 512-event
limits. It performs no ambient package/path/network resolution.

Private `process-data-bindings.v4`, `process-resolved-input.v3` and
`process-call-transition.v1` describe this opt-in. `call_enter` durably records
once-resolved typed parameters, sources and accepted source witnesses at the
exact prefix. `call_return` records declared typed outputs only after all call
children complete, verified against that call's accepted receipts. The service
observes authenticated journals through its fixed host port and commits through
the existing canonical artifact CAS. Facts and data are call-local; operation
identities, authority, grants and cumulative accounting stay instance-bound.
The same reducer validates execution, cold reconstruction, replay and SIM.
These records are part of `agentic_process_instance`, with no new store or table.

Only explicit `call_output` from a pinned `target` exports that call's declared
return into its containing sequence scope. Enclosing loop, collection and call
scopes remain mandatory, as do ordering and optional-branch restrictions.
Internal operation values and historical `child` calls retain their previous
scope checks; this does not introduce implicit exports.

Input selection builds a model-identity table within that synchronous invocation
and rechecks the complete root model hash after trusted journal callbacks. Each
scope lookup uses those same pinned bytes; no table, cursor, journal output or
authority survives the invocation. This avoids rehashing every model at every
ancestor lookup and refuses model mutation during a reader callback. All source
receipt/input/output checks and subsequent service authority/CAS fences remain.

This is an executable source candidate pending exact-source qualification.
Published STANDARD extraction, complete lifecycle coverage, ordinary-entry
qualification and Native/Human/Provider/installed acceptance remain incomplete.
The current Native configuration does not model-qualify activity instructions
or output contracts; it explicitly refuses activities in embedded targets before
allocation. The generic service's activity protocol remains distinct from that
unqualified Native profile.

## Status

Initially implemented as an opt-in internal source API and explicit owned native
composition, verified offline. One bounded pre-release Windows native case
completed; the exact published archive and general native profile remain
unqualified. See [the qualification record](../qualification/agentic-process/v0.19.0.md).
No default client activation or general BPMN interpreter.

[ADR-0024](ADR-0024-default-agentic-workflow-engine.md) supersedes the opt-in
selection decision: this same engine is now the default for all new workflows,
including direct JSON models. Historical readers and native admission remain.

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

ADR-0023 subsequently adds explicit bounded XML compilation into this unchanged
IR, plus synthetic simulation with the same reducer. Direct XML interpretation
and generic BPMN import remain outside this engine. See
[the profile decision](ADR-0023-bpmn-execution-profile-and-simulation.md).

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
suites remain separate regression checks. G03, general BPMN XML, message review and unsupported
gateway semantics are not claimed as implemented; their boundaries are published
in `docs/AGENTIC_PROCESS.md`. No native qualification or cost claim is made.

Original adoption used explicit composition. ADR-0024 makes selection the default
for new workflows, without automatic instance conversion. Select compatibility
for new sequential work and retain versioned readers for historical state.
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
