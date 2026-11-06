import { assertAgenticProcessInstance, inspectAgenticProcess } from "../../core/workflow/agentic-process.mjs";
import { createWorkflowRecordStore } from "./workflow-record-store.mjs";
import { workflowInstanceArtifactPath } from "./workflow-instance-store.mjs";

// Existing canonical artifact CAS and projection rules are reused. Historical
// workflow-instance.v1 files are never converted or read through this adapter.
// Identity metadata only: each function performs a new canonical read. No
// instance, cursor, authority or read result is retained between invocations.
const inspectionReaders = new WeakMap();
export function createAgenticProcessStore(options) {
  const { readInspected, ...methods } = createWorkflowRecordStore({ ...options, descriptor: {
    pathForId: id => workflowInstanceArtifactPath(id).replace("workflows/instances/", "workflows/process-instances/"),
    validate: assertAgenticProcessInstance, inspect: inspectAgenticProcess, idOf: value => value.instance_id,
    hashOf: value => value.instance_sha256, kind: "agentic_process_instance",
  } });
  const store = Object.freeze(methods);
  inspectionReaders.set(store, readInspected);
  return store;
}

// Only exact adapter-created stores qualify. Copies, proxies and optional
// methods supplied by another port cannot provide an inspection capability.
export function readAgenticProcessStoreInspection(store, instanceId) {
  const read = inspectionReaders.get(store);
  return read ? read(instanceId) : null;
}
