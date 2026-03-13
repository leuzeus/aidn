# BPMN To Implementation Plan

This document translates the BPMN target model into implementation slices for the current `aidn` codebase.

It assumes:

- canonical workflow mechanics remain owned by `docs/audit/SPEC.md`
- the installed repository layout remains the operational target
- multi-agent support is introduced progressively

## Current Baseline

Already available in the repository:

- `CURRENT-STATE.md`
- `RUNTIME-STATE.md`
- `HANDOFF-PACKET.md`
- pre-write gate in `AGENTS.md`
- runtime hydration and repair-layer refresh
- deterministic handoff packet projection
- admission-first workflow hooks for `start-session`, `close-session`, `cycle-create`, `requirements-delta`, `promote-baseline`, and `convert-to-spike`
- explicit `handoff-close` runtime exposure with blocking checkpoint results surfaced at the skill boundary

This means the BPMN is not starting from zero.
The next work should focus on turning these artifacts into a true multi-agent operating model.

## Current Status

The implementation slices defined in this plan are now covered in the repository:

- Slice 1: explicit handoff closure
- Slice 2: agent role model
- Slice 3: handoff admission gate
- Slice 4: coordinator loop
- Slice 5: repair-aware routing
- Slice 6: session-level transition policies

The implementation also goes further than the original slice set with:

- bounded active orchestration
- user arbitration recording and resume
- adapter roster and external adapter registration
- adapter health and environment compatibility checks
- coordination log/history/summary digests
- multi-agent status and agent selection digests
- explicit distinction between session topology (`attached_cycles`, `integration_target_cycles`, optional `primary_focus_cycle`) and dispatch scope

At this point, the remaining work is no longer "foundational multi-agent workflow support".
It is product expansion on top of the implemented baseline.

## Multi-Cycle Session Runtime Note

The runtime now distinguishes:

- session topology:
  - `attached_cycles`
  - `integration_target_cycles`
  - optional `primary_focus_cycle`
- dispatch focus:
  - singular `scope_type + scope_id + target_branch`

This prevents the coordinator and repair layer from treating a multi-cycle session as if it had to collapse into one global target cycle.

## Continuity With The Original Next Steps

Before the BPMN work, the practical next steps were already identified as:

1. add a true `handoff-close` artifact/command
2. extend the agent port to model agent roles/capabilities beyond `runCommand()`
3. build a lightweight orchestrator that decides which agent to relaunch from `HANDOFF-PACKET.md`

The BPMN work does not replace that trajectory.
It only refines it to avoid unsafe jumps.

The continuity rule for this plan is therefore:

- `handoff-close` remains the first implementation target
- agent role modeling remains a core milestone
- the orchestrator remains the longer-term target
- intermediate slices are inserted only to make that path safer and easier to implement

Those intermediate slices are:

- `handoff-admit`
- repair-aware routing

They should be read as safety sub-steps, not as a change of direction.

## Slice 1 - Explicit Handoff Closure

Goal:

- make agent exit explicit instead of implicit

Expected implementation:

- add a `handoff-close` skill or equivalent workflow action
- require:
  - `CURRENT-STATE.md` refresh
  - `RUNTIME-STATE.md` refresh in `dual` / `db-only`
  - `HANDOFF-PACKET.md` refresh
  - explicit next-agent intent

Likely touchpoints:

- `scaffold/codex/`
- `scaffold/root/AGENTS.md`
- `tools/codex/hydrate-context.mjs`
- `tools/runtime/project-handoff-packet.mjs`

Acceptance criteria:

- a leaving agent can close with a deterministic relay packet
- the packet states whether the next agent should `reanchor`, `repair`, `implement`, or `analyze`

## Slice 2 - Agent Role Model

Goal:

- make agent roles explicit in code instead of leaving them as prose only

Expected implementation:

- extend the agent abstraction beyond `runCommand()`
- add a lightweight role/capability model:
  - `coordinator`
  - `executor`
  - `auditor`
  - `repair`

Likely touchpoints:

- `src/core/ports/agent-adapter-port.mjs`
- `src/adapters/codex/codex-agent-adapter.mjs`
- runtime planning/orchestration layer to be introduced

Acceptance criteria:

- the runtime can represent which role is expected next
- the handoff packet can be interpreted against a known role model

## Slice 3 - Handoff Admission Gate

Goal:

- ensure a receiving agent cannot treat a handoff packet as a bypass

Expected implementation:

- define a `handoff-admit` check:
  - packet exists
  - packet status is not `blocked`
  - referenced artifacts exist
  - packet does not contradict `CURRENT-STATE.md` / `RUNTIME-STATE.md`

Likely touchpoints:

- `tools/runtime/project-handoff-packet.mjs`
- new verifier under `tools/perf/`
- `scaffold/docs_audit/REANCHOR_PROMPT.md`

Acceptance criteria:

- a stale or contradictory packet is rejected
- receiving agent falls back to normal re-anchor

## Slice 4 - Coordinator Loop

Goal:

- introduce a minimal coordinator behavior aligned with the BPMN macro view

Expected implementation:

- add a runtime command that chooses the next action from:
  - reanchor
  - implement
  - audit
  - repair
  - close
  - relay

Likely touchpoints:

- new runtime command under `tools/runtime/`
- optional CLI alias in `bin/aidn.mjs`
- input sources:
  - `CURRENT-STATE.md`
  - `RUNTIME-STATE.md`
  - `HANDOFF-PACKET.md`
  - active session file
  - active cycle `status.md`

Acceptance criteria:

- the command produces a deterministic next-step recommendation
- no autonomous write occurs from this command alone

Current implementation note:

- `coordinator-next-action` now covers the deterministic recommendation layer
- the next safe extension is a read-only dispatch plan that maps `role + action` to an explicit entrypoint for the selected agent adapter
- active orchestration should only start after this dispatch layer is stable
- when introduced, active orchestration should stay opt-in and default to `dry-run`
- `coordinator-loop` is the persistent read-only memory layer that reuses coordination history and `COORDINATION-SUMMARY.md` before selecting another relay
- `coordinator-resume` is now the safe bridge from an escalated loop back to active dispatch after a valid `user_arbitration` event
- `coordinator-orchestrate` is now the bounded opt-in runtime loop above `coordinator-resume`; it stays dry-run by default and stops on unresolved escalation or immediate relay repetition
- built-in agent selection is now policy-driven: `auto` chooses the most specialized adapter that can satisfy the required `role + action`, while explicit `--agent` still overrides it

## Slice 5 - Repair-Aware Multi-Agent Routing

Goal:

- make repair-layer status drive the next agent role

Expected implementation:

- map:
  - `repair_layer_status=ok` -> execution or audit
  - `repair_layer_status=warn` -> repair or audit-first
  - `repair_layer_status=block` -> stop / user arbitration / repair

Likely touchpoints:

- `tools/runtime/project-runtime-state.mjs`
- `tools/runtime/project-handoff-packet.mjs`
- hinting/output commands

Acceptance criteria:

- relay output is consistent with repair-layer severity
- blocking status always prevents implementation routing

## Slice 6 - Session-Level Multi-Agent Policies

Goal:

- define what kinds of agent transitions are allowed by phase and mode

Expected implementation:

- policy matrix by mode:
  - `THINKING`
  - `EXPLORING`
  - `COMMITTING`
- examples:
  - `coordinator -> executor`
  - `executor -> auditor`
  - `executor -> repair`
  - `auditor -> coordinator`

Likely touchpoints:

- `scaffold/root/AGENTS.md`
- `scaffold/docs_audit/WORKFLOW.md`
- maybe a dedicated policy artifact later if needed

Acceptance criteria:

- not every agent can do every transition blindly
- `COMMITTING` transitions remain more constrained than `THINKING`

## Recommended Order

1. Slice 1 - explicit handoff closure
2. Slice 3 - handoff admission gate
3. Slice 5 - repair-aware routing
4. Slice 2 - role model
5. Slice 4 - coordinator loop
6. Slice 6 - session-level policies

Reasoning:

- first make relay explicit
- then make relay safe
- then make relay useful
- only after that add orchestration structure

Equivalent reading against the original 3-step continuity:

1. original step 1 = Slice 1
2. original step 2 = Slice 2
3. original step 3 = Slice 4

Inserted before the original step 2 and step 3:

- Slice 3 as a relay safety gate
- Slice 5 as runtime-aware routing discipline

## Not Recommended Yet

Do not implement yet:

- parallel autonomous agents writing to the same repo state
- concurrent cycle execution without stronger ownership rules
- automatic merge decisions between agents
- opaque planner heuristics without artifact traceability

These would exceed the current workflow safety envelope.

## Practical Next Task

If continuing immediately from the current branch, the best next implementation target is:

1. use `coordinator-resume` as the only automatic re-entry point after escalation
2. keep orchestration bounded and opt-in via `coordinator-orchestrate`
3. only then consider a more autonomous multi-agent scheduler
