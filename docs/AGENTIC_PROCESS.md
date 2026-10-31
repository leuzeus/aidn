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

`structured-agentic-process.v1` is an opt-in internal application API. It is
separate from shadow workflow descriptions and existing sequential instances.
Existing callers and installed projects keep their behavior. The explicit owned
runner below composes a native adapter; importing the engine or loading a model
does not start a client or change an installed activation.

The package's source startup contract and minimal workflow kernel also instruct
agents to retain the current execution for compatible roles, without changing
admission requirements. The reviewer source profile requires checking rather
than assuming independence. These assets apply through a future explicit normal
installation/upgrade; this change does not edit an installed project.

## Model

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
| BPMN XML import/export | no | No XML interpreter or import qualification |

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
`--authorization` and `--authorization-sha256`. Nothing is activated by default.
The configuration is closed at the root and includes:

| Field | Required content |
| --- | --- |
| `contract_version`, `instance_id` | `agentic-process-execution.v1`, unique process ID |
| `target_root`, `product_root` | Active project; dedicated product subdirectory |
| `control_root`, `review_root` | Existing, physical, separate external directories |
| `product_files` | Exhaustive bounded relative product-file allowlist; no links, credential files or undeclared output |
| `model`, `criteria`, `authorities`, `skills` | Explicit `{path,sha256}` byte pins; authorities require `project` pinned to target AGENTS.md plus the task's authorities; role skill IDs map to supplied procedures |
| `instructions` | Bounded task instruction per activity; cannot choose an executable or authority port |
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
ADR-0014's fresh-attempt rule for the existing supervised task executor remains
unchanged: this separate opt-in process profile does not retrofit persistent
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
disposable and do not alter installations. Native policy enforcement, real tree
cleanup and provider reception remain NOT_RUN. No consumption metric or
performance benefit is inferred, and closed benchmark lots remain closed.
