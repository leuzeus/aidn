# ADR-0025 — Typed host operations in the common process IR

## Status

L1 contract foundation implemented under the
[standard workflow plan](../PLAN_STANDARD_WORKFLOW_PROCESS_IR_2026-11-01.md).
Versioned operation contracts, reducer events and trusted service ports are
implemented and verified offline. L2 now has partial local business adapters for
reload, admission, session initialization, authenticated mode capture/application
and start-session hook finalization, described below. The standard model,
the remaining business adapters,
provider-specific inbox adapters, general owned-host resume and installed/native
qualification remain outstanding. This decision does not claim those deliveries.

## Decision

Retain the common deterministic reducer and preserve the closed v1 model and
instance readers. Add `agentic-process-model.v2` and `agentic-process-instance.v2`
with profile `structured-agentic-process.v2`. No v1 instance is converted, relabeled
or read through the v2 schema. BPMN compiler-profile versioning is independent.

An agentic `activity` retains its existing role, policy, resource-assignment and
authenticated-result protocol. A v2 `operation` instead has a `binding_ref`.
It represents a host operation without a fabricated role, session or agent.
Operation-only models may declare empty role and native-policy arrays.

The versioned binding declares a fixed host identity, implementation hash,
executor kind (`deterministic`, `human`, `external`), effect class, optional skill
identity, input/output contract IDs, applicable modes and SPEC rule references.
The host registry, not authored JSON, resolves that identity to code. Neither a
binding nor a permission/hash field is an authorization by itself.
The v2 model's closed `operation_pins` map covers every referenced binding and
pins its exact hash before an instance starts. A changed registry implementation
cannot silently replace an operation for an existing instance.

The operation protocol has two retained events:

1. `operation_intent`: operation identity, exact binding/input/precondition and
   authorization hashes, authority, scope, occurrence, model hash and exact prior
   instance hash/revision. Replay recomputes that prior-state binding.
2. `operation_result`: immutable receipt tied to that intent and issuer, output
   hash, evidence references, explicit outcome/effect status and permitted facts.

The service only observes and authenticates data through a host-composed
`operationAuthority`; it executes no business effect. `prepare`/`verifyIntent`
must authenticate the binding and admission before recording intent.
`readReceipt`/`verifyReceipt` fetch and authenticate the actual protected receipt;
the caller supplies its identifier, never a self-authenticated receipt body.
Both observation chains are bounded, abortable and subject to the existing
authority/CAS/explicit-write/preview-hash checks. The real adapters and their
postconditions are L2 work; authority doubles are not business execution proof.

## Control and effect semantics

After an intent, the occurrence waits for its receipt. A completed receipt may
project trusted boolean routing facts, including waking parallel routing waits.
Blocked and deferred outcomes retain a wait and declare `no_effect`; further
work requires a fresh, explicit intent with a new operation ID. They never
implicitly retry or complete. Failed/rejected outcomes fail the process;
cancellation cancels it.

An unknown effect is `reconciliation_required`. It cannot receive a fresh
dispatch intent. A subsequent authenticated reconciliation receipt for the same
intent may establish the actual outcome; every earlier receipt stays in the
journal. Operation and receipt identities cannot be reused across occurrences.
The protocol does not promise exactly-once effects in an external system.

V2 exposes aggregate WAITING when no leaf is ready or executing and retained waits
remain. The v1 cursor semantics remain unchanged. The service rejects raw v2
facts/messages through its generic control method: human/external authority
cannot be replaced by a caller's `approved: true`. Explicit cancellation remains
available. The authenticated control envelope is `process-control-event.v1`,
accepted only through a host-composed `controlAuthority.read/verify` port. Its
issuer, principal hash, source event identity, scope, instance/revision, occurrence
and correlation are retained; source events cannot be reused across waits.
Caller bodies never authenticate themselves. Real source adapters and the
durable inbox are L2/L4 work.

Pure replay/simulation validate event structure and bindings and perform no
effects. A synthetic receipt is reference evidence, never authentication of a
real person, external service or operation. Real verification belongs to the
trusted host port, including current mode, grants, source and postconditions.

## Compatibility and qualification boundary

The native-only owned composition accepts v1/v2 activity graphs and explicitly
refuses operation nodes before allocating native resources. V2 also refuses raw
control-scenario facts/events before allocation; human/external control requires
its authenticated service ports. It must not send an operation node to a model
or assume a previous native allocation can be resumed from ephemeral maps.
L2–L5 still need the mixed execution host and ordinary standard entrypoints.

Operation intents and receipts are events of the existing governed process
instance, retained under its artifact CAS, scope, fence and projection rules.
This slice adds no shared table or independent durable registry. The binding is
versioned host configuration; a future persistent registry/inbox requires its
own explicit governance coverage before implementation.

Offline fixtures cover schema closure, historical rejection of extensions,
non-success outcomes, unknown-effect reconciliation, parallel routing, exact
replay/simulation, authority forgery/timeouts, current-authority changes,
canonical receipt races and durable waits on real SQLite/files storage.
Native and installed standard-workflow qualification remain NOT_RUN.

## L2 bootstrap component

`standard-workflow-operations.mjs` composes real application admissions/reload and
Git/artifact effects. `session_initialize` is a component of start-session,
not a claim that its mode choice, checkpoint and hook completed. It accepts only
UNKNOWN bootstrap mode. A closed, versioned plan binds root/activation, backend,
Git branch/HEAD, input, template, predecessor and artifact pre/postimages;
explicit write and the exact plan hash are required. Admissions and authority
are checked again before Git or artifact effects. Project checkout hooks are
disabled for this host's Git calls; requests cannot select code or shell commands.
The implementation digest pins the listed direct modules/schemas, not a complete
transitive package or native-host qualification.

Business artifact authority remains the configured files/runtime store. Canonical
CAS and required projection are existing ports. Creation writes a new conformant
session; it never converts historical sessions or changes their readers. Session
initialization spans Git and two artifacts and is not an atomic transaction.
The rendered objective collapses whitespace so the existing Markdown normalizer
cannot reinterpret objective data as another metadata field. Its original input
and exact rendered postimage remain in the reviewable plan.

`process_local_effect_owner` therefore governs a private worktree-local collision
guard with a closed schema, owner token, PID, physical scope hash, exact plan hash
and acquisition time. Exclusive creation serializes cooperative ports. A confirmed
result or proven before-effect refusal releases it; uncertainty/process death
retains it. PID and elapsed time never authorize takeover. This is not distributed
ownership, permission, authenticated result evidence or an effect journal. L4 must
provide durable dispatch/reconciliation and ownership before ordinary entrypoints
can execute the full mixed standard workflow. No automatic lock repair is supplied.

The initial bootstrap-port suite uses real local ports and deliberately partial
SQLite effects; by itself it issues no reducer receipt. The additional host
suite below supplies that consumer. Neither suite consumes a shipped full
standard model. Native, shared concurrency and archive qualification remain open.

## Durable operation host foundation

The additional `standard-workflow-operation-host.mjs` now composes those three
fixed business adapters with `createAgenticProcessService`. Routing remains in
the common reducer. No authored JSON selects a module, shell, signing key or
authorization adapter. A trusted outer host must supply `readSigningKey` and
`authorize` capabilities. The latter binds an explicit effect grant and principal
to the exact signed preview; the native/operator adapter is not yet supplied.

`standard-operation-preview.v1` pins the canonical instance revision, occurrence,
binding, input, business plan and artifact snapshot. Preview has no writes.
Explicit staging requires its exact hash and a fresh grant. Before dispatch,
`process-operation-journal.v1` persists the intent and then claims its dispatch
owner through the existing canonical artifact CAS. Execution calls the real
business port. The host retains the output and authenticated receipt before
the common service accepts its result event. Bulk business output stays outside
reducer events; their receipt binds its hash and retained evidence reference.
`aidn:operation-output/<operation-id>/<index>` resolves through the authenticated
host to `journal.results[index].output`; its SHA identifies the exact retained
business payload.

The `process_operation_journal` concept owns these records, their projections,
retention and metadata. HMAC authentication uses a 32-byte key obtained only via
the trusted capability; no key bytes are retained in product state. The host
scope additionally pins storage mode and key identity. It does not silently
adopt instances created through a different host scope. Historical generic
readers remain unchanged. Direct implementation pins cover this host, journal
adapter, signing code and schemas as well as the business adapters.

On reopening, the host authenticates every earlier operation intent/result
against its journal. A structurally valid, self-hashed instance or journal is
insufficient. Initial routing facts and human/native result histories cannot
be injected through this deterministic host. A receipted result can be accepted
in a new Node process without dispatching again. A claimed operation with no
receipt remains `reconciliation_required`; PID and age cannot permit replay.
Unknown business effects retain their unknown receipt and stop fresh dispatch.
Bulk index producers protect operation journals alongside process instances and
definitions: a stale visible projection cannot reset a canonical dispatch phase.
Both the common predicate and SQLite/PostgreSQL selection queries are covered by
the actual producer fixtures. SQLite preserves omitted records; PostgreSQL full
replacement refuses their omission. This is ordinary import protection, not a
claim of protection against arbitrary trusted-storage rollback.

This is an internal deterministic-operation host, not the delivered full standard
workflow or general mixed/native resume. Provider inbox, general mixed history
authentication, ambiguous-owner cessation/reconciliation, protected native key
provisioning, trusted operator grants, distributed fencing and native budgets
remain L2–L5 work. HMAC does not prove storage anti-rollback, OS isolation, human
identity or process-tree death. The stopped-dispatch fixture is an authored
stopped state, not an observed OS kill. Live PostgreSQL, native Codex and exact
installed-archive qualification remain NOT_RUN.

## Human mode decision and startup hook component

Three additional fixed bindings extend the internal host. `mode_decision` is a
read-only human operation. Dispatch persists its intent and returns a closed
`standard-mode-question.v1`, without polling a source or allocating a model.
Only an explicit source reference invokes the trusted `humanSource.read/verify`
capabilities. The source must authenticate the exact operation question and
subject. Raw authored JSON, a self-hash or a model response cannot supply this
authentication. A missing source keeps the same waiting state and journal.

`process_decision_inbox` retains a signed `process-decision-inbox.v1` under the
existing canonical artifact CAS. The immutable source includes its authority,
event identity, subject, question hash and choice. Authority/kind/event identity
is deduplicated across operations. Its acknowledgement progresses from reserved
to receipted; ordinary index producers cannot overwrite it from stale visible
data. `aidn:decision-source/<inbox-id>` resolves to that immutable source through
`readDecisionSource`; its hash does not describe the mutable acknowledgement
envelope. A restart may finish this read-only capture from a dispatch claim:
this repeats no business effect and grants no takeover of deterministic effects.

Refusal becomes rejected/FAILED; deferral remains WAITING and requires a fresh
explicit intent/question and a new authenticated source; cancellation becomes
CANCELLED. No answer produces no receipt. Only a completed, canonically accepted
mode decision from the same instance supplies `session_mode_apply`. Caller mode
JSON is rejected. That deterministic mutating port separately requires a current
effect grant, exact plan and fresh admissions; it updates session and current
state under the existing local effect owner. It observes an explicitly declared
UNKNOWN field without changing historical readers that normalize UNKNOWN to null.

`session_start_finalize` executes the actual fixed `runSkillHookUseCase` route
and `start-session-hook.mjs`, including checkpoint and the required constraint
pipeline. Its versioned effect plan binds the selected mode, canonical session,
current state, scope and expected effects. Completion requires successful
admission, an actually executed hook, checkpoint/gate/reload/sync postconditions
and required constraint artifacts. Exit zero alone is insufficient. Unknown
post-effect status retains the owner and requires reconciliation. Bulky hook
results and physical proof paths remain in authenticated operation output; the
reducer receipt references that document through its bounded logical URI.

The mode suite uses real disposable business ports and files/SQLite stores, with
a fixture human authority and effect grant. It covers capture, non-success
choices, restart acceptance in a new Node process and exact reducer simulation.
It does not deliver a protected native human channel, GitHub events, general
cessation/reconciliation, full skill planning, cycle/carryover orchestration or
the shipped standard IR. No ordinary entrypoint selects this partial fixture as
the full workflow. Native Codex, live PostgreSQL and exact archive qualification
remain separate acceptance work.

## First distributed standard-process component

`package/catalogs/process-models/aidn-standard-startup.v1.json` is now the authored
IR of the fresh-session startup component. Its catalog pins the canonical model
hash, exact operation bindings, package SPEC and skill-source bytes. This is a
new package asset, independent of the historical shadow definition. It does not
claim complete standard-workflow coverage or replace the ordinary default entry.

The fixed `standard-workflow-startup-composition.mjs` loader verifies those
authorities and composes the existing operation host. It does not regenerate a
graph, accept a caller module path or repair pins. A closed source descriptor
enters host scope and signed operation snapshots, retaining catalog and authority
provenance alongside the embedded instance model. Generic hosts without this
descriptor cannot adopt the component instance. This provenance is metadata, not
human authentication or effect permission; actual admissions and trusted grants
remain required. Direct implementation pins include the catalog validator and
its schemas, while full transitive/archive identity remains separate evidence.

`standard_workflow_model` governs the package catalog, source revisions and
retained descriptors. Source-authoring refresh is explicit: it may replace only
changed implementation hashes, creates a new model/catalog revision, and preserves
the authored graph. Changed SPEC, skill bytes, contracts or declared effect classes
require a reviewed source update first. Historical instances/readers are not
converted. A partial source write fails loading instead of triggering a fallback.

Real-port startup fixtures now consume this published JSON and the common cursor.
They supply initial parameters and authenticated fixture source/grant capabilities.
The published IR declares each operation input, including the accepted mode
decision identity; the driver supplies neither per-operation input nor a second
startup sequence. Isolated human protocol tests still
use their own fixture model. The component's declared remaining paths include
session/cycle resume, cycle/DoR, work, drift/incidents, validation, closure,
promotion, PR, post-merge synchronization and general mixed resume.

Source fixture execution, package inclusion and working-directory independence
remain distinct from native identity, live PostgreSQL and execution from the
exact installed archive. Full L2–L8 acceptance remains open.


### Cycle scaffold and Git hygiene boundary

The separate cycle scaffold component uses the common authenticated operation
host and reducer, not a second cycle orchestrator. Actual creation/admission,
canonical CAS, branch ownership audit and runtime projection are bound to SPEC
and fixed skill/code identities. Creation stays OPEN/NOT_READY with an empty
native write scope. R3, human cycle choice, DoR and completion of the full
cycle-create skill remain open; the checkpoint extension is specified below.

The published cycle component also declares its input mappings. Initial cycle
parameters carry session identity and requested cycle identity/type/title/goal.
The completed first context-refresh input anchors the requested session. The
successful admission journal supplies continuity rule and base branch to
initialization. A changed active session must refuse instead of silently moving
the request to another session. Audit and final context refresh consume
the accepted initializer input. The initializer still reruns its business
admissions and compares continuity immediately before effects; a previous
admission receipt is data, not an effect grant or a freshness exemption.

Startup revision 24 and cycle revision 22 explicitly opt into these mappings.
Their fixed loaders keep using the common operation host and reducer. New
instances require the declared parameters at initialization and reject explicit
operation-input overrides. Earlier embedded models remain readable under their
own retained version/source; loading a new package asset does not rewrite them.
This does not provide full-cycle selection, R3, the complete standard model or
ordinary CLI/console entry integration.

A controlled db-only experiment admitted cycle creation before the local owner
was acquired, blocked on `?? .aidn/runtime/standard-workflow/effects.lock` while
owned, then admitted it again after release. Keep the real Git-clean gate. Extend
the existing owned installation ignore asset only for reserved local runtime and
authenticated control storage. Do not ignore business artifacts, redefine their
authority, remove tracked entries automatically or weaken admission. Canonical
local DB/control records remain durable and require the existing retention and
backup procedures despite their Git exclusion.

A separate exploratory execution of the actual cycle-create hook completed its
checkpoint but returned gate `warn`, `L2_SIGNAL_TRIGGERED`, action
`run_conditional_drift_check` (R05/time since last drift check). Outer hook success
is insufficient evidence of full skill completion. The scaffold graph deliberately
ends before that skill completion. The full model must route conditional drift
and durable waits before continuing; it must retain the checkpoint receipt and
must not rerun already executed effects to make the warning disappear. This hook
probe is diagnostic evidence, not full native or installed-workflow acceptance.


### Durable control delivery through the operation host

The existing common service/reducer control protocol is now composed with the
standard operation host. It has an optional trusted `controlSource` read/verify
capability; no JSON model can install a verifier. A versioned request binds the
waiting instance/revision/model, occurrence, correlation, allowed event keys,
branch/head and business-context hash. A typed source binds that request and
provider/principal/event identity, payload hash and evidence. Source absence
returns WAITING without polling, model allocation or a canonical write.

The signed `process_control_inbox` uses existing project artifact CAS under
`workflows/control-inbox/`. It reserves a globally deduplicated source identity
before delivery to the reducer, then acknowledges the exact resulting instance
hash. Both operations and control history authenticate after reopening. A crash
after canonical event delivery but before acknowledgement can acknowledge the
retained event without contacting the provider or replaying effects. The delivery
checkpoint is derived with the common reducer and stays unchanged by later work.
Required derived projections can be repaired by an explicit retained delivery;
canonical acceptance never comes from a stale visible copy.

This is local/canonical control storage, not a new shared-coordination table or
business authority. Bulk SQLite/PostgreSQL producers protect it as they protect
other process records. The install ignore asset excludes its generated private
files without changing their retention or canonical authority. The v1 readers
and closed mode-decision inbox remain separate.

Fresh delivery rechecks source verification and the bound business/Git context.
Past accepted history relies on its authenticated retained capture, not a new
favorable answer from the provider. A source event cannot authorize a second
request. Receipt authentication does not turn an event into business approval;
the IR and actual downstream ports must still enforce refusal, deferral,
cancellation, review/head and admission semantics. The provider-specific GitHub
adapter, real human channel, full standard model and native mixed resume remain
unqualified. Raw facts/messages/native result history remain rejected by this
operation/control host until their own durable authority is composed.


### Retained native host state before resume admission

The native activity host now exports `native-host-state.v1` only after checking
its canonical assignment events against its own issued native observations and
its result events against its own retained result receipts. Referenced protected
result files are reverified. The bounded evidence snapshot retains the exact
instance, executor/agent/lineage/session identities, contributions, binding/skill
identities, observed result references, parent-close outcome and native usage.
No developer instructions, worker command arguments or reasoning are copied.

The production composition retains this evidence through its existing protected,
quota-checked allocation writer after closing clients. `native_checkpoint` in
the worker result identifies its immutable bytes. Observed response identities
are hashed, counted and tied to the authorization hash. A failed/interrupted turn
retains its possible contributor even without an accepted result; missing usage
stays unknown. A rejection stays terminal. Capture/storage failure preserves an
earlier failure and cannot authorize favorable retry.

This evidence is subsumed under `agentic_process_instance`, not a new canonical
workflow state or shared coordination table. The snapshot's parent_closed flag
is not the supervisor's process-tree proof. The retained envelope explicitly says
resume authority is not established by the snapshot alone. An authenticated
allocation journal must bind this evidence to actual owned closure, fences,
cumulative budgets and an explicit next-allocation grant. The consumer below
provides native-only continuation; default start still cannot resume history.

### Authenticated owned-allocation reservation

`createJournaledNativeAllocation` is an internal opt-in composition of the actual
owned supervisor and canonical artifact store. A trusted parent supplies the
32-byte signing capability; authored configuration and model processes never
receive it. The parent's observer reserves a generation with artifact CAS before worker
launch. Reservation, closure observations and bounded references are governed by
`native_allocation_journal`, using the existing artifact backend and projection
rules. There is no additional shared coordination table.

The signed generation binds scope/model/instance, configuration and authorization,
original ceilings, owner token, actual owned result/tree-proof hashes, protected
checkpoint/closure bytes and observed response/storage accounting. Reads verify
the MAC and requested checkpoint's transitive native result evidence. Closed
means the allocation terminated with verified retained observations; it does not
mean a waiting workflow completed. Failed or uncertain allocations cannot start
another generation, and incomplete persistence retains reconciliation even when
the worker's observed result was completed. There is no PID/time takeover or
automatic retry. The journal is bounded to 32 generations, without truncation.

Later admitted generations must preserve original deadlines/ceilings and debit
known prior response/storage consumption. Unknown accounting blocks allocation.
This is not a new authority to extend a deadline after a human/external wait.
The deadline-extension contract and a common mixed-host scope remain required
L4 work. An explicit authenticated native-only resume is now composed as below;
ordinary start continues enforcing the existing pristine-start guard. Ordinary
CLI/console paths have not been switched to this internal composition. Historical
instance readers, unsigned snapshots and old scopes are not silently adopted.

The journal authenticates a trusted supervisor observation, not human identity,
business approval, anti-rollback storage or OS confinement. Offline production
composition with transport/controller doubles must remain separately labelled
from live native execution and exact installed-package qualification.

### Authenticated native allocation continuation

The private owned-worker protocol now supplies an ephemeral key capability to
the fixed, byte-pinned trusted Node worker over its existing bounded input pipe.
That worker already owns canonical persistence credentials. It uses the key to
verify the parent's exact reserved journal generation/owner, configuration,
authorization and initial canonical instance. It cannot obtain resume authority
from authored JSON. The key is absent from product state, prompts, native RPC,
model environments, evidence and result/closure outputs. This deliberately
extends the trusted application boundary to the fixed worker; OS key isolation
and live native qualification remain independent L7 evidence.

Explicit `resume: true` authenticates the previous closed owned allocation and
its native checkpoint, plus every later control event through the existing
signed inbox. Before allocation, current product/configuration/Git context must
still match those control requests, and required projections must be current.
Missing sources and waits allocate no worker or model. Fresh delivery verifies
the source and context; duplicate delivery repairs acknowledgement/projection
without asking the provider again or replaying business/native effects.

The native host retains its durable logical issuer identity, old accepted results
and contributions. Historical resources are evidence only: they are never observed
as live, selected for reuse, closed twice or given new work. Each new allocation
creates fresh sessions. Independent review receives historical writer identities
and lineage exclusions. New checkpoint and review output directories use a
generation namespace containing a dot, which cannot alias another process ID.
The same instance/model/reducer records new results and supplies exact replay.

This delivery supports native-only v2 graphs within retained original ceilings
and deadlines. It does not admit unknown/failed allocations, raw control facts,
unverified history, silently converted instances, mixed operation/native graphs
or a new deadline after a long wait. Ordinary CLI/console integration, the mixed
scope/dispatcher, real provider/human adapters and the full standard model remain
required deliveries.

### Internal common authority and mixed dispatch

The opt-in `standard-workflow-mixed-composition.mjs` now selects operation or
native ports from the common reducer's ready leaves. It introduces no business
routing or second workflow state. A new `standard-mixed.v1` scope binds canonical
project/persistence, model/source and signing identity. Historical operation and
native scopes are never adopted or converted.

`standard-process-authority.mjs` authenticates the entire retained instance:
signed operation previews/intents/receipts and human captures, signed control
checkpoints, and exact native history covered by the owned-allocation journal.
The common core exposes a validated prefix content hash for control checkpoints;
authentication does not replay every prefix through the reducer. Native worker
protocol v2 reconstructs this fixed authority from pinned inputs and the private
parent capability. Authored JSON cannot supply a scope, key or implementation.

Native slices stop before ready operations and use fresh sessions on resume.
The existing cooperative worktree effect owner covers their allocation as well
as actual mutating business ports. An active/unknown allocation cannot race an
operation or be retried by PID/elapsed time. Confirmed owned closure releases
the owner; unknown termination retains it. This adds no coordination table,
distributed ownership, deadline extension or implicit success.

Qualification uses a bootstrap IR on real disposable project application ports
with controller/native/provider doubles. It does not deliver the full standard
IR, missing business adapters, ordinary CLI/console selection, live native/PR
channels or exact installed-package A1–A10. Those remain explicit plan items.

### Typed diagnostic output before R05 completion

The internal execution configuration may explicitly map an activity to the fixed
`standard-drift-report.v1` output contract through `activity_outputs`. This mapping
requires the mixed authority, an activity role carrying `drift-check` and the exact
distributed skill bytes. It selects no authored schema or module. Existing
configurations retain their closed outcome/summary response; historical instance
formats and hashes do not change.

The trusted adapter observes canonical session/cycle, rule/baseline/snapshot
documents, Git status/diff and controlled product hash. It bounds the diagnostic
input and binds the native answer to its exact context hash. Reports retain
original/current objectives, level, findings, keep/discard and split/recovery
recommendations with observed evidence references. Invalid, incomplete, refused
or inconsistent output cannot become a completed report.

Only the configured product diff enters the diagnostic input. Other Git changes
are represented by hashes/counts, without their paths or contents; configured
private roots also deny diagnostic document delivery. Changes outside observed
product/governance scope set `drift_context_complete: false` and require recovery
review even when the scoped report says none. The complete standard model must
consume that flag. Post-transition diagnosis uses the actual cycle-closure
admission to select the unique terminal owner of a cycle/intermediate branch.
Missing/ambiguous ownership, incomplete usage evidence or contradictory active
anchors refuse selection; an open cycle without its active anchor is not guessed.
The retained context distinguishes session, active cycle and cycle completion,
including the selected cycle's canonical state and original brief objective.
It never falls back silently to an unrelated session goal. Fixed output schemas are validated before
native allocation. The trusted developer instructions scope this allocation to
diagnosis, leaving the skill's effectful/finalization steps to the application.

`drift_report_evaluate` consumes only accepted native output authenticated by the
owned checkpoint and its transitive evidence. It reobserves current canonical
context and verifies all reported references before issuing typed routing facts.
It needs no model call. Authenticated provenance and structural consistency do
not prove semantic truth. The report remains protected activity evidence,
subsumed under the process instance; the signed operation journal retains its
evaluation. No additional canonical workflow state or coordination table exists.

Evaluation explicitly leaves skill completion pending. R05 hook finalization,
human recovery/arbitration, authorized CR/parking-lot changes and DoR/work
admission remain separate ports. A clean report cannot acknowledge that hook,
and confirmed drift cannot authorize its own recovery writes. Native/provider
transport fixtures qualify this wiring only; live semantic/native and installed
standard-workflow qualification remain required.

### Canonical diagnostic retention and real R05 finalization

`drift_check_finalize` is an internal deterministic executor binding. It accepts
only an accepted evaluation's operation identity. The common authority verifies
its MAC, occurrence receipt, native producer and current diagnostic context.
Confirmed drift or partial coverage blocks before any business effect. A pure
preparation calls the actual gating application with event emission disabled;
scope, integrity, repair and unknown signals remain blockers. The age of the
check itself is the only signal that its eventual explicit completion can clear.

An exact signed preview and a live explicit grant precede effects. The existing
local owner serializes canonical report CAS/projection and the fixed real skill
hook. The report is immutable retained diagnostic evidence under
`workflows/drift-reports/<operation>.md`, not a second workflow state. Files/dual
require their applicable projection; db-only retains canonical data without a
visible report. The effective ignore policy must already cover this generated
evidence; the port never edits an installed client's ignore rules implicitly.

The hook receives an application-generated run identity through a restricted
internal argument. Completion requires its successful result and exactly one
matching newly appended drift-check event, with branch, mode, timestamp and byte
position retained in the signed receipt. Process revision, diagnostic context
and authorization are rechecked at effect boundaries. A later read reuses the
receipt rather than rerunning the hook. A partial effect, changed context or
missing observation retains reconciliation and ownership without automatic retry.

This completes the clean-report finalization component only. Human recovery,
the full standard model/input bindings, ordinary
entrypoints and offline/native/exact archive acceptance remain distinct work.

### Completion context preserves terminal state

`readStandardDriftContext` is an asynchronous application read. It calls the
existing closure admission and compares the selected canonical status, active
session/cycle anchors and observed Git branch. Completion requires a unique
terminal owner admitted by that port. It does not make a terminal cycle active
or change ordinary reload/implementation admission. The common authority awaits
the result before constructing a native input; evaluation and finalization
repeat the same selection rather than accepting caller-authored cycle context.
The signed evaluation exposes its context purpose and cycle state. A changed
brief or status invalidates an earlier diagnostic. No context is converted or
rewritten in historical instances.

Fixtures seed terminal status as an explicit starting precondition after real
bootstrap/mode/cycle-creation ports. They qualify subsequent context consumption,
native transport wiring, evaluation, hook and reducer replay only. They do not
prove the still-missing validation/terminal-transition ports, human recovery,
complete standard graph, real native isolation or exact archive execution.

### Declarative operation inputs

V2 models may explicitly opt into `process-data-bindings.v1` through
`data_bindings`. Every operation then declares its input fields; no caller step
may override them. Declared parameters live in `initial_parameters` inside the
instance hash. They are durable input data, never initial routing facts, user
approval or execution permission. Models without this opt-in retain their exact
historical shape and explicit-input API. No default member or conversion is
inserted into their records.

The resolver selects bounded literal/parameter values, completed occurrence or
operation identities, completed journal inputs/outputs and the current
multi-instance item. Paths are fixed key arrays; authored JSON cannot select
code, a file reader, an adapter or an executable transformation. Model validation
requires structured precedence and the same or an ancestor activation scope.
Iteration/item/call boundaries remain distinct. V1 refuses forward/cross-branch
dependencies, optional branch producers and implicit exports from a completed
call/collection/loop. Explicit exports and aggregation need a separate contract
if the complete standard model requires them.

The common host authenticates history before resolution and supplies its fixed
MAC-verified journal reader for source values. A pure reducer/fixture reader is
not an authentication authority. `process-resolved-input.v1` retains source
identities and hashes in the signed operation preview. Normalization is fixed by
the existing operation input contract; stage resolves again before accepting the
intent. Binding/model/instance hashes, business admissions, live grants and
result authentication still apply. Data selection makes no model call.

Parameters are preserved by native-start reconstruction, control-prefix checks
and simulation. Simulation still consumes an explicit offline event scenario;
it does not authenticate or execute effects. This mechanism supplies L3/L5
infrastructure. The complete standard model, mappings for the remaining ports and
ordinary CLI/console parameter entrypoints remain a separate integration task.

### Authenticated recovery review and findings

`drift_recovery_decision` prepares a complete, fresh confirmed diagnosis for
human review. The question binds the evaluation, context and fixed proposed
artifact changes. It offers change-request planning only for an active cycle,
plus new-cycle planning and scope rollback, and keeps refused/deferred/cancelled
outcomes distinct. A chosen option is an intent to recover, not proof of the
recovery effect. The decision source and inbox use their own closed contracts;
new recovery captures write inbox v2 while historical mode captures remain v1.
Neither source is converted or inferred from model text.

`drift_recovery_record` requires the accepted authenticated choice, a fresh
preview and live explicit write grant. It appends confirmed findings and the
recovery proposal to canonical parking-lot and updates only the current-state
next-action summary/date. The proposal carries bounded text chunks, before/after
hashes and append/replace intent; it does not duplicate complete SPEC/context
documents in the human question. Existing string limits stay unchanged. Full
context/evaluation hashes and trusted re-observation bind those references.

The fixed writer owns exactly these two paths. A private boundary fingerprint
checks all other observed canonical context, Git changes outside these paths,
and their unchanged index images. Exact consented post-images are checked after
CAS/projection. The receipt retains the causal before/after context and file
hashes. Existing canonical classification/linkage is preserved; the locked CAS
also binds its metadata preimage and the receipt retains the observed after
metadata hash. Concurrent changes or partial effects retain uncertainty and the local
owner. Missing/declined consent never writes findings. Parking-lot is included
in subsequent diagnostic evidence, so these known governance writes do not
become unexplained product-scope changes.

Required projection targets pass the existing physical-path/regular-file guard
before preparation; their actual bytes must match the canonical post-images
after projection. DB-only does not require or adopt a visible projection. An
unconfirmed dual projection is an unknown effect, not a confirmed write.

Every new evaluation clears the reducer's earlier R05-completed fact; historical
events and actual earlier hook receipts are preserved. Recording still reports
recovery required, R05 incomplete and recovery execution pending. Actual CR/
requirements changes, cycle choice/creation, authorized rollback, fresh native
re-evaluation and eventual checkpoint remain separately required. This tranche
does not finish the standard graph or its ordinary entry integration.

The generic mixed step can prepare a fresh intent for a blocked/deferred
operation when explicitly invoked with write intent; preview stays read-only.
It never retries an unknown effect or turns the earlier non-success into a
success. The same reducer still owns the occurrence and attempt identity.

### Admitted change-request continuation

The fixed `drift_change_request_record` port consumes the latest confirmed
findings receipt for an authenticated `requirements_delta` recovery choice.
The host verifies the retained evaluation/decision/record chain; it does not
re-query a vanished human source or treat replay as result authentication.
Current canonical context must equal that receipt's post-context. Real
pre-write and requirements-delta ownership admissions must still permit the
active COMMITTING session/cycle before preparing or executing effects.

This operation creates the CR proposed by SPEC-R05 and the drift-check skill;
it does not implement the whole requirements-delta skill. The fixed footprint
is the owning cycle's `change-requests.md` append plus CURRENT-STATE next-action
summary/date. No authored JSON selects a path, impact override, text edit,
requirements mapping or scope-acceptance decision. The diagnostic supplies the
impact and traceable findings; the CR decision remains pending. Medium/high
impact retains the obligation to create an admitted cycle before scope acceptance.

The common signed journal retains exact previews and live grants. The writer
uses the canonical content/metadata CAS and checks required physical projections,
post-images, process revision and outside-context/Git boundary. Unknown effects
retain ownership and cannot be retried automatically. Creating a CR emits only
its own completion fact; recovery remains required and R05 incomplete. No
historical format or standard-model completeness claim changes.

Requirements-delta admission now awaits the existing canonical continuity
service, as branch audit already does. DB-backed active session/cycle anchors,
ownership and CR impact come from that snapshot; unavailable or ambiguous
canonical state stops admission. A stale visible current-state file cannot
replace the canonical anchors. The existing hook awaits this admission before
deciding whether to checkpoint. Public JSON/effect classes and medium/high
impact ownership arbitration remain unchanged.

### Recovery cycle continuation and external Git checkpoint

Three fixed deterministic bindings continue an accepted `new_cycle` finding,
or an accepted CR whose impact requires a new cycle. The mixed host verifies the
latest evaluation/decision/findings chain, then the CR when applicable, then
each accepted continuation receipt. A caller cannot substitute another
operation identity, session, objective, branch source or executable adapter.

`drift_recovery_context_refresh` reuses the existing canonical runtime projector.
It records the verified causal context transition and a bounded fingerprint of
the current document/product state and changed physical files. Runtime evidence
and available owned cycle documents enter subsequent drift context; absent
optional documents are not silently materialized or made into a new admission.

`drift_recovery_checkpoint_observe` is read-only. The existing cycle-create
clean-worktree rule is preserved. A dirty tree produces a blocked receipt and
durable wait. After an external actor reconciles Git, an explicit retry creates
a new intent. The observer verifies unchanged approved document/product state,
fast-forward ancestry, bounded history, changed-path scope and exact committed
file bytes. It performs no add, commit, reset or scope-approval effect. A clean
DB-only tree can pass without an extra commit. This Git observation is distinct
from the later R05 skill checkpoint.

`drift_recovery_cycle_initialize` consumes the accepted checkpoint receipt.
Cycle identity/type/title are explicit model data reviewed in its grant; the
session and revised objective come from the authenticated source, while actual
continuity admissions choose the allowed base/rule. Existing cycle-create
application ports execute the branch/scaffold and preserve older cycles. Fresh
write authorization and source/process checks run under the local effect owner.
The post-effect guard checks the exact cycle, goal, branch, HEAD, document
post-images and outside-context/Git boundary before confirmation or owner release.

New cycle/context previews use explicit private plan v2 schemas with metadata
preimages; the old v1 schemas and historical records remain unchanged. The shared
cycle ports now preserve canonical classification/linkage, use content/metadata
CAS and verify required physical projections. A missing projection or failed
post-effect observation retains uncertainty and ownership. Creation emits only
its own fact with DoR false and R05 incomplete. Requirements mapping, other
recovery actions, fresh native diagnosis and the R05 hook remain separately
required; this component is not the complete standard workflow.

### Cycle skill checkpoint and conditional R05 admission

`cycle_checkpoint_finalize` is a fixed deterministic binding to the actual
cycle-create hook/checkpoint. Its read-only preview checks canonical session and
cycle ownership, branch audit, document/metadata preimages, required projections
and the current gating service. A required R05 check, incident or stopped reload
leaves an explicit blocked operation before hook effects. Retrying uses a fresh
intent after external resolution; a blocked receipt is never reused as success.

The session mode and originally admitted continuity rule remain unchanged. The
performance hook uses COMMITTING as prescribed by skill step 9 and its route;
the preview uses the same hook mode for both continuity and R05 admission. This
does not admit creation of another cycle or permit R1 creation in EXPLORING.
The effect runs under the local owner with a fresh grant/process check. The host
supplies a dedicated run ID to the existing cycle hook; confirmation requires
the nested checkpoint and gate, a fresh correlated appended checkpoint event,
unchanged canonical business documents and current process authority. An `ok`
wrapper with a conditional R05 warning does not satisfy this contract. Failure
after invocation retains unknown effects and ownership without another dispatch.
The catalog continues to distinguish this component from cycle readying and the
complete standard graph, its native human/provider and installed-archive proofs.

### Typed cycle planning before readiness

The explicit `standard-cycle-plan-proposal.v1` native output uses the existing
closed answer envelope, owned allocation history and immutable native evidence.
It binds canonical context, cycle/session/type/goal, scoped tasks and product
paths, planned REQ/test traceability, risks, usage classes and adaptive R04
planning. It cannot carry a permission, DoR success or executable adapter.
The native activity must pin the cycle-create skill and a read-only product
policy. The component uses branch-audit admission plus strict canonical open,
unfrozen, NOT_READY ownership checks. Reapplying the full cycle-create clean-Git
guard after scaffold creation is not an admission for this read-only proposal.
The actual new-cycle rule is unchanged.

`cycle_plan_evaluate` authenticates the accepted native occurrence and its exact
current context/evidence. `cycle_plan_record` accepts only that evaluation's
identity; IR data mappings resolve both identities. Its reviewed plan writes
only brief, plan, audit specification, planned traceability, cycle status usage
declarations and the current first task. The local owner binds document/metadata
preimages, fresh authorization and process identity, unchanged outside context,
exact post-images and required projections. Partial or unconfirmed effects
remain unknown with ownership retained, never automatically replayed.

Planned tests are not executed evidence. The only completion fact is planning
recorded; DoR and OPEN-to-IMPLEMENTING with frozen scope require their own ports.
The current native configuration bounds admitted product files; deriving a new
dynamic work scope and ordinary standard entry points remains separate work.
Qualification IRs using this component do not replace the complete standard
model/catalog or native/provider and exact installed-archive qualification.

### Deterministic readiness and explicit implementation phase

`cycle_readiness_evaluate` implements the start-session Core DoR component from
SPEC-R04 against an authenticated, accepted `cycle_plan_record`, its evaluation
and native producer, and the current canonical planning documents. It invokes
the actual branch-cycle admission and evaluates intent, first implementation
task, constraints/risks, adaptive depth and planned cross-usage coverage. A
shared/high-risk matrix needs the nominal, alternate and context classes stated
in SPEC-R04's minimum structure; an incomplete recorded proposal stays blocked.
No model call or canonical readiness write is needed for this evaluation.

`cycle_implementation_enter` consumes the accepted evaluation through IR data
mapping. An explicit reviewed grant authorizes exactly the cycle status and
CURRENT-STATE transition: OPEN/NOT_READY/unfrozen becomes
IMPLEMENTING/READY/frozen. Canonical content and metadata preimages, actual
projections, the process identity and the unchanged surrounding context are
checked under the existing local effect owner. Partial writes and unconfirmed
projections retain ownership and require reconciliation. A retained receipt
prevents an implicit repeat after restart.

The frozen plan remains unchanged. Every subsequent native product modification
still requires its own specific admission against that task's exact file
operations. Readiness is neither test execution nor cycle completion, and this
component does not supply the remaining ordinary workflow graph, dynamic scope,
closure/PR ports or full native/installed qualification.

This component currently targets the directly owned cycle branch in COMMITTING,
without a DoR override. Intermediate/session integration and explicit override
paths remain separate obligations of the complete standard workflow; refusing
them here is not evidence that those required paths are delivered.

### Frozen task input and native work observation

`process-data-bindings.v2` and `process-resolved-input.v2` explicitly extend data
links to activity inputs. Version 1 retains operation-only semantics and its
fingerprints. The standard work activity links to the accepted
`cycle_implementation_enter` operation in its IR, rather than selecting an
operation identity from a prompt. The registered work output requires an
executor/implement role, a writable product policy, and that exact ordered link.
It requires no fabricated lifecycle skill on the coding role.

The trusted host authenticates phase, readiness, recorded plan and native
producer. It requires the exact canonical post-phase context and a fresh
admission before supplying the frozen first task. Only update/add/delete within
the configured product inventory are currently supported. An authenticated
context reference and host-observed before/after product snapshots accompany
the correlated native result. The worker's reservation is a private IPC
capability verified against the signed allocation journal, not authored JSON.

`cycle_work_evaluate` consumes that native occurrence through IR data links. It
checks the unchanged surrounding canonical context, Git head/index and files
outside the task, the current product digest, actual changed paths/operations
and agreement with the typed report. It emits only work-observed and
validation-required facts. It neither runs tests nor marks the cycle verified.
Observation does not authenticate the identity of a per-file writer. A refused
confirmation retains any product changes already observed; it performs no
implicit rollback. Durable result dispatch and common-reducer simulation remain
separate from full workflow, real native/provider and installed qualification.

Subsequent deterministic validation must use trusted, pinned check descriptors
and the existing qualified execution/snapshot ports. Free-form test methods in
a native plan never select executable commands. The full model still needs
validation, task advancement, review, closure and exception routes.

### Deterministic validation of observed code

`cycle_validation_execute` consumes the accepted `cycle_work_evaluate` identity
from IR data links. The actual source authority authenticates the signed
operation and native evidence, then rechecks current product, canonical context
and scope. The host supplies an approved, pinned private validation profile;
the first task's test references select only checks registered in that profile.
Free-form methods cannot select commands, modules or a different host adapter.

The port copies the exact configured product inventory and pinned check scripts
to a separate snapshot. It invokes the existing qualified Codex sandbox boundary
with a pinned runner, explicit arguments/environment, a total deadline and
bounded output. No model is called. The existing verification verdict parser
requires the exact check identifier and typed protocol; exit zero alone is
insufficient. The snapshot and authenticated source must remain unchanged.

Inventory file/byte limits apply to product files. Pinned verifier scripts have
a separate fixed bound of 64 scripts with at most 1 MiB each; snapshot inventory
accounts for both sets. The execution budget begins after authorized preflight,
whose prepared plan separately expires after five minutes.

The selected boundary retains its existing assurance limits. Cooperative
qualification does not guarantee read isolation, and its v4 profile also does
not guarantee network isolation. `proof_class: native` identifies qualified
execution evidence; it does not strengthen the selected assurance profile.

The signed operation result binds check statuses, profile/product fingerprints
and the digest of an evidence manifest containing logs and before/after
inventories. Successful execution is distinct from passing verification:
`failed` and `unavailable` never set `cycle_validation_passed` to true. Uncertain
termination, deadline or postconditions preserve the effect owner and require
reconciliation; the durable dispatcher does not repeat an existing effect.

An out-of-band fixture boundary can execute controlled local Node checks; it
always records `proof_class: fixture`. It cannot establish native sandbox
qualification or provider identity. The complete standard model still needs
validation routing, task progression, validation-phase/lifecycle transitions,
closure and the full native and installed-archive acceptance parcours.

### Evidence consumption and verification entry

`cycle_validation_evaluate` authenticates an accepted validation operation and
its current work source. Its reader uses the pinned host profile, exact prepared
plan, bounded evidence manifest, stdout/stderr digests and before/after snapshot
inventories. It recomputes the check protocol and refuses changed, missing or
foreign evidence. A fixture capability remains fixture evidence; ordinary host
composition requires the native boundary. Reading evidence never launches a
verifier or calls a model.

Task coverage comes from accepted signed work evaluations for the same frozen
implementation scope and exact recorded tasks. One observed task does not
complete a plan containing another task. Current checks retain their exact
product fingerprint; missing or unsuccessful planned tests remain pending.
This records observations without declaring requirements, usage convergence,
gaps, change requests or design decisions reviewed.

The separately authorized `cycle_verification_enter` consumes the fresh accepted
evaluation and requires all recorded task work to be observed. It invokes the
actual cycle-close pre-write admission and uses metadata-preserving canonical
CAS for cycle status, traceability, context snapshot and current entry point.
The phase becomes VERIFYING; scope remains frozen and outstanding audit/checks
and explicit closure remain visible. It neither marks DONE nor completes the
cycle-close skill or its required checkpoint hook. Partial writes or unconfirmed
projections retain the effect owner and signed reconciliation state, without
rollback or repeat dispatch. These ports remain components of the full standard
model and its remaining multi-task selection, audit and closure routes.


### Selected task progression and final evidence

The standard mixed host adds deterministic `cycle_task_select`,
`cycle_task_work_evaluate` and explicitly authorized `cycle_task_advance` ports.
Selection derives an ordered cursor from the frozen typed proposal and accepted
signed progress/work/validation receipts. It checks the selection-context chain,
predecessor, ordinal, exact task, scope and current canonical context. The JSON
IR can place this sequence in the existing common loop reducer; no new reducer
or model call selects or advances a task.

A distinct `standard-cycle-task-work-report.v1` binds its selected task identity.
An explicit unchanged result requires a reason and zero observed file changes;
it still requires host validation. The historical first-task report/context
remain separate. Only a versioned progress marker opts canonical plan parsing
into checked-task handling, preserving historical literal task text.

Advancement requires the current task's tests passed, fresh authenticated
observed work, actual start-session admission and a current explicit effect
grant. It writes exactly plan/status/CURRENT-STATE through metadata-preserving
CAS. The ordered task list gains checked markers and a progress record; the
frozen scope JSON remains unchanged. Partial writes or missing projections
retain unknown effects and their owner instead of authorizing another task.

The final task runs all planned cycle tests against the final product snapshot.
Earlier intermediate checks cannot satisfy final coverage. Validation-evaluation
input v2 optionally names the accepted progress operation to bridge only its
owned canonical metadata changes. The host authenticates the whole causal
chain, exact current context, unchanged code and pinned physical evidence.
The v1 schema remains retained; historical instances receive no conversion.
The final evaluator feeds the existing VERIFYING transition. Task progression
is not audit acceptance, DONE, full skill completion or the complete standard
workflow. The full distributed graph and A1–A10/native/installed acceptance
obligations remain outstanding. Qualification status belongs in the plan.


## Read-only final audit component

An accepted VERIFYING transition supplies a causal bridge to its final physical
checks and observed work. Fixed read-only selection/evaluation ports authenticate
that chain and the native audit proposal; they do not rerun checks or infer human
consent. Full canonical inventory is required to infer conditional document
absence. Its audit fingerprint covers required documents and the owning cycle
namespace, allowing unrelated journal receipts to be retained durably. Ordered
lossless document chunks preserve the shared JSON scalar and total bounds.

Audit observations preserve uncovered requirements/usages, uncertain documents,
failed/unavailable checks and blocking/risk findings. Even a favorable audit
leaves cycle-close pending. Human choice, risk acceptance, canonical closure and
the final hook must be implemented and qualified separately. This component does
not supply the complete distributed standard model or its ordinary entrypoints.


## Human cycle closure review

A dedicated human binding consumes an accepted audit identity. Fixed host ports
reauthenticate the audit and reread its code, canonical material and machine
evidence before preparing the exact question. The review carries actual finding
rationales and evidence, immutable source hashes and offered dispositions.
Question validation cannot authenticate a source; the host's external human
authority must verify it. The v3 decision inbox retains the dedicated typed claim
and preserves v1 mode/v2 recovery readers without conversion.

A retained disposition requires complete observed coverage and an explicit,
justified acceptance for every residual risk. Non-retained dispositions, refusal,
deferral and cancellation remain distinct. A completed decision is not completed
cycle-close: actual canonical writes, fresh effect authorization, final hook and
its nested failures remain separate required work. Qualification of this human
component must not be reported as full standard workflow integration.


## Canonical baseline promotion prerequisite

The standard promotion port must consume the existing promotion admission,
whose current focus, cycle identity and trace/gap/usage evidence come from one
fresh canonical snapshot in DB-backed or configured PostgreSQL mode. Unavailable
or inconsistent authority stops without a Markdown fallback. A trusted internal
caller may explicitly select a canonical cycle without rewriting CURRENT-STATE;
selection is neither human authentication nor effect permission. The public CLI
adds no selection flag in this tranche. Refusal also suppresses post-hook import
so stale visible files cannot replace the evidence that prevented promotion.

This prerequisite does not implement the standard promotion decision, actual
baseline/current/history/snapshot writes, final checkpoint, or full IR routing.
Those effects still require an accepted completed cycle-close, explicit user
selection/version, fresh admission and authorization, durable receipts and
postconditions. Native and installed-archive qualification remain separate.

### Promotion admission after completed cycle closure

The promote-baseline skill keeps the real pre-write admission. Its cycle is a
selected DONE target, not an implementation focus: closure may already have
released active_cycle, and implementation DoR is not re-entered by promotion.
The pre-write port now calls the existing canonical promotion admission and
reports baseline_promotion_target in its checks. Selection, DONE, traceability,
closed gaps and usage evidence remain required. Missing or ambiguous targets
block; the internal promotionCycleId argument selects without changing focus
and is not a public CLI flag or an authorization. Usage checks concern that
target even if another cycle has become active. Activation, source-of-truth,
shared-runtime, repair and freshness checks remain in force.

This resolves the observed refusal of a post-closure promotion by the three
implementation-focus checks. It does not waive pre-write, mark the cycle active,
perform baseline writes or complete the standard workflow. The dedicated
read-only files/dual/db-only cases and existing wrapper/canonical cases are
run by the required promotion admission suite. No native or installed-package
proof follows from these checks.

### Baseline recording library and host-binding qualification

The private standard-baseline-promotion factory prepares five canonical documents
from a typed request and a completed retained cycle-close. Mandatory trusted host
capabilities must authenticate the accepted request/close and read current product
and process state; successful typed flags alone are not proof. The request-binding tranche below wires those host readers and the authenticated
human inbox. Their use from an actually executed common closure remains unqualified.

One actual selected-target pre-write admission runs per context observation.
Explicit intent, exact plan, fresh source/product and metadata CAS are required.
Permission is checked before fresh preparation, immediately before effects and
after postconditions. The original300000ms deadline is checked after the final
grant before the first write. History is append-only. The bounded version profile
vM.m or vM.m.p with optional prerelease identifiers must increase numerically,
then by prerelease order. Duplicate history/version/cycle and stale approved
baseline material refuse without automatic conversion.

Confirmed writes record baseline, history, snapshot, index and current next
action. They emit baseline_recorded true and promotion completion false; the
actual final hook is pending. Unknown/partial effects, lost projections or
post-effect revocation retain ownership and no completion facts. Physical store
fixtures use actual source installation and fixture human/close authorities.
The initial library proof does not establish the later fixed IR bindings, full
workflow, native execution or exact installed-archive behavior. The binding
tranche and its remaining common-cursor acceptance are described below.

### Remote PR observation prerequisite

SPEC-R08 triage needs remote facts, not only local session PR status. The private
GitHub adapter observes one host-selected repository/PR at an expected head via
fixed read-only GraphQL queries and a host-pinned GitHub CLI executable. IR data
cannot supply queries, executable modules, credentials or result authentication.
Thread and nested-comment pagination is complete within explicit size/request/
time bounds; overflow, duplicates, partial API errors and identity/head drift
refuse the observation. Outdated remains distinct from resolved.

The digest covers normalized remote content and remains stable across polling
time and provider page order. Observation timestamps and request counts remain
separate. Rechecking PR metadata/head does not create an atomic API snapshot or
merge permission. The future host must bind and authenticate delivery to its
waiting occurrence, compare current head/content with accepted triage and require
an explicit merge decision. None of that is supplied by successful typed flags.

GitHub owns the remote facts; local session fields remain workflow metadata.
The observation is ephemeral, with future retained deliveries covered by the
existing process control inbox. Actual source/non-primary public API reads and
fixture pagination/refusal checks qualify this adapter prerequisite. The durable
PR wait, triage/binding and full standard IR remain to be connected. Native and
exact installed-archive acceptance remain separate.

API references: [GitHub CLI API](https://cli.github.com/manual/gh_api) and
[GitHub pull-request GraphQL objects](https://docs.github.com/en/graphql/reference/pulls).

### Terminal metadata recording component

`cycle_close_record` is a separate deterministic, explicitly authorized mutation
for the COMMITTING/VERIFYING component. Its fixed host reader authenticates the
latest accepted human disposition and rereads current audit/check evidence. The
accepted signed inbox proof remains the human provenance; provider disappearance
after acceptance is not a new decision. Fresh write permission is separate.

The writer prepares exactly six canonical preimages: owning cycle status,
traceability, audit-spec and decisions, plus context-snapshot and CURRENT-STATE.
CAS preserves artifact classification metadata and the frozen plan. Partial
writes, lost required projections and uncertain postconditions retain the effect
owner and emit reconciliation with no success facts. Only confirmed postimages
record terminal metadata; `cycle_close_completed` remains false and both hook
and skill completion remain pending.

Component fixtures use real source installation, admissions, Git, canonical
CAS and projections, with an explicit fixture audit/decision authority. The files mixed-host case passed on its exact61/59 snapshot; current-source
DB-only qualification on explicit62/60 pins passed on its frozen snapshot. The full standard route for the actual final hook and conditional drift retry,
earlier-phase exits and other mode paths remains required. This component does not deliver the full standard workflow graph.


The terminal metadata effect checks its grant before rebuilding one fresh
closure plan. That post-grant observation authenticates the decision and audit,
checks admission, canonical context, metadata and projections, and must match
the signed original plan. Repeating a complete audit before the same grant is
not an additional authority. No verdict is cached across calls. The original
300000ms preview deadline is rechecked after all preconditions immediately
before the first canonical write; expiry refuses without business effects.

### Final closure checkpoint component

The fixed finalizer runs the actual cycle-close hook with its supported run
identity, explicit authorization, canonical terminal admission and fresh gating.
The wrapper forwards this identity without adding a new public flag. A wrapper
success alone is insufficient: the nested checkpoint, non-skipped gate and exact
checkpoint-summary event must agree.

The terminal recorder captures a bounded reviewed Git-checkpoint manifest using
the existing drift-recovery protocol. An explicit external commit may advance
HEAD only when canonical material, reviewed physical/commit bytes, branch and
allowed changed paths agree with that immutable state. A clean checkout cannot
conceal an unrelated committed path. This observation neither authors a commit
nor re-signs the original closure record. Missing cache, scope growth or R05
requirements remain visible; fixture preparation uses actual Git, reload and
explicit drift completion, not forced gate success.

Only a confirmed actual checkpoint permits the finalizer to update status,
snapshot and current next action. These three CAS writes preserve metadata;
completion facts follow their confirmed postimages. A lost checkpoint event,
revoked suffix authorization, partial canonical suffix or required projection
loss retains ownership, uncertainty and empty success facts. A repeated raw
apply must not execute the checkpoint again.

This is a component protocol under qualification. A fixed common-host binding
and trusted reader now authenticate the latest accepted terminal, human, audit
and physical validation evidence. Their real mixed-host consumption remains to
qualify. Complete standard IR gate/checkpoint/R05/retry routing and actual
native/archive qualification remain required. Earlier-phase exits and
other mode paths are not supplied by this COMMITTING component.


The private finalizer contract preserves a blocked/no-effect preflight result
with empty success facts. Closed gating must remain a durable engine wait,
never a success or a malformed dispatch result. An eventual retry prepares a
new authenticated intent after actual external preconditions; it cannot reuse
a previous effect authorization. Completion document timestamps derive from
the confirmed checkpoint event, keeping their rendering deterministic.

Current actual-hook components pass on files, dual and DB-only, including
non-retained outcomes and uncertain event/suffix/projection/post-grant cases.
The authenticated common-host prefix and retained cold continuation are tied
to their exact earlier snapshot; current component/source checks are separate.
The full standard graph must model Git checkpoint, reload and R05 explicitly.
Interrupted suffix reconciliation, ordinary entrypoints, native and exact
installed-archive acceptance remain required.

### Promotion request bindings under qualification

The fixed human baseline_promotion_decision binding reviews an accepted DONE
cycle-close, current product, canonical baseline/history and actual selected-target
admission. An approved version/summary belongs to the authenticated human source,
not process JSON. not_requested records only a decision and never a baseline
completion, policy waiver or session-close permission. Refusal, deferral and
cancellation retain their distinct outcomes and no success facts.

New decisions use inbox v4. Readers retain v1-v3 without conversion. The signed
capture survives provider disappearance after acceptance; the effect still needs
fresh independent permission and preconditions. A durable wait has no artificial
five-minute decision expiry when its reviewed context remains unchanged.

The private source reader consumes the fixed host's accepted signed journals,
then rechecks original physical validation and the correlated checkpoint event.
The baseline writer now has a fixed binding and shares its canonical observation
with the review. Unknown owners block new review; no second admission algorithm
or model call supplies deterministic/human behavior. Current component tests do
not prove the full common-host closure-to-promotion path. Its execution, replay,
simulation, common routing of the final promotion hook, full standard graph and native/archive proofs
remain required. No integration completion follows from the new registry entries.

### Final promotion checkpoint component

The deterministic baseline_promotion_finalize binding consumes the accepted signed
baseline record and its authenticated human/close material. It shares the real
selected-target admission/checkpoint application port with the ordinary wrapper;
process data supplies only a record identity. Target and completion-cycle scope
must agree. A fresh effect grant, unchanged product/target/spec/classification,
exact recorded postimages and open R05 gates precede the actual checkpoint.

The record retains a completion boundary witness. The final checkpoint may
refresh derived RUNTIME-STATE; it does not gain permission to change the owning
cycle, normative authorities, product, active focus or baseline postimages.
Current artifact reads and required projections stay canonical. Completed output
requires a unique correlated physical checkpoint event and five metadata-preserving
completion CAS. The completion renderer preflights its bounds before effects.

History is append-only, including its pending entry; confirmation is a separate
append. Only confirmed actual checkpoint and postimages emit completed promotion.
Partial metadata, lost event/projection or post-effect grant loss retain ownership
and empty success facts. They cannot trigger another checkpoint. Reconciliation,
full standard IR wait/retry routes and common/native/archive qualification remain
separate acceptance work. First actual files component passed on its exact
prototype snapshot. All seven current source-installed mode/fault cases passed
on their frozen65/63 snapshot. These component authorities do not qualify the
full authenticated common-cursor chain or distributed standard model.


## Addendum: explicitly partial common standard composition

The versioned [standard IR](../../package/catalogs/process-models/aidn-standard.v1.json)
is loaded through `standard-workflow-composition.mjs`, using the existing
operation host and common reducer. Its `standard-workflow-catalog.v1` pins the
actual operation identities and the SPEC/skill bytes. Native activity rows
also declare their typed output contracts; the standard process authority
rejects missing, changed or extra native output mappings. The catalog is a
closed partial-component contract and cannot label this revision as the
complete standard workflow. Ordinary entrypoints are not redirected to it.

IR v2 permits an empty structural sequence for an explicitly selected optional
branch. It produces no business receipt, fact, resource allocation or model
call. Other structured nodes retain nonempty children, and v1 retains the
previous restriction. Unknown routing facts still wait; explicit refusal,
defer/cancel and unresolved-effect semantics are unchanged. No XML is required.

The source graph currently composes startup and one new COMMITTING cycle through
its task loop, validation, audit, closure and optional promotion. Structural
loading and a startup-prefix exercise are different from qualifying this whole
business path. R05 and incident routing, existing work/resume, THINKING/EXPLORING
work, session closure, PR review/merge, post-merge synchronization and ordinary
mixed resume remain open in the [plan](../PLAN_STANDARD_WORKFLOW_PROCESS_IR_2026-11-01.md).
Native and exact installed-archive proofs remain mandatory for final acceptance.


## Addendum: startup R05 ordering and governed Git checkpoint gap

The composed standard model now branches on authenticated mode facts before
its startup checkpoint. COMMITTING runs a typed native R05 diagnostic, its
application evaluation and the existing real finalizer. The macro remains
subject to its actual gate and strict observed postconditions; a gate warning
is not a successful finalization. THINKING/EXPLORING require no diagnostic model
call on this branch. Cycle/closure/promotion R05 nodes are also declared, with
their integrated business qualification still outstanding.

The internal `createStandardWorkflowExecution` composes the published model
through the common mixed host and its source authority. The operation code
fingerprint now includes the composed loader and its catalog schema. Native
output mappings remain exact, and the closed catalog still requires partial
scope. No ordinary workflow entrypoint is switched to this partial model.

Real-port probes identified a required governed Git checkpoint before cycle
creation. The [plan](../PLAN_STANDARD_WORKFLOW_PROCESS_IR_2026-11-01.md) adds this
as an explicit missing L2 deliverable. Its future host-derived scope and effect
authorization must preserve Git admission, canonical/projection distinctions,
result authentication and durable no-repeat recovery. Existing run-owned Git
resources must not be relabeled as project-owned resources. Probe failures,
the bounded fake-wire success, native evidence and installed-archive evidence
are kept distinct in the recorded qualification; full standard acceptance
remains open.


## Addendum: fixed session metadata Git checkpoint

`session_git_checkpoint` is a deterministic, explicitly authorized operation
between cycle-context refresh and cycle admission. Its input identifies an
accepted refresh, not Git commands or paths. The host authenticates that refresh
and startup result in the same instance, then binds CURRENT-STATE, RUNTIME-STATE
and the owning session to their canonical postimages. Only present dirty
projections matching those postimages may enter the Git plan; no DB-only export
or canonical-source substitution is performed.

The local port writes Git objects and the approved session ref with expected
parent CAS. A private index builds the exact metadata tree; the worktree index
is replaced under an owned Git index lock after ref/postimage checks. This
bounded plumbing operation does not invoke repository hooks, filters, a shell,
or a remote action. It preserves repository configuration and honors configured
commit signing. This contract is distinct from a general-purpose `git commit`
or the separate run-owned integration/worktree port.

Foreign changes/index/locks, changed postimages or lost authorization refuse or
retain uncertainty. An observed commit whose index has not been reconciled is
reported as `commit_observed`, not a confirmed checkpoint. Retained dispatch
must not create another commit. The recorded files prefix now qualifies actual
startup/cycle admission and checkpoints up to `plan` with a fake native wire,
including exact replay/simulation. A cold resumed divergent-objective case
retains WAITING without repeating prior effects. Full crash/index reconciliation,
the rest of the standard route, the native host and installed archive remain
open; the prefix does not qualify them.


## Addendum: captured terminal Git scope and streamed simulation

The standard component inserts deterministic `cycle_terminal_checkpoint` after
the authenticated terminal writer and before closure R05/final hook. Its input
identifies the accepted record. The host derives a closed finite set of physical
postimages from that record, reobserves terminal ownership/admission, Git parent,
index and files after the explicit grant, and invokes the bounded local port.
The terminal profile requires trusted approved paths, honors literal path names
and existing tracked modes, and does not widen the default session metadata
profile. Completion reload uses the real terminal-cycle path. Canonical DB state
is not replaced with visible Markdown and no DB-only export is introduced.

The original terminal writer already performs pre-write admission before its
first write. This continuation uses the existing specialized terminal admission,
as the final hook does; it does not reactivate a cycle to satisfy an unrelated
active-cycle gate. The generic admission policy remains unchanged. The checkpoint
leaves `cycle_close_completed` false until the actual final hook confirms.
Promotion eligibility derives from the authenticated retained outcome; non-retained
states do not require a promotion question or invent baseline success.

Known effects dominate later no-effect errors: if Git confirmed before a grant
or cache failure, the combined operation retains unknown, no success facts and
its owner. Recovery of that uncertainty remains a separate explicit deliverable.
Real port and component checks cover the bounded scope and this error boundary.
Full model, native and installed-archive proofs are distinct from those checks.

A composed execution reached the final cycle-close hook after deferred human
choice and a new process, then its aggregate synthetic trace exceeded 4 MiB.
The internal `iterateAgenticProcessSimulation` API now provides immutable trace
rows through the same reducer with the same 512-event limit and a 4 MiB bound per
snapshot; discarding rows bounds trace retention. It snapshots validated caller
input before yielding. The aggregate v1 API and JSON shape keep their existing
4 MiB total refusal. This introduces no model executor, time source, persistence
or write authority. Streamed replay of the retained 86-event case reproduced its
exact instance hash without business dispatch. Public CLI streaming, all standard
paths, uncertainty reconciliation and long-wait reauthorization remain open.


The corrected revision-15 files run passes through actual cycle-close completion
after explicit human deferral and cold process restart. It preserves prior journal
bytes/event prefix and reproduces the final hash with 87 streamed snapshots.
It stops before promotion admission, with a partial component and workflow RUNNING.
Both process exits and owned cleanup completed. Native/grant/human/boundary
capabilities remain fixtures; no real-native or installed-archive claim follows.


## Addendum: canonical planned traceability matrix

The standard plan renderer now emits planned REQ/TEST table links derived from
its validated requirement and test references. Existing canonical promotion
admission requires those matrix headers. The earlier lists and JSON verification
sections preserved evidence but did not satisfy that reader. The admission is
unchanged; the table keeps `planned` and the explicit absence of execution or
acceptance at planning time. Verification, independent audit, human retention and
confirmed final hooks remain distinct later evidence. No requirement is invented
for a spike lacking production REQs. Historical records are not rewritten.

A producer-to-admission fixture uses a real disposable Git root and the actual
read-only promotion use case to test this representation boundary. It keeps the
unsupported lists and requirement-free spike refusals. Its DONE state is fixture
setup, not a cycle execution or composed promotion qualification. The native and
installed-archive evidence and promotion Git/reload path remain open.


## Addendum: terminal schema identifier consistency

Terminal checkpoint input, plan and output metadata now name their own existing
contract identifiers, including the inline plan input. Earlier copied descriptive
labels named session/closure contracts despite correct terminal `$id` and value
constraints. Payload shapes and validators are unchanged; historical payloads
remain readable. The contract fixtures now compare these identifiers explicitly.
The reviewed binding refresh records new source revisions rather than silently
repairing stored process instances. This metadata correction is separate from
business-path, real-native and installed-archive qualification.
