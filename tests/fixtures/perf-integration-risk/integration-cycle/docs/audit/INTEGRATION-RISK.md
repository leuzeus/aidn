# Integration Risk

Purpose:

- assess collision and mergeability risk across cycles attached to the active session
- recommend an integration strategy before merge-oriented relay decisions
- keep the decision traceable for later relays and user arbitration

Rule/State boundary:

- this file is a derived digest
- canonical workflow rules remain in `SPEC.md`, `WORKFLOW.md`, and `AGENTS.md`
- cycle state remains in cycle `status.md` and related artifacts

## Summary

updated_at: 2026-03-10T01:08:18.327Z
active_session: S311
active_cycle: none
candidate_cycle_count: 2
overlap_level: medium
semantic_risk: medium
integration_readiness: ready
mergeability: merge_risky
recommended_strategy: integration_cycle
arbitration_required: no
missing_context: no

## Session Topology

- session_file: G:\projets\aidn\tests\fixtures\perf-integration-risk\integration-cycle\docs\audit\sessions\S311.md
- attached_cycles: C311, C312
- integration_target_cycles: C311, C312
- primary_focus_cycle: none

## Candidate Cycles

- C311: type=feature readiness=ready outcome=DONE dor_state=READY
  status: G:\projets\aidn\tests\fixtures\perf-integration-risk\integration-cycle\docs\audit\cycles\C311-feature-auth\status.md
  blockers: none
  referenced_paths: src/auth/controller.js, src/auth/service.js
- C312: type=refactor readiness=ready outcome=DONE dor_state=READY
  status: G:\projets\aidn\tests\fixtures\perf-integration-risk\integration-cycle\docs\audit\cycles\C312-refactor-auth-core\status.md
  blockers: none
  referenced_paths: src/auth/service.js, src/auth/store.js

## Pair Assessments

- C311 <-> C312: overlap=medium
  reason: 1 shared file path(s) were detected
  shared_paths: src/auth/service.js
  shared_modules: src/auth

## Semantic Risk

- overall: medium
- reason: feature+refactor needs explicit integration sequencing

## Recommendation

- mergeability: merge_risky
- recommended_strategy: integration_cycle
- arbitration_required: no
- rationale: cycle type combination requires an explicit integration vehicle

## Strategy Hints

- `direct_merge`: normal Git merge/cherry-pick path is acceptable
- `integration_cycle`: route through a dedicated integration cycle before session integration
- `report_forward`: do not integrate now; defer explicitly
- `rework_from_example`: replay intentionally from source material instead of merging mechanically
- `user_arbitration_required`: stop automatic routing and resolve manually

## Notes

- this digest is conservative and should prefer explicit integration handling over false-safe merge recommendations
- generated file: `docs/audit/INTEGRATION-RISK.md`

