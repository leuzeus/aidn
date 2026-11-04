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

The composed offline fixture preflights its versioned deterministic scenario
through this same model and reducer before fixture creation and initial
authorization. Its response allowance counts selected native occurrences,
including task loops and optional promotion, across the cold prefix and
continuation. Synthetic planning is not an authorization or an execution proof.
This fixture check changes neither production limits nor an existing trial's
original cumulative ceiling, deadline or signed consumption journal.

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


## Addendum: promotion checkpoint from three authenticated predecessors

The composed component now places deterministic `baseline_promotion_checkpoint`
after the pending promotion record and before promotion R05/final hook. Its three
input IDs identify the accepted promotion, completed cycle-close hook and prior
terminal Git checkpoint. A fixed host reader authenticates their same-instance
membership and source links. The latest five promotion postimages overlay the
three cycle-close postimages, yielding exactly six canonical paths: baseline,
history, index, snapshot, CURRENT-STATE and the terminal cycle status.

The application binds the original recorded context, metadata, prior Git parent,
index and projections in a closed leased plan with explicit write/hash/grant.
It reuses the finite approved terminal profile; the default session profile is
unchanged. Foreign paths/parents refuse. Confirmed Git and cache readback use
the actual local port and reload, including bounded terminal-cycle completion
when on its branch. DB-only does not export detailed canonical projections.
The checkpoint leaves baseline promotion incomplete until the actual final hook.
Confirmed Git dominates later no-effect permission errors: unknown keeps empty
facts and the owner. General reconciliation remains a separate deliverable.

Files, dual and DB-only components pass with fixture closure authority; denied
writes, foreign parent/path and lost permission after Git are checked separately.
The published-model qualification is still distinct. Its new targeted scenario
continues the existing deferred/cold-resumed cycle through an explicit promotion
choice and these actual ports. A completed component still has a closed catalog
requiring `complete_standard_workflow: false`; session closure, PR/review/merge,
synchronization, other paths, real native and installed archive remain required.

### Frozen composed promotion proof (2026-11-03)

The files selector now passes on snapshot `c18320d`: the same published partial
revision-18 IR drives actual application ports through promotion's governed Git
checkpoint, R05 and real final hook. There are 100 events, 43 operation records
(42 completed, one deferred) and seven fake-wire activities, five before cold
continuation and two after it. Prior journals/event prefix and the original
authorization/budget remain unchanged. Execution, replay and 101 streamed
simulation states agree exactly; both processes and cleanup are terminal.

This qualifies the bounded component with fixture human/effect/native authority,
not a full standard workflow or real native/installed-archive delivery. The
catalog's incomplete scope and ordinary selection are unchanged. The exact
source/model/final hashes and negative component cases remain in the evidence.

### Session artifact projection consistency (2026-11-03)

The actual canonical session-close admission requires both the session artifact
and its normalized session row from one database snapshot. A freshly initialized
standard session exposed a SQLite producer gap: the artifact CAS updated artifacts,
blobs and runtime heads, but left `sessions` empty. The existing admission correctly
refused that state; this is not a reason to fall back to visible Markdown.

SQLite session artifact writes now update the normalized session projection in the
same CAS transaction, matching the PostgreSQL producer. Both producers preserve an
explicit lifecycle `state` when present and otherwise project the declared mode;
they do not infer closure. Contradictory session path/metadata identity is refused.
A late projection failure rolls back the artifact and the normalized row together.
Read-only admission performs no repair, migration, projection import or conversion
of historical workflow instances. Previously incomplete canonical stores still
require an explicit authorized reconciliation rather than a reader-side repair.

The focused artifact-store fixtures exercise actual SQLite creation, revision,
identity conflict and rollback, plus the existing PostgreSQL double. They do not
qualify a live PostgreSQL backend, native model execution, an installed archive or
completion of the standard workflow.

### Read-only session-close admission in the partial IR (2026-11-03)

The COMMITTING component continues after optional promotion with the real
`session_close_admit` binding (SPEC-R07/R11), using the selected session identity
from initialization. Admission and completion remain separate. The host dispatches
the actual existing admission; its typed output has only an admission fact and
no business effect. A blocked receipt remains WAITING in the common reducer.

The source component has 43 operation occurrences, 35 referenced binding IDs and
42 registered bindings, with seven native declarations. Focused actual-host
fixtures cover signed retained outcomes and common replay/simulation in all local
state modes; they are not a full execution of this published model. No model or
business-effect grant is needed for the admission. The complete R07 decision,
report/CAS/checkpoint/final-hook chain, branch integration, PR review and post-merge
sync remain explicit work. Ordinary standard-workflow selection stays unchanged.

### Canonical baseline completion in later R05 scope (2026-11-03)

A later session-close drift check must observe baseline completion's canonical
history and audit index as well as current baseline/snapshot/current-state.
`readStandardDriftContext` now includes those two optional canonical artifacts
under the existing path checks and 196608-byte bound. It does not create a missing
canonical document or import visible Markdown; unrelated changes remain outside
coverage. This corrects a reproducible two-path context gap, not drift policy.

The versioned model graph, policies and data bindings remain unchanged; current
implementation pins are refreshed explicitly. Actual-reader fixtures cover all
local modes, including missing canonical INDEX, while the terminal-cycle selector
covers an authenticated report and real drift hook without reopening the cycle.
Native transport is a fixture and session closure is not executed by these tests.
Full published-model, real native and exact archive qualification remain separate.

### Session closure decision authority (2026-11-03)

A session-close decision uses the explicit v5 inbox reader; v1-v4 remain separate.
The fixed host authenticates accepted admission/evaluation/finalization journals
from the same instance and scope. It freshly reevaluates the native R05 evidence,
checks the retained canonical report and verifies the exact physical event line
at its signed offset. The model supplies operation identities only. A claimed
boolean, schema-valid object, CLOSED artifact or admission alone is insufficient.

The canonical subject includes session/current/snapshot, optional baseline
history/index and owned cycle statuses, with content and metadata hashes. Reads
do not repair or import projections. The provider authenticates close/refused/
deferred/cancelled against that exact question; an accepted close carries a
bounded report and only requests closure. Freshness is rechecked around capture
and receipt acceptance. Missing authority or changed evidence refuses.

The partial COMMITTING model declares a common R05 after optional promotion and
read-only admission, then this human decision. Its catalog remains incomplete.
Session report/CAS/checkpoint/final hook and branch integration, other paths,
long-wait reauthorization, unknown-effect reconciliation, PR/review/sync and
native/exact-archive qualification remain required. The physical-proof component
uses injected source authorities; actual-chain qualification must be reported
separately. No new shared table, default selection or historical conversion occurs.

#### R07 report, finite checkpoint and actual final hook — candidate

The candidate now also registers `session_close_record`,
`session_close_checkpoint` and `session_close_finalize` in the same partial IR.
The record writes exactly session/snapshot/current through canonical content and
metadata CAS, keeping OPEN, the selected owner and unchecked completion fields.
The checkpoint derives a finite latest postimage set from accepted deterministic
business writers. It uses the existing trusted terminal allow-list Git port; the
ordinary three-file session profile is unchanged. Foreign paths refuse. The
actual commit and cache reload precede the final hook.

The finalizer authenticates the original accepted start output and physical
start event/run file. The actual close-session hook consumes that same run; no
caller-selected run ID is supplied. Overall result, nested checkpoint/gate and
required constraint artifacts must succeed. DB modes additionally execute the
selective sync with full fallback disabled; no projection is imported as a
canonical substitute. Only confirmed hook evidence permits the three final CAS
writes of CLOSED, checked gate and snapshot. The closed owner remains selected
for explicit PR orchestration. Unknown effects retain ownership and empty facts,
with no blind hook retry after run consumption.

The focused `verify-standard-session-close-record-fixtures.mjs` takes
`--mode=files|dual|db-only`, `--checkpoint`, `--final-hook`, and the separate
`--checkpoint-fault=grant_after_git` injection. Files components passed 15 checks
through the actual start/close hooks and local Git; their decision/R05 source
capabilities are fixture injections. This is separate from a composed-model
proof with authenticated native R05. The schema metadata fingerprints now allow
null in files and remain required strings when returned by a DB-backed subject.
DB modes, failures, published-model execution/replay/simulation and broader gates
are still pending for this candidate. Other R07 resolution/integration paths,
PR/review/sync, general waits/reconciliation, A1–A10, real native and exact archive
remain required. The standard catalog and ordinary selection remain incomplete.

The first DB-mode component attempts retained unknown effects after the actual
close event. The candidate had added `--constraint-loop-strict` beyond the
existing skill route, promoting canonical warning targets to blockers. The
TARGETED governance check distinguished runtime strictness from warning/error
threshold policy; the adapter now preserves the existing threshold policy and
explicitly rejects blocking, missing or invalid threshold checks. No normative
rule or target is relaxed. Those failed attempts remain retained.

The subsequent complete chain exposed eleven unignored runtime constraint
outputs. The scope matrix already classifies `.aidn/runtime/perf/*` as ephemeral.
The scaffold now ignores exactly those generated telemetry names, and finalizer
preparation verifies that all are untracked and ignored before consuming the
start run. This does not enlarge the Git business allow-list or modify an
existing client's ignore rules implicitly. A db-only checkpoint with no physical
changes correctly preserves HEAD; the component fixture no longer requires an
invented commit or a visible canonical export. These corrections require fresh
DB-mode component proof; they do not retroactively turn the failed runs into PASS.

The DB attempts after telemetry-policy correction reached actual CLOSED CAS
but failed the process-output guard when embedding the raw hook/sync telemetry.
The process IR intentionally admits only safe integer numbers. The finalizer now
retains verified hook/sync summaries and SHA-256 of their complete JSON payloads,
plus the actual event/document/constraint evidence references, rather than
embedding runtime measurements. This preserves the IR vocabulary. The failed
output attempts remain failures, with their local owner retained.

The focused fixture also has `--constraint-policy-fault` (DB mode),
`--final-hook-fault=grant_after_hook`, `--final-hook-fault=suffix` (DB mode) and
`--final-hook-fault=constraints` (DB mode). These inject policy absence, lost
permission, actual SQLite suffix failure or a blocking project-local threshold.
No failure may emit a completion fact, consume the run twice, or release an
uncertain owner. A partial CLOSED artifact is not successful process completion.
The positive path also rejects a changed physical start run before executing
the final hook.

### Local branch integration port, without standard selection (2026-11-03)

The internal `WorkflowBranchIntegration` port is a separate Git effect, requiring
an exact observed source/target plan, explicit write intent and a revalidated host
grant. Its local adapter only fast-forwards a target to the already checked-out
source tip. It preserves source, index and worktree bytes; it runs no checkout,
merge driver, repository hook, configured clean/smudge/process filter or remote
operation. Effective filter configuration is pinned before disabling execution
overrides, and any later configuration change refuses.

One native Git reference transaction compares the old target OID and old HEAD
referent and updates target plus symbolic HEAD. The source ref and index remain
locked while the transaction runs. Other-worktree ownership, clean status,
ancestry, direct refs and unchanged preimages are required. An unavailable Git
symbolic-reference transaction has no sequential fallback. Concurrent external
Git changes still require observation; this port does not claim a universal
transaction over independent worktrees or filesystem writers.

Confirmation requires the exact appended target/HEAD reflog records bound to
the operation and plan, preserved reflog prefixes, source tip, index and worktree
registration. Matching refs alone are insufficient. Lost confirmation or a
revoked grant after the effect remains unknown. Cold inspection may observe the
effect but neither retries it nor grants workflow success or authorization.

Fifteen real-Git fixture checks cover positive/no-op/equal-head paths, linked
worktrees, filter overrides, dirty/staged/untracked changes, divergent/stale refs,
foreign locks, source locking, concurrent target/HEAD movement, lost grant and
reflog mismatch. This adapter is not yet a standard-model operation. Its tests
authenticate no human integration decision, canonical session resolution, PR,
native provider or installed archive. A retained cycle and a closed session do
not implicitly authorize its integration.

### Finite checkpoint before the session R05 (2026-11-03)

`session_preclose_checkpoint` is a separate deterministic mutating operation
between optional promotion and session-close admission. Final cycle/promotion
CAS writes occur after their preceding Git checkpoints. Their legitimate tracked
postimages can still trigger the existing R05 scope-growth refusal. The signal
policy remains unchanged.

The host authenticates accepted terminal closure, its physical checkpoint event,
the canonical OPEN owner and terminal attached cycles. It derives the latest
postimages only from accepted deterministic business writers of this instance and
scope. Parent HEAD comes from the accepted terminal/promotion Git checkpoint.
A fresh grant and exact content/metadata are required; foreign, untracked, staged
or changed postimages refuse. The finite terminal Git port commits and reloads;
the ordinary three-file session profile is unchanged. DB-only with no physical
postimages refreshes its cache without inventing a commit or exporting canonical
state. Unknown outcomes retain ownership and empty facts. Success records
`session_preclose_checkpoint_completed`, keeping `session_close_completed: false`.
It authorizes neither branch integration nor PR and allocates no native activity.

Index readers and writer scopes use the actual producer/installer path `index.md`.
The earlier uppercase reference aliased it on Windows in files mode but missed
the canonical DB row. Tests now preserve the existing canonical index instead of
creating a second uppercase row. No historical-instance conversion or
case-insensitive DB fallback is introduced.

Component proof uses real stores, projections, Git and gating with an injected
source-authority capability: 8 checks per mode and 7 for grant loss after a real
commit. Authenticated host/model composition, native provider and exact archive
are separate evidence; complete standard selection remains outstanding.

### Checkpoint Git hook and filter isolation (2026-11-03)

A configured, executable `reference-transaction` hook exposed a gap in the
checkpoint adapter's no-repository-code guarantee. The regression first proves
that ordinary Git executes the fixture hook and clean filter, then requires
observation, checkpoint and cold confirmation to leave their markers absent.
Every adapter Git call now disables repository hooks; configured clean, smudge
and process filters are disabled before status or diff can execute them.
Configured commit signing remains applicable as previously documented.

The effective filter configuration is observed before execution overrides and
pinned in newly prepared checkpoint plans. Live and cold changes refuse before
dispatch; a cold observation cannot confirm against a different context. The
six existing private v1 plan schemas retain their historical reader shape and
accept the additional filter digest. An old plan without the digest is not
converted or granted fresh execution. This change grants no integration, remote
effect, process completion or installed-package qualification.

### Checkpoint of confirmed session completion for delivery (2026-11-03)

`session_delivery_checkpoint` follows the actual final R07 hook and its three
confirmed completion CAS writes. The host authenticates that accepted result,
the original close event at its retained offset, its preceding checkpoint HEAD,
the selected CLOSED owner and the exact final session/snapshot/current postimages
and preserved metadata. A CLOSED marker alone is insufficient.

The deterministic operation accepts exactly those three paths and an explicit
fresh grant, then uses the finite Git port without replaying a hook, changing
canonical data, integrating a branch or invoking a provider. It makes no cache
freshness claim. DB-only with no physical changes returns completed/no_effect,
keeps HEAD and does not export. Refusals and unknown effects remain distinct;
lost grant after a real commit retains unknown ownership and empty facts.

The component fixture performs the actual start and final close hooks before
this new checkpoint. Its decision/R05 capability remains injected. Twenty checks
per selected configuration include the prior sixteen R07 assertions and four
delivery assertions; they are overlapping coverage, not independent acceptance
criteria. The authenticated model composition and integration/PR tail remain open.

### Explicit local integration after confirmed delivery (2026-11-03)

The partial standard IR now places a separate human
`session_branch_integration_decision` and deterministic `session_branch_integrate`
after confirmed session completion and its delivery checkpoint. Both bindings
are COMMITTING-only and trace to the PR orchestration skill and R03/R07/R08.
The close-session skill still never auto-merges. Retention, promotion and a
CLOSED marker grant no integration authority.

The host authenticates the accepted cycle closure, retained decision, physical
checkpoint event and session delivery chain. It reads the canonical CLOSED
session, its single attached retained DONE cycle, the latest accepted cycle
postimage and metadata. The target is the session artifact's branch, never an
IR-selected ref. The question pins these documents and the actual source/target
refs/tips, delivery HEAD, index, filters, reflog prefixes and other worktrees.
Changed state invalidates the answer. This bounded binding explicitly refuses
additional attached cycles; their resolution remains a required follow-up.

The new human source and v6 inbox preserve refusal, deferral and cancellation.
Existing inbox readers v1-v5 remain unchanged and no historical record is
converted. Consent emits only a request with no effect. Integration additionally
requires an exact prepared plan, fresh grant, current instance and local effect
owner, then invokes the previously separate actual Git port. Confirmation
requires the operation/plan-bound transaction and unchanged canonical data,
index and worktree bytes. Lost grant after Git remains unknown with empty facts
and retained ownership; neither an observable ref nor cold reopening retries it.

Component evidence separates eleven human/store checks across files/dual/DB-only,
seven authority checks with injected accepted-journal/R07 capabilities, and six
application/Git checks with injected accepted human/closure sources. It retains
the failed output-schema attempts in the qualification record. These components
do not establish the authenticated published-model path, PR admission, native
human/provider identity or installed-archive qualification. Branch-context
re-anchoring, PR/push/review/merge/sync and the remaining standard paths are still
required. Ordinary standard selection and complete_standard_workflow stay off.

### Read-only re-anchor and real PR admission (2026-11-03)

`session_pr_admit` follows the separately confirmed local integration. Its fixed
host reader authenticates that accepted operation and rechecks the canonical
delivery/closure subject. The local Git port must still confirm the original
operation/plan-bound ref transaction, index, filters and worktree registration.
Unknown effects or matching refs without the retained proof cannot admit PR work.

The operation runs the actual reload check without writing its cache, verifies
the session branch and HEAD, then invokes the existing PR admission use case.
Its optional Git dependency defaults to the existing adapter for current callers.
This new host supplies isolated status observation while ordinary ref/upstream
reads stay local; configured clean/process filters cannot execute through a
legacy status call. The final observation rechecks Git and canonical source.

The result only distinguishes an admitted push requirement from an admitted PR
opening requirement. An open/merged/synced metadata marker supplies no external
success proof. The private read-only result allocates no model, updates no
canonical artifact, writes no cache and performs no remote operation. No public
CLI flag, old default admission behavior or historical process reader changes.
Actual push, PR creation, checks/review/events, explicit merge and post-merge
reconciliation remain separate required ports and effects.

## Local session push component

The explicit partial model can continue its accepted PR admission through a
separate session_push operation. The trusted host supplies the transport
capability; authored IR selects neither a destination nor executable commands.
The current transport qualifies a local bare Git remote only. Its plan binds
session, admission source, local head/material and observed remote tip to the
exact grant. It requires a proven fast-forward and exact remote-tip CAS, then
observes the actual remote ref. Equal head is a read-confirmed no-effect path.
No upstream metadata or PR marker substitutes for that observation.

The existing process operation journal owns this intent/result and the existing
local effect owner fences cooperative callers. Timeout, lost permission or an
unconfirmed postcondition after attempted push stays unknown with the owner
retained. It grants no retry or remote merge. This is the existing L2/L4 effect
protocol, not a new durable concept or a claim of general effect reconciliation.
The production GitHub transport and complete composed/native/archive evidence
remain separate work.

## Explicit PR creation and recovery

session_pr_open consumes a signed, accepted session_push result and revalidates
its canonical admission/integration chain and actual remote head. A host-supplied
provider capability fixes the repository, executable and authenticated transport;
the IR supplies no endpoint, command, credential or self-authorized result. The
exact grant binds the source, both branches, remote tips and provider plan.

The GitHub adapter enumerates matching PRs completely within fixed bounds. An
exact open non-draft PR is recovered without POST. Closed, merged, ambiguous and
draft results require separate decisions. New creation is re-observed against the
same repository/head/base. GitHub creation has no expected-head CAS; a race,
timeout or lost authority after attempted creation remains unknown, with the
existing owner and journal retained. No automatic retry is supplied. The open
fact establishes neither review/check admission nor merge consent. The REST
transport double is distinct from real GitHub and archive/native qualification.


## Canonical PR lifecycle successor postimages

session_pr_record is separate from remote PR creation. Its trusted authority
follows accepted PR/push/admission/integration/delivery/closure receipts, checks
physical closure events and re-observes the exact open PR. Original delivery
hashes remain historical evidence. Before its own effect the writer requires
those exact canonical content and metadata preimages. It then CAS-writes the
session, CURRENT-STATE and snapshot, retains CLOSED, records review pending and
returns its own successor postimages. It changes no Git ref/index or remote.

The original closure reader is not relaxed to accept changed bytes. Later
checkpoint/push/review must consume the explicit successor receipt. A failed
second write, failed projection or lost authority is unknown, with the owner
retained and no lifecycle completion fact. DB-only changes no physical export.
This is a transition within the existing session and operation-journal concepts,
not a new independent authority, merge permission or completed PR skill.

## Checkpoint and push of the canonical PR successor

session_pr_checkpoint consumes the accepted session_pr_record receipt, its three
new content/metadata hashes and the authenticated historical closure chain. It
uses the bounded Git checkpoint port on the session branch. The original
readSessionDeliverySource remains strict. The successor is a separate authority
path; CLOSED/open markers and predecessor hashes cannot substitute for it.
DB-only preserves physical files and HEAD when no physical postimage changed.

session_pr_update_push consumes the accepted successor checkpoint and freshly
observes the exact existing PR and remote tip. It uses the host-owned push port,
then observes the same PR at the new HEAD. Repository, PR, head/base branch,
base SHA, title/body and destination identity stay bound. Review and checks are
pending for the confirmed delivery SHA; no approval or check on the prior SHA
is inherited as acceptance. Loss of authority after an attempted effect remains
unknown with the owner retained. Production GitHub push and review/merge/sync
ports require their own later qualification.

The source author now emits required contract_version literals from the registered
input contracts into the authored IR. The interpreter still resolves exactly the
stored expressions and rejects missing or wrong versions before dispatch. It does
not repair historical models or insert a version while reading. The pure boundary
fixture exercises the published expressions through the actual reducer and input
resolver; its predecessor receipts are synthetic and prove no service effect.

## Host-pinned authenticated GitHub push transport

The host may supply github-https-git.v1 separately from local-bare-remote.v1.
Both private push plan schemas add this profile without converting retained
plans or changing the local profile's meaning. A production capability pins
Git and gh executables, repository node ID/name and authenticated actor node
ID/login. It obtains a credential via [gh auth token](https://cli.github.com/manual/gh_auth_token),
uses fixed read-only identity/ref endpoints and requires the repository's push
permission before a network effect. The IR supplies none of these capabilities.

The adapter keeps credentials out of arguments, files, plans, receipts and
errors. Git receives the HTTPS header through its child environment using
[--config-env](https://git-scm.com/docs/git). Redirects and credential helpers
are disabled. Preview observations run outside any checkout. The granted push
creates a dedicated bare transport repository with only an alternate object
store pointing to the observed local objects. It cannot read checkout URL,
credential or scoped HTTP configuration during transport. This preparation is
an explicit local resource of the already journaled push, not a new authority.
Its closed github-push-preparation.v1 manifest records bounded execution
metadata only. The resource path is deterministically correlated to the host,
branch and target HEAD. Confirmed completion removes that exact resource;
an unknown effect retains it and blocks another dispatch for the same head.
General reconciliation remains a separate requirement.

The adapter proves local ancestry, uses an exact remote tip lease, then
re-observes Git and authenticated API refs and identities. A changed actor,
repository, tip, local context or grant cannot become a confirmed delivery.
Transport errors after dispatch remain unknown. Neither the transport factory
nor its offline doubles qualifies actual GitHub execution, a complete standard
workflow or an installed archive. Real remote use still requires an explicit
authorization for its actual destination and revision.

### Exact-head PR review evidence, 2026-11-03

The private `session_pr_review_observe` binding consumes the accepted
`session_pr_update_push` receipt and reauthenticates its causal checkpoint,
canonical successor postimages and current local/remote Git head. Its host-only
review capability observes the expected repository/PR/head/base identities,
review authors and revisions, check app identities and legacy status creators.
Two complete identical collections are required, since PR metadata alone does
not fence same-head check reruns or review dismissal. Fresh thread observations
are retained separately and reread around the review/check collection.

This deterministic operation performs no model call or business write. Its
signed output establishes only evidence availability and pending triage. It
does not approve checks, finish the pr-orchestrate skill, accept unresolved
threads, authorize merge or infer a human decision. Stale snapshots, changed
collections and unavailable providers remain blocked with no facts. The common
IR groups PR delivery in a sequence to preserve the existing children bound;
no engine limit or historical reader is widened. External inbox authentication,
actual triage, explicit merge and post-merge synchronization remain required.

The direct native launch fingerprint also enumerates both review readers, their
schemas, the review authority/operation and the common standard-operation
contract registry. Binding hashes continue to cover their implementation bytes;
the direct pins separately reject a changed distributed reader at launch. The
model49 observation run retains its original314-file launch fingerprint. Its
explicit successor uses325 direct files and a new model/source revision, without
converting the running or retained instances.

### Cancellable observation transport prerequisite, 2026-11-03

The explicit asynchronous GitHub reader interfaces consume the same fixed
query, pagination and validation protocol as their retained synchronous v1
interfaces. Their host transport uses asynchronous direct subprocess I/O,
without a shell or model, and propagates an AbortSignal to each request. Abort,
deadline and output overflow discard buffered output and wait for the direct
child's close before returning. Per-observation deadlines are not renewed by
page boundaries. An inbox timeout cancels the source; the inbox neither captures
a late response nor emits a successful event. Caller cancellation also reaches
capture and source verification.

This transport capability is host code, never authored IR or credentials in
JSON. It is covered by binding implementation hashes and direct launch pins.
No durable concept or contract version changes here. The existing signed
control inbox remains the retention authority. Its timeout return does not
itself certify subprocess closure: the transport's close is tested separately.
Direct observation subprocess closure does not qualify the general native
process-tree reconciliation or long-wait reauthorization protocol. Provider
authentication, durable PR-specific event delivery and actual triage remain
separate requirements.

### Complete PR review content prerequisite, 2026-11-03

The explicit `github-review-evidence.v2` content reader retains complete review
bodies in bounded Unicode chunks and checks their digests. Body bytes participate
in the two identical complete collections, including when HEAD and provider
timestamps stay unchanged. A body above64KiB, aggregate bodies above1MiB or a
missing body refuses; evidence is never shortened to fit. The separate
`github-pr-observation.v2` reader requires exact head/base/branch identities and
retains comment actor node IDs alongside login/type, complete bodies and
revisions. Deleted actors remain null. Historical v1 request/output schemas and
reader envelopes retain their original shape and meaning.

The new `session_pr_review_content_observe` deterministic binding reuses the
accepted successor-push/checkpoint authority and the shared observation
implementation. Its closed output embeds the explicit v2 reader contracts.
The candidate common IR selects this binding at its existing observation leaf;
the historical observation binding remains registered. The host supplies the
content capabilities; IR data cannot substitute a reader or downgrade content
to headers. No provider call occurs during preview. Complete text availability
still establishes only evidence availability and pending triage. It neither
accepts checks, classifies findings, replies to/resolves threads, finishes the
skill nor grants merge authority. Durable PR-specific delivery and actual triage
remain required before those outcomes can be claimed.


Query-field reference: [GitHub GraphQL pull requests](https://docs.github.com/en/graphql/reference/pulls#pullrequestreview)
for review body/author/revisions and PR base OID; this documentation lookup is
not a live-provider qualification.

### Application observation cancellation, 2026-11-03

The application PR observer forwards its caller's AbortSignal to all four
provider collections and both confirmed-head reads. It checks cancellation
before and after those reads, so a source that returns after cancellation
cannot publish evidence availability. The review authority also forwards the
signal to its checkpoint and push inspectors. The operation host exposes this
signal for review dispatch and human capture. A blocked observation retains no
success facts. No historical contract or reader is converted.

Human decision capture combines its internal five-second timeout with the caller
signal for both read and verification. Caller abort and timeout retain distinct
reason codes; neither can persist a late decision. These callbacks remain host
capabilities, not authored executable data. Synchronous Git/checkpoint readers
cannot be interrupted while they occupy the JavaScript thread. Propagation is
therefore not proof of an end-to-end inbox deadline or general process-tree
closure. The subprocess transport's independent close evidence stays separate.

### Explicit durable PR content capture, 2026-11-03

`process-control-inbox.v2` retains a `process-pr-review-payload.v1` containing
the authenticated provider event and complete v2 review/check/thread observation.
The event binds repository, PR number/node ID, head/base OIDs and branches,
provider revision, time and actor node ID/login/type. The source claim binds
that entire payload to the exact request, scope, instance and occurrence. A
trusted event port must authenticate the actor and current event revision;
JSON or a content digest cannot do that. A trusted canonical context port binds
the current request and accepted update operation. The application observer
collects complete content through its host provider capability. Verification
rereads the event around a fresh complete collection and compares content
digests, so same-head edits or a changed event cannot wake the occurrence.

Capture uses the explicit `pr-review-content` kind and `readReview`/`verifyReview`
ports. Generic claim capture retains its v1 protocol. Existing v1 records and
human inbox v1-v6 remain unchanged and acquire no inferred payload. V2 source,
event and full content are signed and CAS-persisted before reducer delivery;
acknowledgement follows the canonical event. A conflicting duplicate cannot
replace a captured payload. A missing acknowledgement is repaired against the
authenticated canonical event without another provider read or repeated event.
New captures refuse events older than five minutes. A retained signed capture
may outlive that window only with fresh current-event authentication and complete
content reobservation. This delivery grants no new native budget or effect right.

This is a version of the existing `process_control_inbox` concept under its
trusted delivery host, physical-project/occurrence scope, no-purge retention,
canonical files/configured-runtime authority and required dual projection rules.
There is no new shared table, implicit migration, replacement of v1, automatic
db-only export or source event polling. The source factory composes host ports;
its fixture event authentication does not qualify a live webhook/provider or
native human identity. The candidate standard graph still needs its PR wait and
triage route. Persisted content alone neither resolves findings nor accepts
checks, finishes the skill or authorizes merge.

### Standard PR wait and signed-content consumption, 2026-11-03

The next candidate standard revision explicitly selects an external event after
the accepted full-content observation. The host composes its review control
source from provider event capabilities and its own accepted operation lookup,
current request, successor authority and application observer. A supplied IR or
event port cannot provide canonical context, an update receipt or an observer.
Claim-only capture cannot wake this standard occurrence. Other historical
control models retain their version-specific readers and explicit capture kind.

After canonical delivery, a deterministic read-only consumer identifies the
unique accepted event for the exact accepted update operation. It verifies the
signed v2 inbox and its retained delivery checkpoint, authenticates the current
event around a fresh complete application observation, then retains the exact
payload as the input to triage. A changed head, base, content or event revision
blocks consumption with empty facts. The existing operation journal authenticates
the resulting output; no new governed concept, table, implicit projection or
migration is introduced. Cancellation is propagated through mixed dispatch too.
Synchronous Git readers retain the previously documented preemption limitation.

This consumer does not classify findings, accept checks, reply, resolve a thread,
complete a skill or authorize merge. The partial catalog remains incomplete and
ordinary standard selection is still outstanding. Fixture grants and event
principals remain fixture evidence, separately from live provider identities.

### Authenticated source selection for native PR triage, 2026-11-03

The candidate JSON now selects `session_pr_triage_select`, an independent
read-only `session_pr_triage` activity and `session_pr_triage_evaluate` after
signed-content consumption. Selection authenticates the latest accepted receive
operation, reauthenticates its event around a fresh complete provider observation,
then binds that exact retained payload and current product hash in its signed
operation output. No caller or authored IR can supply a source body or provider
capability. Deterministic selection/evaluation and external waiting allocate no
model session themselves.

The worker reconstructs its standard authority without a provider. It resolves
the exact accepted selection from the common IR input binding, verifies the
accepted receive output and current physical head/branch/product, and retains a
complete typed context. The native result includes the report, context and
observed post-turn product as authenticated owned evidence. Evaluation resolves
the same input against the actual pre-assignment journal prefix with the common
reducer, verifies native producer/configuration and exact context/product, then
reexecutes source selection through the host's actual provider/event capabilities.
Same-head content edits, changed event revision/base/head, foreign source and
product changes refuse successful classification. Old instances retain their
original model and pins; there is no pin repair or implicit conversion.

Every supplied review and thread comment is covered exactly once, including
outdated comments. An empty thread, missing actor or empty body remains uncertain.
Each classified finding retains technical rationale, its exact body reference
and supplied product evidence. Valid findings retain a required correction;
invalid findings retain a proposed technical response. Review-level findings
also retain response obligations. Uncertain results block with empty routing
facts while preserving all dispositions and pending obligations. Successful
classification records only findings/correction/response routing facts. It never
confirms a reply, resolution, physical correction, fresh checks, skill completion
or explicit human merge consent. Those subsequent operations and full R08
qualification remain outstanding. This uses existing operation/native records
and their concept policies, with no new table or shared coordination surface.
