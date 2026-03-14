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

updated_at: 2026-03-10T01:07:43.100Z
active_session: S301
active_cycle: none
candidate_cycle_count: 2
overlap_level: low
semantic_risk: low
integration_readiness: ready
mergeability: merge_safe
recommended_strategy: direct_merge
arbitration_required: no
missing_context: no

## Session Topology

- session_file: G:\projets\aidn\tests\fixtures\perf-integration-risk\direct-merge\docs\audit\sessions\S301.md
- attached_cycles: C301, C302
- integration_target_cycles: C301, C302
- primary_focus_cycle: none

## Candidate Cycles

- C301: type=feature readiness=ready outcome=DONE dor_state=READY
  status: G:\projets\aidn\tests\fixtures\perf-integration-risk\direct-merge\docs\audit\cycles\C301-feature-alpha\status.md
  blockers: none
  referenced_paths: src/api/alpha.js, tests/api/alpha.test.js
- C302: type=feature readiness=ready outcome=DONE dor_state=READY
  status: G:\projets\aidn\tests\fixtures\perf-integration-risk\direct-merge\docs\audit\cycles\C302-feature-beta\status.md
  blockers: none
  referenced_paths: src/ui/beta.js, tests/ui/beta.test.js

## Pair Assessments

- C301 <-> C302: overlap=low
  reason: cycles overlap in module(s): src, tests
  shared_paths: none
  shared_modules: src, tests

## Semantic Risk

- overall: low
- reason: single cycle type set

## Recommendation

- mergeability: merge_safe
- recommended_strategy: direct_merge
- arbitration_required: no
- rationale: cycle types are compatible and overlap is low enough for a normal merge path

## Strategy Hints

- `direct_merge`: normal Git merge/cherry-pick path is acceptable
- `integration_cycle`: route through a dedicated integration cycle before session integration
- `report_forward`: do not integrate now; defer explicitly
- `rework_from_example`: replay intentionally from source material instead of merging mechanically
- `user_arbitration_required`: stop automatic routing and resolve manually

## Notes

- this digest is conservative and should prefer explicit integration handling over false-safe merge recommendations
- generated file: `docs/audit/INTEGRATION-RISK.md`

