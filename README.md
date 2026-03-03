# aid’n

aid’n is a template-only, audit-informed workflow system for structured AI-assisted development.
It combines a continuous audit philosophy with an audit-driven control layer to regulate entropy, preserve long-term coherence, and stabilize AI-assisted execution.
The model structures work through bounded cycles, session discipline, baseline anchoring, snapshot reload, and clear separation between product specification and project adapter.

## Philosophy

- Template-only packaging
- Deterministic installation
- Separation between product spec and project adapter
- Entropy regulation before structural decisions
- Long-term coherence over local optimization
- AI stability and low cognitive load
- Cross-platform Node installer

## Spec vs Stub

- Product repository contains:
  - Official specification: `docs/SPEC.md`
  - Installation templates: `template/`
- Client repositories receive:
  - Managed spec snapshot at `docs/audit/SPEC.md`
  - Quick summary at `docs/audit/WORKFLOW_SUMMARY.md`
  - Project adapter stub at `docs/audit/WORKFLOW.md`
  - Audit artifacts and skill mapping used by day-to-day execution

Path distinction guardrail:
- `docs/SPEC.md` is the source file in this package repository.
- `docs/audit/*` is the operational tree in the installed client repository.
- Workflow execution and agent behavior must always use the installed `docs/audit/*` paths in the client repo context.

## Architecture Overview

Product repository:
- Official specification (`docs/SPEC.md`)
- Installation templates (`template/`)
- Packs (`packs/core`, `packs/extended`)
- Node installer and release tooling (`tools/`)

Client repository after install:
- `docs/audit/SPEC.md` (managed spec snapshot)
- `docs/audit/WORKFLOW_SUMMARY.md` (quick reload)
- `docs/audit/WORKFLOW.md` (project adapter stub)
- `docs/audit/baseline/`
- `docs/audit/snapshots/`
- `docs/audit/cycles/`
- `docs/audit/sessions/`
- `docs/audit/incidents/`
- `.codex/skills.yaml`
  - rendered with pinned `remote.ref` matching the installed aidn tag (for example `v0.3.0`)
- `.codex/skills/*`
  - local skill source folders copied during install (offline/local fallback)

## Workflow Diagrams

- Global system architecture: `docs/diagrams/01-global-system-architecture.md`
- Cycle state machine: `docs/diagrams/02-cycle-state-machine.md`
- Runtime session flow: `docs/diagrams/03-runtime-session-flow.md`
- Entropy regulation loop: `docs/diagrams/04-entropy-regulation-control-loop.md`
- Mermaid style preset (indigo): `docs/diagrams/MERMAID_PRESET_INDIGO.md`

## Performance Rollout

- Plan: `docs/performance/WORKFLOW_PERFORMANCE_PLAN.md`
- Prioritization matrix: `docs/performance/PRIORITIZATION_MATRIX.md`
- RFC: `docs/rfc/RFC-0001-reload-incremental-gating-index.md`
- Tooling quickstart: `docs/performance/README.md`

## Installation

```bash
npm install --save-dev github:leuzeus/aidn#dev
npx aidn install --target ../client --pack core
npx aidn install --target ../client --pack core --verify
```

Notes:
- install auto-imports `docs/audit/*` artifacts into `../client/.aidn/runtime/index/*`
- import backend precedence: `--artifact-import-store` > `AIDN_INDEX_STORE_MODE` > `AIDN_STATE_MODE`
- default fresh install profile is DB-backed (`runtime.stateMode=dual`, `install.artifactImportStore=dual-sqlite`)
- skip import with `--skip-artifact-import`
- install auto-creates/updates `../client/.aidn/config.json` so runtime commands can work without extra env vars

```bash
npx aidn perf checkpoint --target ../client --mode COMMITTING --index-store all --index-sync-check --json
npx aidn build-release
```

## Project Stub Customization

After install, review `docs/audit/SPEC.md` then `docs/audit/WORKFLOW_SUMMARY.md`, then customize `docs/audit/WORKFLOW.md` in the client repository.
Replace placeholders (for example `{{PROJECT_NAME}}` and `{{SOURCE_BRANCH}}`) and complete project constraints/policies before starting production work.
