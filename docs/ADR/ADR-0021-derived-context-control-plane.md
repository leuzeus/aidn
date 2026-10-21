# ADR-0021 - Derived context control plane

## Status

Accepted for derived working memory and explicit opt-in research. Production
native lifecycle distribution and unrestricted model autonomy remain unqualified.

## Date

2026-10-18

## Context

Checkpoint observations already preserve checkout identity and exact evidence.
Context windows are temporary and client capabilities vary. A remembered summary
must not replace canonical runtime state, a fresh admission or the original proof.

## Decision

The runtime backend owns truth; AIDN owns context integrity; the model owns only
its disposable working context. Agent working memory is derived, regenerable and
local to one agent label and worktree. The label is not authenticated identity.
Claims, including `verified_facts`, remain agent assertions with evidence links.
They cannot introduce permissions, effective policies or an admission receipt.

Explicit capture requires `--write`, a successful checkpoint and current
admission. Input, evidence, checkout identity and canonical observation must
remain unchanged during capture. Reuse reads these sources again and returns no
claims after invalidation. Returning a current capsule is not admission to act.

In `dual`, `db-only`, or configured PostgreSQL mode, capture and reuse bind to
fresh canonical payload and runtime heads from one database read transaction.
SQLite uses one read-only connection/transaction; PostgreSQL uses its existing
repeatable-read read-only snapshot. Backend/scope and a stable digest identify
the observation. The SQLite reader's generated observation timestamp and computed
summary are excluded; actual stored content, heads and metadata are retained.
Unavailable canonical state refuses reuse without a Markdown or SQLite fallback.
The observation is not a database lease: another writer can change the backend
after it. Independent fresh admission and write fences remain required.

Memory and bulky local evidence remain under `.aidn/runtime/context/`. They are
not uploaded to coordination, imported into canonical state or automatically
purged. Source artifacts, input hashes and evidence descriptors permit explicit
reconstruction. No new runtime/shared database schema is needed.

Context metrics must distinguish measured bytes, client-reported native tokens
and unknown values. Byte counts cannot establish token savings or window pressure.
No context autonomy may be inferred from a model name or hook schema inventory.
Native rollover and editable transcripts require separate capability qualification.

Response-usage observations are separate from window telemetry: only unique
native completed-response records contribute to cumulative-work totals. Cached
input and reasoning output remain subsets; missing counters remain unknown and
conflicting duplicates refuse aggregation. Input log hashes bind observations,
not authenticity, candidate qualification, admission, financial cost or causal
performance improvements. Internal read-only analysis never changes the source
logs, user installation, canonical state or window-pressure decisions.

Opt-in agent projections retain decisions, refusal/exit semantics, scope and
source revisions, while exact duplicate selected bodies may be shared by
reference within the same response. Different observations are not merged by
assumption. The default full workflow representation remains compatible.
Existing hook raw evidence remains available. Additional full diagnostic
observations require explicit `--write`, are retained as unique local files,
and are described by actual path/hash/bytes only after successful readback.
They have no canonical or admission role, are not automatically purged or shared,
and do not replace fresh action-specific admission. No receipt or token saving
may be inferred merely from an agent view or a content hash.

An explicitly grouped workflow consultation can share one complete canonical
snapshot and each needed shared planning/relay observation within its private
asynchronous invocation. These internal values cannot be supplied through JSON,
cross target roots, survive invocation closure or grant subsequent permission.
Admissions remain distinct. Only admitted skills contribute to common hydration;
a global coordinator stop prevents it. Fresh backend reads and the existing
local context/activation revision fence refuse publication after material change.
The hidden hydration cache is not written in this path; an explicitly requested
diagnostic receipt is retained only after the fence. Native writes retain their
independent fresh admission, CAS and reservation checks. Initialized Git and
canonical runtime paths bound the initial opt-in implementation; unavailable
revision capture refuses rather than claiming a coherent observation.

Within grouped consultation, dual-mode runtime digests follow canonical DB
authority consistently across admissions, coordinator and hydration. Checkout
rules remain checkout-bound in every mode. A stale indexed/store rule copy, or
stale selected files-mode text/state reference, refuses the consultation instead
of presenting it as current. Repair is a separate explicitly authorized write;
no automatic synchronization or canonical-authority change is implied. Refused
agent invocations after common activation dispatch have their own compact
versioned diagnostic contract and do not publish a source revision or admission
receipt. Common activation refusals retain the existing CLI boundary contract.

The experimental `token-efficiency.v1` workflow profile derives the union of
known admitted skills' context needs from client-owned accepted adoption data.
Its `taskContextPolicies` extension declares a stable mandatory minimum and
additive per-skill/task obligations. Operation/path labels cannot remove that
minimum, accept an authority or grant admission. Existing complete Markdown
selection enforces the accepted unit bindings, scope and dependency closure.
Unknown skills or missing mappings retain the full historical selection path;
an invalid/effectively unaccepted declared policy refuses instead of inventing
authority. Changing a client's effective policy requires its adoption revision
and history procedure; no installed policy is silently populated.

The profile budgets the final compact command JSON after transport metadata and
actual retained-receipt references. It first omits optional closure, then refuses
with measured expansion requirements if the mandatory response exceeds target.
No successful response silently splits a mandatory authority. Refusal diagnostics
may themselves exceed the requested limit; that is explicitly reported rather
than deleting an admission, blocker or stop. These experimental byte limits do
not represent native tokens, window pressure or successful performance targets.
Its agent projection factors compact source identity metadata into a
scope/path/hash-bound table. Parsed whole-document bodies and derived runtime or
session contexts do not bypass task selection through metadata. Complete selected unit bodies remain explicit;
metadata references are checked when accepting a baseline and unused entries
are removed during budget pruning. Full diagnostic receipts retain original data.

Differential consultation uses a caller-held complete prior selection only as
an optimization hint. All mandatory authorities and their dependency closure
are freshly returned. Only unchanged optional bodies can be replaced by exact
references; invalid scope or integrity falls back to complete current selection.
The grouped CLI accepts only a bounded caller-held complete prior agent response
as its baseline hint. Its body/reference graph is checked before the existing
unit-integrity and fresh scope/dependency checks. Missing, corrupt or partial
baselines reconstruct freshly; a cached authority never repairs a missing current
one. Typed history transitions preserve distinct execution references and never
change the audit store. Only identical decisions with known files-context bindings
collapse; unavailable canonical revision data stays separate. Historical reuse
labels never authorize a write, and current admission remains independent.
An experimental procedure pack shares a stable common instruction prefix and
task routes for grouped consultation, admitted work and ordered closure. It is
packaged outside the ordinary installed skill tree and requires explicit research
host selection. Batching preserves actual control executions and stops dependent
actions on refusal; no host observation becomes a reusable write authorization.
Default procedures and user profiles remain unchanged until native qualification.
Raw observations remain data. Typed execution handoffs bind local result
identifiers without asserting authenticated execution or a current lease.

An injected lifecycle candidate composes checkpoint/resume/window ports, with
default harness fallback, exact identity/version qualification and expiry.
Fixture qualifications never enable a native integration. A manual research
qualifier can run an isolated native app-server with a reviewed read-only
`notes.thread_hint` bridge. Its fresh capsule is untrusted data, not a permission
or model qualification. This installs nothing into a user's working profile.
No distributed compaction hook is enabled by this decision.
Native research hook intent is invocation-local and explicitly forwarded through
the client's per-thread config port. It never writes persistent trust. Native
completion waits bind exact turn IDs, including the compact turn before any
continuation. Ordinary-untrusted and core-admission-denial controls are required
alongside positive lifecycle observations; a discovered hook or request
acknowledgement cannot substitute for actual action completion.

An opt-in in-memory editable-input experiment protects the complete system/task
prefix, requires an exact model/tokenizer binding and fresh source revision,
validates transformations and the complete input token budget, then commits a
preimage, audit entry and replacement atomically. Rollback retains audit history.
This is an internal research primitive, not native transcript editing or a
durable store. Its synthetic tokenizer fixtures do not qualify OpenAI token
counting. Without a verified tokenizer and model revision, a native full-CLM
experiment remains unavailable.

A separate local research host can supply that missing interface without
editing Codex internals. A reviewed hash-pinned GGUF binds weights and tokenizer;
the same native runner tokenizes the complete rendered input and consumes those
exact token IDs. Template delimiters are host-owned, observation delimiters are
escaped, and no hidden chat template or implicit context shift is permitted.
Every replacement still crosses the protected-prefix, critical-evidence,
fresh-source, native-budget, preimage and rollback controls. A model's output
schema may bound edit size but must never contain the expected benchmark answers.

The local runner starts suspended and joins a Windows Job before execution:
one process, kill-on-close and a committed-memory cap. A separate available
physical-memory reserve and deadline stop the owned process on pressure. CPU
execution, loopback-only binding and a temporary API key avoid using a shared
model service or a user's authentication. Raw failed exchanges remain evidence;
a malformed answer or exhausted output reserve cannot grant a capability.

A trusted host may admit `local-token-input-v1` only for the exact dedicated
`aidn-local-clm`/`local-llama.cpp` identity, all nine native cases, successful
continuation, native input budget, protected evidence and native rollback proof.
The evidence hash binds the host, weights/tokenizer, runtime and cleanup. An
expired, ambiguous, incomplete or fixture record still falls back to harness.
The local input port grants no Codex hooks or `new_context`, no writes and no
global registration. It is a bounded research qualification, not unrestricted
context autonomy or general model-quality certification.

External-pilot qualification uses an existing activated project and current
canonical state, never a converted fixture presented as an installed client.
Only unique ignored working-memory/cache outputs are written. A trusted local
corpus manifest binds real sources, task and expected results to the host
identity. Fresh admissions, all existing native controls and final preservation
of project sources, preexisting runtime and canonical revision remain mandatory.
Application-test acceptance is independent of diagnostic continuity. Pilot
identifiers and raw code/logs remain local-only; this path changes no public
CLI, default backend, user profile or distribution policy.

## Consequences and validation

Conservative full-revision invalidation can discard useful notes after unrelated
changes. It favors reconstruction over silent authority drift. Multiple local
capsules and raw observations cost storage; retention never deletes raw proof.

CLI and adapter fixtures prove the explicit capture/reuse/refusal boundary.
Repeated-window fixtures measure deterministic retention, not model quality.
PostgreSQL fake clients prove SQL and orchestration decisions, not live isolation.
Native hooks, model comparisons and installed-package qualification remain
separate evidence recorded in the execution plan and the
[native qualification record](../qualification/CONTEXT_CONTROL_PLANE.md).
