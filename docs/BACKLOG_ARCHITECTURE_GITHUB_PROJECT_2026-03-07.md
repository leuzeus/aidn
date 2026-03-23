# Backlog Architecture - GitHub Project Ready - 2026-03-07

## Objective

Provide a GitHub Projects-ready operating model for the architecture remediation backlog.

This document complements:

- `docs/BACKLOG_ARCHITECTURE_REMEDIATION_2026-03-07.md`
- `docs/BACKLOG_ARCHITECTURE_GITHUB_ISSUES_2026-03-07.md`

Important:

- this file is a derived project-planning artifact, not the source of truth for implementation status
- current delivery status must be tracked in `docs/BACKLOG_ARCHITECTURE_REMEDIATION_2026-03-07.md`
- if this board model diverges from the repository state, treat it as a stale project export until refreshed

It defines:

- project structure
- recommended fields
- recommended views
- status flow
- prioritization and execution rules

## Recommended Project

Project name:

`Architecture Remediation - aidn Runtime Platform`

Project description:

`Execution board for the layered runtime-platform refactor of aidn: install decomposition, core contracts, runtime separation, explicit state stores, packaging alignment, and real-world validation.`

## Recommended Custom Fields

### `Type`

Type: `Single select`

Options:

- `Epic`
- `Ticket`
- `PR`
- `Risk`

### `Priority`

Type: `Single select`

Options:

- `P0`
- `P1`
- `P2`

### `Area`

Type: `Single select`

Options:

- `Documentation`
- `Install`
- `Core`
- `Runtime`
- `Observability`
- `Codex`
- `Packaging`
- `Validation`

### `Milestone`

Type: `Single select`

Options:

- `M1 Direction And Initial Decompression`
- `M2 Install Decomposition`
- `M3 Core Contracts`
- `M4 Runtime Separation`
- `M5 Explicit State Stores`
- `M6 Agent Integration Encapsulation`
- `M7 Packaging Alignment`
- `M8 Real-World Validation`

### `Status`

Type: `Single select`

Options:

- `Backlog`
- `Ready`
- `In Progress`
- `In Review`
- `Blocked`
- `Done`

### `Owner`

Type: `Text`

Purpose:

- assign directly accountable maintainer

### `Depends On`

Type: `Text`

Purpose:

- store issue ids or short dependency chain
- example: `E2-T1, E2-T2`

### `Next PR`

Type: `Text`

Purpose:

- identify the next delivery branch or PR id
- example: `PR2`, `refactor/install-manifest-loader`

### `Risk Level`

Type: `Single select`

Options:

- `Low`
- `Medium`
- `High`

### `Validation`

Type: `Text`

Purpose:

- record the expected verification command set
- example: `perf:verify-install-import + perf:verify-cli-aliases`

## Recommended Views

### View 1 - Executive Roadmap

Layout:

- `Roadmap`

Group by:

- `Milestone`

Sort by:

- `Priority` ascending
- `Type` ascending

Visible fields:

- `Status`
- `Priority`
- `Area`
- `Owner`
- `Risk Level`

Use:

- steering view for milestone readiness and sequencing

### View 2 - Delivery Board

Layout:

- `Board`

Columns:

- `Backlog`
- `Ready`
- `In Progress`
- `In Review`
- `Blocked`
- `Done`

Card fields:

- `Priority`
- `Area`
- `Milestone`
- `Owner`

Use:

- daily execution board

### View 3 - P0 / P1 Focus

Layout:

- `Table`

Filter:

- `Priority is P0` OR `Priority is P1`
- `Status is not Done`

Sort by:

- `Priority`
- `Milestone`

Visible fields:

- `Type`
- `Area`
- `Milestone`
- `Depends On`
- `Owner`
- `Next PR`

Use:

- maintain focus on currently relevant architecture work

### View 4 - Dependency Review

Layout:

- `Table`

Sort by:

- `Milestone`
- `Area`

Visible fields:

- `Status`
- `Depends On`
- `Next PR`
- `Risk Level`

Use:

- unblock planning
- detect sequencing mistakes

### View 5 - Validation Gate

Layout:

- `Table`

Filter:

- `Status is In Review` OR `Status is Blocked`

Visible fields:

- `Validation`
- `Owner`
- `Risk Level`
- `Milestone`

Use:

- ensure review-stage work is not merged without explicit verification

## Recommended Status Policy

### `Backlog`

Entry:

- issue exists
- not yet dependency-ready

Exit:

- dependencies resolved
- scope fits one reviewable PR
- validation path identified

### `Ready`

Entry:

- ticket satisfies Definition of Ready

Exit:

- active owner starts implementation

### `In Progress`

Entry:

- active branch or working draft exists

Exit:

- PR opened or reviewable diff prepared

### `In Review`

Entry:

- PR opened
- validation commands known

Exit:

- merged or changes requested

### `Blocked`

Entry:

- dependency incomplete
- unclear ownership
- failing validation without clear path

Exit:

- blocker resolved and next action identified

### `Done`

Entry:

- merged
- validation passed
- documentation updated if required

## Recommended Automation Rules

If using GitHub Projects automation:

1. when item is added:
   - set `Status = Backlog`

2. when PR is linked:
   - set `Status = In Review`

3. when PR is merged:
   - set `Status = Done`

4. when `Status = In Progress`:
   - require `Owner`

5. when `Status = Ready`:
   - require `Depends On` to be empty or resolved

## Recommended Issue Templates Mapping

### Epic template

Required fields:

- `Type = Epic`
- `Priority`
- `Milestone`
- `Area`
- `Status = Backlog`

### Ticket template

Required fields:

- `Type = Ticket`
- `Priority`
- `Milestone`
- `Area`
- `Depends On`
- `Validation`
- `Status = Backlog`

### PR item template

Required fields:

- `Type = PR`
- `Owner`
- `Next PR`
- `Validation`
- `Status = In Review`

## Suggested Initial Population

Create and add these items first:

### Epics

- `E1 - Direction and documentation freeze`
- `E2 - Install monolith decomposition`
- `E3 - Core architecture contracts`
- `E4 - Separate runtime engine from observability`
- `E5 - Explicit state stores and source-of-truth enforcement`
- `E6 - Encapsulate Codex and agent integrations`
- `E7 - Align packaging with runtime architecture`
- `E8 - Validate on real-world repositories`

### First execution tickets

- `E2-T1 - Extract manifest loading from tools/install.mjs`
- `E2-T2 - Extract compatibility policy from tools/install.mjs`
- `E2-T3 - Extract .aidn config management from tools/install.mjs`
- `E2-T6 - Reduce tools/install.mjs to a thin transitional wrapper`
- `E3-T1 - Define WorkflowStateStore core port`
- `E3-T6 - Formalize files/dual/db-only semantics in core/state`
- `E4-T2 - Extract workflow-hook orchestration into application use case`
- `E5-T2 - Implement DbWorkflowStateStore`
- `E6-T1 - Extract Codex custom migration into adapter`
- `E7-T1 - Reevaluate core and extended pack boundaries`

## Suggested Field Values For Initial Tickets

| Item | Type | Priority | Area | Milestone | Depends On | Risk Level |
|---|---|---|---|---|---|---|
| E1 | Epic | P0 | Documentation | M1 Direction And Initial Decompression | - | Medium |
| E2 | Epic | P0 | Install | M2 Install Decomposition | E1 | High |
| E3 | Epic | P1 | Core | M3 Core Contracts | E2 | Medium |
| E4 | Epic | P1 | Runtime | M4 Runtime Separation | E3 | High |
| E5 | Epic | P1 | Runtime | M5 Explicit State Stores | E4 | High |
| E6 | Epic | P1 | Codex | M6 Agent Integration Encapsulation | E3 | Medium |
| E7 | Epic | P2 | Packaging | M7 Packaging Alignment | E5, E6 | Medium |
| E8 | Epic | P2 | Validation | M8 Real-World Validation | E5, E7 | High |
| E2-T1 | Ticket | P0 | Install | M1 Direction And Initial Decompression | E1 | Medium |
| E2-T2 | Ticket | P0 | Install | M1 Direction And Initial Decompression | E2-T1 | Medium |
| E2-T3 | Ticket | P0 | Install | M1 Direction And Initial Decompression | E2-T1 | Medium |
| E2-T6 | Ticket | P0 | Install | M2 Install Decomposition | E2-T2, E2-T3 | High |
| E3-T1 | Ticket | P1 | Core | M3 Core Contracts | E2-T6 | Medium |
| E3-T6 | Ticket | P1 | Core | M3 Core Contracts | E3-T1 | Medium |
| E4-T2 | Ticket | P1 | Runtime | M4 Runtime Separation | E4-T1 | High |
| E5-T2 | Ticket | P1 | Runtime | M5 Explicit State Stores | E3-T1, E4-T2 | High |
| E6-T1 | Ticket | P1 | Codex | M6 Agent Integration Encapsulation | E2-T5, E3-T4 | Medium |
| E7-T1 | Ticket | P2 | Packaging | M7 Packaging Alignment | E5-T5, E6-T3 | Medium |

## Operating Rules

1. never move a ticket to `Ready` without validation commands defined
2. never move a ticket to `In Progress` without a named owner
3. never merge `In Review` work with unresolved fixture regressions
4. never advance milestone order unless an explicit dependency waiver is recorded
5. treat `Blocked` items as first-class review topics during planning

## Review Cadence

Recommended cadence:

- weekly roadmap review on `Executive Roadmap`
- twice-weekly execution review on `Delivery Board`
- review-gate check before merging any `P0` or `P1` PR
