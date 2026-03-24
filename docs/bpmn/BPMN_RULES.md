# BPMN Rules

These rules define the structural and layout conventions for the BPMN files in this directory.
They should be preserved when updating an existing diagram or adding a new focused view.

## Structural Rules

- A `task` should have exactly `1` incoming sequence flow and `1` outgoing sequence flow.
- A `startEvent` should have `0` incoming sequence flows and `1` outgoing sequence flow.
- An `endEvent` should have `1` incoming sequence flow and `0` outgoing sequence flows.
- A decision gateway should normally be `1 -> 2`.
- A merge gateway should normally be `2 -> 1`.
- Avoid gateways with more than `3` total connections unless there is a strong reason and it is documented.
- If a flow needs both a merge and a decision, use two gateways, not one overloaded gateway.
- If a task appears to need multiple incoming flows, introduce a merge gateway before it.
- If an end event appears to need multiple incoming flows, split it into multiple end events with distinct names.

## Naming Rules

- Name focused diagrams by workflow slice, not by team discussion topic.
- Name gateways by the invariant they test:
  - good: `Ready to write?`
  - good: `Repair blocked?`
  - avoid vague names unless the gateway is a pure technical merge
- Technical merge gateways should still have a short readable label:
  - `Resume admission`
  - `Clarification path`
  - `Publish relay path`
- End events should describe the outcome, not just say `Done`.

## Data Object Rules

- It is acceptable to duplicate `dataObjectReference` nodes with the same visible name when this improves readability.
- Prefer a local data object reference over a long crossing association.
- Keep data associations short and mostly vertical when possible.

## Layout Rules

- Lanes should be wide enough that the main path uses the available horizontal space.
- Do not cluster all nodes on the left if the lane extends much farther right.
- Keep the primary happy path mostly left-to-right.
- Put fallback, blocked, or loop-back paths above or below the main path rather than directly on top of it.
- Keep a consistent horizontal rhythm across focused diagrams:
  - start event
  - gateway
  - task
  - gateway
  - task
  - end event
- Prefer orthogonal waypoints with clear vertical and horizontal segments.
- Avoid diagonal edges when a clean orthogonal route is possible.
- Keep loop returns visually distinct from the main forward path.

## Focused View Rules

- `aidn-session-admission-reanchor.bpmn` is the source of truth for admission and clarification flow.
- `aidn-execution-repair-review.bpmn` is the source of truth for execution, repair, and review loops.
- `aidn-handoff-close-publish.bpmn` is the source of truth for handoff, close, and publish decisions.
- `aidn-multi-agent-handoff-detail.bpmn` is the detailed relay variant and may contain more routing detail than the other focused views.
- `aidn-multi-agent-ideal.bpmn` is a macro cross-check, not the primary editing surface for detailed logic.

## Update Procedure

1. Change the smallest focused BPMN first.
2. Preserve the structural rules above before adjusting aesthetics.
3. Re-space lanes and nodes after any structural change.
4. Re-import the changed file into `https://demo.bpmn.io/`.
5. If a focused BPMN changes meaningfully, reflect the same intent in `aidn-multi-agent-ideal.bpmn`.
6. Update this file if a new modeling convention is introduced.
