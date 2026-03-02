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

6) Optional performance hook (Phase 3, recommended for instrumented repositories):
- run `npx aidn perf skill-hook --skill convert-to-spike --target . --mode EXPLORING --json`
- use this output to capture:
  - reload/gate outcome around spike conversion
  - index update summary for newly created spike artifacts
- this should not block workflow execution by default

Output:
- New cycle path
- Branch recommendation
- Next steps (validate hypotheses, document decision)
