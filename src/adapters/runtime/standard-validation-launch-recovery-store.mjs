import { createWorkflowRecordStore } from "./workflow-record-store.mjs";
import { assertValidationLaunchRecoveryRecord } from "../../core/workflow/standard-validation-launch-recovery.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";

export function createValidationLaunchRecoveryStore(options) {
  return createWorkflowRecordStore({ ...options, descriptor: {
    pathForId: id => {
      if (!/^op_[a-f0-9]{40}$/.test(id ?? "")) throw Object.assign(Error("STANDARD_VALIDATION_RECOVERY_ID_INVALID"), { code: "STANDARD_VALIDATION_RECOVERY_ID_INVALID" });
      return `workflows/validation-launch-recoveries/${id}.json`;
    }, validate: assertValidationLaunchRecoveryRecord, idOf: value => value.operation_id,
    hashOf: shadowHash, kind: "process_operation_journal",
  } });
}
