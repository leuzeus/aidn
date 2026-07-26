# Testing Guide

## Purpose

This repository is the package source repository.

Testing here is used for several different intents:

- validate a lot before merge
- analyze a regression
- confirm a behavioral hypothesis
- compare SQLite and PostgreSQL behavior
- replay fixture-based installed-project scenarios
- optionally validate a local-only reference corpus

This guide explains which kind of verification to run for each intent and how to interpret the result.

## Repository Context

Important distinctions:

- current repository root = package source
- `scaffold/*` = source templates
- `tests/fixtures/*` = tracked test corpora
- local-only reference corpora = optional, not required for a clean checkout

Do not assume a fixture run means the current repo root is an installed target.

## Main Test Families

### 1. Focused Fixture Verifications

Most `npm run perf:verify-*` commands run one focused behavior check against tracked fixtures.

Use these when you need targeted confidence on one subsystem:

- import/index shape
- repair-layer behavior
- workflow admission
- runtime projection
- CLI JSON output contracts
- shared-state behavior
- generated-doc behavior

These are usually the safest default for validating a code change.

When a change affects public `--json` output or CLI read/write semantics, run:

- `npm run perf:verify-cli-effect-policy`
- `npm run perf:verify-cli-surface-inventory`
- `npm run perf:verify-cli-no-implicit-write`
- `npm run perf:verify-db-migrate-write-boundary`
- `npm run perf:verify-cli-output-contracts`
- `npm run perf:verify-cli-aliases`

The database migration boundary verifier proves that both `runtime db-migrate`
and `runtime persistence-migrate` are byte-for-byte read-only previews without
`--write`, including with `--json`, and that only the explicit-write form
applies migrations.

When a change affects the simplified install/upgrade orchestrator, run:

- `npm run perf:verify-bootstrap`
- `npm run perf:verify-install-import`
- `npm run perf:verify-project-config`
- `npm run perf:verify-install-idempotence`

The CLI effect policy verifier checks the public command effect inventory in `src/core/cli/effect-policy.mjs`. The no-implicit-write verifier runs stable read-only, preview, and projector dry-run commands against a temporary fixture copy and fails if checkout-bound paths, including `.agents/*` and `.aidn/runtime/*`, change. The CLI output contract verifier gives every public JSON command its own isolated Git fixture with an explicitly derived dual-SQLite projection, then validates the result against `src/core/contracts/cli-output/*.schema.json`; commands never inherit mutations from a previously checked contract. For projector commands, it also verifies that `--dry-run --json` does not mutate the projected Markdown artifact.

The CLI surface inventory verifier checks that `repair-layer` commands remain classified as internal and are not exposed as public runtime aliases or effect-policy entries.

When a change affects source-of-truth semantics or concept ownership, run:

- `npm run perf:verify-source-of-truth-policy`
- `npm run perf:verify-governance-completeness`
- `npm run perf:verify-state-mode-parity`

When a change affects governed metadata, critical Markdown contracts, or lifecycle/ownership rules, run:

- `npm run perf:verify-metadata-policy`
- `npm run perf:verify-markdown-contract`

When a change affects architecture gate routing, family separation, or the visible CI surface for the active EA/IA backlog, run the dedicated `.github/workflows/architecture-gates.yml` checks instead of relying on `perf-kpi`.

When a change affects local operations, backup/restore, doctor output, or migration safety, run:

- `npm run perf:verify-db-schema-migrations`
- `npm run perf:verify-db-runtime-cli`
- `npm run perf:verify-runtime-persistence-parity`
- `npm run perf:verify-shared-coordination-backup`
- `npm run perf:verify-shared-coordination-restore`
- `npm run perf:verify-shared-coordination-doctor`

These checks are also split into `.github/workflows/runtime-ops.yml` so runtime-persistence and shared-coordination regressions are visible independently from broader KPI/perf coverage.

For shared coordination restore work specifically, validate the preview and the write path together:

- `npm run perf:verify-shared-coordination-backup`
- `npm run perf:verify-shared-coordination-restore`
- `npm run perf:verify-shared-coordination-doctor`

The restore fixture checks both the dry-run preview and the `--write` replay path, including the restored planning, handoff, and coordination payloads plus the source-of-truth and metadata surfaces that should be revalidated immediately after restore.

The restore JSON output now also carries a `post_restore_validation` block so the restore result can surface the follow-up status and doctor checks without requiring a separate manual command in the same validation flow.

When a change affects workspace resolution, state-mode parity, db-only hooks, or shared runtime boundary checks, run the dedicated `.github/workflows/runtime-mode.yml` checks instead of relying on `perf-kpi`.

Optional live PostgreSQL smoke is kept out of the required CI path. When you have a live PostgreSQL target and want a manual smoke run, use `.github/workflows/runtime-ops-live-smoke.yml` or run:

- `npm run perf:verify-postgres-runtime-persistence-live-smoke`
- `npm run perf:verify-postgres-shared-coordination-live-smoke`

Those commands skip cleanly when the live smoke URL is not configured.
The shared-coordination smoke uses only run-unique synthetic identifiers,
removes those exact rows in foreign-key order from a `finally` block, and
verifies zero remaining rows after both success and injected failure. It never
prints the configured connection URL.

When a change affects shared-boundary locator/path/reanchor behavior, run the dedicated `.github/workflows/shared-boundary.yml` checks instead of relying on `perf-kpi`.

When a change affects shared-runtime locator, re-anchor, or local-first boundary behavior, run:

- `npm run perf:verify-shared-runtime-locator`
- `npm run perf:verify-shared-runtime-path`
- `npm run perf:verify-shared-runtime-reanchor`
- `npm run perf:verify-shared-surface-boundary`

The re-anchor fixture includes checkout-bound sentinels for `docs/audit/*`, `AGENTS.md`, and `.codex/*` so locator repair cannot silently rewrite or relocate those local artifacts.
The locator-config fixture injects a replacement failure and proves that the
previous file remains byte-for-byte intact and no adjacent temporary file is
left behind.

When a change affects release/versioning, install examples, or build-release provenance, run:

- `npm run perf:verify-release-version`
- `npm run perf:verify-release-reproducibility`
- `npm run perf:verify-release-workflow-policy`
- `npm run perf:verify-release-provenance`
- `npm run perf:verify-pack-topology`
- `npm run perf:verify-tracked-sensitivity`
- `npm run perf:verify-doc-references`

The release version verifier checks that `VERSION`, `package.json`, README tagged install examples, and the documented Git workflow provenance policy stay aligned. The reproducibility verifier builds the exact clean tracked commit twice in isolated output roots, compares bytes, checks the npm package topology, and rejects sensitive inputs. `perf:verify-release-artifacts` remains the post-build check used by the main publication job.
The pack topology verifier checks the package tarball surface, the published docs allowlist, and the leak guard for guarded terms in package paths and contents. The tracked-sensitivity verifier separately scans the complete Git-tracked tree, including historical planning documents and fixtures. It uses exact negative probes so weakening or bypassing the detector fails the gate. Current tracked content is neutralized, but older Git objects can retain prior pilot names and local paths; history cleanup may therefore still be required before wider archival or publication.
The documentation-reference verifier resolves active local Markdown links and
literal `npm run` references against the tracked tree and `package.json`; its
negative probes prove that a missing link and a missing script are rejected.

Stable family wrappers are cataloged in `package/catalogs/gates.v1.json`: `verify:contracts`, `verify:governance`, `verify:runtime`, `verify:codex`, `verify:release`, and `verify:all`. The first four select their named family. `verify:release` executes every gate whose obligation is required or optional in the announced `main` or `release` context, including topology and tracked-tree sensitivity; it is not a release-family-only shortcut. Run `verify:all` only at a clean commit boundary so the cleanliness family is meaningful. Report `SKIP` separately from `PASS`.

Every cataloged verification gate is non-mutating with respect to the checkout.
The family runner snapshots `git status --porcelain=v2 --untracked-files=all`
before and after each executed gate. A gate that introduces a tracked change or
an untracked, non-ignored path fails immediately under its own gate id, with a
bounded path/status list. Git command failures are reported separately with
redacted exit/stdout/stderr diagnostics. An unmet required condition is `FAIL`;
only an unmet optional condition or an explicit catalog `skip` remains `SKIP`.
`cleanliness-worktree` executes in `dev`, `main`, and `release` instead of using
cleanliness as its own precondition. When changing this behavior, run:

- `npm run perf:verify-gate-runner-fixtures`
- `npm run perf:verify-gate-catalog`
- `npm run verify:cleanliness`

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
- `npm run perf:verify-session-plan`
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
- `npm run perf:verify-doc-references`

Use them when a change affects:

- scaffold templates
- canonical markdown shape
- rendered managed blocks
- output formatting contracts

### 5. Local-Only Reference Verifications

Some checks are designed to validate behavior against a local-only reference corpus.

Current example:

- `npm run perf:verify-pilot-runtime-import`

Rules:

- these checks must not require a tracked reference corpus
- they may `SKIP` on a clean checkout when no local reference corpus is configured
- if several local reference corpora exist, select one explicitly with `AIDN_PILOT_RUNTIME_IMPORT_ROOT`

Use them when fixture coverage is not enough and you want to confirm behavior on a local reference corpus with real degraded shapes.

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
4. optional local reference replay

### Confirm a hypothesis

Use one targeted check that proves or disproves the exact claim.

Examples:

- “session flattening still reparses correctly”:
  - `npm run perf:verify-repair-layer-session`
- “runtime heads keep canonical metadata on both backends”:
  - `npm run perf:verify-markdown-contract`
  - `npm run perf:verify-runtime-persistence-parity`
- “root runtime artifacts recover ownership from content”:
  - `npm run perf:verify-pilot-runtime-import` if a local reference corpus is available

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

- `SKIP` is acceptable for local-only reference checks on a clean checkout
- `SKIP` is not a substitute for the CI-safe fixture checks required by the lot
- when reporting validation, separate `PASS` commands from `SKIP` commands explicitly

## Local-Only Reference Checks

For local-only reference checks:

- use `AIDN_PILOT_RUNTIME_IMPORT_ROOT` when more than one local reference corpus exists
- do not commit reference corpora unless the user explicitly wants a published synthetic fixture
- do not rely on reference checks as the only evidence for a lot when tracked fixture coverage can exist

Example:

```powershell
$env:AIDN_PILOT_RUNTIME_IMPORT_ROOT = 'C:\local\pilot-runtime-import'
npm run perf:verify-pilot-runtime-import
```

## Adding Or Updating Tests

When adding a new verification:

- prefer tracked fixtures for reproducible repo validation
- use local-only reference checks only when tracked fixtures cannot represent the shape well enough
- keep one verification focused on one behavioral contract
- if a test is local-only, make that explicit in its name, docs, or output
- if a test can legitimately skip, make the skip condition explicit and deterministic

## Recommended Reporting

When closing a lot, report:

- which commands passed
- which commands were skipped and why
- whether the evidence came from tracked fixtures, parity checks, or a local-only reference corpus
