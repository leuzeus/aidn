import { assertWorkflowInstance, workflowInstanceFail as fail } from "../../core/workflow/workflow-instance.mjs";
import { createWorkflowRecordStore } from "./workflow-record-store.mjs";

export function workflowInstanceArtifactPath(id) {
  if (typeof id !== "string" || !/^[a-z][a-z0-9_-]{0,95}$/.test(id) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(id)) fail("WORKFLOW_INSTANCE_ID_INVALID");
  return "workflows/instances/" + id + ".json";
}

export function createWorkflowInstanceStore(options) {
  const store = createWorkflowRecordStore({ ...options, descriptor: {
    pathForId: workflowInstanceArtifactPath, validate: assertWorkflowInstance,
    idOf: value => value.instance_id, hashOf: value => value.instance_sha256, kind: "workflow_instance",
  } });
  const instance = ({ record, ...rest }) => ({ instance: record, ...rest });
  return Object.freeze({
    read: id => instance(store.read(id)),
    compareAndSwap: (value, expected) => instance(store.compareAndSwap(value, expected)),
    materialize(id, options) { const { record_sha256, ...rest } = store.materialize(id, options); return { ...rest, instance_sha256: record_sha256 }; },
  });
}
