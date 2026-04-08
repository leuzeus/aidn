# Migration Guide - Runtime Persistence SQLite to PostgreSQL

Date: 2026-04-05
Status: active
Scope: safe adoption of canonical runtime persistence from local SQLite to PostgreSQL for runtime artifacts, while preserving local checkout-bound files and local SQLite compatibility projection.

## What Changes

Canonical runtime artifact persistence is now explicit:

- `runtime.persistence.backend = sqlite | postgres`
- `runtime.persistence.connectionRef = env:VAR_NAME`
- `runtime.persistence.localProjectionPolicy = keep-local-sqlite | keep-json | keep-sql | none`

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

## Planner Outcomes

- `noop`: target already matches or no adoption is needed
- `bootstrap-target`: PostgreSQL schema must be created before first canonical use
- `migrate-target`: PostgreSQL schema exists but needs migration
- `transfer-from-sqlite`: local SQLite contains canonical payload and PostgreSQL is empty or missing
- `repair-target`: PostgreSQL schema is incomplete but repairable before first canonical use
- `blocked-conflict`: PostgreSQL already contains ambiguous or conflicting canonical state

## Blocking Rules

Adoption is intentionally blocked when:

- the PostgreSQL connection cannot be resolved
- the PostgreSQL schema is partially present and source/target state is ambiguous
- PostgreSQL already contains canonical payload that differs from the SQLite source

The tool will not merge source and target automatically.

## Install-Time Adoption

`install` can now request PostgreSQL directly:

```powershell
node tools/install.mjs --target ../repo --pack core --runtime-persistence-backend postgres --runtime-persistence-connection-ref env:AIDN_PG_URL
```

Behavior:

- artifact import still prepares the local runtime projection
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

`persistence-status` exposes:

- effective canonical backend
- local SQLite source presence
- PostgreSQL schema readiness
- adoption plan and blocking reason

## Compatibility Window

Compatibility aliases and fallback behavior remain supported through `0.7.x`.

Covered compatibility items:

- `runtime db-status`, `runtime db-migrate`, `runtime db-backup`
- implicit fallback to canonical SQLite when `runtime.persistence.backend` is not configured

Earliest cleanup target:

- `0.8.0`

Cleanup is gated on successful pilot validation of PostgreSQL runtime adoption outside fixtures.
