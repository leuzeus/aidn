# Agent Instruction Index

`AGENTS.md` is the router at the repo root. This directory contains the specialized rules that keep executable architecture, CLI behavior, contracts, governance, runtime boundaries, and validation aligned.

## How To Use This Index

- Start with `00-agent-operating-model.md`, `01-architecture-executable.md`, and `06-validation-and-dod.md` for every task.
- Add the task-specific doc from the routing matrix before editing anything.
- Read the smallest relevant set, not everything blindly.
- Prefer code, policies, schemas, fixtures, and gates when they disagree with narrative docs.

## Task Routing Matrix

| Task type | Read first |
|---|---|
| CLI command or flag | `02-cli-effect-policy.md`, `docs/CLI_SURFACE_INVENTORY.md`, `src/core/cli/effect-policy.mjs` |
| JSON output or contract | `04-json-contracts.md`, `src/core/contracts/cli-output/` |
| Information concept, metadata, source of truth | `03-information-governance.md`, `src/core/source-of-truth/source-of-truth-policy.mjs`, `src/core/metadata/metadata-policy.mjs`, `docs/ADR/ADR-0006-information-model.md` |
| Runtime modes or shared coordination | `05-local-first-shared-runtime.md`, `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`, `docs/ADR/ADR-0007-local-first-federation-boundary.md`, `docs/ADR/ADR-0008-shared-coordination-ports.md` |
| CI, gates, release | `06-validation-and-dod.md`, `package.json`, `.github/workflows/`, `docs/ADR/ADR-0009-release-versioning-provenance.md` |
| ADR or architecture decision | relevant `docs/ADR/*` plus `01-architecture-executable.md` |

## ADR References

- `docs/ADR/ADR-0003-source-of-truth-policy.md`
- `docs/ADR/ADR-0004-public-cli-json-contracts.md`
- `docs/ADR/ADR-0005-read-write-cli-semantics.md`
- `docs/ADR/ADR-0006-information-model.md`
- `docs/ADR/ADR-0007-local-first-federation-boundary.md`
- `docs/ADR/ADR-0008-shared-coordination-ports.md`
- `docs/ADR/ADR-0009-release-versioning-provenance.md`

## Executable Policies

- `src/core/cli/effect-policy.mjs`
- `src/core/source-of-truth/source-of-truth-policy.mjs`
- `src/core/metadata/metadata-policy.mjs`
- `src/core/contracts/cli-output/`
- `docs/CLI_SURFACE_INVENTORY.md`
- `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`

## Principle

Read the smallest relevant set. Do not load everything blindly.
