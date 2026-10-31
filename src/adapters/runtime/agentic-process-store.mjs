import { assertAgenticProcessInstance } from "../../core/workflow/agentic-process.mjs";
import { createWorkflowRecordStore } from "./workflow-record-store.mjs";
import { workflowInstanceArtifactPath } from "./workflow-instance-store.mjs";

// Existing canonical artifact CAS and projection rules are reused. Historical
// workflow-instance.v1 files are never converted or read through this adapter.
export function createAgenticProcessStore(options) {
  return createWorkflowRecordStore({ ...options, descriptor: {
    pathForId: id => workflowInstanceArtifactPath(id).replace("workflows/instances/", "workflows/process-instances/"),
    validate: assertAgenticProcessInstance, idOf: value => value.instance_id,
    hashOf: value => value.instance_sha256, kind: "agentic_process_instance",
  } });
}
