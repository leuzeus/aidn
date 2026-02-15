---
name: requirements-delta
description: Revise an old plan/spec safely by generating an addendum (delta), mapping old→new REQs, and opening CR or new cycle if structural changes are detected.
---

# Requirements Delta / Addendum Skill

## Goal
Handle “we revised an old plan” without losing traceability.

## When to use
- You revisit an older plan/audit-spec and realize structural changes are needed
- New constraints appear (API/DB/security/architecture)
- Requirements changed after exploration

## Steps

1) Identify scope of revision:
- What changed? (1–5 bullets)
- Why? (constraint, discovery, new info, stakeholder change)
- Impact: low | medium | high

2) Choose strategy (auto-recommend):
- Low impact: addenda inside same cycle (update audit-spec + traceability)
- Medium/high impact: create CR + recommend new cycle (often structural/refactor/spike)

3) Generate a Delta Document (addendum):
Create (or update) in the cycle folder:
- `addenda.md` (if not existing) or append a new section

Add a new section:
## ADDENDUM-XXX
- Date:
- Summary of change
- Motivation
- Impact level
- Breaking changes? yes/no
- New assumptions / removed assumptions
- Migration notes (if any)

4) Requirements mapping:
Create a small mapping table:
| Old REQ | Action | New REQ | Notes |
|---|---|---|---|
Actions:
- keep
- revise (create new REQ; deprecate old)
- split
- drop (with justification)

Rules:
- For significant revision: do NOT overwrite old REQ silently.
  - Mark old as deprecated
  - Create a new REQ with new id
  - Update traceability accordingly

5) Update traceability.md:
- Ensure each new/changed REQ has a TEST or justification.
- If tests not ready yet: add as planned, and add a validation plan note.

6) If code already diverged:
- Recommend drift-check
- If on a mixed branch: recommend convert-to-spike or new cycle + new branch.

Output:
- Addendum content
- REQ mapping table
- Recommended next step (CR/new cycle/continue)
