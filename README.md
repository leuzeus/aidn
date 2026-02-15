# aid’n

aid’n is a template-only, audit-driven workflow system for structured AI-assisted development.
It organizes work around cycles, sessions, baseline tracking, snapshot discipline, and a clear separation between product specification and project adapter.

## Philosophy

- Template-only packaging
- Deterministic installation
- Separation between product spec and project adapter
- Low mental load
- Cross-platform Node installer

## Spec vs Stub

- Product repository contains:
  - Official specification: `docs/SPEC.md`
  - Installation templates: `template/`
- Client repositories receive:
  - Project adapter stub at `docs/audit/WORKFLOW.md`
  - Audit artifacts and skill mapping used by day-to-day execution

## Architecture Overview

Product repository:
- Official specification (`docs/SPEC.md`)
- Installation templates (`template/`)
- Packs (`packs/core`, `packs/extended`)
- Node installer and release tooling (`tools/`)

Client repository after install:
- `docs/audit/WORKFLOW.md` (project adapter stub)
- `docs/audit/baseline/`
- `docs/audit/snapshots/`
- `docs/audit/cycles/`
- `docs/audit/sessions/`
- `.codex/skills.yaml`

## Installation

```bash
node tools/install.mjs --target ../client --pack core
node tools/install.mjs --target ../client --pack core --verify
```

```bash
node tools/build-release.mjs
```

## Project Stub Customization

After install, customize `docs/audit/WORKFLOW.md` in the client repository.
Replace placeholders (for example `{{PROJECT_NAME}}` and `{{SOURCE_BRANCH}}`) and complete project constraints/policies before starting production work.
