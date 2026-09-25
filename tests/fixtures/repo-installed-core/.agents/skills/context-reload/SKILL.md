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
- docs/audit/CURRENT-STATE.md (if present)
- docs/audit/WORKFLOW-KERNEL.md (if present)
- docs/audit/WORKFLOW_SUMMARY.md (if present)
- docs/audit/snapshots/context-snapshot.md
- docs/audit/baseline/current.md
- docs/audit/cycles/*/status.md (active cycles only)
- Current Git branch (if accessible)

2) Produce a concise Context Reload Report:

### CURRENT STATE
- Current-state freshness / missing fields
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

If `CURRENT-STATE.md` is missing, stale, or contradictory with snapshot/session/cycle facts:
- report the mismatch explicitly
- recommend the smallest update needed through the mutating workflow skills
- do not rewrite the file in this read-only skill

Keep report concise.
4) Canonical read-only admission:
- Use the live admission from Project Activation to read mode, session/cycle, source-of-truth and repair signals; unknown mode is allowed only for this context reconstruction.
- In dual/db-only, the configured canonical backend must be available. A cached bundle or visible projection does not prove freshness.
- Read `repair_layer_status` and `repair_layer_advice` from admission. Treat `docs/audit/RUNTIME-STATE.md` as a derived anchor.
- If repair signals require diagnosis, use `npx aidn runtime repair-layer-triage --target . --json`; blocking findings stop further workflow actions.
- Do not run run-json-hook or hydrate-context as part of this read-only skill: those paths can write hook history or derived caches.
- This admission is not write authorization. Run start-session admission next; each durable write requires its own current admission.

## Separate authorized cache refresh

Only outside this read-only skill, after explicit cache-write authorization and fresh workflow admission, hydrate db-backed context with `npx aidn codex hydrate-context --target . --skill context-reload --project-runtime-state --json`.
This writes a derived cache and computes a runtime projection even with `--json`; visible materialization requires separate explicit intent. Cache refresh is never a prerequisite for the read-only report.
