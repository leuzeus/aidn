import questionSchema from "../contracts/workflow-definition/human-decision-question.v1.schema.json" with { type: "json" };
import responseSchema from "../contracts/workflow-definition/human-decision-response.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, freezeShadow, shadowHash } from "./shadow-json.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
function checked(value, schema, code) {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length) fail(code);
  return freezeShadow(structuredClone(value));
}

export function assertWorkflowDecisionQuestion(value) {
  const question = checked(value, questionSchema, "PROCESS_HUMAN_QUESTION_INVALID");
  if (new Set(question.options).size !== question.options.length) fail("PROCESS_HUMAN_QUESTION_INVALID");
  return question;
}

// The trusted host supplies both the legacy projection (if any) and the port
// that authenticates the original source. The returned digest identifies the
// original signed claim even when its schema predates the common response.
export async function verifyWorkflowHumanDecision({ question, source, authenticate, projectResponse = claim => claim }) {
  const current = assertWorkflowDecisionQuestion(question);
  if (checkShadowJson(source)) fail("PROCESS_HUMAN_SOURCE_INVALID");
  const claim = freezeShadow(structuredClone(source));
  const response = checked(projectResponse(claim, current), responseSchema, "PROCESS_HUMAN_SOURCE_INVALID");
  if (response.subject_sha256 !== current.subject_sha256 || response.question_sha256 !== shadowHash(current))
    fail("PROCESS_HUMAN_QUESTION_CHANGED");
  if (!current.options.includes(response.choice)) fail("PROCESS_HUMAN_CHOICE_NOT_OFFERED");
  if (typeof authenticate !== "function") fail("PROCESS_HUMAN_AUTHORITY_UNAVAILABLE");
  const proof = await authenticate(claim, current);
  if (proof?.outcome !== "verified" || proof.authority_id !== response.authority_id || proof.source_sha256 !== shadowHash(claim))
    fail("PROCESS_HUMAN_NOT_AUTHENTICATED");
  return freezeShadow({ response, proof: structuredClone(proof) });
}
