# Plan - Product Self-Host Standardization

Date: 2026-03-13
Status: completed
Scope: reduce path and mental-model collisions between the `aidn` product repository, installed client-runtime artifacts, and future self-host/dogfooding workspaces.

## Problem Statement

The `aidn` product repository currently mixes several surfaces that look similar but do not have the same role:

- product source and internal tooling
- installable scaffold/template sources
- local runtime state
- installed-repo fixtures
- future self-host workspaces

This is manageable for package development, but it becomes confusing when the same repository is also used as a runtime target or as a reference while working on installed projects.

The main collision patterns are:

- the scaffold source tree still mirrors an already-installed repository shape
- root `.aidn/` can be mistaken for the runtime of an installed client repo
- `docs/` in the product repo coexists with installed `docs/audit/*` conventions
- `tools/` contains product/dev tooling while installed repos run `npx aidn ...`

The goal is to make the product repository structurally explicit so `aidn` can be used to develop `aidn` without path ambiguity or workflow collisions.

## Goals

- clearly separate product-internal surfaces from installed-runtime surfaces
- make self-host / dogfooding workspaces explicit and isolated
- preserve the installed client contract already used by `aidn`
- keep `dual` and `db-only` runtime semantics unchanged
- avoid breaking install, verify, migration, or existing generated artifact behavior

## Non-Goals

- no redesign of the installed client layout
- no rename of `docs/audit/*`, `.aidn/project/*`, `.aidn/runtime/*`, `.codex/*`, or `AGENTS.md` inside installed repos
- no workflow contract rewrite
- no change to runtime storage semantics

## Design Principle

Keep the installed contract stable. Standardize the product repository around explicit namespaces.

That means:

1. installed client paths remain the public contract
2. product-internal assets must no longer look like live installed artifacts when avoidable
3. self-hosting must happen in a dedicated workspace, not by treating the product root as a client repo

## Current Collision Map

### 1. Scaffold vs Installed Repo Shape

Current source tree:

- `scaffold/docs_audit/*`
- `scaffold/codex/*`
- `scaffold/root/*`

Issue:

- this looks very close to a real installed repo surface
- contributors can confuse scaffold source files with live runtime artifacts

### 2. Root Runtime Directory Ambiguity

Current local convention:

- root `.aidn/`

Issue:

- in client repos, `.aidn/` is the runtime/config contract
- in the product repo, a root `.aidn/` looks like a real client installation even when it is only local product state

### 3. Product Docs vs Installed Workflow Docs

Current product docs:

- `docs/*`

Installed generated docs:

- `docs/audit/*`

Issue:

- when dogfooding from the product repo, the distinction between product documentation and installed workflow artifacts is not explicit enough

### 4. Product Devtools vs Installed Commands

Current product tooling:

- `tools/*`

Issue:

- product tooling and installed package entrypoints both drive workflow behavior
- contributors can assume a repo-local `tools/*` path is part of the installed contract when it is not

## Recommended Standardization Target

### 1. Rename `template/` To `scaffold/`

Recommendation:

- rename `template/` to `scaffold/`

Why:

- `scaffold` clearly signals source material for installation/generation
- reduces confusion with a live installed repo
- keeps the role readable in code, docs, and contributor guidance

Example target structure:

- `scaffold/docs_audit/*`
- `scaffold/codex/*`
- `scaffold/root/*`
- `scaffold/fragments/*`
- `scaffold/runtime_agents/*`

### 2. Reserve Root `.aidn/` For Installed-Repo Semantics Only

Recommendation:

- stop using root `.aidn/` as the product repo’s dogfooding/runtime scratch space

Replace with one explicit product-local namespace, for example:

- `.aidn-dev/`
- or `tmp/selfhost-runtime/`

Why:

- `.aidn/` is already the public runtime/config contract in installed repos
- reusing the same path in the product repo creates avoidable ambiguity

Preferred rule:

- root `.aidn/` in the product repo should either not exist, or exist only when the product repo has intentionally been installed as a client target in a dedicated self-host workspace

### 3. Introduce A Dedicated Self-Host Workspace

Recommendation:

- add a dedicated workspace such as:
  - `playgrounds/selfhost-product/`
  - or `tests/workspaces/selfhost-product/`

Why:

- self-hosting should be explicit
- install/reinstall/verify can run there without polluting the product root
- path semantics become unambiguous

Required behavior:

- the workspace behaves like a client repo
- installation happens there via the package entrypoints
- any runtime `.aidn/` inside that workspace is legitimate and expected

### 4. Clarify Product Tooling Naming

Recommendation:

- keep `tools/` as-is for now; evaluate a rename only if the gain later justifies the churn

Why:

- this is helpful, but less critical than `template -> scaffold` and runtime namespacing
- many references and tests currently assume `tools/*`

Decision guidance:

- do not make this a prerequisite for self-host safety
- treat it as an optional second-wave cleanup

## Compatibility Strategy

### Installed Contract Must Stay Stable

Keep unchanged:

- `docs/audit/*`
- `.aidn/project/workflow.adapter.json`
- `.aidn/runtime/*`
- `.aidn/config.json`
- `.codex/*`
- `AGENTS.md`

### Product-Internal Migration Must Be Layered

Recommended order:

1. update path abstractions and helper libs to stop hardcoding scaffold roots
2. rename source directories
3. update install/render/test tooling
4. create the self-host workspace contract
5. remove reliance on product-root `.aidn/`

### Self-Host Must Respect Existing Runtime Modes

Self-host workspace must continue to support:

- `files`
- `dual`
- `db-only`

No part of this plan should make runtime-visible artifacts JSON-only.

## Testing Requirements

The migration is only acceptable if these still pass after standardization:

- install/verify fixtures
- generated-doc golden tests
- workflow adapter migration tests
- visibility tests for `dual` / `db-only`
- self-host workspace smoke test

Additional required checks:

- no remaining product code should assume `template/` after the rename
- no tests should rely on product-root `.aidn/` as a valid client-runtime target

## Risks

### Risk 1 - Wide Path Churn

Renaming `template/` to `scaffold/` affects many product files and tests.

Mitigation:

- do path abstraction first
- migrate in one cohesive lot
- rely on grep-based verification and install tests

### Risk 2 - Breaking Existing Product Scripts

Mitigation:

- add compatibility helpers or perform complete same-lot updates
- verify all package entrypoints and perf tooling after the rename

### Risk 3 - Half-Migrated Self-Host Semantics

Mitigation:

- do not advertise self-hosting from the product root
- add a documented dedicated workspace before claiming support

### Risk 4 - Confusing Fixture Repositories With Real Self-Host Workspaces

Mitigation:

- keep fixtures under `tests/fixtures/*`
- create a separately named self-host workspace path
- document the difference explicitly

## Outcome

Delivered:

- `template/` was renamed to `scaffold/`
- install/render/test references were updated to the new product-internal namespace
- root product scratch policy now points to `.aidn-dev/`
- the canonical self-host workspace path is `tests/workspaces/selfhost-product/`
- a self-host smoke verification now exists
- current decision keeps `tools/` unchanged

## Acceptance Criteria

The standardization is complete when:

- `template/` has been replaced by the clearer product-internal namespace `scaffold/`
- product-root `.aidn/` is no longer used as ambiguous runtime scratch state
- a dedicated self-host workspace exists and is documented
- install, verify, migration, and DB-backed visibility tests still pass
- the installed client contract remains unchanged

## Recommended Delivery Order

1. define path policy and self-host workspace contract
2. abstract scaffold/template path lookup
3. rename `template/` to `scaffold/`
4. update install/render/test references
5. move product-local runtime scratch usage away from root `.aidn/`
6. add self-host workspace smoke coverage
7. document product-vs-installed-vs-selfhost boundaries

## Recommendation

This standardization is worth doing.

The highest-value, lowest-regret moves are:

- `template/` -> `scaffold/`
- reserving root `.aidn/` for installed-repo semantics only
- adding an explicit self-host workspace

These changes reduce cognitive collision without destabilizing the installed workflow contract.
