# ADR-0014 - Bounded agent orchestration

## Status

Accepted. Lot 2 provides internal contracts and pure validation only
(`model_only`). Supervised execution is unavailable: no executor process,
admission delegation, store, migration, scheduler or `agent-run*` command is
implemented by this decision's first increment.

## Date

2026-09-26

## Context

The synchronous `AgentAdapter` port executes existing workflow commands. Its
successful return does not establish that an LLM performed, validated or
integrated a coding task. Workspace heartbeats and planning revisions likewise
do not grant exclusive task ownership. Existing coordination records can be
upserted and are not immutable attempt evidence.

Bounded parallel work therefore needs distinct task execution, authority and
acceptance contracts before process or persistence implementations are added.

## Decision

### Boundaries and identities

V1 has one supervisor host, at most one mutating run for a canonical scope, and
local worktrees. A frozen plan decomposes one admissible canonical task; it does
not traverse the backlog. The coordinator retains the real session, cycle,
planning and transition authority. Workers produce edits; the supervisor checks
them, creates commits and integrates. Publishing and moving Git references are
not worker capabilities.

Three concepts are governed separately:

| Concept | Identity and ownership | Authority |
| --- | --- | --- |
| `execution_run` | Run ID, frozen plan fingerprint and coordinator context | Future PostgreSQL supervision store |
| `delegated_task` | Task ID local to the run, exact scope, dependencies and acceptance contract | Parent run's frozen plan |
| `execution_attempt` | Attempt ID and ordinal for one run/task; delegation, ownership and result bind to this attempt | Future PostgreSQL supervision store |

The canonical task reference contains project, workspace, runtime scope,
session, cycle, logical plan reference, exact task selector, canonical plan
SHA-256, shared planning revision and activation authority/revision. The
canonical task has no invented UUID; delegated IDs do not replace its identity.

PostgreSQL remains optional for existing workflows. The future supervised path
requires PostgreSQL exclusively and fails closed if it is unavailable. It has
no file, SQLite or in-memory authority fallback. Lot 2 only models this
requirement; it changes neither shared schema version 2 nor the existing
`SharedCoordinationStore` port.

### Frozen execution contract

Internal versioned schemas live under `src/core/contracts/agent-execution/`.
The eleven kinds are descriptor, availability, plan, run, task, attempt,
delegation, request, event, result and supervisor acceptance.
`src/core/agents/agent-execution-contracts.mjs` owns pure semantic checks and
canonical fingerprints. Keys are sorted recursively, arrays retain their order,
and the plan fingerprint itself is excluded from its hash input. Omitted
concurrency is normalized to one before hashing. Other object fingerprints cover
every declared field, including ownership and evidence references. Validation does not
mutate inputs or read the filesystem, Git, processes or PostgreSQL.

The plan freezes an exact Git base, task objectives, dependencies, acceptance
criteria, validations, final audit, executor, candidate engine fingerprint,
model, effort, sandbox and durations. Concurrency defaults to one and is bounded
by four. Each task duration is positive and cannot exceed the run duration.

Scopes name exact normalized relative files and explicit operations; directories,
globs, traversal, Windows aliases and protected control authorities are refused.
A delegated scope must be a subset of the canonical scope. A move needs rights
for its source and destination. Concurrent tasks may not overlap writable files
unless dependencies order those tasks. Notes and parking-lot entries receive no
general exemption.

The separate `AgentTaskExecutor` port exposes synchronous, probe-free
`getDescriptor()`, asynchronous `checkAvailability({ cwd, signal })`, and
`runTask(request, { signal, onEvent })`. An injected registry declares candidates;
discovery and port assertions do not probe availability or launch processes.
`codex-cli-task` is reserved for the future Codex executor and is distinct from
the historical `codex` workflow adapter. No real executor is registered in this
increment. Availability describes checked prerequisites, never admission or
native trust. Execution requires explicit absolute cwd and resolved configuration,
without parent-cwd or model fallback.

Events bind to the request's run/task/attempt and ordered sequence. Callbacks are
serialized and awaited; no event follows settlement of `runTask`. A callback
failure stops further emissions and requires an executor stop request. Terminal
outcomes are `completed`, `failed`, `cancelled`, `timed_out` or `indeterminate`.
The request and result carry the attempt's ownership snapshot; the result also
binds the delegation ID and the exact request SHA-256. Changing a generation,
instruction or execution configuration cannot reuse an earlier result.
Process termination is a separate observation; unconfirmed descendant termination
requires an indeterminate outcome and reconciliation before a new attempt.

Execution outcome, supervisor validation, integration and cleanup are distinct.
Exit zero is not acceptance. The worker result contains process observations
and evidence references only. The supervisor acceptance separately binds the
attempt, frozen task contract, `result_sha256` and `candidate_sha`; its validation
records must name that exact SHA. Integration and cleanup have separate fields.
An executor cannot grant itself acceptance. Model binding requires the plan,
run, task, attempt, delegation and request together; shape validation alone is
not a binding check. Root tasks use the plan's base SHA. The scheduler must later
prove that a dependent task's recorded input SHA contains its integrated
predecessors. A final run audit is frozen in the plan but is not represented as
successful merely because an individual task acceptance passes.

### Future authority and retention

Future transactional claims will bind owner, attempt, revision and generation;
launch intent precedes process creation. Lease expiry or ownership loss invalidates
late results and requires reconciliation, never blind reassignment. Task leases
are distinct from worktree heartbeats and global engine-generation leases.
Readiness is read-only; migration is explicit and cannot run on claim or heartbeat.

Delegated native admission must later verify run, task, attempt, physical root,
branch, input SHA, activation, frozen plan and live lease. It must refuse session,
cycle, planning, installation and authorization mutations. Each worktree needs
its own verified preparation and exact candidate engine. Copying a receipt or
holding a delegation cannot undo revocation. An authenticated local admission
transport will expose only bounded admission requests; workers receive no writer
credentials or generic database/command access. This is a required future
capability, not an implemented bypass of ADR-0012.

The supervisor owns retention for runs, tasks, attempts and acceptance evidence.
Transcripts and bulky outputs remain local. Shared results carry only bounded
references, byte counts and content hashes; credentials are never contract data.
There is no automatic purge in V1. A successor run or attempt preserves the
earlier evidence; mutable coordination upserts cannot establish immutability.

## Compatibility and qualification

The synchronous adapter and all historical commands retain their behavior.
The JSON validator's CLI profile remains the default; internal schemas require
the explicit `agent-execution` profile and are not advertised as CLI outputs.
Governance diagnostics may report complete policy coverage with
`coverage_kind: model_only`; this does not report runtime availability, native
qualification or observed run instances.

Lot 2 is verified through positive and adversarial contracts, pure validation,
in-memory executor doubles, governance closure and the required
`runtime-agent-execution-contracts` gate. PostgreSQL concurrency, process trees,
native hooks, OS confinement and real Codex workers require separate evidence in
later increments. An unqualified OS cannot advertise the future capability.

## Consequences

- Persistence and runner implementations can evolve against explicit contracts.
- Three information concepts add governance without fabricating runtime state.
- Pure checks cannot prove physical path safety, live ownership or process death;
  later adapters must enforce and qualify those boundaries.
- Scheduler, durable consolidation, cleanup and public command delivery remain
  separately implemented increments. No swarm, mailbox, quorum, automatic
  reassignment, unbounded repair or general worktree administration is introduced.
