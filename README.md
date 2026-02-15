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

System model:
- **Audit-Informed Development (primary philosophy):** audits act before, during, and after implementation as decision filters.
- **Audit-Driven layer (control mechanism):** validates DoD, detects deviation/scope creep, and applies corrective adjustments.
- **Cycles (bounded execution):** intent audit, architecture audit, implementation, audit-driven validation, snapshot update.
- **Memory system:** baseline as structural anchor, snapshots as fast reload memory, parking lot as entropy isolation.
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
