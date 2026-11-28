# ADR-0027: Retire FILES state authority

Status: accepted

## Context

Separate checkout copies cannot establish a shared session and cycle history.
The former FILES runtime mode also allowed a local Markdown copy to replace
missing SQL authority. The product now keeps SQLite for local projects and
optional PostgreSQL for shared projects, using the same runtime contracts.

## Decision

The supported state profiles are `dual` and `db-only`. SQLite is the default
backend; PostgreSQL remains optional. Both profiles read canonical workflow
state from SQL. `dual` maintains visible projections; `db-only` materializes
detailed Markdown on demand. A missing or unavailable canonical store refuses
the operation instead of falling back to files.

`files` is rejected as a configuration, environment or CLI runtime selection.
Historical schemas and records can still describe it. Their bytes, signatures,
receipts and unresolved effects are not converted into new authority.

The existing `runtime mode-migrate` command is the explicit legacy transition.
Its preview is read-only. With `--write`, it verifies sessions, cycle ownership,
attachment, active focus and history, copies exact UTF-8 bytes to SQLite or an
explicitly selected PostgreSQL scope, verifies the destination, and publishes
configuration last. Existing SQL authority is preserved; stale projections are
never imported over it. PostgreSQL already configured under the former FILES
label was canonical and is not replaced by a local copy.

Migration excludes concurrent local effects through the existing effect lock.
An interrupted copy leaves source configuration intact. A later explicit retry
may match identical destination rows; conflicting destination state refuses.
This is not a distributed transaction across all historical clients: stop other
writers before migrating a legacy project. Migration neither repairs records
nor grants workflow replay, model consumption or reconciliation permission.

## Consequences

New installs use SQLite/dual unless another SQL profile is selected. Existing
FILES installations migrate before normal install/update or runtime execution.
There is no implicit conversion during an update. SQL profile changes preserve
canonical rows and metadata; backend adoption remains a separate operation.

Git product files, distribution assets, administrative configuration, host
keys, locks, evidence and historical qualification reports remain files. Their
existence does not reintroduce a FILES workflow state mode.

This supersedes the FILES operating-mode choices in ADR-0002, ADR-0003,
ADR-0022, ADR-0023 and ADR-0025, while preserving their historical contracts.
ADR-0007 and ADR-0008 retain the optional PostgreSQL and sharing boundaries.

## Validation

`perf:verify-files-retirement` covers rejection, read-only preview, byte-preserving
SQLite migration, retained COMMITTING/history, cycle ownership, interruption,
source drift, and preservation of canonical SQL over stale visible Markdown.
The runtime state-mode gate also covers both SQL profiles. Live PostgreSQL and
installed workflow continuation require their own evidence; fixtures do not
establish complete STANDARD qualification.
