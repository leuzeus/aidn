# AID'N WORKFLOW — Audit-Informed, Session-Based (v7)

This workflow defines an **audit-informed, session-based process** with an embedded
**audit-driven control layer**.
It is **tool-agnostic**, but assumes the availability of Codex **skills** as the only
mechanism allowed to modify state.

This document is the **single source of truth**.
If an agent or user deviates from it, the session is considered **NON-COMPLIANT**.

------------------------------------------------------------

## Core Principles

- **Audit-Informed Development is primary.** Audits are continuous decision filters.
- **Entropy is regulated early.** Decisions are filtered before structural divergence compounds.
- **Audit-Driven control is operational.** DoD and coherence are validated continuously.
- **Sessions are intentional.** Every meaningful work period is a bounded session.
- **Skills execute state.** Only skills may create or modify audit artifacts.
- **Human intent is authoritative.** Automation assists; it does not decide.

------------------------------------------------------------

## System Model

1. **Audit-Informed Development (Primary Philosophy)**
   - Active before, during, and after implementation.
   - Reduces entropy and scope drift before irreversible decisions.
   - Protects long-term coherence of architecture and requirements.

2. **Audit-Driven Layer (Control Mechanism)**
   - Validates Definition of Done.
   - Detects deviation and scope creep.
   - Enforces architectural consistency and corrective adjustments.

3. **Cycles (Bounded Delivery Units)**
   - Intent audit
   - Architecture audit
   - Implementation
   - Audit-driven validation
   - Snapshot update

4. **Memory System**
   - Baseline = structural anchor
   - Snapshots = fast reload memory
   - Parking lot = entropy isolation

This model is designed to increase AI stability while reducing operator cognitive load.

------------------------------------------------------------

## Key Files & Directories

- Snapshot (fast reload memory): `docs/audit/snapshots/context-snapshot.md`
- Baseline (structural anchor): `docs/audit/baseline/current.md`
- Baseline (history): `docs/audit/baseline/history.md`
- Parking lot (entropy isolation): `docs/audit/parking-lot.md`
- Cycles: `docs/audit/cycles/`
- Agent contract: `AGENTS.md`

------------------------------------------------------------

## Session Lifecycle (Canonical)

### 1. Start of Any Session (MANDATORY)

At the **start of every session**, the following MUST occur in order:

1. **Run skill: `context-reload`**
    - Load baseline/current
    - Load latest snapshot
    - Detect active cycle (if any)
    - Propose session mode

2. **Run skill: `start-session`**
    - Create or update session artifacts
    - Bind session to active cycle if present

3. **Determine session mode** (explicitly acknowledge one):
    - **THINKING** — documentation, reasoning only
    - **EXPLORING** — experimental or throwaway code
    - **COMMITTING** — production intent

4. **If mode == COMMITTING**
    - **Run skill: `branch-cycle-audit`**
    - The current branch MUST map to exactly one active cycle
    - If mapping fails: **STOP** and remediate before proceeding

Failure to complete these steps invalidates the session.

------------------------------------------------------------

## Working Rules by Mode

### THINKING
- No code or state changes expected
- Skills may be used for documentation updates only
- No branch↔cycle enforcement required

### EXPLORING
- Code may be temporary or discarded
- If exploration produces lasting value:
    - **Run skill: `convert-to-spike`** OR
    - Create a proper cycle before committing results

### COMMITTING
- All work MUST belong to a cycle
- Branch↔cycle mapping MUST remain valid
- Any scope change MUST be handled explicitly (see Drift Control)

------------------------------------------------------------

## Drift Control (MANDATORY)

Drift is any deviation from:
- the current baseline
- the stated goal of the active cycle

When drift is suspected or detected:

1. **Run skill: `drift-check`**
2. If drift is confirmed:
    - Record findings in `parking-lot.md`
    - Propose recovery options:
        - Change Request
        - New cycle
        - Scope rollback

Ignoring drift is not allowed.

------------------------------------------------------------

## Cycle Management

### Mandatory Cycle Pipeline
- Intent audit
- Architecture audit
- Implementation
- Audit-driven validation
- Snapshot update

### Creating a Cycle
- **Run skill: `cycle-create`**
- Cycle becomes the unit of accountability
- Branch mapping MUST be established (or updated)

### Closing a Cycle
- **Run skill: `cycle-close`**
- All exit criteria MUST be satisfied
- Status transitions must be explicit

### Promoting to Baseline
- Only DONE cycles are eligible
- **Run skill: `promote-baseline`**
- Baseline/current and baseline/history MUST be updated

------------------------------------------------------------

## End of Session (MANDATORY)

Before ending a session:

1. **Run skill: `drift-check`**
2. **Run skill: `close-session`**
    - Finalize session notes
    - Update snapshot pointers

Sessions MUST NOT end silently.

------------------------------------------------------------

## Invariants (Non-Negotiable)

- A session without `context-reload` is invalid
- A COMMITTING session without `branch-cycle-audit` is invalid
- Skills MUST NOT decide workflow logic
- Workflow rules MUST NOT be duplicated elsewhere
- Missing audit files/folders require STOP and remediation

------------------------------------------------------------

## Versioning

Workflow version: **v7**
Date: 2026-02-07
