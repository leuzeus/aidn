# Shadow workflow parity

Lot 1 describes the current audit-informed workflow without changing execution.
SPEC remains canonical. ADR-0015 is proposed; the descriptors have no production authority.
The source baseline is dev at eaf87bd (0.11.0). Package-source tests are not installed-client or native qualification.
Lot 2 adds pure compilation of descriptor revision 2; see `docs/WORKFLOW_SHADOW_COMPILATION.md` and ADR-0016. The matrix below retains the evidence types and claims of the lot 1 gate.

## Artifacts

- Internal schema: `src/core/contracts/workflow-definition/workflow-definition.v1.schema.json`.
- Current descriptor: `tests/fixtures/workflow-shadow/audit-informed.v1.json`.
- Alternate descriptor: `tests/fixtures/workflow-shadow/diagnostic-correction.v1.json`.
- Machine-readable rule/evidence matrix: `tests/fixtures/workflow-shadow/parity-matrix.v1.json`.
- Independent expected observations: `tests/fixtures/workflow-shadow/transition-cases.mjs`.

## Rule matrix

Classification assigns primary ownership for future extraction. The boundary preserves mixed obligations; no rule is moved or relaxed in this lot.

| Rule | Primary classification | Retained obligations | Boundary | Evidence IDs |
|---|---|---|---|---|
| SPEC-R01 | audit_informed_profile | Reload -> start -> explicit mode -> COMMITTING mapping audit; DB-backed modes require blocking DB-backed hooks. | Sequence belongs to the profile; canonical authority and refusal on unavailable backend remain engine invariants. | session_sequence, start_admission, mapped_choices, canonical_modes |
| SPEC-R02 | audit_informed_profile | THINKING, EXPLORING, COMMITTING retain current permissions and retained-exploration conversion. | Mode is distinct from delivery lane and native assurance. No relaxation of native write admission. | mode_semantics, mapped_choices |
| SPEC-R03 | engine_invariant | COMMITTING has one traceable owner; session work is integration/handoff/orchestration unless an explicit exception exists. | Current session/cycle handlers retain these preconditions; sessions/cycles are not made universal workflow primitives. | branch_ownership, mapped_choices |
| SPEC-R04 | project_policy | Core DoR: ownership, objective, scope/non-scope, first step, constraints and required usage_matrix; adaptive depth by cycle type. | Mandatory core remains invariant. Only adaptive depth and configured thresholds belong to project policy; existing adapter remains canonical. | definition_of_ready, convergence |
| SPEC-R05 | audit_informed_profile | Mandatory drift-check on suspicion; findings, recovery choices and explicit change handling before continuation. | No automated inference of human suspicion or acceptance; existing drift gates remain authoritative. | drift_procedure |
| SPEC-R06 | audit_informed_profile | Select R1/R2/R3 before creating a branch; R2 needs predecessor import; R3 needs rationale and accepted risk; mismatch stops for user choice. | Explicit intent and coherent ownership are engine invariants; continuity strategy belongs to the profile. | cycle_continuity |
| SPEC-R07 | audit_informed_profile | Drift check and explicit per-open-cycle resolution, close notes/snapshots, review-ready PR handoff; mandatory DB constraint chain in dual/db-only. | Missing/stale canonical context refuses; resolved outcome and nested checkpoint success stay distinct from admission. | close_decisions, cycle_completion, pr_lifecycle, canonical_modes |
| SPEC-R08 | audit_informed_profile | Push/open-or-recover/triage/merge; valid threads fixed and tested, invalid threads explained; unresolved threads require explicit documented rationale. | PR routing is tested; actual review and merge authority remain human/provider evidence. | pr_lifecycle, review_procedure |
| SPEC-R09 | engine_invariant | After merge identify branch, fetch source, compare divergence; reconcile before new session/cycle; ambiguous strategy requires human choice. | Git continuity is enforced by existing handlers; shadow data authorizes no fetch, merge or reconciliation. | post_merge, pr_lifecycle |
| SPEC-R10 | audit_informed_profile | Incident triage L1-L4; L1 local repair, L2 tracked repair, L3/L4 STOP and authorization before rule edits; resume checkpoint and retain concise history. | Project-specific triggers may live in the adapter; severity stop/authorization obligations cannot be weakened. | incident_procedure |
| SPEC-R11 | engine_invariant | Reload required; COMMITTING audit required; skills do not decide or duplicate rules; missing audit state stops; shared-risk validation must converge across usages. | Definition is reference_data, never a second normative authority. Promotion stays DONE-only and all existing obligations remain. | invariants, session_sequence, branch_ownership, convergence, promotion |

## Evidence matrix

`assertion` entries execute against existing helpers in the new gate. `suite_reference` entries point to complementary existing tests and must be run separately. `procedure` entries require retained human/workflow evidence; source linkage alone cannot pass them. `declaration` establishes expressibility only.

| Evidence ID | Kind | Source / anchor | Expected proof |
|---|---|---|---|
| session_sequence | procedure | docs/SPEC.md / SPEC-R01 | Record context-reload then start-session, explicit mode and COMMITTING branch audit; hooks alone do not prove the human sequence. |
| start_admission | assertion | src/application/runtime/workflow-transition-lib.mjs / evaluateSourceBranchTransition | Actions, reason codes, mapped identities and explicit choices match the existing source-branch helper. |
| mapped_choices | assertion | src/application/runtime/workflow-transition-lib.mjs / evaluateMappedBranchTransition | Ambiguous/missing mappings refuse; multiple candidates require selection; explicit focus chooses the matching cycle. |
| mode_semantics | procedure | docs/SPEC.md / SPEC-R02 | THINKING does not implement, EXPLORING retained work enters a cycle, COMMITTING retains ownership. Warning behavior is covered separately by mapped_choices. |
| branch_ownership | suite_reference | tools/perf/verify-branch-cycle-audit-admission-fixtures.mjs / missing_session_mapping_blocks | Existing CLI fixtures admit unique owners and refuse missing mapping; complete_cycle_warning_propagates retains nested warnings. |
| cycle_continuity | suite_reference | tools/perf/verify-cycle-create-admission-fixtures.mjs / source_branch_requires_choice | Source requires explicit choice; session R2 and latest-cycle R1 pass; canonical unavailable/ambiguous context refuses. |
| definition_of_ready | suite_reference | tools/perf/verify-start-session-admission-fixtures.mjs / CASES | Existing COMMITTING admission keeps canonical objective, scope, first step, constraints and project-adapter DoR checks. |
| drift_procedure | procedure | docs/SPEC.md / SPEC-R05 | Suspected drift invokes drift-check; confirmed drift records recovery and parking-lot/CR/cycle/scope decision before resuming. |
| incident_procedure | procedure | docs/SPEC.md / SPEC-R10 | L1 can self-repair; L2 retains temporary evidence; L3/L4 stop and require human authorization before changing rules. |
| convergence | procedure | docs/SPEC.md / SPEC-R11 | Validate declared usage_matrix with meaningful non-primary usage; one passing nominal case cannot establish shared-surface stability. |
| cycle_completion | suite_reference | tools/perf/verify-cycle-close-completion-fixtures.mjs / main | Terminal cycle closure keeps canonical evidence and propagates nested warning/refusal; terminal checkpoint does not reactivate a cycle. |
| promotion | procedure | docs/SPEC.md / Only DONE cycles are eligible | Only retained DONE cycles may be promoted; non-retained outcomes keep history and cannot enter the session baseline. |
| close_decisions | assertion | src/application/runtime/workflow-transition-lib.mjs / evaluateCloseSessionTransition | Missing session, unresolved/stale cycles and stale report refuse; resolved close retains decisions and outside-session warning. |
| pr_lifecycle | suite_reference | tools/perf/verify-pr-orchestrate-admission-fixtures.mjs / push_required_without_upstream | Existing CLI fixtures distinguish push, open PR, await review, post-merge sync and canonical lifecycle refusals. |
| review_procedure | procedure | docs/SPEC.md / SPEC-R08 | Triage valid/invalid Codex threads with evidence and resolve or record explicit rationale before merge; await_review is not proof of human review. |
| post_merge | assertion | src/application/runtime/workflow-transition-lib.mjs / evaluateLatestSessionContinuation | Merged with pending sync refuses a new session; reconciled merge permits it. |
| invariants | assertion | src/application/runtime/workflow-transition-lib.mjs / evaluateRepairRouting | Block overrides clean; warning routes audit-first; unknown reanchors; clear permits execution-or-audit. |
| canonical_modes | suite_reference | tools/perf/verify-start-session-canonical-fixtures.mjs / verifyCanonicalStartSession | files/dual/db-only honor configured PostgreSQL, reject unavailable authority and stale/misleading projections; SQLite canonical reads preserve storage. |
| alternate_macro | declaration | docs/ADR/ADR-0015-shadow-workflow-definition.md / Second macro path | Same schema expresses diagnosis, human approval, correction, review and at most two review-to-correction returns, then stop. No compiler/executor is claimed. |

Each descriptor edge links SPEC rules and expected evidence. Edge outcome names are descriptive labels, not new runtime result codes. The helper cases independently check actual actions, reason codes, user choices, warnings, candidate/owner identities and close decisions. The gate requires coverage of every shared action/reason, with two wrapper-only reasons linked to existing start-session fixtures.

## Compatibility and limits

- Nominal: source creation, session/cycle/intermediate resume, close and post-merge reconciliation.
- Alternate: THINKING/EXPLORING behavior, explicit focus among several cycles, and the second macro topology under the same schema.
- Adversarial: ambiguous/missing mapping, stale merged cycles, unknown PR state, unresolved close, conflicting repair status and malformed descriptors.
- Existing canonical-admission and state-mode suites cover files/dual/db-only, configured unavailable PostgreSQL, stale projections and the existing adapter without any binding.
- Lot 2 separately checks pure compilation and single-transition explanations.
  Later opt-in bindings, durable instances, reviewed selection and the console
  are covered by their own suites; see [integrated qualification](qualification/WORKFLOW_0_12.md).
  This shadow corpus grants no default binding, handler execution or automatic
  instance migration. Its historical 0.11.0 context and golden hashes remain fixed.

The current graph retains procedural re-entry through existing admission after drift/incident resolution. It adds no bound to the current workflow. The alternate graph declares exactly two review-to-correction returns, then stop; the lot 1 gate checks that declaration, while the compilation gate checks pure explanations through exhaustion. Neither executes a runtime retry loop.

## Verification

Run `npm run perf:verify-workflow-shadow` for this corpus. Run the complementary admission, context-completion and state-mode suites described in `docs/TESTING.md` for unchanged runtime behavior. The shared validator also retains its public CLI and agent-execution contract checks. ASSURED routing still selects the complete PR obligation set; focused local evidence alone does not establish Governance Admission or merge readiness.
