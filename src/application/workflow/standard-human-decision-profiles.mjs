import { assertHumanModeDecision, assertModeQuestion, assertHumanRecoveryDecision, assertRecoveryQuestion } from "../../core/workflow/process-decision-inbox.mjs";
import { assertHumanSpikeDecision, assertSpikeQuestion } from "../../core/workflow/standard-spike-decision.mjs";
import { assertWorkflowDecisionQuestion, verifyWorkflowHumanDecision } from "../../core/workflow/human-decision.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";

const mode = { prompt: "Select the session mode", verifyQuestion: assertModeQuestion, check: assertHumanModeDecision, reviewSubject: false };
const recovery = { prompt: "Select the drift recovery decision", verifyQuestion: assertRecoveryQuestion, check: assertHumanRecoveryDecision, reviewSubject: false };
const spike = { prompt: "Select the spike decision", verifyQuestion: assertSpikeQuestion, check: assertHumanSpikeDecision, reviewSubject: true };
const profiles = new Map([
  ["standard-mode-question.v1", mode],
  ["standard-drift-recovery-question.v1", recovery],
  ["standard-drift-recovery-question.v2", { ...recovery, reviewSubject: true }],
  ["standard-spike-question.v1", spike], ["standard-spike-question.v2", spike],
]);
export const usesWorkflowHumanDecision = question => profiles.has(question.contract_version);

export function describeStandardHumanQuestion(request) {
  const profile = profiles.get(request.contract_version);
  if (!profile) throw Error("WORKFLOW_DECISION_PROFILE_UNKNOWN");
  profile.verifyQuestion(request);
  const requestHash = shadowHash(request);
  return assertWorkflowDecisionQuestion({ contract_version: "human-decision-question.v1", prompt: profile.prompt,
    options: request.choices, subject_ref: request.operation_id, source_question_sha256: requestHash,
    subject_sha256: profile.reviewSubject ? shadowHash(request.review) : requestHash });
}

export function verifyStandardHumanDecision(request, source, authenticate) {
  const profile = profiles.get(request.contract_version);
  const question = describeStandardHumanQuestion(request);
  return verifyWorkflowHumanDecision({ question, source, authenticate, projectResponse(claim, current) {
    profile.check(claim, request);
    if (claim.question_sha256 !== current.source_question_sha256)
      throw Object.assign(Error("PROCESS_HUMAN_QUESTION_CHANGED"), { code: "PROCESS_HUMAN_QUESTION_CHANGED" });
    return { contract_version: "human-decision-response.v1", authority_id: claim.authority_id,
      source_event_id: claim.source_event_id, question_sha256: shadowHash(current),
      subject_sha256: profile.reviewSubject ? claim.subject_sha256 : claim.question_sha256,
      choice: claim.choice, evidence_refs: claim.evidence_refs };
  } });
}
