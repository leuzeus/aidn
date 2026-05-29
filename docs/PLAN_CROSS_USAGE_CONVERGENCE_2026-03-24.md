# Plan Cross-Usage Convergence - 2026-03-24

Date: 2026-03-24
Status: completed
Scope: define, position, and operationalize a cross-usage stabilization principle in AIDN so shared or high-risk implementations cannot converge on a single usage only.

## Objective

Integrate a clear and enforceable principle stating that implementation stability increases when the same behavior is validated through multiple independent usages.

The goal is not to add more tests mechanically.
The goal is to add a convergence mechanism that rejects solutions overfitted to one scenario.

## Problem Statement

AIDN already regulates entropy through:

- DoR and adaptive readiness
- audit-driven validation
- invariants and stop gates
- cycle continuity and drift control

But one important gap remains:

- the current model does not explicitly require an implementation to survive multiple usage classes before being considered stable

Observed consequence:

- a fix can pass a local trigger case
- preserve line or branch coverage
- and still remain too specific to one business flow, one context, or one execution ordering

This is especially relevant for shared surfaces such as:

- runtime
- hydration
- dispatch
- patch/mutation pipeline
- code generation
- protocol and shared contracts

## Goals

- define a precise AIDN-compatible name and vocabulary for the principle
- place the principle correctly in the model as validation-first with governance effects
- define a practical usage typology
- define enforceable invariants for shared or high-risk implementation surfaces
- define a lightweight operational rule for DoR / VERIFYING / DoD
- define how AI-assisted correction should use the principle to avoid code overfitting

## Non-Goals

- do not turn every local change into a large scenario matrix
- do not replace existing unit, integration, or regression tests
- do not introduce a universal invariant requiring the same number of usages for every change
- do not create a combinatorial validation policy

## Proposed Term

Recommended term:

- `Cross-Usage Convergence`

Working definition:

- an implementation reaches cross-usage convergence when it satisfies a minimal set of independent usage classes that impose non-redundant constraints on the same behavior surface

## Position In The AIDN Model

Primary classification:

- validation mechanism

Secondary classifications:

- convergence mechanism
- governance policy for shared implementation surfaces

Recommended placement:

- `SPEC`: principle definition and conditional invariant
- `WORKFLOW`: adapter-level operationalization and project risk profile
- `DoR`: require a declared `usage_matrix` for shared/high-risk changes
- `VERIFYING` / `DoD`: require evidence that the relevant usage classes were exercised

## Usage Typology

The usage matrix should use classes, not arbitrary scenario multiplication.

### U1 - Primary Nominal Usage

Purpose:

- prove the intended scenario still works

### U2 - Alternate Business Usage

Purpose:

- force the implementation to satisfy another legitimate caller or component shape

### U3 - Context Variation

Purpose:

- force stability across execution environments or lifecycle contexts

Examples:

- SSR vs hydration
- sync vs async completion
- ordered vs out-of-order completion

### U4 - Input Variation

Purpose:

- vary payload, value shape, size, or optionality without changing the main business intent

### U5 - Edge Usage

Purpose:

- validate boundary conditions and partial states

### U6 - Adversarial Usage

Purpose:

- validate explicit stress or failure patterns that often reveal overfitting

Examples:

- retry after failure
- stale revision
- rapid dispatch burst
- conflicting concurrent updates

## Priority Heuristic

By stabilization value, the default order is:

1. alternate business usage
2. context variation
3. edge usage
4. input variation
5. adversarial usage when the surface is shared or concurrency-sensitive

For Gowire-like shared runtime work, context and adversarial usages are often mandatory.

## Gowire-Oriented Examples

### Example 1 - Shared Dispatch Ordering Fix

Touched surface:

- shared dispatch/runtime ordering

Minimum matrix:

- nominal: standard dispatch completes in order
- alternate: second component or caller uses the same dispatch path
- adversarial: out-of-order completion or retry-after-failure does not apply stale result

Expected evidence:

- targeted runtime tests
- ordering or stale-revision test
- one cross-component/shared-surface scenario

### Example 2 - Hydration Preservation Fix

Touched surface:

- shared hydration or mutation patch path

Minimum matrix:

- nominal: primary component hydrates and preserves expected interaction
- alternate: another component using the same shared helper hydrates correctly
- context: SSR output and hydration behavior remain aligned

Expected evidence:

- SSR validation
- hydration validation
- one second component or page path using the same helper

### Example 3 - Codegen Contract Change

Touched surface:

- generator or shared generated bridge

Minimum matrix:

- nominal: intended generated component path still works
- alternate: another generated component or manifest path still compiles/renders
- edge/context: generated output remains valid under the relevant runtime mode or compatibility path

Expected evidence:

- generator-level validation
- at least one alternate generated target
- explicit note when the change touches a shared integration surface

## Tooling Direction

Manual-first operation remains valid.

Recommended future automation path:

- infer a default matrix profile from touched surfaces
- suggest canonical scenarios before generating new ones
- reuse existing tests as matrix evidence whenever possible
- escalate automatically when shared surfaces or concurrency-sensitive paths are touched

Touched-surface to default profile mapping:

| Touched surface | Default profile |
|---|---|
| isolated local feature | nominal only or nominal + edge |
| shared component/helper | nominal + alternate |
| runtime/hydration/dispatch | nominal + alternate + context/adversarial |
| codegen/protocol/migration | nominal + alternate + context |

## Proposed Invariants

### CUC-01 - No Single-Usage Stability Claim

A shared or high-risk implementation must not be declared stable when validated by only one usage class.

### CUC-02 - Independent Constraint Requirement

At least one non-primary usage must exercise a constraint that is meaningfully different from the nominal path.

### CUC-03 - Overfit Fix Detection

A fix that resolves the triggering scenario while degrading another declared usage class is classified as overfitted and cannot pass DoD.

### CUC-04 - Shared Surface Minimum

Any change touching a shared integration surface must validate:

- one nominal usage
- one alternate usage
- one context or edge/adversarial usage relevant to the risk profile

## Operational Rule

Introduce a `usage_matrix` concept in cycle validation planning.

Minimum rule:

- local isolated change: `1` usage class may be sufficient
- shared or medium-risk change: `2` usage classes minimum
- shared runtime, hydration, dispatch, codegen, migration, or concurrency-sensitive change: `3` usage classes minimum

The rule should be risk-adaptive, not uniform.

## Workstreams

### 1. Define The Principle In Canonical AIDN Vocabulary

Tasks:

- choose the final term
- define the principle in concise normative language
- define its scope boundary
- define conditional invariants

Acceptance:

- a canonical wording exists
- the wording is compatible with existing `SPEC-R01..R11` mechanics
- the wording does not imply a universal heavy process

### 2. Add Operational Placement In Workflow Artifacts

Tasks:

- define where `usage_matrix` belongs in cycle artifacts
- define when it becomes mandatory
- define how it affects DoR and DoD
- define stop conditions for missing matrix or missing evidence

Acceptance:

- a cycle owner can determine whether the matrix is required
- the rule is actionable during `IMPLEMENTING` and `VERIFYING`

### 3. Add Risk-Based Matrix Profiles

Tasks:

- define default matrix profiles for `LOW`, `MEDIUM`, `HIGH`
- define a mandatory shared-surface profile
- define examples for Gowire-style runtime/hydration/dispatch changes

Acceptance:

- the risk profile selects validation depth without ambiguity
- no combinatorial matrix is required

### 4. Define AI Interaction Rules

Tasks:

- define how AI correction uses the usage matrix to avoid local patching bias
- define when an AI should expand from targeted fix to generalized fix
- define the evidence expected when a fix is declared generic

Acceptance:

- the principle improves convergence behavior, not only documentation
- overfit fixes are easier to identify in review and runtime gates

### 5. Prepare Tooling Direction

Tasks:

- define whether matrix generation can be partially automated
- define reuse rules for existing tests and scenarios
- define how scenario classes can be inferred from touched surfaces

Acceptance:

- the path to implementation is clear even if tooling lands later
- manual operation remains possible before full automation

## Risks

### Risk 1 - Over-application

Problem:

- the rule could create unnecessary overhead on narrow low-risk changes

Mitigation:

- keep the invariant conditional
- apply strict minimums only to shared or high-risk surfaces

### Risk 2 - Redundant Matrices

Problem:

- multiple scenarios may look different but still exercise the same constraint shape

Mitigation:

- reason in usage classes, not scenario count
- require non-redundant constraints

### Risk 3 - False Robustness

Problem:

- teams may claim convergence because several tests pass, even though they are all variants of one path

Mitigation:

- require explicit declaration of constraint difference per usage class

### Risk 4 - Maintenance Cost

Problem:

- every new change could accumulate scenario burden

Mitigation:

- reuse canonical matrices for shared surfaces
- add new classes only when they close a real blind spot

## Acceptance Criteria

This plan is complete when:

- AIDN has a clear canonical term and definition for the principle
- the principle is positioned as validation-first with governance effect
- conditional invariants are defined
- a risk-based `usage_matrix` rule exists
- the integration path into `SPEC`, `WORKFLOW`, and cycle validation artifacts is explicit
- the AI convergence effect is described in operational terms

## Recommended Delivery Order

1. define canonical term and invariants
2. define `usage_matrix` operational rule
3. define risk-based profiles
4. map the principle into workflow artifacts
5. define AI behavior and tooling direction

## Recommendation

Proceed with integration.

Recommended product stance:

- make `Cross-Usage Convergence` a validation doctrine in AIDN
- enforce it as a conditional invariant on shared or high-risk implementation surfaces
- expose it in project adapters as a risk-based validation policy, not as a blanket rule

## Outcome

Completed integration in this lot:

- canonical term, DoR rule, validation convergence rule, and conditional invariants added to `docs/SPEC.md`
- `usage_matrix` contract added to cycle plan, status, and traceability templates
- structured adapter rendering added through `specializedGates.crossUsageConvergence`
- migration/import policy updated so the adapter section is treated as native structured policy
- agent and skill guidance updated to reject overfit fixes and maintain the matrix during cycle close and requirements deltas
