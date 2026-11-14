import reviewSchema from '../contracts/workflow-definition/standard-pr-correction-review.v1.schema.json' with { type: 'json' };
import questionSchema from '../contracts/workflow-definition/standard-pr-correction-question.v1.schema.json' with { type: 'json' };
import sourceSchema from '../contracts/workflow-definition/human-pr-correction-decision.v1.schema.json' with { type: 'json' };
import outputSchema from '../contracts/workflow-definition/standard-pr-correction-decision-output.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash } from './shadow-json.mjs';
import { prCorrectionReopenPaths } from './standard-pr-correction-reopen.mjs';
import questionV2 from '../contracts/workflow-definition/standard-pr-correction-question.v2.schema.json' with { type: 'json' };
import sourceV2 from '../contracts/workflow-definition/human-pr-correction-decision.v2.schema.json' with { type: 'json' };
import outputV2 from '../contracts/workflow-definition/standard-pr-correction-decision-output.v2.schema.json' with { type: 'json' };
import questionV3 from '../contracts/workflow-definition/standard-pr-correction-question.v3.schema.json' with { type: 'json' };
import sourceV3 from '../contracts/workflow-definition/human-pr-correction-decision.v3.schema.json' with { type: 'json' };
import outputV3 from '../contracts/workflow-definition/standard-pr-correction-decision-output.v3.schema.json' with { type: 'json' };
const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length;
export const prCorrectionChoices = Object.freeze(['create-correction-cycle', 'refused', 'deferred', 'cancelled']);
export function assertPrCorrectionReview(value) {
  if (!valid(value, reviewSchema) || Buffer.byteLength(JSON.stringify(value)) > 16384
    || shadowHash(value.postimages.map(row => row.path)) !== shadowHash(prCorrectionReopenPaths(value.session_id))
    || value.postimages.some(row => value.state_mode === 'files' ? row.metadata_sha256 !== null : !/^[a-f0-9]{64}$/.test(row.metadata_sha256 ?? '')))
    fail('STANDARD_PR_CORRECTION_REVIEW_INVALID');
  return value;
}
export function assertPrCorrectionQuestion(value) {
  if (!valid(value, value?.contract_version === 'standard-pr-correction-question.v3' ? questionV3 : value?.contract_version === 'standard-pr-correction-question.v2' ? questionV2 : questionSchema)) fail('STANDARD_PR_CORRECTION_QUESTION_INVALID');
  assertPrCorrectionReview(value.review);
  if (value.session_id !== value.review.session_id || shadowHash(value.choices) !== shadowHash(prCorrectionChoices))
    fail('STANDARD_PR_CORRECTION_QUESTION_INVALID');
  return value;
}
export function assertHumanPrCorrectionDecision(value, question) {
  if (!valid(value, value?.contract_version === 'human-pr-correction-decision.v3' ? sourceV3 : value?.contract_version === 'human-pr-correction-decision.v2' ? sourceV2 : sourceSchema) || !value.rationale.trim() || new Set(value.evidence_refs.map(row => row.ref)).size !== value.evidence_refs.length)
    fail('STANDARD_PR_CORRECTION_DECISION_SOURCE_INVALID');
  if (value.contract_version === 'human-pr-correction-decision.v3') {
    const accepted = value.choice === 'create-correction-cycle';
    if (accepted ? !value.selected_cycle || value.cycle_sha256 !== shadowHash(value.selected_cycle)
      : value.selected_cycle !== null || value.cycle_sha256 !== null) fail('STANDARD_PR_CORRECTION_CYCLE_CHOICE_CHANGED');
  }
  if (question) {
    assertPrCorrectionQuestion(question);
    const v3 = question.contract_version === 'standard-pr-correction-question.v3';
    if ((value.contract_version === 'human-pr-correction-decision.v3') !== v3
      || v3 && value.selected_cycle && Number(value.selected_cycle.cycle_id.slice(1)) < question.cycle_constraints.minimum_cycle_number)
      fail('STANDARD_PR_CORRECTION_CYCLE_CHOICE_CHANGED');
    const v2 = question.contract_version === 'standard-pr-correction-question.v2';
    if ((value.contract_version === 'human-pr-correction-decision.v2') !== v2
      || v2 && value.cycle_sha256 !== shadowHash(question.candidate_cycle)) fail('STANDARD_PR_CORRECTION_CYCLE_CHOICE_CHANGED');
    if (value.question_sha256 !== shadowHash(question) || value.subject_sha256 !== shadowHash(question.review)) fail('PROCESS_HUMAN_QUESTION_CHANGED');
    if (!question.choices.includes(value.choice)) fail('PROCESS_HUMAN_CHOICE_NOT_OFFERED');
  }
  return value;
}
export function observeHumanPrCorrectionDecision({ question, decision }) {
  assertHumanPrCorrectionDecision(decision, question);
  const accepted = decision.choice === 'create-correction-cycle';
  return { outcome: accepted ? 'completed' : decision.choice === 'refused' ? 'rejected' : decision.choice, effect_status: 'no_effect',
    facts: accepted ? { session_pr_correction_cycle_requested: true } : {},
    observations: { question_sha256: shadowHash(question), choice: decision.choice, review_sha256: shadowHash(question.review), source_sha256: shadowHash(decision),
      ...(question.contract_version === 'standard-pr-correction-question.v3' ? { candidate_cycle: structuredClone(decision.selected_cycle), cycle_sha256: decision.cycle_sha256 }
        : question.contract_version === 'standard-pr-correction-question.v2' ? { candidate_cycle: structuredClone(question.candidate_cycle), cycle_sha256: decision.cycle_sha256 } : {}) } };
}
export function assertPrCorrectionDecisionOutput(value) {
  if (!valid(value, value?.contract_version === 'standard-pr-correction-decision-output.v3' ? outputV3 : value?.contract_version === 'standard-pr-correction-decision-output.v2' ? outputV2 : outputSchema)) fail('STANDARD_PR_CORRECTION_DECISION_OUTPUT_INVALID');
  if (value.contract_version === 'standard-pr-correction-decision-output.v3') {
    const accepted = value.observations.choice === 'create-correction-cycle';
    if (accepted ? !value.observations.candidate_cycle || value.observations.cycle_sha256 !== shadowHash(value.observations.candidate_cycle)
      : value.observations.candidate_cycle !== null || value.observations.cycle_sha256 !== null) fail('STANDARD_PR_CORRECTION_CYCLE_CHOICE_CHANGED');
  }
  if (value.contract_version === 'standard-pr-correction-decision-output.v2'
    && value.observations.cycle_sha256 !== shadowHash(value.observations.candidate_cycle)) fail('STANDARD_PR_CORRECTION_CYCLE_CHOICE_CHANGED');
  const accepted = value.observations.choice === 'create-correction-cycle';
  if (value.outcome !== (accepted ? 'completed' : value.observations.choice === 'refused' ? 'rejected' : value.observations.choice)
    || shadowHash(value.facts) !== shadowHash(accepted ? { session_pr_correction_cycle_requested: true } : {}))
    fail('STANDARD_PR_CORRECTION_DECISION_OUTPUT_INVALID');
  return value;
}
