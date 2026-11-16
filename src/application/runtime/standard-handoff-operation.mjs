import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { createStandardHandoffResources } from './standard-handoff-resources.mjs';
import { createStandardHandoffPublication } from './standard-handoff-publication.mjs';
import { createOperationJournalSigner } from '../../core/workflow/process-operation-journal.mjs';
import { assertProcessDispatchRecord } from '../../core/workflow/process-dispatch-record.mjs';
import { handoffInventoryMaterialSha256 } from '../../core/workflow/standard-handoff-resources.mjs';
import { assertHandoffPublicationInput } from '../../core/workflow/standard-handoff-publication.mjs';
import { assertHandoffOperationPlan, assertHandoffOperationPreparation, encodeHandoffPacketPlan, decodeHandoffPacketPlan,
  handoffPublicationIntentPrefix, handoffPublicationOperation, handoffOperationResult } from '../../core/workflow/standard-handoff-operation.mjs';
import { shadowHash as H, freezeShadow } from '../../core/workflow/shadow-json.mjs';
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const same = (a, b) => H(a) === H(b);
const unavailable = () => ({ can_apply: false, status: 'WAITING', written: false, reason_code: 'STANDARD_HANDOFF_OPERATION_RESOURCE_SOURCE_REQUIRED' });
// This fixed adapter recognizes only its own authenticated final intent. Its
// ephemeral inventory view compares the original prepared subject; it neither
// changes a stored record nor declares global current resource closure.
export function createStandardHandoffOperation({ targetRoot, configuration, readSigningKey, readCurrent, readClaimed, readInventory,
  readNativeHistory, resourceSource, now = Date.now }, { boundary = () => {} } = {}) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), signer = createOperationJournalSigner(readSigningKey);
  const capable = () => configuration && typeof readNativeHistory === 'function'
    && ['read','verify','assertCurrent'].every(name => typeof resourceSource?.[name] === 'function');
  const instanceRef = id => 'artifact:workflows/process-instances/' + id + '.json';
  function resources(inventory) {
    return createStandardHandoffResources({ configuration, signer, now, source: resourceSource, readInventory: inventory, readNativeHistory,
      readOwnership: () => ({ pending: artifacts.ownerPending(), fence: artifacts.resourceFence().read() }) });
  }
  const port = (view, inventory, authorization) => createStandardHandoffPublication({ targetRoot: artifacts.root, readCurrent: view,
    resources: resources(inventory), resourceSourceRef: 'standard-handoff', signer, authorization, now }, { boundary });
  const noPermission = { verify: () => fail('STANDARD_HANDOFF_OPERATION_WRITE_CAPABILITY_REQUIRED'), assertCurrent: () => fail('STANDARD_HANDOFF_OPERATION_WRITE_CAPABILITY_REQUIRED') };
  return Object.freeze({
    async prepare(instance, input, occurrenceId, { signal } = {}) {
      input = freezeShadow(structuredClone(assertHandoffPublicationInput(input)));
      if (!capable()) return freezeShadow(unavailable());
      instance = freezeShadow(structuredClone(instance));
      if (configuration.instance_id !== instance.instance_id) fail('STANDARD_HANDOFF_OPERATION_CONFIGURATION_CHANGED');
      const view = () => { if (!same(readCurrent(instance.instance_id), instance)) fail('STANDARD_HANDOFF_OPERATION_CURRENT_CHANGED'); return instance; };
      let witness = null, inventorySha = null;
      const inventory = () => {
        view(); const value = readInventory(instance.instance_id, { expectedSha256: instance.instance_sha256 }); signer.verify(value);
        const row = value.resources.find(row => row.ref === instanceRef(instance.instance_id));
        if (!row || witness && !same(witness, row)) fail('STANDARD_HANDOFF_OPERATION_PROCESS_ARTIFACT_CHANGED');
        witness ??= structuredClone(row); inventorySha ??= handoffInventoryMaterialSha256(value); return value;
      };
      const prepared = await port(view, inventory, noPermission).prepare(input, { signal });
      if (!prepared.can_apply) return prepared;
      if (!witness || inventorySha !== prepared.plan.resource_request.inventory_material_sha256) fail('STANDARD_HANDOFF_OPERATION_INVENTORY_CHANGED');
      const plan = assertHandoffOperationPlan({ contract_version: 'standard-handoff-operation-plan.v1', operation_ref: handoffPublicationOperation,
        input, occurrence_id: occurrenceId, instance_resource: witness, ...encodeHandoffPacketPlan(prepared.plan) });
      return freezeShadow(assertHandoffOperationPreparation({ can_apply: true, plan, plan_sha256: H(plan) }));
    },
    async apply(instance, input, prepared, { operationId, assertAuthorized, assertAuthorizedCurrent, signal } = {}) {
      prepared = freezeShadow(structuredClone(assertHandoffOperationPreparation(prepared)));
      if (!prepared.can_apply) return handoffOperationResult(prepared);
      let launched = false;
      try {
        const plan = assertHandoffOperationPlan(prepared.plan), inner = decodeHandoffPacketPlan(plan);
        input = freezeShadow(structuredClone(assertHandoffPublicationInput(input))); instance = freezeShadow(structuredClone(instance));
        if (!capable() || !same(input, plan.input) || typeof assertAuthorized !== 'function' || typeof assertAuthorizedCurrent !== 'function')
          fail('STANDARD_HANDOFF_OPERATION_CURRENT_CAPABILITY_REQUIRED');
        const claimed = freezeShadow(structuredClone(readClaimed(operationId))); signer.verify(claimed); signer.verify(claimed.preview);
        if (claimed.operation_id !== operationId || claimed.owner?.pid !== process.pid || !same(claimed.preview.prepared, prepared)
          || !same(claimed.preview.input, input) || claimed.intent.occurrence_id !== plan.occurrence_id) fail('STANDARD_HANDOFF_OPERATION_CLAIM_CHANGED');
        const prefix = handoffPublicationIntentPrefix(instance, claimed), claimedSha = H(claimed);
        if (prefix.instance_sha256 !== inner.context.instance_sha256) fail('STANDARD_HANDOFF_OPERATION_PREFIX_CHANGED');
        const claimCurrent = () => {
          const actual = readCurrent(instance.instance_id), record = readClaimed(operationId); signer.verify(record); signer.verify(record.preview);
          if (!same(actual, instance) || H(record) !== claimedSha) fail('STANDARD_HANDOFF_OPERATION_CURRENT_CHANGED');
          return prefix;
        };
        const normalizedInventory = () => {
          claimCurrent(); const inventory = readInventory(instance.instance_id, { expectedSha256: instance.instance_sha256 }); signer.verify(inventory);
          const dispatchArtifact = artifacts.read('workflows/dispatch-records/' + operationId + '.json', { required: true });
          const dispatch = assertProcessDispatchRecord(JSON.parse(dispatchArtifact.content)); signer.verify(dispatch);
          if (dispatch.contract_version !== 'process-dispatch-record.v2' || dispatch.phase !== 'running' || dispatch.operation_id !== operationId
            || dispatch.instance_id !== instance.instance_id || dispatch.scope_id !== instance.scope_id || dispatch.model_sha256 !== instance.model_sha256
            || dispatch.intent_sha256 !== H(claimed.intent) || dispatch.preview_sha256 !== H(claimed.preview)
            || dispatch.operation_owner_sha256 !== H(claimed.owner) || dispatch.physical_root_sha256 !== H(artifacts.root)
            || dispatch.process_identity.pid !== process.pid || dispatch.local_owner_intentions.length || dispatch.leases.length)
            fail('STANDARD_HANDOFF_OPERATION_DISPATCH_CHANGED');
          const own = inventory.operations.filter(row => row.operation_id === operationId);
          if (own.length !== 1 || own[0].record_sha256 !== claimedSha || own[0].phase !== 'dispatching' || own[0].effect_status !== 'unknown'
            || own[0].results.length || own[0].prefix_sha256 !== prefix.instance_sha256 || !same(own[0].owner, claimed.owner))
            fail('STANDARD_HANDOFF_OPERATION_INVENTORY_CHANGED');
          const ownRefs = new Map([
            ['artifact:workflows/operation-records/' + operationId + '.json', ['artifact', artifacts.read('workflows/operation-records/' + operationId + '.json', { required: true }).sha256]],
            ['artifact:workflows/dispatch-records/' + operationId + '.json', ['artifact', dispatchArtifact.sha256]],
            ['operation:' + operationId, ['operation', claimedSha]], ['dispatch:' + operationId, ['local_evidence', H(dispatch)]],
          ]);
          for (const [ref, [kind, sha256]] of ownRefs) {
            const rows = inventory.resources.filter(row => row.ref === ref);
            if (rows.length !== 1 || rows[0].kind !== kind || rows[0].sha256 !== sha256) fail('STANDARD_HANDOFF_OPERATION_INVENTORY_CHANGED');
          }
          const processRows = inventory.resources.filter(row => row.ref === instanceRef(instance.instance_id));
          const currentArtifact = artifacts.read('workflows/process-instances/' + instance.instance_id + '.json', { required: true });
          if (processRows.length !== 1 || processRows[0].sha256 !== currentArtifact.sha256 || !same(JSON.parse(currentArtifact.content), instance))
            fail('STANDARD_HANDOFF_OPERATION_PROCESS_ARTIFACT_CHANGED');
          const { authentication, key_id, ...body } = inventory;
          const normalized = { ...body, instance_sha256: prefix.instance_sha256, instance_revision: prefix.revision,
            resources: inventory.resources.filter(row => !ownRefs.has(row.ref)).map(row => row.ref === plan.instance_resource.ref ? plan.instance_resource : row),
            operations: inventory.operations.filter(row => row.operation_id !== operationId),
            accounting: { ...inventory.accounting, operation_attempts: inventory.accounting.operation_attempts - 1, unknown_operations: inventory.accounting.unknown_operations - 1 } };
          const sealed = signer.seal(normalized);
          if (handoffInventoryMaterialSha256(sealed) !== inner.resource_request.inventory_material_sha256) fail('STANDARD_HANDOFF_OPERATION_FOREIGN_INVENTORY_CHANGED');
          claimCurrent(); return sealed;
        };
        const authorization = {
          async verify() { await assertAuthorized(); claimCurrent(); },
          assertCurrent() { if (assertAuthorizedCurrent() !== undefined) fail('STANDARD_HANDOFF_OPERATION_CURRENT_AUTHORIZATION_INVALID'); claimCurrent(); },
        };
        claimCurrent(); const publisher = port(claimCurrent, normalizedInventory, authorization);
        launched = true;
        const result = await publisher.apply({ can_apply: true, plan: inner, plan_sha256: H(inner) }, { write: true, expectPlan: H(inner), signal });
        return handoffOperationResult(prepared, result);
      } catch (cause) {
        const reason = /^[A-Z][A-Z0-9_]{0,127}$/.test(cause.code ?? '') ? cause.code : 'STANDARD_HANDOFF_OPERATION_UNCONFIRMED';
        return handoffOperationResult(prepared, null, reason, !launched || cause.effect_status === 'no_effect' ? 'no_effect' : 'unknown');
      }
    },
  });
}
