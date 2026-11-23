import path from "node:path";
import { createAgenticProcessStore } from "../../adapters/runtime/agentic-process-store.mjs";
import { createProcessOperationJournalStore } from "../../adapters/runtime/process-operation-journal-store.mjs";
import { createProcessDispatchRecordStore } from "../../adapters/runtime/process-dispatch-record-store.mjs";
import { createNativeAllocationJournalStore } from "../../adapters/runtime/native-allocation-journal-store.mjs";
import { createValidationLaunchRecoveryStore } from "../../adapters/runtime/standard-validation-launch-recovery-store.mjs";
import { readStandardHostInstance } from "../../adapters/runtime/standard-host-authority.mjs";
import { createOperationJournalSigner } from "../../core/workflow/process-operation-journal.mjs";
import { nativeJournalId } from "../../core/workflow/native-allocation-journal.mjs";
import { shadowHash as H } from "../../core/workflow/shadow-json.mjs";
import { readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { readAgenticProductSnapshot } from "./agentic-process-execution-composition.mjs";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
const require = (value, code = "STANDARD_RETAINED_VALIDATION_SOURCE_CHANGED") => { if (!value) fail(code); };

// A private host port. Original configuration is DATA: no old package code is
// loaded. The completed recovery and every historical record retain their key.
export function createRetainedValidationSource({ configuration, environment, createAuthority }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: configuration.target_root, env: environment });
  const options = { targetRoot: artifacts.root, stateMode: artifacts.describe().state_mode, env: environment };
  const instances = createAgenticProcessStore(options), journals = createProcessOperationJournalStore(options),
    dispatches = createProcessDispatchRecordStore(options), natives = createNativeAllocationJournalStore(options),
    recoveries = createValidationLaunchRecoveryStore(options);
  function capture(entry) {
    const execution = readAgentRunFile(entry.original_configuration.path, { sha256: entry.original_configuration.sha256 }).value;
    require(execution.target_root === configuration.target_root && execution.instance_id !== configuration.instance_id
      && execution.product_root === configuration.product_root && H(execution.product_files) === H(configuration.product_files));
    require(H(execution.criteria) === H(configuration.criteria) && H(execution.authorities) === H(configuration.authorities)
      && H(execution.controller) === H(configuration.controller)
      && ["executable", "sha256", "home", "model", "effort"].every(key => execution.native[key] === configuration.native[key]),
      "STANDARD_RETAINED_VALIDATION_BINDING_CHANGED");
    const protectedRoots = [configuration.control_root, configuration.review_root, configuration.native.home, ...configuration.native.protected_roots];
    const protectedPath = file => protectedRoots.some(root => { const relative = path.relative(root, file);
      return relative === "" || !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep); });
    require([entry.original_configuration.path, execution.control_root, execution.review_root].every(protectedPath),
      "STANDARD_RETAINED_VALIDATION_EVIDENCE_UNPROTECTED");
    const recovery = recoveries.read(entry.recovery_operation_id).record;
    require(recovery?.phase === "completed", "STANDARD_RETAINED_VALIDATION_RECOVERY_REQUIRED");
    const source = instances.read(execution.instance_id).record, evidence = recovery.evidence;
    const readKey = readStandardHostInstance({ targetRoot: artifacts.root, instanceId: execution.instance_id, environment }).readKey;
    const signer = createOperationJournalSigner(readKey); signer.verify(recovery);
    require(source && source.instance_id === evidence.instance_id && source.instance_sha256 === evidence.instance_sha256
      && source.scope_id === evidence.scope_id && source.model_sha256 === evidence.model_sha256);
    const validation = journals.read(recovery.operation_id).record, dispatch = dispatches.read(recovery.operation_id).record,
      native = natives.read(nativeJournalId(source)).record;
    require(validation && dispatch && native); signer.verify(validation); signer.verify(validation.preview); signer.verify(dispatch); signer.verify(native);
    const work = journals.read(validation.preview.input.work_operation_id).record; require(work); signer.verify(work); signer.verify(work.preview);
    require(H(validation) === evidence.journal_sha256 && H(dispatch) === evidence.dispatch_sha256 && H(native) === evidence.native_sha256
      && H(work) === evidence.work_sha256 && native.allocations.every(row => row.configuration_sha256 === H(execution)
        && row.phase === "closed" && row.tree_closed === true));
    readAgentRunFile(path.join(artifacts.root, ".aidn/runtime/standard-workflow/retired-" + recovery.operation_id + ".lock"),
      { json: false, sha256: evidence.lock_sha256 });
    const pins = { original_instance_id: source.instance_id, original_instance_sha256: source.instance_sha256,
      recovery_operation_id: recovery.operation_id, recovery_sha256: H(recovery), original_configuration_sha256: H(execution),
      work_operation_id: work.operation_id, work_journal_sha256: H(work), work_output_sha256: H(work.results.at(-1).output),
      native_journal_sha256: H(native), dispatch_sha256: H(dispatch), validation_journal_sha256: H(validation) };
    return { source, execution, recovery, work, validation, readKey, pins };
  }
  return Object.freeze({
    capture,
    async inspect(entry) {
      const before = capture(entry), { source, execution, validation, readKey } = before;
      const readProductSnapshot = () => readAgenticProductSnapshot(execution.product_root, execution.product_files);
      const authority = createAuthority({ configuration: execution, model: source.model, modelSource: validation.preview.snapshot.model_source,
        readSigningKey: readKey, readProductSnapshot, readProductSha256: () => H(readProductSnapshot()), environment });
      const work = await authority.inspectRetainedCycleTaskWork(source, before.work.operation_id);
      require(H(capture(entry).pins) === H(before.pins));
      require(work.context.session_id === source.initial_parameters.session.session_id);
      const context = Object.fromEntries(["session_id", "cycle_id", "cycle_path", "branch", "head", "mode", "cycle_state", "product_sha256"].map(key => [key, work.context[key]]));
      return { ...before.pins, proposal: work.proposal, context, context_sha256: work.context_sha256,
        output: work.output, product_snapshot: work.product_snapshot, product_sha256: work.product_sha256,
        validation_test_refs: work.validation_test_refs, contributors: work.contributors };
    },
    assertPinned(entry, proof) { require(H(capture(entry).pins) === H(proof)); },
  });
}
