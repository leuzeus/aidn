import definitions from "../../../package/catalogs/workflow-evaluations.v1.json" with { type: "json" };
import definitionSchema from "../../core/contracts/workflow-definition/evaluation-definition.v1.schema.json" with { type: "json" };
import resultSchema from "../../core/contracts/workflow-definition/evaluation-result.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import { checkShadowJson, freezeShadow, shadowHash } from "../../core/workflow/shadow-json.mjs";
import { evaluateAgentReuse } from "../../core/agents/agent-reuse-policy.mjs";
import { evaluateStandardCycleValidation } from "../../core/workflow/standard-cycle-verification.mjs";
import { deriveGatingAction } from "../../core/gating/gating-policy.mjs";

function assertContract(value, schema) {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length)
    throw Error("WORKFLOW_EVALUATION_CONTRACT_INVALID");
}

export function createWorkflowEvaluatorRegistry(providers) {
  const installed = new Map();
  for (const { definition, evaluate } of providers) {
    assertContract(definition, definitionSchema);
    const ref = definition.id + "@" + definition.revision;
    if (installed.has(ref) || typeof evaluate !== "function" ||
        new Set(definition.fact_keys).size !== definition.fact_keys.length) throw Error("WORKFLOW_EVALUATOR_INVALID");
    installed.set(ref, { definition: freezeShadow(structuredClone(definition)), evaluate });
  }
  return Object.freeze({
    definitions: Object.freeze([...installed.values()].map(row => row.definition)),
    evaluate(ref, input) {
      const provider = installed.get(ref);
      if (!provider) throw Error("WORKFLOW_EVALUATOR_UNKNOWN");
      const result = { ...provider.evaluate(input), contract_version: "evaluation-result.v1",
        evaluator_ref: ref, execution_status: "completed" };
      assertContract(result, resultSchema);
      if (Object.keys(result.facts).some(key => !provider.definition.fact_keys.includes(key)))
        throw Error("WORKFLOW_EVALUATOR_FACT_UNKNOWN");
      return freezeShadow(structuredClone(result));
    },
  });
}

function gating({ levels }) {
  const details = deriveGatingAction(levels);
  return { details, verdict: details.result, reason_codes: details.reason_code ? [details.reason_code] : [],
    facts: { ["gate_" + details.result]: true }, observed_subject: { ref: "gating-levels", sha256: shadowHash(levels) },
    evidence_refs: [] };
}

function cycle(input) {
  const details = evaluateStandardCycleValidation(input);
  return { details, verdict: details.observations.status, reason_codes: [], facts: details.facts,
    observed_subject: { ref: input.validationOperationId, sha256: details.observations.validation_sha256 },
    evidence_refs: details.evidence_refs };
}

function reuse(input) {
  const details = evaluateAgentReuse(input);
  return { details, verdict: details.decision,
    reason_codes: [...new Set([details.reason_code, ...details.rejected.map(row => row.reason_code)])],
    facts: { ["agent_" + details.decision]: true },
    observed_subject: { ref: input.observation.observation_id, sha256: details.observation_sha256 },
    evidence_refs: details.evidence_refs };
}

const adapters = { gating, cycle_validation: cycle, agent_reuse: reuse };
export const workflowEvaluators = createWorkflowEvaluatorRegistry(definitions.map(definition =>
  ({ definition, evaluate: adapters[definition.id] })));
export const evaluateWorkflow = workflowEvaluators.evaluate;
