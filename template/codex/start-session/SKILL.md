---
name: start-session
description: Create a new session file from template, auto-detect work mode, map branch to cycle, and prepare working context.
---

# Start Session Skill

## Goal
Initialize a new session with correct mode, branch awareness, and cycle mapping.

## Steps

1) Run context-reload logic (light version):
- Read snapshot
- Read baseline
- Detect current branch
- Detect active cycle (if any)

2) Create new session file:
docs/audit/sessions/SXXX.md

Use TEMPLATE_SESSION_SXXX.md structure.

3) Fill:
- Auto-detected mode
- Confidence + reasons
- Current branch
- Baseline version
- Active cycles
- Snapshot reviewed: yes

4) Apply Branch/Cycle Requirement Auto-check:

If mode=COMMITTING:
- Require a cycle + status.md
- Require branch mapping in status.md (branch_name: current branch)

If mode=EXPLORING and:
- >2 files touched OR
- >30 min code work expected
→ Recommend converting to SPIKE cycle + dedicated branch

5) Suggest:
- Session Objective (1 sentence)
- Time Budget
- Planned Outputs

Do not modify baseline.
Only create/update session file.
