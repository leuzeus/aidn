import { createAgenticProcess, assertAgenticProcessInstance } from "./agentic-process.mjs";
import { processFail as fail } from "./agentic-process-model.mjs";

// An unstarted console-created instance can enter its owned native host. Any
// event/history, changed model, facts, scope or policy requires reconciliation.
export function assertAgenticProcessStart(record, creation) {
  if (!record) return;
  assertAgenticProcessInstance(record);
  const initial = createAgenticProcess(creation);
  if (record.instance_sha256 !== initial.instance_sha256 || record.events.length !== 0)
    fail("PROCESS_EXECUTION_EXISTING_INSTANCE_REQUIRES_RECONCILIATION");
}
