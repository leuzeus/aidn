import summaryInput from '../contracts/workflow-definition/standard-handoff-summary-input.v1.schema.json' with { type: 'json' };
import summaryPlan from '../contracts/workflow-definition/standard-handoff-summary-plan.v1.schema.json' with { type: 'json' };
import summaryOutput from '../contracts/workflow-definition/standard-handoff-summary-output.v1.schema.json' with { type: 'json' };
import prepareInput from '../contracts/workflow-definition/standard-handoff-prepare-input.v1.schema.json' with { type: 'json' };
import preparePlan from '../contracts/workflow-definition/standard-handoff-prepare-plan.v1.schema.json' with { type: 'json' };
import prepareOutput from '../contracts/workflow-definition/standard-handoff-prepare-output.v1.schema.json' with { type: 'json' };
import admissionInput from '../contracts/workflow-definition/standard-handoff-admission-input.v1.schema.json' with { type: 'json' };
import admissionOutput from '../contracts/workflow-definition/standard-handoff-admission-output.v1.schema.json' with { type: 'json' };
import gitInput from '../contracts/workflow-definition/standard-handoff-git-input.v1.schema.json' with { type: 'json' };
import gitPlan from '../contracts/workflow-definition/standard-handoff-git-plan.v1.schema.json' with { type: 'json' };
import gitOutput from '../contracts/workflow-definition/standard-handoff-git-output.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash as H } from './shadow-json.mjs';
import { artifactContentHash } from './artifact-compare-swap.mjs';
const fail = () => { throw Object.assign(Error('STANDARD_HANDOFF_PREPARATION_INVALID'), { code: 'STANDARD_HANDOFF_PREPARATION_INVALID' }); };
const valid = (value, schema) => { if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length) fail(); return value; };
export const handoffPreparationOperations = Object.freeze(['handoff_summary_prepare', 'handoff_git_checkpoint', 'handoff_prepare', 'handoff_admit']);
const inputs = { handoff_summary_prepare: summaryInput, handoff_git_checkpoint: gitInput, handoff_prepare: prepareInput, handoff_admit: admissionInput };
const plans = { handoff_summary_prepare: summaryPlan, handoff_prepare: preparePlan };
const outputs = { handoff_summary_prepare: summaryOutput, handoff_prepare: prepareOutput, handoff_admit: admissionOutput };
export function assertHandoffPreparationInput(operation, value) { if (!inputs[operation]) fail(); return valid(value, inputs[operation]); }
export function handoffPreparationPaths(sessionId) { return ['CURRENT-STATE.md', 'RUNTIME-STATE.md', 'sessions/' + sessionId + '.md', 'snapshots/context-snapshot.md']; }
export function assertHandoffPreparationPlan(value) {
  valid(value, plans[value?.operation_ref] ?? fail());
  const sessionId = value.session_id ?? value.input.session_id;
  if (H(value.documents.map(row => row.path)) !== H(handoffPreparationPaths(sessionId))
    || value.operation_ref === 'handoff_summary_prepare' && artifactContentHash(value.after_chunks.join("")) !== value.after_sha256) fail();
  return value;
}
export function assertHandoffPreparation(value) {
  if (value?.can_apply === false) { if (Object.keys(value).sort().join(',') !== 'can_apply,reason_code' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(value.reason_code)) fail(); return value; }
  if (Object.keys(value ?? {}).sort().join(',') !== 'can_apply,plan,plan_sha256' || value.can_apply !== true
    || H(assertHandoffPreparationPlan(value.plan)) !== value.plan_sha256) fail();
  return value;
}
export function assertHandoffPreparationOutput(value) {
  const operation = value?.operation_ref; valid(value, outputs[operation] ?? fail());
  const fact = { handoff_summary_prepare: 'handoff_summary_prepared', handoff_prepare: 'handoff_preparation_completed', handoff_admit: 'handoff_packet_admitted' }[operation];
  if (value.outcome === 'completed') {
    if (value.effect_status !== (operation === 'handoff_admit' ? 'no_effect' : 'confirmed') || H(value.facts) !== H({ [fact]: true })) fail();
    const o = value.observations;
    if (operation === 'handoff_summary_prepare' && (!o.decision_operation_id || !o.session_id || !o.mode || !o.documents)) fail();
    if (operation === 'handoff_prepare' && (!o.summary_operation_id || !o.git_operation_id || !o.session_id || !o.documents || !o.completed_stages || !o.skipped_stages)) fail();
    if (operation === 'handoff_admit' && (o.admitted !== true || !['admitted', 'admitted_with_warnings'].includes(o.admission_status)
      || o.permits_handoff !== false || o.permits_effects !== false || !o.packet_sha256 || !o.payload_sha256)) fail();
    if (o.documents && H(o.documents.map(row => row.path)) !== H(handoffPreparationPaths(o.session_id))) fail();
  } else {
    if (H(value.facts) !== H({}) || value.evidence_refs.length || !value.observations.reason_code
      || value.effect_status !== (value.outcome === 'blocked' ? 'no_effect' : 'unknown')) fail();
  }
  return value;
}

export const assertHandoffGitPlan = value => {
  valid(value, gitPlan);
  if (H(value.documents.map(row => row.path)) !== H(handoffPreparationPaths(value.session_id))) fail();
  return value;
};
export function assertHandoffGitOutput(value) {
  valid(value, gitOutput);
  if ((value.outcome === 'reconciliation_required') !== (value.effect_status === 'unknown')
    || value.outcome !== 'completed' && Object.keys(value.facts).length
    || value.outcome === 'completed' && (value.facts.handoff_git_checkpoint_completed !== true
      || value.facts.handoff_git_checkpoint_created !== (value.observations.git?.status === 'confirmed')
      || !['confirmed', 'no_effect'].includes(value.effect_status))) fail();
  return value;
}
