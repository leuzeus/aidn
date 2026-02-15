# AGENTS.md — Execution Contract (v7)

## Purpose

This repository uses a **Session-Based, Skill-Driven, Audit-Driven workflow**.

Agents MUST:
- follow `docs/audit/WORKFLOW.md` as the **single orchestration source**
- use **Codex skills as the only state-changing mechanism**
- minimize scope drift
- preserve decision traceability
- reduce context reload time

This file defines **how agents execute** the workflow — not the workflow itself.

------------------------------------------------------------
## Required Skills (Contract)

This workflow assumes the availability of the following skills:

- context-reload
- start-session
- close-session
- branch-cycle-audit
- drift-check
- cycle-create
- cycle-close
- promote-baseline
- convert-to-spike
- requirements-delta

If any required skill is unavailable, the agent MUST:
- report the missing skill
- STOP the session

------------------------------------------------------------
## Source of Truth

- Workflow (canonical): `docs/audit/WORKFLOW.md`
- Current baseline: `docs/audit/baseline/current.md`
- Snapshot (fast reload): `docs/audit/snapshots/context-snapshot.md`
- Fast context reload: `docs/audit/snapshots/context-snapshot.md`
- Ideas parking: `docs/audit/parking-lot.md`

> If AGENTS.md and WORKFLOW.md conflict → **WORKFLOW.md wins**.

------------------------------------------------------------
## Operating Environments


### IDE Mode (GoLand AI Chat)

Agent has full repository access.

In this mode, the agent MUST:
- update audit artifacts directly under `docs/audit/`
- keep cycle `status.md` accurate at all times
- update the snapshot before session end (via skills)

### Online Mode (ChatGPT / Codex Web)

Agent may not see the full repository.

In this mode, the agent MUST:
- request snapshot, baseline, and active cycle status before asserting facts
- treat missing information as hypotheses (`HYP-xxx`)
- avoid assuming repository state
- explicitly state uncertainty when audit artifacts are unavailable

------------------------------------------------------------
## Session Start Responsibilities

At the beginning of a session, the agent MUST:

1. **Run skill: `context-reload`**
2. **Run skill: `start-session`**
3. Explicitly acknowledge the session mode:
  - THINKING
  - EXPLORING
  - COMMITTING

If mode is **COMMITTING**, the agent MUST:
- **Run skill: `branch-cycle-audit`**
- STOP if the branch does not map to exactly one active cycle

Agents MUST NOT skip these steps.

------------------------------------------------------------
## Mode Heuristics (Advisory, Not Authoritative)

Default recommendation: **THINKING**

Recommend **EXPLORING** when:
- intent includes experimentation, comparison, or uncertainty
- code may be temporary or discarded
- more than one approach is being evaluated

Recommend **COMMITTING** when:
- intent includes implement / fix / refactor for production
- requirements exist or are being created
- changes affect public API, DB schema, security, or architecture
- code is expected to survive and be merged

Agent MUST:
- propose a mode
- state confidence (low / medium / high)
- provide top 1–2 reasons
- accept user override at any time

If confidence is low, the agent SHOULD ask for confirmation.

------------------------------------------------------------
## Mandatory Work Model

### Cycle Binding

All COMMITTING work MUST belong to a cycle located at:

`docs/audit/cycles/CXXX-[type]-*/`

Allowed cycle types:
`feature | hotfix | spike | refactor | structural | migration | security | perf | integration | compat | corrective`

Each cycle MUST maintain at least:
- `status.md`
- `brief.md`
- `plan.md`
- `decisions.md`
- `traceability.md`

Additional files are allowed as needed:
- `hypotheses.md`
- `audit-spec.md`
- `gap-report.md`
- `change-requests.md`

------------------------------------------------------------
## Branch Awareness Rule (MANDATORY)

For COMMITTING sessions, the agent MUST:
- identify the current Git branch
- ensure it maps to exactly one active cycle
- verify mapping is recorded in `status.md` as `branch_name`

If mapping is missing or ambiguous:
- STOP
- ask the user how to proceed (create cycle, rename branch, or remap)

Recommended branch naming:
- `C012-feature-*`
- `C013-spike-*`
- `C014-structural-*`

------------------------------------------------------------
## Drift Control & Change Management

### Scope Freeze

If `status.md` indicates `state=IMPLEMENTING`:
- scope MUST be considered frozen
- expanding objectives inside the same cycle is NOT allowed

### Change Requests (CR)

Any objective, scope, or requirement change MUST:
- be recorded in `change-requests.md`
- include impact assessment: low / medium / high

If impact is medium or high:
- agent MUST recommend opening a new cycle

### Parking Lot

Ideas that are valuable but non-essential MUST:
- be recorded in `docs/audit/parking-lot.md` as `IDEA-xxx`
- NOT be implemented immediately

------------------------------------------------------------
## Spike Rule

A SPIKE exists for learning and uncertainty reduction.

SPIKE code MUST NOT be treated as production.
If SPIKE results must survive:
- open a new FEATURE cycle
- formalize requirements
- rework the code under COMMITTING rules

------------------------------------------------------------
## Automatic Enforcement Expectations

If mode is COMMITTING, the agent MUST ensure:
- an active cycle exists
- branch mapping is valid
- baseline dependencies are respected

If mode is EXPLORING and:
- work exceeds ~30 minutes, or
- touches more than ~2 files

The agent SHOULD recommend converting to a SPIKE cycle.

------------------------------------------------------------
## Stop Conditions (Hard Stops)

Agent MUST STOP and request user decision when:
- structural or architectural changes are detected
- DB schema or security impact is detected
- medium/high impact change request is identified
- conflicting requirements exist
- multiple competing strategies require arbitration

------------------------------------------------------------
## Legacy Technical Guardrails

The following rules define architectural, testing, and CI constraints.
They DO NOT override workflow rules.
Workflow precedence is defined above.
------------------------------------------------------------

# AGENT INSTRUCTIONS

## Scope
These instructions apply to the entire repository unless a more specific `AGENTS.md` is added within a subdirectory.

Agents MUST:
- invoke skills explicitly when required by WORKFLOW.md
- avoid inventing workflow steps
- avoid bypassing audit artifacts
- report uncertainty rather than guessing
- keep documentation and audit artifacts up to date

Failure to comply with WORKFLOW.md invalidates the session.