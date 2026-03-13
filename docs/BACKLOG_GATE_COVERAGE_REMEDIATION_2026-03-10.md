# Backlog Gate Coverage Remediation - 2026-03-10

## Goal

Track concrete implementation work for the remediation plan defined in:

- `docs/PLAN_GATE_COVERAGE_REMEDIATION_2026-03-10.md`

Reference audit:

- `docs/AUDIT_GATE_COVERAGE_2026-03-10.md`

## Backlog Items

### GCR-01 - Consolidate Shared Workflow Interpretation Helpers

Status: done
Priority: high

Files:

- `src/lib/workflow/*`
- workflow admission consumers

Why:

- keep one source of truth for branch/session/cycle interpretation across all admission-first skills

Done when:

- shared helpers cover branch kind, branch mapping, open-cycle lookup, and continuity metadata access
- new skill admissions reuse shared helpers instead of local parsing copies

### GCR-02 - Implement `close-session-admit`

Status: done
Priority: high

Files:

- `src/application/runtime/*`
- `tools/perf/*`

Why:

- restore the mandatory open-cycle resolution gate before session close

Done when:

- a dedicated `close-session` admission use case exists
- it enumerates unresolved open cycles
- it stops when at least one open cycle lacks an explicit decision
- it returns a structured admission payload

### GCR-03 - Add `close-session` Specialized Hook Entrypoint

Status: done
Priority: high

Files:

- `tools/perf/*`
- `src/core/skills/skill-policy.mjs`
- `src/application/runtime/skill-hook-use-case.mjs`

Why:

- run `close-session` admission before generic `workflow-hook --phase session-close`

Done when:

- `close-session` no longer routes directly to generic `workflow-hook`
- the specialized hook delegates to `workflow-hook` only after admission success

### GCR-04 - Add `close-session` Contract Fixtures

Status: done
Priority: high

Files:

- `tools/perf/verify-*`
- `tests/fixtures/*`

Why:

- prevent regression on unresolved open cycles

Done when:

- fixtures prove `close-session` blocks with unresolved cycle decisions
- fixtures prove `close-session` proceeds when cycle resolution is explicit
- codex and direct hook paths both assert the same admission result

### GCR-05 - Implement `cycle-create-admit`

Status: done
Priority: high

Files:

- `src/application/runtime/*`
- `tools/perf/*`

Why:

- restore the documented continuity gate before branch/artifact creation

Done when:

- a dedicated `cycle-create` admission use case exists
- it resolves current session branch and latest active cycle branch
- it stops when continuity is ambiguous
- it requires an explicit rule selection for `R1|R2|R3` when needed

### GCR-06 - Add `cycle-create` Specialized Hook Entrypoint

Status: done
Priority: high

Files:

- `tools/perf/*`
- `src/core/skills/skill-policy.mjs`
- `src/application/runtime/skill-hook-use-case.mjs`

Why:

- run continuity admission before generic `checkpoint`

Done when:

- `cycle-create` no longer routes directly to generic `checkpoint`
- delegation happens only after admission success

### GCR-07 - Add `cycle-create` Contract Fixtures

Status: done
Priority: high

Files:

- `tools/perf/verify-*`
- `tests/fixtures/*`

Why:

- lock the continuity gate in tests

Done when:

- fixtures prove `cycle-create` blocks on ambiguous continuity
- fixtures prove `cycle-create` proceeds when continuity is explicit
- fixtures cover path-conflict and mode-rule combinations when applicable

### GCR-08 - Implement `requirements-delta-admit`

Status: done
Priority: high

Files:

- `src/application/runtime/*`
- `tools/perf/*`

Why:

- add a runtime decision boundary for medium/high-impact ownership ambiguity

Done when:

- `requirements-delta` can stop on unclear branch/cycle ownership
- admission returns explicit routing decisions for continue/new-cycle/arbitration

### GCR-09 - Add `requirements-delta` Specialized Hook Entrypoint

Status: done
Priority: high

Files:

- `tools/perf/*`
- `src/core/skills/skill-policy.mjs`
- `src/application/runtime/skill-hook-use-case.mjs`

Why:

- keep runtime enforcement consistent with the new admission logic

Done when:

- `requirements-delta` no longer relies only on a generic `checkpoint` route
- codex/runtime entrypoints expose the admission result

### GCR-10 - Add `requirements-delta` Contract Fixtures

Status: done
Priority: high

Files:

- `tools/perf/verify-*`
- `tests/fixtures/*`

Why:

- prevent silent writes on ambiguous ownership

Done when:

- fixtures prove medium/high-impact ambiguity blocks
- fixtures prove clear ownership can proceed

### GCR-11 - Expose `handoff-close` In Runtime Skill Routing

Status: done
Priority: high

Files:

- `src/core/skills/skill-policy.mjs`
- `src/application/runtime/skill-hook-use-case.mjs`
- optional hook script under `tools/perf/*`

Why:

- remove the documented/runtime mismatch where `handoff-close` is unsupported

Done when:

- `handoff-close` is accepted by the runtime skill hook
- its route is explicit and documented
- strict state-mode behavior remains aligned with other mutating skills

### GCR-12 - Decide Whether `handoff-close` Needs Dedicated Admission

Status: done
Priority: medium

Files:

- `tools/runtime/handoff-admit.mjs`
- `tools/perf/*`
- handoff docs

Why:

- determine whether exposure alone is enough or whether handoff-state blocking must be runtime-enforced before writes

Done when:

- the runtime boundary for `handoff-close` is explicit
- either a dedicated admission exists or documentation clearly states why generic admission is sufficient

### GCR-13 - Reassess `convert-to-spike` After `cycle-create` Fix

Status: done
Priority: medium

Files:

- `scaffold/codex/convert-to-spike/SKILL.md`
- runtime route if needed

Why:

- most of its continuity risk is inherited from `cycle-create`

Done when:

- audit confirms whether `cycle-create` admission is sufficient protection
- additional hook work is added only if still necessary

### GCR-14 - Reassess `promote-baseline` For Machine-Enforced Validation

Status: done
Priority: medium

Files:

- `scaffold/codex/promote-baseline/SKILL.md`
- runtime route if needed

Why:

- decide whether validation stop conditions must become runtime-enforced or remain skill-level checklist logic

Done when:

- runtime/documentation boundary is explicit
- either a targeted validation gate exists or the contract is clarified

### GCR-15 - Reassess `drift-check` Arbitration Boundary

Status: done
Priority: low

Files:

- `scaffold/codex/drift-check/SKILL.md`
- gating runtime if needed

Why:

- determine whether generic gating remains the intended source of truth for severe/structural drift

Done when:

- the audit watchlist for `drift-check` is resolved by code or documentation

### GCR-16 - Update Skill Documentation For Admission-First Behavior

Status: done
Priority: high

Files:

- `scaffold/codex/close-session/SKILL.md`
- `scaffold/codex/cycle-create/SKILL.md`
- `scaffold/codex/requirements-delta/SKILL.md`
- `scaffold/codex/handoff-close/SKILL.md`

Why:

- keep contract and runtime behavior aligned as fixes land

Done when:

- each remediated skill explicitly documents its admission-first runtime behavior
- structured stop/proceed/choice outcomes are described

### GCR-17 - Update Global Workflow Documentation

Status: done
Priority: high

Files:

- `scaffold/root/AGENTS.md`
- `scaffold/docs_audit/PROJECT_WORKFLOW.md`
- `scaffold/docs_audit/WORKFLOW_SUMMARY.md`
- changelog docs

Why:

- advertise which workflow skills are now runtime-enforced and prevent future contract/runtime drift

Done when:

- global docs reflect the new admission-first skills
- changelog entries summarize the remediation batch

### GCR-18 - Rerun Gate Coverage Audit After The First Remediation Batch

Status: done
Priority: high

Files:

- `docs/AUDIT_GATE_COVERAGE_2026-03-10.md`
- follow-up audit doc if needed

Why:

- verify that confirmed gaps are actually closed and shrink the watchlist with execution-backed evidence

Done when:

- confirmed gaps from the initial audit are marked remediated
- remaining watchlist items are either downgraded or promoted to implementation work with evidence
