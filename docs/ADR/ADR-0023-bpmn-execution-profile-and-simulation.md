# ADR-0023 — BPMN profile compilation and shared-reducer simulation

## Status

Implemented as an explicit internal API with tracked offline fixtures.

## Context

ADR-0022 supplies a structured executable IR, replayable process instances and
trusted resource assignment. BPMN operating views have no formal translation
to that code. Modeling, execution state and resource allocation need a precise
boundary so that diagrams and simulation do not invent runtime semantics.

## Decision

Add `aidn-bpmn-structured.v1`, a bounded, single-process XML compilation profile,
through a namespace-aware SAX adapter and pure structured graph compiler.
Translate tasks, sequences and paired XOR/AND/OR blocks into the existing
`agentic-process-model.v1`. Refuse unsupported semantics and unstructured graphs.
Publish exact source/model hashes and a source-to-IR map in the closed internal
`bpmn-process-compilation.v1` envelope. Full XSD validation is not claimed.

Keep role/policy definitions as explicit caller inputs, referenced by versioned
XML extensions. A lane never allocates an agent; a gateway controls readiness.
Native execution still requires the existing host authority, binding, policy
pins, assignment and authenticated result checks. Compilation grants no writes.

Add `agentic-process-simulation.v1` as a bounded synthetic event replay over
`createAgenticProcess`, `advanceAgenticProcess` and `inspectAgenticProcess`.
Keep the same reducer and event vocabulary. Return stepwise cursors and hashes,
explicitly marked synthetic and without write authorization. No second control
engine, wall-clock scheduler, new CLI or native host is added.

The complete mapping, accepted XML, diagnostics, limits and API examples live in
[the execution profile](../BPMN_EXECUTION_PROFILE.md). Existing IR-only event,
loop, multi-instance and call support remains separate from XML compiler support.
Cross-participant collaboration and durable timers require future contracts.

## Authority and compatibility

Compiled values/source maps are derived in memory. Simulation is reference
evidence. Retained models and events stay under the existing governed
`agentic_process_instance` concept, metadata and canonical artifact backend.
No migration, automatic installation/activation or new durable state is added.
An XML edit never changes historical instance semantics or required policy pins.
ADR-0022's direct XML refusal is superseded only for this explicit compiler;
the process reducer still consumes validated IR, never XML.

## Validation and rollback

The existing required `runtime-agentic-process` gate includes compiler/schema,
negative XML/graph fixtures, nested blocks and end-to-end simulation parity,
alongside the original reducer, service and execution-composition fixtures.
These do not qualify a graphical editor, general BPMN conformance, new native
execution, installed archive or live PostgreSQL concurrency.

Stop calling the compiler/simulator to roll back adoption. Existing pinned v1
models and journals continue using their current reader; there is no automatic
conversion, data removal or historical reinterpretation.
