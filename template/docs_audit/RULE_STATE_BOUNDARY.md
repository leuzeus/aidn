# Rule vs State Boundary (Audit Workflow)

Purpose: keep workflow artifacts structurally clean by separating rules from state.

## Canonical Rule Layers
- `docs/audit/SPEC.md`: canonical mechanics and invariant gates.
- `docs/audit/WORKFLOW.md`: project-level adapter extensions linked to `SPEC-Rxx`.
- `AGENTS.md`: execution contract and precedence context.

Rules are normative. They define behavior constraints and decision policies.

## State Layers
- `docs/audit/snapshots/context-snapshot.md`
- `docs/audit/baseline/*.md`
- `docs/audit/cycles/*/status.md`
- `docs/audit/sessions/SXXX.md`

State artifacts are declarative. They record facts, status, decisions, and pointers.

## Allowed in State Files
- State fields (`state`, `dor_state`, branch mapping, dates, outcomes)
- Short references to canonical rules (for example `SPEC-R04`)
- Operational pointers (next entry point, linked artifacts)

## Not Allowed in State Files
- Reusable policy checklists (for example full DoR gate checklists)
- Canonical rule prose copied from `SPEC.md`/`WORKFLOW.md`
- Adapter policy sections rewritten as state narrative

## Practical Rule
- If a paragraph can apply to many cycles/sessions, it belongs to rule layers.
- If a line describes only the current cycle/session fact, it belongs to state layers.

## Enforcement
- If available, use a workflow policy check to validate:
  - rule-reference integrity in `WORKFLOW.md`
  - no deprecated DoR checklist prose in `cycles/*/status.md`
  - no rule/checklist headers in snapshot
- Integrate this check in local CI when possible.
