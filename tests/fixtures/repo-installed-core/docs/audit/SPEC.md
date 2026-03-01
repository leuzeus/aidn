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
- Temporary incident tracking: `docs/audit/incidents/`
- Cycles: `docs/audit/cycles/`
- Agent contract: `AGENTS.md`

------------------------------------------------------------

## Canonical Rule Index

- `SPEC-R01`: Session start sequence (`context-reload` -> `start-session` -> mode selection -> `branch-cycle-audit` when COMMITTING)
- `SPEC-R02`: Mode semantics (`THINKING` / `EXPLORING` / `COMMITTING`)
- `SPEC-R03`: COMMITTING cycle ownership + branch mapping validity
- `SPEC-R04`: Definition of Ready (core + adaptive checks)
- `SPEC-R05`: Drift control (`drift-check` mandatory when drift suspected)
- `SPEC-R06`: Cycle continuity gate (`R1` / `R2` / `R3`)
- `SPEC-R07`: Session close resolution for open cycles
- `SPEC-R08`: PR review gate (Codex review triage)
- `SPEC-R09`: Post-merge local sync gate
- `SPEC-R10`: Workflow incident management (severity + decision policy)
- `SPEC-R11`: Non-negotiable invariants (including anti-duplication)

------------------------------------------------------------

## Session Lifecycle (Canonical) [SPEC-R01]

### 1. Start of Any Session (MANDATORY)

At the **start of every session**, the following MUST occur in order:

1. **Run skill: `context-reload`**
    - Load baseline/current
    - Load latest snapshot
    - Detect active cycle(s) (if any)
    - Propose session mode

2. **Run skill: `start-session`**
    - Create or update session artifacts
    - Bind session to active cycle(s) if present

3. **Determine session mode** (explicitly acknowledge one):
    - **THINKING** — documentation, reasoning only
    - **EXPLORING** — experimental or throwaway code
    - **COMMITTING** — production intent

4. **If mode == COMMITTING**
    - **Run skill: `branch-cycle-audit`**
    - If current branch is `cycle` or `intermediate`, it MUST map to exactly one active cycle
    - If current branch is `session`, it MUST map to one active session file and declare integration intent
    - If mapping fails: **STOP** and remediate before proceeding

Failure to complete these steps invalidates the session.

------------------------------------------------------------

## Working Rules by Mode [SPEC-R02 / SPEC-R03]

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
- Branch ownership mapping MUST remain valid (`session` | `cycle` | `intermediate`)
- Production implementation SHOULD happen on cycle/intermediate branches
- Session branches are reserved for integration/handover/PR orchestration, unless an explicit exception is documented
- Any scope change MUST be handled explicitly (see Drift Control)

------------------------------------------------------------

## Definition of Ready (DoR) — Explicit and Adaptive [SPEC-R04]

DoR governs entry into implementation for COMMITTING work.
It is intentionally lightweight: strict on invariants, flexible on depth.

### Core DoR Gate (mandatory for COMMITTING)
- For cycle/intermediate branches: one active cycle exists and is bound to the current branch.
- For session branches: integration target cycle is explicit and cycle ownership remains traceable.
- Intent is explicit in cycle artifacts (objective, scope, non-scope).
- First implementation step is defined in `plan.md`.
- Constraints/risks are acknowledged before coding.

### Adaptive DoR Depth (by cycle type)
- `spike`: keep DoR minimal (learning goal + timebox + decision target).
- `feature | hotfix | refactor | perf | compat | corrective`: require minimal REQ and planned traceability.
- `security | migration | integration | structural`: require impact notes and rollback/compatibility strategy.

### Validation Responsibility
- `start-session` validates the Core DoR Gate before COMMITTING execution.
- `branch-cycle-audit` validates branch ownership and cycle binding consistency.
- If DoR is not met, work remains in THINKING/EXPLORING until gaps are resolved.
- Temporary override is allowed only if recorded in cycle status with rationale.

DoR is an entropy filter, not bureaucracy.

------------------------------------------------------------

## Drift Control (MANDATORY) [SPEC-R05]

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

### Cycle Outcomes
- `DONE`: retained and eligible for normal downstream promotion.
- `NO_GO` or `DROPPED`: non-retained; keep audit trail, do not merge into session baseline path.

### Promoting to Baseline
- Only DONE cycles are eligible
- **Run skill: `promote-baseline`**
- Baseline/current and baseline/history MUST be updated

### Cycle Continuity Gate (mandatory on cycle creation) [SPEC-R06]

Before creating a new cycle branch, continuity MUST be validated.
If the requested base branch is not the expected continuity base, the agent MUST STOP and require explicit user choice.

Rule sets (one MUST be selected):
- `R1_STRICT_CHAIN` (default for COMMITTING): base from latest relevant active cycle branch in the current session context.
- `R2_SESSION_BASE_WITH_IMPORT`: base from session branch tip, with explicit predecessor import declared before `IMPLEMENTING`.
- `R3_EXCEPTION_OVERRIDE`: custom base with explicit rationale and accepted risk.

Operational requirements:
- No cycle branch creation before rule selection is recorded in cycle artifacts.
- If mismatch is detected, the user must explicitly choose `R1`, `R2`, or `R3`.
- `R3` requires explicit override and documented risk.

------------------------------------------------------------

## End of Session (MANDATORY) [SPEC-R07]

Before ending a session:

1. **Run skill: `drift-check`**
2. Resolve attached open cycles (`OPEN | IMPLEMENTING | VERIFYING`) with explicit decision per cycle:
    - `integrate-to-session` (`cycle -> session`) and mark retained cycle `DONE`, OR
    - `report` to next session, OR
    - `close-non-retained` (`NO_GO`/`DROPPED`), OR
    - `cancel-close`
3. **Run skill: `close-session`**
    - Finalize session notes
    - Update snapshot pointers

A session close with unresolved attached open cycles is invalid.

Sessions MUST NOT end silently.

------------------------------------------------------------

## PR Review Gate (Codex) [SPEC-R08]

Before merge, Codex review threads MUST be triaged and resolved:
- `valid`: implement fix, run impacted validations, push evidence.
- `invalid`: reply with technical rationale and evidence.

Merge MUST NOT proceed with unresolved Codex review threads unless an explicit, documented rationale exists.

------------------------------------------------------------

## Post-Merge Local Sync Gate (MANDATORY) [SPEC-R09]

After any PR merge operation (CLI/API/UI), local branch state MUST be reconciled before continuing session work.

Required checks:
- identify current branch
- fetch target branch from remote
- verify local vs remote divergence on source branch (`ahead/behind`)

Decision rules:
- if divergence is zero, continue.
- if divergence exists, STOP and perform explicit local reconciliation before creating a new session/cycle branch.
- if reconciliation strategy is ambiguous, request user decision and record rationale.

Goal:
- prevent hidden local history forks that break continuity and branch-base assumptions.

------------------------------------------------------------

## Workflow Incident Management (MANDATORY) [SPEC-R10]

When a workflow incident is detected (gate contradiction, branch continuity failure pattern, repeated manual recovery, or non-compliant execution path), the agent MUST run an incident triage before continuing.

### Incident Severity

- `L1_LOW`: local/self-healing issue, no canonical rule impact, no security/compliance risk.
- `L2_MEDIUM`: repeated or cross-session issue, still safely auto-repairable.
- `L3_HIGH`: requires workflow rule change (`SPEC.md` and/or `WORKFLOW.md`) or creates high recurrence risk.
- `L4_CRITICAL`: compliance/safety blocking issue; session cannot continue until resolved.

### Decision Policy

- `L1_LOW`: auto-fix allowed; no stop required.
- `L2_MEDIUM`: auto-fix allowed with temporary incident tracking.
- `L3_HIGH` or `L4_CRITICAL`: temporary STOP is mandatory; explicit user authorization is required before editing workflow rules.

### Resume & Cleanup

After incident resolution:
- resume the interrupted workflow from recorded checkpoint.
- remove temporary incident tracking file when resolved.
- keep only concise trace in session/snapshot artifacts.

Goal:
- allow controlled workflow self-improvement while preventing noisy interruptions.

------------------------------------------------------------

## Invariants (Non-Negotiable) [SPEC-R11]

- A session without `context-reload` is invalid
- A COMMITTING session without `branch-cycle-audit` is invalid
- Skills MUST NOT decide workflow logic
- Workflow rules MUST NOT be duplicated elsewhere
- Missing audit files/folders require STOP and remediation

------------------------------------------------------------

## Versioning

Workflow version: **v7**
Date: 2026-02-07
