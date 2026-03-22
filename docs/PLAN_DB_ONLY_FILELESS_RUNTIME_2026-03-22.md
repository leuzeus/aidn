# Plan - DB-Only Fileless Runtime

Date: 2026-03-22
Status: proposed
Scope: make `db-only` a real DB-first consultation mode where workflow/runtime state remains usable by the AI agent even when `docs/audit/*` operational artifacts are absent from disk.

## Problem Statement

`aidn` documents `db-only` as a DB-first runtime mode:

- workflow/runtime artifacts should be writable to SQLite
- the AI agent should still be able to consult the workflow state when needed
- file projection should be optional or on-demand, not a hard runtime dependency

That contract is not fully implemented today.

Current verification coverage proves only part of the story:

- SQLite schema and migration flows work
- DB-backed install/reinstall/reinit flows preserve known DB-first rows
- some hydration/runtime helpers work while projected files are still present

What is still missing is the stronger guarantee:

- if `CURRENT-STATE.md`, `RUNTIME-STATE.md`, `HANDOFF-PACKET.md`, or active session/cycle files are not materially present on disk, the runtime should still be able to reconstruct or consult the needed workflow state from SQLite

## Verified Findings

The following failures were reproduced locally against `db-only` scenarios.

### 1. Runtime digests remain file-bound

`project-runtime-state` still derives its consistency/freshness from `docs/audit/CURRENT-STATE.md` through `evaluateCurrentStateConsistency()`.

Observed behavior:

- after building the SQLite index in `db-only`
- removing `docs/audit/CURRENT-STATE.md`
- running `project-runtime-state`

the result degrades to:

- `consistency_status=fail`
- `current_state_freshness=unknown`
- missing active session/cycle facts

This means the digest is not DB-first in practice.

### 2. Auto-projection is gated by file existence

`hydrate-context` only auto-projects `RUNTIME-STATE.md`, `HANDOFF-PACKET.md`, and other summaries if those files already exist.

Observed behavior:

- in `db-only`
- removing `docs/audit/RUNTIME-STATE.md`
- running `hydrate-context --skill context-reload --json`

the hydrated payload does not contain `runtime_state` at all.

This is inverted logic for a file-optional mode.

### 3. Effective state mode is not resolved authoritatively

`hydrate-context-use-case` currently derives the top-level `state_mode` from hook context history.

Observed behavior:

- explicit `AIDN_STATE_MODE=db-only`
- SQLite-backed run
- hydrated payload still reporting `state_mode=dual` in some reproductions

That makes downstream routing and projection decisions unstable.

### 4. Pre-write admission still hard-requires projected files

`pre-write-admit` still blocks directly on missing `docs/audit/CURRENT-STATE.md`.

Observed behavior after removing `CURRENT-STATE.md` in `db-only`:

- `missing docs/audit/CURRENT-STATE.md`
- `mode is unknown`
- `current state freshness is unknown in DB-backed mode`
- `repair layer status is unknown in DB-backed mode`

This violates the expected semantics of a DB-first consultation mode.

### 5. The file dependency is systemic, not isolated

The same pattern appears in multiple tools:

- `project-runtime-state`
- `project-handoff-packet`
- `pre-write-admit`
- `coordinator-next-action`
- `coordinator-loop`
- `coordinator-dispatch-plan`

These tools still parse `docs/audit/*.md` directly as primary state sources.

## Root Cause

The current architecture mixes two different ideas under `db-only`:

1. DB-backed persistence
2. DB-first consultation

Today, `aidn` does a meaningful part of (1), but only a partial version of (2).

The runtime already stores enough information in SQLite for many workflow artifacts, but the consultation layer still assumes:

- projected files exist
- consistency checks read those files directly
- auto-projection is optional convenience layered on top of existing files

As a result, `db-only` behaves more like:

- "DB-backed with projected-file expectations"

than:

- "fileless-capable DB-first runtime"

## Target Contract

`db-only` should mean:

- SQLite is the authoritative consultation source for runtime workflow state
- projected `docs/audit/*` operational artifacts are optional
- when a digest or gate needs workflow state, it reads a DB-first runtime view
- projection to Markdown is allowed:
  - on demand
  - for user readability
  - for export/debugging
- but projection absence must not break the agent workflow path

More precisely, in `db-only`:

- missing `CURRENT-STATE.md` must not by itself block runtime consultation
- missing `RUNTIME-STATE.md` must not prevent `hydrate-context` from producing runtime signals
- missing `HANDOFF-PACKET.md` must not prevent handoff reconstruction
- missing session/cycle files on disk must not erase the active state if SQLite already knows it

## Architectural Direction

Introduce one DB-first consultation layer and make all runtime/gating tools consume it.

### 1. One shared DB-first workflow state reader

Add a single service that reconstructs:

- active session
- active cycle
- branch mapping signals
- DoR/freshness signals
- repair-layer state
- handoff routing inputs
- backlog/shared planning signals

from SQLite first.

In `dual`:

- file-based fallback is allowed when DB state is incomplete

In `db-only`:

- DB is primary
- file absence is not a failure by itself

### 2. Separate consultation from projection

The code should stop assuming that the file it renders is also the file it must read back later.

Instead:

- runtime tools read structured DB-first state
- projector tools render Markdown from that state when requested

### 3. Resolve effective state mode centrally

Every tool that branches on `files|dual|db-only` should use one authoritative resolver based on:

- CLI override
- env
- `.aidn/config.json`
- index/runtime metadata when needed

Historical hook payloads can inform context, but must not override the effective current mode.

### 4. Auto-project in DB modes even when files are absent

In `dual` and `db-only`, `hydrate-context` should be able to produce:

- runtime digest
- handoff packet
- agent summaries
- multi-agent status

without requiring the output file to pre-exist.

## Recommended Phasing

### Phase 1 - Establish The Contract

Goal:

- make the intended semantics explicit and testable

Deliverables:

- documented `db-only` consultation contract
- explicit distinction between:
  - DB-backed storage
  - DB-first consultation
  - optional projection/materialization

### Phase 2 - Add DB-First Runtime Read Model

Goal:

- reconstruct operational workflow state from SQLite

Deliverables:

- shared `db-only` consultation service
- stable structured output for:
  - current state
  - runtime state
  - handoff state
  - pre-write gate inputs

### Phase 3 - Refactor Runtime/Gating Consumers

Goal:

- remove hard dependency on projected files

Deliverables:

- `project-runtime-state` uses DB-first state
- `project-handoff-packet` uses DB-first state
- `pre-write-admit` uses DB-first state
- coordinator tools use DB-first state

### Phase 4 - Fix Auto-Projection And Mode Resolution

Goal:

- make `db-only` self-consistent for AI consumption

Deliverables:

- authoritative state-mode resolver
- `hydrate-context` auto-projects in DB modes even when files are absent
- no auto-projection decision based solely on output file existence

### Phase 5 - Add Real Fileless Test Coverage

Goal:

- prove the mode works when projection is absent

Deliverables:

- tests where `docs/audit/CURRENT-STATE.md` is absent
- tests where `docs/audit/RUNTIME-STATE.md` is absent
- tests where `docs/audit/HANDOFF-PACKET.md` is absent
- tests where active session/cycle files are not materialized
- end-to-end agent consultation still succeeds from SQLite

## Risks

### Risk 1 - False confidence from existing green tests

Current tests mostly validate:

- DB schema health
- preservation on reinstall/reinit
- hydration with projected files still present

They do not yet prove fileless consultation semantics.

### Risk 2 - Divergence between DB and projected files

If consultation remains file-bound in some tools and DB-bound in others:

- inconsistent runtime decisions will persist
- repairs and gating may disagree

### Risk 3 - Overfitting to one digest

Fixing only `project-runtime-state` would not solve the full issue.

The problem spans:

- context hydration
- pre-write gating
- handoff synthesis
- coordinator planning

## Acceptance Criteria

This remediation is successful when:

- `db-only` consultation still works if `CURRENT-STATE.md` is absent
- `hydrate-context` can emit runtime state in `db-only` even if `RUNTIME-STATE.md` is absent
- `pre-write-admit` no longer blocks on missing projected files when DB state is sufficient
- handoff reconstruction works from DB state without requiring `HANDOFF-PACKET.md`
- coordinator/runtime decision tools no longer use projected files as the primary source in `db-only`
- new tests fail if fileless consultation regresses

## Recommended First Slice

Implement the smallest slice that closes the main semantic gap:

1. document the stronger `db-only` contract
2. add authoritative effective state-mode resolution
3. make `hydrate-context` auto-project runtime/handoff digests in DB modes even if output files are absent
4. add one shared DB-first reader for current/runtime state
5. refactor `pre-write-admit` to consume that DB-first reader

This first slice changes `db-only` from:

- "DB-backed but still file-dependent"

to:

- "DB-first consultation mode with optional projection"
