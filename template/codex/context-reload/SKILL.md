---
name: context-reload
description: Reload project context, detect active branch/cycle alignment, propose work mode (THINKING/EXPLORING/COMMITTING), and generate a concise Context Reload Report.
---

# Context Reload Skill

## Goal
Reconstruct project state in <5 minutes of reading and propose a WORK MODE.

## Hygiene Guardrails
- Read-only skill: do not modify files in this skill.
- Limit reads to listed workflow artifacts; avoid broad repository scans.
- If an artifact is missing/inaccessible, report uncertainty explicitly (do not infer facts as certain).
- Do not rewrite branch/cycle metadata here; only report mismatches and proposed fixes.

## Steps

1) Read:
- docs/audit/WORKFLOW_SUMMARY.md (if present)
- docs/audit/snapshots/context-snapshot.md
- docs/audit/baseline/current.md
- docs/audit/cycles/*/status.md (active cycles only)
- Current Git branch (if accessible)

2) Produce a concise Context Reload Report:

### CURRENT STATE
- Baseline version
- Active cycles + states
- Current branch
- Snapshot consistency
- Pending reported cycles awaiting session import/decision

### BRANCH ↔ CYCLE CHECK
- Classify current branch as `session` | `cycle` | `intermediate`.
- If `cycle`: does it match exactly one active cycle (`status.md.branch_name`)?
- If `intermediate`: is parent cycle ownership explicit and unambiguous?
- If `session`: does it match the active session file `session_branch`?
- If mismatch → flag issue and suggest:
  - create/remap cycle
  - switch branch
  - update session metadata

### AUTO MODE DETECTION

Propose:
- THINKING
- EXPLORING
- COMMITTING

Output:
- Proposed mode
- Confidence: low|medium|high
- Top 2 reasons

Rules:
Default: THINKING

Switch to EXPLORING if:
- experimentation intent detected
- hypothesis validation needed
- code may be throwaway

Switch to COMMITTING if:
- production intent detected
- >2 files likely impacted
- REQ creation/modification
- DB/API/security/architecture touched

If structural/DB/security impact → force COMMITTING recommendation.

3) Suggest 2–4 NEXT BEST ACTIONS.

Keep report concise.
4) Performance hook (mandatory in dual/db-only; optional in files):
- run `npx aidn codex run-json-hook --skill context-reload --mode <THINKING|EXPLORING|COMMITTING> --target . --json`
- state mode is resolved via `.aidn/config.json` (`runtime.stateMode`) or `AIDN_STATE_MODE` (`files|dual|db-only`).
- read `.aidn/runtime/context/codex-context.json` and use these signals to drive the next action.
- use this output to cross-check:
  - branch/cycle mapping
  - structure profile (`legacy|modern|mixed|unknown`)
  - reload decision/reason codes
- in dual/db-only, this hook is mandatory and must be run in strict mode (`--strict`).
- in files, this hook remains non-blocking by default.

Do not modify project workflow files in this skill.

