# Backlog Subagent Plugin Observability - 2026-03-16

## Goal

Track the concrete work required to add observable subagent plugins around multi-agent dispatch in `dual` / `db-only` without weakening `aidn` runtime explainability.

Reference plan:

- `docs/PLAN_SUBAGENT_PLUGIN_OBSERVABILITY_2026-03-16.md`

## Backlog Items

### SPO-01 - Define `SubAgentPlugin` Contract

Status: pending
Priority: high

Why:

- subagents need a first-class interface separate from `AgentAdapter`

Done when:

- one explicit contract exists for:
  - plugin profile
  - hook support
  - hook execution
  - optional environment checks
- the contract includes:
  - `execution_mode`
  - `decision_power`
  - `supported_hooks`

### SPO-02 - Define Hook Policy And Allowed Combinations

Status: pending
Priority: high

Why:

- waiting for a plugin and allowing it to block are different concerns

Done when:

- v1 hook scope is explicitly limited to:
  - `before_dispatch`
  - `after_dispatch`
- allowed combinations are enforced:
  - `before_dispatch` + `await` + `gating`
  - `before_dispatch` + `await` + `advisory`
  - `after_dispatch` + `await` + `advisory`
  - `after_dispatch` + `detached` + `advisory`
- forbidden combinations fail validation

### SPO-03 - Add Dedicated Subagent Roster And Docs

Status: pending
Priority: high

Files:

- `docs/audit/SUBAGENT-ROSTER.md`
- `docs/audit/SUBAGENT-PLUGINS.md`
- installed example plugin path

Why:

- subagent configuration should not overload the parent agent roster in v1

Done when:

- installed projects receive a dedicated subagent roster
- docs explain:
  - parent role binding
  - hook binding
  - execution mode
  - decision power
- one disabled example plugin is installed

### SPO-04 - Add Subagent Roster Verification

Status: pending
Priority: high

Why:

- invalid hook or power combinations must fail before runtime dispatch

Done when:

- `aidn runtime verify-subagent-roster --target . --json` exists
- it validates:
  - module path
  - export name
  - profile shape
  - hook compatibility
  - execution_mode / decision_power compatibility
  - environment readiness

### SPO-05 - Add Subagent Discovery / Listing CLI

Status: pending
Priority: medium

Why:

- operators need to inspect which plugins are actually eligible for a given runtime

Done when:

- `aidn runtime list-subagent-plugins --target . --json` exists
- output includes:
  - loaded plugins
  - health / environment state
  - matched hooks
  - ordering inputs such as priority

### SPO-06 - Add Awaited `before_dispatch` Execution Path

Status: pending
Priority: high

Why:

- this is the smallest safe slice for real nested gating

Done when:

- parent dispatch runs awaited `before_dispatch` plugins before execution
- aggregation uses:
  - `block > error > warn > ok > skip`
- `block` stops the parent dispatch
- all findings remain available even when a block occurs

### SPO-07 - Persist Subagent Runs And Findings

Status: pending
Priority: high

Why:

- observability requires structured runtime persistence, not just in-memory hook results

Done when:

- SQLite contains:
  - `subagent_runs`
  - `subagent_findings`
- `.aidn/runtime/context/subagent-history.ndjson` is written
- each run stores:
  - plugin identity
  - hook
  - status
  - blocking
  - findings count
  - parent dispatch linkage

### SPO-08 - Expose Subagent Summary In Runtime Digests

Status: pending
Priority: high

Why:

- nested execution must be visible without opening raw DB tables

Done when:

- `RUNTIME-STATE.md` exposes subagent counters and status
- `MULTI-AGENT-STATUS.md` exposes:
  - matched plugins
  - latest aggregate hook result
  - recent findings
- hydrated runtime context includes `subagent_summary`

### SPO-09 - Add `after_dispatch` Awaited Advisory Plugins

Status: pending
Priority: medium

Why:

- some role-specific analysis should run after parent dispatch without affecting dispatch admission

Done when:

- awaited advisory `after_dispatch` plugins execute after successful parent dispatch
- their findings are persisted and projected
- they never rewrite the already-decided parent execution outcome

### SPO-10 - Add Persisted Detached Job Queue

Status: pending
Priority: high

Why:

- non-awaited subagent execution must remain reliable and observable

Done when:

- SQLite contains `subagent_jobs`
- detached plugins create `queued` jobs instead of best-effort child processes
- job states include:
  - `queued`
  - `running`
  - `completed`
  - `failed`
  - `canceled`

### SPO-11 - Add Detached Job Runner

Status: pending
Priority: medium

Why:

- queued work is useless without an explicit runner

Done when:

- `aidn runtime run-subagent-jobs --target . --json` exists
- it consumes queued jobs and persists run/finding results
- failed jobs remain inspectable after runner exit

### SPO-12 - Enforce `dual` / `db-only` Only Execution

Status: pending
Priority: high

Why:

- the feature depends on DB-backed runtime observability and should not silently degrade in `files`

Done when:

- subagent execution is refused in `files`
- runtime output returns an explicit inactive status such as `inactive_due_to_state_mode`
- `dual` and `db-only` remain the only execution-capable modes

### SPO-13 - Align Parent / Subagent Observability Vocabulary

Status: pending
Priority: medium

Why:

- nested runtime traces become hard to trust if parent dispatches and subagent runs speak different status dialects

Done when:

- parent dispatch and subagent outputs share a consistent vocabulary for:
  - `status`
  - `blocking`
  - `findings_count`
  - `started_at`
  - `ended_at`
  - `duration_ms`
  - `source_dispatch_run_id`

### SPO-14 - Add Migration Coverage For New SQLite Tables

Status: pending
Priority: medium

Why:

- `dual` / `db-only` delivery requires an additive migration path, not opportunistic table drift

Done when:

- schema migration coverage proves:
  - creation of `subagent_jobs`
  - creation of `subagent_runs`
  - creation of `subagent_findings`
- existing workspaces upgrade without destructive reset

### SPO-15 - Add Runtime / Projection Verifiers

Status: pending
Priority: high

Why:

- this feature is only safe if observability regressions are caught automatically

Done when:

- fixtures verify:
  - no-plugin baseline
  - multi-plugin aggregation
  - blocking `before_dispatch`
  - awaited advisory `after_dispatch`
  - detached queue lifecycle
  - parity between `dual` and `db-only`
  - digest projection consistency with runtime state

## Recommended Execution Order

1. `SPO-01`
2. `SPO-02`
3. `SPO-03`
4. `SPO-04`
5. `SPO-05`
6. `SPO-12`
7. `SPO-06`
8. `SPO-07`
9. `SPO-08`
10. `SPO-13`
11. `SPO-14`
12. `SPO-09`
13. `SPO-10`
14. `SPO-11`
15. `SPO-15`

## First Safe Slice

The first safe slice should be:

- `SPO-01`
- `SPO-02`
- `SPO-03`
- `SPO-04`
- `SPO-06`
- `SPO-07`
- `SPO-08`
- `SPO-12`

This delivers:

- one contract
- one roster
- one verification path
- one awaited `before_dispatch` execution slice
- structured persistence
- projected observability

without yet introducing detached queue complexity.
