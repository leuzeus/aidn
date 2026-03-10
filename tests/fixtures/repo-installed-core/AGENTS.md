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
- handoff-close
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
- Workflow kernel (minimal re-anchor): `docs/audit/WORKFLOW-KERNEL.md`
- Current state summary: `docs/audit/CURRENT-STATE.md`
- Multi-agent handoff packet: `docs/audit/HANDOFF-PACKET.md`
- Multi-agent status digest: `docs/audit/MULTI-AGENT-STATUS.md`
- Integration risk digest: `docs/audit/INTEGRATION-RISK.md`
- Agent adapter contract: `docs/audit/AGENT-ADAPTERS.md`
- Runtime digest: `docs/audit/RUNTIME-STATE.md`
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
- prefer `docs/audit/REANCHOR_PROMPT.md` when context was partially lost or restarted

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

`start-session` begins with blocking admission:
- resume the current session/cycle when continuity already exists
- stop on non-compliant branches or unresolved session-base continuity
- stop and request user choice when several open cycles compete
- only allow new session creation after admission returns `create_session_allowed`

If `docs/audit/SPEC.md` is missing, the agent MUST:
- STOP
- request workflow reinstall/repair before continuing

If mode is **COMMITTING**, the agent MUST:
- **Run skill: `branch-cycle-audit`**
- STOP if branch ownership is ambiguous or unmapped (`session` / `cycle` / `intermediate`)
- rely on the same branch/session/cycle mapping layer as `start-session`, not on generic gating alone

Agents MUST NOT skip these steps.

If runtime state mode is `dual` or `db-only`, the agent MUST:
- run the performance hook for each invoked workflow skill
- run those hooks through the JSON context wrapper in strict mode (`npx aidn codex run-json-hook ... --strict --fail-on-repair-block --json`)
- prefer `--fail-on-repair-block` for mutating workflow skills and stop on `repair_layer_status=block`
- hydrate db-backed context after each workflow skill (`npx aidn codex hydrate-context --target . --skill <skill> --project-runtime-state --json`)
- use hydrated context to read `repair_layer_status`, `repair_layer_advice`, prioritized artifacts, and continuity hints before acting
- prefer `docs/audit/RUNTIME-STATE.md` as the short runtime digest when available
- run DB runtime sync after each mutating workflow skill (`npx aidn runtime sync-db-first-selective --target . --json`, fallback to full sync when needed)
- run `npx aidn runtime repair-layer-triage --target . --json` whenever `repair_layer_status` is `warn` or `block`
- if triage exposes a safe-only autofix candidate, the agent MAY run `npx aidn runtime repair-layer-autofix --target . --apply --json`
- stop and request user arbitration if blocking repair findings remain after triage/autofix
- treat hook failure as a stop condition (do not continue silently on file-only fallback paths)
- treat generic runtime hooks as infrastructure only:
  - `start-session` admission decides `resume | choose | create | stop`, then delegates to generic `session-start` runtime work only when admitted
  - `branch-cycle-audit` admission validates owned branch mapping, then delegates to generic gating/perf evaluation only when mapping is valid

------------------------------------------------------------
## Pre-Write Gate (MANDATORY)

Before any durable write, the agent MUST restate:

- current mode
- current branch kind
- active session (`SXXX | none | unknown`)
- active cycle (`CXXX | none | unknown`) when relevant
- `dor_state` when `COMMITTING`
- first implementation step from `plan.md` when `COMMITTING`
- workflow artifacts verified
- missing or uncertain context, if any

Durable writes include:

- `apply_patch`
- direct file edits
- generated file creation
- mutating scripts

If runtime state mode is `dual` or `db-only`, the agent MUST also:

- read hydrated runtime context before durable write
- check `repair_layer_status`
- stop on blocking repair findings

If one required field is missing, ambiguous, or contradictory, the agent MUST:

- stop durable write
- continue with read-only context reload only
- report the smallest compliant next step

Special note for recent Codex Windows app flows:

- treat `apply_patch` as a durable write operation, not as a shortcut around workflow checks
- do not use `apply_patch` before the pre-write restatement is complete

This gate does not redefine canonical workflow mechanics.
It only defines the minimum execution contract before writing.

------------------------------------------------------------
## Multi-Agent Handoff

When work is likely to continue in another agent, the agent SHOULD:

- run skill: `handoff-close`
- refresh `docs/audit/CURRENT-STATE.md`
- refresh `docs/audit/RUNTIME-STATE.md` when in `dual` / `db-only`
- project `docs/audit/HANDOFF-PACKET.md`
- keep `docs/audit/COORDINATION-LOG.md` available for explicit coordinator dispatch traces

The receiving agent MAY start from `docs/audit/HANDOFF-PACKET.md`, but MUST still:

- run `npx aidn runtime handoff-admit --target . --json`
- reload the referenced artifacts
- complete the mandatory pre-write restatement
- stop if the packet says `handoff_status=blocked`
- if `dispatch_status=escalated`, record explicit user arbitration before resuming automatic dispatch

Multi-agent relays remain constrained by workflow mode:

- a handoff packet MUST declare the source agent role/action and the recommended target role/action
- `handoff-admit` MUST reject a relay when the mode-specific transition policy does not allow `from -> to`
- if transition policy is rejected or stale, the next agent MUST fall back to `coordinator + reanchor`
- if the coordinator loop escalates, resume only after `npx aidn runtime coordinator-record-arbitration --target . --decision <...> --note <...>`

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

If several attached cycles may converge into the same session:
- consult `docs/audit/INTEGRATION-RISK.md` before assuming a normal merge path
- classify the chosen path explicitly as one of:
  - `direct_merge`
  - `integration_cycle`
  - `report_forward`
  - `rework_from_example`
- record explicit user arbitration when the integration strategy is not `direct_merge`

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
- no plan, no durable write: the first implementation step must be explicit before writing
- baseline dependencies are respected
- session close gate is satisfied before closing (`integrate-to-session`/`report`/`close-non-retained` decisions for attached open cycles)
- PR review gate is satisfied before merge: Codex review threads are triaged (`valid`/`invalid`) and resolved with evidence
- in `dual`/`db-only`, DB-backed perf chain is executed at session close (constraint report/actions/history/trend/lot summaries)

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
