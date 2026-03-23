# Continuity Gate (Cycle Creation)

## Purpose

Prevent branch/cycle divergence when opening a new cycle, especially on shared runtime areas.

This gate runs before creating a cycle branch.

## Inputs

- Requested mode: `THINKING | EXPLORING | COMMITTING`
- Requested source branch for new cycle
- Current session branch (if any)
- Latest active cycle branch in same session (`OPEN | IMPLEMENTING | VERIFYING`)

## Detection

Mismatch is detected when requested source branch is not:
- latest active cycle branch, and
- current session branch tip.

When mismatch is detected, creation MUST stop and require explicit rule selection.

## Rules (select exactly one)

1. `R1_STRICT_CHAIN` (Recommended)
- Create cycle branch from latest active cycle branch.
- Use when touching shared runtime/hydration/dispatch or tightly coupled modules.

2. `R2_SESSION_BASE_WITH_IMPORT`
- Create cycle branch from current session tip.
- Must document predecessor import and integrate it before entering `IMPLEMENTING`.

3. `R3_EXCEPTION_OVERRIDE`
- Create cycle branch from custom base.
- Requires explicit rationale and CR entry with impact >= medium.

## Mode policy

- `COMMITTING`: `R1` or `R2`; `R3` only with explicit user override.
- `EXPLORING`: `R2` or `R3`.
- `THINKING`: `R3` only (no production implementation).

## Selectable prompt template

Use this exact list when mismatch is detected:

- `R1_STRICT_CHAIN (Recommended)` — start from latest active cycle branch.
- `R2_SESSION_BASE_WITH_IMPORT` — start from session tip and import predecessor before implementation.
- `R3_EXCEPTION_OVERRIDE` — start from custom branch with explicit risk acceptance.

No cycle branch may be created before one option is selected and recorded in cycle `status.md`.

## Required traceability in `status.md`

- `continuity_rule`
- `continuity_base_branch`
- `continuity_latest_cycle_branch`
- `continuity_decision_by`
- `continuity_override_reason` (required for `R3`)
