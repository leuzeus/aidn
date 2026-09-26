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
- `aidn bootstrap`
- `aidn build-release`
- `aidn setup`
- `aidn update`
- `aidn rollback`
- `aidn doctor`
- `aidn help` / `aidn --help` / `aidn -h`
- `aidn version` / `aidn --version` / `aidn -v`
- `aidn codex`
- `aidn runtime`
- `aidn project`

The single dispatch registry is `src/core/cli/command-registry.mjs`.
`bin/aidn.mjs` and the machine-readable catalog import that same structured
registry. Options are derived only from each command's effective `parseArgs`
function. `tools/verify/verify-surface-catalog.mjs` enforces the closure in both
directions, rejects incomplete or duplicate descriptors and unknown options
through the real entrypoints, and excludes arguments passed to child processes.

## Stable public command families

These command families are intended for users and are covered by public effect policies and/or JSON contracts:

- `aidn project config --list --json`
- `aidn project add --target PATH --json`
- `aidn project migrate --target PATH --json`
- `aidn project list --json`
- `aidn project remove --id ID --json`
- `aidn update --check --json`
- `aidn update --release latest --json`
- `aidn rollback --json`
- `aidn doctor --target PATH --json`

Global management applies only with `--write --expect-plan ID`; a wizard
confirmation invokes that same exact plan. `--json` is formatting only and never
authorizes writes. Global commands use `global-management.v1`. See
[global setup](GLOBAL_SETUP.md) for installation and qualification boundaries.
`aidn setup` is an interactive executor; its confirmation can apply changes.
`aidn setup --json` instead previews noninteractively. Source development and
legacy bootstrap remain explicit entry points, never launcher fallbacks.
`project add --postgres-mode install --postgres-version VERSION --connection-ref
env:NAME --admin-connection-ref env:ADMIN` additionally plans local PostgreSQL
provisioning and explicit empty-database initialization. Existing PostgreSQL
resources use `--connection-ref` alone with `verify-only`; global updates always
retain that policy. `--resume` resumes the frozen provisioning transaction.

- `aidn bootstrap --json`
- `aidn bootstrap --dry-run --json`
- `aidn bootstrap --diagnose --json`
- `aidn bootstrap --authorize --json`
- `aidn bootstrap --authorize --write --json`
- `aidn bootstrap --revoke --json`
- `aidn bootstrap --revoke --write --json`
- `aidn bootstrap --repair --json`
- `aidn bootstrap --repair --write --json`
- `aidn bootstrap --resume --json`
- `aidn bootstrap --resume --write --json`
- `aidn bootstrap --rollback --json`
- `aidn bootstrap --rollback --write --json`
- `aidn bootstrap --uninstall --json`
- `aidn bootstrap --uninstall --write --json`

Bootstrap diagnostic and lifecycle commands accept `--scope installation` to
select all recorded local installer assets. The default `codex-integration`
scope remains limited to Codex assets. The scope changes the selected ownership
set, never write intent: lifecycle applies still require both `--write` and
`--expect-plan PLAN_ID`. Diagnostic stays read-only in either scope. The common
`installation_plan` in ordinary bootstrap previews covers local assets,
generated documents, configuration and separately declared persistence effects.
`aidn install --verify-after-install` includes verification in successful-install
finalization; `--verify` retains its read-only verification behavior.

- `aidn project config --wizard --write`
- `aidn project config --adapter-file <file> --json` (preview)
- `aidn project config --adapter-file <file> --write --json` (apply)
- `aidn project config --init-defaults --project-name <name> --json` (preview)
- `aidn project config --init-defaults --project-name <name> --write --json`
- `aidn project config --migrate-adapter --json` (preview)
- `aidn project config --migrate-adapter --write --json`
- `aidn runtime db-status --json`
- `aidn runtime db-only-readiness --json`
- `aidn runtime persistence-status --json`
- `aidn runtime persistence-adopt --json`
- `aidn runtime db-migrate --json` (preview) and `--write --json` (apply)
- `aidn runtime persistence-migrate --json` (preview alias) and `--write --json` (apply)
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

  `cycle-create` resolves canonical DB-backed context. A verified session with an
  explicit `active_cycle: none` can report `cycle_create_initial_state_verified`
  when cycle timestamp comparison is not applicable. Freshness remains `unknown`;
  stale state, missing canonical facts, repair and Git gates still block. This
  generic admission never authorizes an arbitrary native write.
  - Optional `--native-request-stdin` reads native V4A request JSON and returns
    specific scope admission. It remains read-only; generic admission is not
    universal write permission. See [specific admission](CODEX_INTEGRATION.md#specific-native-write-admission).
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
- `aidn runtime shared-coordination-restore --json` (preview) and
  `--write --json` (apply)
- `aidn runtime shared-coordination-doctor --json`
- `aidn runtime shared-coordination-migrate --json`
- `aidn runtime project-agent-health-summary --json`
- `aidn runtime project-agent-selection-summary --json`
- `aidn runtime project-integration-risk --json`
- `aidn runtime project-multi-agent-status --json`
- `aidn runtime project-coordination-summary --json`
- `aidn runtime sync-db-first --json`
- `aidn runtime sync-db-first-selective --json`
- `aidn runtime mode-migrate --json` previews the config, schema, and projection plan; add `--write` to apply it
- `aidn runtime session-plan --json`
- `aidn runtime db-first-artifact --json`
- `aidn runtime artifact-store list --json`
- `aidn runtime artifact-store get --json`
- `aidn runtime artifact-store upsert --json`
- `aidn runtime artifact-store materialize --json`

Artifact commands select the configured runtime backend. PostgreSQL upserts
write only the named artifact, its blob/head and associated session/cycle row
inside one transaction, using an existing compatible schema and unambiguous
scope. They do not adopt a store or rebuild its index. `--path` is relative to
the audit root (for example `sessions/S001-example.md`); do not prefix it
with the audit root. The additive `backend` field identifies
the store; the legacy v1 `sqlite_file` field is empty for PostgreSQL.
When the resolved durable runtime scope and its legacy path scope coexist,
artifact commands select the durable scope, like canonical snapshot reads.
The legacy scope is eligible only when durable-scope metadata is absent. A
missing artifact within the selected scope never falls back to legacy content;
no implicit merge, deletion or migration of either scope occurs.
`list`, `get` and materialization previews remain read-only. JSON formatting
does not authorize an upsert or materialization; their existing effect rules
remain unchanged. PostgreSQL checkpoints read the canonical backend and skip
implicit index imports with reason `postgres_canonical_backend`.
Selective DB-first writes preserve cycle/session identity derived from standard
artifact paths and the cycle status subtype; contradictory explicit identity
is rejected before mutation on either backend.

The `cycle-close` skill checkpoint accepts terminal ownership only for its
post-transition check and the explicit COMMITTING drift-check needed to finish
it. Both verify canonical exit evidence and intent. Generic gating, reload and
THINKING drift checks retain ordinary mapping. This does not relax reload or mark a
closed cycle active. Its specific admission, nested checkpoint and overall
result remain distinct; warnings and refusals propagate through the Codex JSON
wrapper. No public skip flag or alias is added for this closure context.
The wrapper skips post-hook DB synchronization on closure warning/refusal with
reason `cycle_close_not_completed`; it must not replace the canonical evidence
that prevented completion with local projections.

The `pr-orchestrate` hook diagnoses delivery from canonical session artifacts in
dual/db-only and configured PostgreSQL modes, including review and post-merge
sync. An unavailable, ambiguous or inconsistent canonical session produces
`PR_ORCHESTRATE_CANONICAL_RUNTIME_INVALID` instead of reading a stale local copy.
It performs no provider action or default post-hook DB import. The Codex wrapper
still persists its diagnostic context; an explicit `--db-sync` remains a separate
requested effect and must not be confused with read-only admission.

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
  - DB-backed repair status is read from the current canonical snapshot, never
    inferred from an old successful hook or a missing findings collection.
  - `--write --out <reviewed-digest>` writes only that projection file. In
    `db-only`, persist a reviewed digest separately with
    `aidn runtime db-first-artifact --path RUNTIME-STATE.md --content-file <reviewed-digest> --no-materialize --json`.
    Consultation never persists the digest or updates canonical findings.
  - Canonical head pointers select exact artifacts even when historical path
    aliases coexist. An inconsistent pointer or ambiguous unheaded alias is a
    diagnostic requiring repair; consultation never deletes or merges the history.
- `aidn runtime project-handoff-packet --json`, `--write` for projection writes, and `--sync-relay` for shared relay sync writes
- `aidn runtime state-reanchor --json` and `--write` for explicit repair of `CURRENT-STATE.md`, `RUNTIME-STATE.md`, and `HANDOFF-PACKET.md` from the active runtime backend

## Repository-internal aliases

The `aidn perf` dispatcher and every alias declared as internal in
`src/core/cli/command-registry.mjs`
are repository tooling. They remain executable for maintainers and fixtures, but
they are classified explicitly as internal/non-public in the machine-readable
surface catalog. In particular, this includes:

- `aidn perf checkpoint`
- `aidn perf session-start`
- `aidn perf session-close`
- `aidn perf delivery-start`
- `aidn perf delivery-end`
- `aidn perf audit-review`
- every other alias in the closed internal registry

## Experimental or internal

These are currently implemented as package scripts, tools, or internal wrappers, but they are not treated as stable public product contracts unless a specific doc or policy says otherwise:

- direct `tools/runtime/*.mjs` entrypoints
- direct `tools/perf/*.mjs` entrypoints
- `aidn perf` and its explicitly catalogued internal aliases
- `aidn codex run-json-hook` and `aidn codex normalize-hook-payload`
- `aidn runtime local-daemon` (public, experimental)
  - experimental opt-in local daemon prototype
  - `--start`, `--status`, and `--stop` use a worktree-local endpoint file under `.aidn/runtime/daemon/`
  - `--status` is always read-only, whether the daemon is present or absent;
    `--start`, `--serve`, and `--stop` are executor invocations
  - current stable behavior remains batch unless a client command is explicitly run with daemon flags
  - first supported delegated operations are `aidn codex workflow-step --use-daemon ...` and `aidn codex run-json-hook --use-daemon ...`
  - no command starts the daemon implicitly
- `node tools/runtime/repair-layer.mjs`
- `node tools/runtime/repair-layer-query.mjs`
- `node tools/runtime/repair-layer-resolve.mjs`
- `node tools/runtime/repair-layer-triage.mjs`
- `node tools/runtime/repair-layer-autofix.mjs`
- implementation helpers under `src/application/`, `src/adapters/`, and `src/lib/`

Repair-layer commands are operational/internal surfaces. They may be used by CI, recovery tooling, or fixture-driven tests, but they are not promoted as stable public contracts in this backlog.

## Source Of Truth

This inventory is derived from:

- `bin/aidn.mjs`
- `src/core/cli/command-registry.mjs`
- `package.json`
- `README.md`
- `src/core/cli/effect-policy.mjs`
- `src/core/contracts/cli-output/README.md`

When these disagree, the code and policy files take precedence over this inventory.

## Project activation boundary

The internal perf drift skill uses `gating-evaluate --complete-drift-check` to
record an explicit completed review only when its other checks pass. Generic
gate invocations do not record drift completion; `--no-emit-event` remains
observational. This stays within the internal perf surface and does not change
stable public JSON contracts or grant write admission.

`bootstrap --authorize|--revoke` uses `codex-integration` scope and previews by default; application requires `--write --expect-plan PLAN_ID`. A revoked project stays revoked through repair, resume and rollback. Diagnostic and pre-write admission outputs include compact activation state before backend access. Native Codex trust is separate.

Nominal bootstrap or upgrade accepts `--expect-plan PLAN_ID` from its matching preview. `--persistence-policy verify-only` checks existing backend compatibility without requesting migration, adoption or import; `adopt` retains declared installation effects. `--verify` remains the read-only verification option.

Host skill maintenance is explicit: `aidn bootstrap --migrate-global-skills --codex-home <absolute-path> --json` and `aidn bootstrap --restore-global-skills --codex-home <absolute-path> --json` preview only. Applying either requires `--write --expect-plan PLAN_ID`, uses `codex-integration` scope, and preserves the skill files. The host path is required only for these two actions; nominal project installation never migrates global skills.

## Windows host setup wrapper

`scripts/setup-project.ps1` is a Windows host wrapper, not a new aidn CLI command.
Without arguments or with `-Wizard`, it opens the multi-project menu, collects inputs, runs the
same read-only preflight, and requires the literal `INSTALLER` before invoking
the explicit `-Write` path. Cancellation and declining confirmation do not apply.
It previews local inputs by default and applies only with `-Write`. Explicit
`latest` selection and `-CheckUpdate` read GitHub metadata without writing.
`-Update` preserves existing project settings and stages the candidate before
project npm replacement; application requires `-Write`. `-InstallSetup` previews
the user launcher installation; `-Write` also sets AIDN_HOME and the user PATH.
Registry remembering/removal are explicit menu writes, separate from consultation.
The Node bridges in tools/setup are internal subprocess protocols, not public
JSON interfaces. It orchestrates
an exact published GitHub release (verified manifest/checksums and npm integrity)
or a pinned local npm tarball, optional WinGet PostgreSQL installation and database
preparation, then the existing bootstrap preview/apply/diagnose and persistence
status commands. It has human-readable output, no public JSON contract.
`-PersistUserConnection` is an explicit optional Windows user-environment write;
native Codex trust is never changed. See [the setup guide](WINDOWS_PROJECT_SETUP.md).
