# BPMN Notes

This directory contains BPMN 2.0 XML files intended for import into `bpmn.io`.
They are aligned with the current runtime baseline, not just the original target vision.

## Files

- `aidn-multi-agent-ideal.bpmn`
  - macro end-to-end target view
  - keeps the whole workflow on one canvas
  - useful when discussing overall lifecycle, but still denser than the focused views

- `aidn-multi-agent-handoff-detail.bpmn`
  - detailed relay view
  - focuses on:
    - `HANDOFF-PACKET.md`
    - re-anchor
    - pre-write gate
    - runtime refresh
    - repair triage
    - agent-to-agent relay

- `aidn-session-admission-reanchor.bpmn`
  - focused admission view
  - covers:
    - user clarification
    - re-anchor
    - session admission
    - branch-cycle and pre-write gating
    - plan-only fallback vs execution admission

- `aidn-execution-repair-review.bpmn`
  - focused execution loop view
  - covers:
    - implementation
    - runtime refresh
    - repair blocked vs warning vs clear
    - review loop
    - resume after arbitration

- `aidn-handoff-close-publish.bpmn`
  - focused closing view
  - covers:
    - handoff preparation
    - close-session decision
    - publish session state
    - continue-working exit

## Modeling Assumptions

- the BPMN is a target operating model, not an executable engine design
- it stays aligned with current aid'n concepts:
  - `CURRENT-STATE.md`
  - `RUNTIME-STATE.md`
  - `HANDOFF-PACKET.md`
  - `pre-write gate`
  - `repair_layer_status`
  - admission-first workflow hooks (`start-session`, `close-session`, `pr-orchestrate`, `cycle-create`, `requirements-delta`, `promote-baseline`, `convert-to-spike`)
- it does not assume a full scheduler or autonomous multi-agent planner yet
- it does not model install/reinstall mechanics, deterministic adapter generation, or runtime backend adoption flows directly; those stay documented in:
  - `docs/INSTALL.md`
  - `docs/UPGRADE.md`
  - `docs/MIGRATION_RUNTIME_PERSISTENCE_POSTGRESQL.md`
  - `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`

## Rules

- use [BPMN_RULES.md](/G:/projets/aidn/docs/bpmn/BPMN_RULES.md) as the editing contract for structure, naming, layout, and update procedure
- if a future BPMN update breaks one of those rules, either fix the diagram or update the rule explicitly
- prefer changing the focused view first, then reflect the result into the macro view

## Read Order

1. open `aidn-session-admission-reanchor.bpmn`
2. open `aidn-execution-repair-review.bpmn`
3. open `aidn-handoff-close-publish.bpmn`
4. open `aidn-multi-agent-handoff-detail.bpmn` for the detailed relay variant
5. use `aidn-multi-agent-ideal.bpmn` only as the macro cross-check
6. compare with current runtime and workflow artifacts before deriving implementation work

## Practical Use

- the foundational multi-agent workflow slices from `docs/bpmn/IMPLEMENTATION_PLAN.md` are now implemented
- read the BPMN set as the current operating baseline plus a reference model for future product extensions
- use the macro BPMN to discuss product direction
- use the focused BPMN set to derive implementation slices that map directly to runtime modules
- use the handoff BPMN to inspect the relay path in more detail when packet semantics matter
- use `aidn project config` and `.aidn/project/workflow.adapter.json` for durable adapter policy; that lifecycle is adjacent to BPMN, not inside the swimlanes
- use `runtime persistence-adopt` and `runtime shared-coordination-projects` for backend/admin visibility; these are operator surfaces around the BPMN, not replacements for it
- use `docs/bpmn/IMPLEMENTATION_PLAN.md` to sequence the real repository changes from these BPMN targets
- use `docs/bpmn/IMPLEMENTATION_PLAN.md` also to confirm continuity with the original path: `handoff-close -> role model -> orchestrator`
- use runtime dispatch planning as the bridge between recommendation and future orchestration, not as an autonomous writer
- use `coordinator-loop` as the current read-only memory layer before replaying another dispatch
- use `coordinator-resume` to gate any automatic replay after escalation; escalation must be cleared by `user_arbitration` first
- use `coordinator-orchestrate` only as a bounded opt-in runner; it should stop on unresolved escalation or immediate repeat, not behave like an open-ended scheduler
- use `agent-selection-policy` with `--agent auto` to prefer specialized adapters for audit and repair relays while preserving explicit adapter override when needed
- read session topology as plural (`attached_cycles`, `integration_target_cycles`) and dispatch focus as singular (`scope_type`, `scope_id`, `target_branch`); they intentionally solve different problems
- remember that `drift-check` remains generic by design, but its hook output now exposes the real gate result instead of a masked success wrapper
