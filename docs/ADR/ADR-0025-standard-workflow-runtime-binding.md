# ADR-0025 — Typed host operations in the common process IR

## Status

L1 contract foundation implemented under the
[standard workflow plan](../PLAN_STANDARD_WORKFLOW_PROCESS_IR_2026-11-01.md).
Versioned operation contracts, reducer events and trusted service ports are
implemented and verified offline. The standard model, actual business adapters,
authenticated external inbox, general owned-host resume and installed/native
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

The existing native-only owned composition explicitly refuses the v2 profile
before allocating native resources. It must not send an operation node to a model
or assume all v2 activities can use its current native context. L2–L5 will compose
the mixed execution host and ordinary standard entrypoints.

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
