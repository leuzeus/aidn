# Context Resilience Verification

Use these checks when changing workflow re-anchor docs, `AGENTS.md`, Codex skill templates, install behavior, or fixture coverage related to context loss.

## Primary Command

Run the full regression pack:

```bash
npm run perf:verify-context-resilience
```

This command verifies:

1. template re-anchor artifacts and references
2. `CURRENT-STATE.md` coverage in mutating template skills
3. installed fixture re-anchor artifacts and references
4. installed fixture `CURRENT-STATE.md` consistency against snapshot/session/cycle artifacts
5. `CURRENT-STATE.md` coverage in installed skills
6. temporary install/import scenarios across supported state-mode and import-store combinations

## Focused Commands

Use targeted checks when iterating on one specific layer.

### Template Re-Anchor Files

```bash
npm run perf:verify-reanchor-template
```

Checks:

- `scaffold/docs_audit/WORKFLOW-KERNEL.md`
- `scaffold/docs_audit/CURRENT-STATE.md`
- `scaffold/docs_audit/RUNTIME-STATE.md`
- `scaffold/docs_audit/REANCHOR_PROMPT.md`
- `scaffold/docs_audit/ARTIFACT_MANIFEST.md`
- references from summary, adapter, index, `AGENTS.md`, and Codex notes

### Installed Fixture Re-Anchor Files

```bash
npm run perf:verify-reanchor-artifacts -- --target tests/fixtures/repo-installed-core
```

Checks the post-install reference fixture under `tests/fixtures/repo-installed-core`.

### `CURRENT-STATE.md` Consistency

```bash
npm run perf:verify-current-state-consistency -- --target tests/fixtures/repo-installed-core
```

Checks:

- `updated_at` is parseable
- `updated_at` is not older than cycle status timestamps when an active cycle is declared
- `active_session` / `session_branch` consistency
- `active_cycle` / `cycle_branch` consistency
- `COMMITTING` requirements for cycle, `dor_state`, and first plan step
- active session file exists when declared
- active cycle `status.md` exists when declared
- `dor_state`, `branch_name`, and `session_owner` stay aligned with cycle status
- snapshot active session/cycle data stays aligned with `CURRENT-STATE.md`

Fixture pack for consistency coverage:

```bash
npm run perf:verify-current-state-consistency-fixtures
```

This runs both:

- the installed reference fixture
- a non-trivial active-session/active-cycle fixture
- deliberate inconsistent fixtures that must fail the raw consistency check
  - snapshot/cycle divergence
  - `dor_state` divergence
  - `cycle_branch` / `branch_name` divergence
  - active session missing
  - active cycle missing
  - stale `CURRENT-STATE.md` relative to cycle timestamps

### Skill Coverage For `CURRENT-STATE.md`

Template skills:

```bash
npm run perf:verify-current-state-skill-coverage -- --root scaffold/codex
```

Installed skills:

```bash
npm run perf:verify-current-state-skill-coverage -- --root tests/fixtures/repo-installed-core/.codex/skills
```

This check ensures mutating skills keep `CURRENT-STATE.md` in scope instead of silently diverging from it.

### Install / Import Scenarios

```bash
node tools/perf/verify-install-import-fixtures.mjs
```

Checks:

- fresh install in default `dual` mode
- env override to `db-only`
- env precedence forcing file import store
- CLI override forcing `dual-sqlite`
- explicit `--skip-artifact-import`

Each scenario now also checks:

- re-anchor artifacts are installed
- installed skill coverage for `CURRENT-STATE.md`
- installed `CURRENT-STATE.md` is coherent with snapshot/session/cycle artifacts

## When To Run

Run the full check set before:

- changing `scaffold/docs_audit/*`
- changing `scaffold/root/AGENTS.md`
- changing `scaffold/codex/*`
- changing install/import behavior
- changing pack manifests that affect installed workflow files
- preparing a release that touches workflow resilience

## Interpretation

- A failure in template checks means the package source no longer guarantees correct install output.
- A failure in installed fixture checks means the reference post-install layout drifted.
- A failure in `CURRENT-STATE.md` consistency means the summary state can no longer be trusted as a safe reload entry point.
- A failure in install/import checks means the guarantees do not survive a real install path.
## Runtime Digest

- Render the runtime digest with `npm run runtime:project-runtime-state -- --target <repo>`
- Or refresh it as part of hydration with `npx aidn codex hydrate-context --target <repo> --skill <skill> --project-runtime-state --json`
- In `dual` / `db-only`, hydration auto-refreshes `docs/audit/RUNTIME-STATE.md` when that file already exists. Use `--no-project-runtime-state` to suppress it.
- The digest writes `docs/audit/RUNTIME-STATE.md`
- It surfaces:
  - `runtime_state_mode`
  - `repair_layer_status`
  - `repair_layer_advice`
  - `current_state_freshness`
  - prioritized reads from runtime context plus current workflow state
- Smoke-test the projector with `npm run perf:verify-runtime-state-projector`
- Verify exact `warn|block` digest rendering with `npm run perf:verify-runtime-state-projector-repair`
- Smoke-test the hydrate-context integration with `npm run perf:verify-hydrate-context-runtime-state`
- Verify CLI hint output for `RUNTIME-STATE.md` and stale `CURRENT-STATE.md` with `npm run perf:verify-runtime-digest-hints`

When non-JSON runtime output shows:

- `Runtime digest: docs/audit/RUNTIME-STATE.md`
  - open that digest first for short repair-layer and freshness signals
- `Current state stale: docs/audit/CURRENT-STATE.md`
  - treat current-state summary as stale
  - reload active session/cycle facts before any durable write
