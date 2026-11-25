import path from "node:path";
import { createAgenticProcessStore } from "../../adapters/runtime/agentic-process-store.mjs";
import { createProcessOperationJournalStore } from "../../adapters/runtime/process-operation-journal-store.mjs";
import { createNativeAllocationJournalStore } from "../../adapters/runtime/native-allocation-journal-store.mjs";
import { readStandardHostInstance } from "../../adapters/runtime/standard-host-authority.mjs";
import { createOperationJournalSigner } from "../../core/workflow/process-operation-journal.mjs";
import { nativeJournalId } from "../../core/workflow/native-allocation-journal.mjs";
import { assertRetainedVerificationEntry, assertRetainedVerificationProof } from "../../core/workflow/standard-retained-verification.mjs";
import { shadowHash as H } from "../../core/workflow/shadow-json.mjs";
import { readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { readAgenticProductSnapshot } from "./agentic-process-execution-composition.mjs";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";

const require = (condition, code = "STANDARD_RETAINED_VERIFICATION_SOURCE_CHANGED") => {
  if (!condition) throw Object.assign(Error(code), { code });
};
// Original configuration is immutable data. Historical keys and bindings stay
// attached to their origin; no origin package code or receipt is migrated.
export function createRetainedVerificationSource({ configuration, environment, createAuthority }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: configuration.target_root, env: environment });
  const options = { targetRoot: artifacts.root, stateMode: artifacts.describe().state_mode, env: environment };
  const instances = createAgenticProcessStore(options), journals = createProcessOperationJournalStore(options), natives = createNativeAllocationJournalStore(options);
  function capture(entry) {
    assertRetainedVerificationEntry(entry);
    const execution = readAgentRunFile(entry.original_configuration.path, { sha256: entry.original_configuration.sha256 }).value;
    require(execution.target_root === configuration.target_root && execution.instance_id !== configuration.instance_id
      && execution.product_root === configuration.product_root && H(execution.product_files) === H(configuration.product_files));
    require(H(execution.criteria) === H(configuration.criteria) && H(execution.authorities) === H(configuration.authorities)
      && H(execution.controller) === H(configuration.controller)
      && ["executable", "sha256", "home", "model", "effort"].every(key => execution.native[key] === configuration.native[key]),
      "STANDARD_RETAINED_VERIFICATION_BINDING_CHANGED");
    const roots = [configuration.control_root, configuration.review_root, configuration.native.home, ...configuration.native.protected_roots];
    require([entry.original_configuration.path, execution.control_root, execution.review_root].every(file => roots.some(root => {
      const relative = path.relative(root, file); return relative === "" || !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep);
    })), "STANDARD_RETAINED_VERIFICATION_EVIDENCE_UNPROTECTED");
    const instance = instances.read(execution.instance_id).record, selection = journals.read(entry.audit_operation_id).record;
    require(instance && selection && selection.intent.instance_id === instance.instance_id);
    const native = natives.read(nativeJournalId(instance)).record; require(native);
    const readKey = readStandardHostInstance({ targetRoot: artifacts.root, instanceId: instance.instance_id, environment }).readKey;
    const signer = createOperationJournalSigner(readKey); signer.verify(selection); signer.verify(selection.preview); signer.verify(native);
    require(native.allocations.every(row => row.configuration_sha256 === H(execution)));
    return { instance, selection, execution, readKey, pins: { original_instance_id: instance.instance_id,
      original_instance_sha256: instance.instance_sha256, original_configuration_sha256: H(execution),
      native_journal_sha256: H(native), audit_operation_id: selection.operation_id, audit_journal_sha256: H(selection) } };
  }
  function assertPinned(entry, proof) {
    const current = capture(entry).pins;
    require(H(current) === H(Object.fromEntries(Object.keys(current).map(key => [key, proof[key]]))));
    for (const kind of ["verification", "evaluation", "validation"]) {
      const record = journals.read(proof[kind + "_operation_id"]).record;
      require(record && H(record) === proof[kind + "_journal_sha256"]);
    }
  }
  return Object.freeze({
    async inspect(entry, { assertCurrentOwner = null } = {}) {
      const before = capture(entry), { instance, execution, selection, readKey } = before;
      const product = () => readAgenticProductSnapshot(execution.product_root, execution.product_files);
      const authority = createAuthority({ configuration: execution, model: instance.model, modelSource: selection.preview.snapshot.model_source,
        readSigningKey: readKey, readProductSnapshot: product, readProductSha256: () => H(product()), environment });
      const retained = await authority.inspectRetainedCycleVerification(instance, selection.operation_id, { assertCurrentOwner }), { bridge } = retained;
      require(H(capture(entry).pins) === H(before.pins));
      const context = Object.fromEntries(["session_id", "cycle_id", "cycle_path", "branch", "head", "mode", "cycle_state", "product_sha256"].map(key => [key, bridge.context[key]]));
      require(context.session_id === instance.initial_parameters.session.session_id);
      const proof = assertRetainedVerificationProof({ ...before.pins,
        verification_operation_id: bridge.verification.record.operation_id, verification_journal_sha256: H(bridge.verification.record),
        evaluation_operation_id: bridge.evaluation.record.operation_id, evaluation_journal_sha256: H(bridge.evaluation.record),
        validation_operation_id: bridge.source.record.operation_id, validation_journal_sha256: H(bridge.source.record),
        context, context_sha256: bridge.context_sha256, audit_context_sha256: retained.material.context_sha256,
        product_sha256: retained.product_sha256, proposal_sha256: H(bridge.source.proposal), contributors: retained.contributors });
      return { proof, bridge };
    },
    // Historical evidence only. The terminal consumer separately authenticates
    // the accepted closure writer and its current canonical postimages.
    readRecordedValidation(entry, proof) {
      assertRetainedVerificationProof(proof); assertPinned(entry, proof);
      const before = capture(entry), { instance, execution, selection, readKey } = before;
      const product = () => readAgenticProductSnapshot(execution.product_root, execution.product_files);
      const authority = createAuthority({ configuration: execution, model: instance.model, modelSource: selection.preview.snapshot.model_source,
        readSigningKey: readKey, readProductSnapshot: product, readProductSha256: () => H(product()), environment });
      const source = authority.readRecordedCycleValidation(instance, proof);
      assertPinned(entry, proof); require(H(capture(entry).pins) === H(before.pins));
      return source;
    },
    assertPinned,
  });
}
