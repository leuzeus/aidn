# 02 CLI Effect Policy

## Purpose

CLI behavior is classified by effect class in `src/core/cli/effect-policy.mjs`.

The classification keeps automation from confusing output format with write permission.

## Effect Classes

- `read-only`
- `preview`
- `projector`
- `mutating`
- `executor`

## Rules

- `--json` controls output format only and must never imply mutation.
- Read-only and preview commands must not modify the checkout.
- Local writes require explicit intent such as `--write`.
- Shared runtime synchronization requires explicit intent such as `--sync-relay`.
- Every public stable command must have an effect class.
- Any mismatch between CLI behavior, docs, and effect-policy is architectural drift.

## Examples

- `aidn runtime project-runtime-state --json` must be read-only by default.
- `aidn runtime project-runtime-state --json --write` may project or write only when the command documents that behavior.
- `aidn runtime project-handoff-packet --json` must be read-only by default.
- Shared sync must stay explicit; it must never happen just because `--json` is present.

## Practical Reading

If you are changing a command flag, read the effect policy, the CLI surface inventory, and the command implementation together.

If those three disagree, treat the mismatch as a bug, not as a documentation style choice.
