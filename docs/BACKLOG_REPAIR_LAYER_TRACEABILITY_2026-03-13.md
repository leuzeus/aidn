# Backlog Repair-Layer Traceability - 2026-03-13

## Goal

Track the concrete follow-up work needed to make repair-layer diagnostics exact and traceable when snapshot references point to cycle artifacts that exist locally but are not yet indexed.

Reference plan:

- `docs/PLAN_REPAIR_LAYER_TRACEABILITY_2026-03-13.md`

## Backlog Items

### RLT-01 - Add Explicit Finding Taxonomy For Cycle Reference Resolution

Status: completed
Priority: high

Files:

- `src/application/runtime/repair-layer-service.mjs`
- any shared runtime finding type helpers

Why:

- separate truly missing cycle references from locally present but non-indexed artifacts

Done when:

- repair-layer can distinguish `missing`, `present_local_untracked`, and `tracked_not_indexed`
- `UNRESOLVED_CYCLE_REFERENCE` is no longer used for all three situations

Progress note:

- repair-layer now distinguishes `missing`, `present_local_untracked`, and `tracked_not_indexed` during cycle status resolution
- `UNTRACKED_CYCLE_STATUS_REFERENCE` and `UNINDEXED_CYCLE_STATUS_REFERENCE` are emitted instead of collapsing all three cases into `UNRESOLVED_CYCLE_REFERENCE`

### RLT-02 - Detect Local Cycle Status Presence Before Declaring A Reference Unresolved

Status: completed
Priority: high

Files:

- `src/application/runtime/repair-layer-service.mjs`
- any supporting path discovery helper

Why:

- avoid false positives when `docs/audit/cycles/CXXX-*/status.md` exists on disk

Done when:

- snapshot/baseline repair lookup checks the local cycle status path pattern before emitting the "absent" finding
- local match behavior is covered by fixtures

Progress note:

- repair-layer now scans local `docs/audit/cycles/*/status.md` before concluding that a cycle reference is absent
- the same local-first resolution path is reused for snapshot/baseline references and session-to-cycle references

### RLT-03 - Introduce Dedicated Findings For Untracked / Unindexed Local Cycle Status

Status: completed
Priority: high

Files:

- `src/application/runtime/repair-layer-service.mjs`
- `tools/runtime/repair-layer-triage.mjs`

Why:

- make triage output actionable and semantically correct

Done when:

- triage can emit a specific finding for "local but untracked"
- triage can emit a specific finding for "tracked but not indexed" if that case is observable
- messages no longer imply the artifact does not exist when it does

Progress note:

- triage now exposes `referenced_cycle_id`, `reference_resolution_state`, `local_artifact_path`, and `git_tracking`
- `UNINDEXED_CYCLE_STATUS_REFERENCE` now carries a `refresh_index` next step, while `UNTRACKED_CYCLE_STATUS_REFERENCE` preserves the local presence diagnosis without claiming the artifact is missing

### RLT-04 - Align Derived Runtime Outputs On One Repair Status Reason

Status: completed
Priority: high

Files:

- runtime state projector / digest helpers
- `docs/audit/CURRENT-STATE.md`
- `docs/audit/RUNTIME-STATE.md`
- `docs/audit/HANDOFF-PACKET.md`
- `docs/audit/MULTI-AGENT-STATUS.md`

Why:

- remove contradictory `clean` vs `warn` states for the same runtime snapshot

Done when:

- all derived outputs share the same primary `repair_layer_status`
- all derived outputs share the same top repair reason
- the behavior is verified in fixtures

Progress note:

- `RUNTIME-STATE.md`, `HANDOFF-PACKET.md`, and `MULTI-AGENT-STATUS.md` now expose the same `repair_primary_reason`
- `CURRENT-STATE.md` now carries the same field in template form, and the skills that maintain it explicitly instruct agents to keep `repair_layer_status` and `repair_primary_reason` aligned with the latest hydrated/runtime digest
- fixture coverage now verifies both the hook/context relay path and the `CURRENT-STATE.md` skill contract

### RLT-05 - Enrich Triage JSON With Resolution Provenance

Status: completed
Priority: medium

Files:

- `tools/runtime/repair-layer-triage.mjs`
- repair-layer triage/report serializers

Why:

- improve traceability from user-visible warning to underlying runtime evidence

Done when:

- triage JSON can optionally include provenance fields such as `source`, `resolution_basis`, `index_visibility`, `detected_local_paths`
- existing consumers remain compatible

Progress note:

- triage JSON now exposes provenance fields directly on each item: `referenced_cycle_id`, `reference_resolution_state`, `local_artifact_path`, and `git_tracking`
- existing repair-layer triage and runtime-state verifiers continue to pass unchanged, so downstream consumers remain compatible

### RLT-06 - Improve `pre-write-admit` Warning Wording

Status: completed
Priority: medium

Files:

- `tools/runtime/pre-write-admit.mjs`

Why:

- prevent users from interpreting a local/non-indexed warning as a broken or missing cycle

Done when:

- pre-write output names the real cause for local-but-non-indexed cycle references
- the wording differentiates workflow inconsistency from indexing lag

Progress note:

- `pre-write-admit` now emits a warning that explicitly distinguishes a local untracked cycle status from a tracked-but-unindexed one
- fixture coverage verifies the non-blocking warning path without changing the admission gate itself

### RLT-07 - Add Fixtures For Snapshot / Local Presence / Index Divergence

Status: completed
Priority: high

Files:

- repair-layer perf fixtures
- current-state/runtime-state consistency fixtures
- any new fixture workspace required for the scenario

Why:

- keep the defect reproducible and prevent regression

Done when:

- fixtures cover absent, local-untracked, and indexed cases
- fixtures assert derived output consistency
- fixture names clearly map to the scenario under test

Progress note:

- `tools/perf/verify-repair-layer-traceability-fixtures.mjs` now reproduces both useful divergence cases: local untracked cycle status and tracked-but-not-indexed cycle status
- the verifier asserts deterministic triage classification and the presence of a `refresh_index` next step for the tracked-but-not-indexed case

### RLT-08 - Document The Scenario In Troubleshooting / Runtime Docs

Status: completed
Priority: medium

Files:

- `docs/TROUBLESHOOTING.md`
- `docs/performance/README.md`
- optional related runtime docs if needed

Why:

- make the behavior understandable for users operating in `dual` or `db-only`

Done when:

- docs explain the difference between missing and non-indexed cycle references
- docs include the expected recovery path
- docs mention when the warning is informational vs workflow-blocking

Progress note:

- `docs/TROUBLESHOOTING.md` now explains the difference between `UNRESOLVED_CYCLE_REFERENCE`, `UNTRACKED_CYCLE_STATUS_REFERENCE`, and `UNINDEXED_CYCLE_STATUS_REFERENCE`
- `docs/performance/README.md` now documents the expected recovery path when the issue is index visibility rather than a missing artifact

## Recommended Execution Order

1. `RLT-01`
2. `RLT-02`
3. `RLT-03`
4. `RLT-07`
5. `RLT-04`
6. `RLT-05`
7. `RLT-06`
8. `RLT-08`
