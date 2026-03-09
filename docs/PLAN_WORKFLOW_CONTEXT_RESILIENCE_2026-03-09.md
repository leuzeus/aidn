# Plan Workflow Context Resilience - 2026-03-09

## Objective

Improve the installed `aidn` workflow so it remains robust when an AI assistant loses, ignores, or partially reloads context.

This plan is explicitly scoped to the repository structure **after installation**:

- `AGENTS.md`
- `docs/audit/SPEC.md`
- `docs/audit/WORKFLOW_SUMMARY.md`
- `docs/audit/WORKFLOW.md`
- `docs/audit/baseline/*`
- `docs/audit/snapshots/*`
- `docs/audit/sessions/*`
- `docs/audit/cycles/*`
- `.aidn/runtime/context/*` in `dual` / `db-only`

The package repository remains the implementation source, but the target workflow behavior is the installed client layout produced from `template/*`.

## Scope

In scope:

- fast workflow re-anchoring after context loss
- minimal context reload ergonomics
- stronger pre-write discipline for assistants
- explicit support for long sessions and partial reloads
- explicit guardrails for `apply_patch` in recent Codex Windows app flows
- progressive documentation and template changes compatible with current `SPEC-R01..R11`

Out of scope:

- rewriting the whole workflow
- removing current cycle/session/baseline/snapshot concepts
- changing canonical rule ownership away from `SPEC.md`
- introducing remote services or a different runtime model

## Problem Summary

Current workflow strengths:

- clear canonical rule ownership (`SPEC.md`)
- explicit adapter boundary (`WORKFLOW.md`)
- explicit state boundary (`snapshot`, `baseline`, `sessions`, `cycles`)
- robust `dual` / `db-only` runtime chain

Current resilience weaknesses:

1. Quick reload still requires too much reading before action.
2. No single human-readable "current state" artifact consolidates the active operational context.
3. Decisions, hypotheses, and open change requests remain too easy to miss during partial reload.
4. The workflow lacks a very short re-anchor kernel for assistants with degraded memory.
5. The workflow does not yet define a strong enough **pre-write gate** for local AI tools.
6. `apply_patch` in recent Codex Windows app usage can reduce friction to edit before the workflow context is fully reloaded.

## Design Constraints

- Keep compatibility with the current workflow philosophy.
- Keep `SPEC.md` as canonical owner of mechanics.
- Keep `WORKFLOW.md` as adapter extension only.
- Do not move reusable rule prose into state artifacts.
- Prefer additive, progressive changes over structural replacement.

## Target Outcome

After this plan:

- an assistant can re-anchor in less than one minute using a minimal file set
- installed repositories expose a compact operational state artifact
- assistants are blocked from durable writes when workflow context is incomplete
- `apply_patch` is treated as a special case of durable write, not as an exception path
- `dual` / `db-only` runtime context becomes easier to consume without rereading scattered docs
- long-session and future multi-agent handoff becomes easier

## Proposed Deliverables

### D1 - Add `WORKFLOW-KERNEL.md`

Purpose:

- shortest safe workflow entry point
- intended for assistants that lost context

Expected content:

- minimal read order
- hard stop rules
- "no plan, no write" reminder
- explicit branch/cycle ambiguity stop rule

Target template path:

- `template/docs_audit/WORKFLOW-KERNEL.md`

### D2 - Add `CURRENT-STATE.md`

Purpose:

- consolidate the active operational state in one place

Expected content:

- `active_session`
- `active_cycle`
- `branch_kind`
- `dor_state`
- `runtime_state_mode`
- top active decisions
- top active hypotheses
- open gaps
- open CRs
- next actions

Target template path:

- `template/docs_audit/CURRENT-STATE.md`

### D3 - Add `REANCHOR_PROMPT.md`

Purpose:

- standardize context recovery for assistants with partial memory

Expected content:

- mandatory read list
- mandatory explicit restatement before any write
- stop condition when required fields are unknown

Target template path:

- `template/docs_audit/REANCHOR_PROMPT.md`

### D4 - Add `ARTIFACT_MANIFEST.md`

Purpose:

- map each workflow concern to the artifact where it lives

Expected content:

- where to read current state
- where to read decisions
- where to read hypotheses
- where to read change requests
- where to read traceability
- where to read runtime repair signals

Target template path:

- `template/docs_audit/ARTIFACT_MANIFEST.md`

### D5 - Strengthen `AGENTS.md` with a Pre-Write Gate

Purpose:

- block durable writes when workflow context is incomplete

Required checks before write:

- mode
- branch kind
- active cycle when `COMMITTING`
- `dor_state`
- first implementation step from `plan.md`
- workflow artifacts verified
- runtime context checked in `dual` / `db-only`

Durable write examples:

- `apply_patch`
- direct file edits
- generated file creation
- mutating scripts

Target template path:

- `template/root/AGENTS.md`

### D6 - Update `WORKFLOW_SUMMARY.md` and `index.md`

Purpose:

- point assistants to the new minimal reload path

Changes:

- reference `WORKFLOW-KERNEL.md`
- reference `CURRENT-STATE.md`
- shorten the first-entry guidance

Target template paths:

- `template/docs_audit/WORKFLOW_SUMMARY.md`
- `template/docs_audit/index.md`

## `apply_patch` Specific Policy

Observed context:

- `apply_patch` is available in recent Codex Windows application flows.
- Its main risk is not correctness of diff application.
- Its main risk is reducing the cost of writing before workflow re-anchoring is complete.

Policy direction:

- treat `apply_patch` as a **durable write operation**
- do not prohibit it globally
- require the same pre-write gate as any other durable write
- add stricter guidance when the requested change touches:
  - workflow files
  - structure
  - sessions
  - cycles
  - snapshots
  - baseline
  - hypotheses
  - decisions
  - traceability

Expected wording direction:

- `apply_patch` authorized only after minimal workflow audit
- `apply_patch` refused when workflow context is missing, ambiguous, or contradictory
- if context is incomplete, continue with read-only re-anchor steps only

## Phased Rollout

### Phase 1 - Minimal Re-Anchor Artifacts

Goal:

- reduce reload cost without changing workflow mechanics

Changes:

- add `WORKFLOW-KERNEL.md`
- add `CURRENT-STATE.md`
- add `REANCHOR_PROMPT.md`

Acceptance criteria:

- installed repo exposes a minimal entrypoint shorter than `WORKFLOW_SUMMARY.md`
- an assistant can identify next action without opening `SPEC.md` first

### Phase 2 - Pre-Write Discipline

Goal:

- prevent non-reanchored writes

Changes:

- add `Pre-Write Gate` section to `AGENTS.md`
- add `No Plan, No Write` wording to kernel/summary
- add `apply_patch` guidance

Acceptance criteria:

- durable write conditions are explicit
- workflow ambiguity leads to stop-and-read behavior

### Phase 3 - Consolidated Operational State

Goal:

- reduce artifact scattering during resume

Changes:

- define the content model of `CURRENT-STATE.md`
- reference cycle/session/runtime signals

Acceptance criteria:

- active cycle, DoR, runtime mode, and top open items are visible in one file

### Phase 4 - Runtime Digest For `dual` / `db-only`

Goal:

- make DB-backed context usable by assistants without re-reading multiple runtime files

Changes:

- expose runtime digest fields in `CURRENT-STATE.md` or a dedicated runtime digest artifact

Acceptance criteria:

- `repair_layer_status` and blocking findings are surfaced in the minimal operational context

### Phase 5 - Long Session / Multi-Agent Readiness

Goal:

- prepare handoff and restart scenarios

Changes:

- define a lightweight handoff packet based on:
  - `WORKFLOW-KERNEL.md`
  - `CURRENT-STATE.md`
  - active cycle `status.md`
  - active session file

Acceptance criteria:

- another assistant can resume from a deterministic handoff set

## Risks

- too much new documentation could recreate the same reload burden we want to reduce
- a weakly maintained `CURRENT-STATE.md` would become misleading
- over-constraining trivial doc-only work could introduce unnecessary friction
- `apply_patch` wording must stay tool-agnostic enough to remain useful outside one Codex client

## Mitigations

- keep new files short and role-specific
- ensure `CURRENT-STATE.md` remains summary-only, not a duplicate of full state
- scope strict pre-write checks to durable writes, especially `COMMITTING`
- keep canonical rules in `SPEC.md`; new files only summarize and route

## Suggested First Implementation Order

1. add `WORKFLOW-KERNEL.md`
2. add `CURRENT-STATE.md`
3. add `REANCHOR_PROMPT.md`
4. update `WORKFLOW_SUMMARY.md`
5. update `index.md`
6. update `AGENTS.md` with `Pre-Write Gate`
7. add `ARTIFACT_MANIFEST.md`

