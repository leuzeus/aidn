# Migration Guide - Runtime Persistence SQLite to PostgreSQL

Date: 2026-04-09
Status: active, relational-canonical
Scope: safe adoption of canonical runtime persistence from local SQLite to PostgreSQL for runtime artifacts, while preserving local checkout-bound files and an optional local SQLite compatibility projection.

## What Changes

Canonical runtime artifact persistence is now explicit:

- `runtime.persistence.backend = sqlite | postgres`
- `runtime.persistence.connectionRef = env:VAR_NAME`
- `runtime.persistence.localProjectionPolicy = keep-local-sqlite | keep-json | keep-sql | none`

Current PostgreSQL meaning:

- PostgreSQL is the canonical relational runtime backend
- canonical runtime reads and writes use the relational runtime schema in `aidn_runtime`
- `runtime_snapshots` is not canonical storage and is only used by admin compatibility flows when migrating older PostgreSQL installs

This does not change:

- `runtime.stateMode`
- `install.artifactImportStore`
- `docs/audit/*`, `AGENTS.md`, `.codex/*`
- shared coordination schema ownership

## Stay On SQLite

If you want no backend change, keep:

```json
{
  "runtime": {
    "persistence": {
      "backend": "sqlite",
      "localProjectionPolicy": "keep-local-sqlite"
    }
  }
}
```

No transfer or PostgreSQL bootstrap is attempted.

## Adopt PostgreSQL

1. Set a connection reference in the environment:

```powershell
$env:AIDN_PG_URL="postgres://user:pass@host:5432/dbname"
```

2. Request PostgreSQL as the canonical backend:

```json
{
  "runtime": {
    "persistence": {
      "backend": "postgres",
      "connectionRef": "env:AIDN_PG_URL",
      "localProjectionPolicy": "keep-local-sqlite"
    }
  }
}
```

3. Preview the adoption plan first:

```powershell
aidn runtime persistence-adopt --target . --backend postgres --dry-run --json
```

4. Apply when the plan is safe:

```powershell
aidn runtime persistence-adopt --target . --backend postgres --json
```

Recommended rollout policy today:

- use `localProjectionPolicy = keep-local-sqlite` for normal adoption
- `localProjectionPolicy = none` is supported for canonical PostgreSQL runtime reads when the repository is ready to drop the local SQLite compatibility projection
- keep `keep-local-sqlite` when you still rely on legacy sync-only or local SQLite inspection flows outside the canonical runtime path

## Planner Outcomes

- `noop`: target already matches or no adoption is needed
- `bootstrap-target`: PostgreSQL schema must be created before first canonical use
- `migrate-target`: PostgreSQL schema exists but needs migration
- `transfer-from-sqlite`: local SQLite contains canonical payload and PostgreSQL is empty or missing
- `repair-target`: PostgreSQL schema is incomplete but repairable before first canonical use
- `blocked-conflict`: PostgreSQL already contains ambiguous or conflicting canonical state

Additional target compatibility states exposed by `persistence-status` / `db-status`:

- `empty`: target schema absent
- `empty-relational`: relational schema present but no canonical payload rows yet
- `legacy-only`: only legacy PostgreSQL snapshot rows exist for the scope
- `mixed-legacy-v2`: both legacy snapshot rows and canonical relational rows exist
- `relational-ready`: canonical relational rows exist and no legacy snapshot row remains for the scope
- `target-unavailable`: connection or target inspection failed before compatibility derivation

## Blocking Rules

Adoption is intentionally blocked when:

- the PostgreSQL connection cannot be resolved
- the PostgreSQL schema is partially present and source/target state is ambiguous
- PostgreSQL already contains canonical payload that differs from the SQLite source
- the SQLite source reuses one logical `cycle_id` across multiple cycle directories (`reason_code=source-cycle-identity-ambiguous`)
- the SQLite source payload points to a different runtime scope than the requested target root (`reason_code=source-scope-drift`)

The tool will not merge source and target automatically.

Legacy PostgreSQL handling:

- snapshot-v1 PostgreSQL installs are migrated by backfilling canonical relational rows
- successful migration drains legacy `runtime_snapshots` rows for the target scope
- canonical runtime paths do not read `runtime_snapshots`
- admin backup/migration can still read an old snapshot row when no canonical relational payload exists yet

## Install-Time Adoption

`install` can now request PostgreSQL directly:

```powershell
node tools/install.mjs --target ../repo --pack core --runtime-persistence-backend postgres --runtime-persistence-connection-ref env:AIDN_PG_URL
```

Behavior:

- artifact import can still prepare a local runtime projection for compatibility flows
- install then plans runtime backend adoption explicitly
- a blocked adoption aborts the install before persisting the new backend config
- a successful transfer records adoption metadata in `aidn_runtime`

## Rollback Expectations

Rollback is operational, not destructive:

- checkout-bound files remain in the repository
- local SQLite compatibility projection can remain available when `localProjectionPolicy=keep-local-sqlite`
- runtime PostgreSQL backups can be created with `aidn runtime persistence-backup`

Recommended rollback sequence:

1. export a PostgreSQL runtime backup
2. switch `runtime.persistence.backend` back to `sqlite`
3. keep the local SQLite projection as the active canonical backend
4. inspect the PostgreSQL target before any later re-adoption

## Observability

Use these commands:

```powershell
aidn runtime persistence-status --target . --json
aidn runtime persistence-migrate --target . --json
aidn runtime persistence-backup --target . --json
aidn runtime persistence-adopt --target . --dry-run --json
```

If adoption is blocked by duplicated logical cycle identities in the SQLite source:

```powershell
aidn runtime persistence-source-diagnose --target . --json
aidn runtime persistence-source-normalize --target ..\recovery-copy --rename C004-spike-root-structure-investigation=C020-spike-root-structure-investigation --rename C005-structural-root-simplification-lot1=C021-structural-root-simplification-lot1 --rename C032-corrective-component-review-hardening=C034-corrective-component-review-hardening --json
node tools/perf/index-sync.mjs --target ..\recovery-copy --store dual-sqlite --with-content --json
aidn runtime persistence-source-diagnose --target ..\recovery-copy --json
aidn runtime persistence-adopt --target ..\recovery-copy --backend postgres --dry-run --json
```

Normalization guidance:

- the command now scopes its rewrites to the canonical source corpus under `docs/audit`
- provide only approved rename mappings; the tool does not decide merge-vs-rename policy for you
- the command rewrites structured cycle references and cycle-local identifiers, then renames the mapped cycle directories
- for live execution, back up SQLite, PostgreSQL, and any local recovery traces before replaying it on the repository root

Validated recovery sequence on 2026-04-10:

- workspace: `G:\projets\gowire\.aidn\runtime\recovery\2026-04-10-cli-normalized-workspace`
- normalization: `files_scanned=891`, `files_updated=39`, `directories_renamed=3`
- index rebuild: `cycles_count=89`, `sessions_count=74`, `artifacts_count=891`
- source diagnostics after normalization: `diagnostic_status=ready`, `cycle_identity_collision_count=0`, `adoption_blocked=false`
- PostgreSQL smoke target: `postgres://root:***@192.168.1.173:5433/aidn_smoke`
- adoption write: `action=transfer-from-sqlite`, `verification.ok=true`
- second dry-run after write: `action=noop`, `reason_code=target-matches-source`
- target status after write: `storage_policy=relational-canonical`, `compatibility_status=relational-ready`, `canonical_payload_rows=1`, `legacy_snapshot_rows=0`

Validated `localProjectionPolicy=none` recovery sequence on 2026-04-10:

- workspace: `G:\projets\gowire\.aidn\runtime\recovery\2026-04-10-postgres-none-smoke`
- config: `runtime.stateMode=db-only`, `runtime.persistence.backend=postgres`, `runtime.persistence.localProjectionPolicy=none`
- after PostgreSQL adoption, the local `workflow-index.sqlite` projection was removed from the recovery copy
- `persistence-status` resolved `projection_backend=postgres`, `projection_scope=runtime-canonical`, `compatibility_status=relational-ready`, `adoption_action=noop`
- `project-runtime-state` resolved `shared_state_backend.projection_scope=runtime-canonical` and `digest.current_state_source=postgres`
- `db-only-readiness` passed with `projection_scope=runtime-canonical` and `current_state_source=postgres`

Live smoke fixture coverage on 2026-04-10 also validates the same cutover:

- `tools/perf/verify-postgres-runtime-persistence-live-smoke.mjs`
- after transfer, the smoke switches to `localProjectionPolicy=none`, removes the local SQLite projection, and verifies:
  - `project-runtime-state` reads `CURRENT-STATE` from PostgreSQL
  - `db-only-readiness` resolves `CURRENT-STATE` and `HANDOFF-PACKET` from PostgreSQL
  - `project-handoff-packet` runs with `projection_scope=runtime-canonical`

Read-only validation on the current live `gowire` workspace on 2026-04-10:

- workspace: `G:\projets\gowire`
- current config already declares `runtime.persistence.backend=postgres`, `runtime.persistence.localProjectionPolicy=keep-local-sqlite`, `runtime.stateMode=db-only`
- `persistence-source-diagnose` still reports `diagnostic_status=ambiguous-cycle-identities`
- blocking logical cycle identities remain `C004`, `C005`, `C032`
- the same diagnostics now also expose `reason_codes=source-cycle-identity-ambiguous, source-scope-drift`
- `payload.audit_root` still points to `G:\projets\gowire\.aidn\runtime\recovery\2026-04-08-postgres-recovery\merged-workspace\docs\audit`, not to `G:\projets\gowire\docs\audit`
- `persistence-status` therefore still plans `action=blocked-conflict`; the first blocking reason remains `source-cycle-identity-ambiguous`

Promoted-copy replay on 2026-04-10:

- workspace: `G:\projets\gowire-promoted-live-copy-2026-04-10`
- the promoted copy first rematerialized `docs/audit` from the restored SQLite source (`selected_count=891`, `exported=849`, `unchanged=42`)
- the approved normalization mapping was then replayed on the promoted corpus:
  - `C004-spike-root-structure-investigation` -> `C020-spike-root-structure-investigation`
  - `C005-structural-root-simplification-lot1` -> `C021-structural-root-simplification-lot1`
  - `C032-corrective-component-review-hardening` -> `C034-corrective-component-review-hardening`
- `index-sync --store dual-sqlite --with-content` rebuilt `89` cycles / `74` sessions / `891` artifacts and re-anchored the SQLite source to `target_root=G:\projets\gowire-promoted-live-copy-2026-04-10`
- `persistence-source-diagnose` then converged to `diagnostic_status=ready`, `cycle_identity_collision_count=0`, `adoption_blocked=false`
- because the relational scope had already been populated during rebuild, the PostgreSQL target was backed up then purged for this exact `scope_key`
- after purge, `persistence-adopt --backend postgres --connection-ref env:AIDN_PG_URL` converged on the promoted copy
- the immediate follow-up dry-run returned `action=noop`, `reason_code=target-matches-source`
- final target status converged to `storage_policy=relational-canonical`, `compatibility_status=relational-ready`, `canonical_payload_rows=1`, `legacy_snapshot_rows=0`

Independent replay for double validation on 2026-04-10:

- workspace: `G:\projets\gowire-promoted-live-copy-2026-04-10-validation-2`
- the second promoted copy was rebuilt independently from the live `.aidn` payload, not cloned from the first validated copy
- rematerialization converged with `selected_count=891`, `exported=891`, `unchanged=0`
- initial source diagnostics reproduced the same blockers as live: `diagnostic_status=ambiguous-cycle-identities`, `reason_codes=source-cycle-identity-ambiguous, source-scope-drift`
- approved normalization replay converged again with `directories_renamed=3`
- `index-sync --store dual-sqlite --with-content` rebuilt `89` cycles / `74` sessions / `891` artifacts
- source diagnostics then converged again to `diagnostic_status=ready`, `cycle_identity_collision_count=0`, `adoption_blocked=false`
- the same transient PostgreSQL `payload-drift` was reproduced for the new `scope_key`, proving the first promoted-copy runbook was not a one-off
- after backup + scope purge, `persistence-adopt --backend postgres --connection-ref env:AIDN_PG_URL` applied successfully
- the follow-up dry-run again returned `action=noop`, `reason_code=target-matches-source`
- final target status again converged to `storage_policy=relational-canonical`, `compatibility_status=relational-ready`, `canonical_payload_rows=1`, `legacy_snapshot_rows=0`

Live `gowire` replay on 2026-04-10:

- workspace: `G:\projets\gowire`
- pre-write backups were captured for:
  - SQLite: `G:\projets\gowire\.aidn\runtime\index\backups\workflow-index.2026-04-10T03-55-24-577Z.pre-migration.sqlite`
  - PostgreSQL: `G:\projets\gowire\.aidn\runtime\backups\runtime-postgres.2026-04-10T03-55-24-824Z.json`
  - pre-adoption PostgreSQL drift snapshot: `G:\projets\gowire\.aidn\runtime\backups\runtime-postgres.2026-04-10T04-27-50-372Z.json`
  - local audit snapshot: `G:\projets\gowire\.aidn\runtime\recovery\2026-04-10-live-replay-before\docs-audit-before`
- `artifact-store materialize` rebuilt the live `docs/audit` corpus from SQLite (`selected_count=891`, `exported=849`, `unchanged=42`)
- `persistence-source-normalize` then replayed the approved mapping directly on the live source corpus and converged with `files_scanned=891`, `files_updated=0`, `directories_renamed=3`
- `index-sync --store dual-sqlite --with-content` rebuilt the live SQLite source as `89` cycles / `74` sessions / `891` artifacts
- `persistence-source-diagnose` on live then converged to `diagnostic_status=ready`, `cycle_identity_collision_count=0`, `adoption_blocked=false`
- as on the promoted copies, `index-sync` had already populated one canonical PostgreSQL row for the live `scope_key`, so the live relational scope was backed up then purged before replaying adoption
- after purge, `persistence-adopt --backend postgres --connection-ref env:AIDN_PG_URL` applied successfully on the live workspace
- the immediate follow-up dry-run returned `action=noop`, `reason_code=target-matches-source`
- final live target status converged to `storage_policy=relational-canonical`, `compatibility_status=relational-ready`, `canonical_payload_rows=1`, `legacy_snapshot_rows=0`

Operational implication:

- the PostgreSQL runtime path is validated
- the current live `gowire` workspace is no longer blocked by source normalization policy
- the approved normalization/adoption path now converges on dedicated recovery workspaces, two independent promoted copies, and the live workspace itself
- the remaining operational decision is whether to keep `localProjectionPolicy=keep-local-sqlite` on live or schedule a dedicated live `localProjectionPolicy=none` cutover

`persistence-status` exposes:

- effective canonical backend
- resolved projection backend and scope
- local SQLite source presence when a compatibility projection still exists
- PostgreSQL schema readiness
- PostgreSQL compatibility status (`empty`, `legacy-only`, `relational-ready`, ...)
- adoption plan and blocking reason

`persistence-backup` / `db-backup` can also expose:

- `compatibility_fallback_used=true` when an admin backup had to read a legacy PostgreSQL snapshot because canonical relational rows were not present yet

## Compatibility Window

Compatibility aliases and fallback behavior remain supported through `0.7.x`.

Covered compatibility items:

- `runtime db-status`, `runtime db-migrate`, `runtime db-backup`
- implicit fallback to canonical SQLite when `runtime.persistence.backend` is not configured
- PostgreSQL admin-only compatibility fallback for legacy `runtime_snapshots` during migration/backup

Earliest cleanup target:

- `0.8.0`

Cleanup is gated on successful pilot validation of PostgreSQL runtime adoption outside fixtures.
