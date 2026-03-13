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

updated_at: template
active_session: none
active_cycle: none
candidate_cycle_count: 0
overlap_level: unknown
semantic_risk: unknown
integration_readiness: unknown
mergeability: insufficient_context
recommended_strategy: user_arbitration_required
arbitration_required: yes
missing_context: yes

## Session Topology

- session_file: missing
- attached_cycles: none
- integration_target_cycles: none
- primary_focus_cycle: none

## Candidate Cycles

- none

## Pair Assessments

- none

## Semantic Risk

- overall: unknown
- reason: template placeholder

## Recommendation

- mergeability: insufficient_context
- recommended_strategy: user_arbitration_required
- arbitration_required: yes
- rationale: template placeholder

## Strategy Hints

- `direct_merge`: normal Git merge/cherry-pick path is acceptable
- `integration_cycle`: route through a dedicated integration cycle before session integration
- `report_forward`: do not integrate now; defer explicitly
- `rework_from_example`: replay intentionally from source material instead of merging mechanically
- `user_arbitration_required`: stop automatic routing and resolve manually

## Notes

- refresh this digest when several cycles attached to the same session may converge
- keep the final integration decision explicit in `USER-ARBITRATION.md` when arbitration is required
