import { createOperationJournalSigner } from "../../core/workflow/process-operation-journal.mjs";
import { createNativeAllocationJournalStore } from "../../adapters/runtime/native-allocation-journal-store.mjs";
import { createProcessControlInboxStore } from "../../adapters/runtime/process-control-inbox-store.mjs";
import { readWorkflowProjectAuthority } from "./workflow-instance-composition.mjs";
import { readNativeAllocationHistory, nativeAllocationOutputId, assertNativeAllocationProjection } from "./native-allocation-evidence.mjs";
import { assertAgenticProcessStart } from "../../core/workflow/agentic-process-start.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { createAgenticProcess } from "../../core/workflow/agentic-process.mjs";
import { agenticProcessPersistence } from "./agentic-process-persistence.mjs";
import { readNativeControlContext } from "./native-allocation-controls.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
// Private, byte-pinned worker IPC. Never a field of authored configuration or a
// native prompt/environment. The trusted worker already owns canonical DB access;
// its ephemeral key capability verifies the parent's reservation, not user claims.
export function createNativeAllocationWorkerAuthority({ configuration, authorization, admission, environment = process.env }) {
  const fields = ["contract_version", "journal_id", "generation", "owner_id", "key_base64"];
  if (checkShadowJson(admission) || !admission || Object.keys(admission).length !== fields.length || fields.some(key => !Object.hasOwn(admission, key))
    || admission.contract_version !== "native-allocation-worker.v1" || !/^[A-Za-z0-9+/]{43}=$/.test(admission.key_base64 ?? "")) fail("PROCESS_WORKER_ALLOCATION_INVALID");
  const key = Buffer.from(admission.key_base64, "base64"), signer = createOperationJournalSigner(() => key);
  const project = readWorkflowProjectAuthority({ targetRoot: configuration.target_root });
  const options = { targetRoot: configuration.target_root, stateMode: project.stateMode, env: environment };
  const store = createNativeAllocationJournalStore(options), controls = createProcessControlInboxStore(options);
  return Object.freeze({
    admit({ creation, retained, scopeId, modelSha256, productSha256 }) {
      const journal = store.read(admission.journal_id).record; signer.verify(journal);
      const entry = journal.allocations.at(-1);
      if (journal.instance_id !== configuration.instance_id || journal.scope_id !== scopeId || journal.model_sha256 !== modelSha256
        || entry.phase !== "reserved" || entry.generation !== admission.generation || entry.owner_id !== admission.owner_id
        || entry.configuration_sha256 !== shadowHash(configuration) || entry.authorization_sha256 !== shadowHash(authorization)
        || (retained?.instance_sha256 ?? createAgenticProcess(creation).instance_sha256) !== entry.initial_instance_sha256) fail("PROCESS_WORKER_ALLOCATION_CHANGED");
      let history = null;
      if (entry.generation === 1) assertAgenticProcessStart(retained, creation);
      else {
        if (!retained) fail("PROCESS_WORKER_ALLOCATION_CHANGED");
        history = readNativeAllocationHistory({ journal, entry: journal.allocations.at(-2), current: retained, configuration, signer, controls,
          controlContext: () => readNativeControlContext(configuration, productSha256) });
        assertNativeAllocationProjection(retained, configuration, project.stateMode === "dual"
          || project.stateMode === "files" && agenticProcessPersistence({ targetRoot: configuration.target_root, env: environment }).backend === "postgres");
      }
      return { history, output_id: nativeAllocationOutputId(configuration.instance_id, entry.generation), generation: entry.generation,
        canonical_sha256: retained?.instance_sha256 ?? null };
    },
  });
}
