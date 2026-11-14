import { createWorkflowRecordStore } from "./workflow-record-store.mjs";
import { assertNativeAllocationJournal, nativeJournalPath } from "../../core/workflow/native-allocation-journal.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";

export function createNativeAllocationJournalStore(options) {
  return createWorkflowRecordStore({ ...options, descriptor: { pathForId: nativeJournalPath, validate: assertNativeAllocationJournal,
    idOf: value => value.journal_id, hashOf: shadowHash, kind: "native_allocation_journal" } });
}
