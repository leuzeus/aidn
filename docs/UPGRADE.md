# Upgrade Guide

## Move a 0.9.x project to the global engine

Install a verified [global release](GLOBAL_SETUP.md) first. This replaces
per-project engine versions only for projects explicitly migrated; it does not
silently change existing local installations. See [qualification evidence](qualification/GLOBAL_WINDOWS.md)
for the distinction between publication, native tests and a completed client migration.

1. Inspect the real branch, worktrees, local modifications, config and receipts.
   Reconcile delivered commits without a blanket reset. Back up affected tracked
   and untracked files, private configuration, receipts and recovery state.
2. Record the canonical database identity and data baseline without exposing
   secrets. PostgreSQL remains optional; preserve mode, connection reference,
   profile, adapter and metadata. Database migration is a separate operation.
3. Preview `aidn project migrate --target PATH --json`. Review its exact
   keep/replace/remove/conflict inventory. Ownership comes from receipts and
   recognized hashes, not filenames. Unknown or customized files remain.
4. Apply the same plan with `--write --expect-plan PLAN_ID`. The transaction
   verifies global assets before removing local standard skills/agents, replaces
   managed hooks with connectors and removes `aidn-workflow` through npm while
   preserving unrelated dependencies. History is retained; private backups and
   machine receipts are not committed.
5. Run `aidn doctor --target PATH --json`, inspect canonical workflow admission,
   review the changed hooks in the native client and validate data preservation.
   Installation alone does not complete native review or qualify every client.

For interruption, preview `aidn project migrate --target PATH --resume --json`,
then apply its current exact plan. Do not copy another root's receipt or remove
locks by age. A linked worktree needs explicit preparation and shares repository
revocation while retaining its physical-root binding.

When delivering a migration through a worktree, account for the principal
checkout's own old preimages and receipt before synchronizing migrated tracked
assets. A Git merge does not apply that checkout's local migration transaction.
Retain the backup until both delivery and local diagnosis succeed.

## Global update and rollback

```powershell
aidn update --check --json
aidn update --release latest --json
aidn update --release latest --write --expect-plan PLAN_ID --json
aidn rollback --json
```

The first command consults release/compatibility. The second prepares a frozen
target; the third is an application example requiring that reviewed plan.
Rollback also needs `--write --expect-plan` after its own preview. All registered
projects must be accessible and compatible. Data migration needs, inconsistent
state or interrupted operations block switching. Ordinary update/rollback
changes the common engine/assets, not project files, last-use registry state or
databases. Rollback never implicitly restores data. Network failure means
unavailable, not up to date; a verified local tarball remains usable.

Changed project connectors require explicit repair and renewed native review;
see [connector repair and recovery](GLOBAL_SETUP.md#migration-and-interrupted-operations).
`aidn setup` is an interactive executor whose confirmation applies the same plan,
not a read-only check. `--json` is formatting and never write authorization.

If generated guides retain old commands after migration, use the separate
[installation-scoped repair](GLOBAL_SETUP.md#refreshing-generated-project-guides)
with 0.10.8 or later. A normal global update intentionally leaves project files
alone; adapter migration is not a substitute for regenerating existing views.

## Historical release and local-client procedures

The versioned notes and local npm/bootstrap examples below document earlier
deliveries. They remain useful for legacy/source maintenance; they are not the
global migration/update path above. Old version numbers are intentional history.

## Upgrade to 0.9.1

Read-only `context-reload` can reconstruct an active project's context before
a mode or session exists. Activation and canonical backend availability remain
required; this does not grant write admission or create workflow state.
Reinstall the owned skill to remove automatic hook/cache writes from its
read-only path. Cache hydration requires separate explicit authorization.

## Upgrade to 0.9.0

Use the published [v0.9.0 release](https://github.com/leuzeus/aidn/releases/tag/v0.9.0)
and verify the tarball against its manifest. Covered native product patches require an
explicit task scope in the canonical plan. Follow
[the client migration guide](CODEX_CLIENT_MIGRATION.md), reinstall owned hooks,
and review them in Codex. Installation does not establish native approval.

## Upgrade to 0.8.0

Bootstrap preserves client instructions and third-party hooks and manages AIDN
assets with local ownership receipts. Preview before an upgrade and resolve
reported conflicts. Recovery actions default to preview and require `--write
--expect-plan <plan_id>` to apply. `--uninstall` removes only the managed Codex
integration, retaining runtime and project history. Model-assisted customization
migration now requires `--codex-migrate-custom`.

The default lifecycle scope remains `codex-integration`. Add
`--scope installation` to diagnose or recover the complete recorded local
installation using the same receipt, lock and transaction history. Runtime and
seed state stay preserved. Use the exact current preview plan ID for writes;
changes to inputs or owned files require a fresh preview.

`VERSION` in the executing AIDN package is the sole product version authority.
In a client, `.aidn/config.json` keeps root `version: 1` as its configuration
schema. The optional `install.aidnVersion` records the last complete successful
requested installation from that package, tied to the local installation
receipt. A legacy config without `version`, `install` or `install.aidnVersion`
remains readable; a missing product marker means unknown. Do not infer it from
root schema version, generated docs or an available CLI. Preview and diagnostic
runs do not stamp it, and failed or interrupted runs do not count as successful
installation. Complete installation rollback restores the previous marker.

A matching recorded version does not prove that files remain intact or that
native Codex trust has been granted. Read `--diagnose --scope installation --json`
to distinguish executing package version, last successful installation, receipt
binding and managed asset drift.

Legacy adoption is bounded to recorded ownership and recognized historical
content. The known `pr-orchestrate` YAML defect is repaired only for an exact
historical asset, at either supported skills path; customized variants conflict
before writes. Generated WORKFLOW adoption from 0.7.2 requires its prior version
record and a complete matching historical rendering with an approved template
fingerprint. Unrecognized documents are not adopted by their filename alone.

Codex 0.155 rejects a root `version` property in `.codex/hooks.json`. The 0.8.0
installer removes the old `version: 1` property only when it recognizes an
AIDN-owned hook. A standalone or ambiguous version property, or another
unsupported root field, is a preview conflict. Review the conflict before
editing client hooks; the installer does not discard unrelated commands.

See [Codex integration](CODEX_INTEGRATION.md) for trust, support limits and recovery.

## Upgrade to 0.7.2

This governance-only release replaces duplicated pull-request verification
with one risk-adaptive admission path:

- `governance-route.v1` records exact diff provenance, lane, reasons, selected
  families, gates, deferred evidence, escalations, and final state;
- `FAST`, `STANDARD`, and `ASSURED` select the required evidence without
  weakening cross-cutting invariants, while exact production hotfixes receive
  the `EMERGENCY` overlay on top of `ASSURED`;
- each selected gate family executes once and the protected
  `Governance Admission` rollup fails closed on classification or required-gate
  failure;
- PostgreSQL live smokes remain optional and manual, and publication still
  repeats the complete release verification before creating a tag or GitHub
  Release;
- no public CLI command, public JSON contract, runtime persistence boundary, or
  npm publication behavior changes in this release.

## Upgrade to 0.7.1

This governance correction makes the future production maintenance paths
executable and fail-closed:

- a `hotfix/vX.Y.Z` PR must start from current `main`, increment its patch
  version by exactly one, and follows the same GitHub Release path as a normal
  release;
- a `sync/main-to-dev-vX.Y.Z` PR must use the source commit's exact `VERSION`,
  equal current `main` byte-for-byte, and target only `dev`;
- publication proves one merged, version-matched release or hotfix PR whose
  `merge_commit_sha` equals the exact `main` `GITHUB_SHA`, and never invokes
  `npm publish`.

## Upgrade to 0.7.0

This baseline makes AIDN's governed architecture and release path executable end to end:

- machine-readable catalogs cover CLI surfaces, effects, public JSON contracts, governed concepts, gate obligations, and workflows.
- the public Codex `context-store` subcommand is removed; use `aidn codex hydrate-context` for context bundles or `aidn codex workflow-step` for the batched admission/hydration path.
- Node.js 22.13 or newer is required by the package and installer compatibility policy.
- `--json` is format-only; writes require explicit `--write`, `--apply`, `--execute`, or the documented equivalent, and atomic replacements preserve the previous state on failure.
- public machine-readable commands emit one complete JSON document on `stdout`, while bounded diagnostics remain on `stderr`.
- installed Codex integration includes project skills, bounded custom agents, a trusted-project session hook, real installed-client discovery, and preserved failure/cleanup diagnostics.
- `files`, `dual`, and `db-only` remain distinct modes; PostgreSQL persistence is optional, SQLite remains available for local compatibility and migration, and shared coordination is explicit opt-in.
- protected-branch CI and the release workflow verify from locked dependencies;
  a merged, version-matched `release/vX.Y.Z` PR is published from exact `main`
  `GITHUB_SHA` with an annotated tag, ZIP and npm `.tgz`, checksums, and provenance assets, never
  with `npm publish`.
- generated workflow adapter outputs driven by `.aidn/project/workflow.adapter.json`
- `aidn project config` as the durable adapter management entrypoint
- bounded coordinator/orchestration runtime commands
- shared coordination PostgreSQL visibility/admin commands
- runtime persistence adoption and migration support for `sqlite | postgres`
- Mermaid and BPMN documentation aligned with the current baseline

Recent workflow resilience updates also add:

- `docs/audit/WORKFLOW-KERNEL.md`
- `docs/audit/CURRENT-STATE.md`
- `docs/audit/RUNTIME-STATE.md`
- `docs/audit/REANCHOR_PROMPT.md`
- `docs/audit/ARTIFACT_MANIFEST.md`
- explicit pre-write guidance in `AGENTS.md`

## Product repository steps

1. Update workflow sources in this repository (`docs/SPEC.md`, `scaffold/`, manifests).
2. Align product version signals so live docs and manifests match `VERSION`:
   - `package.json`
   - `package-lock.json`
   - `README.md`
   - `package/manifests/workflow.manifest.yaml`
   - `packs/core/manifest.yaml`
   - `packs/runtime-local/manifest.yaml`
   - `packs/codex-integration/manifest.yaml`
   - `packs/github-integration/manifest.yaml`
   - `packs/extended/manifest.yaml`
3. Regenerate and verify fixtures:
   - `node tools/install.mjs --target tests/fixtures/repo-installed-core --pack core`
   - `node tools/install.mjs --target tests/fixtures/repo-installed-core --pack core --verify`
4. Re-run current verification coverage:
   - `npm run perf:verify-context-resilience`
   - `npm run perf:verify-project-config`
   - `npm run perf:verify-shared-coordination-runtime-cli`
   - `npm run perf:verify-runtime-backend-adoption`

## Historical local-client repository steps

1. Install or upgrade the package to the matching product tag:

```bash
npm install --save-dev github:leuzeus/aidn#v0.9.0
```

2. Run the recommended upgrade orchestrator:

```bash
npx aidn bootstrap --target <client-repo> --mode upgrade --profile default
```

Use profile `full` when the client repo intentionally carries all optional integration layers:

```bash
npx aidn bootstrap --target <client-repo> --mode upgrade --profile full
```

Use profile `postgres` only when PostgreSQL runtime persistence is explicitly configured:

```bash
npx aidn bootstrap --target <client-repo> --mode upgrade --profile postgres --runtime-persistence-connection-ref env:AIDN_PG_URL
```

Advanced lower-level pack reinstall remains available:

```bash
npx aidn install --target <client-repo> --pack core
npx aidn install --target <client-repo> --pack github-integration
npx aidn install --target <client-repo> --pack github-integration --verify
```

3. Refresh or migrate the durable project adapter when needed:

```bash
npx aidn project config --target <client-repo> --wizard --write
npx aidn project config --target <client-repo> --migrate-adapter --version 0.8.0 --write --json
```

4. Verify installation and current runtime/admin surfaces:

```bash
npx aidn install --target <client-repo> --pack core --verify
npx aidn runtime shared-coordination-status --target <client-repo> --json
npx aidn runtime persistence-adopt --target <client-repo> --backend postgres --dry-run --json
```

5. Review local adapter updates:
- `docs/audit/CURRENT-STATE.md`
- `docs/audit/WORKFLOW-KERNEL.md`
- `docs/audit/WORKFLOW.md`
- `docs/audit/WORKFLOW_SUMMARY.md`
- `docs/audit/REANCHOR_PROMPT.md`
- `docs/audit/ARTIFACT_MANIFEST.md`
- `docs/audit/CONTINUITY_GATE.md`
- `docs/audit/RULE_STATE_BOUNDARY.md`

Recommended post-upgrade reload path:

1. `docs/audit/CURRENT-STATE.md`
2. `docs/audit/WORKFLOW-KERNEL.md`
3. `docs/audit/WORKFLOW_SUMMARY.md`
4. `docs/audit/RUNTIME-STATE.md` when runtime freshness or repair signals matter
5. `docs/audit/WORKFLOW.md`
6. `docs/audit/SPEC.md` if canonical rule details are needed

The installer now manages only the AIDN block in `AGENTS.md` and preserves client
instructions around it. Preview reports conflicts for edited managed blocks;
`--force-agents-merge` does not bypass those conflicts. Use `--skip-agents` with
the low-level installer only when project instruction integration is deliberately
managed elsewhere.

## Preserve authorization and persistence intent

For an existing Windows client, follow the [controlled client migration](CODEX_CLIENT_MIGRATION.md)
to preserve its runtime binding, local edits and canonical persistence before switching packages.

Preview an upgrade with `aidn bootstrap --target <client-repo> --mode upgrade --dry-run --json`, then bind application with the same inputs plus `--expect-plan PLAN_ID` and without `--dry-run`. `--persistence-policy verify-only` checks an existing backend without requesting schema migration, persistence adoption or import. A mismatch fails before installation writes.

Repair, resume and rollback preserve revocation. Reauthorization requires the explicit `bootstrap --authorize` preview and matching `--write --expect-plan PLAN_ID`; native client trust is still a separate human action. Public skills now use the `aidn-` prefix, while internal CLI identifiers remain compatible. See [project activation](CODEX_INTEGRATION.md#project-activation-and-skill-names).
