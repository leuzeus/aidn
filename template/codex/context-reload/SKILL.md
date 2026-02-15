---
name: context-reload
description: Reload project context, detect active branch/cycle alignment, propose work mode (THINKING/EXPLORING/COMMITTING), and generate a concise Context Reload Report.
---

# Context Reload Skill

## Goal
Reconstruct project state in <5 minutes of reading and propose a WORK MODE.

## Steps

1) Read:
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

### BRANCH ↔ CYCLE CHECK
- Does current branch match exactly one active cycle?
- If mismatch → flag issue and suggest:
  - create cycle
  - rename branch
  - update status.md branch_name

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
Do not modify files in this skill.
