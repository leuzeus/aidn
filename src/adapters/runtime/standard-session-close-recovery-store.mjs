import { createWorkflowRecordStore } from "./workflow-record-store.mjs";
import { assertSessionCloseRecoveryRecord } from "../../core/workflow/standard-session-close-recovery.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";

export function createSessionCloseRecoveryStore(options) {
  return createWorkflowRecordStore({ ...options, descriptor: {
    pathForId: id => {
      if (!/^op_[a-f0-9]{40}$/.test(id ?? "")) throw Object.assign(Error("STANDARD_SESSION_RECOVERY_ID_INVALID"), { code: "STANDARD_SESSION_RECOVERY_ID_INVALID" });
      return `workflows/session-close-recoveries/${id}.json`;
    }, validate: assertSessionCloseRecoveryRecord, idOf: value => value.operation_id,
    hashOf: shadowHash, kind: "process_operation_journal",
  } });
}
