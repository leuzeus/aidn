# Backlog DB-Only Fileless Runtime - 2026-03-22

## Goal

Track the concrete work needed so `db-only` becomes a real DB-first consultation mode for the AI workflow, not just a DB-backed storage mode that still depends on projected `docs/audit/*` files.

Reference plan:

- `docs/PLAN_DB_ONLY_FILELESS_RUNTIME_2026-03-22.md`

## Backlog Items

### DFR-01 - Formalize The `db-only` Consultation Contract

Status: proposed
Priority: high

Why:

- the repository currently mixes DB-backed persistence and DB-first consultation semantics

Done when:

- docs explicitly define that in `db-only`:
  - SQLite is the primary consultation source
  - projected operational files are optional
  - missing `CURRENT-STATE.md`, `RUNTIME-STATE.md`, or `HANDOFF-PACKET.md` does not by itself invalidate runtime consultation

### DFR-02 - Add An Authoritative Effective State-Mode Resolver

Status: proposed
Priority: high

Why:

- runtime routing currently derives `state_mode` from unstable context/history in some paths

Done when:

- one shared resolver determines effective `files|dual|db-only`
- resolution order is explicit and reused across runtime/codex tools
- hook history cannot silently override the current effective mode

### DFR-03 - Add A Shared DB-First Runtime Read Model

Status: proposed
Priority: high

Why:

- multiple tools still parse `docs/audit/*.md` as their primary runtime state source

Done when:

- one shared runtime reader can reconstruct:
  - active session
  - active cycle
  - branch mapping facts
  - DoR/gating facts
  - repair-layer state
  - backlog/shared planning facts
- the reader works from SQLite first
- `dual` may use controlled file fallback
- `db-only` does not require projected files

### DFR-04 - Refactor `hydrate-context` Auto-Projection Logic

Status: proposed
Priority: high

Why:

- current auto-projection only runs if the target Markdown file already exists

Done when:

- in `dual`/`db-only`, `hydrate-context` can project:
  - runtime state
  - handoff packet
  - agent summaries
  - multi-agent status
- file absence does not disable projection
- auto mode keys off effective state mode and capability, not prior file existence

### DFR-05 - Refactor `project-runtime-state` To Read DB-First

Status: proposed
Priority: high

Why:

- the runtime digest still becomes unusable when `CURRENT-STATE.md` is missing

Done when:

- `project-runtime-state` no longer relies on `evaluateCurrentStateConsistency()` as a file-only primary source in `db-only`
- it can produce a coherent digest from SQLite-backed state alone
- missing projected files are reported as projection status, not as primary state loss

### DFR-06 - Refactor `project-handoff-packet` To Read DB-First

Status: proposed
Priority: high

Why:

- handoff routing still depends on projected digests and file presence

Done when:

- handoff packet inputs come from the shared DB-first runtime read model
- active session/cycle/routing state is reconstructable without `CURRENT-STATE.md` or `HANDOFF-PACKET.md` on disk

### DFR-07 - Refactor `pre-write-admit` To Use DB-First State

Status: proposed
Priority: high

Why:

- the pre-write gate currently blocks on missing projected files in `db-only`

Done when:

- `pre-write-admit` no longer blocks just because `docs/audit/CURRENT-STATE.md` is absent
- it blocks only when the DB-backed runtime state is actually insufficient or contradictory
- repair-layer and freshness evaluation can run from DB-backed facts

### DFR-08 - Refactor Coordinator Tools Away From File-Primary Reads

Status: proposed
Priority: medium

Why:

- coordinator and dispatch tools still read `CURRENT-STATE.md` / `RUNTIME-STATE.md` directly

Done when:

- these tools consume the shared DB-first runtime read model:
  - `coordinator-next-action`
  - `coordinator-loop`
  - `coordinator-dispatch-plan`
- in `db-only`, file absence does not degrade them to `unknown` by default

### DFR-09 - Add True Fileless `db-only` Fixture Coverage

Status: proposed
Priority: high

Why:

- existing green tests do not prove fileless consultation

Done when:

- new tests cover at least:
  - missing `docs/audit/CURRENT-STATE.md`
  - missing `docs/audit/RUNTIME-STATE.md`
  - missing `docs/audit/HANDOFF-PACKET.md`
  - missing projected active session/cycle artifacts
- runtime consultation still succeeds from SQLite in `db-only`

### DFR-10 - Add Regression Tests For Effective State-Mode Resolution

Status: proposed
Priority: medium

Why:

- the top-level hydrated state mode can currently drift from the requested effective mode

Done when:

- tests prove that CLI/env/config resolution wins deterministically
- stale hook context does not misreport `dual` when the effective mode is `db-only`

### DFR-11 - Add A `db-only` Readiness Diagnostic

Status: proposed
Priority: medium

Why:

- the repository needs an explicit way to detect remaining file-bound paths

Done when:

- one diagnostic command or verifier reports:
  - file-primary runtime consumers still present
  - auto-projection gaps
  - unresolved `db-only` contract violations

### DFR-12 - Validate The Real Client Path On `gowire`

Status: proposed
Priority: medium

Why:

- the problem matters only if the installed client experience is correct

Done when:

- a `gowire`-like validation proves:
  - `db-only` reinstall/reinit still preserves DB-backed state
  - projected operational files can be absent
  - AI runtime consultation still works from SQLite

## Recommended Execution Order

1. `DFR-01`
2. `DFR-02`
3. `DFR-03`
4. `DFR-04`
5. `DFR-05`
6. `DFR-07`
7. `DFR-06`
8. `DFR-08`
9. `DFR-09`
10. `DFR-10`
11. `DFR-11`
12. `DFR-12`

## First Safe Slice

The first slice should be:

- `DFR-01`
- `DFR-02`
- `DFR-03`
- `DFR-04`
- `DFR-07`

This delivers:

- explicit product semantics for `db-only`
- deterministic mode resolution
- DB-first runtime consultation foundations
- projection that no longer depends on pre-existing files
- one critical gate (`pre-write-admit`) no longer blocked by projected-file absence

before the full coordinator/runtime refactor is complete.
