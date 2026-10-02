# Explicit workflow segment execution

Lot 3 connects a selected `agent_segment` to the existing `agent-run*` lifecycle.
Configuration v1 and all existing command defaults retain their behavior.
The feature is a supervision candidate subject to
[native qualification](AGENT_EXECUTION_NATIVE_QUALIFICATION.md).

## Prepare a run-local binding

At an already admitted client task, prepare a valid frozen agent plan and the
existing pinned native configuration. Use the pure internal
`src/core/workflow/workflow-segment-binding.mjs` factory with explicit inputs:

```js
const workflow = bindWorkflowSegment({
  definition,               // workflow-definition.v1
  context,                  // workflow-shadow-context.v1
  stepId: "correction",     // an agent_segment in the compiled graph
  canonical: rawPlan.canonical,
  revision: 1,
});
const configuration = {
  ...nativeConfiguration,
  contract_version: "agent-run-configuration.v2",
  workflow,
};
delete rawPlan.plan_sha256;
rawPlan.supervision = {
  configuration_sha256: fingerprintAgentExecutionValue(configuration),
};
const plan = normalizeAgentExecutionPlan(rawPlan);
```

The factory does no I/O. This snippet shows preparation order, not an admission
procedure or a command to run in the package source repository. Persist the
exact configuration and plan as explicit client inputs using the existing
preparation process. The context must match the executing package product
version, workflow version 7 and configured state mode. A configuration alone
does not establish installation, activation or native qualification.

Binding v1 retains the definition and context, selected step, positive binding
revision, canonical digest, definition and compilation hashes, compiler version,
registry version/hash and its own content digest. The canonical digest covers
the existing project/workspace/runtime scope, session/cycle, task selector,
planning revision, activation and scope. The plan schema stays closed; no field
is inserted into an existing plan version. Retain the configuration with run
evidence because PostgreSQL stores the plan's configuration hash, not a second
copy of the configuration.

## Preview and apply

Use the existing public commands with the prepared client paths:

```text
aidn runtime agent-run --target <client> --configuration <configuration.json> --plan <plan.json> --json
aidn runtime agent-run --target <client> --configuration <configuration.json> --plan <plan.json> --execute --expect-plan <action_sha256> --sync-relay --json
```

The preview exposes the selection at `action.preconditions.workflow`, including
the exact agent plan hash, binding and definition revisions, compiler/registry
pins and `macro_progress: not_evaluated`. This selection envelope has contract
`workflow-segment-selection.v1`; the existing public JSON root remains v1.
The approval token is the whole action hash. Changes to the binding, definition,
plan, material prerequisites or activation invalidate it. Preview is read-only;
`--json` does not grant permission to write or execute.

The canonical reservation, native admission and existing bounded scheduler
remain mandatory. Definition selection does not satisfy the graph's human
decisions or prove earlier macro steps completed. The scheduler executes only
the supplied frozen plan, preserving task dependencies and the existing
acceptance, integration, validation and termination evidence.

Status, cancel, resume and cleanup use the same exact configuration and run ID.
A changed binding needs a new configuration, plan and run after normal admission;
it cannot rebind an active run. Compiler/registry drift refuses launch and
productive resume. Historical operations show `validation: retained` without
recompilation; they still enforce configuration and canonical pins and their
usual cancellation, reconciliation or cleanup checks.

## Evidence

`perf:verify-workflow-segment` covers pure binding and the real lifecycle and
scheduler with injected execution/store adapters. It also checks the real public
composition's no-PostgreSQL refusal on a disposable client directory.
The required PostgreSQL lifecycle fixture covers real JSONB retention and public
status/cancellation, with direct composition checks for preview and context drift
on a client fixture without an installation. Such previews must report missing
activation and native prerequisites. None of these fixtures qualifies native
Codex or supplies proof of a durable macro workflow.

See [ADR-0017](ADR/ADR-0017-explicit-workflow-segment-selection.md) and
[pure compilation](WORKFLOW_SHADOW_COMPILATION.md).
