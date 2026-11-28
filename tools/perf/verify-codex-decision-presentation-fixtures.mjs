import assert from "node:assert/strict";
import { createCodexDecisionChannel, codexDecisionForm } from "../../src/adapters/workflow-console/codex-decision-channel.mjs";
import { presentCodexDecision, codexChoiceLabel } from "../../src/adapters/workflow-console/codex-decision-presentation.mjs";
import { operatorOffer, assertOperatorClaim } from "../../src/adapters/workflow-console/standard-operator-offer.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

const common = { operation_id: "op_" + "a".repeat(40), instance_id: "fixture", scope_id: "b".repeat(64),
  occurrence_id: "root/1", intent_sha256: "c".repeat(64), session_id: "S001" };
const evidence = [{ ref: "fixture:completed-cycle", sha256: "d".repeat(64) }];
const baseline = { ...common, contract_version: "standard-baseline-promotion-question.v1",
  review: { session_id: "S001", cycle_id: "C001", cycle_path: "cycles/C001-feature-fixture",
    closure_operation_id: "op_" + "e".repeat(40), closure_output_sha256: "f".repeat(64), context_sha256: "1".repeat(64),
    product_sha256: "2".repeat(64), baseline_sha256: "3".repeat(64), history_sha256: "4".repeat(64),
    current_version: "v0.2", evidence_refs: evidence }, choices: ["promote", "not_requested", "refused", "deferred", "cancelled"] };
const before = shadowHash(baseline), offer = operatorOffer(baseline, "fixture:baseline"), form = codexDecisionForm(offer);
assert.deepEqual(form.request.requestedSchema.required, ["choice"]);
assert.deepEqual(Object.keys(form.request.requestedSchema.properties), ["choice"]);
assert(form.request.message.includes("Référence actuelle : v0.2"));
assert(form.request.message.includes("Proposition : v0.3"));
assert(form.request.message.includes("conservera la référence actuelle"));
assert(form.request.message.includes("cycle C001"));
assert(!/[a-f0-9]{64}/i.test(form.request.message));
assert(!/contract_version|operation_id|_sha256|"review"|[{}]/.test(form.request.message));
assert.deepEqual(form.request.requestedSchema.properties.choice.enum,
  ["Promouvoir la proposition", "Continuer sans promotion", "Refuser", "Reporter la décision", "Annuler la demande"]);
let cases = 1;
function claim(answer, currentOffer = offer) {
  return { ...answer.fields, contract_version: currentOffer.claim_version, source_kind: "human", authority_id: "fixture",
    source_event_id: currentOffer.source_ref, subject_sha256: currentOffer.subject_sha256,
    question_sha256: currentOffer.question_sha256, choice: answer.choice, evidence_refs: evidence };
}
for (const choice of baseline.choices) {
  const decoded = form.read({ choice: codexChoiceLabel(choice) });
  assert.equal(decoded.choice, choice); assertOperatorClaim(claim(decoded), baseline, offer.source_ref);
  assert.deepEqual(decoded.fields.promotion, choice === "promote"
    ? { version: "v0.3", summary: "Résultat validé et clôturé du cycle C001." } : null);
  cases++;
}
for (const content of [{}, { choice: "promote" }, { choice: ["Promouvoir la proposition"] },
  { choice: "Promouvoir la proposition", promotion_version: "v9.9" }, { choice: "Autre choix" }]) {
  assert.throws(() => form.read(content), /CODEX_DECISION_FIELDS_INVALID/); cases++;
}
assert.equal(shadowHash(baseline), before);
const restricted = codexDecisionForm(offer, ["not_requested"]);
assert.deepEqual(restricted.request.requestedSchema.properties.choice.enum, ["Continuer sans promotion"]);
assert.throws(() => restricted.read({ choice: "Promouvoir la proposition" }), /CODEX_DECISION_FIELDS_INVALID/); cases++;
const patchVersion = structuredClone(baseline); patchVersion.review.current_version = "v2.9.7";
assert.equal(presentCodexDecision(operatorOffer(patchVersion, "fixture:patch")).proposal.version, "v2.9.8"); cases++;
const prerelease = structuredClone(baseline); prerelease.review.current_version = "v1.0-preview";
const explicit = codexDecisionForm(operatorOffer(prerelease, "fixture:explicit"));
assert(Object.hasOwn(explicit.request.requestedSchema.properties, "promotion_version"));
assert(Object.hasOwn(explicit.request.requestedSchema.properties, "rationale")); cases++;

const closure = { ...common, contract_version: "standard-cycle-closure-question.v1", review: {
  session_id: "S001", cycle_id: "C001", audit_operation_id: "op_" + "e".repeat(40), audit_output_sha256: "f".repeat(64),
  report_sha256: "1".repeat(64), context_sha256: "2".repeat(64), product_sha256: "3".repeat(64), scope_sha256: "4".repeat(64),
  work_complete: true, pending: { requirements: [], usages: [], documents: [], tests: [], blocking_findings: [], risk_findings_requiring_human_decision: [] }, findings: []
}, choices: ["retain", "no_go", "drop", "refused", "deferred", "cancelled"] };
const closeOffer = operatorOffer(closure, "fixture:closure"), closeForm = codexDecisionForm(closeOffer);
assert.deepEqual(Object.keys(closeForm.request.requestedSchema.properties), ["choice"]);
const kept = closeForm.read({ choice: "Retenir le résultat et clore le cycle" });
assertOperatorClaim(claim(kept, closeOffer), closure, closeOffer.source_ref); cases++;
const risk = structuredClone(closure);
risk.review.pending.risk_findings_requiring_human_decision.push("FINDING-001");
risk.review.findings.push({ id: "FINDING-001", category: "other", severity: "risk", rationale: "This risk must stay visible.", evidence_refs: evidence });
const riskOffer = operatorOffer(risk, "fixture:risk"), riskForm = codexDecisionForm(riskOffer);
assert(riskForm.request.message.includes("This risk must stay visible."));
assert(riskForm.request.requestedSchema.required.includes("rationale"));
assert(Object.hasOwn(riskForm.request.requestedSchema.properties, "risk_acceptances_0_rationale"));
const missingRisk = riskForm.read({ choice: "Retenir le résultat et clore le cycle", rationale: "Reviewed." });
assert.throws(() => assertOperatorClaim(claim(missingRisk, riskOffer), risk, riskOffer.source_ref), /PROCESS_CLOSURE_SOURCE_INVALID/); cases++;
const merge = { ...common, contract_version: "standard-pr-merge-consent-question.v1", choices: ["merge", "refused"],
  subject: { repository_id: "private-node-id", pull_request_number: 7, head_oid: "a".repeat(40), base_ref: "main", scope_sha256: "b".repeat(64) } };
const mergeView = presentCodexDecision({ question: merge, prompt: "Fusionner cette PR ?", repository: "example/project" });
assert(mergeView.message.includes("example/project")); assert(mergeView.message.includes("main"));
assert(mergeView.message.includes("https://github.com/example/project/commit/"));
assert(!mergeView.message.includes("private-node-id")); assert(!mergeView.message.includes("scope_sha256")); cases++;

let registry = [], submissions = 0, observed = [];
const channel = createCodexDecisionChannel({ session: { question: async () => ({ status: "question", offer }),
  session: () => ({ principals: registry }), submit: () => { submissions++; throw Error("UNEXPECTED_SUBMIT"); } },
  formSupported: () => true, elicit: async () => ({ action: "accept", content: { choice: [] }, request_id: "10000000-0000-4000-9000-000000000001" }),
  observeReply: value => { observed.push(structuredClone(value)); value.reply.content.choice = "Promouvoir la proposition"; value.question.review.current_version = "v9.9"; } });
registry = [{ authority_id: "fixture", public_key: channel.describe({}).public_key }];
await assert.rejects(() => channel.decide({}), /CODEX_DECISION_FIELDS_INVALID/);
assert.equal(observed.length, 1); assert.equal(submissions, 0);
assert.deepEqual(observed[0].reply.content.choice, []); assert.equal(shadowHash(observed[0].question), before); cases++;
assert.equal(shadowHash(baseline), before);
console.log(JSON.stringify({ status: "PASS", cases, readable_forms: true, canonical_choices_preserved: true,
  malformed_reply_observed_before_decode: true, live_desktop: "SKIP" }));
