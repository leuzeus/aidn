---
name: convert-to-spike
description: Convert an ongoing EXPLORING effort into an official SPIKE cycle + dedicated branch recommendation.
---

# Convert EXPLORING → SPIKE Skill

## Goal
When exploration becomes non-trivial, formalize it with minimal friction.

## Trigger rule (use automatically if possible)
If mode=EXPLORING and:
- code changes > ~30 minutes OR touches >2 files
→ recommend converting to SPIKE cycle + dedicated branch

## Steps

1) Identify current exploration topic (1 sentence).
2) Create a new SPIKE cycle via cycle-create:
- brief.md includes learning goal + timebox
- decisions.md must capture outcomes
3) Recommend branch naming:
- CXXX-spike-<topic>
4) Update current session:
- mark mode still EXPLORING or switch to COMMITTING? (usually keep EXPLORING)
- reference the new cycle id
5) Update snapshot:
- add spike as active
- next entry point points to spike status.md

Output:
- New cycle path
- Branch recommendation
- Next steps (validate hypotheses, document decision)
