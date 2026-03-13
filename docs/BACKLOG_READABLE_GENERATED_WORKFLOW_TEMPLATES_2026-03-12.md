# Backlog Readable Generated Workflow Templates - 2026-03-12

## Goal

Track concrete implementation work to make deterministic generated workflow templates easier to read and maintain, without changing workflow behavior or breaking `dual` / `db-only` consultation paths.

Reference plan:

- `docs/PLAN_READABLE_GENERATED_WORKFLOW_TEMPLATES_2026-03-12.md`

## Backlog Items

### RGT-01 - Define Fragment Directory And Naming Contract

Status: completed
Priority: high

Files:

- `template/docs_audit/fragments/workflow/*`
- renderer service files
- contributor docs if needed

Why:

- readability improves only if fragment organization is predictable

Done when:

- a fragment directory exists for workflow-generated sections
- naming is explicit and stable
- fragment purpose is obvious from filename alone

### RGT-02 - Add Fragment Loader To Deterministic Renderer

Status: completed
Priority: high

Files:

- `src/application/install/generated-doc-render-service.mjs`
- helper files as needed
- tests

Why:

- the renderer needs a native way to assemble readable fragments without changing output semantics

Done when:

- fragment files can be loaded deterministically
- fragment rendering is driven by explicit placeholder maps
- unresolved placeholders still fail hard

### RGT-03 - Separate Data Preparation From Prose Rendering

Status: completed
Priority: high

Files:

- `src/application/install/generated-doc-template-vars.mjs`
- optional helper libs
- tests

Why:

- normalization logic and long prose should no longer be tightly coupled

Done when:

- data normalization remains in JS
- long Markdown section strings are materially reduced in JS
- the remaining JS code is primarily data-oriented

### RGT-04 - Extract `Session Transition Cleanliness` Into A Readable Fragment

Status: completed
Priority: high

Files:

- workflow fragment templates
- render helpers
- tests

Why:

- this section is long enough to justify a dedicated readable template

Done when:

- the section is rendered from a fragment file
- wording remains compatible with multi-cycle session topology
- golden output remains stable unless intentionally changed

### RGT-05 - Extract `Execution Speed Policy` Into A Readable Fragment

Status: completed
Priority: high

Files:

- workflow fragment templates
- render helpers
- tests

Why:

- this is the densest adapter-owned policy block and currently the hardest to review in JS

Done when:

- the section is rendered from a fragment file
- hard/light gates, fast path, and escalation wording remain intact
- multi-agent dispatch-scope wording is preserved

### RGT-06 - Extract `Shared Codegen Boundary Gate` Into A Readable Fragment

Status: completed
Priority: high

Files:

- workflow fragment templates
- render helpers
- tests

Why:

- this section contains important shared-surface policy and should be readable in template form

Done when:

- the section is rendered from a fragment file
- required evidence and hard-stop wording remain intact
- shared integration surface wording is preserved

### RGT-07 - Keep `PROJECT_WORKFLOW.md` As A Compact Composition Shell

Status: completed
Priority: medium

Files:

- `template/docs_audit/PROJECT_WORKFLOW.md`
- tests

Why:

- the top-level template should stay understandable without duplicating fragment internals

Done when:

- `PROJECT_WORKFLOW.md` keeps section ordering and composition placeholders
- long adapter-specific prose is removed from the top-level shell where fragments now own it

### RGT-08 - Add Fragment-Level Rendering Tests

Status: completed
Priority: medium

Files:

- `tools/perf/*`
- fixture outputs

Why:

- fragment rendering should fail fast before whole-document regressions appear

Done when:

- each fragment can be rendered from representative config inputs
- unresolved placeholders fail tests
- disabled fragments render empty output deterministically

### RGT-09 - Re-verify Golden Stability For Generated Docs

Status: completed
Priority: high

Files:

- golden tests
- fixture outputs if intentionally updated

Why:

- readability refactor must not create accidental wording drift

Done when:

- `WORKFLOW.md` golden tests pass
- `WORKFLOW_SUMMARY.md`, `CODEX_ONLINE.md`, and `index.md` golden tests still pass
- any intentional diff is explicit and documented

### RGT-10 - Re-verify DB-Backed Visibility For Promoted Policy

Status: completed
Priority: high

Files:

- visibility tests
- install/import fixtures

Why:

- readable templates must not break `dual` / `db-only` artifact consultation

Done when:

- promoted sections remain visible in generated `WORKFLOW.md`
- promoted sections remain visible in SQLite-backed imported artifacts

### RGT-11 - Re-verify Multi-Agent Wording Stability

Status: completed
Priority: high

Files:

- multi-agent policy tests
- fragment render tests

Why:

- template readability work must not regress the current multi-agent philosophy

Done when:

- `session-topology` wording remains intact
- `dispatch-or-local-scope` wording remains intact
- shared integration surface and overlap-risk wording remains intact

### RGT-12 - Decide Whether Other Generated Docs Need Fragmentation

Status: completed
Priority: low

Files:

- `WORKFLOW_SUMMARY.md`
- `CODEX_ONLINE.md`
- `index.md`

Why:

- not every generated file needs the same treatment

Done when:

- an explicit decision is recorded for each remaining generated doc:
  - keep as-is
  - lightly refactor
  - fragment further

Decision recorded:

- `WORKFLOW_SUMMARY.md`: keep as-is
- `CODEX_ONLINE.md`: keep as-is
- `index.md`: keep as-is

Reason:

- these files are already short and readable in their current deterministic form
- further fragmentation would add structure without meaningful review or maintenance benefit

### RGT-13 - Document The Contributor Editing Surface

Status: completed
Priority: medium

Files:

- `docs/INSTALL.md`
- optional contributor doc

Why:

- once readable fragments exist, contributors need to know where wording should be edited

Done when:

- docs explain where generated workflow wording lives
- docs explain that runtime-visible policy still comes from generated artifacts, not ad hoc edits

## Result

Backlog completed.

## Recommended First Executable Lot

1. `RGT-01`
2. `RGT-02`
3. `RGT-03`
4. `RGT-04`

## Recommended Second Lot

1. `RGT-05`
2. `RGT-06`
3. `RGT-07`
4. `RGT-08`

## Recommended Third Lot

1. `RGT-09`
2. `RGT-10`
3. `RGT-11`
4. `RGT-12`
5. `RGT-13`

## Open Questions

- should fragment rendering remain inline within the current render service, or gain a small dedicated helper module?
- should fragment tests be snapshot-style only, or also assert specific semantic anchors for multi-agent wording?
- is there any generated doc beyond `WORKFLOW.md` that is truly hard enough to read to justify further fragmentation?
