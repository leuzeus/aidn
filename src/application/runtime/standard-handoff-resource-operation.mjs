import fs from 'node:fs';
import path from 'node:path';
import { createStandardHandoffResources } from './standard-handoff-resources.mjs';
import { assertHandoffOperationOutput, decodeHandoffPacketPlan } from '../../core/workflow/standard-handoff-operation.mjs';
import { assertHandoffResourceOperationInput, assertHandoffResourceOperationPreparation, assertHandoffResourceOperationOutput } from '../../core/workflow/standard-handoff-resource-operation.mjs';
import { shadowHash as H, freezeShadow } from '../../core/workflow/shadow-json.mjs';
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
// No writer or effect-owner capability is passed to this observer. Preparation
// retains only the accepted publication; actual discovery happens after staging.
export function createStandardHandoffResourceOperation({ artifacts, configuration, signer, readAcceptedPublication,
  readInventory, readNativeHistory, source, now = Date.now }) {
  const active = signal => { if (signal?.aborted) fail("STANDARD_HANDOFF_RESOURCE_OBSERVATION_ABORTED"); };
  function prepare(instance, input, { signal } = {}) {
    active(signal);
    assertHandoffResourceOperationInput(input);
    const { record, output } = readAcceptedPublication(instance, input.publication_operation_id);
    assertHandoffOperationOutput(output);
    const outer = record.preview.prepared, inner = decodeHandoffPacketPlan(outer.plan), o = output.observations;
    if (output.outcome !== 'completed' || o.plan_sha256 !== outer.plan_sha256 || o.packet_plan_sha256 !== outer.plan.packet_plan_sha256
      || o.packet_sha256 !== inner.after_sha256 || o.resource_material_sha256 !== inner.resource_material_sha256)
      fail('STANDARD_HANDOFF_RESOURCE_PUBLICATION_REQUIRED');
    const row = artifacts.readMany([inner.path], { required: [inner.path], includeMetadata: true })[0];
    if (row.sha256 !== o.packet_sha256 || row.metadata_sha256 !== o.packet_metadata_sha256)
      fail('STANDARD_HANDOFF_RESOURCE_PACKET_CHANGED');
    if (artifacts.describe().state_mode === 'dual') {
      let visible; try { visible = fs.readFileSync(path.join(artifacts.root, 'docs/audit', inner.path)); } catch { fail('STANDARD_HANDOFF_RESOURCE_PACKET_CHANGED'); }
      if (!visible.equals(Buffer.from(row.content, 'utf8'))) fail('STANDARD_HANDOFF_RESOURCE_PACKET_CHANGED');
    }
    const plan = { contract_version: 'standard-handoff-resource-operation-plan.v1', publication_operation_id: record.operation_id,
      publication_output_sha256: H(output), packet_sha256: o.packet_sha256, packet_metadata_sha256: o.packet_metadata_sha256, packet_path: inner.path };
    return freezeShadow(assertHandoffResourceOperationPreparation({ plan, plan_sha256: H(plan) }));
  }
  return Object.freeze({ prepare, async observe(instance, input, prepared, { signal } = {}) {
    active(signal); assertHandoffResourceOperationPreparation(prepared);
    if (H(prepare(instance, input, { signal })) !== H(prepared)) fail('STANDARD_HANDOFF_RESOURCE_PUBLICATION_CHANGED');
    if (!configuration || typeof readNativeHistory !== 'function'
      || ['read', 'verify', 'assertCurrent'].some(method => typeof source?.[method] !== 'function')) return null;
    const reader = createStandardHandoffResources({ configuration, signer, now, source,
      readInventory: () => readInventory(instance.instance_id, { expectedSha256: instance.instance_sha256 }), readNativeHistory,
      readOwnership: () => ({ pending: artifacts.ownerPending(), fence: artifacts.resourceFence().read() }) });
    const request = reader.prepare(), capture = await reader.observeForPublication(request, { sourceRef: 'standard-handoff-post-release', signal });
    if (capture.status === 'WAITING') return null;
    const assertCurrent = () => { capture.assertCurrent(); if (H(prepare(instance, input)) !== H(prepared)) fail('STANDARD_HANDOFF_RESOURCE_PUBLICATION_CHANGED'); };
    assertCurrent(); const p = prepared.plan;
    const output = freezeShadow(assertHandoffResourceOperationOutput({ contract_version: 'standard-handoff-resource-operation-output.v1',
      operation_ref: 'handoff_resources_observe', outcome: 'completed', effect_status: 'no_effect', facts: { handoff_resource_snapshot_observed: true },
      observations: { publication_operation_id: p.publication_operation_id, publication_output_sha256: p.publication_output_sha256,
        packet_sha256: p.packet_sha256, packet_metadata_sha256: p.packet_metadata_sha256, resource_result: capture.result,
        permits_handoff: false, permits_effects: false }, evidence_refs: [{ ref: 'aidn:handoff-resource-snapshot/' + H(capture.result), sha256: H(capture.result) }] }));
    return Object.freeze({ output, assertCurrent });
  } });
}
