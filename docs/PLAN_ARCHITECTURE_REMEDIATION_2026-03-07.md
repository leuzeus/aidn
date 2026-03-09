# Plan Architecture Remediation - 2026-03-07

## Objective

Remediate the current structural risks in `aidn` without breaking the existing CLI surface or the current workflow guarantees.

This plan converts the repository from script-centric orchestration to layered runtime architecture in incremental pull requests.

## Scope

In scope:

- target architecture rollout
- script decomposition
- explicit source-of-truth contracts
- Codex isolation as adapter
- runtime and observability boundary cleanup
- documentation alignment

Out of scope for this plan:

- large behavior changes to `SPEC-R01..R11`
- replacing the current CLI surface
- removing file mode
- introducing remote backends

## Problem Summary

Current structural risks:

1. `tools/install.mjs` is a concentrated multi-responsibility module
2. product positioning is still partly template-only while runtime behavior is platform-like
3. `tools/perf` mixes control-plane, state-plane, and observability concerns
4. DB-first direction is not yet reflected by clear internal contracts
5. Codex integration is strategically important but not sufficiently isolated
6. pack modularity does not reflect runtime boundaries

## Target Outcome

At the end of this plan:

- the CLI remains stable
- runtime state behavior is governed by explicit interfaces
- install logic is decomposed into focused modules
- workflow engine and observability are structurally separated
- Codex becomes an optional adapter
- docs describe `aidn` consistently as a workflow runtime platform with template distribution

## Pull Request Plan

### PR1 - Documentation And Direction Freeze

Goal:

- lock the architectural direction before moving files

Changes:

- add ADR for runtime-platform positioning
- add remediation plan
- update `README.md` to describe runtime-platform direction
- update documentation pointers to current and target architecture

Acceptance criteria:

- architecture direction documented in repo
- no code behavior changes
- maintainers have one target vocabulary: core, application, adapters, distribution

### PR2 - Extract Install Manifest And Config Modules

Goal:

- reduce the first concentration risk inside `tools/install.mjs`

Changes:

- extract manifest parsing/loading
- extract compatibility policy
- extract `.aidn/config.json` read/write/build logic
- keep current CLI and command behavior unchanged

Suggested module split:

- `src/application/install/manifest-loader.mjs`
- `src/application/install/compatibility-policy.mjs`
- `src/application/install/project-config-service.mjs`
- `src/adapters/manifest/yaml-reader.mjs`

Acceptance criteria:

- `tools/install.mjs` becomes a thin entrypoint or transitional wrapper
- no install regression on current fixtures
- manifest and config logic are unit-testable in isolation

### PR3 - Extract Template Copy/Merge And Custom Preservation

Goal:

- isolate template distribution concerns from runtime concerns

Changes:

- extract copy logic
- extract merge strategies
- extract customizable file preservation logic
- extract Codex-based custom migration behind an adapter boundary

Suggested module split:

- `src/application/install/template-copy-service.mjs`
- `src/application/install/template-merge-service.mjs`
- `src/application/install/custom-file-policy.mjs`
- `src/adapters/codex/codex-migrate-custom.mjs`

Acceptance criteria:

- install behavior stays identical on fixture repositories
- Codex migration is no longer hardwired into generic install flow
- customizable-file policy can run without Codex installed

### PR4 - Introduce Core Ports For State And Agent Integration

Goal:

- define stable architecture seams before deeper runtime moves

Changes:

- introduce core ports:
  - `WorkflowStateStore`
  - `ArtifactProjector`
  - `HookContextStore`
  - `AgentAdapter`
  - `VcsAdapter`

- introduce mode resolution policy in `core/state`

Acceptance criteria:

- runtime code can depend on interfaces instead of ad hoc script calls
- source-of-truth rules are encoded in one place
- no functional behavior changes required yet

### PR5 - Move Runtime Control Logic Out Of `tools/perf`

Goal:

- separate workflow execution from metrics and reporting

Changes:

- extract checkpoint orchestration into `src/application/runtime/`
- move workflow hook orchestration to a use case
- keep `tools/perf/workflow-hook.mjs` as transitional CLI wrapper only

Suggested module split:

- `src/application/runtime/checkpoint-use-case.mjs`
- `src/application/runtime/hook-use-case.mjs`
- `src/application/runtime/parity-verify-use-case.mjs`

Acceptance criteria:

- `workflow-hook` is thin
- runtime sequencing lives outside CLI scripts
- parity tests still pass

### PR6 - Separate Observability From Runtime Engine

Goal:

- isolate KPI/reporting code from state transitions and gate decisions

Changes:

- group metrics collection and reporting under `src/application/observability/`
- keep reports, trend checks, threshold checks and summaries outside runtime engine

Suggested split:

- `src/application/observability/collect-event-use-case.mjs`
- `src/application/observability/report-kpi-use-case.mjs`
- `src/application/observability/report-constraints-use-case.mjs`

Acceptance criteria:

- runtime engine no longer owns reporting logic
- observability can evolve without modifying gate orchestration

### PR7 - Implement Concrete State Stores Behind Ports

Goal:

- make state source explicit and enforce mode semantics structurally

Changes:

- implement file-backed state store
- implement sqlite-backed state store
- implement dual mode coordinator
- move projection/rebuild logic behind `ArtifactProjector`

Suggested modules:

- `src/adapters/filesystem/file-workflow-state-store.mjs`
- `src/adapters/sqlite/db-workflow-state-store.mjs`
- `src/application/runtime/mode-migrate-use-case.mjs`
- `src/application/runtime/project-artifacts-use-case.mjs`

Acceptance criteria:

- `files`, `dual`, and `db-only` each have explicit state semantics
- rebuild and parity verification use the same canonical contracts
- no hidden hybrid behavior

### PR8 - Repackage The Product Surface

Goal:

- align package structure with runtime reality

Changes:

- revisit `packs/`
- either remove empty `extended` or assign it a real boundary
- optionally introduce:
  - `runtime-local`
  - `codex-integration`

- update package scripts and docs to reflect the real split

Acceptance criteria:

- pack taxonomy maps to real behavior
- users can understand what is installed and why
- optional integrations are explicit

### PR9 - Real-World Validation Corpus

Goal:

- move confidence from fixture-only to field-relevant

Changes:

- add representative repository corpora
- add migration scenarios:
  - `files -> dual`
  - `dual -> db-only`
  - `db-only -> files`
- add install customization scenarios

Acceptance criteria:

- architecture refactor validated on more than synthetic fixtures
- state-mode parity and rebuild guarantees tested in realistic layouts

## Execution Order

Mandatory order:

1. PR1
2. PR2
3. PR3
4. PR4
5. PR5
6. PR6
7. PR7
8. PR8
9. PR9

Rationale:

- first freeze direction
- then split the install monolith
- then define ports
- then move runtime control
- then move observability
- then enforce state semantics
- finally repack and validate on real repos

## Refactoring Rules

The following rules apply during the migration:

1. keep `bin/aidn.mjs` stable until late in the plan
2. prefer wrapper-first refactors before behavioral rewrites
3. move logic behind interfaces before changing semantics
4. preserve fixture coverage at each PR
5. do not change `SPEC-R01..R11` and architecture structure in the same PR unless unavoidable
6. keep Codex integration optional at the adapter level

## Risks And Controls

### Risk 1 - Transitional duplication

Risk:

- old scripts and new modules coexist for a while

Control:

- document transitional wrappers clearly
- remove old entry logic only after parity checks pass

### Risk 2 - Hidden runtime regressions

Risk:

- extraction may subtly change install or hook behavior

Control:

- fixture tests on every PR
- explicit before/after command parity checks

### Risk 3 - Interface overdesign

Risk:

- too many abstractions too early

Control:

- define only ports already justified by current runtime modes and Codex integration

### Risk 4 - Product ambiguity persists

Risk:

- documentation says one thing while scripts behave differently

Control:

- PR1 is mandatory and must land before technical refactor PRs

## Deliverables

Expected repository deliverables after the plan:

- one ADR describing target architecture
- one remediation plan
- layered source tree
- thin CLI wrappers
- explicit state store implementations
- explicit agent adapter implementations
- updated pack taxonomy
- broader validation corpus

## Success Criteria

The remediation is successful if:

- no single script remains a dominant orchestration bottleneck
- runtime state semantics are explicit per mode
- workflow engine and observability evolve independently
- Codex is isolated as integration, not hidden core coupling
- product documentation matches the actual platform direction
