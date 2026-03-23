# Plan - Subagent Plugin Observability

Date: 2026-03-16
Status: proposed
Scope: add subagent plugins for multi-agent dispatch in `dual` / `db-only`, with observability as a hard architectural constraint.

## Summary

Introduce subagent plugins attached to the fixed top-level roles of `aidn` without changing the current role model:

- `coordinator`
- `executor`
- `auditor`
- `repair`

The target use case is role specialization such as:

- parent agent: `auditor`
- subagent plugin: `security-auditor`

This feature is intentionally limited to:

- `dual`
- `db-only`

It is intentionally not executed in:

- `files`

The reason is architectural, not merely incremental scope reduction:

- `dual` and `db-only` already have authoritative runtime enforcement
- they already persist structured execution context under `.aidn/runtime/context/`
- they already project runtime digests from machine-readable state
- they already treat DB-backed runtime information as the primary enforcement path

The primary success criterion is not only that subagents can run.
It is that every subagent decision, warning, block, execution, failure, and finding becomes observable in a way consistent with the existing tracking of parent dispatches.

## Problem Statement

`aidn` currently supports:

- fixed top-level agent roles
- adapter-based agent selection
- structured coordinator dispatch planning
- structured dispatch execution history
- projected digests such as:
  - `AGENT-HEALTH-SUMMARY.md`
  - `AGENT-SELECTION-SUMMARY.md`
  - `COORDINATION-SUMMARY.md`
  - `MULTI-AGENT-STATUS.md`

It does not yet support:

- role-specialized subagents attached to a parent agent
- hook-based subagent execution before or after parent dispatch
- explicit observability for nested agent-like behavior
- reliable detached subagent execution with persistent queue semantics

Without an observability-first model, subagents would create a new class of opaque routing and blocking behavior that conflicts with the core runtime direction of `aidn`.

## Goals

Add a subagent plugin model that:

- allows specialization under existing top-level roles
- supports hook-based execution around parent dispatch
- supports multiple subagents on the same hook
- distinguishes between:
  - waiting for a subagent
  - allowing a subagent to influence the parent outcome
- preserves deterministic ordering
- persists structured execution traces and findings
- projects human-readable digests from runtime data
- remains safe and explainable in `dual` and `db-only`

## Non-Goals

- no change to the fixed top-level role model in v1
- no execution of subagents in `files`
- no generic plugin system for every runtime hook in v1
- no support for detached gating decisions
- no new standalone detailed findings artifact in v1
- no hidden best-effort detached process model

## Architectural Principle

Observability is a design invariant.

The feature must not introduce decisions that exist only in prose or logs.
Every relevant execution fact must exist in machine-readable form first, then be projected into digests.

This applies to:

- plugin selection
- hook eligibility
- execution ordering
- execution mode
- gating decisions
- findings
- queue state
- failures

## Recommended Target Model

### 1. Separate `SubAgentPlugin` Contract

Add a new contract independent from `AgentAdapter`.

Required methods:

- `getProfile()`
- `supports({ hook, parentRole, action })`
- `runHook({ hook, targetRoot, stateMode, recommendation, dispatch, selectedAgent, context, job })`

Optional methods:

- `checkEnvironment(...)`

Required profile fields:

- `id`
- `label`
- `parent_role`
- `supported_actions`
- `supported_hooks`
- `execution_mode`
- `decision_power`

### 2. Hook Surface

Limit the v1 hook surface to coordinator dispatch:

- `before_dispatch`
- `after_dispatch`

Do not attach subagents to generic workflow hooks such as:

- `start-session`
- `close-session`
- `requirements-delta`
- `promote-baseline`

This keeps the first implementation anchored to the existing multi-agent runtime instead of mixing it with the broader workflow gating model.

### 3. Execution Mode vs Decision Power

Treat these as separate concepts.

#### Execution mode

- `await`
- `detached`

#### Decision power

- `gating`
- `advisory`

#### Allowed combinations in v1

- `before_dispatch` + `await` + `gating`
- `before_dispatch` + `await` + `advisory`
- `after_dispatch` + `await` + `advisory`
- `after_dispatch` + `detached` + `advisory`

Forbidden combinations in v1:

- `before_dispatch` + `detached`
- `detached` + `gating`

Design rule:

- only `await` plugins may influence the parent dispatch outcome
- detached plugins never block or rewrite the already-chosen parent outcome

### 4. Result Normalization

Each plugin execution returns:

- `status`
- `summary`
- `findings`
- `notes`

Normalized statuses:

- `skip`
- `ok`
- `warn`
- `block`
- `error`

If a plugin violates its declared power model:

- advisory plugins cannot produce an effective `block`
- detached plugins cannot produce an effective `block`

Such cases are normalized to `error` and surfaced as plugin contract violations.

### 5. Multiple Subagents On One Hook

Support multiple subagents on the same hook.

Resolution order:

1. filter by `parent_role + action + hook`
2. keep only `enabled` and environment-compatible plugins
3. sort by `priority DESC`, then `id ASC`
4. execute all `await` plugins first
5. reduce the effective result using severity aggregation
6. persist detached jobs only if the parent has not already been blocked

Aggregation rule:

- `block > error > warn > ok > skip`

Operational rule:

- all findings are preserved
- the effective hook outcome is the most severe awaited result
- short-circuit is allowed after a `block` on `before_dispatch`

### 6. Dedicated Configuration

Do not overload `AGENT-ROSTER.md`.

Add:

- `docs/audit/SUBAGENT-ROSTER.md`
- `docs/audit/SUBAGENT-PLUGINS.md`

Each roster entry should include:

- `enabled`
- `priority`
- `parent_role`
- `actions`
- `hooks`
- `execution_mode`
- `decision_power`
- `plugin_module`
- `plugin_export`
- `notes`

Install one disabled example:

- `.aidn/runtime/subagents/example-security-auditor.mjs`

## Observability Model

### 1. Shared Vocabulary

Parent dispatches and subagent runs should share a common observability vocabulary:

- `status`
- `started_at`
- `ended_at`
- `duration_ms`
- `blocking`
- `findings_count`
- `source_dispatch_run_id`

The physical persistence may differ in v1, but the meaning of these fields must remain coherent across parent and subagent execution.

### 2. Machine-Readable First

Preserve the existing parent dispatch stream:

- `.aidn/runtime/context/coordination-history.ndjson`

Add a dedicated subagent execution stream:

- `.aidn/runtime/context/subagent-history.ndjson`

Recommended subagent events:

- `subagent_run_started`
- `subagent_run_completed`
- `subagent_run_failed`
- `subagent_job_queued`
- `subagent_job_started`
- `subagent_job_completed`
- `subagent_job_failed`

Each event should include:

- `ts`
- `event`
- `plugin_id`
- `parent_role`
- `action`
- `hook`
- `execution_mode`
- `decision_power`
- `status`
- `blocking`
- `findings_count`
- `source_dispatch_run_id`
- `job_id` when applicable
- `summary`

### 3. DB Persistence

Add additive SQLite tables:

- `subagent_jobs`
- `subagent_runs`
- `subagent_findings`

#### `subagent_jobs`

- `job_id`
- `plugin_id`
- `parent_role`
- `action`
- `hook`
- `source_dispatch_run_id`
- `status`
- `payload_json`
- `created_at`
- `started_at`
- `ended_at`
- `error_message`

#### `subagent_runs`

- `run_id`
- `plugin_id`
- `parent_role`
- `action`
- `hook`
- `execution_mode`
- `decision_power`
- `status`
- `blocking`
- `summary`
- `findings_count`
- `source_dispatch_run_id`
- `job_id` nullable
- `started_at`
- `ended_at`
- `duration_ms`

#### `subagent_findings`

- `finding_id`
- `run_id`
- `plugin_id`
- `severity`
- `code`
- `message`
- `suggested_action`
- `evidence_ref`
- `created_at`

### 4. Detached Execution

Detached execution must use a persisted queue, not best-effort local background processes.

Add:

- queue-backed `subagent_jobs`
- a dedicated runner command

Suggested command:

- `aidn runtime run-subagent-jobs --target . --json`

State progression:

- `queued`
- `running`
- `completed`
- `failed`
- `canceled`

This is required so detached work remains:

- reliable
- inspectable
- restartable
- projectable into runtime digests

## Runtime Integration

### 1. Dispatch Flow

The current dispatch flow remains:

- state -> recommendation -> adapter selection -> dispatch execution

The subagent layer is inserted around parent dispatch:

- `before_dispatch` after parent selection and before parent execution
- `after_dispatch` after successful parent execution

Rules:

- `before_dispatch` block stops the parent
- `before_dispatch` warn does not stop the parent
- `after_dispatch` awaited plugins enrich final state before projection
- `after_dispatch` detached plugins create jobs and do not delay final parent result

### 2. Mode Handling

Subagent execution is enabled only in:

- `dual`
- `db-only`

In `files`:

- configuration may exist
- validation may expose that configuration
- execution must not occur
- runtime outputs must say `inactive_due_to_state_mode`

## Human-Readable Projection

Do not add a dedicated findings report in v1.

Enrich existing digests instead.

### `RUNTIME-STATE.md`

Add:

- `subagent_status`
- `subagent_blocking_count`
- `subagent_warning_count`
- `subagent_queued_jobs`
- `subagent_failed_jobs`
- `last_subagent_run_at`

### `MULTI-AGENT-STATUS.md`

Add:

- matched plugins for the recommended parent role/action
- latest `before_dispatch` aggregate result
- latest subagent runs
- detached queue state
- recent critical and warning findings

### Hydrated runtime context

Add:

- `subagent_summary`
- `matched_before_dispatch_plugins`
- `matched_after_dispatch_plugins`
- `blocking_subagent_findings`
- `queued_subagent_jobs`

## CLI Surface

Add:

- `aidn runtime verify-subagent-roster --target . --json`
- `aidn runtime list-subagent-plugins --target . --json`
- `aidn runtime run-subagent-jobs --target . --json`

These commands should mirror the existing operational model used for agent adapters:

- verify contract
- load modules
- probe environment
- show routing eligibility
- expose structured health information

## Risks

### Risk 1 - Hidden nested decision logic

If subagents can influence dispatch without structured traces, `aidn` loses explainability.

### Risk 2 - Detached execution without queue guarantees

If detached plugins run as best-effort child processes, observability and reliability both degrade.

### Risk 3 - Divergent status vocabularies

If parent dispatch and subagent execution describe status differently, digests become hard to trust.

### Risk 4 - Scope creep into generic runtime hooks

If the first slice includes every workflow hook, the model becomes harder to reason about before the subagent runtime is proven in the coordinator path.

## Acceptance Criteria

This feature is successful when:

- multiple subagents can attach to the same parent hook deterministically
- only awaited plugins can block parent dispatch
- detached plugins are always visible through queue and run state
- every subagent run is persisted in machine-readable form
- every subagent block or warning is visible in runtime digests
- `dual` and `db-only` behave consistently
- `files` explicitly refuses execution rather than silently degrading

## Recommended First Slice

Implement the smallest safe slice first:

1. define `SubAgentPlugin`
2. add `SUBAGENT-ROSTER.md`
3. support `before_dispatch` awaited plugins only
4. persist runs and findings
5. project summary into `MULTI-AGENT-STATUS.md` and `RUNTIME-STATE.md`

Then extend to:

6. `after_dispatch`
7. detached jobs
8. queue runner

This preserves the observability-first architecture while keeping the first delivery small enough to verify.
