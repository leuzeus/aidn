import path from 'node:path';
import { createStandardWorkflowArtifacts, STANDARD_ARTIFACT_MAX_BYTES } from './standard-workflow-artifacts.mjs';
import { createStandardHandoffContext } from './standard-handoff-context.mjs';
import { createCanonicalHandoffProjection } from './canonical-handoff-projection.mjs';
import { preWriteAdmit } from '../../../tools/runtime/pre-write-admit.mjs';
import { assertHandoffPublicationInput, assertHandoffPublicationPlan, assertHandoffPublicationOutput, handoffPublicationResourceMaterial } from '../../core/workflow/standard-handoff-publication.mjs';
import { assertHandoffResourceResult } from '../../core/workflow/standard-handoff-resources.mjs';
import { shadowHash as H, freezeShadow } from '../../core/workflow/shadow-json.mjs';
import { artifactContentHash } from '../../core/workflow/artifact-compare-swap.mjs';
import { agentRunPhysicalPath, readAgentRunFile } from './agent-run-configuration-service.mjs';

const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const equal = (a, b) => H(a) === H(b);
const target = 'HANDOFF-PACKET.md';
const contextWithoutPacket = ({ context_sha256, documents, ...body }) => ({ ...body, documents: documents.filter(row => row.path !== target) });
function checkPublicationArtifacts(artifacts, context, plan, after = false, metadata = null) {
  const current = context.inspect();
  if (!equal(contextWithoutPacket(current), contextWithoutPacket(plan.context))) fail('STANDARD_HANDOFF_PUBLICATION_CONTEXT_CHANGED');
  for (const row of plan.canonical_sources) if (row.path !== target) {
    const [actual] = artifacts.readMany([row.path], { includeMetadata: true });
    if (actual.sha256 !== row.sha256 || actual.metadata_sha256 !== row.metadata_sha256) fail('STANDARD_HANDOFF_PUBLICATION_SOURCE_CHANGED');
  }
  const [packet] = artifacts.readMany([target], { includeMetadata: true });
  if (packet.sha256 !== (after ? plan.after_sha256 : plan.before_sha256)
    || packet.metadata_sha256 !== (after ? metadata : plan.before_metadata_sha256)) fail('STANDARD_HANDOFF_PUBLICATION_PACKET_CHANGED');
}

// Read-only postimage observation. The fixed caller separately authenticates
// the captured output, terminated producer, released owner and fresh consent.
// This does not re-authorize or replay publication, nor prove resource closure.
export function matchesCompletedHandoffPublication({ targetRoot, readCurrent, plan, packetMetadataSha256 }) {
  assertHandoffPublicationPlan(plan);
  if (packetMetadataSha256 !== null && !/^[a-f0-9]{64}$/.test(packetMetadataSha256 ?? '')) fail('STANDARD_HANDOFF_PUBLICATION_PACKET_CHANGED');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), context = createStandardHandoffContext({ targetRoot, readCurrent });
  checkPublicationArtifacts(artifacts, context, plan, true, packetMetadataSha256);
  if (artifacts.describe().state_mode !== 'db-only') {
    const visible = agentRunPhysicalPath(path.join(artifacts.root, 'docs/audit', target));
    if (readAgentRunFile(visible, { json: false, maxBytes: STANDARD_ARTIFACT_MAX_BYTES }).sha256 !== plan.after_sha256)
      fail('STANDARD_HANDOFF_PUBLICATION_PROJECTION_CHANGED');
  }
  return true;
}

// Read-only state for an explicitly authorized projection continuation. Packet
// content must already equal the original plan. This does not attribute that
// content to the interrupted creator or declare the original operation complete.
export function observeHandoffPublicationPostimages({ targetRoot, readCurrent, plan }) {
  assertHandoffPublicationPlan(plan);
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  const context = createStandardHandoffContext({ targetRoot, readCurrent });
  const [packet] = artifacts.readMany([target], { includeMetadata: true });
  checkPublicationArtifacts(artifacts, context, plan, true, packet.metadata_sha256);
  const mode = artifacts.describe().state_mode;
  let projection = null;
  if (mode !== 'db-only') {
    const file = agentRunPhysicalPath(path.join(artifacts.root, 'docs/audit', target), { missing: true });
    projection = readAgentRunFile(file, { json: false, optional: true, maxBytes: STANDARD_ARTIFACT_MAX_BYTES })?.sha256 ?? null;
    if (projection !== plan.before_sha256 && projection !== plan.after_sha256)
      fail('STANDARD_HANDOFF_PUBLICATION_PROJECTION_CHANGED');
  }
  checkPublicationArtifacts(artifacts, context, plan, true, packet.metadata_sha256);
  return freezeShadow({ state_mode: mode, packet_sha256: packet.sha256, packet_metadata_sha256: packet.metadata_sha256,
    projection_sha256: projection, projection_status: mode === 'db-only' ? 'not_requested'
      : projection === plan.after_sha256 ? 'current' : 'pending' });
}

// This is the canonical packet-write port. The common host must separately
// retain its operation receipt and observe resource closure AFTER owner release
// before declaring a complete handoff. No authored data supplies capabilities.
export function createStandardHandoffPublication({ targetRoot, readCurrent, resources, resourceSourceRef, signer, authorization, now = Date.now }, { boundary = () => {} } = {}) {
  if ([readCurrent, resources?.prepare, resources?.observeForPublication, signer?.verify, authorization?.verify, authorization?.assertCurrent, boundary].some(value => typeof value !== 'function')
    || typeof resourceSourceRef !== 'string' || !resourceSourceRef || resourceSourceRef.length > 256) fail('STANDARD_HANDOFF_PUBLICATION_CAPABILITY_REQUIRED');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), context = createStandardHandoffContext({ targetRoot, readCurrent });
  const producer = createCanonicalHandoffProjection({ targetRoot, readCurrent });
  const active = signal => { if (signal?.aborted) fail('STANDARD_HANDOFF_PUBLICATION_ABORTED'); };
  const currentPermission = input => { if (authorization.assertCurrent(input) !== undefined) fail('STANDARD_HANDOFF_PUBLICATION_AUTHORIZATION_INVALID'); };
  async function prepareAt(input, at, request, signal) {
    active(signal); input = freezeShadow(structuredClone(assertHandoffPublicationInput(input))); signer.verify(request);
    const observed = await resources.observeForPublication(request, { sourceRef: resourceSourceRef, signal }); active(signal);
    if (observed?.status === 'WAITING') return { can_apply: false, status: 'WAITING', written: false, reason_code: 'STANDARD_HANDOFF_RESOURCE_SOURCE_REQUIRED' };
    if (typeof observed?.assertCurrent !== 'function' || typeof observed?.assertSourceCurrent !== 'function') fail('STANDARD_HANDOFF_PUBLICATION_RESOURCE_CAPABILITY_REQUIRED');
    const resource = assertHandoffResourceResult(observed.result); signer.verify(resource);
    if (resource.request_sha256 !== H(request)) fail('STANDARD_HANDOFF_PUBLICATION_RESOURCE_CHANGED');
    const first = await producer.prepare(input, at); active(signal); observed.assertCurrent();
    const second = await producer.prepare(input, at); active(signal); observed.assertCurrent();
    if (!equal(first, second)) fail('STANDARD_HANDOFF_PROJECTION_CHANGED');
    const admission = await preWriteAdmit({ targetRoot: artifacts.root, skill: 'handoff-close' }); active(signal); observed.assertCurrent();
    const canonicalMode = second.context.current.mode.toUpperCase();
    if (!['THINKING', 'EXPLORING', 'COMMITTING'].includes(canonicalMode)
      || String(admission.context?.mode ?? '').toUpperCase() !== canonicalMode
      || admission.activation?.active !== true || admission.ok !== true || !['admitted', 'admitted_with_warnings'].includes(admission.admission_status))
      return { can_apply: false, status: 'BLOCKED', written: false, reason_code: 'STANDARD_HANDOFF_PUBLICATION_NOT_ADMITTED' };
    if (second.projection.packet.handoff_status === 'blocked' || second.projection.consistency?.pass !== true)
      return { can_apply: false, status: 'BLOCKED', written: false, reason_code: 'STANDARD_HANDOFF_PUBLICATION_CONTEXT_BLOCKED' };
    if (!equal(context.inspect(), second.context) || resource.instance_sha256 !== second.context.instance_sha256
      || resource.scope_id !== second.context.scope_id || resource.model_sha256 !== second.context.model_sha256) fail('STANDARD_HANDOFF_PUBLICATION_CONTEXT_CHANGED');
    const resourceMaterial = handoffPublicationResourceMaterial(resource);
    const footer = ['','## Standard execution evidence','',
      'process_instance_id: ' + second.context.instance_id, 'process_instance_sha256: ' + second.context.instance_sha256,
      'resource_request_sha256: ' + H(request), 'resource_material_sha256: ' + resourceMaterial,
      'resource_evidence_class: ' + resource.evidence_class, 'unknown_business_operations: ' + (resource.unknown_business_operations.join(', ') || 'none'),
      'handoff_completion: separate accepted receipt and post-write resource observation required',''].join('\n');
    const content = second.markdown + footer, previous = second.context.documents.find(row => row.path === target);
    const plan = assertHandoffPublicationPlan({ contract_version: 'standard-handoff-publication-plan.v1', operation_ref: 'handoff_packet_publish', input, prepared_at_ms: at,
      context: second.context, projection: second.projection, canonical_sources: second.sources, resource_request: request, resource_material_sha256: resourceMaterial,
      unknown_business_operations: resource.unknown_business_operations, path: target, before_sha256: previous.sha256, before_metadata_sha256: previous.metadata_sha256,
      content, after_sha256: artifactContentHash(content) });
    return { can_apply: true, plan, plan_sha256: H(plan), observation: observed };
  }
  function result(plan, status, reason, { attempted = false, metadata = null } = {}) {
    const confirmed = status === 'packet_written';
    return freezeShadow(assertHandoffPublicationOutput({ contract_version: 'standard-handoff-publication-output.v1', operation_ref: 'handoff_packet_publish', status,
      effect_status: confirmed ? 'confirmed' : status === 'reconciliation_required' ? 'unknown' : 'no_effect', written: confirmed, write_attempted: attempted,
      plan_sha256: H(plan), packet_sha256: confirmed ? plan.after_sha256 : null, packet_metadata_sha256: confirmed ? metadata : null,
      resource_material_sha256: plan.resource_material_sha256, reason_code: reason, complete_resource_closure: false, permits_handoff: false, permits_effects: false,
      evidence_refs: confirmed ? [{ ref: 'docs/audit/' + target, sha256: plan.after_sha256 }] : [] }));
  }
  const check = (plan, after = false, metadata = null) => checkPublicationArtifacts(artifacts, context, plan, after, metadata);
  return Object.freeze({
    async prepare(input, { signal } = {}) {
      const prepared = await prepareAt(input, now(), resources.prepare(), signal);
      if (!prepared.can_apply) return freezeShadow(prepared);
      const { observation, ...data } = prepared; return freezeShadow(data);
    },
    async apply(prepared, { write = false, expectPlan, signal } = {}) {
      const plan = freezeShadow(structuredClone(assertHandoffPublicationPlan(prepared?.plan)));
      if (write !== true || prepared.can_apply !== true || prepared.plan_sha256 !== expectPlan || H(plan) !== expectPlan) fail('STANDARD_HANDOFF_PUBLICATION_EXPLICIT_EFFECT_REQUIRED');
      const permission = { plan, plan_sha256: expectPlan }; active(signal);
      let attempted = false, ownerStarted = false;
      try {
      if (await authorization.verify(permission) !== undefined) fail('STANDARD_HANDOFF_PUBLICATION_AUTHORIZATION_INVALID'); active(signal);
      const fresh = await prepareAt(plan.input, plan.prepared_at_ms, plan.resource_request, signal);
      if (!fresh.can_apply) return result(plan, fresh.status === 'WAITING' ? 'waiting' : 'blocked', fresh.reason_code);
      if (!equal(fresh.plan, plan)) fail('STANDARD_HANDOFF_PUBLICATION_PLAN_CHANGED');
      if (await authorization.verify(permission) !== undefined) fail('STANDARD_HANDOFF_PUBLICATION_AUTHORIZATION_INVALID'); active(signal);
      currentPermission(permission); fresh.observation.assertCurrent(); check(plan);
        ownerStarted = true;
        const output = await artifacts.withLocalEffectOwner(expectPlan, () => {
          try {
            active(signal); artifacts.assertLocalEffectOwner(expectPlan); currentPermission(permission); fresh.observation.assertSourceCurrent(); check(plan);
            if (boundary('before_packet_cas') !== undefined) fail('STANDARD_HANDOFF_PUBLICATION_BOUNDARY_INVALID');
            active(signal); currentPermission(permission); fresh.observation.assertSourceCurrent(); check(plan);
          } catch (cause) { cause.effect_status = 'no_effect'; throw cause; }
          try {
            attempted = true; const changed = artifacts.compareAndSwapPreservingMetadata({ path: target, before_sha256: plan.before_sha256,
              before_metadata_sha256: plan.before_metadata_sha256, after: plan.content });
            if (boundary('after_packet_cas') !== undefined) fail('STANDARD_HANDOFF_PUBLICATION_BOUNDARY_INVALID');
            artifacts.assertLocalEffectOwner(expectPlan); check(plan, true, changed.metadata_sha256);
            artifacts.project([target]);
            if (artifacts.describe().state_mode === 'dual') {
              const visible = agentRunPhysicalPath(path.join(artifacts.root, 'docs/audit', target));
              if (readAgentRunFile(visible, { json: false, maxBytes: STANDARD_ARTIFACT_MAX_BYTES }).sha256 !== plan.after_sha256) fail('STANDARD_HANDOFF_PUBLICATION_PROJECTION_CHANGED');
            }
            artifacts.assertLocalEffectOwner(expectPlan); check(plan, true, changed.metadata_sha256);
            return result(plan, 'packet_written', null, { attempted: true, metadata: changed.metadata_sha256 });
          } catch (cause) { return result(plan, 'reconciliation_required', /^[A-Z][A-Z0-9_]{0,127}$/.test(cause.code ?? '') ? cause.code : 'STANDARD_HANDOFF_PUBLICATION_UNCONFIRMED', { attempted }); }
        });
        if (output.status === 'packet_written' && artifacts.ownerPending()) return result(plan, 'reconciliation_required', 'STANDARD_HANDOFF_PUBLICATION_OWNER_UNCONFIRMED', { attempted });
        return output;
      } catch (cause) { if (!attempted) { if (!ownerStarted) cause.effect_status = 'no_effect'; throw cause; } return result(plan, 'reconciliation_required', 'STANDARD_HANDOFF_PUBLICATION_OWNER_UNCONFIRMED', { attempted }); }
    },
  });
}
