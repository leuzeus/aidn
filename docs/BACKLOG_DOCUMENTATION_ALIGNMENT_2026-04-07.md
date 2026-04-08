# Backlog - Documentation Alignment And Version Hygiene

Date: 2026-04-07
Status: proposed
Scope: executable backlog for keeping live `aidn` documentation aligned with the current codebase, release baseline, and operator/runtime surfaces.

Reference plan:

- `docs/PLAN_DOCUMENTATION_ALIGNMENT_2026-04-07.md`

## Delivery Rules

- live docs must match the code and CLI exposed on the default branch
- workflow diagrams may simplify, but they must not hide current normative boundaries
- BPMN must stay focused on workflow choreography, not absorb install/config/admin details
- historical plans/backlogs/audits may stay historical; only current guidance needs active alignment
- version examples in live docs must either match `VERSION` or state clearly that they are derived examples

## Priority Legend

- **P0**: current-reader blocking
- **P1**: prevention and operator safety
- **P2**: historical hygiene

## P0 - Live Doc Alignment

### DAVG-1. Align Current Version Signals
**Priority:** P0  
**Status:** proposed

Goal:

- make live docs and pack metadata describe the same current baseline

Done when:

- `README.md`, `docs/UPGRADE.md`, and other live entry docs do not present stale `0.4.0` references as current
- `package/manifests/workflow.manifest.yaml` and `packs/*/manifest.yaml` match the active product baseline
- current-facing docs no longer force readers to guess which version is authoritative

### DAVG-2. Refresh README From The Actual Codebase
**Priority:** P0  
**Status:** proposed

Goal:

- make `README.md` a reliable entrypoint for both architecture and operations

Dependencies:

- DAVG-1

Done when:

- the README explains the current codebase layers
- the README covers `install`, `project config`, `runtime`, `perf`, and `codex`
- the README includes current examples for shared coordination, runtime persistence adoption, and coordinator surfaces

### DAVG-3. Refresh Mermaid Architecture Baseline
**Priority:** P0  
**Status:** proposed

Goal:

- keep live architecture diagrams consistent with the current runtime baseline

Dependencies:

- DAVG-1

Done when:

- `docs/diagrams/*` no longer declare the old `0.4.0` baseline as current
- the global architecture view shows adapter config, coordination artifacts, and persistence/admin boundaries where they matter
- the runtime session flow reflects current relay/escalation language

### DAVG-4. Clarify BPMN Scope Boundary
**Priority:** P0  
**Status:** proposed

Goal:

- prevent BPMN readers from confusing workflow choreography with install/config/admin mechanics

Dependencies:

- DAVG-2
- DAVG-3

Done when:

- `docs/bpmn/README.md` explains what stays outside BPMN
- `docs/bpmn/IMPLEMENTATION_PLAN.md` links the BPMN to current adjacent runtime/operator surfaces without collapsing them into the diagrams

## P1 - Drift Prevention

### DAVG-5. Align Install And Upgrade Guidance With Current Entry Points
**Priority:** P1  
**Status:** proposed

Goal:

- keep operational docs aligned with current install and upgrade paths

Dependencies:

- DAVG-1
- DAVG-2

Done when:

- `docs/INSTALL.md` and `docs/UPGRADE.md` present the same current story for `aidn project config`, generated workflow docs, and runtime persistence/shared-coordination options
- upgrade steps use current CLI entrypoints rather than legacy internal commands where a public entrypoint exists

### DAVG-6. Add A Lightweight Doc Drift Check
**Priority:** P1  
**Status:** proposed

Goal:

- catch stale current-facing version literals and missing doc coverage early

Dependencies:

- DAVG-1
- DAVG-5

Done when:

- one simple verification command or fixture check can fail on stale live-doc version references
- the check covers at least:
  - `README.md`
  - `docs/INSTALL.md`
  - `docs/UPGRADE.md`
  - `docs/diagrams/*`
  - `docs/bpmn/README.md`

## P2 - Historical Hygiene

### DAVG-7. Sweep Remaining Current Docs For Frozen Examples
**Priority:** P2  
**Status:** proposed

Goal:

- remove stale "current" guidance without rewriting the project archive

Dependencies:

- DAVG-6

Done when:

- remaining live docs such as Git workflow and migration entrypoints are reviewed for stale current examples
- historical artifacts remain historical, but anything that still acts as live guidance is updated or explicitly marked as historical

## Recommended Execution Order

1. DAVG-1
2. DAVG-2 to DAVG-4
3. DAVG-5
4. DAVG-6
5. DAVG-7

## Minimum Viable Milestone

The first milestone should be considered complete only when:

- a new contributor can understand the current `aidn` architecture and CLI from the README
- live diagrams and BPMN notes no longer imply the `0.4.0` baseline is current
- install/upgrade docs point to the current public entrypoints
- live version signals are coherent across docs and manifests
