import { createAgenticProcessStore } from '../../adapters/runtime/agentic-process-store.mjs';
import { createProcessOperationJournalStore } from '../../adapters/runtime/process-operation-journal-store.mjs';
import { createNativeAllocationJournalStore } from '../../adapters/runtime/native-allocation-journal-store.mjs';
import { readStandardHostInstance } from '../../adapters/runtime/standard-host-authority.mjs';
import { createOperationJournalSigner } from '../../core/workflow/process-operation-journal.mjs';
import { nativeJournalId } from '../../core/workflow/native-allocation-journal.mjs';
import { assertRetainedAuditEntry, assertRetainedAuditProof } from '../../core/workflow/standard-retained-audit.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';
import { readAgentRunFile } from './agent-run-configuration-service.mjs';
import { readAgenticProductSnapshot } from './agentic-process-execution-composition.mjs';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import path from 'node:path';

const require = (condition, code = 'STANDARD_RETAINED_AUDIT_SOURCE_CHANGED') => { if (!condition) throw Object.assign(Error(code), { code }); };
// Bounded historical observation. The original configuration is data, never a
// module, and neither the blocked receipt nor the Native checkpoint is adopted.
export function createRetainedAuditSource({ configuration, environment, createAuthority }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: configuration.target_root, env: environment });
  const options = { targetRoot: artifacts.root, stateMode: artifacts.describe().state_mode, env: environment };
  const instances = createAgenticProcessStore(options), journals = createProcessOperationJournalStore(options), natives = createNativeAllocationJournalStore(options);
  function capture(entry) {
    assertRetainedAuditEntry(entry);
    const execution = readAgentRunFile(entry.original_configuration.path, { sha256: entry.original_configuration.sha256 }).value;
    require(execution.instance_id !== configuration.instance_id && execution.target_root === configuration.target_root
      && execution.product_root === configuration.product_root && H(execution.product_files) === H(configuration.product_files));
    require(H(execution.criteria) === H(configuration.criteria) && H(execution.authorities) === H(configuration.authorities)
      && H(execution.controller) === H(configuration.controller)
      && ['executable', 'sha256', 'home', 'model', 'effort'].every(key => execution.native[key] === configuration.native[key]), 'STANDARD_RETAINED_AUDIT_BINDING_CHANGED');
    const roots = [configuration.control_root, configuration.review_root, configuration.native.home, ...configuration.native.protected_roots];
    require([entry.original_configuration.path, execution.control_root, execution.review_root].every(file => roots.some(root => {
      const relative = path.relative(root, file); return relative === '' || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
    })), 'STANDARD_RETAINED_AUDIT_EVIDENCE_UNPROTECTED');
    const instance = instances.read(execution.instance_id).record, failed = journals.read(entry.failed_evaluation_operation_id).record;
    require(instance && failed && failed.intent.instance_id === instance.instance_id);
    const native = natives.read(nativeJournalId(instance)).record; require(native);
    const readKey = readStandardHostInstance({ targetRoot: artifacts.root, instanceId: instance.instance_id, environment }).readKey;
    const signer = createOperationJournalSigner(readKey); signer.verify(failed); signer.verify(failed.preview); signer.verify(native);
    require(native.allocations.every(row => row.configuration_sha256 === H(execution)));
    return { instance, failed, execution, readKey, pins: { original_instance_id: instance.instance_id, original_instance_sha256: instance.instance_sha256,
      original_configuration_sha256: H(execution), native_journal_sha256: H(native), failed_evaluation_operation_id: failed.operation_id, failed_evaluation_journal_sha256: H(failed) } };
  }
  async function inspectSource(entry, { assertCurrentOwner = null } = {}, recorded = false) {
      const before = capture(entry), { instance, execution, failed, readKey } = before;
      const product = () => readAgenticProductSnapshot(execution.product_root, execution.product_files);
      const authority = createAuthority({ configuration: execution, model: instance.model, modelSource: failed.preview.snapshot.model_source,
        readSigningKey: readKey, readProductSnapshot: product, readProductSha256: () => H(product()), environment });
      const retained = recorded ? await authority.readRecordedCycleAudit(instance, failed.operation_id)
        : await authority.inspectRetainedCycleAudit(instance, failed.operation_id, { assertCurrentOwner });
      require(H(capture(entry).pins) === H(before.pins));
      const context = Object.fromEntries(['session_id', 'cycle_id', 'cycle_path', 'branch', 'head', 'mode', 'cycle_state', 'product_sha256'].map(key => [key, (recorded ? retained.context : retained.bridge.context)[key]]));
      require(context.session_id === instance.initial_parameters.session.session_id);
      const proof = assertRetainedAuditProof({ ...before.pins, context, product_sha256: H(product()),
        report_occurrence_id: failed.preview.input.report_occurrence_id, report_sha256: H(retained.native.authenticated.report),
        audit_context_sha256: H(retained.native.context), audit_operation_id: retained.native.selection.record.operation_id,
        audit_journal_sha256: H(retained.native.selection.record), verification_proof_sha256: H(retained.verification_proof) });
      return { proof, ...retained };
  }
  return Object.freeze({
    inspect: (entry, options) => inspectSource(entry, options, false),
    readRecorded: entry => inspectSource(entry, {}, true),
  });
}
