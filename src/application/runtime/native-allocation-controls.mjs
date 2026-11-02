import { execFileSync } from "node:child_process";
import { createStandardControlInbox } from "./standard-workflow-control-inbox.mjs";
import { createProcessControlInboxStore } from "../../adapters/runtime/process-control-inbox-store.mjs";
import { createAgenticProcessService } from "./agentic-process-service.mjs";
import { assertControlRequest } from "../../core/workflow/process-control-inbox.mjs";
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from "../../core/workflow/agentic-process.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
export function readNativeControlContext(configuration, productSha256) {
  const git = args => execFileSync("git", args, { cwd: configuration.target_root, encoding: "utf8", timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  try { return { configuration_sha256: shadowHash(configuration), product_sha256: productSha256,
    branch: git(["symbolic-ref", "--quiet", "--short", "HEAD"]), head: git(["rev-parse", "HEAD"]) }; }
  catch { fail("PROCESS_CONTROL_CONTEXT_UNAVAILABLE"); }
}
export function createNativeAllocationControls({ configuration, signer, options, projectionRequired, source, store, readCurrent, readAuthority, preview }) {
  if (source != null && (typeof source.read !== "function" || typeof source.verify !== "function")) fail("PROCESS_CONTROL_AUTHORITY_UNAVAILABLE");
  const inbox = createStandardControlInbox({ store: createProcessControlInboxStore(options), signer, source, projectionRequired });
  function context() {
    return readNativeControlContext(configuration, preview().product_sha256);
  }
  const service = createAgenticProcessService({ store, readAuthority, authorityTimeoutMs: 5000,
    controlAuthority: {
      read({ delivery_id }) { return inbox.read(delivery_id).delivery; },
      async verify({ delivery, signal }) {
        const capture = inbox.read(delivery.delivery_id);
        if (shadowHash(context()) !== capture.request.context_sha256) fail("PROCESS_CONTROL_CONTEXT_CHANGED");
        const value = await inbox.verifyDelivery(delivery.delivery_id, signal);
        return { outcome: "verified", authority_id: value.authority_id, delivery_sha256: shadowHash(value) };
      },
    } });
  function checkpoint(record, eventId) {
    let state = createAgenticProcess({ instanceId: record.instance_id, scopeId: record.scope_id, model: record.model, policyPins: record.policy_pins, facts: record.initial_facts });
    for (const event of record.events) { state = advanceAgenticProcess(state, event); if (event.event_id === eventId) return state.instance_sha256; }
    fail("PROCESS_CONTROL_INSTANCE_CHANGED");
  }
  function request(occurrenceId) {
    if (!source) fail("PROCESS_CONTROL_AUTHORITY_UNAVAILABLE");
    const record = readCurrent(), cursor = inspectAgenticProcess(record), frame = cursor.occurrences.find(row => row.occurrence_id === occurrenceId);
    const node = frame && record.model.nodes.find(row => row.id === frame.node_id), observed = context();
    if (frame?.status !== "WAITING" || node?.kind !== "event") fail("PROCESS_CONTROL_ORDER_INVALID");
    return assertControlRequest({ contract_version: "process-control-request.v1", scope_id: record.scope_id, instance_id: record.instance_id,
      instance_sha256: record.instance_sha256, model_sha256: record.model_sha256, instance_revision: record.revision, occurrence_id: occurrenceId,
      correlation_id: frame.correlation_id, event_keys: node.branches.map(row => row.event_key), context_sha256: shadowHash(observed), branch: observed.branch, head: observed.head });
  }
  return Object.freeze({
    prepare: request,
    async capture({ occurrenceId, sourceRef, write = false }) {
      if (write !== true) fail("PROCESS_CONTROL_EXPLICIT_WRITE_REQUIRED");
      const capture = await inbox.reserve(request(occurrenceId), sourceRef);
      return capture ? { status: "reserved", inbox_id: capture.inbox_id, delivery_sha256: shadowHash(capture.delivery) } : { status: "WAITING", written: false };
    },
    async deliver(id, { write = false } = {}) {
      if (write !== true) fail("PROCESS_CONTROL_EXPLICIT_WRITE_REQUIRED");
      const capture = inbox.read(id), record = readCurrent(), eventId = "control_" + id.slice(8);
      const existing = record.events.find(row => row.event_id === eventId);
      if (existing) {
        if (existing.kind !== "control" || shadowHash(existing.delivery) !== shadowHash(capture.delivery)) fail("PROCESS_CONTROL_NOT_AUTHENTICATED");
        inbox.acknowledge(id, checkpoint(record, eventId));
        if (projectionRequired) store.materialize(record.instance_id, { write: true });
        return { written: false, retained: true, record, cursor: inspectAgenticProcess(record) };
      }
      if (capture.phase !== "reserved" || capture.request.instance_sha256 !== record.instance_sha256) fail("PROCESS_CONTROL_INSTANCE_CHANGED");
      const result = await service.deliverControl({ instanceId: record.instance_id, expectedSha256: record.instance_sha256, occurrenceId: capture.request.occurrence_id,
        deliveryId: capture.delivery.delivery_id, eventId, write: true });
      inbox.acknowledge(id, result.record.instance_sha256);
      return result;
    },
    read: id => inbox.read(id),
  });
}
