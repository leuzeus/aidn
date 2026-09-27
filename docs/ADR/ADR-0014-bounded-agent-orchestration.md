# ADR-0014 - Bounded agent orchestration

## Status

Accepted. Lot 2 provided internal contracts and pure validation (`model_only`).
Lot 3 adds PostgreSQL persistence (`persistence_only`). Supervised execution is
still unavailable. Lot 4 introduces the candidate Codex executor, delegated
admission and native process controller; availability remains gated on separate
native qualification. No scheduler or `agent-run*` command is implemented yet.

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
| `execution_run` | Run ID, frozen plan fingerprint and coordinator context | PostgreSQL supervision store |
| `delegated_task` | Task ID local to the run, exact scope, dependencies and acceptance contract | Parent run's frozen plan |
| `execution_attempt` | Attempt ID and ordinal for one run/task; delegation, ownership and result bind to this attempt | PostgreSQL supervision store |

The canonical task reference contains project, workspace, runtime scope,
session, cycle, logical plan reference, exact task selector, canonical plan
SHA-256, shared planning revision and activation authority/revision. The
canonical task has no invented UUID; delegated IDs do not replace its identity.

PostgreSQL remains optional for existing workflows. The future supervised path
requires PostgreSQL exclusively and fails closed if it is unavailable. It has
no file, SQLite or in-memory authority fallback. Lot 2 modeled this requirement;
lot 3 implements the separate `AgentExecutionStore` port and shared schema 3.
The historical `SharedCoordinationStore` remains a separate coordination port.
`authority_backend: postgres` and the shared table mappings declare the
supervision authority without claiming that workers are available.

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
`codex-cli-task` identifies the candidate Codex executor and is distinct from
the historical `codex` workflow adapter. No executor is implicitly registered.
Availability describes checked prerequisites, never admission or
native trust. Execution requires explicit absolute cwd and resolved configuration,
without parent-cwd or model fallback.

Events bind to the request's run/task/attempt and ordered sequence. Callbacks are
serialized and awaited; no event follows settlement of `runTask`. A callback
failure stops further emissions and requires an executor stop request. Terminal
outcomes are `completed`, `failed`, `cancelled`, `timed_out` or `indeterminate`.
The request and result carry the attempt's ownership snapshot. The request binds
the complete delegation SHA-256, including its branch, worktree and scope; the
result binds the delegation ID and the exact request SHA-256. Changing a
generation, delegation, instruction or execution configuration cannot reuse an
earlier result.
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

### Explicit preexisting native profile (lot 4 amendment)

The optional additive `execution.native_profile` contract selects
`{ mode: "preexisting", policy_sha256: "<64 lowercase hex characters>" }`.
Its presence binds the plan and request to one explicitly selected, verified and
frozen local policy. It carries no profile path, authentication material or trust
configuration. Changing its policy digest changes the plan and request hashes;
adding, removing or replacing it in a request conflicts with the frozen plan.
Historical contracts without this field remain valid and imply no selection or
fallback to a preexisting profile.

The explicit preexisting mode uses the ordinary native configuration loader in
both its metadata observer and executor. It tolerates inert historical fields
while freezing complete source bytes and verifying every required effective
control. Isolated homes retain strict parsing. This is a fixed mode invariant,
not an automatic retry after configuration failure; no user configuration is
deleted and no sandbox, hook, provider or integration requirement is relaxed.

The local policy freezes inherited shell-environment override names, not their
values. Process arguments empty each declared override and enforce an exact
final include filter for the required runtime variables. Empty values alone do
not prove removal. Reserved-name collisions, Windows case aliases, additional
names, nonempty values and wider filters fail validation. Native observations
must establish these effective controls without changing the user's profile.

A correction limited to package bytes may retain reviewed disposable roots and
their selected native home before any delegated attempt. Refresh preserves the
home's mode and physical identity, exact hook assets, activation, Git and runtime
preimages; only root-specific receipts and completed installation transactions
may change. A preexisting
home stays outside the owned outputs and is never inventoried or copied. Native
hook trust must be observed again and the profile policy frozen for the new
candidate. Earlier native execution results do not qualify the refreshed package.

AIDN does not provision this profile, copy authentication, grant native trust,
run native setup or silently substitute another profile. Config, trust,
authorization, AIDN runtime state and Git metadata remain protected. The local
policy must explicitly bound any ordinary native cache, session or authentication
effects and record consent for those effects; this permission does not authorize
changes to the protected authorities. Preparation, fixtures, independent review
and explicit native approval precede any worker execution against the selected
profile. This mode remains unavailable until its full native qualification proves
the frozen policy, hooks, confinement and preservation boundaries. Contract or
fixture success does not establish native PASS.

Native initialization can backfill historical titles, first messages and
previews into the exact attempt's local SQLite directory. This effect requires
explicit consent under the current policy digest; the copied metadata remains
outside Git and PR evidence. The qualification driver allocates a distinct
60-second preparation budget, including fresh canonical preflight, while
renewing ownership. A preparation result binds request, policy, attempt and
confirmed process termination, but grants no admission or native qualification.
The run budget includes this preparation and the unchanged worker duration;
worker timing begins only after preparation succeeds. Independent ten-second
checks still precede creation and resume. A failed preparation prevents launch,
preserves its state and cannot trigger a retry, SQLite disabling or backfill
metadata changes. No native setup or trust operation is added.
This native SQLite index never carries AIDN claims or replaces PostgreSQL
authority. Unconfirmed metadata-process termination prevents further native
observation and is reported independently of a worker that never started.

### Durable ownership (lot 3)

Shared schema 3 adds execution_runs, execution_tasks, execution_attempts and
execution_events through an explicit locked additive migration from schema 2.
An aligned migration does not replay DDL. Readiness and ordinary coordination
reads do not bootstrap, register a workspace or renew a worktree heartbeat.
Intact schema 2 remains readable for backup before migration; writes require
schema 3. Backup refuses failed reads instead of emitting an empty success.
The historical shared-coordination backup/restore covers planning, handoff and
coordination records only. It is not a backup of execution runs or attempts;
those rows remain in PostgreSQL and are never removed by migration or rollback.

AgentExecutionStore reserves one canonical runtime scope and planning identity.
Claims, renewals and results fence owner, attempt, generation, lease ID and
planning revision in one transaction. PostgreSQL supplies lease time: 60 seconds,
with a 10-second renewal cadence. Expiration retains the reservation and requires
recovery; it never authorizes another process. Launch intent precedes runner
observation. Event ID plus identical content is idempotent; divergence is refused.
Mutable historical coordination upserts are not this evidence log.

Canonical runtime and supervision must share a PostgreSQL transaction. Reservation
checks the existing runtime scope, expected canonical artifact digest, exact
planning reference, matching artifact SHA and a positive planning revision.
Publishing a new planning hash before its canonical artifact is persisted
cannot reserve a run against the old content. Legacy planning creation still uses revision
zero; supervision refuses it without a hidden synchronization. Separate databases
and file-authoritative canonical state cannot claim this guarantee.

Targeted and bulk canonical writers lock artifacts before taking the same scope
advisory lock as reservation. Planning writers use the matching planning lock
and optional expected-revision comparison. A reservation refuses ordinary writes
even after lease expiry. Session planning and reanchoring defer local projections
until canonical writes succeed. This avoids local effects on an existing
reservation refusal; it does not make historical multi-step workflows atomic.

Activation and process-termination verifiers are required injected dependencies.
Their absence refuses operations. Lot 3's doubles do not qualify native revocation,
process death or OS confinement; a live authority fence and native admission must
be connected and qualified in lot 4 before any public supervisor. Reconciliation
records confirmed termination but never spawns a replacement. Dependent claims
await integration proof, and a run cannot complete from exit status alone.

### Authority and retention

Transactional claims bind owner, attempt, revision and generation;
launch intent precedes process creation. Lease expiry or ownership loss invalidates
late results and requires reconciliation, never blind reassignment. Task leases
are distinct from worktree heartbeats and global engine-generation leases.
Readiness is read-only; migration is explicit and cannot run on claim or heartbeat.

Delegated native admission must later verify run, task, attempt, physical root,
branch, input SHA, activation, frozen plan and live lease. It must refuse session,
cycle, planning, installation and authorization mutations. Each worktree needs
its own verified preparation and exact candidate engine. Copying a receipt or
holding a delegation cannot undo revocation. An authenticated local admission
transport exposes only bounded admission requests; workers receive no writer
credentials or generic database/command access. The lot 4 transport authenticates
both directions with attempt-scoped HMACs and nonces on a loopback listener. The
PostgreSQL store rechecks ownership, canonical state and lease after evaluation.
The worktree inspector verifies its own receipt, verify-only preparation, exact
candidate archive and inventory, physical root, branch, input SHA and activation.
The marker under `.codex` makes missing delegated environment fail closed.
Delegated hooks reject every unsupported tool; historical hooks retain their
existing patch-only semantics. Native hook coverage and OS confinement still
require the human-reviewed qualification in CODEX_NATIVE_QUALIFICATION.md.

The candidate process controller uses a Windows Job Object assigned atomically
at process creation, with a suspended child and kill-on-close. The supervisor
records the observed runner and rechecks canonical admission while it remains
suspended before resuming it. Admission is a separate bounded dependency from
intent publication, runner observation and event callbacks; a late decision
cannot authorize a cancelled launch. Confirmation requires an observed
zero active-process count; loss of observation produces `indeterminate`. Linux
does not silently substitute PID or process-group termination for this proof.
The Codex executor uses resolved executable bytes, structured arguments, explicit
sandbox/configuration and stdin prompt. It stores bounded transcripts locally,
awaits serialized callbacks, and never forwards raw Codex JSONL to AIDN stdout.

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
`coverage_kind: persistence_only`; this does not report runtime availability, native
qualification or observed run instances.

Lot 2 is verified through positive and adversarial contracts, pure validation,
in-memory executor doubles, governance closure and the required
`runtime-agent-execution-contracts` gate. Lot 3 adds the required
`runtime-agent-execution-postgres` gate with a disposable PostgreSQL cluster,
separate Node processes and a launch barrier. Historical simulated concurrency
checks have their own required gate. Native process trees, hooks, OS confinement
and real Codex workers require separate evidence. Lot 4 adds the required
`runtime-agent-worker-fixtures` gate; executor doubles and authenticated transport
fixtures do not establish that native hooks ran or that the sandbox confined a
worker. Native qualification is separate from these CI checks.
An unqualified OS cannot advertise the future capability.

## Consequences

- Persistence and runner implementations can evolve against explicit contracts.
- Three information concepts add governance without fabricating runtime state.
- Pure checks cannot prove physical path safety, live ownership or process death;
  later adapters must enforce and qualify those boundaries.
- Scheduler, durable consolidation, cleanup and public command delivery remain
  separately implemented increments. No swarm, mailbox, quorum, automatic
  reassignment, unbounded repair or general worktree administration is introduced.
