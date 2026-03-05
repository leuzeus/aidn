---
name: cycle-close
description: Close a cycle safely (VERIFYING → DONE or non-retained outcome), run exit checklist (REQ/TEST/GAP/CR), update status.md, snapshot, and next entry point.
---

# Cycle Close Skill

## Goal
Close a cycle cleanly and make it baseline-ready.

## Hygiene Guardrails
- Do not delete cycle artifacts during close; preserve full audit trail.
- Do not auto-promote baseline from this skill.
- Do not auto-merge branches from this skill.
- Apply write-on-change behavior for cycle/snapshot updates.

## Inputs
- Target cycle folder (CXXX-...)
- Desired final state: VERIFYING | DONE | NO_GO | DROPPED

## Steps

1) Locate cycle files:
- status.md
- audit-spec.md
- traceability.md
- decisions.md
- change-requests.md
- (optional) gap-report.md
- (optional) hypotheses.md

2) Exit Checklist (produce a short report):

### Requirements & Acceptance
- Are REQ entries explicit and observable?
- Are acceptance criteria present for key REQs?

### Tests / Validation
- Traceability matrix updated OR justification provided for non-testable REQs.
- TEST references exist or validation steps documented.

### Gaps
- If gap-report.md exists:
  - List open GAPs
  - For each open GAP: fix code | fix spec | fix test | explicitly accept risk

### Change Requests
- Ensure scope changes are recorded in change-requests.md.
- If medium/high impact CR occurred, confirm it was split into a new cycle (or justify why not).

### Decisions
- Confirm major design decisions are captured in decisions.md.

3) Update status.md:
- state: VERIFYING (if remaining validations), DONE (if retained), or NO_GO/DROPPED (if non-retained)
- scope_frozen: true
- last updated: (today)
- next step:
  - VERIFYING: list remaining validations
  - DONE: recommend promote-baseline
  - NO_GO/DROPPED: archive branch and record carry-over decision impact

4) Update snapshot:
- If DONE/NO_GO/DROPPED: remove from Active cycles, move to “Recently closed” section (if present) or add note.
- Set next entry point:
  - If DONE: suggest promote-baseline or start next cycle
  - If NO_GO/DROPPED: suggest next retained cycle/session integration step
  - If VERIFYING: list remaining verification tasks

5) Performance hook (mandatory in dual/db-only; optional in files):
- run `node tools/codex/run-json-hook.mjs --skill cycle-close --mode COMMITTING --target . --json`
- state mode is resolved via `.aidn/config.json` (`runtime.stateMode`) or `AIDN_STATE_MODE` (`files|dual|db-only`).
- read `.aidn/runtime/context/codex-context.json` and use these signals to drive the next action.
- use this output to capture:
  - gate/reload outcome after close-state update
  - index sync summary for changed cycle artifacts
- in dual/db-only, this hook is mandatory and must be run in strict mode (`--strict`).
- in files, this hook remains non-blocking by default.
- DB runtime sync (mandatory in dual/db-only; optional in files):
- run `node tools/runtime/sync-db-first-selective.mjs --target . --json` (falls back to full sync when needed).
- for DB-first write-through on a specific artifact, run `node tools/runtime/db-first-artifact.mjs --target . --path <relative-audit-path> --source-file <file> --json`.
- in dual/db-only, this step is mandatory and blocking on failure.
- in files, this step is optional unless repository policy requires DB parity.

Output:
- Exit checklist report
- Files updated list
- Next entry point
