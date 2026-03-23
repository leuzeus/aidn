# Plan - Readable Generated Workflow Templates

Date: 2026-03-12
Status: completed
Scope: refactor deterministic workflow document generation so templates become easier to read and maintain, without changing the generated contract, install semantics, multi-agent wording, or DB-backed artifact visibility.

## Problem Statement

The current deterministic generation stack works, but the authoring surface is still difficult to read.

Today the main workflow rendering path combines:

- one large Markdown template
- many injected placeholders
- several section builders in code

This kept risk low during the legacy-removal work, but it now has clear drawbacks:

- template intent is harder to read in isolation
- section ownership is split between a large Markdown file and long JS string builders
- reviewing wording changes is slower than necessary
- future adapter-policy additions will compound the readability problem

The goal of this plan is not to replace deterministic generation.
The goal is to keep the current deterministic model and make the rendering system easier for humans to read, review, and extend.

## Goals

- improve readability of generated workflow templates
- keep deterministic output byte-stable unless an intentional wording change is made
- preserve the current generated contract for:
  - `docs/audit/WORKFLOW.md`
  - `docs/audit/WORKFLOW_SUMMARY.md`
  - `docs/audit/CODEX_ONLINE.md`
  - `docs/audit/index.md`
- keep promoted adapter policies visible in generated artifacts used by `dual` and `db-only`
- keep multi-agent wording and semantics intact
- reduce future need for long inline JS string builders

## Non-Goals

- no migration back to free-form Codex rendering
- no change to install ownership classes
- no change to adapter config schema unless a readability refactor strictly requires a tiny helper field
- no change to runtime admission behavior
- no change to DB import/index model

## Design Principle

Refactor the rendering surface, not the workflow contract.

That means:

1. keep `.aidn/project/workflow.adapter.json` as the durable input
2. keep generated Markdown artifacts as the consultable runtime surface
3. move from large inline code-built sections toward explicit template fragments
4. keep one deterministic assembler so output remains stable

## Current Pain Points

### 1. Large inline section builders

Files such as:

- `src/application/install/generated-doc-template-vars.mjs`

currently build long Markdown sections inline.

Consequences:

- hard to review wording changes
- mixed concerns: normalization, policy logic, and prose rendering live together
- growing maintenance cost for adapter-owned sections

### 2. Single large workflow template

Primary file:

- `scaffold/docs_audit/PROJECT_WORKFLOW.md`

Consequences:

- difficult to see which parts are canonical vs injected
- harder to isolate local policy section changes
- future additions increase template density

### 3. Review friction

For changes like:

- `Session Transition Cleanliness`
- `Execution Speed Policy`
- `Shared Codegen Boundary Gate`

reviewing the actual wording requires reading JS render code instead of a readable template fragment.

## Target Model

### 1. Keep a single deterministic assembler

Do not split generation into unrelated code paths.

Keep one render pipeline responsible for:

- loading template files
- loading fragment files
- resolving structured inputs
- assembling the final Markdown deterministically

### 2. Introduce readable fragment templates

Move long adapter-rendered sections into dedicated Markdown fragments, for example under:

- `scaffold/docs_audit/fragments/workflow/`

Candidate fragments:

- `session-transition-cleanliness.md`
- `execution-speed-policy.md`
- `shared-codegen-boundary.md`
- optional later:
  - `workflow-incident-policy.md`
  - `branch-ownership-admission.md`

Each fragment should remain human-readable Markdown with a small, explicit placeholder surface.

### 3. Keep canonical top-level template compact

`PROJECT_WORKFLOW.md` should remain the composition shell.

It should:

- preserve global order and canonical structure
- reference a small number of section placeholders
- avoid embedding long adapter-specific policy wording directly if a fragment can express it more clearly

### 4. Split normalization from prose rendering

Separate responsibilities:

- normalization/config interpretation stays in JS helpers
- prose rendering moves into readable Markdown fragments

Result:

- JS decides what data exists
- template fragments decide how that data reads

## Constraints

### Multi-Agent Constraint

The refactor must preserve the current multi-agent philosophy already aligned in the workflow system.

Required invariants:

- no regression toward single-agent wording
- explicit distinction between:
  - `session-topology`
  - `dispatch-or-local-scope`
  - shared integration surfaces
- preserved wording for:
  - attached cycles / parallel relays ambiguity
  - shared codegen overlap risk
  - session topology arbitration

### Dual / DB-Only Constraint

The refactor must not make policy JSON-only.

Required invariants:

- promoted adapter policy still renders into `WORKFLOW.md`
- generated `WORKFLOW.md` remains importable/indexable in `dual` and `db-only`
- visibility tests must still pass through SQLite-backed consultation paths

### Golden Stability Constraint

The first pass should aim for no output diff except where a wording mismatch is intentionally corrected.

If output changes:

- diff must be explicit
- test expectations must be updated intentionally
- reason must be documented

## Recommended Refactor Shape

### Phase 1 - Create fragment directory and rendering contract

Introduce a fragment structure such as:

- `scaffold/docs_audit/fragments/workflow/*.md`

Define a small loader/renderer contract:

- fragment receives a plain placeholder map
- fragment output is plain Markdown
- no fragment may perform its own file I/O or runtime logic

### Phase 2 - Extract current adapter-owned sections into fragments

First extraction targets:

- `Session Transition Cleanliness`
- `Execution Speed Policy`
- `Shared Codegen Boundary Gate`

Why:

- they are currently the least readable sections in code
- they already have structured config inputs
- they are the most likely future extension points

### Phase 3 - Reduce `generated-doc-template-vars.mjs` to data preparation

Refactor the current builder so it mainly:

- normalizes values
- computes booleans/lists
- passes a small fragment input map

Avoid long Markdown literals there after the refactor.

### Phase 4 - Keep top-level template as assembler shell

`PROJECT_WORKFLOW.md` should keep placeholders like:

- `{{SESSION_TRANSITION_CLEANLINESS_BLOCK}}`
- `{{EXECUTION_POLICY_BLOCK}}`
- `{{SHARED_CODEGEN_BOUNDARY_BLOCK}}`

But those placeholders should now be fed by fragment rendering, not large inline code strings.

### Phase 5 - Extend to other generated docs only if useful

Only refactor:

- `WORKFLOW_SUMMARY.md`
- `CODEX_ONLINE.md`
- `index.md`

if there is a clear readability win.

Do not fragment everything mechanically.

## Testing Plan

### Required tests

- existing generated-doc golden tests must still pass
- workflow adapter migration tests must still pass
- promoted workflow visibility tests for `dual` / `db-only` must still pass
- multi-agent wording tests must still pass

### Additional recommended tests

- fragment renderer test: all required placeholders resolved
- fragment renderer test: disabled sections produce empty output deterministically
- snapshot test for each fragment output with representative config

## Documentation Plan

Update docs only where needed:

1. `docs/INSTALL.md`
   - short note that generated policy sections may now come from fragment templates
2. optional contributor-facing note
   - explain where to edit readable workflow wording safely
3. no user-facing workflow contract change unless wording intentionally changes

## Risks

### Risk 1 - Template sprawl

Too many fragments can make navigation worse.

Mitigation:

- extract only long, high-value sections first
- keep file count modest

### Risk 2 - Hidden logic duplicated across fragments

Mitigation:

- keep logic in JS normalization helpers
- keep fragments declarative

### Risk 3 - Output drift during refactor

Mitigation:

- rely on golden tests
- refactor one section at a time

### Risk 4 - Broken DB-backed visibility

Mitigation:

- preserve existing visibility tests for generated workflow artifacts
- treat `WORKFLOW.md` as required runtime surface throughout the refactor

## Acceptance Criteria

The refactor is complete when:

- workflow generation remains deterministic
- current output is preserved or intentionally changed with explicit diffs
- adapter-owned policy sections are authored in readable fragment templates
- `generated-doc-template-vars.mjs` becomes materially smaller and more data-oriented
- multi-agent wording remains intact
- `dual` / `db-only` visibility tests still pass

## Recommended Delivery Order

1. create fragment rendering infrastructure
2. extract `Session Transition Cleanliness`
3. extract `Execution Speed Policy`
4. extract `Shared Codegen Boundary Gate`
5. rerun golden and visibility tests
6. optionally refactor other generated docs if there is a real gain
7. update minimal contributor/install documentation

## Recommendation

This refactor is worth doing now.

Reason:

- the risky semantic migration work is already complete
- the next bottleneck is maintainability/readability
- this can now be improved as a contained structural refactor with strong test coverage

## Outcome

Delivered in the current implementation:

- readable workflow fragments now live under `scaffold/fragments/workflow/`
- deterministic rendering still flows through a single assembler
- `generated-doc-template-vars.mjs` now prepares data and delegates long prose rendering to fragment templates
- `PROJECT_WORKFLOW.md` remains the compact composition shell
- fragment-level tests, golden tests, DB-backed visibility tests, and multi-agent wording checks all pass

Decision for remaining generated docs:

- `WORKFLOW_SUMMARY.md`: keep as-is for now
- `CODEX_ONLINE.md`: keep as-is for now
- `index.md`: keep as-is for now

Reason:

- their current generated surface is already small and readable
- fragmenting them now would increase file count without a material maintenance gain
