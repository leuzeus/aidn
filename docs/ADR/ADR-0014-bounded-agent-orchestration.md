# ADR-0014 - Bounded agent orchestration

## Status

Accepted. Lot 2 provided internal contracts and pure validation (`model_only`).
Lot 3 added PostgreSQL persistence (`persistence_only`). Lot 4 introduced the
candidate Codex executor, delegated admission and native process controller.
Lot 5 adds an internal bounded scheduler and the durable consolidation needed
by dependent tasks (`supervision_candidate`). Lot 6 adds durable preparation
intent and verification on an isolated exact-commit snapshot. Native availability still requires
separate qualification of the exact composition. Lot 7 exposes explicit public
`agent-run*` previews and lifecycle operations, with a pinned native composition
that refuses application without the required exact evidence. Coverage remains
`supervision_candidate`; the final parallel Codex campaign is a separate proof.

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

PostgreSQL remains optional for existing workflows. The supervised path
requires PostgreSQL exclusively and fails closed if it is unavailable. It has
no file, SQLite or in-memory authority fallback. Lot 2 modeled this requirement;
lot 3 implements the separate `AgentExecutionStore` port and shared schema 3.
The historical `SharedCoordinationStore` remains a separate coordination port.
`authority_backend: postgres` and the shared table mappings declare the
supervision authority without claiming that workers are available.

### Frozen execution contract

Internal versioned schemas live under `src/core/contracts/agent-execution/`.
The sixteen kinds are descriptor, availability, plan, run, task, attempt,
delegation, request, event, result, acceptance, supervisor, integration-prepared,
integration-applied, integration-intent and run-validation.
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
Intact schema 2 remains readable for backup before migration. Lot 3 required
schema 3 for writes; lot 5 raised that prerequisite to schema 4, and lot 6
requires explicit migration to schema 5 for integration intentions and verified
acceptance observations. Lot 7 requires schema 6 for durable cancellation and
cleanup ownership. Intact historical schemas remain readable for backup.
Backup refuses failed reads instead of emitting an empty success.
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

Bounded nonterminal startup diagnostics do not count as a started turn, task
completion or acceptance. Malformed sequencing still stops execution, retaining
the first protocol failure for diagnosis.

The supervisor owns retention for runs, tasks, attempts and acceptance evidence.
Transcripts and bulky outputs remain local. Shared results carry only bounded
references, byte counts and content hashes; credentials are never contract data.
There is no automatic purge in V1. A successor run or attempt preserves the
earlier evidence; mutable coordination upserts cannot establish immutability.

### Durable supervisor and dependent execution (lot 5)

Shared schema 4 adds `execution_supervisors`, `execution_acceptances`,
`execution_integrations` and `execution_run_validations`. These records belong to
the existing run, task and attempt concepts; no independent information concept
or local ownership authority is introduced. The migration is explicit, additive
and locked. Runtime artifact schema 3 remains separate.

Historical independent execution stays in legacy mode. The first supervisor
claim can convert only a reserved run with no attempts; that transition is
irreversible. Once supervised, omitting the supervisor generation never selects
a historical fallback. The supervisor has its own PostgreSQL lease, runner
identity and control revision. Its lease lasts 60 seconds and is renewed every
10 seconds. Heartbeats do not increment the control revision. The run deadline
is fixed using database time at the first claim and never reset by resume;
it also bounds consolidation, validation and audit.

Expiration retains the canonical reservation and requires recovery. Transferring
authority requires independent proof that the previous supervisor, descendants
and Git operations have stopped. An absent PID or an expired lease is not that
proof. Injected verifiers have no permissive default. Necessary stop and
reconciliation operations remain possible after revocation or deadline expiry,
but execution cannot resume against an invalid canonical context.

Task `validation_ids` is optional and binds both fingerprints. An omitted value
keeps the original v1 rule: all plan validations apply to the task. A provided
selection is nonempty, unique and references the frozen plan. This permits a
task to validate before a dependent creates later integration tests. The final
run always executes every plan validation and every read-only audit criterion
on the exact integrated SHA.

The scheduler launches only ready tasks within the frozen concurrency ceiling.
Independent tasks start at the plan base; dependent tasks start at a Git head
whose durable chain contains the accepted and applied predecessors. Source
worker commits need not be Git ancestors after cherry-pick: the journal binds
each source to its resulting integrated commit. Integration uses deterministic
topological order, then task ID, rather than completion timing. A failed task
blocks descendants; independent work may continue while run preconditions hold.
Loss of coordination stops new launches and requests worker termination.

Each attempt starts its heartbeat immediately after claim, including during
native preparation. Preparation evidence is immutable, attached to the exact
request and stored separately from worker event sequences. Resume reloads its
verified local baseline and evidence; it never silently reboots a prior attempt
or relaunches an indeterminate worker. Each attempt has its own executor instance.

After confirmed termination, capture examines tracked, untracked and ignored
changes, deletions, modes and links against the prepared baseline and exact
scope. Commit creation uses captured bytes and a private index without moving
the worker branch. Ambiguous moves require verified admission evidence;
unproven changes are refused. Git hooks and filters are not implicit execution
authorities for this operation.

Git mutations retain a local operation journal with intent, invocation digest,
observed PID and parent termination. This is recovery evidence, not ownership
authority. A timeout, missing terminal observation or uncertain stop blocks
further Git operations until an injected verifier reconciles the operation;
closing the parent alone does not prove descendant termination. Read-only
inspection does not create a journal. Automatic maintenance and parallel
checkout are disabled, and every subprocess has a bounded command and stop
budget. Native process confinement remains a separate qualification.

Integration prepares a commit in a separate worktree, records immutable
`prepared` evidence with source, parent and result, advances only the run's
dedicated reference using compare-and-swap, then records `applied`. At most one
prepared integration is pending. The integration ID derives from the frozen
run, plan, task, attempt, source, parent and sequence. If interruption occurs
before the PostgreSQL journal, resume finds the same local resource and refuses
until it is explicitly reconciled; it cannot silently allocate a new result.
An already journaled result cannot be recalculated or replaced
on takeover. A reference already at that result is recognized; an unexpected
reference blocks recovery. Conflicts are preserved without reset or resolution.
PostgreSQL and Git are not a single transaction: revocation in between can leave
an application to reconcile, never an accepted dependent launch.

After the run deadline or canonical revocation, explicit recovery may record
`applied` only when Git already points at the immutable prepared result. It
requires the retained reservation, a live supervisor generation and fresh Git
observation, and leaves the run in recovery. It authorizes no CAS, preparation,
validation, resumed work or successful completion. A pending integration blocks
all terminal outcomes, including failure and cancellation, until reconciled.

Acceptance uses the immutable terminal result and supervisor authority; it does
not require the completed worker's lease to remain live. Acceptance, prepared
and applied integration, and final validation remain separate records. Final
completion requires every task accepted and integrated, no uncertain processes
or journal, a current matching Git head, and complete validation and audit
evidence. Repair requires a new explicit task. Public commands and general
cleanup are subsequent increments.

### Recoverable consolidation and verification

Shared schema 5 adds immutable integration intentions before Git preparation.
The intent binds the accepted source, expected parent, ordered integration,
physical workspace and explicit commit identity. Its creator is distinct from
the actual producer of a prepared result. A replacement supervisor first proves
the previous process tree and Git operations stopped. It can adopt the exact
local prepared bytes, or prepare once after proving the intended resource absent
under current authority. Partial preparation and conflicts remain preserved.
An expired intention with no prepared result retains its reservation.

Explicit recovery can attach a complete local preparation factually after the
deadline or revocation. That record grants no new Git operation or CAS. A
reference already at the prepared result is reconciled without a second update;
a different reference blocks recovery. Historical journals without an intent
cannot acquire a fabricated retrospective intent.

New concrete verification requires a frozen plan manifest. It pins the runner
executable, sanitized environment, regular control files and modes, audit policy,
budgets and the SHA-256 of an Ed25519 public key in SPKI DER form. The key is
selected explicitly before plan creation. Its private half and proof directory
remain supervisor-owned; no key is generated or substituted implicitly on resume.
PostgreSQL stores the plan pin, never the private key. A proof cannot nominate its
own trust anchor. Historical plans keep their previous injected interfaces.

Validation observes a separate detached worktree at the task commit or final
integrated SHA, not the unchanged worker HEAD. The supervisor records fresh
before/after Git observations, process termination, invocation and output hashes,
then signs the evidence. The store verifies it against the pinned authority and
rechecks ownership and deadline before commit. Acceptance, process exit status,
integration and cleanup remain distinct. Final validation and audit share the
same exact snapshot. Worker edits cannot change the frozen control files.

The audit policy maps every criterion to an explicit supported check. An unknown
criterion remains unavailable. Observed preservation does not prove OS confinement:
the concrete runner also requires an explicitly qualified execution boundary,
with no raw process fallback. Fixture boundaries and signatures only qualify the
protocol. Its attestation binds the OS, candidate engine, runner, environment and
policy, and requires read-only snapshot access, inaccessible supervisor resources,
disabled network and confirmed descendant termination. The verifier inherits no
environment; its closed variable allowlist permits only OS, locale and explicit
scratch settings. Each check returns one JSON document containing exactly
`contract_version: agent-verification-check.v1`, `validation_id` and `status`;
the child never supplies the tested SHA. Canonical audit replay rereads the
PostgreSQL and Git facts and refuses material change while retaining prior proof
bytes. Native permission enforcement requires separate platform evidence.
No evidence is purged automatically, and repair still requires an explicit task.

### Explicit lifecycle and native composition (lot 7)

The five public commands are launch, status, resume, cancel and cleanup under
`aidn runtime agent-run*`. Status is read-only; the other commands preview by
default. `--json` changes only formatting. Launch/resume/cancel require
`--execute --expect-plan <action_sha256> --sync-relay`; cleanup requires
`--write --expect-plan <action_sha256> --sync-relay`. The complete action binds
configuration, target, plan, activation, generation and material preconditions.
Re-observation must produce the same digest before application. Preview never
creates claims, leases, worktrees, archives or migrations and never invokes a
native metadata observer.

The public path requires `plan.supervision.configuration_sha256`. The local
configuration pins the prepared catalogue, exact installed engine, client,
helper, Git executable, native profile/consent and verification authorities.
Historical plans remain valid without this optional field. The prepared
catalogue binds base and task contracts before a run exists; final plan and
attempt bindings are applied after reservation, avoiding a fingerprint cycle.

Preparation of fresh unassigned worktrees is an explicit operation before the
human native review. Each root receives its own canonical verify-only receipt;
no receipt, authentication or trust is copied. The initial native composition
supports Windows with an explicitly selected preexisting profile and at most
four prepared worker roots. This is a native capacity limit, separate from plan
concurrency. Every root needs an actual native trust observation. Linked roots
may use the coordinator's observed hook definition, but its trust is not inferred
for a new root.

After the claim, adoption verifies the complete prepared preimage and durable
placement intention. Dependent tasks receive the exact integrated input SHA.
The supervisor preserves installed controls and refuses conflicts, dirty or
ambiguous roots and protected-path changes. An interrupted placement is retained
for reconciliation; it cannot reset the root or retry blindly. The native
bootstrap has its own immutable intent/terminal observations and never converts
an unknown metadata process into a stopped worker proof.
The configuration also pins `native.metadata_runner` (Node executable and
SHA-256). A candidate bridge places metadata observation beneath the controlled
Windows Job and journals every invocation. Historical `closed`/`pid_absent`
fields establish only parent-process observation; they never prove descendants
stopped. Recovery requires the matching Job proof for every metadata operation,
including failed observations. This bridge still needs separate native evidence.

Production Git commands use the pinned process controller and executable under
a Job, with an explicit environment and bounded stdin/output. Actual termination
proofs bind the operation and observed runner; cancellation propagates to that
controller. An unconfirmed tree quarantines further mutations. Legacy injected
Git fixtures retain their separate, weaker process evidence and cannot qualify
the public native path.

Verification snapshots live in a dedicated subtree of run resources. The
validation boundary must prevent access to sibling supervisor evidence, signing
keys and PostgreSQL credentials, deny network access, and preserve the exact
snapshot. Its executable, trampoline, process controller and policy require
independent native qualification; no caller-provided availability flag supplies
that proof.
The inspected Windows Codex elevated sandbox path refreshes native setup even
when an existing backend is present. It cannot satisfy the current no-provisioning
boundary and is explicitly refused with `SANDBOX_EXISTING_ONLY_UNSUPPORTED`
before native process creation. A fabricated positive qualification record cannot
override this refusal. No fallback backend, profile change or setup operation is
introduced; the final native composition remains UNAVAILABLE.

Shared schema 6 adds immutable cancellation requests, cleanup operations and
cleanup resources. A cancellation request is durable and generation-bound; the
supervisor stops launching and drains its workers. Resume reconciles old owners
before continuing, including a cancelled run's drain-only path.
A reservation interrupted before the first supervisor claim uses a distinct
initial observation: no supervisor history, attempt, acceptance, integration or
run deadline may exist. The observation binds the run, plan and control revision;
local process journals must also establish termination before the first claim.
Earlier worktree preparation is admitted only when each frozen catalogue row
retains its exact preimage and one matching Git creation invocation. An extra,
foreign or unfinished mutation blocks this initial recovery; matching a command
does not replace the independent proof that its process tree has stopped.
A pending cancellation permits only a drain claim, without launching a worker.

Cleanup accepts completed runs only, after every supervisor, attempt and Git
operation has confirmed termination. A separate leased cleaner generation owns
the exact resource set. Before deletion, all bytes, Git metadata and immutable
descriptors are retained outside those worktrees and bound to the PostgreSQL
cleanup intention. Accepted verification snapshots must be identified by
authenticated observations already persisted in PostgreSQL. Removal preserves
task/source refs and proofs. Recovery after removal observes both the original
physical root and its worktree metadata absent; relocation or unexplained state
is refused. Failed runs, conflicts and unknown processes are preserved. No
automatic purge or general worktree-management API is introduced.

### Managed elevated preparation (separate candidate)

The existing-only contract remains unchanged. A separate `managed-elevated`
preparation model describes the official Windows elevated backend's possible
shared effects, including a setup refresh at every launch. This is an explicit
policy choice, never a fallback after an existing-only refusal. No managed
executor or setup operation is enabled by this amendment.

A versioned manifest pins the client, setup executable, command runner, host,
profile and physical roots. It names exact resource identities and permitted
create/update operations; deletion, wildcard authority and changes outside the
manifest are refused. Protected resources remain unchanged. The read-only host
inventory covers local accounts, local groups, filesystems, filesystem ACLs,
WFP rules, firewall rules, desktops, device ACLs, local policies, services and
registry state. Its completeness and preservation observations must be established
before proposing any effect. Each category binds an explicit observation scope
and digest; complete coverage refers only to that scope, never the entire OS.
An incomplete inventory cannot become permission to ignore an unobserved
resource category.

Pure contracts produce a `PREPARED_NOT_AUTHORIZED` preview with a canonical
fingerprint, or `PREPARATION_BLOCKED` when inventory coverage is incomplete.
Explicit user approval must bind that exact preview, manifest, inventory, host
and client, together with a bounded validity interval and the user's approval
reference. Re-observation must reject changed prerequisites. The preparation
model performs no OS operation and cannot create approval, change Codex
configuration, grant native trust or make the runtime available. A future managed
launcher must journal each operation, observe its permitted changes, and stop on
unexpected or unconfirmed effects. Refreshing a backend is not exempt from that
scope merely because it already exists.

A separate fixed operation-adequacy policy binds the exact client and legacy
setup phase to required observation dimensions. It retains explicit gaps for
unsupported cleanup/replacement mechanisms and unknown configuration or external
process ownership. It does not change the create/update-only manifest or make
structurally valid observations into authenticated evidence or user permission.
Optional operation assessment has a separate preview envelope; the original
preparation preview remains compatible.

The observer's security context forms part of each observation scope. Partial
read-only projections, access refusals and provider timeouts remain distinct.
UAC activation from a non-elevated app-server is outside the current Job proof;
a managed launcher must establish elevation before creating its controlled tree
and separately exclude external service/helper work. Setup completion alone
does not establish descendant termination.

The operator owns these local preparation and approval records. They may later
be referenced by the frozen configuration of an `execution_run`; they are not
an alternative PostgreSQL authority or a new autonomous information concept.
Retain earlier revisions. A material change requires a new fingerprint and a
new record, without overwriting previous evidence or applying automatic purge.

Native availability remains unavailable until a managed implementation and its
independent evidence exist. The five confinement cases (filesystem, network,
timeout, cancellation and callback failure), worker admission and preservation,
and the final parallel campaign remain separate requirements on the exact
candidate. A manifest, consent record, matching inventory or pure fixture PASS
is not confinement evidence. The current existing-only launch guard remains
in force.

## Compatibility and qualification

The synchronous adapter and all historical commands retain their behavior.
The JSON validator's CLI profile remains the default; internal schemas require
the explicit `agent-execution` profile and are not advertised as CLI outputs.
Governance diagnostics may report complete policy coverage with
`coverage_kind: supervision_candidate`; this does not report runtime availability, native
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

Lot 7 adds `runtime-agent-run-lifecycle`, required once for dev, main and release,
covering portable lifecycle, workspaces, composition and validation-boundary
fixtures. The four context-resilience gates and their 43 historical invocations
remain unchanged. PostgreSQL, Windows process trees, actual native hooks,
validation confinement and parallel Codex execution are reported independently.

The scheduler and Git integration gates use bounded subprocesses and disposable
repositories. They qualify ordering, recovery and effects independently of real
Codex parallelism, host confinement and the final native end-to-end scenario.

## Consequences

- Persistence and runner implementations can evolve against explicit contracts.
- Three information concepts add governance without fabricating runtime state.
- Pure checks cannot prove physical path safety, live ownership or process death;
  later adapters must enforce and qualify those boundaries.
- The scheduler depends on durable integration for dependent tasks. Public
  command availability does not establish native execution readiness; cleanup
  remains limited to the frozen resources of a completed run.
  No swarm, mailbox, quorum, automatic
  reassignment, unbounded repair or general worktree administration is introduced.
