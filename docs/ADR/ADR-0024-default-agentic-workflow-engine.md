# ADR-0024 — Structured agentic engine as the workflow default

## Status

Implemented in source; offline application/CLI/console and production-host
fixtures verify adoption. Existing native qualification remains bounded to its
recorded implementation. Installed clients require a normal package update;
this decision does not assert deployment or public-archive qualification.

## Decision

The delivered structured agentic engine is the default for every new workflow,
independently of whether its model was authored as JSON or compiled from BPMN.
This supersedes ADR-0022's opt-in composition status. It does not create another
engine or rename `structured-agentic-process.v1` / `agentic-process-model.v1`.

The common application composition, console initialization and public
`aidn runtime workflow-run` select `agentic` when no engine is specified.
Project `runtime.workflowEngine` or an explicit operation/CLI selector may
select `legacy`. Sequential definition selection remains a compatibility API;
initializing a new selected sequential instance requires explicit legacy choice.

Historical record contracts select their own readers even after the default
changes. No migration, reinterpretation or automatic fallback occurs. If both
formats use an ID, an unqualified exact read refuses ambiguity. Existing
`agent-run*` commands retain their explicit sequential lifecycle semantics.

The ordinary execution entry delegates to the existing owned native runner.
Preview/JSON allocates no native session and writes nothing. Execution requires
an unchanged target/configuration/product preview, explicit authorization and
the runner's existing policy pins, budgets, native readiness and closure checks.
The console cannot provide a model-selected module, fabricated assignment or
self-authenticated result. Configured persistence remains authoritative and
PostgreSQL optional; selecting an engine does not synchronize shared relays.

A pristine console-created initial checkpoint can enter the owned host only
when its exact initial hash matches model, facts, scope and policies. Any prior
event or binding change requires reconciliation; this is not general resume.
Admission/context tools retain their observational purpose and never start a
model call from an ordinary context refresh.

## Validation and rollback

The required agentic-process gate covers default JSON creation, real CLI dispatch,
console preview/application, exact preview refusal, historical readers, explicit
compatibility selection and initial-checkpoint admission into the production
host with a fake native wire. Existing sequential and console regression suites
remain separate. Native/provider calls are not required to prove selection.

Explicit `legacy` selection restores new sequential creation/execution. Retain
the agentic versioned reader and journal for existing agentic instances; changing
the default never rewrites or erases their state.
