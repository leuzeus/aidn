# Backlog Cross-Usage Convergence - 2026-03-24

## Goal

Track the executable follow-up needed to integrate cross-usage convergence into AIDN as a validation mechanism with governance effect on shared or high-risk implementation surfaces.

Reference plan:

- `docs/PLAN_CROSS_USAGE_CONVERGENCE_2026-03-24.md`

## Backlog Items

### CUC-01 - Finalize Canonical Term And Definition

Status: completed
Priority: high

Files:

- `docs/SPEC.md`
- optional glossary or summary references if needed

Done when:

- one canonical term is selected
- one concise definition exists
- the scope boundary is explicit

Progress note:

- canonical term selected as `Cross-Usage Convergence`
- definition and scope boundary are recorded in `docs/SPEC.md` and the plan

### CUC-02 - Define Conditional Invariants In `SPEC`

Status: completed
Priority: high

Files:

- `docs/SPEC.md`

Done when:

- the principle is expressed as a conditional invariant
- single-usage validation is explicitly insufficient for shared/high-risk surfaces
- overfit-fix detection is stated clearly

Progress note:

- `docs/SPEC.md` now states the single-usage prohibition for shared/high-risk surfaces
- overfit-fix detection is explicit in both validation and invariant wording

### CUC-03 - Define `usage_matrix` Artifact Contract

Status: completed
Priority: high

Files:

- cycle artifact templates under `scaffold/docs_audit/cycles/`
- supporting audit docs if required

Done when:

- the `usage_matrix` structure is defined
- expected fields are clear
- artifact ownership is unambiguous

Progress note:

- cycle plan, traceability, and status templates now carry `usage_matrix` structure/state
- the plan template defines usage classes and evidence expectations

### CUC-04 - Integrate Matrix Requirement Into DoR / VERIFYING / DoD

Status: completed
Priority: high

Files:

- `docs/SPEC.md`
- `scaffold/docs_audit/PROJECT_WORKFLOW.md`
- cycle templates or summary docs as needed

Done when:

- DoR says when a matrix must be declared
- VERIFYING says when evidence must exist
- DoD blocks closure when required classes are missing

Progress note:

- `docs/SPEC.md` now requires a minimal matrix in DoR for shared/high-risk changes
- cycle templates now include validation closure language tied to matrix execution

### CUC-05 - Define Risk-Based Validation Profiles

Status: completed
Priority: high

Files:

- `scaffold/docs_audit/PROJECT_WORKFLOW.md`
- workflow adapter config handling if native fields are introduced

Done when:

- `LOW`, `MEDIUM`, `HIGH` profiles are defined
- shared-surface minimum profile is defined
- profile selection is practical and deterministic

Progress note:

- `docs/SPEC.md`, the plan, and the adapter policy now define shared/high-risk matrix minimums
- native adapter rendering now supports structured cross-usage defaults for shared/high-risk surfaces

### CUC-06 - Define Shared-Surface Scope Rules

Status: completed
Priority: high

Files:

- `docs/SPEC.md`
- `scaffold/docs_audit/PROJECT_WORKFLOW.md`

Done when:

- the rule names the surfaces that trigger stronger matrix requirements
- runtime, hydration, dispatch, patch, codegen, and protocol surfaces are covered where relevant

Progress note:

- shared/high-risk scope is explicit in `docs/SPEC.md` and the plan
- native adapter config can now render explicit shared-surface kinds

### CUC-07 - Add Gowire-Oriented Matrix Examples

Status: completed
Priority: medium

Files:

- `docs/PLAN_CROSS_USAGE_CONVERGENCE_2026-03-24.md`
- optional project or guide docs

Done when:

- examples exist for shared runtime fixes
- examples exist for hydration/dispatch ordering issues
- examples show nominal + alternate + context/adversarial combinations

Progress note:

- the plan now contains Gowire-oriented examples for dispatch ordering, hydration preservation, and codegen changes

### CUC-08 - Define AI Correction Guidance

Status: proposed
Priority: high

Files:

- `AGENTS.md`
- Codex workflow guidance under `scaffold/codex/` if needed

Done when:

- AI guidance says not to stop at the triggering scenario
- the usage matrix is referenced as a convergence guardrail
- overfit remediation behavior is explicit

### CUC-09 - Decide Native Config / Template Representation

Status: completed
Priority: medium

Files:

- `src/lib/config/workflow-adapter-config-lib.mjs`
- `src/application/install/generated-doc-template-vars.mjs`
- `src/application/project/imported-sections-policy-lib.mjs`

Done when:

- it is clear whether cross-usage policy stays documentation-level
- or becomes a first-class adapter config field

Progress note:

- cross-usage convergence is now a first-class adapter config/rendering surface under `specializedGates.crossUsageConvergence`
- migration/import policy also recognizes the section as adapter-structured

### CUC-10 - Define Runtime / Tooling Follow-Up

Status: proposed
Priority: medium

Files:

- runtime admission and verification planning docs
- optional future tooling docs

Done when:

- the automation path is explicit
- manual-first operation remains valid
- touched-surface to matrix-profile mapping is identified

## Recommended Execution Order

1. `CUC-01`
2. `CUC-02`
3. `CUC-03`
4. `CUC-04`
5. `CUC-05`
6. `CUC-06`
7. `CUC-08`
8. `CUC-09`
9. `CUC-07`
10. `CUC-10`

## Initial Product Recommendation

- treat `CUC-01` to `CUC-06` as the minimum lot for first integration
- keep `CUC-09` and `CUC-10` as second-step productization unless immediate runtime enforcement is desired
