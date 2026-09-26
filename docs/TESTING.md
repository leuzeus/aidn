# Testing Guide

## Targeted canonical artifact writes

`perf:verify-runtime-persistence-parity` includes deterministic artifact command
fixtures: invalid paths, schema/scope refusals, parameterized writes, late
rollback and read-only transactions. Scope selection covers canonical/legacy
coexistence in either database result order, legacy-only compatibility and
missing canonical artifacts without per-artifact fallback. They do not prove a
running PostgreSQL server.

Run `node tools/perf/verify-project-artifact-store-live-smoke.mjs` separately with
`AIDN_RUNTIME_PG_SMOKE_URL` pointing to a dedicated test database. It creates two
temporary project scopes, checks concurrent targeted writes and stable identifiers,
canonical session visibility, late transaction rollback, materialization preview,
unrelated row preservation, bootstrap `verify-only`, and checkpoint preservation.
It also creates an owned legacy alias for one project and proves that CLI/facade
reads and selective writes keep the durable scope authoritative while preserving
legacy rows, the other project and checkout files. No real project's scope is
used or removed by this smoke.
It removes only its own scopes and verifies cleanup. Missing credentials are
`UNAVAILABLE`, not `PASS`. This is source/CLI integration proof, not native Codex
hook execution or qualification of a PostgreSQL server installer.

Initial-cycle admission is covered by the pre-write use-case and CLI fixtures:
canonical initial session, missing/unknown/stale cycle, mismatched session and
branch, session identifier boundary, and misleading local projections. Runtime
repair status `clean` (emitted by hooks) and legacy `ok` are admitted; `warn`,
`block`, and `unknown` must still refuse the initial-state exception. The
admitted initial case must keep freshness `unknown` and leave every file and DB
row unchanged. The dedicated PostgreSQL smoke also checks this actual CLI path
and canonical runtime projection; fixtures alone are not PostgreSQL proof.

## Purpose

PR orchestration runs `verify-pr-orchestrate-admission-fixtures.mjs` in the
context-resilience gate: files-mode cases and
SQLite dual/db-only lifecycle transitions through close gate, push, review,
merge, and post-merge sync. CLI, in-process daemon and Codex wrapper must agree
despite misleading local projections. Canonical identity conflicts, duplicate
session artifacts and unavailable storage refuse. Default wrapper diagnosis
must not synchronize projections or mutate the database. The dedicated
PostgreSQL artifact-store smoke exercises the same paths, checks both owned
scopes and retained local files, and proves cleanup separately from fixtures.
Neither suite represents native provider/client execution.

Cycle closure runs `verify-cycle-close-admission-fixtures.mjs` and
`verify-cycle-close-completion-fixtures.mjs` in the context-resilience gate.
They distinguish specific admission from final checkpoint success, exercise
`DONE`, `NO_GO` and `DROPPED` after clearing active focus in files/dual/db-only,
and retain ordinary mapping refusal. Missing/ambiguous ownership, incomplete
canonical usage evidence, nested refusal and warning have negative cases.
The same fixture suite exercises closure warning -> explicit drift completion ->
closure, including three changed closure documents, a cycle label containing
`migration`, unchanged preview hashes, preserved journal, THINKING/ordinary
mapping refusals and unresolved objective drift. Sensitive code and other
artifacts retain cross-domain signals.
The sequence also checks that automatic selective SQLite sync retains cycle and
session identities and the status subtype; contradictory explicit ownership is
refused with unchanged file hashes before a write can occur.
An incomplete canonical usage matrix with a misleading local VERIFIED copy must
remain unchanged after wrapper refusal, and a subsequent drift check must refuse.
Static readiness recognizes the backend-resolved snapshot reader as DB-aware;
that source classification alone does not qualify fileless runtime behavior.
The dedicated PostgreSQL smoke separately checks closure against canonical
rows, the full closure/drift sequence, canonical intent despite misleading local
files, unchanged data and unrelated scope preservation. None of these is native
client trust or execution evidence.

Global-store fixtures simulate Windows path redirection for both absent and
existing homes and assert zero writes. A real Windows console must additionally
resolve the same installation, generation and managed assets as the app before
native qualification; fixtures do not establish that host visibility.

Branch-audit regressions use `perf:verify-branch-cycle-audit-admission`: complete
cycle success, propagated warning/refusal, ownership failures, whitespace-valid
event JSON, old and other-branch events, mixed anomaly reasons, and unchanged
journal bytes. The live artifact-store smoke additionally exercises automatic
PostgreSQL selection, misleading local projections, normal reload history and a
real repeated-anomaly stop through the standard hook and Codex JSON wrapper.
These subprocess tests do not qualify native hook approval or client execution.

The branch-admission verifier also executes the actual `drift-check` skill via
the Codex JSON wrapper and proves that its event clears only the age signal on
the next audit. It covers preview, generic evaluations, wrong branch/mode,
invalid/future/expired timestamps and persistent warning/stop. Coordinator
success fixtures use this real producer instead of seeding successful events.
The dedicated PostgreSQL smoke repeats the required-check-to-admission path and
checks unchanged canonical rows and preservation of the existing journal.

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

The global runtime shipped in 0.10.0 and has a focused regression suite:
`npm run perf:verify-global-runtime`. It covers package/asset integrity, operation
leases, switch and recovery preconditions, compatibility checks, receipt-bound
global project connectors, public management plans, new project attachment,
registry removal, read-only cleanup inventories, wizard cancellation and npm
interruption/resume. Package installation and removal are injected; native Codex
discovery, actual PostgreSQL, native secret entry and OS reboot recovery are not
qualified by these fixtures.
The global management suite also injects WinGet, PostgreSQL and bootstrap to
exercise local provisioning, interrupted preparation, secret separation and
nonempty-database refusal. This is not actual server installation evidence.
See ADR-0013 for the remaining release boundary.

Run `node tools/verify/verify-global-client-install.mjs
--require-codex-discovery --require-update-rollback` for actual npm installation,
local package removal, a two-project global switch and rollback, and native
user-skill discovery without duplicate enabled definitions. Its next-version
tarball is synthetic; this proves switching behavior, not a future release's
schema compatibility. Add `--legacy-release 0.9.1 --require-postgres` to download
and verify that published migration input and exercise the dedicated
`AIDN_RUNTIME_PG_SMOKE_URL` database. Add `--require-worktree` for a real additional
Git worktree that remains inactive until explicitly prepared. The PostgreSQL probe requires an existing
test schema, verifies unused synthetic scopes before preparation, compares all
canonical rows after each global operation, and cleans only those scopes.
Native agent discovery inspects the request built by Codex against a loopback
provider returning no tool calls. A negative control removes one temporary
definition and requires that it disappear from the advertised agents. This
proves discovery, not agent execution. Neither command qualifies server
installation or trusted native hook execution. Those remain separate checks.

For native write scope, first run
`node tools/perf/verify-native-write-admission-fixtures.mjs`, then the existing
Codex integration, admission and public contract/effect fixtures. The new cases
also run inside `perf:verify-codex-integration`: generic-vs-specific refusal,
planning, task scope, DoR/exploration evidence, mixed patches, move/delete,
path boundaries and fresh observations. These are fixture proofs, never native
hook execution. Use N01-N17 in [native qualification](CODEX_NATIVE_QUALIFICATION.md)
for a human-approved, candidate-bound native run.

For global hook transport, run
`node tools/perf/verify-global-hook-connector-fixtures.mjs` and
`node tools/perf/verify-global-package-fixtures.mjs`. These checks cover real
subprocess failures, invalid/bounded output, deadline handling, successful and
inactive replies, and explicit repair without reactivation or customization
loss. They are included in the bootstrap, Codex integration and global runtime
gates. A native unavailable-engine probe must separately prove that the corrected
candidate prevents the marker write after human review; subprocess PASS does not
replace that proof or qualify a disabled or externally terminated hook.

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
- `npm run perf:verify-codex-integration`
- `npm run perf:verify-install-import`
- `npm run perf:verify-project-config`
- `npm run perf:verify-install-idempotence`

The bootstrap and Codex integration composites also run
`tools/perf/verify-multi-project-setup-fixtures.mjs` for registry isolation,
version detection, no-op/downgrade behavior, candidate-before-package ordering
and read-only SQLite admission. The installation persistence-policy fixtures
also cover candidate PostgreSQL verification with a fake driver (not live proof).
They additionally run
`tools/perf/verify-windows-project-setup-fixtures.mjs`. This verifies the real
Windows PowerShell preview, release download integrity and bounded HTTPS handling,
wizard cancellation, invalid-input retry, explicit confirmation for all three
database modes, and refusal to continue after a failed preflight,
and injected npm/WinGet/PostgreSQL orchestration. The injected runner uses a
fixture npm entry point on every host, while a missing entry point must still
fail before any subprocess or database operation. This covers
including credential separation and failure stops. Real server installation,
live PostgreSQL and native hook approval remain separate, unexecuted evidence.

The CLI effect policy verifier checks the public command effect inventory in `src/core/cli/effect-policy.mjs`. The no-implicit-write verifier runs stable read-only, preview, and projector dry-run commands against a temporary fixture copy and fails if checkout-bound paths, including `.agents/*` and `.aidn/runtime/*`, change. The CLI output contract verifier gives every public JSON command its own isolated Git fixture with an explicitly derived dual-SQLite projection, then validates the result against `src/core/contracts/cli-output/*.schema.json`; commands never inherit mutations from a previously checked contract. For projector commands, it also verifies that `--dry-run --json` does not mutate the projected Markdown artifact.
When a contract command child fails, the verifier reports its exit status,
signal, timeout/error code, and independently bounded, redacted stdout and
stderr tails. Deterministic probes cover a nonzero stdout-only child, configured
secret redaction, and an `ETIMEDOUT` timeout so an intermittent command failure
cannot collapse into an ambiguous contract result.

The pre-write admission fixtures also invalidate tracked file stat metadata
without changing content. Both status inspection and cycle admission must leave
every file byte unchanged, including `.git/index` and the canonical local store;
read-only Git calls disable optional index refreshes.

Runtime projector fixtures cover live SQLite repair findings overriding misleading
hook caches, absent/malformed evidence, errors beyond the display limit and
byte-for-byte read-only output. The dedicated project-artifact-store PostgreSQL
smoke covers clean/warn/block projection, unavailable canonical storage, and the
public projection -> explicit `db-first-artifact` write -> subsequent admission
path, preserving unrelated rows and another test scope. Fixture success does not
substitute for this live database evidence or for native hook execution.
The Codex DB-only skill readiness gate also rejects documented runtime commands
that have no executable registry entry.

Runtime head fixtures cover both artifact orders, exact PostgreSQL pointer
resolution, checksum/identity mismatch, missing targets, ambiguous fallback and
materialized SQLite heads. The dedicated PostgreSQL smoke keeps both historical
and current digest paths, verifies admission and handoff follow the explicit
current head, then proves a corrupted pointer refuses without database writes.


The CLI surface inventory verifier checks that `repair-layer` commands remain classified as internal and are not exposed as public runtime aliases or effect-policy entries.

When a change affects source-of-truth semantics or concept ownership, run:

- `npm run perf:verify-source-of-truth-policy`
- `npm run perf:verify-governance-completeness`
- `npm run perf:verify-state-mode-parity`

When a change affects governed metadata, critical Markdown contracts, or lifecycle/ownership rules, run:

- `npm run perf:verify-metadata-policy`
- `npm run perf:verify-markdown-contract`

When a change affects architecture gate routing, family separation, or the
visible CI surface, use `.github/workflows/governance-admission.yml` and the
gate-catalog fixtures instead of relying on `perf-kpi`.

Adaptive-route changes are covered inside `perf:verify-gate-catalog`. For a
focused local diagnosis, the same tracked fixture suite can be run directly:

- `node tools/verify/verify-governance-route-fixtures.mjs`

The A-F cases cover historical documentation, internal runtime and Codex work,
public CLI/contracts, persistence or authority, and release/security/hotfix
routes. Adversarial cases cover unknown paths, rename/delete, unresolved
provenance, mixed changes, requested lane downgrade, direct protected-branch
work, duplicate selection, and emergency invariants. The resolver itself is
read-only and emits `governance-route.v1` as one JSON document on stdout.

When a change affects local operations, backup/restore, doctor output, or migration safety, run:

- `npm run perf:verify-db-schema-migrations`
- `npm run perf:verify-db-runtime-cli`
- `npm run perf:verify-runtime-persistence-parity`
- `npm run perf:verify-shared-coordination-backup`
- `npm run perf:verify-shared-coordination-restore`
- `npm run perf:verify-shared-coordination-doctor`

These checks run once through the selected runtime family in Governance
Admission, so runtime-persistence and shared-coordination regressions remain
visible without a duplicate pull-request workflow.

For shared coordination restore work specifically, validate the preview and the write path together:

- `npm run perf:verify-shared-coordination-backup`
- `npm run perf:verify-shared-coordination-restore`
- `npm run perf:verify-shared-coordination-doctor`

The restore fixture checks both the dry-run preview and the `--write` replay path, including the restored planning, handoff, and coordination payloads plus the source-of-truth and metadata surfaces that should be revalidated immediately after restore.

The restore JSON output now also carries a `post_restore_validation` block so the restore result can surface the follow-up status and doctor checks without requiring a separate manual command in the same validation flow.

When a change affects workspace resolution, state-mode parity, db-only hooks,
or shared runtime boundaries, Governance Admission selects the runtime family.
Use the focused commands below for local diagnosis instead of relying on
`perf-kpi`.

Optional live PostgreSQL smoke is kept out of the required CI path. When you have a live PostgreSQL target and want a manual smoke run, use `.github/workflows/runtime-ops-live-smoke.yml` or run:

- `npm run perf:verify-postgres-runtime-persistence-live-smoke`
- `npm run perf:verify-postgres-shared-coordination-live-smoke`

Those commands skip cleanly when the live smoke URL is not configured.
The manual workflow still performs a locked
`npm ci --include=optional --ignore-scripts --no-audit --no-fund` installation
and proves that `import('pg')` resolves before either smoke command. The
workflow-policy gate validates the semantic step order, so removing the install,
omitting optional dependencies, skipping the driver preflight, or moving a
smoke ahead of those prerequisites is a failure even when live URLs are absent.
The gate first parses every tracked `.github/workflows/*.{yml,yaml}` file with
the exact locked `yaml` dev dependency. Its separate structural model then
checks triggers, jobs, commands, and step ordering. A malformed plain scalar
containing `: ` fails the syntax phase even if the structural model can still
recognize nearby fields.
The shared-coordination smoke uses only run-unique synthetic identifiers,
removes those exact rows in foreign-key order from a `finally` block, and
verifies zero remaining rows after both success and injected failure. It never
prints the configured connection URL.

When a change affects shared-boundary locator/path/reanchor behavior,
Governance Admission selects the runtime and security evidence required by the
route. Use the focused shared-runtime commands below for local diagnosis.

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

- `npm run perf:verify-branch-policy`
- `npm run perf:verify-branch-policy-fixtures`
- `npm run perf:verify-release-version`
- `npm run perf:verify-release-reproducibility`
- `npm run perf:verify-release-workflow-policy`
- `npm run perf:verify-release-provenance`
- `npm run perf:verify-pack-topology` (also injects an early copy failure and proves that the primary diagnostic is preserved, the nonzero exit is deferred, and the owned fixture root is removed)
- `npm run perf:verify-tracked-sensitivity`
- `npm run perf:verify-doc-references`

The release version verifier checks that the sole product version authority `VERSION`, its derived `package.json` and package-lock root versions, the workflow and pack manifests, README tagged install examples, and the documented Git workflow provenance policy stay aligned. The reproducibility verifier builds the exact clean tracked commit twice in isolated output roots, compares bytes, checks the npm package topology, and rejects sensitive inputs. `perf:verify-release-artifacts` remains the post-build check used by the main publication job.
The branch-policy fixtures distinguish feature ancestry from `dev`, release
ancestry from `dev`, hotfix ancestry from `main`, and exact main-to-dev
synchronization. They also reject non-patch hotfix versions, mismatched
synchronization version suffixes, version-mismatched publication branches,
reversed synchronization, and divergent remote provenance. The release
publication cases derive their matching and mismatching branch versions from
the tracked `VERSION`, so a valid version bump cannot stale the positive fixture.
The release
workflow-policy gate parses the workflow structure and requires exact
single-command calls to
`tools/ci/fetch-branch-policy-sources.mjs` and
`tools/ci/prove-publication-source.mjs`. The helpers are tested through injected
Git and GitHub responses. The three workflow call sites also enforce their
exact blocking step metadata: the architecture fetch keeps only its required PR
condition, while the release fetch and publication proof have no step condition,
and none may declare `continue-on-error`. Publication classification requires
the unique merged PR's `merge_commit_sha` to equal `GITHUB_SHA`. Comments,
dormant shell blocks, wildcard hotfix routes, associated-but-different merge
commits, or weakened unique-PR assertions cannot satisfy the gate.
The pack topology verifier checks the package tarball surface, the published docs allowlist, and the leak guard for guarded terms in package paths and contents. The tracked-sensitivity verifier separately scans the complete Git-tracked tree, including historical planning documents and fixtures. It uses exact negative probes so weakening or bypassing the detector fails the gate. Current tracked content is neutralized, but older Git objects can retain prior pilot names and local paths; history cleanup may therefore still be required before wider archival or publication.
The documentation-reference verifier resolves active local Markdown links and
literal `npm run` references against the tracked tree and `package.json`; its
negative probes prove that a missing link and a missing script are rejected.

Stable family wrappers are cataloged in `package/catalogs/gates.v1.json`: `verify:contracts`, `verify:governance`, `verify:runtime`, `verify:codex`, `verify:release`, and `verify:all`. The first four select their named family. `verify:release` executes every gate whose obligation is required or optional in the announced `main` or `release` context, including topology and tracked-tree sensitivity; it is not a release-family-only shortcut. Run `verify:all` only at a clean commit boundary so the cleanliness family is meaningful. Report `SKIP` separately from `PASS`.

Manual governance admission uses the selected branch name when pull-request
head metadata is absent, with `dev` as its default target. The cleanliness
family fetches that announced branch plus `dev` and `main`, then requires the
remote branch to equal the exact checked-out candidate SHA. An absent target,
inconsistent branch identity or mismatched SHA still fails the provenance
check. The `cleanliness`, `release` and `codex` families install locked development
dependencies before running their consumers.

Pull-request matrix jobs add `--admission` to the internal family runner. That
flag excludes the two `manual-only` PostgreSQL live smokes; the route records
them as `UNAVAILABLE` deferred evidence. The manual live-smoke workflow retains
its own honest `PASS`, `SKIP`, or `UNAVAILABLE` reporting.

`perf-kpi.yml` is observability, not an admission substitute. Its pull-request
trigger is limited to runtime, performance, index, and self-host paths, while
`workflow_dispatch` remains available for an explicit measurement campaign.

Every cataloged verification gate is non-mutating with respect to the checkout.
The family runner snapshots `git status --porcelain=v2 --untracked-files=all`
before and after each executed gate. A gate that introduces a tracked change or
an untracked, non-ignored path fails immediately under its own gate id, with a
bounded path/status list. Git command failures are reported separately with
redacted exit/stdout/stderr diagnostics. Command failures likewise retain the
exit code, signal, and bounded redacted stdout/stderr tails in both the JSON
result and text summary. An unmet required condition is `FAIL`; only an unmet
optional condition or an explicit catalog `skip` remains `SKIP`.
`cleanliness-worktree` executes in `dev`, `main`, and `release` instead of using
cleanliness as its own precondition. When changing this behavior, run:

- `npm run perf:verify-gate-runner-fixtures`
- `npm run perf:verify-gate-catalog`
- `npm run verify:cleanliness`

The Codex context repair fixture emits one structured result document on every
normal or failing execution. Named assertion failures preserve expected and
observed values plus cleanup status. Child process failures preserve the stage,
status, signal, timeout/error code, and bounded redacted output tails. The
deterministic diagnostic gate forces one named assertion false and proves that
the same evidence survives direct execution and the family runner:

- `npm run perf:verify-codex-context-diagnostics`

The coordinator next-action fixture likewise preserves bounded, redacted child
status, signal, error code, stdout tail, and stderr tail on failure. Its
deterministic probes cover a nonzero child with stdout-only evidence, a timeout,
secret redaction, and cleanup after an injected failure immediately after
creating the owned temporary root.

The start-session and installed-Codex-client verifiers execute child commands
with `spawnSync`. Their process evidence records synchronous call returns and
never re-probes a numeric PID after the call, because an operating system may
reuse that number for an unrelated process. Process-leak evidence remains tied
to owned resources and timeout results, while temporary directory cleanup is
verified independently. The `--case --json` start-session result always emits
a boolean `pass` value.

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

## Codex integration qualification

`perf:verify-codex-integration` runs isolated temporary product installations,
owned-asset conflict/rollback/interruption cases, real child-process cache
concurrency, hook adapter protocol fixtures and bootstrap lifecycle contracts.
It never installs the package into this source checkout and does not call an LLM.
The composite also executes project and worktree authorization, stale bootstrap
plans, historical skill repair, complete installation recovery and fault-boundary
fixtures. They exercise the real transaction service
with temporary clients: a matching historical asset, configuration staging,
version finalization, receipt-write failure, package-bound resume, scoped rollback
and later third-party edits. Filesystem fault injection is labeled as injected
evidence; it does not claim a physical disk failure. The import suite prepares
current installer assets and overlays only the runtime corpus, keeping the
absence of project configuration as a tested precondition.
A new ownership regression must first fail on the previous installer.

Record PASS, FAIL, SKIP and UNAVAILABLE separately. Identify source, scaffold,
fixture, installed package and real client evidence. Adapter fixtures cannot
prove native hook execution, human trust, disabled-hook behavior or whole-tool
coverage. Windows, Unix, WSL, cloud, CLI, application and IDE qualifications are
separate. See [the support boundary](CODEX_INTEGRATION.md).

Measurements report wall-clock milliseconds and output bytes on the same fixture;
bytes are not tokens. Native qualification uses a reviewed temporary client with
human trust and verifies both a denied covered edit and an admitted edit after
fresh core prerequisites. Error, timeout and out-of-coverage tests remain necessary.
