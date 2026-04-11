# AGENTS.md

## Purpose

This root file records repository-wide constraints that agents must keep in mind across sessions.

It is intentionally short. It does not replace the workflow rules under `docs/audit/*`.

## Repository Type

This repository is the package source repository, not an installed client repository.

Rules:

- do not assume the current working tree is an installed `aidn` target
- treat `scaffold/*` as package templates/source assets, not as the live state of an installed project
- treat `tests/fixtures/*` as test corpora, not as the live workflow state of the current repository
- when referring to installed-project behavior, be explicit that it is fixture-based, scaffold-based, or validated on an external/local pilot
- do not apply installed-repo assumptions to the current root unless the user explicitly says the task concerns an installed test target

## Local-Only Pilot Corpus

Some work may rely on a real external pilot repository or on local fixtures derived from it.

Rules:

- the word `gowire` is allowed as a high-level reference when it is useful context
- the same protection rules apply to any external project used as a pilot, not only to `gowire`
- do not copy sensitive pilot details into tracked files unless they are strictly necessary
- avoid committing real pilot paths, real branch names, real project-specific slugs, or business-specific content extracted from the pilot corpus
- prefer neutral wording in tracked files:
  - `external pilot`
  - `local-only pilot corpus`
  - `pilot fixture`
- if a local pilot-derived fixture is useful for development but should not be published, keep it local and add it to `.gitignore`
- if sensitive pilot-derived content was already tracked, explicitly flag that history cleanup may be required instead of silently ignoring it
- when a new external pilot is introduced, default to these same local-only and leak-minimization rules unless the user explicitly states otherwise

## Editing Guidance

When touching docs, fixtures, or verification scripts related to pilot validation:

- minimize retained pilot-specific detail
- keep only the structure and identifiers needed to reproduce the technical behavior under test
- prefer generic script names such as `pilot` over project-specific names when there is no functional reason to keep the original label

## Testing Guidance

For test selection and interpretation, use `docs/TESTING.md`.

Agents should:

- choose the smallest relevant verification set for the change
- distinguish tracked fixture checks from local-only pilot checks
- report `SKIP` separately from `PASS`

## Precedence

For workflow execution and mutation rules, follow:

1. `docs/audit/SPEC.md`
2. `docs/audit/WORKFLOW.md`
3. this file
