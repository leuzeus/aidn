import assert from "node:assert/strict";
import fs from "node:fs";
import { renderStandardCycleClose, cycleClosePaths, cycleCloseCompletionPaths, renderStandardCycleCloseCompletion } from "../../src/core/workflow/standard-cycle-close-render.mjs";
import { cycleClosureChoices } from "../../src/core/workflow/standard-cycle-closure-decision.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash, checkShadowJson } from "../../src/core/workflow/shadow-json.mjs";
const H = "a".repeat(64), op = char => "op_" + char.repeat(40), cyclePath = "cycles/C001-feature-fixture";
const report = { contract_version: "standard-cycle-audit-report.v1", context_sha256: H, cycle_id: "C001",
  requirements: [{ requirement_ref: "REQ-001", status: "supported", rationale: "Observed fixture criterion", evidence_refs: [{ ref: "fixture:check", sha256: H }] }],
  usages: [{ usage_index: 1, status: "supported", rationale: "Observed nominal usage", evidence_refs: [{ ref: "fixture:check", sha256: H }] }],
  document_reviews: [{ ref: "audit:SPEC.md", sha256: H, status: "reviewed", rationale: "Reviewed canonical specification", evidence_refs: [{ ref: "audit:SPEC.md", sha256: H }] }],
  findings: [], recommendation: "request_closure_review", evidence_refs: [{ ref: "fixture:check", sha256: H }] };
function fixture(choice = "retain", pending = false) {
  const audit = structuredClone(report); if (pending) audit.requirements[0].status = "unsatisfied";
  const review = { session_id: "S001", cycle_id: "C001", audit_operation_id: op("a"), audit_output_sha256: H, report_sha256: shadowHash(audit), context_sha256: H,
    product_sha256: H, scope_sha256: H, work_complete: true, findings: [], pending: { requirements: pending ? ["REQ-001"] : [], usages: [], documents: [], tests: [], blocking_findings: [], risk_findings_requiring_human_decision: [] } };
  const question = { contract_version: "standard-cycle-closure-question.v1", operation_id: op("b"), instance_id: "fixture", scope_id: "fixture", occurrence_id: "root/decide", intent_sha256: H,
    session_id: "S001", review, choices: cycleClosureChoices(review) };
  const decision = { contract_version: "human-cycle-closure-decision.v1", source_kind: "human", authority_id: "fixture_operator", source_event_id: "close:event:001",
    subject_sha256: shadowHash(review), question_sha256: shadowHash(question), choice, rationale: "Explicit fixture disposition after reviewing exact evidence", risk_acceptances: [], evidence_refs: [{ ref: "fixture:operator", sha256: H }] };
  let status = fs.readFileSync(new URL("../../scaffold/docs_audit/cycles/TEMPLATE_STATUS.md", import.meta.url), "utf8");
  for (const [key, value] of Object.entries({ state: "VERIFYING", branch_name: "feature/C001-fixture", session_owner: "S001", scope_frozen: "true", dor_state: "READY", outcome: "ACTIVE" }))
    status = status.replace(new RegExp("^" + key + ":[^\\r\\n]*", "m"), key + ": " + value);
  status += "\nupdated_at: 2026-11-02T00:00:00.000Z\n";
  const texts = [status, "# Traceability\n\n## Status\n- Planned evidence only.\n", "# Audit\n\n## Planned tests\n- TEST-001\n", "# Decisions\n- Existing design decision preserved.\n",
    "# Snapshot\n\n## Active cycles\n- C001: OPEN — fixture\n- C002: OPEN — other work\n\n## Recently closed\n- C003: DONE\n\n## Next entry point\n- old action\n",
    "# Current\nupdated_at: 2026-11-02T00:00:00.000Z\nmode: COMMITTING\nactive_cycle: C001\ndor_state: READY\nfirst_plan_step: old task\n"];
  return { cyclePath, context: { mode: "COMMITTING", cycle_state: "VERIFYING", context_use: "active_cycle", cycle_id: "C001", session_id: "S001", product_sha256: H, branch: "feature/C001-fixture" },
    question, decision, report: audit, decisionOperationId: op("b"), preparedAt: 1793664000000,
    documents: cycleClosePaths(cyclePath).map((path, index) => ({ path, content: texts[index], sha256: artifactContentHash(texts[index]) })) };
}
function rebind(value) {
  value.question.review.report_sha256 = shadowHash(value.report); value.question.review.findings = structuredClone(value.report.findings);
  value.question.choices = cycleClosureChoices(value.question.review); value.decision.subject_sha256 = shadowHash(value.question.review); value.decision.question_sha256 = shadowHash(value.question);
}
const text = (result, name) => result.changes.find(row => row.path.endsWith(name)).text_chunks.join("");
let checks = 0; const pass = name => { checks++; console.log("PASS " + name); };
const base = fixture(), before = shadowHash(base), done = renderStandardCycleClose(base);
assert.equal(done.target_state, "DONE"); assert.equal(done.changes.length, 6); assert.equal(shadowHash(base), before); assert.equal(checkShadowJson(done), null);
assert.match(text(done, "status.md"), /^state: DONE$/m); assert.match(text(done, "status.md"), /^usage_matrix_state: VERIFIED$/m);
assert.match(text(done, "CURRENT-STATE.md"), /^active_cycle: none$/m); assert.match(text(done, "CURRENT-STATE.md"), /^dor_state: unknown$/m);
assert.ok(text(done, "context-snapshot.md").includes("- C002: OPEN")); assert.ok(text(done, "context-snapshot.md").includes("- C003: DONE"));
assert.match(text(done, "context-snapshot.md"), /C001: DONE; closure hook pending/); assert.ok(text(done, "decisions.md").includes("Existing design decision"));
assert.match(text(done, "traceability.md"), /skill completion remain pending/); pass("pure six-document transition preserves other cycles/history and leaves hook completion pending");
for (const choice of ["no_go", "drop"]) {
  const result = renderStandardCycleClose(fixture(choice, true)); assert.equal(result.target_state, choice === "no_go" ? "NO_GO" : "DROPPED");
  assert.match(text(result, "status.md"), /^usage_matrix_state: PARTIAL$/m); assert.match(text(result, "traceability.md"), /unsatisfied/);
  assert.equal(text(result, "decisions.md").includes('"risk_acceptances": []'), true);
}
pass("non-retained outcomes preserve unmet criteria and do not accept residual risks implicitly");
for (const choice of ["refused", "deferred", "cancelled"]) assert.throws(() => renderStandardCycleClose(fixture(choice)), { code: "STANDARD_CYCLE_CLOSE_SOURCE_INVALID" });
pass("refusal, deferral and cancellation cannot render a terminal metadata write");
const risky = fixture(); risky.report.findings.push({ id: "FINDING-001", category: "gap", severity: "risk", rationale: "Concrete bounded residual risk", evidence_refs: report.evidence_refs });
risky.question.review.pending.risk_findings_requiring_human_decision.push("FINDING-001"); rebind(risky);
assert.throws(() => renderStandardCycleClose(risky), { code: "PROCESS_CLOSURE_RISK_DECISION_REQUIRED" });
risky.decision.risk_acceptances.push({ finding_id: "FINDING-001", rationale: "Explicit human acceptance for this exact reviewed product" });
assert.match(text(renderStandardCycleClose(risky), "decisions.md"), /Explicit human acceptance/); pass("only explicit exact human risk acceptance enters the decision trail");
for (const mutate of [v => v.context.product_sha256 = "b".repeat(64), v => v.context.branch = "feature/C999-other", v => v.context.session_id = "S002", v => v.context.cycle_state = "DONE", v => v.context.context_use = "cycle_completion", v => v.documents[0].sha256 = H]) {
  const value = fixture(); mutate(value); assert.throws(() => renderStandardCycleClose(value));
}
pass("foreign code, ownership, phase and document preimages refuse before rendering effects");
const large = fixture(); large.documents[3].content += "😀".repeat(12000); large.documents[3].sha256 = artifactContentHash(large.documents[3].content);
const largeResult = renderStandardCycleClose(large); assert.equal(checkShadowJson(largeResult), null);
for (const row of largeResult.changes) { assert.ok(row.text_chunks.every(part => part.length <= 8192)); assert.equal(artifactContentHash(row.text_chunks.join("")), row.after_sha256); }
assert.ok(text(largeResult, "decisions.md").includes("😀".repeat(12000))); pass("long Unicode documents preserve bytes through bounded chunks without relaxing scalar limits");
for (const mutate of [v => { v.documents[3].content += "\n## Process cycle closure\nold record\n"; }, v => { v.documents[4].content = v.documents[4].content.replace("- C001: OPEN — fixture\n", ""); }, v => { v.documents[5].content = v.documents[5].content.replace("active_cycle: C001", "active_cycle: C002"); }]) {
  const value = fixture(); mutate(value); for (const row of value.documents) row.sha256 = artifactContentHash(row.content); assert.throws(() => renderStandardCycleClose(value));
}
pass("existing closure records, missing snapshot ownership and conflicting active focus require reconciliation");
for (const choice of ['retain', 'no_go', 'drop']) {
  const input = fixture(choice, choice !== 'retain'), terminal = renderStandardCycleClose(input);
  const names = cycleCloseCompletionPaths(cyclePath);
  const documents = names.map(path => { const row = terminal.changes.find(row => row.path === path), content = row.text_chunks.join(''); return { path, content, sha256: artifactContentHash(content) }; });
  const data = { cyclePath, context: { ...input.context, cycle_state: terminal.target_state, context_use: 'cycle_completion' }, documents,
    runId: 'process_close_' + 'c'.repeat(40), eventSha256: H, completedAt: input.preparedAt + 1000 };
  const before = shadowHash(data), completed = renderStandardCycleCloseCompletion(data);
  assert.equal(shadowHash(data), before); assert.equal(completed.length, 3);
  const current = completed[2].text_chunks.join(''), snapshot = completed[1].text_chunks.join('');
  assert.ok(!current.includes('Finalize the cycle-close hook')); assert.ok(snapshot.includes('cycle-close checkpoint completed')); assert.ok(snapshot.includes('C002: OPEN'));
  assert.match(completed[0].text_chunks.join(''), /"cycle_close_completed": true/);
  assert.throws(() => renderStandardCycleCloseCompletion({ ...data, eventSha256: 'not-evidence' }));
  assert.throws(() => renderStandardCycleCloseCompletion({ ...data, context: { ...data.context, cycle_state: 'VERIFYING' } }));
}
pass('checkpoint completion updates only its three current artifacts after an exact event binding and preserves non-retained outcomes');
console.log(JSON.stringify({ status: "PASS", checks, proof: "pure-terminal-metadata-renderer", authority: "fixture", actual_writes: "NOT_RUN", final_hook: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
