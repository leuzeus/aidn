<!-- CODEX-AUDIT-WORKFLOW START -->
# AGENTS.md — Execution Contract (v7)

## Purpose

This repository uses a **Session-Based, Skill-Driven, Audit-Driven workflow**.

Agents MUST:
- follow `docs/audit/SPEC.md` as the canonical workflow specification
- follow `docs/audit/WORKFLOW.md` as the project adapter for local constraints
- use **Codex skills as the only state-changing mechanism**
- minimize scope drift
- preserve decision traceability
- reduce context reload time
- during upgrades, preserve `docs/audit/SPEC.md` authority and re-align `docs/audit/WORKFLOW.md` after install

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

- Workflow specification (canonical): `docs/audit/SPEC.md`
- Workflow adapter (project-local): `docs/audit/WORKFLOW.md`
- Current baseline: `docs/audit/baseline/current.md`
- Snapshot (fast reload): `docs/audit/snapshots/context-snapshot.md`
- Fast context reload: `docs/audit/snapshots/context-snapshot.md`
- Ideas parking: `docs/audit/parking-lot.md`

> Precedence: `docs/audit/SPEC.md` > `docs/audit/WORKFLOW.md` > `AGENTS.md`.

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
2. Confirm `docs/audit/SPEC.md` and `docs/audit/WORKFLOW.md` are loaded in context.
3. **Run skill: `start-session`**
4. Explicitly acknowledge the session mode:
- THINKING
- EXPLORING
- COMMITTING

If `docs/audit/SPEC.md` is missing, the agent MUST:
- STOP
- request workflow reinstall/repair before continuing

If mode is **COMMITTING**, the agent MUST:
- **Run skill: `branch-cycle-audit`**
- STOP if branch ownership is ambiguous or unmapped (`session` / `cycle` / `intermediate`)

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
- classify it as `session` | `cycle` | `intermediate`
- if `cycle` or `intermediate`, ensure it maps to exactly one active cycle
- verify cycle mapping is recorded in `status.md` as `branch_name` for cycle branches
- ensure session continuity metadata is present in the active session file (`session_branch`, `parent_session`, `parent_branch`, `continuity_basis`)
- if on a session branch, restrict commits to integration/handover/PR orchestration unless an explicit integration target cycle is documented in the session file

If mapping is missing or ambiguous:
- STOP
- ask the user how to proceed (create cycle, rename branch, or remap)

Recommended branch naming:
- Session branches: `S061-<short-slug>` (example: `S061-dsl-roadmap`)
- Cycle branches: `<cycle-type>/C037-<short-slug>` (example: `feature/C037-dsl-grammar-on`)
- Intermediate branches: `<cycle-type>/C037-I01-<short-slug>` (example: `spike/C037-I01-parser-investigation`)

------------------------------------------------------------
## Session Close Rule (MANDATORY)

Before closing a session, the agent MUST:
- enumerate attached cycles still in `OPEN | IMPLEMENTING | VERIFYING`
- require one explicit decision per open cycle:
  - `integrate-to-session` (merge `cycle -> session`, then set retained cycle `DONE`)
  - `report` to next session
  - `close-non-retained` (`NO_GO` or `DROPPED`)
  - `cancel-close`
- record cycle-by-cycle decisions in the session close report
- STOP closure if at least one attached open cycle has no explicit decision

If a cycle is reported:
- keep the cycle open
- record target next session and integration intent before resume

If a cycle is non-retained:
- do not merge it into the session branch
- preserve audit artifacts and rationale

If a cycle is integrated to session:
- complete integration before session close
- update cycle state/outcome as retained (`DONE`)

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
- DoR core gate is satisfied (or explicit override is documented)
- baseline dependencies are respected
- session close gate is satisfied before closing (`integrate-to-session`/`report`/`close-non-retained` decisions for attached open cycles)
- PR review gate is satisfied before merge: Codex review threads are triaged (`valid`/`invalid`) and resolved with evidence

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
- invoke skills explicitly when required by `docs/audit/SPEC.md` and `docs/audit/WORKFLOW.md`
- avoid inventing workflow steps
- avoid bypassing audit artifacts
- report uncertainty rather than guessing
- keep documentation and audit artifacts up to date

Failure to comply with `docs/audit/SPEC.md` invalidates the session.
<!-- CODEX-AUDIT-WORKFLOW END -->
