import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { observeHandoffPublicationPostimages } from './standard-handoff-publication.mjs';
import { currentStandardDispatchContext } from './standard-dispatch-context.mjs';
import { createOperationJournalSigner } from '../../core/workflow/process-operation-journal.mjs';
import { assertHandoffOperationPreparation, decodeHandoffPacketPlan, handoffPublicationInterruptedPrefix,
  handoffOperationResult } from '../../core/workflow/standard-handoff-operation.mjs';
import { shadowHash as H, freezeShadow } from '../../core/workflow/shadow-json.mjs';

const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const target = 'HANDOFF-PACKET.md';
const active = signal => { if (signal?.aborted) fail('STANDARD_HANDOFF_CONTINUATION_ABORTED'); };

// Fixed internal capability, never an authored JSON writer or permission. Its
// descriptor is DATA for a future closed disposition plan. Only the exact
// reconciliation controller may supply the borrowed owner and current permit.
// This port can materialize the one already-canonical packet; it has no CAS.
export function createStandardHandoffContinuation({ targetRoot, readSigningKey, readCurrent, readClaimed }, { boundary = () => {} } = {}) {
  if ([readSigningKey, readCurrent, readClaimed, boundary].some(fn => typeof fn !== 'function'))
    fail('STANDARD_HANDOFF_CONTINUATION_CAPABILITY_REQUIRED');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  return Object.freeze({
    prepare(instance, record, { signal: preparationSignal } = {}) {
      active(preparationSignal);
      instance = freezeShadow(structuredClone(instance)); record = freezeShadow(structuredClone(record));
      const signer = createOperationJournalSigner(readSigningKey);
      signer.verify(record); signer.verify(record.preview);
      const prepared = assertHandoffOperationPreparation(record.preview.prepared);
      if (!prepared.can_apply) fail('STANDARD_HANDOFF_CONTINUATION_SUBJECT_REQUIRED');
      const inner = decodeHandoffPacketPlan(prepared.plan);
      signer.verify(inner.resource_request);
      const prefix = handoffPublicationInterruptedPrefix(instance, record);
      const readPrefix = () => {
        const current = readCurrent(instance.instance_id), claimed = readClaimed(record.operation_id);
        signer.verify(claimed); signer.verify(claimed.preview);
        if (H(current) !== H(instance) || H(claimed) !== H(record))
          fail('STANDARD_HANDOFF_CONTINUATION_SUBJECT_CHANGED');
        return prefix;
      };
      const observe = () => {
        active(preparationSignal); readPrefix();
        const value = observeHandoffPublicationPostimages({ targetRoot: artifacts.root, readCurrent: readPrefix, plan: inner });
        readPrefix(); active(preparationSignal); return value;
      };
      const before = observe(), output = handoffOperationResult(prepared, { status: 'packet_written', packet_sha256: inner.after_sha256,
        packet_metadata_sha256: before.packet_metadata_sha256,
        evidence_refs: [{ ref: 'docs/audit/' + target, sha256: inner.after_sha256 }] });
      const data = freezeShadow({ operation_id: record.operation_id, instance_sha256: instance.instance_sha256,
        original_intent_sha256: H(record.intent), original_output_sha256: H(record.results[0].output),
        original_receipt_sha256: H(record.results[0].receipt), packet_plan_sha256: H(inner), owned_paths: [target],
        expected_output: output, expected_output_sha256: H(output), state: before, state_sha256: H(before),
        snapshot_only: true, written: false, complete_resource_closure: false, permits_handoff: false, permits_effects: false });
      const assertCurrent = () => { if (H(observe()) !== data.state_sha256) fail('STANDARD_HANDOFF_CONTINUATION_STATE_CHANGED'); };
      return Object.freeze({ data, assertCurrent,
        async complete({ write = false, assertAuthorizedCurrent, signal } = {}) {
          if (write !== true || typeof assertAuthorizedCurrent !== 'function')
            fail('STANDARD_HANDOFF_CONTINUATION_EXPLICIT_EFFECT_REQUIRED');
          active(preparationSignal); active(signal);
          const borrowed = currentStandardDispatchContext()?.artifactContinuation;
          if (borrowed?.operation_id !== record.operation_id || borrowed.plan_sha256 !== H(inner))
            fail('STANDARD_HANDOFF_CONTINUATION_OWNER_REQUIRED');
          const permit = () => { active(preparationSignal); active(signal); if (assertAuthorizedCurrent() !== undefined)
            fail('STANDARD_HANDOFF_CONTINUATION_CURRENT_PERMISSION_REQUIRED'); };
          permit(); assertCurrent();
          let projectionAttempted = false;
          return artifacts.withLocalEffectOwner(H(inner), () => {
            artifacts.assertLocalEffectOwner(H(inner)); permit(); assertCurrent();
            if (boundary('before_handoff_projection') !== undefined) fail('STANDARD_HANDOFF_CONTINUATION_BOUNDARY_INVALID');
            permit(); assertCurrent();
            const projected = before.projection_status === 'pending';
            if (projected) { projectionAttempted = true; artifacts.project([target]); }
            if (boundary('after_handoff_projection') !== undefined) fail('STANDARD_HANDOFF_CONTINUATION_BOUNDARY_INVALID');
            artifacts.assertLocalEffectOwner(H(inner)); permit();
            const expected = before.state_mode === 'db-only' ? before
              : { ...before, projection_sha256: inner.after_sha256, projection_status: 'current' };
            if (H(observe()) !== H(expected)) fail('STANDARD_HANDOFF_CONTINUATION_POSTIMAGE_CHANGED');
            return Object.freeze({ output, effect_status: 'confirmed', effect_knowledge: 'known_prefix', canonical_written: false, projected });
          }).catch(cause => {
            // The projection call may have written before acknowledgement or a
            // subsequent permission/postimage check failed. Its uncertainty
            // cannot be reclassified by a nested precondition's no-effect flag.
            if (!projectionAttempted) throw cause;
            const code = /^[A-Z][A-Z0-9_]{0,127}$/.test(cause?.code ?? '')
              ? cause.code : 'STANDARD_HANDOFF_CONTINUATION_UNCONFIRMED';
            throw Object.assign(Error(code), { code, cause, effect_status: 'unknown' });
          });
        },
      });
    },
  });
}
