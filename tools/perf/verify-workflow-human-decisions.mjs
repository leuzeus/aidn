import assert from "node:assert/strict";
import { verifyWorkflowHumanDecision } from "../../src/core/workflow/human-decision.mjs";
import { describeStandardHumanQuestion, verifyStandardHumanDecision } from "../../src/application/workflow/standard-human-decision-profiles.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

const subject = { item: "drawing", revision: 7 };
const question = { contract_version: "human-decision-question.v1", prompt: "Approve the reviewed drawing?",
  subject_ref: "drawing", subject_sha256: shadowHash(subject), options: ["approve", "revise"] };
const response = { contract_version: "human-decision-response.v1", authority_id: "reviewer", source_event_id: "event",
  subject_sha256: question.subject_sha256, question_sha256: shadowHash(question), choice: "approve",
  evidence_refs: [{ ref: "drawing", sha256: shadowHash(subject) }] };
const authenticate = original => ({ outcome: "verified", authority_id: original.authority_id, source_sha256: shadowHash(original) });
const verify = (q, source, port = authenticate) => verifyWorkflowHumanDecision({ question: q, source, authenticate: port });
assert.deepEqual((await verify(question, response)).response, response);
await assert.rejects(verify({ ...question, prompt: "Review again?" }, response), { code: "PROCESS_HUMAN_QUESTION_CHANGED" });
await assert.rejects(verify(question, { ...response, subject_sha256: shadowHash({ revision: 8 }) }), { code: "PROCESS_HUMAN_QUESTION_CHANGED" });
await assert.rejects(verify(question, { ...response, choice: "publish" }), { code: "PROCESS_HUMAN_CHOICE_NOT_OFFERED" });
await assert.rejects(verify(question, response, () => ({ outcome: "unverified" })), { code: "PROCESS_HUMAN_NOT_AUTHENTICATED" });
console.log("PASS common response requires the exact subject, question, choice and authenticated source");

const mode = { contract_version: "standard-mode-question.v1", operation_id: "op_" + "1".repeat(40),
  instance_id: "intake", scope_id: "fixture", occurrence_id: "mode", intent_sha256: shadowHash(subject), session_id: "S001",
  choices: ["THINKING", "EXPLORING", "COMMITTING", "refused", "deferred", "cancelled"] };
const claim = { ...response, contract_version: "human-mode-decision.v1", choice: "THINKING", source_kind: "human", question_sha256: shadowHash(mode) };
const common = describeStandardHumanQuestion(mode);
assert.equal(common.subject_sha256, shadowHash(mode));
assert.equal((await verifyStandardHumanDecision(mode, claim, authenticate)).response.question_sha256, shadowHash(common));
await assert.rejects(verifyStandardHumanDecision({ ...mode, session_id: "S002" }, claim, authenticate), { code: "PROCESS_HUMAN_QUESTION_CHANGED" });
await assert.rejects(verifyStandardHumanDecision(mode, claim, () => null), { code: "PROCESS_HUMAN_NOT_AUTHENTICATED" });
console.log("PASS historical mode responses bind the exact signed native question and retain source identity");
