---
name: start-session
description: Create or resume a session file from template, detect branch context, and prepare cycle-aware working context.
---

# Start Session Skill

## Goal
Initialize or resume a session with correct mode, branch awareness, and cycle mapping.

## Steps

1) Run context-reload logic (light version):
- Read snapshot
- Read baseline
- Detect current branch
- Detect active cycle (if any)
- Classify branch kind: `session` | `cycle` | `intermediate`
- Detect cycles reported from previous session close report (if any)

2) Create or update session file:
- If user explicitly opens a new session, create `docs/audit/sessions/SXXX.md`.
- If current work belongs to an existing open session, update that session file (do not create a new SXXX).
- If a previous session closed with reported cycles, ask whether to import them into this session.

Use TEMPLATE_SESSION_SXXX.md structure.

3) Fill:
- Auto-detected mode
- Confidence + reasons
- Current branch
- Branch kind
- Baseline version
- Active cycles
- Snapshot reviewed: yes
- Session cycle tracking fields:
  - attached cycles
  - reported_from_previous_session
  - carry_over_pending

4) Apply Branch/Cycle Requirement Auto-check:

If mode=COMMITTING:
- If branch kind is `cycle`:
  - Require a cycle + status.md
  - Require `status.md.branch_name == current branch`
  - Run Core DoR check from status.md/brief.md/plan.md:
    - objective + scope/non-scope present
    - first implementation step defined
    - constraints/risks acknowledged
- If branch kind is `intermediate`:
  - Require exactly one parent cycle owner
  - Require explicit link to parent cycle in session file (`integration_target_cycle`)
  - Require final integration path `intermediate -> cycle -> session`
- If branch kind is `session`:
  - Allow only integration/handover/PR orchestration by default
  - Require explicit `integration_target_cycle` when integrating a cycle into session
  - If production implementation is needed, recommend creating/switching to a cycle branch
- If DoR or mapping is not satisfied:
  - do not proceed as COMMITTING
  - recommend smallest actions to reach READY
  - suggest THINKING or EXPLORING until fixed

5) Carry-over handling at session start:
- For each reported cycle from previous session, require one decision:
  - integrate now (resume and integrate cycle into current session when ready)
  - import now (attach to current session)
  - defer (keep reported, no implementation in current session)
  - drop (convert to `NO_GO`/`DROPPED` with rationale)
- Ask these decisions explicitly (interactive question or equivalent user confirmation).
- Update session close/open-loop notes accordingly.

If mode=EXPLORING and:
- >2 files touched OR
- >30 min code work expected
→ Recommend converting to SPIKE cycle + dedicated branch

6) Suggest:
- Session Objective (1 sentence)
- Time Budget
- Planned Outputs

Do not modify baseline.
Only create/update session file.
