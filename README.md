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
  - rendered with pinned `remote.ref` matching the installed aidn tag (for example `v0.2.0`)

## Installation

```bash
node tools/install.mjs --target ../client
node tools/install.mjs --target ../client --pack core
node tools/install.mjs --target ../client --pack core --verify
```

```bash
node tools/build-release.mjs
```

## Project Stub Customization

After install, review `docs/audit/SPEC.md` then `docs/audit/WORKFLOW_SUMMARY.md`, then customize `docs/audit/WORKFLOW.md` in the client repository.
Replace placeholders (for example `{{PROJECT_NAME}}` and `{{SOURCE_BRANCH}}`) and complete project constraints/policies before starting production work.
