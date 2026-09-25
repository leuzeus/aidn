# ADR-0013 — One user-level AIDN runtime

## Status

Accepted; global installation shipped in 0.10.0. The 0.10.1 implementation
corrects canonical PostgreSQL artifact writes and checkpoint preservation.

This decision supersedes independent per-project engine versions for projects
explicitly migrated to the global installation. Existing local installations
continue working until migrated. It does not supersede project activation,
native client trust, optional PostgreSQL, or the local-first data boundary.

## Decision

One user installation owns the active engine, standard skills, agents and hook
implementation. Projects own configuration, workflow adapters, data, activation,
custom extensions and minimal hook connectors. The host registry is an address
book and a mandatory update preflight scope, not an authority over project state.

The host store keeps immutable package generations with a complete file digest
inventory (including installed dependencies), provenance, a stable installation
identity and a single active pointer. Stable launcher files and user-level Codex
definitions are owned assets with explicit preimages and postimages.

Preview is read-only. Application requires an exact confirmed plan, an unchanged
registry and fresh compatibility checks for every remembered project. Unavailable,
inconsistent or incompatible projects block the switch. No project is silently
removed, granted activation, assigned a different version or migrated in the DB.
Revocation does not skip preparation and persistence checks.

A shared admission mutex orders operation leases and updates. Existing operations
keep their generation; a switch refuses while leases remain. A pending journal
blocks normal entry points. Explicit recovery validates the exact journal and
accepts only recorded asset images and states. A stale lock or lease is never
silently deleted based on elapsed time. Recovery of orphaned ownership must be
qualified before exposing the public updater.

Compatibility of workflow schemas is separate from package SemVer and from the
Codex integration revision. Skills and agents invoke the stable launcher with
their integration revision; mismatches require reload. Project receipts retain
the last completed installation as history and bind execution separately to the
global installation identity. Merely finding global skills does not activate a
project. Standard assets edited by the user cause an explicit conflict.

Local connectors own bounded transport failure handling, not admission policy.
While still running, they emit a structured native denial for a failed or invalid
PreToolUse response and degraded read-only context for SessionStart. Native
non-execution or termination cannot be made safe by a connector that cannot reply.
Correcting an existing connector requires explicit project repair and renewed
human review; global updates never silently replace those project files. This
transport correction retains the existing integration revision and JSON protocol.

Global code sharing does not move workflow data into shared infrastructure.
PostgreSQL connections and canonical project identities stay unchanged. Candidate
verification uses the existing read-only persistence checks; migrations remain a
separate explicitly authorized operation.

Creating a new local PostgreSQL project is a separate explicit installer effect:
pin the official server version, provision dedicated resources, and initialize
only an empty database. Existing resources remain verify-only. Host preparation
journals retain references and phases without passwords, freeze the initial plan,
and block global switching until the interrupted bootstrap is resumed. They do
not authorize database rollback or installing a project-local engine.

## Migration ownership

An exact cleanup inventory classifies managed, modified, missing and unmanaged
assets using receipt content and physical-root identity. Remove managed skill and
agent copies only after global availability has been verified. Replace only owned
hook entries and the managed AGENTS block. Unknown files and personal changes are
preserved. Empty legacy directories may be removed non-recursively after a fresh
emptiness check. Historical workflow records are retained.

The public migration must back up its affected files privately, journal external
npm work, preserve unrelated dependencies and support resumption. Successful
asset migration alone is not evidence that npm cleanup, documentation alignment,
native discovery or DB qualification completed.

## Implementation boundary

The implementation supplies the store, package staging, global assets, launcher,
project binding, candidate compatibility, public management CLI and cleanup
transaction. Migration journals private backups and resumes interrupted npm work.
The common wizard applies the same exact plans; the source PowerShell entry point
registers user environment variables. Orphan recovery requires a previous OS boot
witness, otherwise it refuses. See `docs/GLOBAL_SETUP.md` for the remaining wizard,
native integration and release qualification boundaries. The version authority
is recorded in `VERSION`; every subsequent release retains those qualification
obligations. Release availability does not complete any individual client migration.

Before 0.10.0 publication, require public effect/JSON coverage, update and rollback
preflights against migrated projects, interrupted external-operation recovery,
actual Windows native discovery and hook execution, and a two-project end-to-end
trial. Live PostgreSQL proof is separate from fake-driver tests. A real pilot
migration follows publication in a separate client task.
