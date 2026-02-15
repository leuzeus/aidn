---
name: drift-check
description: Detect scope drift (A/B/D), generate a Recovery plan, and optionally create a CR + parking-lot entries.
---

# Drift Check Skill

## Goal
Detect when exploration/implementation drifted and recover quickly.

## Steps

1) Read:
- Current session file (latest docs/audit/sessions/SXXX.md)
- Active cycle status.md (if any)
- Snapshot

2) Ask/Infer:
- What was the original objective?
- What is the current objective now?

3) Drift signals:
- objective changed
- scope expanded
- unexpected modules touched
- architectural refactor emerging
- cannot explain in 1 sentence

4) Produce a Drift Report:
- Drift level: none | mild | severe
- What changed (bullets)
- Keep vs discard
- Split recommendation:
  - new cycle? (feature/spike/structural)
  - new branch?
  - CR required?

5) If objective changed:
- Recommend creating CR entry in cycle change-requests.md
- Impact classification: low | medium | high
- If medium/high → recommend new cycle

6) If idea is valuable but non-essential:
- Add IDEA-xxx suggestion for parking-lot.md

Output:
- Recovery actions (2–5 steps)
- Clear Next Entry Point
