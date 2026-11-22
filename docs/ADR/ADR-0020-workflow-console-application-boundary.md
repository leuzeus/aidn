# ADR-0020 - Common workflow console application boundary

## Status

Proposed; experimental opt-in CLI and local dashboard over ADR-0018/0019.
Default execution and SPEC authority remain unchanged. Source/HTTP fixtures
do not establish native Codex or external pilot qualification.

## Decision

Three public commands expose one application service: `workflow-inspect`,
`workflow-action` and `workflow-dashboard`. Their JSON roots have explicit v1
contracts. The dashboard consumes the same inspection and action objects as
the CLI; it never reads or writes database tables. Its transport has no separate
business rules or alternate admission path.

The derived `workflow-console-view.v1` reports the reference-only primitive
registry, canonical selections and revisions, instance cursors and graph IDs,
retained human evidence, run checkpoints, blockers and limits. Inspection does
not infer a client instance from source fixtures or the default SPEC workflow.
Catalog reads resolve the current backend/mode on each request, reject an
unavailable configured store, and never import visible DB-mode projections.
The catalog declares truncation and supports exact selectors. Consistency is
per record, not an atomic snapshot across records or backends.

Historical run checkpoints are explicitly retained observations. A live run
requires its explicit configuration and ID and delegates to existing read-only
`agent-run-status`. Execution, attempt acceptance, integration, final validation
and cleanup retain their independent statuses. Active project authorization
is an observed prerequisite, not proof of native admission or permission to
apply the next action.

Action requests have a closed operation/input allowlist. They cannot carry a
target override, module, SQL, executor or hidden effect flag. Preview is pure
and hashes the target identity, exact request, underlying preview and effects.
Application requires the exact current action hash and explicit `--write` or
`--execute`; run effects additionally require `--sync-relay`. The instance and
selection services retain current authorization, preview review and CAS checks.
A new optional expected-result hash prevents a changed initialization,
prepared segment or reconciliation from committing different checkpoint bytes
between outer preview and inner application. Existing callers keep their
behavior when this additional pin is absent.

Supervised run requests delegate to the existing public lifecycle with its
inner action hash. They preserve run configuration, native admission,
reservation, scheduler, cancellation and cleanup semantics. They do not infer
supervisor approval from a human macro decision. A new instance segment intent
must still be checkpointed before previewing a run whose canonical digest it
changes. Failure after a canonical commit keeps `written: true`; neither client
automatically retries an uncertain action.

Only `workflow-dashboard --serve` opens a foreground server. It binds an
OS-assigned port on `127.0.0.1` and creates a random in-memory session token.
Static assets contain no project state. API requests require the token, exact
Host/Origin and JSON POSTs, have bounded request bodies, and do not grant CORS.
CSP excludes third-party scripts, framing, remote connections and inline code.
DOM rendering uses text nodes; user prose is never HTML. The browser retains
the token only in memory and requires a fresh explicit confirmation after any
request change. Shared synchronization has a separate explicit checkbox.
The server serializes action requests; canonical writers retain their own
cross-process concurrency guards. Listener shutdown is not cancellation of an
already admitted run; use its existing status/cancel lifecycle.

The server is a single-user local client, not a multi-user authentication or
hosting service. No daemon discovery, auto-start, automatic browser opening,
database migration, installation, session or cycle creation is introduced.
Human checkpoints still need no PostgreSQL. The dashboard is a bounded first
interface, with structured JSON requests for advanced actions.

## Validation

The required lifecycle gate includes `perf:verify-workflow-console`: real
CLI/HTTP comparison, canonical files/SQLite reads and writes, explicit review,
stale hashes/projections, revocation, request/Host/Origin/token refusal,
unavailable backend and mode changes, and independent run status axes.
Existing instance/candidate/segment gates remain required. PostgreSQL CI checks
CLI/HTTP equality against the actual canonical backend and unchanged data,
checkout and DDL counts. Public effect/no-implicit-write/contract gates cover
the three commands, including a dashboard preview that opens no listener.
