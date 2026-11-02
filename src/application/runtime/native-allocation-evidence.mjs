import path from "node:path";
import { readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { assertNativeCheckpointEvidence } from "../../core/workflow/native-allocation-journal.mjs";
import { advanceAgenticProcess, assertAgenticProcessInstance } from "../../core/workflow/agentic-process.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const json = file => readAgentRunFile(file, { maxBytes: 262144 });
// A dot cannot occur in a process instance ID, so an allocation namespace cannot
// collide with another valid instance's initial output directory.
export const nativeAllocationOutputId = (instanceId, generation) => generation === 1 ? instanceId : `${instanceId}.g${generation}`;
export function nativeEvidenceFile(configuration, ref, maximumGeneration) {
  const match = /^execution\/([a-z][a-z0-9_.-]{0,70})\/([0-9]{5}-[a-z-]+\.json)$/.exec(ref?.ref ?? "");
  if (!match || !Array.from({ length: maximumGeneration }, (_, index) => nativeAllocationOutputId(configuration.instance_id, index + 1)).includes(match[1])) fail("NATIVE_ALLOCATION_EVIDENCE_CHANGED");
  return path.join(configuration.control_root, match[1], match[2]);
}
export function verifyNativeResultEvidence(state, configuration, generation) {
  for (const row of state.results) for (const ref of [row.reference, ...row.result.evidence_refs]) {
    if (json(nativeEvidenceFile(configuration, ref, generation)).sha256 !== ref.sha256) fail("NATIVE_ALLOCATION_EVIDENCE_CHANGED");
  }
}
export function readNativeAllocationCheckpoint(entry, configuration, { scopeId, modelSha256 }) {
  if (!entry.checkpoint || !entry.closure_ref) fail("NATIVE_ALLOCATION_CHECKPOINT_UNAVAILABLE");
  const output = nativeAllocationOutputId(configuration.instance_id, entry.generation);
  if (path.dirname(entry.checkpoint.path) !== path.join(configuration.control_root, output)
    || !/^[0-9]{5}-native-host-state\.json$/.test(path.basename(entry.checkpoint.path))
    || entry.closure_ref.path !== path.join(configuration.control_root, output + "-CLOSURE.json")) fail("NATIVE_ALLOCATION_EVIDENCE_CHANGED");
  const data = json(entry.checkpoint.path), closure = json(entry.closure_ref.path);
  if (data.sha256 !== entry.checkpoint.sha256 || closure.sha256 !== entry.closure_ref.sha256
    || shadowHash(closure.value) !== entry.owned_result_sha256 || shadowHash(closure.value.process_tree) !== entry.tree_proof_sha256) fail("NATIVE_ALLOCATION_EVIDENCE_CHANGED");
  if (entry.phase === "closed" && (closure.value.first_failure !== null || closure.value.status !== entry.owned_status
    || closure.value.process_tree?.termination_state !== "confirmed" || closure.value.process_tree?.termination_proof?.active_processes !== 0
    || closure.value.global_deadline_ms !== entry.limits.global_deadline_ms || closure.value.authorized_at_ms !== entry.limits.authorized_at_ms)) fail("NATIVE_ALLOCATION_PARENT_UNCONFIRMED");
  assertNativeCheckpointEvidence(data.value, { instanceId: configuration.instance_id, scopeId, modelSha256,
    authorizationSha256: entry.authorization_sha256, limits: entry.limits });
  if (shadowHash(data.value.state) !== entry.checkpoint.state_sha256 || data.value.state.instance.instance_sha256 !== entry.checkpoint.instance_sha256) fail("NATIVE_ALLOCATION_CHECKPOINT_CHANGED");
  verifyNativeResultEvidence(data.value.state, configuration, entry.generation);
  return data.value;
}
export function assertNativeAllocationProjection(current, configuration, required) {
  if (!required || !current) return;
  try {
    const visible = json(path.join(configuration.target_root, "docs/audit/workflows/process-instances", configuration.instance_id + ".json")).value;
    if (shadowHash(visible) !== shadowHash(current)) fail("NATIVE_ALLOCATION_PROJECTION_RECONCILIATION_REQUIRED");
  } catch { fail("NATIVE_ALLOCATION_PROJECTION_RECONCILIATION_REQUIRED"); }
}
// The caller has authenticated the allocation journal. Every additional control
// event is separately authenticated; valid reducer hashes alone are insufficient.
export function readNativeAllocationHistory({ journal, entry, current, configuration, signer, controls, controlContext }) {
  if (entry.phase !== "closed" || !entry.tree_closed) fail("NATIVE_ALLOCATION_RECONCILIATION_REQUIRED");
  const checkpoint = readNativeAllocationCheckpoint(entry, configuration, { scopeId: journal.scope_id, modelSha256: journal.model_sha256 });
  if (!checkpoint.state.parent_closed) fail("NATIVE_ALLOCATION_PARENT_UNCONFIRMED");
  assertAgenticProcessInstance(current);
  let previous = checkpoint.state.instance;
  if (current.instance_id !== previous.instance_id || current.scope_id !== previous.scope_id || current.model_sha256 !== previous.model_sha256
    || current.events.length < previous.events.length || shadowHash(current.events.slice(0, previous.events.length)) !== shadowHash(previous.events)) fail("NATIVE_ALLOCATION_HISTORY_CHANGED");
  for (const event of current.events.slice(previous.events.length)) {
    if (event.kind !== "control") fail("NATIVE_ALLOCATION_HISTORY_NOT_AUTHENTICATED");
    const capture = controls.read(event.delivery.delivery_id).record;
    if (!capture) fail("NATIVE_ALLOCATION_CONTROL_NOT_AUTHENTICATED");
    signer.verify(capture);
    if (capture.request.instance_sha256 !== previous.instance_sha256 || shadowHash(capture.delivery) !== shadowHash(event.delivery)) fail("NATIVE_ALLOCATION_CONTROL_NOT_AUTHENTICATED");
    if (controlContext && capture.request.context_sha256 !== shadowHash(controlContext())) fail("NATIVE_ALLOCATION_CONTROL_CONTEXT_CHANGED");
    previous = advanceAgenticProcess(previous, event);
    if (capture.phase === "delivered" && capture.delivered_instance_sha256 !== previous.instance_sha256) fail("NATIVE_ALLOCATION_CONTROL_NOT_AUTHENTICATED");
  }
  if (previous.instance_sha256 !== current.instance_sha256) fail("NATIVE_ALLOCATION_HISTORY_CHANGED");
  return checkpoint.state;
}
