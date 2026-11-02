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
They supply inputs and authenticated fixture source/grant capabilities. They no
longer construct another startup sequence. Isolated human protocol tests still
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
cycle-create skill/hook remain open.

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
resume authority is not established. A future authenticated allocation journal
must bind this evidence to actual owned closure, fences, cumulative budgets and
an explicit next-allocation grant before restoring historical identities or
lifting the pristine-start guard. Default execution still cannot resume history.

### Authenticated owned-allocation reservation

`createJournaledNativeAllocation` is an internal opt-in composition of the actual
owned supervisor and canonical artifact store. A trusted parent supplies the
32-byte signing capability; neither model/configuration nor native worker receives
it. The parent's observer reserves a generation with artifact CAS before worker
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
That contract, restoration of closed identities/contributions, native-history
admission and a common mixed-host scope remain required L4 work. The current
composition continues enforcing the existing pristine-start guard. Ordinary
CLI/console paths have not been switched to this internal composition. Historical
instance readers, unsigned snapshots and old scopes are not silently adopted.

The journal authenticates a trusted supervisor observation, not human identity,
business approval, anti-rollback storage or OS confinement. Offline production
composition with transport/controller doubles must remain separately labelled
from live native execution and exact installed-package qualification.
