import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { observeHandoffPublicationPostimages, observeHandoffPublicationBeforeimages } from './standard-handoff-publication.mjs';
import { currentStandardDispatchContext } from './standard-dispatch-context.mjs';
import { createOperationJournalSigner } from '../../core/workflow/process-operation-journal.mjs';
import { assertHandoffOperationPreparation, decodeHandoffPacketPlan, handoffPublicationInterruptedPrefix, handoffPublicationUnreturnedPrefix, handoffPublicationBeforeEffectPrefix, handoffBeforeEffectProfile, handoffBeforeEffectReason,
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
  function prepare(instance, record, { signal: preparationSignal, originalResultCount = 1 } = {}) {
      if (![0,1].includes(originalResultCount)) fail('STANDARD_HANDOFF_CONTINUATION_SUBJECT_REQUIRED');
      active(preparationSignal);
      instance = freezeShadow(structuredClone(instance)); record = freezeShadow(structuredClone(record));
      const signer = createOperationJournalSigner(readSigningKey);
      signer.verify(record); signer.verify(record.preview);
      const prepared = assertHandoffOperationPreparation(record.preview.prepared);
      if (!prepared.can_apply) fail('STANDARD_HANDOFF_CONTINUATION_SUBJECT_REQUIRED');
      const inner = decodeHandoffPacketPlan(prepared.plan);
      signer.verify(inner.resource_request);
      const prefix = (originalResultCount === 0 ? handoffPublicationUnreturnedPrefix : handoffPublicationInterruptedPrefix)(instance, record);
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
      const { context_sha256, documents, ...boundaryContext } = inner.context;
      const data = freezeShadow({ source_sha256: H(inner.canonical_sources.filter(row => row.path !== target)),
        boundary_sha256: H({ ...boundaryContext, documents: documents.filter(row => row.path !== target) }), operation_id: record.operation_id, instance_sha256: instance.instance_sha256,
        original_intent_sha256: H(record.intent), original_result_count: originalResultCount,
        original_output_sha256: originalResultCount ? H(record.results[0].output) : null,
        original_receipt_sha256: originalResultCount ? H(record.results[0].receipt) : null, packet_plan_sha256: H(inner), owned_paths: [target],
        expected_output: output, expected_output_sha256: H(output), state: before, state_sha256: H(before),
        snapshot_only: true, written: false, complete_resource_closure: false, permits_handoff: false, permits_effects: false });
      const assertCurrent = () => { if (H(observe()) !== data.state_sha256) fail('STANDARD_HANDOFF_CONTINUATION_STATE_CHANGED'); };
      return Object.freeze({ data, assertCurrent,
        async complete({ write = false, assertAuthorizedCurrent, signal } = {}) {
          let projectionAttempted = false;
          try {
            if (write !== true || typeof assertAuthorizedCurrent !== 'function')
              fail('STANDARD_HANDOFF_CONTINUATION_EXPLICIT_EFFECT_REQUIRED');
            active(preparationSignal); active(signal);
            const borrowed = currentStandardDispatchContext()?.artifactContinuation;
            if (borrowed?.operation_id !== record.operation_id || borrowed.plan_sha256 !== H(inner))
              fail('STANDARD_HANDOFF_CONTINUATION_OWNER_REQUIRED');
            const permit = () => { active(preparationSignal); active(signal); if (assertAuthorizedCurrent() !== undefined)
              fail('STANDARD_HANDOFF_CONTINUATION_CURRENT_PERMISSION_REQUIRED'); };
            permit(); assertCurrent();
            return await artifacts.withLocalEffectOwner(H(inner), () => {
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
            });
          } catch (cause) {
            // This fixed port has only one possible business write. Classify its
            // own projection, independently of an authority callback's error tag.
            const code = /^[A-Z][A-Z0-9_]{0,127}$/.test(cause?.code ?? '')
              ? cause.code : 'STANDARD_HANDOFF_CONTINUATION_UNCONFIRMED';
            throw Object.assign(Error(code), { code, cause, effect_status: projectionAttempted ? 'unknown' : 'no_effect' });
          }
        },
      });
  }
  const describeData = data => freezeShadow({ profile: data.original_result_count === 0 ? 'standard-handoff-publication-unreturned.v1' : 'standard-handoff-publication-known-partial.v1',
    original_receipt_sha256: data.original_receipt_sha256, packet_plan_sha256: data.packet_plan_sha256,
    source_sha256: data.source_sha256, boundary_sha256: data.boundary_sha256, state_sha256: data.state_sha256,
    owned_paths: data.owned_paths, expected_output_sha256: data.expected_output_sha256, expected_output: data.expected_output });
  return Object.freeze({ prepare,
    describe(instance, record, options) { return describeData(prepare(instance, record, options).data); },
    confirms(instance, record, output, options) {
      const cap = prepare(instance, record, options);
      return cap.data.state.projection_status !== 'pending' && H(output) === cap.data.expected_output_sha256;
    },
    async apply(instance, record, descriptor, { write = false, expectedContinuationSha256, assertAuthorized,
      assertAuthorizedCurrent, signal } = {}) {
      active(signal);
      if (write !== true || expectedContinuationSha256 !== H(descriptor) || typeof assertAuthorized !== 'function'
        || typeof assertAuthorizedCurrent !== 'function') fail('STANDARD_HANDOFF_CONTINUATION_EXPLICIT_EFFECT_REQUIRED');
      try {
        const cap = prepare(instance, record, { signal, originalResultCount: descriptor.profile === 'standard-handoff-publication-unreturned.v1' ? 0 : 1 });
        if (H({ ...describeData(cap.data), lock_sha256: descriptor.lock_sha256 }) !== H(descriptor))
          fail('STANDARD_HANDOFF_CONTINUATION_SUBJECT_CHANGED');
        await assertAuthorized(); active(signal); cap.assertCurrent();
        return await cap.complete({ write, assertAuthorizedCurrent, signal });
      }
      catch (cause) {
        if (cause.effect_status !== 'unknown') {
          const code = /^[A-Z][A-Z0-9_]{0,127}$/.test(cause?.code ?? '') ? cause.code : 'STANDARD_HANDOFF_CONTINUATION_UNCONFIRMED';
          throw Object.assign(Error(code), { code, cause, effect_status: 'no_effect' });
        }
        const reason = /^[A-Z][A-Z0-9_]{0,127}$/.test(cause.code ?? '') ? cause.code : 'STANDARD_HANDOFF_CONTINUATION_UNCONFIRMED';
        return { output: handoffOperationResult(record.preview.prepared, null, reason, 'unknown'), effect_knowledge: 'unknown' };
      }
    },
  });
}


// An authenticated subject plus current beforeimages, never a no-effect
// conclusion about the original producer. The future controller must separately
// authenticate the capsule, termination, exact owner/fence and current consent.
export function createStandardHandoffBeforeEffectObservation({ targetRoot, readSigningKey, readCurrent, readClaimed }, { controllerHistory = false } = {}) {
  if ([readSigningKey, readCurrent, readClaimed].some(fn => typeof fn !== 'function'))
    fail('STANDARD_HANDOFF_BEFOREIMAGE_CAPABILITY_REQUIRED');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  return Object.freeze({
    observe(instance, record, { signal } = {}) {
      active(signal);
      instance = freezeShadow(structuredClone(instance));
      record = freezeShadow(structuredClone(record));
      const signer = createOperationJournalSigner(readSigningKey);
      signer.verify(record); signer.verify(record.preview);
      if (!controllerHistory && (record.phase !== 'dispatching' || record.results.length !== 0))
        fail('STANDARD_HANDOFF_BEFOREIMAGE_SUBJECT_REQUIRED');
      const prepared = assertHandoffOperationPreparation(record.preview.prepared);
      if (!prepared.can_apply) fail('STANDARD_HANDOFF_BEFOREIMAGE_SUBJECT_REQUIRED');
      const inner = decodeHandoffPacketPlan(prepared.plan);
      signer.verify(inner.resource_request);
      const prefix = (controllerHistory ? handoffPublicationBeforeEffectPrefix : handoffPublicationUnreturnedPrefix)(instance, record);
      const readPrefix = () => {
        const current = readCurrent(instance.instance_id), claimed = readClaimed(record.operation_id);
        signer.verify(claimed); signer.verify(claimed.preview);
        if (H(current) !== H(instance) || H(claimed) !== H(record))
          fail('STANDARD_HANDOFF_BEFOREIMAGE_SUBJECT_CHANGED');
        return prefix;
      };
      const capture = () => {
        active(signal); readPrefix();
        const value = observeHandoffPublicationBeforeimages({ targetRoot: artifacts.root, readCurrent: readPrefix, plan: inner });
        readPrefix(); active(signal); return value;
      };
      const state = capture();
      const { context_sha256, documents, ...boundaryContext } = inner.context;
      const data = freezeShadow({ source_sha256: H(inner.canonical_sources.filter(row => row.path !== target)),
        boundary_sha256: H({ ...boundaryContext, documents: documents.filter(row => row.path !== target) }), operation_id: record.operation_id, instance_sha256: instance.instance_sha256,
        original_intent_sha256: H(record.intent), original_output_sha256: null, original_receipt_sha256: null,
        packet_plan_sha256: H(inner), state, state_sha256: H(state),
        snapshot_only: true, written: false, complete_resource_closure: false,
        permits_handoff: false, permits_effects: false });
      return Object.freeze({ data, assertCurrent() {
        if (H(capture()) !== data.state_sha256) fail('STANDARD_HANDOFF_BEFOREIMAGE_STATE_CHANGED');
      } });
    },
  });
}


// The controller separately proves original termination and exclusive ownership,
// acquires a new fence, retires the exact old lock and supplies current consent.
// This capability confirms only an unchanged beforeimage; it never publishes.
export function createStandardHandoffBeforeEffectContinuation(parameters, { boundary = () => {} } = {}) {
  if (typeof boundary !== 'function') fail('STANDARD_HANDOFF_BEFOREIMAGE_CAPABILITY_REQUIRED');
  const { targetRoot } = parameters;
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  const reader = createStandardHandoffBeforeEffectObservation(parameters, { controllerHistory: true });
  function prepare(instance, record, { signal } = {}) {
    const observed = reader.observe(instance, record, { signal });
    const prepared = assertHandoffOperationPreparation(record.preview.prepared), inner = decodeHandoffPacketPlan(prepared.plan);
    if (inner.before_sha256 === inner.after_sha256) fail('STANDARD_HANDOFF_BEFOREIMAGE_AMBIGUOUS');
    const output = handoffOperationResult(prepared, null, handoffBeforeEffectReason);
    if (output.outcome !== 'blocked' || output.effect_status !== 'no_effect')
      fail('STANDARD_HANDOFF_BEFOREIMAGE_SUBJECT_REQUIRED');
    const data = freezeShadow({ ...observed.data, owned_paths: [],
      expected_output: output, expected_output_sha256: H(output) });
    return Object.freeze({ data, assertCurrent: observed.assertCurrent,
      async complete({ write = false, assertAuthorizedCurrent, signal: currentSignal } = {}) {
        if (write !== true || typeof assertAuthorizedCurrent !== 'function')
          fail('STANDARD_HANDOFF_BEFOREIMAGE_EXPLICIT_EFFECT_REQUIRED');
        const borrowed = currentStandardDispatchContext()?.artifactContinuation;
        if (borrowed?.operation_id !== record.operation_id || borrowed.plan_sha256 !== H(inner))
          fail('STANDARD_HANDOFF_BEFOREIMAGE_OWNER_REQUIRED');
        const permit = () => { active(signal); active(currentSignal);
          if (assertAuthorizedCurrent() !== undefined) fail('STANDARD_HANDOFF_BEFOREIMAGE_CURRENT_PERMISSION_REQUIRED'); };
        permit(); observed.assertCurrent();
        return artifacts.withLocalEffectOwner(H(inner), () => {
          artifacts.assertLocalEffectOwner(H(inner)); permit(); observed.assertCurrent();
          if (boundary('before_handoff_no_effect_confirmation') !== undefined)
            fail('STANDARD_HANDOFF_BEFOREIMAGE_BOUNDARY_INVALID');
          permit(); observed.assertCurrent();
          if (boundary('after_handoff_no_effect_confirmation') !== undefined)
            fail('STANDARD_HANDOFF_BEFOREIMAGE_BOUNDARY_INVALID');
          artifacts.assertLocalEffectOwner(H(inner)); permit(); observed.assertCurrent();
          return Object.freeze({ output, effect_status: 'no_effect', effect_knowledge: 'known_prefix',
            canonical_written: false, projected: false });
        });
      },
    });
  }
  const describeData = data => freezeShadow({ profile: handoffBeforeEffectProfile,
    original_receipt_sha256: null, packet_plan_sha256: data.packet_plan_sha256,
    source_sha256: data.source_sha256, boundary_sha256: data.boundary_sha256,
    state_sha256: data.state_sha256, owned_paths: [],
    expected_output_sha256: data.expected_output_sha256, expected_output: data.expected_output });
  return Object.freeze({ prepare,
    describe(instance, record, options) { return describeData(prepare(instance, record, options).data); },
    confirms(instance, record, output, options) { return H(output) === prepare(instance, record, options).data.expected_output_sha256; },
    async apply(instance, record, descriptor, { write = false, expectedContinuationSha256,
      assertAuthorized, assertAuthorizedCurrent, signal } = {}) {
      try {
        active(signal);
        if (write !== true || expectedContinuationSha256 !== H(descriptor)
          || typeof assertAuthorized !== 'function' || typeof assertAuthorizedCurrent !== 'function')
          fail('STANDARD_HANDOFF_BEFOREIMAGE_EXPLICIT_EFFECT_REQUIRED');
        const cap = prepare(instance, record, { signal });
        if (H({ ...describeData(cap.data), lock_sha256: descriptor.lock_sha256 }) !== H(descriptor))
          fail('STANDARD_HANDOFF_BEFOREIMAGE_SUBJECT_CHANGED');
        await assertAuthorized(); active(signal); cap.assertCurrent();
        return await cap.complete({ write, assertAuthorizedCurrent, signal });
      } catch (cause) {
        // This fixed capability performs reads only. Its own failed application
        // has no business effect, independently of an authority callback's tag.
        // The controller must still reobserve the exact subject before release.
        const code = /^[A-Z][A-Z0-9_]{0,127}$/.test(cause?.code ?? '')
          ? cause.code : 'STANDARD_HANDOFF_BEFOREIMAGE_UNCONFIRMED';
        throw Object.assign(Error(code), { code, cause, effect_status: 'no_effect' });
      }
    },
  });
}
