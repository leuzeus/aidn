# Participants, roles and agentic control

## Vocabulary and behavior

| Concept | Meaning in AIDN | Does not imply |
| --- | --- | --- |
| Participant / pool | Logical owner of a process and its exchanges | One model, agent, machine or account |
| Role / lane | Responsibility for an activity | A new executor or additional permissions |
| Agent / execution | Identified technical resource observed by the trusted host | A session, a role or proven independence |
| Session / context | Conversation continuity and the inputs actually available | Erasure of earlier contributions or knowledge |
| Skill | Reusable procedure/capability, recorded on a role | An extra agent or permission to mutate |
| Gateway | Routing and synchronization of logical control flows | A model call or a number of workers |
| Review | An activity bound to work, criteria and an assurance policy | Independence from a new label, pool or session alone |

`structured-agentic-process.v1` is the default execution engine for all new AIDN
workflows, including directly authored JSON models. BPMN v2 compilation is one
authoring route into this same engine. The public `aidn runtime workflow-run`
entry and console select `agentic` without an engine flag. Explicit
`--engine legacy`, `engine: "legacy"` on initialization, or project configuration
`runtime.workflowEngine: "legacy"` selects sequential compatibility. Persisted
contracts select their historical readers; a default change never converts them.
The v2 adoption does not rename the existing versioned IR or reducer profile.
Loading a model or previewing a command does not allocate a native client.

Default engine selection does not yet mean that AIDN's standard session/cycle/PR
lifecycle is driven by a shipped process IR model. Its historical shadow
definition remains descriptive; the native launcher currently admits only a
matching pristine initial checkpoint, rather than general eventful resume.
The remaining deliverable is explicitly tracked in the
[standard workflow IR integration plan](PLAN_STANDARD_WORKFLOW_PROCESS_IR_2026-11-01.md):
versioned standard model, actual skill/operation ports, durable human/external
waits and resume, and separate offline/native/installed-package qualification.

```text
aidn runtime workflow-run --target <root> --configuration <execution.json> --authorization <authorization.json> --json
aidn runtime workflow-run --target <root> --configuration <execution.json> --execute --authorization <authorization.json> --expect-plan <action_sha256> --json
```

The configuration and authorization retain the owned runner's existing contracts,
implementation/authority/model/criteria pins, native permission checks, deadlines,
response/storage budgets and process-tree closure. Preview pins the target,
configuration, authorization content and product observation, and displays the
typed budget fields. A preview without authorization lists that requirement and
cannot be applied; provide the authorization and repeat the preview before
execution. An explicit execution rechecks the exact
preview before delegating to the owned host. No PostgreSQL or shared relay is
introduced by this default; the configured canonical backend remains authoritative.
`codex workflow-step` remains the admission/context observation port and does not
start native work implicitly. The previous `agent-run*` commands are explicit
sequential compatibility entrypoints.

Console initialization writes an unstarted agentic instance only with `--write`.
It may enter the owned runner when instance/model/facts/scope/policies exactly
match its pristine initial checkpoint. Existing events or changed bindings require
reconciliation; an execution is never restarted over historical results.

The package's source startup contract and minimal workflow kernel also instruct
agents to retain the current execution for compatible roles, without changing
admission requirements. The reviewer source profile requires checking rather
than assuming independence. These assets apply through a future explicit normal
installation/upgrade; this change does not edit an installed project.

## Model

The L1 foundation for the standard workflow adds versioned
`agentic-process-model.v2` / `agentic-process-instance.v2` readers to the same
reducer. An `operation` references a fixed host binding for deterministic, human
or external work, with an authenticated intent/receipt protocol. It requires no
fake agent or native session. Deferred/blocked/unknown outcomes retain explicit
waits; raw caller facts/messages cannot authorize v2 control through the service.
V1 models, instances, native assignments and hashes retain their existing format.
See [ADR-0025](ADR/ADR-0025-standard-workflow-runtime-binding.md).

Partial standard business adapters and startup/cycle components are now bound
through the operation/control host; they do not deliver the complete standard
model. The native-only owned composition accepts v1 and v2 graphs without
operation nodes. V2 rejects raw control-scenario facts/events before allocation;
its human/external control requires authenticated delivery. Mixed execution and
general native-history resume are not implied by that default entrypoint. The
internal mixed host below supplies a separate, explicitly authenticated path.

The closed `agentic-process-model.v1` contract declares participants, reusable
roles/skills, versioned policies and a structured tree of nodes. Every node has
its participant. Sequence edges stay within that participant. A call scopes a
procedure occurrence; it never supplies an independent execution identity.
Collaboration with a different participant needs a separate message contract;
`message_review` is preserved as descriptive data and refused for execution.

An activity references a role and a policy separately. Compatible activities
can use the same eligible execution. Review policies use `auditor/audit`, exclude
contributors and require the assurance implemented by the trusted authority.
Effective permissions must fit the current policy; earlier rights are not added.
The role's skills describe required capability. For non-empty requirements the
authority receives the explicit skills and must return a matching
`requirements_sha256` alongside the authenticated observation. Missing or changed
capability proof waits. The host must verify actual availability; the engine does
not load skills from model JSON.

See the tracked example in
`tests/fixtures/agentic-process/compatible-work-and-review.json`: analysis and
implementation may reuse an execution; the following review cannot reuse its
author. All roles can reference the same skills.

## Execution profile

| Construct | Representable / validatable | Executable profile |
| --- | --- | --- |
| Activity, sequence | yes | Typed assignment and authenticated result; ordered sequence |
| XOR split | yes | First true condition in declared branch order, otherwise explicit default or incident |
| AND block | yes | All child flows become admissible; completion requires each distinct occurrence |
| OR block | yes | All selected children, otherwise default or incident; only selected flows are joined |
| Exclusive event race | yes | Correlated host-delivered signal; one retained winner, alternatives disabled |
| Bounded loop | yes | Body first, then Boolean `until`; distinct iteration occurrences, explicit limit failure |
| Multi-instance | yes | Explicit bounded item IDs, sequential or logically parallel, all must complete; empty succeeds |
| Call | yes | Scoped child procedure in the same participant; ordinary assignment policy still applies |
| Complex, mixed, instantiating event gateways | yes | Explicit refusal; no silent fallback or automatic normalization |
| Autonomous participant review | yes | Explicit refusal pending a supported participant message/authority contract |
| Unstructured graph, shared OR child, cross-pool sequence | no | Explicit refusal |
| BPMN XML profile compilation | yes, bounded subset | Default [v2](BPMN_EXECUTION_PROFILE_V2.md) compiles to the agentic engine, including message races, guarded loops, collections and local calls; explicit v1 remains compatible |
| General BPMN XML import/export | no | Unsupported semantics refuse; no XML export or general interpreter |

`agenticProcessCapabilities()` exposes `representable`, `validatable`,
`executable` and `tested` separately. Unsupported constructs have `tested:false`;
their refusal test is identified separately by `verification`. Verification is
offline runtime/contract verification or explicit refusal, not native reception.
XOR convergence with multiple independent incoming tokens (G03) is outside this
structured-tree profile. G11–G13 exercise rejection of the unsupported constructs,
not their BPMN semantics. Structured OR support never claims arbitrary graph OR.

Boolean routing facts are explicit host inputs. Missing facts leave a visible
wait; a completed activity can supply a later facts event through the host.
No expression evaluation, generated code, model polling, thread creation or
implicit resource allocation occurs at a gateway. The host delivers messages
and timer outcomes; this profile does not itself schedule wall-clock timers.

The [BPMN execution profile](BPMN_EXECUTION_PROFILE.md) connects modeling XML to
this IR through explicit role/policy bindings and source maps. Its compiler
subset is smaller than the IR capability set. `simulateAgenticProcess` produces
bounded synthetic event traces with this same reducer, without host effects or
write authorization. See ADR-0023 for authority and compatibility boundaries.

Activity results are not merged at a join. If reconciliation requires judgment,
declare another activity. A failed child fails the process and cancels remaining
control occurrences; cleanup of real external effects remains the executor
host's obligation. The control state alone is not proof of OS cleanup.

## Application composition

`createAgenticProcessService` receives fixed trusted ports:

- `store`: the canonical artifact read/CAS/materialization adapter;
- `readAuthority`: canonical scope, selected model SHA and required policy hashes;
- `readBinding`: current reviewed revision/hash, criteria, permitted context and excluded contributors;
- `assignmentAuthority`: authenticated observations and verification from ADR-0021;
- `resultAuthority`: protected result reads and authentication bound to the request, result and original execution;
- role-capable adapters, health/roster and a host clock.

No port is chosen by JSON, a module path, an authored attestation or an agent ID.
The authority must verify the complete declared assurance profile, capability,
effective access and contributor/context provenance. A content hash alone is
not authentication. A missing guarantee waits; the engine never downgrades it.

```js
import { createAgenticProcessStore } from "../src/adapters/runtime/agentic-process-store.mjs";
import { createAgenticProcessService } from "../src/application/runtime/agentic-process-service.mjs";

// suppliedHostPorts are trusted embedding dependencies, not an authored file.
const service = createAgenticProcessService({
  ...suppliedHostPorts,
  store: createAgenticProcessStore({ targetRoot, stateMode: "files" }),
});
const preview = service.initialize({ instanceId: "change", model, write: false });
const retained = service.initialize({ instanceId: "change", model, write: true,
  expectedResultSha256: preview.record.instance_sha256 });
const next = await service.assign({ instanceId: "change",
  expectedSha256: retained.record.instance_sha256,
  occurrenceId: retained.cursor.ready[0], eventId: "assign-analysis", write: true });
// Host uses its admitted execution; no client is spawned by this API.
// service.accept reads a protected result by ID, never an inline author verdict.
```

The `assign` operation persists its decision before the host executes work. A
`separate` decision identifies another already observed eligible resource; it
does not spawn one. The host remains responsible for capacity and actual tool
admission. Logical concurrency permits interleaving on one compatible execution;
it does not certify simultaneous model calls or persistent worker reuse.

Acceptance authenticates the protected result, checks exact request, revision,
artifact/criteria hashes and original execution, then refreshes eligibility.
A reviewer who has corrected the work, new revision, copied forbidden context,
expired observation or changed permissions prevents acceptance. A protected
rejection is retained as a failed process, not retried until favorable. Missing
resource/verdict eligibility can be retained as a bounded refusal event by an
explicit write. Authentication errors expose fixed codes, never raw diagnostics.

## Persistence and compatibility

`agentic-process-instance.v1` retains profile, model/policy pins, canonical scope,
Boolean facts, typed events and a replay-validated content hash. Instance,
activity, branch, item, loop and call occurrence paths are distinct from agent
IDs. A repeated identical event is idempotent; an altered event with the same ID
refuses. Event races are serialized by the existing canonical artifact CAS.

`createAgenticProcessStore` uses
`workflows/process-instances/<id>.json` under the existing audit artifact store.
In files mode it is local; configured PostgreSQL remains canonical. Dual
projections are derived; db-only creates no visible JSON automatically. The
existing reservation fence, locks and explicit materialization apply. This adds
no shared coordination table or implicit migration. Required policy hashes come
from the host's selected deployment, so deleting a policy and recomputing the
model's own hash cannot make an old deployment executable.

Preview and inspection are read-only. Mutations require `write:true`, exact
instance revision and optionally the preview hash. Old models/instances are not
reinterpreted after policy changes. Stop new writes to roll back adoption;
retain the pinned reader/profile for historical inspection and explicit cleanup.

## Owned execution composition

`createProjectAgenticProcessExecution` now constructs the actual binding,
assignment and protected-result authorities. They are private host objects, not
authored JSON or authority doubles. It reads project activation and canonical
scope, uses the existing artifact CAS, persists assignment before dispatch,
executes the admitted activity, captures the bound terminal response and
re-observes eligibility before accepting the result. Input revision pins remain
frozen during authorized implementation; output fingerprints are separate
evidence. A later review binds the new product revision and fixed criteria.

The concrete `createAgenticCodexSessions` adapter uses the documented app-server
initialize/thread/start/turn/start lifecycle. Compatible roles retain the same
live thread. A required independent review creates a fresh native process and
thread, loads only the common criteria/skills and a curated product snapshot,
and receives a read-only tool profile. Author agent/lineage contributions are
excluded. A corrective edit invalidates acceptance; a protected rejection is
terminal. Process completion is not human acceptance or release admission.

The adapter supports `compatible-work.v1` and `independent-review.v1`, and only
`read:product`/`write:product` permissions. Unknown profiles or permissions refuse.
The isolation claim is limited to fresh conversation, memories disabled,
restricted native tools and protected host records. It is not a claim of
full-client adversarial OS confinement, LPAC or independent human review.

Native thread IDs, optional native session IDs and host context/execution/agent/
lineage IDs are retained separately. A host context ID is bound to the returned
thread; a missing native session ID is recorded as unknown, never reconstructed.
Only events matching the owned thread and turn can complete an activity. Known
commentary/partial-answer phases are not final answers; an ambiguous capture
refuses. Native cumulative usage snapshots are retained per thread and never
summed across turns as if they were independent totals. Missing or in-flight
usage remains unknown. Streaming deltas are not duplicated into evidence files.
Completed tool items additionally retain bounded kind/name labels, payload and
output hashes, byte counts, native status/exit/duration when available, and an
observed polling marker. Raw commands, arguments, outputs and reasoning are not
copied. Each activity receipt counts distinct native responses and observed
tool items; these are diagnostic observations, never result authority.

The adapter checks effective configuration, allowed permission profile, existing
Windows sandbox readiness and exact trusted project-hook hashes before a model
turn. It never provisions a backend, approves hooks, changes home configuration
or silently weakens an unsupported profile. Existing hooks remain effective.
The author's exact trusted SessionStart/PreToolUse hooks from the activated
project are mandatory; assignment never replaces pre-write admission. Common
authorities include the pinned project AGENTS.md and selected task authorities
supplied identically to work and review. Automatic project-document injection is
disabled only after this explicit packet is composed; author transcripts and
runtime projections are not copied into it.
No server approval escalation or dynamic-tool bridge is implemented.

`runOwnedAgenticProcess` uses the existing Windows Job Object controller to own
the fixed Node worker and all native descendants. The worker receives the
original absolute authorization/workflow deadlines; allocation does not renew
them. Direct-child closure and controller tree proof are separate. A missing
tree proof prevents success. Deadline, response and storage guards stop further
activities and retain the first reason and available consumption. There is no
activity retry, favorable-state search or replacement attempt.

Executable occurrence paths must fit the unchanged 256-character assignment
activity-ID contract, including the longest loop and collection suffixes. The
model loader refuses an oversized possible path before resource assignment;
paths are never shortened or hashed into an ambiguous identity.

Cancellation already requested at entry, or received during the asynchronous
pre-turn observation, prohibits a new model turn. Exhausted deadlines also
refuse before turn/start. If storage becomes unobservable, the partial stdout
result preserves the first failure and observed consumption with null byte
counts. If the footer cannot be written, that same structured result travels
on stdout; its seal status does not replace an earlier failure. The outer
controller propagates these stdout-only states without an unbudgeted write,
and preserves worker consumption and process-tree closure if its own footer
cannot be measured or written.

Storage accounting covers retained evidence/native scratch, review snapshots,
product-size growth, the instance projection and local SQLite file/WAL growth.
It uses a preventive reserve and sampled metadata, not an OS disk quota; a native
write can exceed a sample boundary. Such an observed breach fails. If disk
sealing cannot fit, the bounded structured partial result travels on owned
stdout; evidence is not deleted to hide the breach. The runner uses the existing
configured canonical backend, SQLite or PostgreSQL, without migration, adoption
or fallback. The resolved backend/reference binding is pinned across the parent,
worker, reads and writes; changing it requires reconciliation. PostgreSQL being
unavailable never makes a local SQLite file authoritative.

Live journal children removed between inventory and metadata inspection
contribute zero retained bytes. Missing required roots, unreadable entries,
symlinks and entry-count overflow still refuse; missing optional SQLite sidecars
remain zero. During execution, a failed metadata read retains only its bounded
error code, operation, path hash and time in the partial result, never a raw path
or body. A synthetic disappearance check does not establish the cause of an
earlier native failure lacking those diagnostics.

| Backend | Canonical process state | Concurrency and required controls |
| --- | --- | --- |
| SQLite/local files | Files in files mode; SQLite in dual/db-only | Local exclusive lock or transactional CAS; contention/stale locks refuse and require reconciliation. This is not shared supervision authority. |
| Configured PostgreSQL | PostgreSQL in every state mode; visible files remain derived | Existing transaction, artifact-table lock, scope reservation fence and CAS. Existing schema, scope, connection reference and driver are required; no automatic DDL. |

Both retain the same model, revision, criteria, assignment and independent-review
rules. Compatibility does not imply identical throughput, contention behavior,
distributed coordination or failure modes. ADR-0014's PostgreSQL-only shared
supervision remains separate; this runner does not emulate it with SQLite.

The trusted worker and the author's pinned admission-hook host receive the
referenced PostgreSQL connection and driver environment through private
environment transport. The global hook runtime home comes from the verified
installation receipt. They are absent from worker configuration/stdin/argv,
evidence, model-shell environments and the independent review. The effective
native shell allowlist is checked before model work and excludes database
credentials. Backend selection and credentials are not model inputs. Missing
connection material refuses before native work.

For PostgreSQL, the budget additionally debits cumulative attempted serialized
canonical payload, including attempts whose commit acknowledgement is missing.
Acknowledged payload is reported separately. These are logical bytes; physical
server pages, indexes, MVCC versions and WAL are NON_MESURE here and must not be
reported as zero or equated with SQLite/WAL file growth. A benchmark requiring
physical PostgreSQL storage accounting must collect it externally for its owned
database. The intended comparable benchmark uses PostgreSQL governance; SQLite
compatibility is retained and checked separately.

The internal entry is `tools/runtime/run-agentic-process.mjs`. It requires exactly
one of `--preview` (read only) and `--execute`; configuration bytes are pinned by
`--configuration` and `--configuration-sha256`. Execution additionally requires
`--authorization` and `--authorization-sha256`. Selecting the default engine does
not allocate a native client; preview and execution retain distinct admissions.
The configuration is closed at the root and includes:

| Field | Required content |
| --- | --- |
| `contract_version`, `instance_id` | `agentic-process-execution.v1`, unique process ID |
| `target_root`, `product_root` | Active project; dedicated product subdirectory |
| `control_root`, `review_root` | Existing, physical, separate external directories |
| `product_files` | Exhaustive bounded relative product-file allowlist; no links, credential files or undeclared output |
| `model`, `criteria`, `authorities`, `skills` | Native-only v1/v2 model, explicit `{path,sha256}` byte pins; authorities require `project` pinned to target AGENTS.md plus the task's authorities; role skill IDs map to supplied procedures |
| `instructions` | Bounded task instruction per activity; cannot choose an executable or authority port |
| `control_scenario` (optional) | Pinned `{path,sha256}` to a v1-only bounded trusted-host scenario; v2 refuses nonempty raw facts/events before native startup |
| `native` | Executable/SHA, existing home, model/effort, read-only tool roots, expected work/review hook hashes and the closed startup configuration |
| `implementation_sha256` | `agenticProcessImplementationPins().sha256`; distributed direct engine sources plus VERSION/package manifest; retain the build lock and exact installed dependency versions separately |
| `controller` | Existing helper path/SHA/source SHA, Node SHA and fixed worker SHA |

Authorization must explicitly set `approved`, `model_allowed`, configuration SHA,
`authorized_at_ms`, `global_deadline_ms`, `workflow_deadline_ms`, `max_turn_ms`,
`max_responses` and `max_bytes`. This file carries an operator's explicit consent;
it is not an independent identity credential or an automatically generated grant.
No configuration, home or authorization artifact is generated by this change.

An existing instance refuses automatic execution and requires operator
reconciliation. An external-event wait is retained without model polling; this
one-batch runner does not implement a durable native-session resume protocol.

An explicitly pinned `agentic-process-control-scenario.v1` can drive that one
batch without polling a model. It supplies `initial_facts` and at most 64
`{after_results,event}` steps, ordered by accepted activity-result count (0–120).
Only existing `message`, `facts` and `cancel` events are accepted; assignments,
verdicts, module paths, timers and callbacks cannot be supplied. The configuration
authorization binds the scenario file SHA, and authority checks revalidate its
bytes. The scenario lives outside product/review roots and creates no authority
by itself. Each delivered event still passes the existing service, exact
canonical CAS, correlation and projection controls. Undeliverable or unused
events refuse rather than silently producing a successful benchmark. An absent
scenario retains the previous durable-wait behavior. This is deterministic host
input for a controlled run, not a broker, timer scheduler or native resume API.
ADR-0014's fresh-attempt rule for the existing supervised task executor remains
unchanged: this process profile does not retrofit persistent
sessions into that executor.

Native initialization has a 90-second ceiling clipped by the original workflow
deadline. Effective permission comparison accepts only known optional null
defaults emitted by the native typed configuration; unknown or non-null policy
changes still refuse. Hooks are explicitly enabled and must remain trusted and
pinned. Check the loaded thread with `hooks/list({threadId})` before any model
turn; a cwd-only inventory does not establish its selected-environment hooks.
Writable roles use a physical `tmp` directory under the admitted product
root for tool temporary files, which must be cleaned before the final product
inventory; protected control files remain inaccessible to model tools.
On elevated Windows, the backend requires root read before a command can start.
The profile therefore protects explicit private directories: the native home,
control output, the original project for review, and optional `native.protected_roots`
(up to 16 physical roots, disjoint from product, review and tool roots). Callers
must include any prior author traces, private evaluator and database directories
outside the current control output. Entire drive denials and the system-owned
Users directory are unsuitable replacements on this backend. Root read leaves
other filesystem locations readable; it is not a product-only read allowlist.
On Windows review denies the broker-owned original product directory itself
and other project children as separate roots (bounded to 512 entries, no
symlinks). Do not also deny an ancestor of that product: an inherited ancestor
denial can be overridden by a preceding explicit workspace grant. Per-file
denials passed precreated canaries but failed on the actual actor-created
corpus, whose Windows ownership can differ. Qualify actual generated files,
including fresh review, snapshot access and both snapshot/original write
refusals. Product-ancestor directory names can remain listable; original
product contents must remain inaccessible.
Before independent review on Windows the trusted broker re-publishes each
declared product file through a newly created staging file and atomic rename.
The exclusive temporary file is a sibling of the product file so publication
works when the control directory resides on another volume. Failed staging is
cleaned; bounded diagnostics retain the filesystem code and a path hash.
It verifies the original, staging and resulting hashes and the complete product
revision, and retains a publication receipt. This changes filesystem metadata,
including creator ownership, but no product bytes. It is part of the explicitly
authorized owned execution and its storage budget. Failure stops review; it
does not permit a weaker reader profile or acceptance of an unverifiable copy.
Native canary checks must qualify the selected denials before claiming that
Windows boundary. This remains narrower than full-client OS confinement.

Protocol references: [Codex App Server](https://learn.chatgpt.com/docs/app-server)
and [Permissions](https://learn.chatgpt.com/docs/permissions). These describe the
protocol; they do not qualify a particular installed binary or Windows backend.

## Verification

The partial standard-workflow bootstrap ports now compose real reload/admission
use cases and local session effects. They remain internal components outside the
ordinary workflow entrypoints. The standard model, authenticated mixed-host
composition, durable recovery and full workflow qualification remain outstanding
under the [standard workflow plan](PLAN_STANDARD_WORKFLOW_PROCESS_IR_2026-11-01.md).
Selecting the default engine does not establish this integration.
An internal operation host journals and authenticates bootstrap, human mode
capture/application and hook finalization through the same reducer, including
result acceptance in a new Node process without business replay. The published
[startup JSON component and traceability](architecture/STANDARD_WORKFLOW_IR_TRACEABILITY.md)
pin their model, code bindings, SPEC and skill sources. The real-port startup
fixtures consume this package asset. Their fixture human/grant capabilities do
not establish the full standard model, native identity or mixed/native resume.

Run `npm run perf:verify-agentic-process`. It exercises the real reducer,
application service and durable artifact stores with portable fixtures. The
execution suite calls the production composition with a fake native wire and
fake outer controller; its host authorities, bindings and canonical store are
real. SQLite runs against real temporary databases; PostgreSQL uses the real
artifact adapter, SQL commands, reservation fence and CAS over an offline SQL
transport double. Files/dual/db-only, outage without fallback, backend drift,
stale revisions, rollback and projection reconciliation are covered. This does
not prove live PostgreSQL concurrency. It also tests the real RPC parser against
in-memory pipes. No Codex
executable, model or network is used by these checks; activation fixtures are
disposable and do not alter installations. These fixtures do not qualify native
policy enforcement, real tree cleanup or provider reception. A separate bounded
pre-release case observed those paths; its scope, retained failure and remaining
NOT_RUN limits are in the [qualification record](https://github.com/leuzeus/aidn/blob/v0.19.0/docs/qualification/agentic-process/v0.19.0.md).
No general performance benefit is inferred, and closed benchmark lots remain closed.

The separate [BPMN v2 candidate benchmark](qualification/agentic-process/bpmn-v2-impact-2026-11-01.md)
executes the XML/IR event, loop, multi-instance and call model with real native
workers and independent review. It retains three earlier failed attempts and one
successful IR/XML pair, including higher observed XML-case time and token usage.
Its sample size and fresh Windows product roots limit the qualification; it does
not establish a general performance gain or same-root reuse after review.

The [controlled follow-up](qualification/agentic-process/bpmn-v2-controlled-2026-11-01.md)
isolates XML above that same delivered agentic reducer using four counterbalanced
cases. Each uses 12 native responses, one author verification command and one
independent review command; unchanged-input verification evidence is reused
within the author context. It records tool/exchange parity as well as functional
results, and distinguishes protocol savings from compiler cost.


### Native host-state evidence

After closing its native clients, the production composition retains a bounded
`native-host-state.v1` evidence object and returns its `native_checkpoint`
reference/hash. It binds host-issued assignments/results, exact instance,
executor identities, writer contributions, native usage and parent-close outcome.
The envelope also retains hashed observed response identities/count and the
authorization hash. It omits prompts and reasoning and uses the existing storage
quota. Interrupted turns retain possible contributors and unknown usage.

This evidence has no resume authority by itself. The parent-close flag is not
the outer supervisor's process-tree proof. Historical authentication, allocation
fencing, cumulative budget admission and an explicit new grant are still required;
the default native launcher continues to refuse a non-pristine instance.

The opt-in journaled allocation composition now supplies that consumer for
native-only v2 graphs. Explicit `resume: true` verifies the signed owned closure,
exact checkpoint, later signed control events, current context, projections and
retained ceilings before reserving another worker. A fresh worker authenticates
its private reservation capability; native model processes receive no key.
Historical results/contributions remain evidence, old resources stay closed and
new sessions carry the writer exclusions into review. Ordinary start, CLI/console
integration remain separate. See
[ADR-0025](ADR/ADR-0025-standard-workflow-runtime-binding.md) for the trust boundary,
deadline limits and qualification distinctions.

### Internal mixed operation/native composition

`createStandardWorkflowMixedHost` composes existing operation, decision, control
and journaled native ports around one v2 model, instance and reducer. It selects
the port for a ready leaf; workflow routing stays in the IR. Deterministic work
and human/external waits require no model call. Writes retain explicit intent,
signed exact previews, trusted grants and authenticated receipts. Native slices
close at an operation boundary and resume with fresh resources under the retained
original ceilings and deadlines.

The versioned `standard-mixed.v1` authority binds the actual project/persistence,
model/source and host key. Reopening verifies every operation/control receipt
and the native checkpoint covered by the signed allocation journal. A native
slice holds the existing worktree effect owner also used by mutating business
ports. Unknown effects or termination retain that owner and require explicit
reconciliation; no PID/time takeover or automatic retry is provided. Legacy
scopes and ordinary CLI/console entrypoints are unchanged.

This internal adapter is a prerequisite for the standard workflow, not the
complete standard model or its qualification. Its offline bootstrap fixture
combines actual application ports with native/provider transport doubles.
Full business coverage, ordinary selection, long-wait budget continuation,
real native isolation/provider channels and exact installed-package acceptance
remain separate deliveries in the integration plan.

### Typed R05 diagnostic component

An internal mixed execution may pin `activity_outputs` to
`{ "diagnostic_node": "standard-drift-report.v1" }`. The node must carry the
exact distributed `drift-check` skill. This selects a fixed host contract; model
data cannot supply a schema or module. Existing activities keep their original
outcome/summary answer. The adapter runs actual drift-check admission before
loading canonical diagnostic context and binds the report to that context.

The deterministic `drift_report_evaluate` binding accepts only a producer
occurrence, not a caller-authored report. It authenticates the accepted native
result through the owned checkpoint, rechecks admission, canonical context and
reported evidence, then emits typed routing facts without another model call.
`changes` describes reported deviations from the objective/baseline; the observed
Git diff remains separate input evidence. Authentication is provenance, not
semantic proof. Evaluation leaves R05 completion pending and grants no recovery
writes or DoR. Human arbitration and authorized recovery artifact changes remain
separate work; clean-report retention and hook finalization use the port below.

The diagnostic receives raw diffs only for configured product files. Other
changes retain hashes/counts, and private roots cannot be delivered as diagnostic
documents. A partial observation emits `drift_context_complete: false` and
`drift_recovery_required: true`; the standard IR must route it to review rather
than finalization. A terminal cycle's completion context requires its actual
closure admission and unique branch ownership; missing/ambiguous or contradictory
context refuses instead of silently using a session objective. The context and
signed evaluation retain their purpose and canonical cycle state. This read does
not reactivate the cycle or admit ordinary work. Neither this component nor its
configuration mapping selects the complete standard workflow by default.

`drift_check_finalize` consumes an accepted evaluation identity under an exact
preview and explicit effect grant. It requires a fresh clean report with complete
observed coverage and the existing gating checks. The application persists the
canonical diagnostic record, invokes the real fixed drift-check hook and verifies
its own newly appended completion event. It publishes `drift_check_completed`
only after those observations; uncertainty retains reconciliation and the local
effect owner. Reopening or replay never repeats a receipted hook. This internal
component does not implement human recovery or select the full standard model.
The producer configuration must still match when consuming its report; a changed
instruction or criterion refuses new evaluation/finalization while leaving
historical inspection available.

### Declarative inputs in v2

An explicitly authored `data_bindings` (`process-data-bindings.v1`) declares
`parameter_keys` and one `inputs` entry (`node_id`, `fields`) for every operation.
Each field uses one closed expression: `literal`, `parameter`, `occurrence_id`,
`operation_id`, `operation_input`, `operation_output` or current collection
`item`. Parameter and journal selections use a bounded `path` array of keys,
not JSONPath or executable code. Operation contracts still validate the result.

Initialize the internal common host with `parameters: { ... }`; those values
remain immutable `initial_parameters` in the instance hash. Subsequent `step`
calls supply no operation input. The host resolves completed predecessors,
authenticates their journal values, retains `input_resolution` in its signed
preview and rechecks it at stage. Normalization belongs to the fixed operation.
Existing models without bindings retain their explicit-input behavior and hashes.

Only structurally preceding sources in the current or an ancestor activation
scope are accepted. Another iteration/item/call cannot silently supply a value.
Implicit compound exports, aggregation and forward/optional-branch dependencies
are refused in this first contract. Durable parameters are data, not permission
or routing approval facts. Grants and business admissions remain required.
This internal mechanism does not yet select a complete standard workflow or add
ordinary CLI/console parameter controls.

The distributed startup and cycle-scaffold models now author these bindings.
Initialize their fixed hosts with `parameters: { session: { session_id,
session_branch, objective } }` and `parameters: { cycle: { session_id, cycle_id,
cycle_type, title, objective } }` respectively. Their `preview` calls take no
operation input. Startup resolves the accepted human decision operation; the
cycle initializer resolves continuity/base from the successful admission journal
and rechecks the actual admission before effects. Later cycle inputs come from
the accepted initialization journal. The common reducer retains all waits and
refusals. These are versioned components of the remaining full standard model,
not an ordinary CLI/console selection of that complete model.
