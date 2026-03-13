# ADR-0002 - Runtime Platform Architecture For aidn

## Status

Proposed

## Date

2026-03-07

## Context

`aidn` started from a template-first workflow product:

- canonical workflow specification in `docs/SPEC.md`
- installable templates in `scaffold/`
- lightweight pack distribution in `packs/`

The current repository has moved beyond that baseline:

- install defaults now provision DB-backed runtime state (`dual`, `dual-sqlite`)
- runtime hooks, checkpoints, index sync, parity verification, and constraint orchestration are first-class features
- Codex context hydration and JSON hook normalization are part of the active roadmap
- most operational complexity lives in `tools/perf/`, `tools/runtime/`, and `tools/codex/`

This creates a structural mismatch:

- product messaging still partially describes `aidn` as template-only
- architecture now behaves like a workflow runtime platform with projections and observability
- some responsibilities are concentrated in oversized scripts, especially `tools/install.mjs`

If this mismatch remains unresolved, the project will accumulate design debt in four forms:

1. identity drift between product promise and implementation
2. operational coupling between workflow rules, state persistence, and metrics
3. increasing maintenance cost from script-level orchestration
4. unclear extension boundaries for packs, runtimes, and agent integrations

## Decision

`aidn` is now treated as a **workflow runtime platform** with template distribution, not as a template-only package.

The target architecture is organized into four layers:

1. `core`
   - workflow rules and invariants
   - state model and canonical artifact taxonomy
   - decision logic independent from transport or storage

2. `application`
   - use cases that orchestrate the core
   - install, checkpoint, hydrate-context, migrate-mode, project-artifacts
   - no direct CLI or vendor-specific concerns

3. `adapters`
   - filesystem, sqlite, json, git, codex, console, process execution
   - each adapter implements explicit interfaces required by `application`

4. `distribution`
   - CLI command mapping
   - packs, manifests, templates, release tooling

## Target Module Map

Recommended target tree:

```text
src/
  core/
    workflow/
      rules/
      decisions/
      invariants/
    artifacts/
      taxonomy/
      canonical/
    state/
      modes/
      transitions/
    ports/
      workflow-state-store.mjs
      artifact-projector.mjs
      hook-context-store.mjs
      agent-adapter.mjs
      vcs-adapter.mjs

  application/
    install/
      install-use-case.mjs
      compatibility-policy.mjs
      manifest-loader.mjs
      template-copy-service.mjs
      template-merge-service.mjs
      project-config-service.mjs
      artifact-import-service.mjs
    runtime/
      checkpoint-use-case.mjs
      hook-use-case.mjs
      hydrate-context-use-case.mjs
      mode-migrate-use-case.mjs
      parity-verify-use-case.mjs
    observability/
      collect-event-use-case.mjs
      report-kpi-use-case.mjs
      report-constraints-use-case.mjs

  adapters/
    filesystem/
    sqlite/
    json-index/
    git/
    codex/
    process/
    console/
    manifest/

  cli/
    aidn-cli.mjs
    commands/
      install-command.mjs
      perf-command.mjs
      runtime-command.mjs
      codex-command.mjs

  distribution/
    packs/
    templates/
    release/
```

## Architectural Boundaries

### 1. Workflow Core

The workflow core owns:

- `SPEC-R01..R11` interpretation
- mode semantics: `files | dual | db-only`
- gate decisions
- cycle and session continuity rules
- canonical artifact classes: normative, support, unknown

The workflow core must not:

- read files directly
- spawn CLI processes directly
- know about `codex`
- render Markdown directly

### 2. Application Layer

The application layer owns orchestration:

- select the right state store for a given mode
- execute imports, exports, projections, rebuilds
- run checkpoint chains and constraint chains
- coordinate the hydration of context after hook execution

The application layer must depend on interfaces from `core/ports`, not concrete scripts.

### 3. Adapter Layer

Adapters encapsulate technical volatility:

- file-based storage
- sqlite-backed storage
- json index access
- git branch discovery
- Codex hook execution and context injection
- console output

Codex is therefore an adapter, not a core concern.

### 4. Distribution Layer

Distribution owns:

- `bin/aidn.mjs`
- package scripts
- pack manifests
- templates copied into target repositories
- release assembly

Distribution must remain thin and map commands to application use cases.

## Required Contracts

The following contracts must exist before deeper refactoring:

### `WorkflowStateStore`

Responsibilities:

- load canonical workflow state
- persist canonical workflow state
- list and fetch artifacts
- support explicit source-of-truth semantics per mode

Implementations:

- `FileWorkflowStateStore`
- `DualWorkflowStateStore`
- `DbWorkflowStateStore`

### `ArtifactProjector`

Responsibilities:

- project canonical state into deterministic Markdown
- project incrementally or fully
- rebuild `docs/audit` from canonical state

### `HookContextStore`

Responsibilities:

- persist normalized hook payloads
- expose recent decisions and history
- hydrate context for an execution target

### `AgentAdapter`

Responsibilities:

- optional hook execution support
- optional custom-file migration support
- optional context injection support

`CodexAgentAdapter` is the first implementation.

## Source Of Truth Policy

The state-source contract becomes explicit:

- `files`
  - source of truth: files
  - DB/index is derivative

- `dual`
  - source of truth: DB canonical state
  - file projection required

- `db-only`
  - source of truth: DB canonical state
  - file projection on demand

No mode may rely on an implicit hybrid contract.

## Product Packaging Direction

The pack strategy must align with actual runtime concerns.

Target pack split:

- `core`
  - spec snapshot, workflow templates, baseline install surface

- `runtime-local`
  - local runtime, index, sqlite, checkpoint, parity and rebuild tooling

- `codex-integration`
  - hook normalization, context store, context hydration, agent adapter

- `extended`
  - optional future add-ons only if they carry distinct behavior

An empty pack is not considered a stable architectural boundary.

## Consequences

### Positive

- clearer product identity
- lower change risk from script decomposition
- explicit extension points for new agents or storage backends
- simpler reasoning about source of truth
- easier progressive migration without changing CLI first

### Negative

- temporary duplication during migration
- more modules and interfaces to maintain
- short-term cost to untangle `tools/install.mjs` and `tools/perf/*`

### Accepted Tradeoff

The project accepts a short-term structural refactor cost to avoid long-term lock-in to monolithic script orchestration.

## Immediate Follow-Up

1. decompose `tools/install.mjs`
2. define `WorkflowStateStore` and `AgentAdapter`
3. split runtime control logic from observability/reporting logic
4. align product documentation with runtime-platform positioning
