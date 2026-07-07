# CLI Surface Inventory

Date: 2026-05-23
Status: current codebase inventory

Purpose:

- make the user-facing CLI surface explicit
- distinguish stable public entrypoints from experimental and internal surfaces
- keep the inventory aligned with `bin/aidn.mjs`, `package.json`, `README.md`, and `src/core/cli/effect-policy.mjs`

## Stable public entrypoints

These are the durable surfaces exposed through `aidn` today:

- `aidn install`
- `aidn build-release`
- `aidn perf`
- `aidn codex`
- `aidn runtime`
- `aidn project`

## Stable public command families

These command families are intended for users and are covered by public effect policies and/or JSON contracts:

- `aidn project config --list --json`
- `aidn project config --wizard`
- `aidn project config --init-defaults --project-name <name> --json`
- `aidn project config --migrate-adapter --json`
- `aidn runtime db-status --json`
- `aidn runtime db-only-readiness --json`
- `aidn runtime persistence-status --json`
- `aidn runtime persistence-adopt --json`
- `aidn runtime db-migrate --json`
- `aidn runtime persistence-migrate --json`
- `aidn runtime db-backup --json`
- `aidn runtime persistence-backup --json`
- `aidn runtime persistence-source-diagnose --json`
- `aidn runtime persistence-source-normalize --json`
- `aidn runtime artifact-fetch --json`
- `aidn runtime visible-artifacts-cleanup --json`
- `aidn runtime visible-artifacts-restore --json`
- `aidn runtime state-reanchor --json`
- `aidn runtime shared-coordination-status --json`
- `aidn runtime shared-coordination-projects --json`
- `aidn runtime governance-diagnostics --json`
- `aidn runtime list-agent-adapters --json`
- `aidn runtime verify-agent-roster --json`
- `aidn runtime handoff-admit --json`
- `aidn runtime pre-write-admit --json`
- `aidn codex hydrate-context --json`
  - hidden bundle output defaults to `.aidn/runtime/context/hydrated-context.json`
  - strict `db-only` does not auto-project visible files
  - use `--materialize-visible-artifacts` to intentionally write managed visible exports
- `aidn codex workflow-step --json`
  - batches pre-write admission, hidden context hydration, and coordinator next-action computation in one process
  - does not execute skill hooks or materialize visible artifacts
  - shared runtime synchronization remains explicit and is not implied by `--json`

## Advanced public command families

These surfaces are public and contract-backed, but they are more operational or coordination-sensitive than the stable core families above:

- `aidn runtime shared-runtime-reanchor --json`
- `aidn runtime shared-coordination-bootstrap --json`
- `aidn runtime shared-coordination-backup --json`
- `aidn runtime shared-coordination-restore --json`
- `aidn runtime shared-coordination-doctor --json`
- `aidn runtime shared-coordination-migrate --json`
- `aidn runtime project-agent-health-summary --json`
- `aidn runtime project-agent-selection-summary --json`
- `aidn runtime project-integration-risk --json`
- `aidn runtime project-multi-agent-status --json`
- `aidn runtime project-coordination-summary --json`
- `aidn runtime sync-db-first --json`
- `aidn runtime sync-db-first-selective --json`
- `aidn runtime mode-migrate --json`
- `aidn runtime session-plan --json`
- `aidn runtime db-first-artifact --json`
- `aidn runtime artifact-store list --json`
- `aidn runtime artifact-store get --json`
- `aidn runtime artifact-store upsert --json`
- `aidn runtime artifact-store materialize --json`
- `aidn runtime coordinator-select-agent --json`
- `aidn runtime coordinator-next-action --json`
- `aidn runtime coordinator-loop --json`
- `aidn runtime coordinator-dispatch-plan --json`
- `aidn runtime coordinator-dispatch-execute --json`
- `aidn runtime coordinator-orchestrate --json`
- `aidn runtime coordinator-resume --json`
- `aidn runtime coordinator-suggest-arbitration --json`
- `aidn runtime coordinator-record-arbitration --json`
- `aidn runtime project-runtime-state --json` and `--write` for projection writes
- `aidn runtime project-handoff-packet --json`, `--write` for projection writes, and `--sync-relay` for shared relay sync writes
- `aidn runtime state-reanchor --json` and `--write` for explicit repair of `CURRENT-STATE.md`, `RUNTIME-STATE.md`, and `HANDOFF-PACKET.md` from the active runtime backend

## Stable public aliases

These `aidn perf` aliases are public because they are part of the executable CLI surface and are validated by alias coverage fixtures:

- `aidn perf checkpoint`
- `aidn perf session-start`
- `aidn perf session-close`
- `aidn perf delivery-start`
- `aidn perf delivery-end`
- `aidn perf audit-review`
- the `perf:*` alias set listed in `bin/aidn.mjs`

## Experimental or internal

These are currently implemented as package scripts, tools, or internal wrappers, but they are not treated as stable public product contracts unless a specific doc or policy says otherwise:

- direct `tools/runtime/*.mjs` entrypoints
- direct `tools/perf/*.mjs` entrypoints
- `aidn runtime local-daemon`
  - experimental opt-in local daemon prototype
  - current stable behavior remains batch unless a client command is explicitly run with daemon flags
  - first supported delegated operation is `aidn codex workflow-step --use-daemon ...`
- `aidn runtime repair-layer`
- `aidn runtime repair-layer-query`
- `aidn runtime repair-layer-resolve`
- `aidn runtime repair-layer-triage`
- `aidn runtime repair-layer-autofix`
- implementation helpers under `src/application/`, `src/adapters/`, and `src/lib/`

Repair-layer commands are operational/internal surfaces. They may be used by CI, recovery tooling, or fixture-driven tests, but they are not promoted as stable public contracts in this backlog.

## Source Of Truth

This inventory is derived from:

- `bin/aidn.mjs`
- `package.json`
- `README.md`
- `src/core/cli/effect-policy.mjs`
- `src/core/contracts/cli-output/README.md`

When these disagree, the code and policy files take precedence over this inventory.
