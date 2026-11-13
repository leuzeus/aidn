# 05 Local-First Shared Runtime

Protected signed sources use their original issuer expiry without a blanket host
maximum duration. Current permission rejects future issuance and actual expiry.
Authenticated accepted/delivered history verifies original signature, source,
subject and current principal without comparing provenance dates to today's
clock. Native epoch grants and finite allocation budgets remain independent.

Disposition plans reobserve their exact current subject without an elapsed-age
ceiling. Local exact-action grants use v2 without a host-generated expiry.
Legacy v1 issuer expiry, explicit permit/source checks, owner/fence and CAS
remain required; historical attempts remain evidence, not renewed permission.
Native grants and allocation bounds retain their separate authorities.

## Purpose

AIDN is local-first by default.

Shared runtime is opt-in and must not weaken checkout-bound auditability or local recovery.

## Core Rules

A separately granted canonical-choice checkpoint authenticates the accepted
record and its original H source while reobserving exact canonical postimages,
metadata, process CAS, branch tips and current permission across awaits. It
uses the existing objects/ref/index Git port without changing physical branch
or canonical metadata. Only its own causally proved commit may advance the
current HEAD; a selected current branch follows that commit. DB-only exports
nothing and returns no change. Lost Git/index acknowledgement retains UNKNOWN,
empty facts and the effect owner even when a physical commit is observed.
Checkpointing supplies neither phase admission nor physical activation.

Canonical cycle-choice recording uses the selected artifact backend and the
existing local effect owner, resource fence and content/metadata CAS. A foreign
cycle acted upon by import, integration intent or drop requires its canonical
owner session to be closed with its close gate satisfied. A deferred foreign
cycle is left unchanged. Source permission, process identity, relevant branches
and canonical preimages/postimages are checked across awaits and writes. DUAL
projects exact committed rows; DB-only requests no visible export. A partial
write retains the owner for explicit reconciliation. Recording never checks
out a branch or replaces imported work, and does not claim PostgreSQL or full
STANDARD qualification from SQLite fixture evidence.

R05 objective opinions, linked completions and diagnosis requests use current
authenticated material instead of a preparation-age ceiling. Accepted physical
completions retain their exact report/event/receipt witnesses without an age
limit. Internal gates impose no elapsed default; explicit caller thresholds are
separate policy. Historical fact authentication, current linked/source permission,
issuer expiry and the original finite Native grant keep distinct boundaries.
The private recovery cycle selection also reobserves its exact checkpoint,
context and cycle inventory around H authentication without a host-invented
question expiry. Historical v1 question bytes and issuer/source permissions
retain their own boundaries.

- PostgreSQL is optional
- once `runtime.persistence.backend=postgres` is configured, runtime continuity reads use PostgreSQL as the canonical backend and stop on unavailable or ambiguous canonical context
- the asynchronous DB-first continuity reader defaults to the canonical backend even when an older client omitted `localProjectionPolicy`; a compatibility SQLite projection is never its implicit authority
- shared runtime is opt-in
- local checkout-bound artifacts stay local unless a rule explicitly says otherwise
- shared runtime may carry coordination metadata, not implicit copies of checkout-bound state
- public runtime JSON outputs may expose connection references but must recursively redact resolved connection strings

Full PostgreSQL runtime snapshots select their canonical/legacy scope and read
all requested tables in one fresh `REPEATABLE READ READ ONLY` transaction.
They commit before returning an observation; a query failure rolls back and
returns neither partial payload nor partial heads. Cleanup errors must not
replace the original failure. This per-call observation is not a cached verdict
and does not change scope authority or implicitly bootstrap a missing schema.

STANDARD history authentication may read referenced operation journals in
bounded batches from the selected PostgreSQL scope. Each batch uses a fresh
read-only transaction. Journal validation and signature checks still run for
every referenced record. No batch result carries across authentication calls
or effect boundaries.

The synchronous PostgreSQL cycle validation subject selects its plan lineage
and completed work from one authenticated history observation. Each selected
journal still matches its accepted receipt, and native evidence is read and
checked by digest. A subsequent subject, context check or effect admission
reads fresh authority. FILES and SQLite keep their individual journal reads.

The STANDARD R05 context reader groups the fixed post-admission document
reads when PostgreSQL owns the artifacts. It reuses the bounded read-only
artifact port and checks content integrity and required paths in request order.
A later diagnostic or effect boundary acquires its own observation.

The cycle checkpoint reads content and metadata fingerprints together from
the configured PostgreSQL artifact rows. Every checkpoint document check
opens a fresh bounded observation. Dual mode also checks the visible bytes.

PostgreSQL cycle readiness reads the metadata pins of the observed documents
in one bounded batch. Each returned content hash must match the observed
document before its metadata can enter the context hash. Implementation
preparation, preimages and postimages each use their own fresh content and
metadata observation for the two material artifacts. The authorization,
freshness checks and CAS stay in their original order.

PostgreSQL task advancement reads the three material artifacts with their
metadata in a fresh batch at preparation, before CAS, and after CAS. The
preview and locked re-preparation each make their own observation. Existing
source, owner, projection, and freshness guards retain their boundaries.

Cycle plan recording, task advancement and entry into implementation or
verification validate their prepared plans
through fresh authority, locked reconstruction, context and prefix checks,
content and metadata preimages, and conditional writes. Elapsed wall time
alone does not invalidate these plans. Their preparation timestamp remains
part of their signed provenance. Authorization revocation and resource leases
are checked by their respective authorities.

Staging a signed STANDARD preview checks its current process prefix, complete
snapshot, resolved input and current authorization. Its preparation timestamp
records provenance. Staging does not impose a separate elapsed-age limit.
Dispatch applies the current authorization and operation-specific validity
checks before its business effect.

Cycle checkpoint and drift finalization reconstruct their prepared plans under
the effect owner and repeat current authority, prefix, document, gate and
objective checks at their existing boundaries. Their preparation timestamp
does not impose an elapsed-age limit, including after the drift report write.
Hook event correlation still verifies the unique run, unchanged event prefix,
matching subject and timestamp inside the observed hook invocation. A revoked
capability or changed context still refuses; loss after an effect retains an
uncertain outcome.

Session and cycle initialization and cycle context refresh use explicit signed
intent, locked reconstruction, current project/Git scope and their canonical
preimages to establish validity. Their host checks the current grant before
dispatch. Session Git checkpoints additionally recheck the accepted start and
context evidence, finite path set, index and HEAD through the protected Git
port and its live authorization callback. These plans carry preparation time
as provenance without a separate age ceiling. Existing legacy expiry receipts
remain readable and do not establish an age rule for a new effect.

Mode application and start finalization use the same validity rule for their
explicit prepared effect. Cycle terminal recording, session closure reports
and baseline promotion records reconstruct their current accepted decision
and canonical source, then verify grant, scope, preimages, conditional writes
and postimages at their existing boundaries. Elapsed preparation time alone
does not invalidate these plans. Recording a terminal state, report or baseline
still leaves its separate final hook pending; partial writes remain uncertain.

The finite cycle-terminal, baseline-promotion, session-preclose, session-close
and session-delivery Git checkpoints also validate their current accepted source, canonical
postimages, branch/HEAD/index and live grant without a preparation-age ceiling.
Their timestamp stays in the signed plan and Git provenance. Reload/cache
verification remains required where the operation provides it; delivery still
preserves the final hook's existing cache and events. A lost grant after Git
remains uncertain, and DB-only state is never exported merely to make a commit.
The timestamp must still be a safe nonnegative integer. Mode/start and terminal
checkpoint entry preserve this numeric validation independently of elapsed age.

Cycle, baseline-promotion and session finalization hooks apply the same
current-state validity rule. Their plan has no preparation-age ceiling at entry,
after awaited authorization or after the real hook. Accepted source, process,
grant, canonical preimages/postimages and unique correlated events remain
required. The actual event must fall within this hook invocation; that proves
causality rather than setting an age limit on the plan. A typed cycle return to
review still reconstructs the current completion opinion and historical anchor.
These changes do not decide the separate human-opinion or drift-event windows.

Drift recovery recording, change requests, context/checkpoint/cycle recovery,
rollback, PR correction reopening/checkpoint/cycle creation and SPIKE conversion
also use current-state validity without a preparation-age ceiling. Their
original timestamp remains safe nonnegative integer data and part of the plan
hash. Current evaluation/decision, process prefix, authorization, canonical
metadata and exact product/Git preimages and postimages remain required at the
existing effect boundaries. A lost grant or confirmation after an actual effect
still retains UNKNOWN and its owner; elapsed time alone creates no such result.
SPIKE records still grant no product authority or successful experiment result.

Session branch integration, initial push, PR opening/recording/checkpoint and
initial or corrective PR update push also use current-state plan validity.
Their safe nonnegative timestamp remains signed provenance without an age
ceiling. Accepted closure/decision/admission, exact local and remote Git state,
canonical content/metadata, protected provider subject and current grant remain
required at the existing boundaries. A real transport, source, grant or
confirmation loss after an effect retains UNKNOWN and its owner. A confirmed
push or open PR still does not imply successful checks, review, merge or sync.

Cycle validation reconstructs the work, product snapshot, profile and boundary
descriptor under its owner and current authorization before running checks.
These observations establish plan validity. The profile's command budget
limits execution with a monotonic clock and invokes the stop protocol when
exhausted. Its purpose is to bound potentially nonterminating commands and
account for their resources. The plan's preparation timestamp records its
provenance independently of that execution budget.

Each STANDARD drift or cycle-plan context reads the PostgreSQL session and
cycle topology from one bounded, read-only canonical inventory. Selected
rows still pass path, content hash, and identity ambiguity checks. The drift
observation and the subsequent cycle-plan observation each acquire their own
inventory. The cycle-plan observation reads its current state and workflow
kernel from that same PostgreSQL inventory. The subsequent readiness metadata
read still binds each pin to the observed content hash. No topology
observation carries across an authorization or effect boundary.

Each STANDARD host precondition snapshot observes scope before reading its six
required documents. PostgreSQL reads the documents in a fresh bounded batch,
preserving the order and content hashes in the signed snapshot. Staging and
dispatch still acquire their own snapshots at their existing boundaries.

## Do Not Move Implicitly

ADR-0013 defines an explicit migration of standard AIDN executable assets to a
user-level installation. This is code distribution, not shared workflow storage:
project configuration, activation, extensions, historical records and runtime
data retain their existing scope. Global installation shipped in 0.10.0;
each client still needs explicit ownership-checked migration. A published
engine is not permission to relocate project files or data implicitly.

These surfaces must not be relocated by shared runtime behavior:

- `docs/audit/*`
- `AGENTS.md`
- `.agents/*`
- `.codex/*`
- `.aidn/config.json`
- `.aidn/runtime/index/workflow-index.sqlite`
- `.aidn/runtime/context/*`
- `repair_findings`
- `incident`

`repair_findings` and `incident` are explicitly not shared. A future change may
cross that boundary only after an ADR adds the surface and the shared
coordination port exposes it.

## Shared Runtime Boundary

Any shared runtime extension must pass through:

- explicit ports or adapters
- the relevant ADR
- tests
- a gate

The current boundary is described in:

- `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`
- `docs/ADR/ADR-0007-local-first-federation-boundary.md`
- `docs/ADR/ADR-0008-shared-coordination-ports.md`

## Practical Rule

If a change would make a checkout-bound artifact disappear into shared infrastructure, stop and re-check the boundary before proceeding.

The default expectation is local recovery first, explicit shared coordination second.

## Bounded Supervision Model

ADR-0014 reserves PostgreSQL authority for the opt-in supervised execution
path (`execution_run`, `delegated_task`, `execution_attempt`). Existing sequential
workflows continue to support operation without PostgreSQL. Lot 3 adds a separate
AgentExecutionStore and explicit shared schema 2 to 3 migration. Lot 5 adds
schema 4 supervisor generations, acceptances, integration and final validation,
with `supervision_candidate` coverage. Canonical runtime and supervision must
share one PostgreSQL transaction. Writers check reservations atomically. The
internal scheduler requires explicit preparation, Git and validation dependencies
and a separately qualified native executor. Lot 7 exposes explicit public
preview/status/resume/cancel/cleanup commands; their native execution availability
remains conditional on exact composition evidence.
Readiness and reads do not register, heartbeat or migrate;
intact v2 remains readable for backup while writes require explicit migration.

The migration creates `execution_runs`, `execution_tasks`, `execution_attempts`
and `execution_events` under a stable advisory lock, rereads the schema version
there, and never replays already-applied DDL. A future schema version is refused.
The `agent-execution-store-port.mjs` contract and PostgreSQL adapter define this
separate persistence surface. A positive shared planning revision is required
for every supervised generation. Schema 4 also retains `execution_supervisors`,
`execution_acceptances`, `execution_integrations` and
`execution_run_validations`; their records belong to the existing run, task and
attempt concepts. Supervisor expiration requires proof that its descendants and
Git operations stopped before a new generation. The original database-timed run
deadline survives resume. Acceptance uses the terminal result and supervisor
authority, rather than a completed worker's lease. The initial historical
planning revision stays zero without a hidden
update. No SQLite, file or in-memory supervision authority is available.

Transcripts and bulky outputs remain local; shared metadata will contain only
bounded references, byte counts and hashes. Task ownership leases are distinct
from worktree heartbeats and global engine-generation leases. No claim, heartbeat
or read-only readiness check may implicitly bootstrap DDL. Delegation and results
belong to attempts; expiration requires reconciliation before another launch.
Fixture-injected `verifyActivation` and `verifyTermination` are not native
qualification. Lot 4 adds a bounded admission transport and candidate process
executor without advertising native availability. Admission rechecks the live
attempt in PostgreSQL; hooks carry no writer secret and reject unsupported tools
for delegated worktrees. Native trust, actual hooks and OS confinement remain
separate required proofs. There is no automatic purge.

Lot 6 adds explicit shared schema 5 integration intentions and authenticated
verification observations. The intention precedes Git effects; local prepared
results are adopted only after reconciliation. The frozen plan pins verification
controls and the proof authority. A supervisor serializes its own coordination transactions to avoid competing
with itself for the canonical fence; queue time counts against the unchanged
coordination deadline. Worker concurrency remains bounded by the frozen plan,
and a coordination failure prevents queued calls from starting. Before capturing a completed worker result,
the supervisor verifies the full plan/run/task/attempt/delegation/request/result
binding. Validation receives the exact task specification from the frozen plan;
the enriched delegated-task record remains the acceptance authority.
Stopped results enter capture, commit, validation and acceptance serially because
they share one validation boundary. Worker execution remains concurrent. Queued
results recheck run cancellation and deadline before effects; a failed acceptance
stops the queue without starting another validation.
Verification accepts textual output and byte views, including Uint8Array values
produced by the native boundary's structured clone. It checks the combined byte
limit before copying each view into retained logs and signing the verdict;
non-byte containers remain refused.
PostgreSQL remains the exclusive shared authority and existing sequential
workflows still need no PostgreSQL.

Lot 7 adds shared schema 6 for durable cancellation requests and cleanup
operations/resources. Migration stays explicit. Cancellation is a request to
stop, never proof of termination. Recovery may retain a verified `not_started`
receipt when no worker runner exists. It preserves the original proof and typed
reconciliation without inventing a result or Job termination; metadata process
closure remains independently required. Conflicting or incomplete receipts fail
closed. If runner persistence was interrupted after creation, recovery verifies
the closed local process receipt against the exact request, candidate, helper and
runner identity; any conflicting persisted runner is refused. Cleanup admits completed runs only, with
stopped supervisor/attempt/Git trees, integrated commits and retained resource
preimages. Full Git observations are captured during retention preparation. Cleanup
transactions freshly compare physical identities, bytes, modes, directory entries
and both worktree registration backlinks against that retained preimage, without
repeating the Git subprocess inventory. Retained HEAD/tree/index fields are not
new Git observations; the integration head keeps its separate current fence.
Scans observe cancellation, and the existing inspection/coordination deadlines
remain unchanged. Only the locked transaction snapshot may be shared between
resource inspections; filesystem observations are never cached.
A new cleaner generation needs proof that its predecessor stopped.
Removal recovery observes the original directory and worktree metadata absent;
a relocated worktree cannot be reported as removed. Owned verification snapshots
must bind to persisted authenticated validation observations. Archives and source
commit references survive cleanup; failed runs and conflicts are retained.

Operation-journal inspection reads each record once, checking its physical path,
size and stable file identity before parsing those same bytes. Full inspection
remains fresh across calls and keeps the 4.5-second bound, including for large
retained journals; missing termination records continue to block recovery.

Cleanup admission may inspect the complete resource batch under one canonical
lock. Every filesystem observation stays fresh; one supervisor-owned global
termination check follows them and covers workers, Git and validation processes.
The whole batch keeps the 4.5-second callback bound; partial, duplicate or foreign
results are refused. The scalar inspector remains available for individual
removal fences. PostgreSQL connection errors prevent commit and remain typed;
a failed rollback cannot replace the original failure.

The STANDARD baseline promotion finalizer receives the same protected R05
completion reader as cycle closure. The real gating evaluator may discharge
only a sole objective-delta signal with current authenticated completion
material; other signals and ordinary CLI behavior retain their rules. The
capability passes through the promotion checkpoint application wrapper without
a JSON field, synthetic receipt or new permission source. Current mutation
permission and process identity are checked after awaited completion reads
before checkpoint effects and canonical completion writes.


The private local cycle-activation port changes the selected Git HEAD, index and product files without advancing either branch tip. It preserves current `docs/audit/` bytes and refuses differences in tracked `.aidn/`, `.agents/`, `.codex/`, `AGENTS.md` or `.gitignore` configuration. Protected names are matched without case distinctions. Ignored local runtime and Native configuration remain in place. A canonical overlay may remain dirty against the selected index; physical activation does not adopt or commit that history.

The application caller owns current authorization, authenticated choice and canonical admission. The fixed Git adapter checks the repository binding, refs, index, worktree and product preimages around awaited authorization and before each effect. It disables lazy fetching, credential prompting, hooks and configured filters. Partial product replacement or lost confirmation after HEAD/index installation remains uncertain; inspection does not replay, roll back or grant phase permission. This private port adds no shared store or implicit export and is not yet connected to the published choice route.


The standalone `cycle_entry_choice_activate` application operation composes that physical port with the accepted H/record/checkpoint source and its own exact mutation grant. It observes canonical backend identity, document content/metadata, cycle inventory, branch tips and process CAS across protected awaits. Its scope may follow only the source tip or its planned selected tip; the physical adapter proves the actual transition. The source-ref fence requires the Git files reference backend and refuses other layouts read-only. Physical readiness still leaves canonical focus, history adoption, phase/DoR admission and the published choice route unfinished.


The private selected-context checkpoint consumes accepted activation evidence
from the same canonical backend and preserves canonical bodies and metadata.
Its separate grant changes Git objects, the selected branch ref and its index;
it does not synchronize a shared runtime, export DB-only detail or adopt
canonical focus. Physical absence is retained without a checkout deletion.
A partial effect keeps the existing owner and signed UNKNOWN for independent
reconciliation; physical confirmation alone cannot accept that result.


Private selected-focus restoration consumes only an accepted selected-context checkpoint identity, authenticated through its original activation/CP/record/H chain. The closed input accepts no selected cycle, phase, paths or approval. Its prepared plan pins the current scope, clean Git checkpoint, canonical document content/metadata, cycle inventory and exactly three focus postimages: current session, context snapshot and CURRENT-STATE.

The separate exact mutation grant is rechecked after awaited source reads and before every metadata-preserving CAS. OPEN/IMPLEMENTING/VERIFYING select a later phase route as canonical data; cycle status, plan/progress, audit/validation history and deferred dispositions remain unchanged. Focus restoration supplies no current phase/DoR admission, progress adoption, implementation or resume permission. Ordinary entry choice rules remain intact. DB-only creates no detailed projection; dual verifies required projection. Lost CAS acknowledgement retains UNKNOWN, empty facts and the existing owner; replay returns the retained result. No store, migration, shared synchronization or preparation-age ceiling is added. Published routing and imported work qualification remain separate.


For an accepted selected checkpoint with no_change, the source attests its HEAD and absence of a Git effect; its historical pre-operation index byte hash is not an index-write postimage. Selected-focus preparation requires the same current clean HEAD, index semantics and filter context, then captures and fences its own current index bytes before CAS. A byte-only index representation refresh before this preparation is admissible. Foreign work, staged changes, moved HEAD, changed filters, current-plan/index drift and revoked current permission retain their existing refusal or UNKNOWN behavior.

## Accepted focus to physical checkpoint

A private deterministic cycle_entry_focus_checkpoint operation consumes only the identity of an accepted selected-focus write. The host authenticates that focus and its original selected checkpoint, activation, choice checkpoint, record and H capture in the current process; it does not renew the original choice subject. JSON supplies no cycle, phase, path set or approval.

Its closed preparation binds the current canonical focus postimages and metadata, unchanged cycle inventory and backend/project scope, the three physical focus paths and a fresh current Git observation. The existing trusted cycle-context port receives exactly the current session, context snapshot and CURRENT-STATE paths. No new Git profile or wider path capability is added. FILES/DUAL checkpoint their visible focus changes; DB-only requires a clean checkout and creates no detailed projection. The prior focus write did not write the Git index, so its historical index preimage is not an index postimage; the new checkpoint fences its own current index bytes.

A separate exact effect grant is rechecked after awaited source authentication and across the owned ref/index transition. Canonical content, metadata, selected phase, task progress and deferred dispositions remain unchanged. A confirmed/no-change result establishes physical focus readiness and grants no phase/DoR admission, imported-progress acceptance, implementation or resume permission. A lost acknowledgement or revoked permission after an effect retains signed UNKNOWN, empty facts and the existing owner; cold physical observation and exact receipt replay cannot repeat or promote that effect. Ordinary pending/multiple-cycle choice rules remain unchanged. Published selected routing and imported-work qualification remain separate. No store, migration, shared synchronization or preparation-age ceiling is added.
