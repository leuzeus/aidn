# Backlog Imported Sections Native Migration - 2026-03-12

## Goal

Track concrete follow-up work to eliminate `legacyPreserved.importedSections` by promoting retained project policy into native `aidn` canon or first-class adapter fields, while preserving `gowire` behavior and staying aligned with existing multi-agent runtime philosophy.

Reference plan:

- `docs/PLAN_IMPORTED_SECTIONS_NATIVE_MIGRATION_2026-03-12.md`

## Backlog Items

### ISNM-01 - Build Imported Sections Mapping Matrix

Status: completed
Priority: high

Files:

- migration analysis docs
- `src/application/project/workflow-adapter-migration-service.mjs`
- tests/fixtures as needed

Why:

- migration cannot safely proceed until every imported block is classified with a native target and a multi-agent scope

Done when:

- each current `gowire` imported block is tagged as:
  - `native-core`
  - `adapter-structured`
  - `keep-temporary`
- each block is also tagged with a multi-agent scope:
  - `session-topology`
  - `dispatch-scope`
  - `shared-integration-surface`
- no block remains unclassified

### ISNM-02 - Verify Canonical Parity For Incident Blocks

Status: completed
Priority: high

Files:

- `docs/SPEC.md`
- `template/docs_audit/PROJECT_WORKFLOW.md`
- `template/docs_audit/incidents/*`
- parity tests/docs

Why:

- incident-related imported prose should be removed only after confirming the core wording already covers the same operational meaning

Done when:

- imported incident sections from `gowire` are compared to current canonical docs
- any generic missing nuance is patched in canonical docs/templates
- no remaining incident block requires legacy rendering for semantic completeness

### ISNM-03 - Verify Canonical Parity For Continuity Blocks

Status: completed
Priority: high

Files:

- `docs/SPEC.md`
- `template/docs_audit/CONTINUITY_GATE.md`
- `template/docs_audit/PROJECT_WORKFLOW.md`
- continuity-related skills/tests

Why:

- continuity rule descriptions and user-choice prompts already exist in core `aidn`; duplication should be removed only after parity is explicit

Done when:

- imported continuity blocks are compared with canonical continuity docs and skill wording
- any generic missing nuance is patched once in core/template files
- `Rule Set`, `Mode mapping`, and `Interactive Stop Prompt` no longer need legacy rendering

### ISNM-04 - Define Adapter Schema For Session Transition Cleanliness

Status: completed
Priority: high

Files:

- `src/lib/config/workflow-adapter-config-lib.mjs`
- adapter docs/tests

Why:

- this gate is still useful for `gowire`, but should not remain opaque prose

Done when:

- schema supports a native `sessionPolicy.transitionCleanliness` block
- schema represents:
  - enabled/disabled state
  - required decision options
  - scope semantics consistent with multi-cycle sessions
- field semantics do not assume one session equals one cycle

### ISNM-05 - Define Adapter Schema For Execution Policy

Status: completed
Priority: high

Files:

- `src/lib/config/workflow-adapter-config-lib.mjs`
- adapter docs/tests

Why:

- `Execution Speed Policy` is valuable project policy and should become structured instead of remaining legacy prose

Done when:

- schema supports a native `executionPolicy` block
- schema can express:
  - hard vs light gates
  - fast-path eligibility
  - validation profiles
  - escalation on shared surfaces or parallel attached cycles
- policy semantics are explicitly `dispatch-or-local-scope`, not blanket session-wide assumptions

### ISNM-06 - Define Adapter Schema For Shared Codegen Boundary Gate

Status: completed
Priority: high

Files:

- `src/lib/config/workflow-adapter-config-lib.mjs`
- adapter docs/tests

Why:

- shared codegen boundary is a strong retained rule and a high-collision surface in a multi-agent system

Done when:

- schema supports a native `specializedGates.sharedCodegenBoundary` block
- schema captures:
  - enabled/disabled state
  - relevant generator/shared-output paths
  - required artifact evidence
  - prohibition of component-specific generator fixes
  - escalation behavior on multi-agent overlap

### ISNM-07 - Add Deterministic Renderer For Session Transition Cleanliness

Status: completed
Priority: high

Files:

- `src/application/install/generated-doc-template-vars.mjs`
- `template/docs_audit/PROJECT_WORKFLOW.md`
- generated-doc tests

Why:

- once the gate is structured, `WORKFLOW.md` must render it natively

Done when:

- generated `WORKFLOW.md` renders a deterministic native section for session transition cleanliness
- wording makes clear this is adapter policy unless runtime enforcement exists
- rendered text stays compatible with multi-cycle session topology
- rendered policy remains visible through the normal workflow artifact import/index path used in `dual` / `db-only`

### ISNM-08 - Add Deterministic Renderer For Execution Policy

Status: completed
Priority: high

Files:

- `src/application/install/generated-doc-template-vars.mjs`
- `template/docs_audit/PROJECT_WORKFLOW.md`
- generated-doc tests

Why:

- `Execution Speed Policy` should move out of legacy storage without losing project intent

Done when:

- generated `WORKFLOW.md` renders execution policy from structured adapter fields
- hard/light gates, fast path, and validation profiles are deterministic
- rendered wording distinguishes:
  - session-level policy
  - dispatch/local-scope decision semantics
- shared integration surfaces trigger conservative escalation wording
- rendered policy remains visible through the normal workflow artifact import/index path used in `dual` / `db-only`

### ISNM-09 - Add Deterministic Renderer For Shared Codegen Boundary Gate

Status: completed
Priority: high

Files:

- `src/application/install/generated-doc-template-vars.mjs`
- `template/docs_audit/PROJECT_WORKFLOW.md`
- generated-doc tests

Why:

- this gate should become a visible first-class project adapter section, not a preserved legacy fragment

Done when:

- generated `WORKFLOW.md` renders a native shared codegen boundary section
- wording preserves the current `gowire` rule intent
- the rendered section identifies shared codegen as a shared integration surface
- rendered policy remains visible through the normal workflow artifact import/index path used in `dual` / `db-only`

### ISNM-10 - Remove Incident Blocks From Imported Legacy Rendering

Status: completed
Priority: medium

Files:

- migration service
- generated-doc renderer
- migration tests

Why:

- once parity is proven, incident blocks should stop depending on `importedSections`

Done when:

- migration no longer preserves incident-related imported blocks for new conversions
- existing migrated repos still render equivalently from canonical docs/templates
- no incident-related text loss appears in diff tests

### ISNM-11 - Remove Continuity Blocks From Imported Legacy Rendering

Status: completed
Priority: medium

Files:

- migration service
- generated-doc renderer
- continuity tests

Why:

- continuity rule prose is already a canonical concern and should not survive as project legacy duplication

Done when:

- migration no longer preserves imported continuity blocks for new conversions
- generated docs remain semantically complete without these legacy fragments

### ISNM-12 - Migrate `gowire` Imported Policy Into Structured Adapter Fields

Status: completed
Priority: high

Files:

- `G:/projets/gowire/.aidn/project/workflow.adapter.json`
- migration helper/service
- real-repo validation steps

Why:

- the target repository should prove the non-legacy path works end to end

Done when:

- `gowire` adapter config contains native fields for:
  - session transition cleanliness
  - execution policy
  - shared codegen boundary gate
- duplicate incident and continuity blocks are no longer required in legacy storage
- migration produces no meaningful workflow rule loss

### ISNM-13 - Add Golden Diff Tests For `gowire` Workflow Parity

Status: completed
Priority: high

Files:

- `tools/perf/*`
- parity fixtures

Why:

- no-loss migration must be verified against the actual rendered workflow shape, not only config structure

Done when:

- tests compare legacy-rendered and native-rendered `WORKFLOW.md`
- the accepted differences are explicit and documented
- missing section or missing constraint regressions fail the suite
- tests confirm promoted policy is still present in generated workflow artifacts consumed by DB-backed consultation paths

### ISNM-14 - Add Multi-Agent Safety Tests For Promoted Policies

Status: completed
Priority: high

Files:

- adapter tests
- generated-doc tests
- migration/runtime-alignment fixtures

Why:

- promoted policy must not silently reintroduce single-agent assumptions

Done when:

- tests verify promoted fields do not assume singular session ownership
- execution policy wording and config semantics remain compatible with:
  - `attached_cycles`
  - `integration_target_cycles`
  - explicit relay/dispatch scope
- shared codegen boundary policy marks overlap as a shared integration surface concern
- tests also confirm these promoted sections remain visible in generated artifacts under `dual` / `db-only` style flows

### ISNM-17 - Add DB-Backed Visibility Tests For Promoted Workflow Sections

Status: completed
Priority: high

Files:

- `tools/perf/*`
- generated-doc/import fixtures
- install/import verification tests

Why:

- `aidn` must remain usable in `dual` and `db-only`, where workflow consultation depends on indexed artifacts

Done when:

- tests confirm promoted sections are present in generated `WORKFLOW.md`
- tests confirm install/import flows still expose those sections for DB-backed consultation paths
- no migration step makes promoted policy JSON-only

### ISNM-15 - Mark `importedSections` As Deprecated For Migrated Repos

Status: completed
Priority: medium

Files:

- config docs
- migration docs
- schema comments/help text

Why:

- after native promotion is in place, legacy storage should be clearly transitional

Done when:

- docs state that `importedSections` is compatibility-only
- migrated repos can reach an empty or non-operative `importedSections`
- install/migration help text explains the new native target model

### ISNM-16 - Decide Removal Strategy For Reader Compatibility

Status: completed
Priority: low

Files:

- migration service
- config readers
- docs/tests

Why:

- `importedSections` should not be removed abruptly while older repositories still depend on it

Done when:

- explicit policy exists for:
  - how long readers still accept `importedSections`
  - whether empty `legacyPreserved` is retained or normalized away
  - what migration warning is shown for old repos

## Sequencing Recommendation

Recommended first executable lot:

1. `ISNM-01`
2. `ISNM-02`
3. `ISNM-03`
4. `ISNM-04`
5. `ISNM-05`
6. `ISNM-06`

Recommended second lot:

1. `ISNM-07`
2. `ISNM-08`
3. `ISNM-09`
4. `ISNM-10`
5. `ISNM-11`
6. `ISNM-17`

Recommended third lot:

1. `ISNM-12`
2. `ISNM-13`
3. `ISNM-14`
4. `ISNM-15`
5. `ISNM-16`

Execution status:

- `ISNM-12` to `ISNM-16`: completed
- `gowire` migrated with `legacyPreserved.importedSections = []`
- reader compatibility retained for older repositories until later removal notice

## Open Questions

- Should `Session Transition Cleanliness` eventually gain runtime admission support, or remain documentation-only adapter policy?
- Should `Execution Policy` later influence runtime gate selection, or remain an operator-facing decision discipline?
- Should `Shared Codegen Boundary Gate` eventually integrate with the existing multi-agent collision strategy, or stay purely documentary until a stronger overlap detector exists?
