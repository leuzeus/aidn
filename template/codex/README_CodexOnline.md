# Codex Online Notes

Ensure skills are available before execution.

Before any durable write, reload the minimal workflow context in this order:
- `docs/audit/CURRENT-STATE.md`
- `docs/audit/WORKFLOW-KERNEL.md`
- `docs/audit/WORKFLOW_SUMMARY.md`
- `docs/audit/RUNTIME-STATE.md` when runtime freshness or repair signals matter
- active cycle `status.md` and active session file when relevant

If context is partial, stale, or contradictory, run `docs/audit/REANCHOR_PROMPT.md` and stop before writing.

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

When runtime output shows:
- `Runtime digest: docs/audit/RUNTIME-STATE.md`
  - read that digest first for short repair-layer and freshness signals
- `Current state stale: docs/audit/CURRENT-STATE.md`
  - treat `CURRENT-STATE.md` as stale summary state
  - reload active session/cycle facts before any durable write
  - refresh summary state through the normal workflow skills instead of patching it ad hoc

For recent Codex Windows application flows, treat `apply_patch` as a durable write shortcut, not as a safe bypass of workflow reload.
