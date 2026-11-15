import { freezeShadow, shadowHash } from '../../core/workflow/shadow-json.mjs';
import { assertPrIncidentCloseInput, assertPrIncidentClosePlan, assertPrIncidentCloseOutput,
  prIncidentCloseIntentPrefix, prIncidentCloseOperation, encodePrIncidentClosurePlan, decodePrIncidentClosurePlan } from '../../core/workflow/standard-pr-incident-close.mjs';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { createStandardIncidentClosure } from './standard-incident-closure.mjs';

const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const same = (left, right) => shadowHash(left) === shadowHash(right);

// Capabilities are fixed by the operation host, never supplied in action JSON.
// The private closure port keeps its original pre-intent plan and all CAS/fence
// checks. This adapter recognizes only the exact current own-intent successor.
export function createStandardPrIncidentClose({ targetRoot, readCurrent, readClaimed,
  createEvidenceReader, observeBoundary, now = Date.now }, { boundary = () => {} } = {}) {
  if (![readCurrent, readClaimed, createEvidenceReader, observeBoundary].every(value => typeof value === 'function'))
    fail('STANDARD_PR_INCIDENT_CLOSE_CAPABILITY_REQUIRED');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  const port = (current, readEvidence) => createStandardIncidentClosure({ targetRoot, now,
    readCurrent: current, readEvidence, observeBoundary }, { boundary });
  function source(reader, instance, input) {
    const value = reader.resolution(instance, input.origin_operation_id);
    if (value.severity !== 'L2_MEDIUM' || value.resolution === null) fail('STANDARD_PR_INCIDENT_CLOSE_SOURCE_REQUIRED');
    return value;
  }
  function matchEvidence(plan, material, instance) {
    const evidence = plan.evidence, resolution = material.resolution;
    const expected = { contract_version: 'standard-incident-close-evidence.v1', incident_id: material.incident_id,
      incident_sha256: plan.incident_sha256, instance_id: instance.instance_id, scope_id: instance.scope_id,
      instance_sha256: instance.instance_sha256, checkpoint_sha256: material.checkpoint_sha256,
      resolution_verified: true, resolution_ref: { ref: 'aidn:operation-receipt/' + resolution.alignment_operation_id,
        sha256: resolution.alignment_receipt_sha256 }, resume_confirmed: true,
      resume_ref: { ref: 'aidn:operation-receipt/' + resolution.completion_operation_id, sha256: resolution.completion_receipt_sha256 },
      stop_observed: false, workflow_rules_changed: false, rule_authorization: null };
    if (!same(evidence, expected)) fail('STANDARD_PR_INCIDENT_CLOSE_EVIDENCE_CHANGED');
    return evidence;
  }
  return Object.freeze({
    async prepare(instance, input) {
      input = freezeShadow(structuredClone(assertPrIncidentCloseInput(input)));
      const reader = createEvidenceReader(readCurrent), material = source(reader, instance, input);
      const prepared = await port(readCurrent, request => reader.read(request)).prepare(instance, { incident_id: material.incident_id });
      if (!same(source(reader, instance, input), material)) fail('STANDARD_PR_INCIDENT_CLOSE_SOURCE_CHANGED');
      matchEvidence(prepared.plan, material, instance);
      const encoded = encodePrIncidentClosurePlan(prepared.plan);
      if (encoded.closure_plan_sha256 !== prepared.plan_sha256) fail('STANDARD_PR_INCIDENT_CLOSE_PLAN_INVALID');
      const plan = assertPrIncidentClosePlan({ contract_version: 'standard-pr-incident-close-plan.v1', operation_ref: prIncidentCloseOperation,
        input, source: material, source_sha256: shadowHash(material), ...encoded });
      return freezeShadow({ can_apply: true, plan, plan_sha256: shadowHash(plan) });
    },
    confirmsOriginal(instance, record, output) {
      instance = freezeShadow(structuredClone(instance));
      const claimed = readClaimed(record.operation_id), claimedSha = shadowHash(claimed);
      if (!same(claimed, record)) fail('STANDARD_PR_INCIDENT_CLOSE_CLAIM_CHANGED');
      const input = assertPrIncidentCloseInput(record.preview.input), prepared = record.preview.prepared;
      const plan = assertPrIncidentClosePlan(prepared?.plan);
      if (prepared.can_apply !== true || prepared.plan_sha256 !== shadowHash(plan) || !same(input, plan.input))
        fail('STANDARD_PR_INCIDENT_CLOSE_PLAN_INVALID');
      output = assertPrIncidentCloseOutput(output);
      if (output.outcome !== 'completed' || output.observations.incident_id !== plan.source.incident_id
        || output.observations.plan_sha256 !== plan.closure_plan_sha256) return false;
      const completed = record.phase === 'receipted' && record.results.length === 1
        && same(record.results[0].output, output)
        && record.results[0].receipt.output_sha256 === shadowHash(output)
        && record.results[0].receipt.intent_sha256 === shadowHash(record.intent)
        && record.results[0].receipt.outcome === 'completed'
        && record.results[0].receipt.effect_status === output.effect_status
        && same(record.results[0].receipt.facts, output.facts);
      if (!(record.phase === 'dispatching' && record.results.length === 0 || completed)) return false;
      // The current journal MAC and full body remain the authenticated claim.
      // This ephemeral pre-receipt view only feeds the original structural
      // own-intent check before acceptance. No record or history is rewritten.
      const originalClaim = completed ? { ...record, phase: 'dispatching', results: [] } : record;
      const prefix = prIncidentCloseIntentPrefix(instance, originalClaim), inner = decodePrIncidentClosurePlan(plan);
      if (inner.instance_sha256 !== prefix.instance_sha256) fail('STANDARD_PR_INCIDENT_CLOSE_PREFIX_CHANGED');
      function current(id) {
        const actual = readCurrent(id);
        if (id !== instance.instance_id || !same(actual, instance) || shadowHash(readClaimed(record.operation_id)) !== claimedSha)
          fail('STANDARD_PR_INCIDENT_CLOSE_CURRENT_CHANGED');
        return prefix;
      }
      const reader = createEvidenceReader(current), material = source(reader, prefix, input);
      if (!same(material, plan.source)) fail('STANDARD_PR_INCIDENT_CLOSE_SOURCE_CHANGED');
      matchEvidence(inner, material, prefix);
      const expectedRefs = inner.traces.map(change => ({ ref: 'docs/audit/' + change.path, sha256: change.after_sha256 }));
      if (!same(output.evidence_refs, expectedRefs)) return false;
      const matches = port(current, request => reader.read(request)).matchesCompletedArtifacts(prefix,
        { can_apply: true, plan: inner, plan_sha256: plan.closure_plan_sha256 });
      if (!same(source(reader, prefix, input), material)) fail('STANDARD_PR_INCIDENT_CLOSE_SOURCE_CHANGED');
      current(instance.instance_id);
      return matches;
    },
    async apply(instance, input, prepared, { operationId, assertAuthorized } = {}) {
      input = freezeShadow(structuredClone(assertPrIncidentCloseInput(input)));
      instance = freezeShadow(structuredClone(instance));
      const plan = freezeShadow(structuredClone(assertPrIncidentClosePlan(prepared?.plan)));
      if (prepared.can_apply !== true || prepared.plan_sha256 !== shadowHash(plan)
        || !same(input, plan.input) || typeof assertAuthorized !== 'function') fail('STANDARD_PR_INCIDENT_CLOSE_EXPLICIT_EFFECT_REQUIRED');
      // readClaimed authenticates the retained MAC and preview, not JSON claims.
      const claimed = readClaimed(operationId), claimedSha = shadowHash(claimed);
      if (claimed.operation_id !== operationId || !same(claimed.preview.prepared, prepared)
        || !same(claimed.preview.input, input)) fail('STANDARD_PR_INCIDENT_CLOSE_CLAIM_CHANGED');
      const prefix = prIncidentCloseIntentPrefix(instance, claimed);
      const inner = freezeShadow(decodePrIncidentClosurePlan(plan));
      if (inner.instance_sha256 !== prefix.instance_sha256) fail('STANDARD_PR_INCIDENT_CLOSE_PREFIX_CHANGED');
      function current(id) {
        const actual = readCurrent(id);
        if (id !== instance.instance_id || !same(actual, instance) || shadowHash(readClaimed(operationId)) !== claimedSha)
          fail('STANDARD_PR_INCIDENT_CLOSE_CURRENT_CHANGED');
        return prefix;
      }
      const reader = createEvidenceReader(current);
      const authenticateSource = () => {
        current(instance.instance_id);
        const material = source(reader, prefix, input);
        if (!same(material, plan.source)) fail('STANDARD_PR_INCIDENT_CLOSE_SOURCE_CHANGED');
        return matchEvidence(inner, material, prefix);
      };
      const readEvidence = request => {
        const evidence = authenticateSource();
        if (request.instance_id !== prefix.instance_id || request.incident_id !== inner.incident_id
          || request.incident_sha256 !== inner.incident_sha256) fail('STANDARD_PR_INCIDENT_CLOSE_EVIDENCE_CHANGED');
        const tracker = artifacts.read(inner.incident_path);
        if (tracker.sha256 !== null) {
          const observed = reader.read(request);
          if (!same(observed, evidence)) fail('STANDARD_PR_INCIDENT_CLOSE_EVIDENCE_CHANGED');
          return observed;
        }
        // The original tracker digest comes from the authenticated preparation.
        // A missing tracker alone is never proof: both exact canonical traces
        // must already exist, with their original metadata CAS postimages.
        for (const change of inner.traces) {
          if (artifacts.read(change.path, { required: true }).sha256 !== change.after_sha256
            || artifacts.metadataHash(change.path) !== change.after_metadata_sha256)
            fail('STANDARD_PR_INCIDENT_CLOSE_RETAINED_TRACE_REQUIRED');
        }
        current(instance.instance_id); return evidence;
      };
      authenticateSource();
      const result = await port(current, readEvidence).apply(prefix,
        { can_apply: true, plan: inner, plan_sha256: plan.closure_plan_sha256 }, {
          write: true, expectPlan: plan.closure_plan_sha256,
          assertAuthorized: async () => { await assertAuthorized(); authenticateSource(); },
        });
      // A known committed prefix is not a no-effect block or a completed operation.
      // Keep the generic receipt unresolved until a separately authorized continuation.
      const partial = result.outcome === 'incomplete' && result.effect_status === 'confirmed';
      return assertPrIncidentCloseOutput({ contract_version: 'standard-pr-incident-close-output.v1', operation_ref: prIncidentCloseOperation,
        outcome: partial ? 'reconciliation_required' : result.outcome === 'incomplete' ? 'blocked' : result.outcome,
        effect_status: partial ? 'unknown' : result.effect_status,
        facts: result.outcome === 'completed' ? { session_pr_incident_cleanup_completed: true } : {},
        observations: { incident_id: result.incident_id, plan_sha256: result.plan_sha256, reason_code: result.reason_code },
        evidence_refs: partial ? [] : result.evidence_refs });
    },
  });
}
