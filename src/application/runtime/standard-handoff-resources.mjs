import { randomUUID } from 'node:crypto';
import { assertHandoffResourceRequest, assertHandoffResourceObservation, assertHandoffResourceResult,
  handoffInventoryMaterialSha256 } from '../../core/workflow/standard-handoff-resources.mjs';
import { shadowHash, freezeShadow } from '../../core/workflow/shadow-json.mjs';

const fail = code => { throw Object.assign(Error(code), { code }); };

// Fixed trusted capabilities only. Authored JSON supplies neither discoverers
// nor an authentication/OS verifier. This observer has no writer or owner port.
export function createStandardHandoffResources({ configuration, signer, readInventory, readNativeHistory,
  readOwnership, source, now = Date.now }) {
  if ([readInventory, readNativeHistory, readOwnership, signer?.seal, signer?.verify].some(value => typeof value !== 'function'))
    fail('STANDARD_HANDOFF_RESOURCE_READER_REQUIRED');
  const config = freezeShadow(structuredClone(configuration)), configurationSha = shadowHash(config);
  function capture() {
    const inventory = readInventory(); signer.verify(inventory);
    if (inventory.instance_id !== config.instance_id || inventory.configuration_sha256 !== configurationSha)
      fail('STANDARD_HANDOFF_RESOURCE_SCOPE_CHANGED');
    const inventoryMaterial = handoffInventoryMaterialSha256(inventory), native = readNativeHistory(), ownership = readOwnership();
    if (native?.instance_id !== config.instance_id || native.permits_effects !== false || native.complete_resource_closure !== false
      || !Array.isArray(native.entries) || !['not_allocated', 'verified_closed_history', 'reconciliation_required'].includes(native.retained_history_status))
      fail('STANDARD_HANDOFF_NATIVE_HISTORY_INVALID');
    if (native.retained_history_status === 'reconciliation_required' || !inventory.accounting.native_known)
      fail('STANDARD_HANDOFF_NATIVE_HISTORY_UNRESOLVED');
    if (native.retained_history_status === 'not_allocated'
      ? native.journal_sha256 !== null || native.entries.length !== 0
      : native.scope_id !== inventory.scope_id || native.model_sha256 !== inventory.model_sha256
        || native.entries.some(row => !['ordinary_closed', 'reconciled_no_assignment', 'reconciled_post_assignment'].includes(row.status)))
      fail('STANDARD_HANDOFF_NATIVE_HISTORY_INVALID');
    if (ownership?.pending !== false || ownership.fence?.record && ownership.fence.record.state !== 'released'
      || inventory.resources.some(row => row.kind === 'local_effect_owner'))
      fail('STANDARD_HANDOFF_RESOURCE_OWNER_UNRESOLVED');
    const material = { instance_id: inventory.instance_id, instance_sha256: inventory.instance_sha256,
      scope_id: inventory.scope_id, model_sha256: inventory.model_sha256,
      configuration_sha256: configurationSha, physical_root_sha256: inventory.physical_root_sha256,
      inventory_material_sha256: inventoryMaterial, native_history_sha256: shadowHash(native), ownership_sha256: shadowHash(ownership) };
    return { material, inventory, native };
  }
  function same(expected) {
    const value = capture();
    if (Object.keys(value.material).some(key => value.material[key] !== expected[key])) fail('STANDARD_HANDOFF_RESOURCE_SUBJECT_CHANGED');
    return value;
  }
  function request(supplied) {
    const value = freezeShadow(structuredClone(supplied)); assertHandoffResourceRequest(value); signer.verify(value);
    if (value.issued_at_ms > now()) fail('STANDARD_HANDOFF_RESOURCE_REQUEST_FUTURE');
    same(value); return value;
  }
  const currentSignal = signal => { if (signal?.aborted) fail('STANDARD_HANDOFF_RESOURCE_OBSERVATION_ABORTED'); };
  async function observe(supplied, { sourceRef, signal } = {}, retainCapability = false) {
      currentSignal(signal); const q = request(supplied);
      if (typeof sourceRef !== 'string' || !sourceRef || sourceRef.length > 256
        || ['read', 'verify', 'assertCurrent'].some(method => typeof source?.[method] !== 'function'))
        fail('STANDARD_HANDOFF_RESOURCE_SOURCE_REQUIRED');
      const input = { request: q, sourceRef }, value = await source.read({ ...input, signal }); currentSignal(signal);
      if (value === null) { same(q); return freezeShadow({ status: 'WAITING', written: false, permits_effects: false, permits_handoff: false }); }
      const observation = freezeShadow(structuredClone(value)); assertHandoffResourceObservation(observation, q);
      if (observation.observed_at_ms > now()) fail('STANDARD_HANDOFF_RESOURCE_OBSERVATION_FUTURE');
      same(q);
      const verification = await source.verify({ ...input, observation, signal }); currentSignal(signal);
      if (verification?.outcome !== 'verified' || verification.authority_id !== observation.authority_id
        || verification.request_sha256 !== shadowHash(q) || verification.observation_sha256 !== shadowHash(observation)
        || verification.evidence_class !== observation.evidence_class) fail('STANDARD_HANDOFF_RESOURCE_SOURCE_NOT_AUTHENTICATED');
      const fresh = same(q); currentSignal(signal);
      // This synchronous capability must reobserve independent resource closure
      // and current source permission, including any original issuer expiry.
      // No host-invented preparation/observation age limit is added.
      // The issuer check remains callable after acquiring the publisher's own
      // owner. It makes no new inventory/ownership closure assertion.
      const assertSourceCurrent = () => {
        currentSignal(signal);
        if (source.assertCurrent({ ...input, observation }) !== undefined) fail('STANDARD_HANDOFF_RESOURCE_SOURCE_NOT_CURRENT');
      };
      const assertCurrent = () => { currentSignal(signal); same(q); assertSourceCurrent(); };
      assertCurrent();
      const result = freezeShadow(assertHandoffResourceResult(signer.seal({ contract_version: 'standard-handoff-resource-result.v1',
        request_sha256: shadowHash(q), ...fresh.material, observation_sha256: shadowHash(observation),
        authority_id: observation.authority_id, evidence_class: observation.evidence_class, observed_at_ms: observation.observed_at_ms,
        unknown_business_operations: fresh.inventory.operations.filter(row => row.effect_status === 'unknown').map(row => row.operation_id),
        complete_resource_closure: true, snapshot_only: true, permits_effects: false, permits_handoff: false, written: false })));
      // A live synchronous observation capability is never serializable action
      // data or a cached permission. It is valid only for this exact read.
      return retainCapability ? Object.freeze({ result, assertCurrent, assertSourceCurrent }) : result;
  }
  return Object.freeze({
    prepare() {
      const { material } = capture(); same(material);
      return freezeShadow(assertHandoffResourceRequest(signer.seal({ contract_version: 'standard-handoff-resource-request.v1',
        request_id: randomUUID(), ...material, issued_at_ms: now() })));
    },
    inspect: (supplied, input) => observe(supplied, input),
    observeForPublication: (supplied, input) => observe(supplied, input, true),
  });
}
