# Plan - Imported Sections Native Migration

Date: 2026-03-12
Status: completed
Scope: eliminate `legacyPreserved.importedSections` from project adapter configs by promoting retained content either into canonical `aidn` workflow documentation or into first-class structured adapter fields, without losing any effective project policy.

## Problem Statement

`importedSections` currently acts as a compatibility bucket for legacy project workflow prose that was not yet modeled in the deterministic adapter format.

This solves immediate data-loss risk, but it has three long-term drawbacks:

- generated `WORKFLOW.md` still depends on opaque legacy text blocks
- canonical `aidn` rules and project-local extensions can drift or duplicate each other
- the adapter config remains partially legacy-shaped, which blocks the goal of a fully deterministic, non-legacy project workflow model

For `gowire`, `importedSections` still contains several meaningful policy blocks. Some are now redundant with `aidn` core workflow rules. Others are still useful project-specific extensions. A few are strong candidates for structured promotion.

The target is not to delete legacy text aggressively. The target is to retire `importedSections` only after every retained rule has a native home.

## Goals

- remove dependency on `legacyPreserved.importedSections` for active project policy
- preserve all still-useful `gowire` workflow rules during migration
- distinguish canonical workflow rules from project adapter rules
- promote reusable rules only when they are truly generic
- promote project-only rules into explicit adapter schema instead of opaque prose
- keep `WORKFLOW.md` deterministic after migration

## Non-Goals

- no lossy cleanup of legacy content
- no forced promotion of project-specific rules into `docs/SPEC.md`
- no immediate runtime enforcement for every promoted policy block
- no rewrite of baseline, snapshot, or cycle/session data in this migration

## Multi-Agent Alignment Addendum

`aidn` is intended to support multi-agent operation.
This migration must therefore follow the same philosophy already established in:

- `docs/PLAN_MULTI_AGENT_MULTI_CYCLE_RUNTIME_2026-03-09.md`
- `docs/PLAN_MULTI_AGENT_INTEGRATION_COLLISION_POLICY_2026-03-09.md`

This means:

- session topology may be plural
- execution scope must stay explicit and narrow
- project adapter policy must not collapse session-wide topology and dispatch-level focus into one field
- any promoted adapter policy must remain compatible with relays, coordinator decisions, and multi-cycle integration strategy

### Multi-Agent Design Constraints For This Migration

1. Do not model project policy as if one session always means one active cycle.
2. Do not model optimization policy as if a local fast path is safe without considering parallel agent work.
3. Keep session-level policy separate from dispatch/handoff-level execution scope.
4. Reuse existing multi-agent vocabulary and concepts already adopted by `aidn`:
   - `attached_cycles`
   - `integration_target_cycles`
   - `primary_focus_cycle`
   - explicit relay/dispatch scope
5. Do not introduce a second continuity or integration model in adapter config.

### Multi-Agent Consequences By Promoted Policy

#### Session Transition Cleanliness Gate

Promotion of this gate must consider not only orphan local cycle artifacts, but also unresolved relay or handoff residue relevant to the current session topology.

Native target behavior:

- gate evaluates the session context as potentially multi-cycle
- gate must not assume a single active cycle
- when other agent-owned or relay-owned artifacts are still unresolved, the policy should require explicit arbitration before opening a new session branch

#### Execution Policy

Execution optimization policy must be interpreted at the narrowest valid execution scope, not as a blanket session-wide shortcut.

Native target behavior:

- fast-path eligibility is evaluated for a concrete dispatch scope or local execution scope
- when several attached cycles or parallel relays exist, optimization policy must escalate conservatively if shared surfaces are touched
- shared runtime, shared codegen, or high-collision integration surfaces must disable or narrow fast-path behavior

#### Shared Codegen Boundary Gate

This gate is especially sensitive in a multi-agent system because the generator and generated bridge outputs are shared integration surfaces.

Native target behavior:

- documentation must treat shared codegen boundary changes as high-collision surfaces
- if several active cycles or relays touch generator or generated bridge outputs, integration risk should be considered elevated by default
- later runtime support, if added, should follow the existing multi-agent collision philosophy rather than invent a local special case

### Additional Migration Acceptance Criteria

- no promoted adapter field assumes singular session ownership where `aidn` already supports multi-cycle sessions
- execution policy rendering distinguishes session policy from dispatch-scope decision logic
- promoted specialized gates do not conflict with existing multi-agent integration and handoff plans
- `gowire` migration outcome remains compatible with future relay/coordinator runtime work

## Dual / DB-Only Artifact Addendum

`aidn` must continue to operate correctly in `dual` and `db-only` modes.
This means promoted adapter policy cannot live only as durable JSON configuration.

The runtime and assistants still rely on workflow artifacts being consultable through the indexed artifact layer, including when the effective store is DB-backed.

### Consequences For This Migration

1. `.aidn/project/workflow.adapter.json` remains the durable structured source of truth.
2. Promoted policy must still be rendered into deterministic workflow artifacts, especially `docs/audit/WORKFLOW.md`.
3. No promotion may remove effective policy visibility from the artifact import/index path used in `dual` or `db-only`.
4. Structured adapter fields may later gain direct projections, but that is additive; the rendered workflow artifact remains required for compatibility and inspectability.

### Operational Rule

For the purposes of this migration:

- `workflow.adapter.json` is the durable edit surface
- generated `WORKFLOW.md` is the consultable/indexable runtime surface

Any promoted policy is incomplete until both surfaces stay coherent.

## Current Imported Sections in `gowire`

`gowire` currently stores these legacy imported blocks:

1. `Session Transition Cleanliness Gate`
2. `Incident Trigger Conditions`
3. `Noise Control (Anti-Noise)`
4. `Temporary Incident Tracking File`
5. `Authorization Gate`
6. `Workflow Self-Improvement Scope`
7. `Resume and Cleanup`
8. `Execution Speed Policy`
9. `Gate classes: Hard vs Light`
10. `Fast Path for micro-changes`
11. `Risk-based validation profile`
12. `Rule Set (choose exactly one)`
13. `Mode mapping`
14. `Interactive Stop Prompt`
15. `Shared Codegen Boundary Gate`

## Assessment

### A. Already Native in `aidn` and therefore legacy duplication

These blocks no longer need to live as imported legacy prose because their substance already exists in core workflow docs and runtime behavior:

- `Incident Trigger Conditions`
- `Noise Control (Anti-Noise)`
- `Temporary Incident Tracking File`
- `Authorization Gate`
- `Workflow Self-Improvement Scope`
- `Resume and Cleanup`
- `Rule Set (choose exactly one)`
- `Mode mapping`
- `Interactive Stop Prompt`

Evidence already exists in:

- `docs/SPEC.md`
- `template/docs_audit/PROJECT_WORKFLOW.md`
- `template/docs_audit/CONTINUITY_GATE.md`
- `template/docs_audit/incidents/TEMPLATE_INC_TMP.md`
- runtime admission logic for continuity selection

Conclusion:

- these blocks should be removed from `importedSections`
- before removal, wording gaps must be checked and, if needed, covered by small template/core doc updates

### B. Valuable project-local policy that should become first-class adapter config

These blocks are still useful, but they are not universal workflow canon:

- `Session Transition Cleanliness Gate`
- `Execution Speed Policy`
- `Gate classes: Hard vs Light`
- `Fast Path for micro-changes`
- `Risk-based validation profile`
- `Shared Codegen Boundary Gate`

Conclusion:

- these blocks should not stay as opaque imported prose
- they should be promoted into explicit adapter schema fields and rendered deterministically

### C. Rules that may later justify runtime support, but not necessarily in this migration

These are operationally important enough to consider future runtime support:

- `Session Transition Cleanliness Gate`
- `Execution Speed Policy`
- `Shared Codegen Boundary Gate`

Conclusion:

- first migration step is deterministic documentation/config promotion
- runtime enforcement can be planned later, only where the signal-to-complexity ratio is good

## Recommended Native Target Model

### 1. Canonical Core Rules

Remain owned by `aidn` core docs and runtime:

- incident lifecycle and severity model
- continuity rule definitions `R1/R2/R3`
- continuity prompt semantics
- authorization concept for high-severity workflow incidents

These should live in:

- `docs/SPEC.md`
- installed canonical support docs under `template/docs_audit/`

### 2. First-Class Adapter Fields

Add structured adapter support for project-local retained policy.

Recommended new adapter sections:

```json
{
  "sessionPolicy": {
    "transitionCleanliness": {
      "enabled": true,
      "scope": "session-topology",
      "requiredDecisionOptions": [
        "adopt-to-current-session",
        "archive-non-retained",
        "drop-with-rationale"
      ]
    }
  },
  "executionPolicy": {
    "enabled": true,
    "evaluationScope": "dispatch-or-local-scope",
    "escalateOnParallelAttachedCycles": true,
    "escalateOnSharedIntegrationSurface": true,
    "hardGates": [
      "branch-cycle-mapping",
      "continuity-rule-selection",
      "stop-conditions",
      "session-close-validity"
    ],
    "fastPath": {
      "enabled": true,
      "maxTouchedFiles": 2,
      "forbidApiContractSchemaSecurityChange": true,
      "forbidSharedCodegenBoundaryImpact": true,
      "requireNoContinuityAmbiguity": true
    },
    "validationProfiles": {
      "low": "...",
      "medium": "...",
      "high": "..."
    }
  },
  "specializedGates": {
    "sharedCodegenBoundary": {
      "enabled": true,
      "sharedIntegrationSurface": true,
      "escalateOnMultiAgentOverlap": true,
      "generatorPaths": [
        "internal/builder/engines/components.go",
        "internal/components/manifest.json",
        "web/ce/elements.js"
      ],
      "requiredEvidence": [
        "decisions.md",
        "traceability.md"
      ],
      "forbidComponentSpecificGeneratorFixes": true
    }
  }
}
```

The exact schema can be adjusted, but the principle should hold:

- structured booleans and enumerations for behavior
- short text fields only where explanation must remain project-specific
- no return to opaque full-section storage for active policy
- no field should encode multi-agent execution assumptions that conflict with the existing runtime plans

### 3. Deterministic Rendering

Update generated `WORKFLOW.md` rendering so these fields produce native adapter sections directly, without relying on `importedSections`.

That keeps:

- stable wording
- deterministic reinstall behavior
- explicit project policy ownership
- DB-consultable workflow policy in `dual` / `db-only` through the normal artifact import/index path

## Migration Strategy by Block

### Block Group 1 - Remove duplicate legacy by alignment

Blocks:

- incident-related sections
- continuity prompt/selection sections

Action:

1. compare `gowire` wording against installed canonical wording
2. identify any missing nuance
3. if nuance matters and is generic, update canonical docs/templates
4. once parity is reached, stop rendering these blocks from `importedSections`

Expected result:

- no project policy loss
- less duplication
- no adapter schema expansion for rules already owned by core

### Block Group 2 - Promote retained project policy into adapter schema

Blocks:

- `Session Transition Cleanliness Gate`
- `Execution Speed Policy`
- `Hard vs Light`
- `Fast Path`
- `Risk-based validation profile`
- `Shared Codegen Boundary Gate`

Action:

1. define schema additions in `workflow.adapter.json`
2. align field semantics with the existing multi-agent runtime and integration-collision plans
3. write deterministic render helpers for those sections
4. migrate `gowire` values from `importedSections` into the new structured fields
5. regenerate `WORKFLOW.md`
6. verify semantic parity with prior rendered output

Expected result:

- imported legacy prose is replaced by first-class adapter data
- the rendered file stays stable across reinstall/reinit
- promoted policy remains compatible with multi-agent topology and relay/coordinator evolution

### Block Group 3 - Remove legacy carrier when empty

Action:

1. once all duplicate and promoted blocks have native homes, stop writing `legacyPreserved.importedSections`
2. retain reader compatibility temporarily for older repos
3. migrate existing repos one-shot
4. when migration coverage is complete, mark `importedSections` deprecated, then removable

Expected result:

- `workflow.adapter.json` no longer needs legacy imported prose for active repos

## Risks

### Risk 1 - Silent semantic loss during promotion

This is the main risk.

Mitigation:

- block-by-block parity review
- golden rendering tests
- migration diff checks against legacy `WORKFLOW.md`

### Risk 2 - Promoting project-specific rules into core canon

This would overfit `aidn` to `gowire`.

Mitigation:

- only generic incident/continuity wording goes to core
- performance policy and specialized codegen boundary stay adapter-owned

### Risk 3 - Structured schema that is too weak

If schema is too minimal, wording nuance will be lost and legacy prose will creep back.

Mitigation:

- allow selective explanatory text fields where needed
- prefer structured lists/flags first, then add one focused note field if truly required

### Risk 4 - Documentation/runtime mismatch

If promoted gates look mandatory but are not runtime-enforced, the adapter may overstate reality.

Mitigation:

- label project sections clearly as adapter policy unless runtime enforcement exists
- create explicit backlog items for any later runtime gate adoption

### Risk 5 - Single-agent assumptions leaking into adapter policy

If imported legacy prose is promoted too literally, the new schema may encode assumptions that break multi-agent runtime evolution.

Mitigation:

- review each promoted field against the existing multi-agent plans
- keep topology-level policy separate from execution-scope policy
- escalate conservatively on shared integration surfaces

### Risk 6 - Structured policy becomes invisible to DB-backed runtime flows

If promoted rules exist only in adapter JSON and are no longer rendered into workflow artifacts, `dual` / `db-only` consultation paths lose visibility.

Mitigation:

- keep promoted policy rendered in `WORKFLOW.md`
- add tests that preserve generated artifact visibility and import compatibility
- treat direct structured projection as additive, not a replacement in this migration

## Recommended Execution Order

### Lot 1 - Mapping and parity

1. create a block-by-block mapping matrix for `gowire importedSections`
2. mark each block as `native-core | adapter-structured | keep-temporary`
3. patch canonical docs only where truly generic wording is missing
4. annotate each retained block with its multi-agent scope: `session-topology | dispatch-scope | shared-integration-surface`

### Lot 2 - Schema promotion

1. extend `workflow.adapter.json` schema
2. add deterministic renderers for:
   - session transition cleanliness
   - execution policy
   - shared codegen boundary gate
3. add migration logic from legacy imported prose to structured config
4. verify field semantics against multi-agent runtime plans before freezing schema
5. verify promoted policy still appears in generated workflow artifacts used by DB-backed consultation flows

### Lot 3 - Repository migration

1. migrate `gowire`
2. regenerate installed docs
3. diff old vs new `WORKFLOW.md`
4. verify no effective rule loss

### Lot 4 - Legacy retirement

1. stop emitting migrated blocks back into `importedSections`
2. keep backward-compatible reads for old repos
3. document deprecation of `importedSections`
4. later remove it only after install/migration coverage proves safe

### Reader compatibility decision

- readers continue accepting `legacyPreserved.importedSections` for older repositories during the transition period
- migrated repositories should drain `legacyPreserved.importedSections` to `[]`
- an empty `legacyPreserved` object is currently retained for stability; normalization does not remove it yet
- hard removal of the reader path is deferred until repository migration coverage and install/reinstall evidence remain stable

## Acceptance Criteria

- `gowire` renders all currently meaningful workflow rules without relying on `importedSections`
- duplicated incident and continuity prose is removed from legacy storage
- project-specific retained policy is present in explicit adapter fields
- reinstall and reinitialization keep `WORKFLOW.md` deterministic
- no meaningful section from current `gowire` workflow disappears in the migration diff
- `importedSections` becomes empty or fully deprecated for migrated repos
- promoted project policy remains coherent with multi-agent session topology and dispatch-scope rules already adopted by `aidn`
- promoted project policy remains visible in generated workflow artifacts so `dual` / `db-only` consultation paths keep working

## Recommendation

This migration is worth doing.

Reason:

- there is real value in eliminating `legacy` from the adapter config
- `gowire` contains enough useful project policy that keeping `importedSections` indefinitely would lock in a second-class configuration model
- the safest path is selective promotion, not blanket canonization

The recommended next artifact after this plan is a backlog with explicit items for:

- mapping matrix
- schema extensions
- deterministic render updates
- migration helper changes
- `gowire` conversion
- parity and idempotence tests

## Outcome

Completed outcome:

- `gowire` imported policy is now promoted into native adapter fields
- `legacyPreserved.importedSections` is drained for migrated `gowire`
- parity and multi-agent visibility tests cover both file-backed and DB-backed consultation paths
- reader compatibility remains in place for older repositories while new/migrated repositories stay non-legacy
