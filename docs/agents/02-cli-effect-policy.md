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
- `--help` and `-h` are always read-only, even when another selector is present.
- `--dry-run` is always preview-only; parsers must reject contradictory write
  combinations instead of silently choosing an effect.
- Read-only and preview commands must not modify the checkout.
- Local writes require explicit intent such as `--write`.
- `runtime db-migrate` and `runtime persistence-migrate` are preview-only by
  default; schema application requires `--write`, while `--json` remains
  formatting-only.
- Shared runtime synchronization requires explicit intent such as `--sync-relay`.
- Every public stable command must have an effect class.
- A command whose effect depends on an option carries a machine-readable
  invocation rule. Options do not inherit a command-level class as a shortcut.
- Effect resolution uses an immutable copy of the original argument vector and
  is independent of runtime availability. For example, local-daemon status
  remains read-only whether the daemon is available or unavailable.
- Dispatchable command identity, visibility, implementation, owner, contracts,
  and effect authority come from `src/core/cli/command-registry.mjs`.
- Any mismatch between CLI behavior, docs, and effect-policy is architectural drift.

## Examples

- `aidn runtime project-runtime-state --json` must be read-only by default.
- `aidn runtime project-runtime-state --json --write` may project or write only when the command documents that behavior.
- `aidn runtime project-handoff-packet --json` must be read-only by default.
- `aidn runtime mode-migrate --json` must only preview config, schema, and projection changes; `--write` is required to apply them.
- `aidn project config --adapter-file <file> --json` previews; adding `--write`
  makes the exact invocation mutating.
- `aidn runtime shared-coordination-restore --json` previews; adding `--write`
  makes the exact invocation mutating even when the shared backend is
  unavailable and the operation fails before writing.
- `aidn install --dry-run` is preview-only.
- `aidn runtime local-daemon --status --json` is read-only; `--start`,
  `--serve`, and `--stop` are executors.
- Shared sync must stay explicit; it must never happen just because `--json` is present.

## Practical Reading

If you are changing a command flag, read the effect policy, the CLI surface inventory, and the command implementation together.

If those three disagree, treat the mismatch as a bug, not as a documentation style choice.
