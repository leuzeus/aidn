# BPMN Notes

This directory contains BPMN 2.0 XML files intended for import into `bpmn.io`.

## Files

- `aidn-multi-agent-ideal.bpmn`
  - macro end-to-end target view
  - shows the main lanes:
    - user / operator
    - coordinator agent
    - execution agent
    - audit agent
    - runtime / repair layer

- `aidn-multi-agent-handoff-detail.bpmn`
  - detailed relay view
  - focuses on:
    - `HANDOFF-PACKET.md`
    - re-anchor
    - pre-write gate
    - runtime refresh
    - repair triage
    - agent-to-agent relay

## Modeling Assumptions

- the BPMN is a target operating model, not an executable engine design
- it stays aligned with current aid'n concepts:
  - `CURRENT-STATE.md`
  - `RUNTIME-STATE.md`
  - `HANDOFF-PACKET.md`
  - `pre-write gate`
  - `repair_layer_status`
- it does not assume a full scheduler or autonomous multi-agent planner yet

## Read Order

1. open `aidn-multi-agent-ideal.bpmn`
2. open `aidn-multi-agent-handoff-detail.bpmn`
3. compare with current runtime and workflow artifacts before deriving implementation work

## Practical Use

- the foundational multi-agent workflow slices from `IMPLEMENTATION_PLAN.md` are now implemented
- read the BPMN set as the current operating baseline plus a reference model for future product extensions
- use the macro BPMN to discuss product direction
- use the handoff BPMN to derive the next runtime and workflow implementation slices
- use `IMPLEMENTATION_PLAN.md` to sequence the real repository changes from these BPMN targets
- use `IMPLEMENTATION_PLAN.md` also to confirm continuity with the original path: `handoff-close -> role model -> orchestrator`
- use runtime dispatch planning as the bridge between recommendation and future orchestration, not as an autonomous writer
- use `coordinator-loop` as the current read-only memory layer before replaying another dispatch
- use `coordinator-resume` to gate any automatic replay after escalation; escalation must be cleared by `user_arbitration` first
- use `coordinator-orchestrate` only as a bounded opt-in runner; it should stop on unresolved escalation or immediate repeat, not behave like an open-ended scheduler
- use `agent-selection-policy` with `--agent auto` to prefer specialized adapters for audit and repair relays while preserving explicit adapter override when needed
