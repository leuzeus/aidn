# aid’n

aid’n is an audit-informed workflow runtime platform for structured AI-assisted development.
It combines a continuous audit philosophy with an audit-driven control layer, deterministic template distribution, and local runtime state management to regulate entropy, preserve long-term coherence, and stabilize AI-assisted execution.
The model structures work through bounded cycles, session discipline, baseline anchoring, snapshot reload, canonical state handling, and clear separation between product specification and project adapter.
The current runtime baseline also includes admission-first workflow hooks for session start/close, cycle continuity, requirements delta, baseline promotion, spike conversion, and explicit multi-agent handoff relays.

## Philosophy

- Scaffold distribution with runtime enforcement
- Deterministic installation
- Separation between product spec and project adapter
- Explicit state modes: `files | dual | db-only`
- Entropy regulation before structural decisions
- Long-term coherence over local optimization
- AI stability and low cognitive load
- Cross-platform Node installer

## Spec vs Stub

- Product repository contains:
  - Official specification: `docs/SPEC.md`
  - Installation scaffold: `scaffold/`
- Client repositories receive:
  - Managed spec snapshot at `docs/audit/SPEC.md`
  - Quick summary at `docs/audit/WORKFLOW_SUMMARY.md`
  - Project adapter stub at `docs/audit/WORKFLOW.md`
  - Audit artifacts and skill mapping used by day-to-day execution

## Architecture Overview

Product repository:
- Official specification (`docs/SPEC.md`)
- Installation scaffold (`scaffold/`)
- Packs (`packs/core`, `packs/runtime-local`, `packs/codex-integration`, `packs/github-integration`, `packs/extended`)
- Runtime, installer, and release tooling (`tools/`)

Client repository after install:
- `AGENTS.md`
  - root project startup contract for Codex in the installed repo
  - keeps stable write-stop rules and points toward workflow state and runtime checks
- `docs/audit/SPEC.md` (managed spec snapshot)
- `docs/audit/WORKFLOW_SUMMARY.md` (quick reload)
- `docs/audit/WORKFLOW.md` (project adapter stub)
- `docs/audit/baseline/`
- `docs/audit/snapshots/`
- `docs/audit/cycles/`
- `docs/audit/sessions/`
- `docs/audit/incidents/`
- `.codex/skills.yaml`
  - rendered with pinned `remote.ref` matching the installed aidn tag (for example `v0.4.0`)
- `.codex/skills/*`
  - local skill source folders copied during install (offline/local fallback)
- `.aidn/runtime/*`
  - local runtime state, index, context, and observability artifacts

Codex instruction layering after install:
- global user or org guidance may still come from `~/.codex/AGENTS.md` or `~/.codex/AGENTS.override.md`
- the installed root `AGENTS.md` is only the project layer
- nested `AGENTS.md` or `AGENTS.override.md` can override root rules in specialized subtrees
- `aidn` does not install or manage the global `~/.codex` layer

## Workflow Diagrams

- Global system architecture: `docs/diagrams/01-global-system-architecture.md`
- Cycle state machine: `docs/diagrams/02-cycle-state-machine.md`
- Runtime session flow: `docs/diagrams/03-runtime-session-flow.md`
- Entropy regulation loop: `docs/diagrams/04-entropy-regulation-control-loop.md`
- Mermaid style preset (indigo): `docs/diagrams/MERMAID_PRESET_INDIGO.md`
- BPMN overview and usage notes: `docs/bpmn/README.md`
- BPMN macro workflow: `docs/bpmn/aidn-multi-agent-ideal.bpmn`
- BPMN handoff detail: `docs/bpmn/aidn-multi-agent-handoff-detail.bpmn`

## Git Workflow

- `main` is the stable/release branch.
- `dev` is the integration branch and may accumulate multiple workstreams.
- clean PRs should be opened from short-lived branches created from `main`.
- if a change exists on `dev` but needs a narrow PR, create a fresh branch from `main` and cherry-pick the relevant commit(s).
- full policy: `docs/GIT_WORKFLOW.md`

## Performance Rollout

- Plan: `docs/performance/WORKFLOW_PERFORMANCE_PLAN.md`
- Prioritization matrix: `docs/performance/PRIORITIZATION_MATRIX.md`
- RFC: `docs/rfc/RFC-0001-reload-incremental-gating-index.md`
- Tooling quickstart: `docs/performance/README.md`

## Architecture Direction

- Target architecture ADR: `docs/ADR/ADR-0002-runtime-platform-architecture.md`
- Remediation plan: `docs/PLAN_ARCHITECTURE_REMEDIATION_2026-03-07.md`
- Executable backlog: `docs/BACKLOG_ARCHITECTURE_REMEDIATION_2026-03-07.md`
- GitHub issues ready: `docs/BACKLOG_ARCHITECTURE_GITHUB_ISSUES_2026-03-07.md`
- GitHub project ready: `docs/BACKLOG_ARCHITECTURE_GITHUB_PROJECT_2026-03-07.md`

## Installation

```bash
npm install --save-dev github:leuzeus/aidn#v0.4.0
npx aidn install --target ../client --pack core
npx aidn install --target ../client --pack extended
npx aidn install --target ../client --pack core --source-branch main
npx aidn install --target ../client --pack core --verify
```

Notes:
- `core` remains the compatibility/default install profile
- `runtime-local` refreshes local runtime adapter examples on top of `core`
- `codex-integration` refreshes local Codex skill assets on top of `core`
- `github-integration` installs optional GitHub repository automation on top of `core`
- `extended` is the explicit composite profile (`core` + `runtime-local` + `codex-integration` + `github-integration`)
- install creates or updates the project-layer `AGENTS.md`; it does not write `~/.codex/AGENTS.md`
- install can set workflow adapter metadata explicitly with `--source-branch <name>`
- install persists the resolved source branch in `../client/.aidn/config.json` under `workflow.sourceBranch`
- install auto-imports `docs/audit/*` artifacts into `../client/.aidn/runtime/index/*`
- import backend precedence: `--artifact-import-store` > `AIDN_INDEX_STORE_MODE` > `AIDN_STATE_MODE`
- default fresh install profile is DB-backed (`runtime.stateMode=dual`, `install.artifactImportStore=dual-sqlite`)
- skip import with `--skip-artifact-import`
- install auto-creates/updates `../client/.aidn/config.json` so runtime commands can work without extra env vars
- `SOURCE_BRANCH` resolution order is: `--source-branch` > existing project metadata > Git remote default branch > current branch > `main`
- prefer a tagged install (`#v0.4.0`) for stable consumers; use a branch ref only when you explicitly want an in-flight runtime baseline
- if the client repo already contains `AGENTS.override.md`, Codex will prefer it over the installed `AGENTS.md`
- `aidn` does not install a `.codex/config.toml` by default; fallback filenames and instruction-byte limits remain an opt-in Codex project config concern

```bash
npx aidn perf checkpoint --target ../client --mode COMMITTING --index-store all --index-sync-check --json
npx aidn build-release
```

## Product vs Installed vs Self-Host

- Product repository assets live under `docs/`, `src/`, `tools/`, `packs/`, and `scaffold/`.
- Installed client assets live under `docs/audit/*`, `.codex/*`, and `.aidn/*`.
- The canonical self-host workspace lives under `tests/workspaces/selfhost-product/`.
- Product-local scratch runtime should use `.aidn-dev/` if needed; product-root `.aidn/` should not be the normal dogfooding target.

Detailed boundary note:

- `docs/PRODUCT_SELFHOST_BOUNDARIES.md`

## Project Stub Customization

After install, review `docs/audit/SPEC.md` then `docs/audit/WORKFLOW_SUMMARY.md`, then customize `docs/audit/WORKFLOW.md` in the client repository.
Replace placeholders (for example `{{PROJECT_NAME}}` and `{{SOURCE_BRANCH}}`) and complete project constraints/policies before starting production work.

## Codex Verification

After install, verify the real instruction chain that Codex sees from the client repo:

```bash
codex --ask-for-approval never "Summarize the current instructions."
codex --cd docs/audit --ask-for-approval never "Show which instruction files are active."
```

Expected behavior:
- Codex reports the installed root `AGENTS.md` for the project layer
- nested overrides only appear when they actually exist
- if guidance looks wrong, inspect `AGENTS.override.md` in the repo or `~/.codex/AGENTS.override.md` in the user profile before assuming install failed
