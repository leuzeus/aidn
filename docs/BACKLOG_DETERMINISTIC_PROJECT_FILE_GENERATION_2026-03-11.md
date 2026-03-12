# Backlog Deterministic Project File Generation - 2026-03-11

## Goal

Track concrete implementation work for deterministic project file generation, adapter config persistence, and no-loss migration of existing repositories such as `gowire`.

Reference plan:

- `docs/PLAN_DETERMINISTIC_PROJECT_FILE_GENERATION_2026-03-11.md`

## Backlog Items

### DPG-01 - Add Install Ownership Classes

Status: proposed
Priority: high

Files:

- `src/application/install/*`
- pack manifest readers
- install tests

Why:

- install must know which files are generated, seed-once, or runtime-state before deterministic behavior is possible

Done when:

- install model supports ownership classes such as:
  - `generated`
  - `seed-once`
  - `runtime-state`
  - `merge-managed` where still required
- install behavior changes according to ownership class instead of preserved-file heuristics alone

### DPG-02 - Define Adapter Config Schema

Status: proposed
Priority: high

Files:

- `src/lib/config/*`
- new adapter-config helpers
- tests

Why:

- deterministic generators need a stable machine-readable input model

Done when:

- `.aidn/project/workflow.adapter.json` schema is defined
- helpers exist to:
  - read
  - validate
  - normalize
  - write
- the initial schema covers v1 generation fields only

### DPG-03 - Add Adapter Config Storage Service

Status: proposed
Priority: high

Files:

- `src/application/install/*`
- `src/lib/config/*`
- tests

Why:

- adapter config must be treated as durable project-owned input and never overwritten implicitly

Done when:

- install can resolve adapter config path
- create-if-missing behavior is supported
- existing file is never overwritten by default install/reinstall/reinit

### DPG-04 - Implement Local Wizard Core

Status: proposed
Priority: high

Files:

- new CLI/application service files
- `tools/*` or `bin/*`
- tests

Why:

- validated product decision is to use a local wizard instead of a new dependency

Done when:

- a reusable interactive wizard exists using `node:readline/promises`
- wizard supports:
  - `list`
  - `add`
  - `edit`
  - `remove`
  - `save`
  - `cancel`
- write occurs only on explicit save

### DPG-05 - Expose `aidn project config` Command Family

Status: proposed
Priority: high

Files:

- `bin/aidn.mjs`
- CLI routing files
- help docs/tests

Why:

- adapter config should be manageable outside install and reusable in future settings flows

Done when:

- command family exists:
  - `aidn project config`
  - `aidn project config --wizard`
  - `aidn project config --list`
- help output explains interactive and non-interactive usage

### DPG-06 - Add Non-Interactive Adapter Config Failure Path

Status: proposed
Priority: high

Files:

- install flow
- project config command
- tests

Why:

- missing adapter config must not be silently synthesized in non-TTY environments

Done when:

- install stops explicitly when adapter config is missing and no TTY is available
- the error explains how to:
  - rerun with TTY
  - provide explicit config values
  - provide an adapter file

### DPG-07 - Wire Install To Launch Wizard When Adapter Config Is Missing

Status: proposed
Priority: high

Files:

- `src/application/install/*`
- wizard integration tests

Why:

- first install should create adapter config through a guided deterministic flow

Done when:

- if `.aidn/project/workflow.adapter.json` is missing and TTY is available, install launches the wizard
- the wizard can save the adapter config and return control to install
- install then continues using the saved config

### DPG-08 - Build Deterministic Renderer For `WORKFLOW.md`

Status: proposed
Priority: high

Files:

- template renderer services
- `template/docs_audit/PROJECT_WORKFLOW.md`
- tests

Why:

- `WORKFLOW.md` is the main slow/non-deterministic migration target today

Done when:

- generator consumes:
  - template
  - `VERSION`
  - `.aidn/config.json`
  - `.aidn/project/workflow.adapter.json`
- generated output is deterministic
- direct reinstall no longer requires Codex migration for this file

### DPG-09 - Build Deterministic Renderer For `WORKFLOW_SUMMARY.md`

Status: proposed
Priority: high

Files:

- template renderer services
- `template/docs_audit/WORKFLOW_SUMMARY.md`
- tests

Why:

- summary file should align automatically with source branch and runtime policy without manual drift

Done when:

- `WORKFLOW_SUMMARY.md` is generated from template plus config
- reinstall always regenerates it deterministically

### DPG-10 - Build Deterministic Renderer For `CODEX_ONLINE.md`

Status: proposed
Priority: medium

Files:

- template renderer services
- `template/codex/README_CodexOnline.md`
- tests

Why:

- project guidance file should not need Codex migration during reinstall

Done when:

- `CODEX_ONLINE.md` is generated deterministically from template plus config
- no free-form project edits are required in the generated file

### DPG-11 - Build Deterministic Renderer For `index.md`

Status: proposed
Priority: medium

Files:

- template renderer services
- `template/docs_audit/index.md`
- tests

Why:

- current `gowire` drift in `index.md` is stale managed content, not valuable project-owned data

Done when:

- `index.md` becomes fully generated
- it is removed from preserved custom migration behavior

### DPG-12 - Reclassify `baseline/current.md` As Seed-Once Data

Status: proposed
Priority: high

Files:

- install ownership rules
- template copy rules
- tests

Why:

- current baseline file is project memory and must survive reinstall untouched

Done when:

- install creates `baseline/current.md` only if missing
- reinstall never overwrites it

### DPG-13 - Reclassify `baseline/history.md` As Seed-Once Data

Status: proposed
Priority: high

Files:

- install ownership rules
- template copy rules
- tests

Why:

- baseline history is durable project history, not template customization

Done when:

- install creates `baseline/history.md` only if missing
- reinstall never overwrites it

### DPG-14 - Reclassify `parking-lot.md` As Seed-Once Data

Status: proposed
Priority: high

Files:

- install ownership rules
- template copy rules
- tests

Why:

- parked project ideas must survive reinstall and should not trigger Codex migration

Done when:

- install creates `parking-lot.md` only if missing
- reinstall never overwrites it

### DPG-15 - Reclassify `context-snapshot.md` As Runtime State

Status: proposed
Priority: high

Files:

- install ownership rules
- runtime/install tests

Why:

- snapshot is live operational state and should not be rewritten by reinstall

Done when:

- reinstall skips snapshot rewrite
- optional first-time seed behavior exists only when file is absent and no runtime state exists

### DPG-16 - Remove Managed Files From Default Codex Migration Path

Status: proposed
Priority: high

Files:

- `src/application/install/install-use-case.mjs`
- custom-file policy
- tests

Why:

- deterministic generation should replace Codex migration for managed files

Done when:

- generated files are not sent through default Codex migration
- Codex migration remains only as explicit rescue/migration tooling if still retained

### DPG-17 - Add Migration Helper For Existing Installed Repositories

Status: proposed
Priority: high

Files:

- new migration helper/service
- CLI entrypoint
- tests

Why:

- already-installed repositories need a no-loss path into the deterministic model

Done when:

- migration helper can:
  - read current installed workflow files
  - extract stable adapter fields
  - write `.aidn/project/workflow.adapter.json`
  - preserve project-owned data files
  - regenerate managed files
  - emit a migration report

### DPG-18 - Implement `gowire` Extraction Mapping

Status: proposed
Priority: high

Files:

- migration helper logic
- fixtures or migration mapping tests

Why:

- `gowire` is the primary real-world migration target and contains the patterns this remediation is meant to solve

Done when:

- stable `gowire` adapter fields are extracted from current docs
- extracted fields cover:
  - project name
  - source branch
  - runtime policy
  - project constraints
  - CI policy
  - continuity/snapshot policy where applicable

### DPG-19 - Migrate `gowire` Without Data Loss

Status: proposed
Priority: high

Files:

- `G:/projets/gowire/.aidn/project/workflow.adapter.json`
- generated workflow docs in `gowire`
- preserved data files in `gowire`

Why:

- remediation is only complete once it works on the real target repository

Done when:

- `gowire` receives adapter config
- generated files are regenerated deterministically
- `baseline/current.md`, `baseline/history.md`, `parking-lot.md`, and snapshot survive unchanged unless explicit migration logic says otherwise

### DPG-20 - Add Golden Tests For Deterministic Generators

Status: proposed
Priority: high

Files:

- renderer tests
- fixture outputs

Why:

- deterministic generation must be locked with byte-stable expectations

Done when:

- golden tests cover:
  - `WORKFLOW.md`
  - `WORKFLOW_SUMMARY.md`
  - `CODEX_ONLINE.md`
  - `index.md`
- repeated render with identical inputs produces identical output

### DPG-21 - Add Install/Reinstall Idempotence Tests

Status: proposed
Priority: high

Files:

- install fixture tests
- `gowire`-like fixtures

Why:

- this remediation is specifically about resilience across reinstall and reinitialization

Done when:

- tests cover:
  - first install
  - reinstall
  - verify-only
  - reinitialization after install
- preserved files remain untouched
- generated files stabilize after first deterministic regeneration

### DPG-22 - Document Generated vs Preserved vs Runtime-State Ownership

Status: proposed
Priority: high

Files:

- `docs/INSTALL.md`
- template docs
- changelog docs

Why:

- users need a clear contract for which files they may edit directly and which are generated

Done when:

- docs explain ownership classes
- docs explain adapter config purpose and wizard flow
- docs explain reinstall behavior and persistence guarantees

## Sequencing Recommendation

1. DPG-01
2. DPG-02
3. DPG-03
4. DPG-04
5. DPG-05
6. DPG-06
7. DPG-07
8. DPG-08
9. DPG-09
10. DPG-10
11. DPG-11
12. DPG-12
13. DPG-13
14. DPG-14
15. DPG-15
16. DPG-16
17. DPG-17
18. DPG-18
19. DPG-19
20. DPG-20
21. DPG-21
22. DPG-22

## Open Questions

- should the first wizard version support only interactive editing plus `--list`, or also a first pass of non-interactive `--set/--remove`?
- should long-form project-specific prose eventually live in structured JSON only, or should a fragment mechanism be introduced in the first implementation?
- should migration helper output a diff summary file under `.aidn/project/` for auditability?
