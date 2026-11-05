import { createWorkflowRecordStore } from "./workflow-record-store.mjs";
import { assertProcessDispatchRecord, dispatchRecordPath } from "../../core/workflow/process-dispatch-record.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";

export function createProcessDispatchRecordStore(options) {
  return createWorkflowRecordStore({ ...options, descriptor: { pathForId: dispatchRecordPath, validate: assertProcessDispatchRecord,
    idOf: value => value.operation_id, hashOf: shadowHash, kind: "process_operation_journal" } });
}
