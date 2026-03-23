# Backlog Architecture - GitHub Issues Ready - 2026-03-07

## Usage

This document provides ready-to-create GitHub issues derived from:

- `docs/ADR/ADR-0002-runtime-platform-architecture.md`
- `docs/PLAN_ARCHITECTURE_REMEDIATION_2026-03-07.md`
- `docs/BACKLOG_ARCHITECTURE_REMEDIATION_2026-03-07.md`

Important:

- this file is a derived issue-preparation artifact, not the source of truth for implementation status
- current delivery status must be read from `docs/BACKLOG_ARCHITECTURE_REMEDIATION_2026-03-07.md`
- if these issue drafts diverge from the repository state, treat them as stale planning exports until refreshed

Recommended labels:

- `architecture`
- `refactor`
- `runtime`
- `install`
- `observability`
- `codex`
- `packaging`
- `validation`
- `p0`
- `p1`
- `p2`

Recommended milestones:

- `M1 Direction And Initial Decompression`
- `M2 Install Decomposition`
- `M3 Core Contracts`
- `M4 Runtime Separation`
- `M5 Explicit State Stores`
- `M6 Agent Integration Encapsulation`
- `M7 Packaging Alignment`
- `M8 Real-World Validation`

## Epic Issues

### Issue: E1 - Direction and documentation freeze

Title:

`[Architecture] E1 - Freeze runtime-platform direction and documentation`

Body:

```md
## Summary

Freeze the target architecture direction for `aidn` before deeper refactoring starts.

## Why

The repository has drifted from a template-only positioning toward a workflow runtime platform. This must be made explicit before structural changes continue.

## Scope

- target architecture ADR
- remediation plan
- README alignment
- documentation pointers

## Tickets

- E1-T1 Add target architecture ADR
- E1-T2 Add architecture remediation plan
- E1-T3 Align README with runtime-platform positioning

## Acceptance Criteria

- runtime-platform direction is documented in-repo
- README is aligned with actual product direction
- maintainers share one architecture vocabulary: `core`, `application`, `adapters`, `distribution`

## References

- `docs/ADR/ADR-0002-runtime-platform-architecture.md`
- `docs/PLAN_ARCHITECTURE_REMEDIATION_2026-03-07.md`
- `docs/BACKLOG_ARCHITECTURE_REMEDIATION_2026-03-07.md`
```

Labels:

- `architecture`
- `p0`

Milestone:

- `M1 Direction And Initial Decompression`

### Issue: E2 - Install monolith decomposition

Title:

`[Architecture] E2 - Decompose install monolith`

Body:

```md
## Summary

Break `tools/install.mjs` into focused modules while keeping the current CLI surface stable.

## Why

`tools/install.mjs` is the primary concentration risk in the repository. It mixes manifest parsing, compatibility checks, template copy/merge, custom preservation, Codex migration, artifact import, and project config management.

## Scope

- manifest loading
- compatibility policy
- project config handling
- template copy/merge
- custom-file policy
- transitional wrapper reduction

## Tickets

- E2-T1 Extract manifest loading
- E2-T2 Extract compatibility policy
- E2-T3 Extract `.aidn/config.json` management
- E2-T4 Extract template copy/merge
- E2-T5 Extract custom-file policy
- E2-T6 Reduce `tools/install.mjs` to a transitional wrapper

## Acceptance Criteria

- `tools/install.mjs` is no longer a monolithic business script
- install behavior remains stable on current fixtures
- extracted modules are testable in isolation

## References

- `docs/PLAN_ARCHITECTURE_REMEDIATION_2026-03-07.md`
- `docs/BACKLOG_ARCHITECTURE_REMEDIATION_2026-03-07.md`
```

Labels:

- `architecture`
- `refactor`
- `install`
- `p0`

Milestone:

- `M2 Install Decomposition`

### Issue: E3 - Core architecture contracts

Title:

`[Architecture] E3 - Define core architecture contracts`

Body:

```md
## Summary

Introduce the core ports that separate workflow logic from storage, projection, VCS, and agent integrations.

## Why

The repository needs explicit seams before deeper runtime refactoring. Without them, DB-first, projection, and agent integration remain script-coupled.

## Scope

- `WorkflowStateStore`
- `ArtifactProjector`
- `HookContextStore`
- `AgentAdapter`
- `VcsAdapter`
- explicit state-mode semantics in `core/state`

## Tickets

- E3-T1 Define `WorkflowStateStore`
- E3-T2 Define `ArtifactProjector`
- E3-T3 Define `HookContextStore`
- E3-T4 Define `AgentAdapter`
- E3-T5 Define `VcsAdapter`
- E3-T6 Formalize `files|dual|db-only` in `core/state`

## Acceptance Criteria

- explicit interfaces exist for state, projection, hooks, VCS, and agent integration
- source-of-truth semantics are encoded in one place
- runtime code can start depending on ports instead of ad hoc script calls

## References

- `docs/ADR/ADR-0002-runtime-platform-architecture.md`
- `docs/BACKLOG_ARCHITECTURE_REMEDIATION_2026-03-07.md`
```

Labels:

- `architecture`
- `runtime`
- `p1`

Milestone:

- `M3 Core Contracts`

### Issue: E4 - Separate runtime engine from observability

Title:

`[Architecture] E4 - Separate runtime control from observability`

Body:

```md
## Summary

Separate workflow execution logic from KPI, reporting, trend checks, and summaries.

## Why

`tools/perf` currently mixes control-plane, state-plane, and observability concerns. This makes the runtime harder to evolve and reason about.

## Scope

- checkpoint use case extraction
- workflow hook use case extraction
- parity verification extraction
- move metrics/reporting into `application/observability`

## Tickets

- E4-T1 Extract checkpoint use case
- E4-T2 Extract workflow hook use case
- E4-T3 Extract runtime parity verification
- E4-T4 Move KPI/reporting into observability layer

## Acceptance Criteria

- runtime sequencing no longer lives primarily in CLI scripts
- observability evolves independently from workflow control logic
- current parity verification remains green

## References

- `docs/PLAN_ARCHITECTURE_REMEDIATION_2026-03-07.md`
- `docs/BACKLOG_ARCHITECTURE_REMEDIATION_2026-03-07.md`
```

Labels:

- `architecture`
- `runtime`
- `observability`
- `p1`

Milestone:

- `M4 Runtime Separation`

### Issue: E5 - Explicit state stores and source-of-truth enforcement

Title:

`[Architecture] E5 - Implement explicit workflow state stores`

Body:

```md
## Summary

Implement explicit state-store contracts for `files`, `dual`, and `db-only` modes.

## Why

DB-backed behavior exists, but the source-of-truth policy is not yet fully enforced through explicit internal contracts.

## Scope

- file-backed store
- DB-backed store
- dual coordinator
- artifact projector integration
- mode migration use case

## Tickets

- E5-T1 Implement `FileWorkflowStateStore`
- E5-T2 Implement `DbWorkflowStateStore`
- E5-T3 Implement `DualWorkflowStateStore`
- E5-T4 Wire `ArtifactProjector` to rebuild/projection
- E5-T5 Extract mode migration use case

## Acceptance Criteria

- each mode has explicit source-of-truth semantics
- rebuild and projection use shared contracts
- hidden hybrid behavior is removed

## References

- `docs/ADR/ADR-0002-runtime-platform-architecture.md`
- `docs/BACKLOG_ARCHITECTURE_REMEDIATION_2026-03-07.md`
```

Labels:

- `architecture`
- `runtime`
- `p1`

Milestone:

- `M5 Explicit State Stores`

### Issue: E6 - Encapsulate Codex and agent integrations

Title:

`[Architecture] E6 - Encapsulate Codex as agent adapter`

Body:

```md
## Summary

Move Codex-specific behavior behind explicit agent integration contracts.

## Why

Codex is strategically important in the current runtime roadmap, but it should not remain a hidden core dependency.

## Scope

- custom-file Codex migration adapter
- JSON hook execution through `AgentAdapter`
- context hydration through `HookContextStore` + `WorkflowStateStore`

## Tickets

- E6-T1 Extract Codex custom migration adapter
- E6-T2 Route `run-json-hook` through `AgentAdapter`
- E6-T3 Route `hydrate-context` through contracts

## Acceptance Criteria

- Codex-specific logic is isolated in adapter modules
- core/application layers do not require Codex-specific knowledge
- install and runtime still work when Codex integration is unavailable where optional

## References

- `docs/ADR/ADR-0002-runtime-platform-architecture.md`
- `docs/BACKLOG_ARCHITECTURE_REMEDIATION_2026-03-07.md`
```

Labels:

- `architecture`
- `codex`
- `p1`

Milestone:

- `M6 Agent Integration Encapsulation`

### Issue: E7 - Align packaging with runtime architecture

Title:

`[Architecture] E7 - Align packs and packaging with runtime boundaries`

Body:

```md
## Summary

Rework pack boundaries so that product packaging reflects the actual runtime architecture.

## Why

Current pack modularity does not reflect real behavior. `extended` is currently empty, while most complexity lives in runtime and integration tooling.

## Scope

- reevaluate `core`
- remove or redefine `extended`
- optionally introduce `runtime-local`
- optionally introduce `codex-integration`
- update scripts and packaging documentation

## Tickets

- E7-T1 Reevaluate `packs/core` and `packs/extended`
- E7-T2 Introduce `runtime-local` if justified
- E7-T3 Introduce `codex-integration` if justified
- E7-T4 Update package scripts and packaging docs

## Acceptance Criteria

- pack taxonomy maps to real product behavior
- optional integrations are explicit
- installation surface is easier to understand

## References

- `docs/ADR/ADR-0002-runtime-platform-architecture.md`
- `docs/BACKLOG_ARCHITECTURE_REMEDIATION_2026-03-07.md`
```

Labels:

- `architecture`
- `packaging`
- `p2`

Milestone:

- `M7 Packaging Alignment`

### Issue: E8 - Validate on real-world repositories

Title:

`[Architecture] E8 - Validate refactor on real-world corpora`

Body:

```md
## Summary

Extend validation from synthetic fixtures to representative real-world repository corpora.

## Why

Current confidence is still heavily fixture-driven. Architecture changes need validation on realistic layouts and migration paths.

## Scope

- define corpus targets
- add migration scenarios
- add custom-install scenarios
- validate parity and rebuild on real structures

## Tickets

- E8-T1 Define target real-world corpus
- E8-T2 Add inter-mode migration scenarios
- E8-T3 Add customized install scenarios
- E8-T4 Validate runtime parity on real corpus

## Acceptance Criteria

- architecture changes validated on more than synthetic fixtures
- mode migration is reproducible
- dual/db-only parity is demonstrated in realistic repositories

## References

- `docs/PLAN_ARCHITECTURE_REMEDIATION_2026-03-07.md`
- `docs/BACKLOG_ARCHITECTURE_REMEDIATION_2026-03-07.md`
```

Labels:

- `architecture`
- `validation`
- `p2`

Milestone:

- `M8 Real-World Validation`

## Priority Ticket Issues

### Issue: E2-T1 - Extract manifest loading

Title:

`[Install] E2-T1 - Extract manifest loading from tools/install.mjs`

Body:

```md
## Summary

Extract manifest loading and YAML reading out of `tools/install.mjs`.

## Why

Manifest loading is a foundational concern and should be isolated before further install decomposition.

## Scope

- create `src/application/install/manifest-loader.mjs`
- create `src/adapters/manifest/yaml-reader.mjs`
- move manifest parsing logic out of `tools/install.mjs`

## Acceptance Criteria

- `tools/install.mjs` no longer loads/parses manifests directly
- manifests can be loaded independently of CLI execution
- install fixtures continue to pass

## Validation

- existing install verification fixtures
- manual smoke test for `aidn install --verify`
```

Labels:

- `install`
- `refactor`
- `p0`

Milestone:

- `M1 Direction And Initial Decompression`

### Issue: E2-T2 - Extract compatibility policy

Title:

`[Install] E2-T2 - Extract compatibility policy from tools/install.mjs`

Body:

```md
## Summary

Extract OS / Node / Codex compatibility decisions into a dedicated install compatibility module.

## Scope

- create `src/application/install/compatibility-policy.mjs`
- move compatibility decision logic out of `tools/install.mjs`

## Acceptance Criteria

- compatibility decisions are isolated and testable
- current install behavior is preserved

## Validation

- install fixtures
- manual smoke checks for compatibility output
```

Labels:

- `install`
- `refactor`
- `p0`

Milestone:

- `M1 Direction And Initial Decompression`

### Issue: E2-T3 - Extract project config service

Title:

`[Install] E2-T3 - Extract .aidn config management from tools/install.mjs`

Body:

```md
## Summary

Extract `.aidn/config.json` build/read/write logic from the install monolith.

## Scope

- create `src/application/install/project-config-service.mjs`
- move config assembly logic out of `tools/install.mjs`

## Acceptance Criteria

- config logic is isolated
- env/config fallback behavior is unchanged
- install fixtures continue to pass

## Validation

- install fixtures
- targeted smoke test for config creation/update
```

Labels:

- `install`
- `refactor`
- `p0`

Milestone:

- `M1 Direction And Initial Decompression`

### Issue: E2-T6 - Reduce tools/install.mjs to transitional wrapper

Title:

`[Install] E2-T6 - Reduce tools/install.mjs to a thin transitional wrapper`

Body:

```md
## Summary

After extractions land, reduce `tools/install.mjs` to orchestration only.

## Scope

- remove remaining heavyweight business logic from `tools/install.mjs`
- delegate to extracted modules

## Acceptance Criteria

- `tools/install.mjs` is primarily a wrapper
- install commands keep the same external behavior
- no major business logic remains embedded in the script

## Validation

- install fixtures
- smoke test for install, verify, dry-run, and artifact import flows
```

Labels:

- `install`
- `refactor`
- `p0`

Milestone:

- `M2 Install Decomposition`

### Issue: E3-T1 - Define WorkflowStateStore

Title:

`[Runtime] E3-T1 - Define WorkflowStateStore core port`

Body:

```md
## Summary

Define the core state-store contract used by `files`, `dual`, and `db-only`.

## Scope

- create `src/core/ports/workflow-state-store.mjs`
- define minimal operations: load, persist, listArtifacts, getArtifact

## Acceptance Criteria

- contract is documented and committed
- current runtime evolution can target this abstraction
- no storage implementation details leak into the port

## Validation

- review against current runtime needs
- verify coverage of current state-mode requirements
```

Labels:

- `runtime`
- `architecture`
- `p1`

Milestone:

- `M3 Core Contracts`

### Issue: E3-T6 - Formalize state modes in core/state

Title:

`[Runtime] E3-T6 - Formalize files/dual/db-only semantics in core/state`

Body:

```md
## Summary

Encode state-mode semantics in one core module instead of scattering them across scripts.

## Scope

- introduce `core/state`
- centralize source-of-truth rules

## Acceptance Criteria

- `files`, `dual`, and `db-only` semantics are explicit and testable
- runtime code can reuse one source for state-mode decisions

## Validation

- compare with current documented mode policy
- ensure no CLI behavior change is required yet
```

Labels:

- `runtime`
- `architecture`
- `p1`

Milestone:

- `M3 Core Contracts`

### Issue: E4-T2 - Extract workflow hook use case

Title:

`[Runtime] E4-T2 - Extract workflow-hook orchestration into application use case`

Body:

```md
## Summary

Move workflow-hook orchestration out of `tools/perf/workflow-hook.mjs` into `src/application/runtime/`.

## Scope

- create `src/application/runtime/hook-use-case.mjs`
- keep `tools/perf/workflow-hook.mjs` as a thin wrapper

## Acceptance Criteria

- runtime sequencing no longer primarily lives in the CLI script
- wrapper remains compatible with current commands
- parity tests still pass

## Validation

- `perf:verify-state-mode-parity`
- workflow-hook smoke tests
```

Labels:

- `runtime`
- `refactor`
- `p1`

Milestone:

- `M4 Runtime Separation`

### Issue: E5-T2 - Implement DbWorkflowStateStore

Title:

`[Runtime] E5-T2 - Implement DbWorkflowStateStore`

Body:

```md
## Summary

Implement the DB-backed workflow state store behind the core port.

## Scope

- create `src/adapters/sqlite/db-workflow-state-store.mjs`
- support canonical workflow state operations
- support normative and support artifacts

## Acceptance Criteria

- DB-backed runtime state is accessible via `WorkflowStateStore`
- implementation supports current DB-oriented runtime flows
- contract is compatible with `dual` and `db-only`

## Validation

- current parity fixtures
- DB-oriented runtime smoke tests
```

Labels:

- `runtime`
- `refactor`
- `p1`

Milestone:

- `M5 Explicit State Stores`

### Issue: E6-T1 - Extract Codex custom migration adapter

Title:

`[Codex] E6-T1 - Extract Codex custom migration into adapter`

Body:

```md
## Summary

Move custom-file Codex migration logic into a dedicated adapter.

## Scope

- create `src/adapters/codex/codex-migrate-custom.mjs`
- remove direct Codex coupling from generic install logic

## Acceptance Criteria

- generic install flow no longer owns Codex-specific migration logic
- Codex migration remains available through adapter wiring

## Validation

- install flows with custom files
- with-Codex and without-Codex behavior checks
```

Labels:

- `codex`
- `refactor`
- `p1`

Milestone:

- `M6 Agent Integration Encapsulation`

### Issue: E7-T1 - Reevaluate packs/core and packs/extended

Title:

`[Packaging] E7-T1 - Reevaluate core and extended pack boundaries`

Body:

```md
## Summary

Reevaluate current pack boundaries so that they reflect real runtime behavior.

## Scope

- assess whether `extended` should be removed or redefined
- document intended boundaries for future packs

## Acceptance Criteria

- empty pack ambiguity is resolved
- pack boundaries are justified by real behavior

## Validation

- packaging review
- install/documentation alignment review
```

Labels:

- `packaging`
- `architecture`
- `p2`

Milestone:

- `M7 Packaging Alignment`

## Suggested Creation Order

Create issues in this order:

1. all epic issues E1..E8
2. E2-T1
3. E2-T2
4. E2-T3
5. E2-T6
6. E3-T1
7. E3-T6
8. E4-T2
9. E5-T2
10. E6-T1
11. E7-T1
