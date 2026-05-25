# AIDN Agent Instructions

## Project Identity

AIDN is a local-first workflow governance system for AI-assisted development. It is governed by executable architecture.

## Core Rule

AIDN changes are accepted only when architecture intent and executable behavior remain aligned.

A change is complete only when code, CLI behavior, policies, contracts, tests or gates, documentation, and ADRs remain aligned.

## Mandatory Workflow

Before editing anything:

- identify the task category
- read the always-required docs:
  - `docs/agents/00-agent-operating-model.md`
  - `docs/agents/01-architecture-executable.md`
  - `docs/agents/06-validation-and-dod.md`
- read the task-specific docs from the routing matrix
- verify the current executable behavior before changing code or docs
- load only the files that are relevant to the task; do not open the whole repo blindly
- use `docs/TESTING.md` to choose and interpret the smallest relevant verification set

Repository boundary:

- this repository is package source, not an installed client repo
- treat `scaffold/*` as source assets and `tests/fixtures/*` as test corpora, not live workflow state
- when referring to installed behavior, be explicit about whether it is fixture-based, scaffold-based, or validated on an external or local pilot

Local-only pilot corpus:

- keep pilot-derived details neutral in tracked files
- avoid committing sensitive pilot paths, branch names, or business-specific content unless strictly necessary
- prefer `external pilot`, `local-only pilot corpus`, or `pilot fixture` in tracked docs

## Editing Guidance

- when touching docs, fixtures, or verification scripts related to pilot validation, minimize retained pilot-specific detail
- keep only the structure and identifiers needed to reproduce the technical behavior under test
- prefer generic script names such as `pilot` over project-specific names when there is no functional reason to keep the original label
- if sensitive pilot-derived content was already tracked, explicitly flag that history cleanup may be required instead of silently ignoring it

## Documentation Coherence

- if runtime behavior changes, update the smallest affected docs in the same change set
- if a focused diagram or BPMN changes meaningfully, mirror the intent in the related macro or rule docs
- if docs and behavior cannot be aligned immediately, call out the drift explicitly instead of leaving it implicit
- treat `AGENTS.md` as the policy layer, not as a complete inventory of every artifact

## Testing Guidance

- use `docs/TESTING.md` for intent-based test selection and result interpretation
- choose the smallest relevant verification set for the change
- distinguish tracked fixture checks from local-only pilot checks
- report `SKIP` separately from `PASS`

## Task Routing Matrix

| Task type | Must read |
|---|---|
| CLI command or flag | `docs/agents/02-cli-effect-policy.md`, `docs/CLI_SURFACE_INVENTORY.md`, `src/core/cli/effect-policy.mjs` |
| JSON output or contract | `docs/agents/04-json-contracts.md`, `src/core/contracts/cli-output/` |
| Information concept, metadata, source of truth | `docs/agents/03-information-governance.md`, `src/core/source-of-truth/source-of-truth-policy.mjs`, `src/core/metadata/metadata-policy.mjs` |
| Runtime modes or shared coordination | `docs/agents/05-local-first-shared-runtime.md`, `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`, `docs/ADR/ADR-0007-local-first-federation-boundary.md`, `docs/ADR/ADR-0008-shared-coordination-ports.md` |
| CI, gates, release | `docs/agents/06-validation-and-dod.md`, `package.json`, `.github/workflows/`, `docs/ADR/ADR-0009-release-versioning-provenance.md` |
| ADR or architecture decision | relevant `docs/ADR/*` plus `docs/agents/01-architecture-executable.md` |

## Non-Negotiable Rules

- `--json` must never imply mutation.
- Read-only and preview commands must not modify the checkout.
- Local writes require explicit intent such as `--write`.
- Shared runtime synchronization requires explicit intent such as `--sync-relay`.
- PostgreSQL must remain optional.
- Public JSON outputs require contracts and fixtures.
- New governed information concepts require source-of-truth and metadata coverage.
- Do not mark a task done unless validation proves alignment.

## Definition Of Done

Follow `docs/agents/06-validation-and-dod.md`.

A task is done only when behavior is verified, docs are aligned, policies are aligned, required contracts and fixtures are updated if needed, relevant gates pass, and any architectural decision change is reflected in the ADR.
