// Independent expectations for the existing helpers; never a workflow interpreter.
const session = (metadata = {}) => ({
  session_id: "S101", metadata: { session_branch: "S101-example", ...metadata },
});
const cycle = (id = "C101") => ({ cycle_id: id, session_owner: "S101" });
const source = (extra = {}) => ({
  activeSessionArtifact: null, latestSession: null, openCycleTopology: [],
  openCycles: [], resumableOpenCycles: [], sourceBranch: "dev", staleOpenCycles: [], ...extra,
});
const mapped = (extra = {}) => ({
  baseBranch: "S101-example", branchKind: "session",
  mapping: { ambiguous: false, missing: false, mapped_session: session(), mapped_cycle: null },
  openCycles: [], sessions: [session()], mode: "COMMITTING", ...extra,
});
const close = (extra = {}) => ({
  branchKind: "session", cycleDecisions: [], cycleTopology: [], staleReportedCycles: [],
  staleUnresolvedCycles: [], targetSession: session(), unresolvedCycles: [], ...extra,
});
const expected = (action, reason_code = null, required_user_choice = [], extra = {}) => ({
  action, reason_code, required_user_choice, warning_count: 0, ...extra,
});
const test = (id, evaluator, input, expectation) => ({ id, evaluator, input, expected: expectation });

export const transitionCases = [
  test("source_create", "source", source(), expected("create_session_allowed")),
  test("source_choose", "source", source({ openCycles: [cycle(), cycle("C102")], resumableOpenCycles: [cycle(), cycle("C102")] }),
    expected("choose_cycle", "START_SESSION_MULTIPLE_OPEN_CYCLES", ["choose_existing_cycle", "relaunch_by_agent"], { candidate_cycles: ["C101", "C102"] })),
  test("source_resume", "source", source({ openCycles: [cycle(), cycle("C102")], resumableOpenCycles: [cycle()], staleOpenCycles: [cycle("C102")] }),
    expected("resume_current_cycle", "START_SESSION_RESUME_OPEN_CYCLE", [], { mapped_cycle: "C101" })),
  test("source_stale_source", "source", source({ openCycles: [cycle()], staleOpenCycles: [cycle()], openCycleTopology: [["C101", { status: "stale_merged_into_source" }]] }),
    expected("blocked_stale_open_cycle_state", "START_SESSION_STALE_OPEN_CYCLE_MERGED_INTO_SOURCE")),
  test("source_stale_session", "source", source({ openCycles: [cycle()], staleOpenCycles: [cycle()], openCycleTopology: [["C101", { status: "stale_merged_into_session" }]] }),
    expected("blocked_stale_open_cycle_state", "START_SESSION_STALE_OPEN_CYCLE_MERGED_INTO_SESSION")),
  test("source_active_session", "source", source({ activeSessionArtifact: session() }),
    expected("resume_current_session", "START_SESSION_RESUME_OPEN_SESSION", ["continue_existing_session_branch", "override_new_session_with_rationale"], { mapped_session: "S101" })),
  test("previous_unclosed", "source", source({ latestSession: session() }),
    expected("blocked_session_base_gate", "START_SESSION_PREVIOUS_SESSION_NOT_RESOLVED", ["continue_existing_session_branch", "override_new_session_with_rationale"])),
  test("previous_pr_open", "source", source({ latestSession: session({ close_gate_satisfied: true, pr_status: "open" }) }),
    expected("resume_current_session", "START_SESSION_PREVIOUS_SESSION_PR_OPEN", ["continue_existing_session_branch", "override_new_session_with_rationale"], { mapped_session: "S101" })),
  test("previous_pr_closed", "source", source({ latestSession: session({ close_gate_satisfied: true, pr_status: "closed_not_merged" }) }),
    expected("blocked_session_base_gate", "START_SESSION_PREVIOUS_SESSION_PR_CLOSED_NOT_MERGED", ["override_new_session_with_rationale", "resume_previous_session"])),
  test("previous_sync_required", "source", source({ latestSession: session({ close_gate_satisfied: true, pr_status: "merged", post_merge_sync_status: "required" }) }),
    expected("blocked_session_base_gate", "START_SESSION_POST_MERGE_SYNC_REQUIRED", ["run_pr_orchestrate", "sync_source_branch_now"])),
  test("previous_merged", "source", source({ latestSession: session({ close_gate_satisfied: true, pr_status: "merged", post_merge_sync_status: "done" }) }),
    expected("create_session_allowed")),
  test("previous_unknown", "source", source({ latestSession: session({ close_gate_satisfied: true, pr_status: "unknown" }) }),
    expected("blocked_session_base_gate", "START_SESSION_PREVIOUS_SESSION_PR_STATUS_UNKNOWN", ["run_pr_orchestrate", "override_new_session_with_rationale"])),
  test("mapped_ambiguous", "mapped", mapped({ mapping: { ambiguous: true, missing: true } }),
    expected("blocked_ambiguous_topology", "START_SESSION_MAPPING_AMBIGUOUS", ["select_mapping", "repair_mapping"])),
  test("mapped_missing", "mapped", mapped({ mapping: { ambiguous: false, missing: true } }),
    expected("blocked_non_compliant_branch", "START_SESSION_MAPPING_MISSING", ["repair_mapping", "ignore_with_rationale"])),
  test("mapped_choose", "mapped", mapped({ openCycles: [cycle(), cycle("C102")] }),
    expected("choose_cycle", "START_SESSION_MULTIPLE_SESSION_CYCLES", ["choose_existing_cycle", "relaunch_by_agent"], { candidate_cycles: ["C101", "C102"] })),
  test("mapped_session_committing", "mapped", mapped({ openCycles: [cycle()] }),
    expected("resume_current_session", null, [], { warning_count: 1, mapped_session: "S101", mapped_cycle: "C101" })),
  test("mapped_session_thinking", "mapped", mapped({ mode: "THINKING" }),
    expected("resume_current_session", null, [], { mapped_session: "S101", mapped_cycle: null })),
  test("mapped_session_exploring", "mapped", mapped({ mode: "EXPLORING" }),
    expected("resume_current_session", null, [], { mapped_session: "S101", mapped_cycle: null })),
  test("mapped_explicit_focus", "mapped", mapped({ openCycles: [cycle(), cycle("C102")], mapping: { ambiguous: false, missing: false, mapped_session: session({ primary_focus_cycle: "C102" }) } }),
    expected("resume_current_session", null, [], { warning_count: 1, mapped_cycle: "C102", candidate_cycles: ["C102"] })),
  ...["cycle", "intermediate"].map((branchKind) => test(`mapped_${branchKind}`, "mapped", mapped({ branchKind, mapping: { ambiguous: false, missing: false, mapped_cycle: cycle() } }),
    expected("resume_current_cycle", null, [], { mapped_cycle: "C101", mapped_session: "S101" }))),
  test("mapped_unresolved", "mapped", mapped({ branchKind: "other", mapping: {} }),
    expected("blocked_ambiguous_topology", "START_SESSION_UNRESOLVED_CONTINUITY", ["repair_mapping", "ignore_with_rationale"])),
  test("close_missing_session", "close", close({ targetSession: null }),
    expected("blocked_missing_active_session", "CLOSE_SESSION_ACTIVE_SESSION_MISSING", ["reanchor_session", "repair_mapping"])),
  test("close_unresolved", "close", close({ unresolvedCycles: [cycle()] }),
    expected("blocked_open_cycles_require_resolution", "CLOSE_SESSION_OPEN_CYCLE_DECISIONS_MISSING", ["integrate_to_session", "report", "close_non_retained", "cancel_close"], { unresolved_cycles: ["C101"] })),
  test("close_stale_unresolved", "close", close({ unresolvedCycles: [cycle()], staleUnresolvedCycles: [cycle()] }),
    expected("blocked_stale_open_cycles_require_regularization", "CLOSE_SESSION_STALE_OPEN_CYCLE_DECISION_MISSING", ["integrate_to_session", "close_non_retained", "cancel_close"], { unresolved_cycles: ["C101"] })),
  test("close_stale_report", "close", close({ staleReportedCycles: [{ cycle: cycle(), topology: {} }] }),
    expected("blocked_stale_reported_cycles_require_regularization", "CLOSE_SESSION_STALE_REPORTED_CYCLE_ALREADY_MERGED", ["integrate_to_session", "close_non_retained", "cancel_close"], { unresolved_cycles: ["C101"] })),
  test("close_allowed", "close", close(), expected("close_session_allowed", null, [], { cycle_decisions: [] })),
  test("close_outside_session", "close", close({ branchKind: "cycle" }), expected("close_session_allowed", null, [], { warning_count: 1 })),
  test("repair_block", "repair", { status: "block", advice: "", blocking: false }, { routing_hint: "repair", severity: "blocked" }),
  test("repair_explicit_block", "repair", { status: "clean", advice: "", blocking: true }, { routing_hint: "repair", severity: "blocked" }),
  test("repair_warning", "repair", { status: "warn", advice: "Review findings", blocking: false }, { routing_hint: "audit-first", severity: "warning" }),
  test("repair_clear", "repair", { status: "clean", advice: "", blocking: false }, { routing_hint: "execution-or-audit", severity: "clear" }),
  test("repair_ok", "repair", { status: "ok", advice: "", blocking: false }, { routing_hint: "execution-or-audit", severity: "clear" }),
  test("repair_unknown", "repair", { status: "", advice: "", blocking: false }, { routing_hint: "reanchor", severity: "unknown" }),
];
