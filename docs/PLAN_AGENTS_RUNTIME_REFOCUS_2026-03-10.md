# Plan AGENTS Runtime Refocus - 2026-03-10

## Objective

Refocus the installed `aidn` workflow so `AGENTS.md` is used for what current Codex reliably honors:

- stable startup guidance
- precedence and routing
- hard stops before durable writes
- minimal read order

And move workflow persistence away from `AGENTS.md` into:

- executable `aidn` hooks
- hydrated runtime context
- short audit artifacts under `docs/audit/*`

This plan is explicitly scoped to the repository state **after package installation** into a client repository.

## Why This Plan Exists

Recent Codex behavior, especially in longer Windows app sessions, suggests the following:

1. `AGENTS.md` is loaded at session start, not continuously re-enforced.
2. Large operational workflows degrade over time when they rely on prompt persistence instead of executable gates.
3. `apply_patch` is not the root cause of workflow drift; it mainly exposes that drift by making writes easy once discipline is already weakening.
4. The current installed `aidn` model still treats `AGENTS.md` too much like a live workflow engine.

The format is not obsolete.
The current **role** assigned to `AGENTS.md` inside `aidn` is partially obsolete.

## External Reference Context

Reference material:

- OpenAI Codex `AGENTS.md` guidance
- global guidance via `~/.codex/AGENTS.md`
- optional `AGENTS.override.md`
- project discovery from Git root to current directory
- configurable fallback names via `project_doc_fallback_filenames`
- size cap via `project_doc_max_bytes`

Key implication for `aidn`:

- package-installed project guidance must assume it is only one layer in a broader Codex instruction chain
- runtime enforcement must not depend on the model faithfully carrying the whole workflow over a long session

## Scope

In scope:

- redefining the responsibility of installed `AGENTS.md`
- reducing prompt-only workflow burden
- making pre-write discipline executable instead of mostly narrative
- improving detection of instruction-precedence conflicts after install
- documenting the split between global, project, and nested instructions
- keeping durable-write gating resilient in long Codex sessions

Out of scope:

- replacing the current cycle/session workflow model
- removing `docs/audit/*`
- removing Codex skills
- introducing a remote coordinator service
- rewriting the entire install system

## Progress Update - 2026-03-10

Completed:

- shortened the installed root `AGENTS.md` into a startup contract
- documented instruction layering, `AGENTS.override.md`, and package-vs-user responsibility
- introduced a dedicated runtime admission command for pre-write readiness

In progress:

- wiring pre-write admission into mutating skills and verification
- surfacing instruction precedence warnings during install and verify

## Problem Summary

Current strengths:

- installed repos already contain a root `AGENTS.md`
- installed repos already contain `.codex/skills.yaml` and local skill sources
- `aidn` already has a DB-backed runtime chain in `dual` / `db-only`
- audit artifacts already hold the real workflow state

Current weaknesses:

1. `AGENTS.md` contains too much operational procedure for a startup-loaded instruction file.
2. Critical workflow safety still depends too much on assistant compliance instead of executable admission checks.
3. Install/verify does not explicitly reason about `AGENTS.override.md` precedence.
4. Installed repos do not expose Codex discovery settings or verification guidance clearly enough.
5. The repo-installed workflow has no explicit separation between:
   - startup contract
   - executable gating
   - live workflow state

## Target Operating Model

After this refocus:

- `AGENTS.md` becomes short, stable, and hard to ignore accidentally
- long workflow procedure lives in skills, runtime hooks, and audit artifacts
- every durable write is guarded by executable checks that can fail closed
- install output and docs explain instruction precedence explicitly
- `AGENTS.override.md` becomes a known and handled part of the model
- the installed repo remains usable even when long-session prompt discipline weakens

## New Responsibility Split

### Layer 1 - Global Codex Guidance

Owner:

- user or organization profile

Artifacts:

- `~/.codex/AGENTS.md`
- `~/.codex/AGENTS.override.md`

Purpose:

- universal work preferences
- organization-wide standards
- non-project-specific defaults

`aidn` policy:

- do not install or mutate this layer
- document it
- assume it may exist and may add or override behavior

### Layer 2 - Project Startup Contract

Owner:

- installed client repository

Artifact:

- root `AGENTS.md`

Purpose:

- minimal workflow contract
- precedence statement
- required initial read path
- durable-write gate summary
- routing toward runtime/skills/artifacts

Rule:

- this file should not carry detailed operational choreography that must remain perfectly enforced over a long session

### Layer 3 - Specialized Local Overrides

Owner:

- installed client repository

Artifacts:

- nested `AGENTS.md`
- nested `AGENTS.override.md`

Purpose:

- team/subtree-specific rules when needed

Rule:

- optional, explicit, and local
- not installed by default by `aidn`
- documented as an advanced pattern

### Layer 4 - Executable Workflow Enforcement

Owner:

- `aidn` runtime and skills

Artifacts:

- `npx aidn codex run-json-hook ...`
- `npx aidn codex hydrate-context ...`
- runtime repair and sync commands

Purpose:

- enforce conditions before write
- compute blocking signals
- project compact state back into human-readable artifacts

Rule:

- workflow safety must live here, not only in prompt prose

### Layer 5 - Live Workflow State

Owner:

- installed client repository + runtime projections

Artifacts:

- `docs/audit/CURRENT-STATE.md`
- `docs/audit/RUNTIME-STATE.md`
- `docs/audit/HANDOFF-PACKET.md`
- cycle/session files

Purpose:

- hold current truth
- survive assistant drift
- support short re-anchor loops

## Design Direction

### D1 - Shrink `AGENTS.md` To A Startup Contract

Direction:

- reduce narrative procedure
- keep only stable rules
- point to the minimal audit reload path
- explicitly state that skills/runtime checks own mutating workflow enforcement

Keep in `AGENTS.md`:

- source-of-truth order
- mandatory reload order
- durable write definition
- hard stop conditions
- requirement to run workflow skills/hooks before mutating work
- precedence note for nested `AGENTS.md`

Move out of `AGENTS.md`:

- long operational checklists
- detailed runtime command chains repeated inline
- advisory prose that is already encoded in skills

Primary target:

- `template/root/AGENTS.md`

### D2 - Add An Executable Pre-Write Admission Step

Direction:

- stop treating pre-write safety as mostly declarative
- add a single command or wrapper step that evaluates write readiness

Admission result should summarize:

- mode
- branch kind
- active session / cycle
- `dor_state`
- plan readiness
- runtime freshness
- repair-layer blocking status
- missing context

Expected effect:

- if Codex drifts, the command still blocks or warns before write

Primary targets:

- runtime CLI
- workflow skills
- projected human-readable audit summary

### D3 - Make Skills The Mandatory Mutating Path

Direction:

- use skills as the state-changing workflow wrapper
- avoid storing full state-change discipline only in `AGENTS.md`

Expected changes:

- every mutating skill must run admission/gating first
- every mutating skill must hydrate short context after execution
- skills should surface a small human-readable outcome

### D4 - Add Instruction Precedence Awareness To Install / Verify

Direction:

- verify not only that `AGENTS.md` exists
- verify whether another file will override it

Warnings should cover:

- root `AGENTS.override.md` present in target repo
- nested overrides detected in known workflow paths
- missing root `AGENTS.md`
- missing or stale `.codex/skills.yaml`
- missing Codex discovery documentation

Primary targets:

- installer output
- verify mode
- troubleshooting docs

### D5 - Document Optional `.codex` Project Config

Direction:

- do not force-install a project Codex config blindly
- provide an optional template/snippet and documentation

Useful options:

- `project_doc_fallback_filenames`
- `project_doc_max_bytes`

Use cases:

- repos wanting `.agents.md` or `TEAM_GUIDE.md`
- repos needing more room than default for instruction files

### D6 - Add Codex-Real Verification Steps

Direction:

- validate actual instruction loading, not just template presence

Recommended documented checks:

- summarize current instructions from repo root
- list active instruction sources from a nested directory
- inspect logs when loaded sources are unclear

Primary targets:

- `docs/INSTALL.md`
- `README.md`
- `docs/TROUBLESHOOTING.md`

## Proposed Deliverables

### Deliverable A - AGENTS Contract Refactor

Files:

- `template/root/AGENTS.md`

Done when:

- file is shorter and more stable
- file routes to runtime/skills instead of restating all dynamic procedure
- file clearly defines durable-write hard stops

### Deliverable B - Pre-Write Admission Runtime

Files:

- runtime CLI / use case(s)
- mutating skill templates

Done when:

- mutating workflow actions can fail closed before write
- admission output exposes missing context and blocking repair findings

### Deliverable C - Install / Verify Precedence Awareness

Files:

- installer logic
- verify logic
- install docs

Done when:

- `AGENTS.override.md` precedence is visible to the installer user
- installed state is easier to diagnose

### Deliverable D - Documentation Split By Layer

Files:

- `README.md`
- `docs/INSTALL.md`
- `template/codex/README_CodexOnline.md`
- `docs/TROUBLESHOOTING.md`

Done when:

- docs clearly separate global, project, nested, runtime, and state layers
- package behavior after install is explicit

## Phased Rollout

### Phase 1 - Clarify The Model

Changes:

- document the new responsibility split
- describe Codex discovery and precedence in package docs
- keep traceable rationale in repo docs

Acceptance:

- a maintainer can explain where each kind of rule belongs

### Phase 2 - Refactor Installed `AGENTS.md`

Changes:

- reduce root template
- keep only startup contract and write-stop rules

Acceptance:

- `AGENTS.md` becomes easier to keep stable
- long-session drift has less workflow surface to ignore

### Phase 3 - Strengthen Runtime Admission

Changes:

- add or formalize pre-write admission command
- wire it into mutating skills

Acceptance:

- durable writes depend on executable readiness, not prompt memory alone

### Phase 4 - Improve Install / Verify Diagnostics

Changes:

- detect overrides
- document actual Codex verification steps

Acceptance:

- precedence conflicts are easier to spot after installation

### Phase 5 - Optional Nested / Fallback Support

Changes:

- add advanced documentation or optional config snippets for fallback names and nested overrides

Acceptance:

- specialized repos can extend the base model without changing the default install story

## Risks

- over-shrinking `AGENTS.md` could hide important hard stops
- adding more runtime gates could increase friction if outputs are unclear
- nested overrides could become another source of confusion if documented poorly
- install-time warnings may produce noise if not clearly scoped

## Mitigations

- keep hard stops and reload path in `AGENTS.md`
- keep admission output short and structured
- treat nested overrides as advanced, opt-in usage
- make warnings advisory unless safety is compromised

## Suggested First Implementation Order

1. document the new model in package docs
2. refactor `template/root/AGENTS.md`
3. add explicit admission/gating command for pre-write checks
4. wire mutating skills to the admission step
5. add install/verify warnings for `AGENTS.override.md`
6. document optional `.codex` project config

## Traceability Note

This plan exists because the observed problem is not "Codex no longer supports `AGENTS.md`".

It is:

- long sessions do not reliably preserve detailed workflow discipline from startup-loaded prompt guidance alone
- therefore `aidn` must reduce the operational burden placed on `AGENTS.md`
- and shift workflow persistence toward executable runtime enforcement plus short state artifacts
