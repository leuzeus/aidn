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
