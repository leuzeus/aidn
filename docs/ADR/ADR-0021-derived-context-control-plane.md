# ADR-0021 - Derived context control plane

## Status

Proposed; explicit working-memory implementation under qualification.

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

Differential consultation uses a caller-held complete prior selection only as
an optimization hint. All mandatory authorities and their dependency closure
are freshly returned. Only unchanged optional bodies can be replaced by exact
references; invalid scope or integrity falls back to complete current selection.
Raw observations remain data. Typed execution handoffs bind local result
identifiers without asserting authenticated execution or a current lease.

## Consequences and validation

Conservative full-revision invalidation can discard useful notes after unrelated
changes. It favors reconstruction over silent authority drift. Multiple local
capsules and raw observations cost storage; retention never deletes raw proof.

CLI and adapter fixtures prove explicit capture/reuse/refusal, canonical
observation, nullable metrics and differential consultation boundaries. Native
hooks and model-input editing remain separate future qualification.
