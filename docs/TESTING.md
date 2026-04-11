# Testing Guide

## Purpose

This repository is the package source repository.

Testing here is used for several different intents:

- validate a lot before merge
- analyze a regression
- confirm a behavioral hypothesis
- compare SQLite and PostgreSQL behavior
- replay fixture-based installed-project scenarios
- optionally validate a local-only external pilot corpus

This guide explains which kind of verification to run for each intent and how to interpret the result.

## Repository Context

Important distinctions:

- current repository root = package source
- `scaffold/*` = source templates
- `tests/fixtures/*` = tracked test corpora
- local external pilot corpora = optional, local-only, not required for a clean checkout

Do not assume a fixture run means the current repo root is an installed target.

## Main Test Families

### 1. Focused Fixture Verifications

Most `npm run perf:verify-*` commands run one focused behavior check against tracked fixtures.

Use these when you need targeted confidence on one subsystem:

- import/index shape
- repair-layer behavior
- workflow admission
- runtime projection
- shared-state behavior
- generated-doc behavior

These are usually the safest default for validating a code change.

### 2. Parity / Runtime Persistence Verifications

These commands validate backend or projection parity:

- `npm run perf:verify-runtime-relational-projection`
- `npm run perf:verify-runtime-persistence-parity`
- `npm run perf:verify-postgres-runtime-relational-store`
- `npm run perf:verify-postgres-runtime-relational-contract`

Use them when a change affects:

- canonical runtime payload shape
- SQLite/PostgreSQL equivalence
- runtime heads
- adoption/persistence contracts

### 3. Workflow Admission / Repair-Layer Verifications

These commands validate enforcement behavior:

- `npm run perf:verify-start-session-admission`
- `npm run perf:verify-branch-cycle-audit-admission`
- `npm run perf:verify-handoff-packet`
- `npm run perf:verify-repair-layer-session`
- `npm run perf:verify-repair-layer-*`

Use them when a change affects:

- session parsing
- branch/cycle mapping
- handoff digests
- repair triage or repair-layer context reconstruction

### 4. Documentation / Generated Output Verifications

Examples:

- `npm run perf:verify-generated-docs`
- `npm run perf:verify-generated-doc-golden`
- `npm run perf:verify-generated-doc-fragments`
- `npm run perf:verify-markdown-contract`

Use them when a change affects:

- scaffold templates
- canonical markdown shape
- rendered managed blocks
- output formatting contracts

### 5. Local-Only External Pilot Verifications

Some checks are designed to validate behavior against a local-only pilot corpus.

Current example:

- `npm run perf:verify-pilot-runtime-import`

Rules:

- these checks must not require a tracked pilot corpus
- they may `SKIP` on a clean checkout when no local pilot corpus is configured
- if several local pilot corpora exist, select one explicitly with `AIDN_PILOT_RUNTIME_IMPORT_ROOT`

Use them when fixture coverage is not enough and you want to confirm behavior on a local pilot corpus with real degraded shapes.

## Which Tests To Run

### Validate a lot before merge

Start with the smallest relevant set.

Examples:

- runtime import / session parsing lot:
  - `npm run perf:verify-repair-layer-session`
  - `npm run perf:verify-runtime-relational-projection`
  - `npm run perf:verify-runtime-persistence-parity`
- markdown contract lot:
  - `npm run perf:verify-markdown-contract`
  - `npm run perf:verify-handoff-packet`
  - `npm run perf:verify-current-state-consistency-fixtures`
- workflow admission lot:
  - `npm run perf:verify-start-session-admission`
  - `npm run perf:verify-branch-cycle-audit-admission`

Do not default to the full verification surface unless the change is broad.

### Analyze a regression

Prefer the most local reproducer first:

1. find the subsystem involved
2. run the narrowest `perf:verify-*` command for that subsystem
3. inspect the fixture or payload shape that failed
4. only then expand to parity or cross-backend checks

Typical progression:

1. targeted fixture check
2. adjacent repair/admission check
3. relational/parity check
4. optional local pilot replay

### Confirm a hypothesis

Use one targeted check that proves or disproves the exact claim.

Examples:

- “session flattening still reparses correctly”:
  - `npm run perf:verify-repair-layer-session`
- “runtime heads keep canonical metadata on both backends”:
  - `npm run perf:verify-markdown-contract`
  - `npm run perf:verify-runtime-persistence-parity`
- “root runtime artifacts recover ownership from content”:
  - `npm run perf:verify-pilot-runtime-import` if a local pilot corpus is available

### Confirm SQLite/PostgreSQL parity

Run:

- `npm run perf:verify-runtime-relational-projection`
- `npm run perf:verify-runtime-persistence-parity`
- `npm run perf:verify-postgres-runtime-relational-store`

Add contract-level checks when markdown/canonical shape changed:

- `npm run perf:verify-markdown-contract`

## PASS / FAIL / SKIP

Interpret results conservatively:

- `PASS`: the tested scenario passed
- `FAIL`: the tested scenario failed and needs investigation
- `SKIP`: the command intentionally did not validate the scenario in the current environment

Important:

- `SKIP` is acceptable for local-only pilot checks on a clean checkout
- `SKIP` is not a substitute for the CI-safe fixture checks required by the lot
- when reporting validation, separate `PASS` commands from `SKIP` commands explicitly

## Local-Only Pilot Checks

For pilot checks:

- use `AIDN_PILOT_RUNTIME_IMPORT_ROOT` when more than one local pilot corpus exists
- do not commit pilot corpora unless the user explicitly wants a published synthetic fixture
- do not rely on pilot checks as the only evidence for a lot when tracked fixture coverage can exist

Example:

```powershell
$env:AIDN_PILOT_RUNTIME_IMPORT_ROOT = 'C:\local\pilot-runtime-import'
npm run perf:verify-pilot-runtime-import
```

## Adding Or Updating Tests

When adding a new verification:

- prefer tracked fixtures for reproducible repo validation
- use local-only pilot checks only when tracked fixtures cannot represent the shape well enough
- keep one verification focused on one behavioral contract
- if a test is local-only, make that explicit in its name, docs, or output
- if a test can legitimately skip, make the skip condition explicit and deterministic

## Recommended Reporting

When closing a lot, report:

- which commands passed
- which commands were skipped and why
- whether the evidence came from tracked fixtures, parity checks, or a local-only pilot corpus
