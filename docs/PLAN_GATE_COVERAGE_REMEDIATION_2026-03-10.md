# Plan - Gate Coverage Remediation

Date: 2026-03-10
Status: completed
Scope: remediate the workflow gate coverage gaps identified in `docs/AUDIT_GATE_COVERAGE_2026-03-10.md` while integrating cleanly with the current runtime/hook architecture.

## Problem Statement

The gate coverage audit identified several workflow skills whose documented business gates are not enforced by the actual runtime path.

Observed mismatch:

- some skills document mandatory blocking decisions or arbitration steps
- the runtime route still delegates directly to generic `workflow-hook` or `checkpoint` execution
- the generic runtime path provides reload/gate/index/repair behavior, but not the specialized workflow decision described by the skill contract
- this recreates the same class of regression that previously affected `start-session`

Confirmed gaps from the audit:

- `close-session`
- `cycle-create`

Strong watchlist:

- `requirements-delta`
- `promote-baseline`
- `convert-to-spike`

Confirmed structural inconsistency:

- `handoff-close` is documented in templates but not exposed in the runtime skill map

## Goals

Restore reliable runtime enforcement for documented workflow gates by:

- adding specialized admission or decision layers where the contract requires them
- keeping generic runtime hooks for:
  - reload
  - gating signals
  - index sync
  - repair layer
  - strict db-backed execution
- centralizing shared workflow interpretation so branch/session/cycle logic does not diverge again
- aligning runtime exposure with documented skills
- updating documentation and tests in the same implementation stream

## Non-Goals

- no rewrite of the generic `checkpoint` engine
- no rewrite of the generic `workflow-hook` engine
- no GitHub-specific API dependency for the first remediation pass
- no attempt to convert every checklist-style skill into a dedicated admission layer when the generic runtime path is already sufficient

## Reference Audit

Primary reference:

- `docs/AUDIT_GATE_COVERAGE_2026-03-10.md`

Priority baseline from the audit:

1. `close-session`
2. `cycle-create`
3. `requirements-delta`
4. `handoff-close`
5. `promote-baseline`
6. `convert-to-spike`
7. `drift-check` only if stronger business arbitration is still required beyond generic gating

## Addendum - Persistent Source Branch Metadata

Date: 2026-03-10
Status: accepted

Decision:

- the persistent source of truth for the project source branch becomes `.aidn/config.json`
- canonical config key: `workflow.sourceBranch`
- runtime fallback order remains backward-compatible:
  1. `.aidn/config.json` -> `workflow.sourceBranch`
  2. `docs/audit/WORKFLOW.md` -> `source_branch`
  3. `docs/audit/baseline/current.md` -> `source_branch`

Rationale:

- `requested source branch` for continuity and session-base gates is project metadata, not transient state
- `docs/audit/WORKFLOW.md` is install-time/project-stub metadata but remains a mutable document artifact
- `.aidn/config.json` is already the persistent project runtime configuration and is the cleanest place to keep a machine-consumable branch setting
- fallback support avoids breaking already-installed repositories while the config key rolls out

Implementation impact:

- installer must persist the resolved source branch into `.aidn/config.json`
- runtime source-branch readers must read config first and then fall back to installed workflow artifacts
- `cycle-create` continuity admission must treat the configured source branch as the persistent continuity metadata reference

## Implementation Progress - 2026-03-11

Completed runtime batches:

- shared workflow interpretation now routes through reusable branch/session/cycle helpers
- `close-session` now applies admission before generic `session-close` runtime delegation
- `cycle-create` now applies continuity admission and mode-gate enforcement before generic `checkpoint`
- `requirements-delta` now applies ownership/impact admission before generic `checkpoint`
- `promote-baseline` now applies validation admission before generic `checkpoint`
- `convert-to-spike` now applies explicit spike-continuity admission reusing `cycle-create` continuity logic in `EXPLORING`
- `handoff-close` is exposed in the runtime map and now surfaces blocking checkpoint results directly
- `drift-check` continues to use generic gating as the business source of truth, but top-level hook `ok` now reflects the actual gate result

Remaining work:

- none in the original remediation scope; follow-up audit recorded in `docs/AUDIT_GATE_COVERAGE_FOLLOWUP_2026-03-11.md`

## Design Principle

Reuse the remediation pattern already applied to `start-session` and `branch-cycle-audit`.

For each affected skill:

1. add a dedicated admission or decision use case
2. return an explicit machine decision such as:
   - `proceed`
   - `stop`
   - `choose`
   - `resume`
3. delegate to generic `checkpoint` or `workflow-hook` only after admission succeeds

This keeps the current runtime architecture intact while restoring the missing business gate.

## Remediation Strategy

### Phase 1 - Consolidate shared workflow interpretation

Before fixing more skills, ensure the same branch/session/cycle reading is reused everywhere.

Centralize:

- branch kind classification
- session lookup
- cycle status lookup
- active/open cycle resolution
- continuity metadata parsing
- ownership ambiguity detection

Consumers should include:

- specialized skill admission layers
- `branch-cycle-audit`
- `reload-check`
- pre-write/runtime helpers
- verification fixtures and consistency tools

Expected result:

- one source of truth for workflow topology
- lower risk of reintroducing contract/runtime drift across skills

### Phase 2 - Restore `close-session` admission

`close-session` is the highest-priority confirmed runtime gap.

Required business gate:

- inspect the active session and attached/open cycles before session close
- require an explicit decision for every open cycle:
  - `integrate-to-session`
  - `report`
  - `close-non-retained`
  - `cancel-close`
- stop session close when at least one open cycle lacks an explicit decision

Implementation model:

1. add `close-session-admit`
2. run it before `workflow-hook --phase session-close`
3. return a structured payload with:
   - `open_cycles`
   - `required_cycle_decisions`
   - `missing_decisions`
   - `admission_status`
   - `recommended_next_action`

Expected result:

- `close-session` no longer returns `ok` while open cycles remain unresolved

### Phase 3 - Restore `cycle-create` continuity admission

`cycle-create` is the second confirmed runtime gap and a core workflow primitive.

Required business gate:

- inspect current session branch and latest active cycle branch
- compare the requested source branch against allowed continuity bases
- if the requested source branch is neither the latest active cycle branch nor the current session branch tip, stop and require a continuity rule choice
- forbid artifact creation before the continuity decision exists

Required decision outcomes:

- `proceed_r1_strict_chain`
- `proceed_r2_session_base_with_import`
- `stop_choose_continuity_rule`
- `stop_existing_cycle_path_conflict`
- `stop_invalid_mode_rule_combo`

Implementation model:

1. add `cycle-create-admit`
2. run it before generic `checkpoint`
3. call the generic runtime path only after continuity is explicit

Expected result:

- `cycle-create` can no longer silently pass on ambiguous continuity conditions

### Phase 4 - Add ownership arbitration for `requirements-delta`

This item is not yet execution-confirmed, but the contract/routing mismatch is strong enough to plan immediately.

Required business gate:

- when impact is `medium` or `high` and branch ownership is unclear, stop and require explicit cycle/branch routing

Implementation model:

1. add `requirements-delta-admit` or a narrower decision helper
2. inspect:
   - impact level
   - active session/cycle ownership
   - current branch kind
   - branch ownership clarity
3. return:
   - `continue_same_cycle`
   - `recommend_new_cycle`
   - `stop_choose_cycle_or_branch`

Expected result:

- medium/high-impact addenda stop on ambiguous ownership instead of mutating artifacts under a generic `checkpoint ok`

### Phase 5 - Align runtime exposure for `handoff-close`

`handoff-close` is a structural mismatch rather than a lost gate, but it should be corrected in the same remediation stream.

Required correction:

- add `handoff-close` to the supported skill route map
- route it to the intended runtime implementation
- preserve strict/db-backed behavior

Follow-up decision:

- if `handoff-close` only needs generic admission, expose it through a standard route
- if the contract requires additional handoff-state blocking semantics, add a specialized `handoff-close-admit`

Expected result:

- a documented skill is no longer rejected as unsupported by the runtime CLI
- the top-level skill hook also exposes the blocking checkpoint result instead of masking it behind a generic success wrapper

### Phase 6 - Decide the remaining watchlist scope

After the confirmed items are fixed, evaluate whether the remaining watchlist needs specialized admission or only documentation tightening.

Items:

- `promote-baseline`
- `convert-to-spike`
- `drift-check`

Decision rule:

- if the skill contract describes a workflow-routing or arbitration gate, prefer dedicated admission
- if the contract describes a checklist/validation activity already adequately handled outside the runtime hook, document the boundary explicitly instead of adding unnecessary engine complexity

Likely direction:

- `convert-to-spike` is now covered with a dedicated spike-continuity wrapper over `cycle-create` admission
- `promote-baseline` now uses a targeted validation gate before promotion work
- `drift-check` remains on generic gating, with normalized top-level hook output so blocking gate results are not hidden

## Integration Model

Keep the existing runtime stack for all affected skills.

Pattern:

1. skill entrypoint calls specialized admission
2. if admission returns `blocked` or `requires_user_choice`, stop there
3. if admission returns `proceed`, delegate to the current generic runtime tool

Runtime tools kept in place:

- `workflow-hook.mjs`
- `checkpoint.mjs`
- `gating-evaluate.mjs`

This preserves:

- run ids
- perf events
- reload/index behavior
- repair layer reporting
- strict `dual` / `db-only` enforcement

## Testing Plan

Each remediated skill must get contract tests that fail under the current broken behavior.

### Required new coverage

1. `close-session`

- blocks when attached open cycles have no explicit decision
- returns cycle-choice payload when decisions are incomplete
- proceeds only when the cycle resolution gate is satisfied

2. `cycle-create`

- blocks when continuity source is ambiguous
- requires exactly one continuity rule
- blocks if target cycle path already exists and no explicit reuse/rename decision exists
- proceeds only after continuity decision is explicit

3. `requirements-delta`

- blocks when impact is medium/high and ownership is unclear
- proceeds when ownership is clear or the chosen routing decision is explicit

4. `handoff-close`

- runtime recognizes the skill
- strict mode and state-mode handling remain aligned with other mutating skills

### Regression requirement

Existing tests that currently assert generic `ok` behavior must be extended so they assert:

- admission result
- blocking reason
- required user choice
- delegated runtime execution only after admission success

## Documentation Update Plan

Documentation must move with the implementation to avoid repeating the current contract/runtime drift.

### Required updates

1. `scaffold/codex/close-session/SKILL.md`

- document that runtime admission resolves or blocks open cycles before generic close execution
- describe the structured stop/decision outcomes

2. `scaffold/codex/cycle-create/SKILL.md`

- document that continuity admission is enforced before any branch or artifact creation
- clarify machine-visible decision outcomes for `R1`, `R2`, `R3`

3. `scaffold/codex/requirements-delta/SKILL.md`

- clarify the explicit admission boundary for medium/high impact ownership ambiguity

4. `scaffold/codex/handoff-close/SKILL.md`

- align the contract with the exposed runtime route and any blocking handoff-state semantics

5. `scaffold/root/AGENTS.md`

- extend the runtime admission summary beyond `start-session` and `branch-cycle-audit`
- document which skills now have admission-first behavior

6. `scaffold/docs_audit/PROJECT_WORKFLOW.md`

- update the workflow contract where cycle close/session close/continuity admission now becomes runtime-enforced

7. `docs/CHANGELOG*`

- record the remediation once implementation lands

## Delivery Sequence

Recommended implementation order:

1. consolidate shared workflow interpretation helpers
2. implement `close-session` admission
3. implement `cycle-create` admission
4. implement `requirements-delta` ownership admission
5. expose and align `handoff-close`
6. reassess `promote-baseline`, `convert-to-spike`, and `drift-check`
7. update documentation and changelog in the same merge window

## Acceptance Criteria

The remediation plan is complete when:

- confirmed gaps from the audit are enforced by runtime, not only documented
- the runtime no longer returns generic `ok` for the broken `close-session` and `cycle-create` scenarios captured in the audit
- `requirements-delta` has an explicit decision boundary for ownership ambiguity
- `handoff-close` is supported and documented consistently
- shared workflow interpretation is reused across admission paths
- fixtures/tests cover the documented blocking cases
- documentation and runtime behavior match again

## Follow-Up

After the first remediation batch:

1. rerun the gate coverage audit
2. downgrade or remove items from the watchlist only after execution-backed verification
3. decide whether a dedicated backlog file is needed for implementation tracking
