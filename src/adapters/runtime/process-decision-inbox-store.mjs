import { createWorkflowRecordStore } from "./workflow-record-store.mjs";
import { assertDecisionInbox, decisionInboxPath } from "../../core/workflow/process-decision-inbox.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
export function createProcessDecisionInboxStore(options) {
  return createWorkflowRecordStore({ ...options, descriptor: { pathForId: decisionInboxPath, validate: assertDecisionInbox,
    idOf: value => value.inbox_id, hashOf: shadowHash, kind: "process_decision_inbox" } });
}
