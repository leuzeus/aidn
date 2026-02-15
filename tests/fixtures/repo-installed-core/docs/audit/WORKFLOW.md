# CODEX WORKFLOW — Session-Based + Automated Context Reload (v3)

This is a stack-agnostic workflow optimized for irregular development and creative drift control.

## Key files
- Snapshot: `snapshots/context-snapshot.md` (fast reload < 5 minutes)
- Baseline: `baseline/current.md`
- Parking lot: `parking-lot.md`
- Templates: `cycles/TEMPLATE_*.md`, `sessions/TEMPLATE_SESSION_SXXX.md`
- Agent rules: `/AGENTS.md`

## Guardrails
- Scope Freeze + Change Requests (CR) gate
- Parking lot for non-essential ideas
- Branch awareness: map active branch to one active cycle

## Auto mode detection
At the start of each session, propose a mode:
- THINKING (doc only)
- EXPLORING (code may be throwaway)
- COMMITTING (production intent; cycle + branch mapping required)

Date: 2026-02-07
