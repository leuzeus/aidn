# Codex Online Notes

Ensure skills are available before execution.

For `dual` / `db-only` projects, use the Node runtime chain end-to-end:
- `npx aidn codex run-json-hook ... --strict --json`
- `npx aidn codex hydrate-context --target . --skill <skill> --json`
- `npx aidn runtime sync-db-first-selective --target . --json` for mutating skills
- `npx aidn runtime repair-layer-triage --target . --json` when `repair_layer_status` is `warn|block`
- `npx aidn runtime repair-layer-autofix --target . --apply --json` only for safe-only autofix cases
