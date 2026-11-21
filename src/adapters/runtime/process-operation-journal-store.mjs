import { createWorkflowRecordStore } from "./workflow-record-store.mjs";
import { assertOperationJournal, operationJournalPath } from "../../core/workflow/process-operation-journal.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";

export function createProcessOperationJournalStore(options) {
  return createWorkflowRecordStore({ ...options, descriptor: { pathForId: operationJournalPath, validate: assertOperationJournal,
    idOf: value => value.operation_id, hashOf: shadowHash, kind: "process_operation_journal" } });
}
