import { checkShadowJson, freezeShadow, shadowHash } from '../../core/workflow/shadow-json.mjs';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import { externalMergeDisposition, externalMergeQuestion, assertExternalMergeDisposition } from '../../core/workflow/standard-pr-external-merge.mjs';
import { assertPostMergeCompleteOutput, postMergeCompleteOperation } from '../../core/workflow/standard-pr-post-merge-complete.mjs';
import { latestIntent, postMergeCompletionSource, postMergeSessionSource } from './standard-session-pr-post-merge-completion.mjs';
import { readExternalMergeForFetch } from './standard-session-pr-external-merge.mjs';
import evidenceSchema from '../../core/contracts/workflow-definition/standard-incident-close-evidence.v1.schema.json' with { type: 'json' };
import sourceSchema from '../../core/contracts/workflow-definition/standard-pr-incident-tracking-source.v1.schema.json' with { type: 'json' };

const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const required = 'STANDARD_PR_INCIDENT_SOURCE_REQUIRED';
const completionRequired = 'STANDARD_PR_INCIDENT_COMPLETION_REQUIRED';
const rulePaths = ['SPEC.md', 'WORKFLOW.md'];

export function standardPrIncidentId(question) {
  if (!Number.isSafeInteger(question?.issued_at_ms) || !/^op_[a-f0-9]{40}$/.test(question.operation_id ?? '')) fail(required);
  const date = new Date(question.issued_at_ms);
  if (!Number.isFinite(date.valueOf()) || !/^\d{4}-/.test(date.toISOString())) fail(required);
  const stamp = date.toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
  return `INC-TMP-${stamp}-${question.operation_id}`;
}

function field(content, name) {
  const rows = content.split(/\r?\n/).filter(line => line.startsWith(name + ':'));
  if (rows.length !== 1) fail(required);
  return rows[0].slice(name.length + 1).split('#')[0].trim();
}

function originLocator(content) {
  const markers = [...content.matchAll(/<!-- aidn:pr-incident-origin:([^\r\n]*?) -->/g)];
  if (markers.length !== 1 || !/^op_[a-f0-9]{40}$/.test(markers[0][1])) fail(required);
  return markers[0][1];
}

function rulesFromSnapshot(snapshot) {
  return rulePaths.map(path => {
    const rows = snapshot?.documents?.filter(row => row.path === path) ?? [];
    if (rows.length !== 1 || !/^[a-f0-9]{64}$/.test(rows[0].sha256 ?? '')) fail(required);
    return { path, sha256: rows[0].sha256 };
  });
}

// Fixed host capability. The marker is only a lookup key: neither a RESOLVED
// field nor a model-supplied boolean establishes resolution or accepted resume.
// This first profile covers the existing L1/L2 external-merge -> R09 route.
export function createStandardPrIncidentEvidence({ artifacts, readAccepted, readPretriage,
  readAlignmentSource, scopeSha, readCurrent, readHumanSource }) {
  if (![readAccepted, readPretriage, readAlignmentSource, scopeSha, readCurrent, readHumanSource].every(value => typeof value === 'function'))
    fail('STANDARD_PR_INCIDENT_CAPABILITY_REQUIRED');

  function accepted(instance, id, binding, reason = required) {
    const source = readAccepted(instance, id, binding, reason), { record, output } = source;
    const receipt = record.results.at(-1)?.receipt;
    const intents = instance.events.filter(event => event.kind === 'operation_intent' && event.intent.operation_id === id);
    const results = instance.events.filter(event => event.kind === 'operation_result' && event.receipt.operation_id === id);
    if (intents.length !== 1 || results.length !== 1 || record.operation_id !== id || record.intent.binding_ref !== binding
      || record.intent.instance_id !== instance.instance_id || record.intent.scope_id !== instance.scope_id
      || shadowHash(intents[0].intent) !== shadowHash(record.intent) || !receipt
      || receipt.intent_sha256 !== shadowHash(record.intent) || receipt.output_sha256 !== shadowHash(output)
      || receipt.outcome !== 'completed' || !['no_effect', 'confirmed'].includes(receipt.effect_status)
      || shadowHash(results[0].receipt) !== shadowHash(receipt)) fail(reason);
    return source;
  }

  function current(instance) {
    const actual = readCurrent(instance.instance_id);
    if (actual.instance_sha256 !== instance.instance_sha256 || actual.scope_id !== instance.scope_id) fail('STANDARD_PR_INCIDENT_CONTEXT_CHANGED');
  }
  function validateSource(value) {
    if (checkShadowJson(value) || validateJsonSchema(value, sourceSchema, '$', { contractKind: 'workflow-definition' }).length) fail(required);
    return freezeShadow(value);
  }
  function originSource(instance, originId) {
    current(instance);
    const origin = accepted(instance, originId, externalMergeDisposition);
    const question = externalMergeQuestion(origin.record), disposition = assertExternalMergeDisposition(origin.output);
    readExternalMergeForFetch(instance, originId, accepted, readPretriage);
    const human = readHumanSource(origin.record), session = postMergeSessionSource({ instance, readAccepted: accepted, artifacts });
    const rules = rulesFromSnapshot(origin.record.preview.snapshot);
    if (disposition.outcome !== 'completed' || !['L1_LOW', 'L2_MEDIUM'].includes(disposition.observations.severity)
      || shadowHash(human) !== disposition.observations.source_sha256 || !/^[a-z][a-z0-9_-]{0,63}$/.test(human.authority_id ?? '')) fail(required);
    if (shadowHash(artifacts.readMany(rulePaths, { required: rulePaths }).map(({ path, sha256 }) => ({ path, sha256 }))) !== shadowHash(rules))
      fail('STANDARD_PR_INCIDENT_RULES_CHANGED');
    current(instance);
    return validateSource({ contract_version: 'standard-pr-incident-tracking-source.v1', instance_id: instance.instance_id,
      scope_id: instance.scope_id, incident_id: standardPrIncidentId(question), origin_operation_id: originId,
      origin_receipt_sha256: shadowHash(origin.record.results.at(-1).receipt), checkpoint_sha256: origin.record.intent.instance_sha256,
      session_id: session.sessionId, owner: 'human:' + human.authority_id, severity: disposition.observations.severity,
      rule_pins: rules, resolution: null });
  }
  function resolutionSource(instance, originId) {
    const source = originSource(instance, originId);
    const completionId = latestIntent(instance, postMergeCompleteOperation)?.operation_id;
    if (!completionId) fail(completionRequired);
    const completion = accepted(instance, completionId, postMergeCompleteOperation, completionRequired);
    const output = assertPostMergeCompleteOutput(completion.output);
    const { plan } = postMergeCompletionSource({ instance, input: completion.record.preview.input,
      readAccepted: accepted, readAlignmentSource, artifacts, scopeSha });
    if (output.outcome !== 'completed' || completion.record.preview.prepared?.can_apply !== true
      || completion.record.preview.prepared.plan_sha256 !== shadowHash(plan)
      || shadowHash(completion.record.preview.prepared.plan) !== shadowHash(plan)
      || output.observations.plan_sha256 !== shadowHash(plan)
      || plan.merge_receipt_sha256 !== source.origin_receipt_sha256 || source.session_id !== plan.session_id) fail(completionRequired);
    const originResult = instance.events.findIndex(event => event.kind === 'operation_result' && event.receipt.operation_id === originId);
    const completionIntent = instance.events.findIndex(event => event.kind === 'operation_intent' && event.intent.operation_id === completionId);
    if (originResult < 0 || completionIntent <= originResult) fail(completionRequired);
    current(instance);
    return validateSource({ ...source, resolution: { completion_operation_id: completionId,
      completion_receipt_sha256: shadowHash(completion.record.results.at(-1).receipt), plan_sha256: shadowHash(plan),
      alignment_operation_id: plan.alignment_operation_id, alignment_receipt_sha256: plan.alignment_receipt_sha256 } });
  }

  return Object.freeze({
    origin: originSource,
    resolution: resolutionSource,
    read(request) {
      if (checkShadowJson(request) || !request || Object.keys(request).sort().join(',') !== 'incident_id,incident_sha256,instance_id'
        || !new RegExp(evidenceSchema.properties.incident_id.pattern).test(request.incident_id)
        || !/^[a-f0-9]{64}$/.test(request.incident_sha256 ?? '') || typeof request.instance_id !== 'string') fail(required);
      const { instance_id, incident_id, incident_sha256 } = request;
      const instance = readCurrent(instance_id), selected = shadowHash(artifacts.describe());
      const incident = artifacts.read(`incidents/${incident_id}.md`, { required: true });
      if (incident.sha256 !== incident_sha256 || field(incident.content, 'incident_id') !== incident_id
        || field(incident.content, 'status') !== 'RESOLVED' || field(incident.content, 'lifecycle_status') !== 'closed') fail(required);

      const originId = originLocator(incident.content);
      const source = resolutionSource(instance, originId), resolution = source.resolution, rules = source.rule_pins;
      if (source.incident_id !== incident_id || field(incident.content, 'severity') !== source.severity
        || field(incident.content, 'session') !== source.session_id || field(incident.content, 'owner') !== source.owner) fail(required);
      const result = {
        contract_version: 'standard-incident-close-evidence.v1', incident_id, incident_sha256,
        instance_id: instance.instance_id, scope_id: instance.scope_id, instance_sha256: instance.instance_sha256,
        checkpoint_sha256: source.checkpoint_sha256,
        resolution_verified: true, resolution_ref: { ref: 'aidn:operation-receipt/' + resolution.alignment_operation_id, sha256: resolution.alignment_receipt_sha256 },
        resume_confirmed: true, resume_ref: { ref: 'aidn:operation-receipt/' + resolution.completion_operation_id, sha256: resolution.completion_receipt_sha256 },
        stop_observed: false, workflow_rules_changed: false, rule_authorization: null,
      };
      if (validateJsonSchema(result, evidenceSchema, '$', { contractKind: 'workflow-definition' }).length) fail(required);
      const after = readCurrent(instance_id);
      if (after.instance_sha256 !== instance.instance_sha256 || after.scope_id !== instance.scope_id
        || shadowHash(artifacts.describe()) !== selected
        || artifacts.read(incident.path, { required: true }).sha256 !== incident_sha256
        || shadowHash(artifacts.readMany(rulePaths, { required: rulePaths }).map(({ path, sha256 }) => ({ path, sha256 }))) !== shadowHash(rules))
        fail('STANDARD_PR_INCIDENT_CONTEXT_CHANGED');
      return freezeShadow(result);
    },
  });
}
