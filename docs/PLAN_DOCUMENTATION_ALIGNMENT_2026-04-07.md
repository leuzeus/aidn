# Plan - Documentation Alignment And Version Hygiene

Date: 2026-04-07
Status: proposed, codebase-validated
Scope: align live entry documentation with the current `aidn` codebase and release baseline, clarify what the diagrams/BPMN do and do not model, and prevent silent version/documentation drift from recurring.

## Why A Dedicated Plan Is Needed

The repository has grown beyond the original `0.4.0` documentation baseline.
The current codebase exposes:

- package/runtime version `0.5.1`
- bounded coordinator/orchestration commands
- deterministic project adapter generation through `aidn project config`
- runtime persistence adoption flows for `sqlite | postgres`
- expanded shared-coordination visibility and admin commands

Several live docs still reflected the older baseline and under-described the current product surface.
That made the repository harder to understand from the entry docs even though the implementation already exists.

## Validated Baseline

Codebase structure validated from the repository:

- `src/core/*`
  - workflow, gating, state-mode, skill, agent policies and port contracts
- `src/application/*`
  - install, runtime, project config, and Codex use cases
- `src/adapters/*`
  - runtime, Codex, manifest, and local implementations
- `src/lib/*`
  - config, workflow rendering, SQLite, index, and FS helpers
- `tools/runtime/*`
  - operator/runtime entrypoints
- `tools/perf/*`
  - fixture verification, KPI, gating, and regression tooling

Current CLI groups validated from `bin/aidn.mjs`:

- `install`
- `project config`
- `runtime`
- `perf`
- `codex`

Current adjacent surfaces validated from runtime/install entrypoints:

- `aidn project config`
- `aidn runtime shared-coordination-projects`
- `aidn runtime persistence-adopt`
- `aidn runtime coordinator-orchestrate`
- install-time `--runtime-persistence-backend` and projection-policy options

## Primary Gaps Identified

### 1. Version Signal Drift

The repository had multiple current-facing version signals:

- `VERSION` and `package.json`: `0.5.1`
- live docs and pack/manifests: several `0.4.0` references

That drift weakens trust in the docs and complicates upgrades.

### 2. README Under-Described The Current Product

The `README` was still centered on the older workflow/runtime baseline and did not sufficiently cover:

- codebase layering
- project adapter generation
- runtime persistence adoption
- shared coordination inventory/admin visibility
- bounded coordinator/orchestration commands

### 3. Mermaid Diagrams Lagged The Current Baseline

The Mermaid files still declared the `0.4.0` baseline and the global architecture view did not show:

- durable adapter config
- generated workflow outputs
- runtime persistence/shared-coordination service boundary
- coordination artifacts

### 4. BPMN Scope Was Too Implicit

The BPMN notes were generally aligned with the workflow runtime, but they did not clearly state that:

- install/reinstall flows are outside BPMN
- deterministic adapter generation is outside BPMN
- runtime backend adoption/admin flows are adjacent operator surfaces, not BPMN swimlanes

### 5. No Lightweight Drift Guard Exists For Live Docs

Without a simple verification rule, stale version examples and lagging entry docs can reappear silently.

## Hard Constraints

Any follow-up work should preserve these constraints:

1. live docs must describe only code and CLI surfaces that exist in the current repository
2. workflow choreography and install/config/admin surfaces must stay separated conceptually
3. historical plan/backlog/audit docs should remain historical unless explicitly promoted to current guidance
4. version examples in live docs should either match `VERSION` or explain that the value is derived from `VERSION`

## Recommended Delivery Phases

### Phase 0 - Entry Doc Refresh

Deliverables:

- refresh `README.md`
- refresh Mermaid baseline labels and architecture boundary
- refresh BPMN notes
- refresh `docs/UPGRADE.md`

Exit condition:

- a new reader can map the current codebase and CLI from the live docs without relying on stale `0.4.0` examples

### Phase 1 - Version Hygiene

Deliverables:

- align `package/manifests/workflow.manifest.yaml`
- align `packs/*/manifest.yaml`
- ensure live docs and pack metadata tell the same current release story

Exit condition:

- package, manifests, and live docs present one coherent baseline

### Phase 2 - Drift Prevention

Deliverables:

- add a lightweight documentation/version drift check
- define the minimal scope of "live docs" versus "historical docs"

Exit condition:

- stale current-facing version examples can be detected automatically

### Phase 3 - Historical Sweep

Deliverables:

- review remaining live docs for frozen examples and outdated cross-links
- leave historical delivery records untouched unless they are misclassified as current guidance

Exit condition:

- current-facing docs are clean even if historical archives still mention previous baselines

## Success Criteria

This plan is successful when:

- `README`, Mermaid diagrams, BPMN notes, and upgrade/install guidance describe the current `aidn` surface accurately
- version signals in live docs and pack metadata are coherent
- the codebase layering and CLI surface are explicit from the documentation
- BPMN readers understand which adjacent operational flows live outside the choreography
- a future stale-version regression can be detected quickly
