# Agent Instruction Index

`AGENTS.md` is the router at the repo root. This directory contains the specialized rules that keep executable architecture, CLI behavior, contracts, governance, runtime boundaries, and validation aligned.

## How To Use This Index

- Classify the delivery lane first. Always read `00-agent-operating-model.md`;
  STANDARD/ASSURED also read `01-architecture-executable.md` and
  `06-validation-and-dod.md`, as required by the root router.
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

For installed clients, use the common launcher and [global setup](../GLOBAL_SETUP.md).
The global engine and standard assets are shared; project activation, data and
extensions retain their scope. Do not repair a global binding with `npx` or a
local dependency fallback. Generated workflow documents derive from the durable
adapter; follow [installation inputs](../INSTALL.md#durable-inputs-and-extensions).
Native review and execution claims require the exact
[qualification evidence](../qualification/GLOBAL_WINDOWS.md), not a source version.

Read the smallest relevant set. Do not load everything blindly.
