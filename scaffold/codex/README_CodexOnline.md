# Codex Online Notes

Ensure skills are available before execution.

Project defaults:
- source branch: `{{SOURCE_BRANCH}}`
- preferred runtime state mode: `{{PREFERRED_STATE_MODE}}`
- default index store: `{{DEFAULT_INDEX_STORE}}`

This file complements the installed project `AGENTS.md`; it does not replace it. The live workflow state still lives in `docs/audit/*` and hydrated runtime context.

Before any durable write, reload the minimal workflow context in this order:
- `docs/audit/HANDOFF-PACKET.md` when another agent already prepared a relay
- `docs/audit/CURRENT-STATE.md`
- `docs/audit/WORKFLOW-KERNEL.md`
- `docs/audit/WORKFLOW_SUMMARY.md`
- `docs/audit/RUNTIME-STATE.md` when runtime freshness or repair signals matter
- active cycle `status.md` and active session file when relevant

For session startup in conservative app/online flows:
- still run `start-session` even when the immediate user request is analysis-only
- `start-session` is admission-first, so the initial runtime decision is part of read discipline, not a workflow bypass
- "this skill may mutate later" is not sufficient reason to skip admission
- if admission returns `stop`, surface the branch/continuity issue and remain read-only
- only skip the later durable-write part when no workflow artifact creation/update is justified

If context is partial, stale, or contradictory, run `docs/audit/REANCHOR_PROMPT.md` and stop before writing.

When several cycles attached to the same session may converge, also read:
- `docs/audit/INTEGRATION-RISK.md`
- and prefer `aidn runtime project-integration-risk --target . --json` before assuming a normal merge path

Durable writes include:
- `apply_patch`
- direct file edits
- generated file creation
- workflow artifact mutations by script

Do not use a durable write until you can restate explicitly:
- mode
- branch kind
- active cycle
- `dor_state`
- first implementation step from `plan.md`
- missing context, if any

For `dual` / `db-only` projects, use the Node runtime chain end-to-end:
- `npx aidn codex run-json-hook ... --strict --json`
- `npx aidn codex hydrate-context --target . --skill <skill> --project-runtime-state --json`
- `npx aidn runtime sync-db-first-selective --target . --json` for mutating skills
- `npx aidn runtime repair-layer-triage --target . --json` when `repair_layer_status` is `warn|block`
- `npx aidn runtime repair-layer-autofix --target . --apply --json` only for safe-only autofix cases

When `docs/audit/AGENT-SELECTION-SUMMARY.md` exists, `hydrate-context` also refreshes it automatically unless `--no-project-agent-selection-summary` is set.
Use that summary for the short human view, then fall back to:
- `aidn runtime list-agent-adapters --target . --json`
- `aidn runtime coordinator-select-agent --target . --role <role> --action <action> --json`
- `docs/audit/AGENT-HEALTH-SUMMARY.md` when you need adapter readiness instead of routing only

When runtime output shows:
- `Runtime digest: docs/audit/RUNTIME-STATE.md`
  - read that digest first for short repair-layer and freshness signals
- `Current state stale: docs/audit/CURRENT-STATE.md`
  - treat `CURRENT-STATE.md` as stale summary state
  - reload active session/cycle facts before any durable write
  - refresh summary state through the normal workflow skills instead of patching it ad hoc

For agent-to-agent work:
- refresh `docs/audit/HANDOFF-PACKET.md` before pausing when another agent is expected to continue
- if `HANDOFF-PACKET.md.preferred_dispatch_source=shared_planning`, open `backlog_refs` before replacing the relay intent
- if a handoff packet exists, read it before the standard re-anchor sequence and verify its pointers against the live artifacts
- if `docs/audit/MULTI-AGENT-STATUS.md` exists, use it as the short digest before opening the detailed multi-agent artifacts

For session planning:
- keep planning local in `.aidn/runtime/context/session-plan-draft.json` while the work stays short, single-agent, and pre-decision
- promote planning to `docs/audit/backlog/BL-SXXX-<slug>.md` before handoff, multi-agent work, or cycle creation from the planning outcome

When `docs/audit/MULTI-AGENT-STATUS.md` exists, `hydrate-context` also refreshes it automatically unless `--no-project-multi-agent-status` is set.

For recent Codex Windows application flows, treat `apply_patch` as a durable write shortcut, not as a safe bypass of workflow reload.

For recent Codex Windows application flows, also treat "mutating skill" labels carefully:
- a skill that may eventually write can still have a mandatory read-only admission phase
- `start-session` must not be replaced by an informal re-anchor when the workflow contract requires its admission result first

If a long session starts drifting from the workflow:
- do not assume `AGENTS.md` was never loaded
- treat it as a runtime re-anchor failure
- return to read-only mode, rerun the workflow skill or hook path, and re-check the short audit artifacts before writing again
