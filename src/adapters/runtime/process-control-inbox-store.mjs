import { createWorkflowRecordStore } from "./workflow-record-store.mjs";
import { assertControlInbox, controlInboxPath } from "../../core/workflow/process-control-inbox.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";

export function createProcessControlInboxStore(options) {
  return createWorkflowRecordStore({ ...options, descriptor: { pathForId: controlInboxPath, validate: assertControlInbox,
    idOf: value => value.inbox_id, hashOf: shadowHash, kind: "process_control_inbox" } });
}
