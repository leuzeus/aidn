import { shadowHash as H, checkShadowJson } from "./shadow-json.mjs";
import { artifactContentHash as bytesHash } from "./artifact-compare-swap.mjs";
import { assertHandoffProcessObservation } from "./handoff-process-observation.mjs";
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import requestSchema from "../contracts/workflow-definition/standard-session-close-recovery.v1.schema.json" with { type: "json" };
import recordSchema from "../contracts/workflow-definition/standard-session-close-recovery-record.v1.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(Error(code), { code }); };
const assert = (value, schema, code) => {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length) fail(code);
  return value;
};
export const assertSessionCloseRecoveryRequest = value => assert(value, requestSchema, "STANDARD_SESSION_RECOVERY_REQUEST_INVALID");
export function assertSessionCloseRecoveryRecord(value) {
  assert(value, recordSchema, "STANDARD_SESSION_RECOVERY_RECORD_INVALID");
  const same = (a, b) => H(a) === H(b);
  for (const attempt of value.attempts) {
    const proposed = attempt.fence_intention.record;
    for (const observation of attempt.process_observations) {
      assertHandoffProcessObservation(observation);
      if (!same(observation.observer_identity, attempt.process_identity) || !observation.stable
        || observation.samples.some(row => row.processes.length || row.unavailable.length)) fail("STANDARD_SESSION_RECOVERY_RECORD_INVALID");
    }
    if (proposed.state !== "held" || !same(proposed.process_identity, attempt.process_identity)
      || attempt.lease && (!same(attempt.lease.record, proposed) || attempt.lease.previous_sha256 !== attempt.fence_intention.previous_sha256)
      || attempt.retirement && (!attempt.lease || attempt.retirement.lock_sha256 !== value.evidence.lock_sha256)
      || attempt.released_fence && (!attempt.retirement || !same(attempt.released_fence.record, releasedSessionRecoveryFence(proposed))))
      fail("STANDARD_SESSION_RECOVERY_RECORD_INVALID");
  }
  if (value.evidence.operation_id !== value.operation_id
    || new Set(value.attempts.map(attempt => attempt.fence_intention.record.token)).size !== value.attempts.length)
    fail("STANDARD_SESSION_RECOVERY_RECORD_INVALID");
  if (value.phase === "completed" && !value.attempts.at(-1).released_fence) fail("STANDARD_SESSION_RECOVERY_RECORD_INVALID");
  return value;
}
export const releasedSessionRecoveryFence = record => ({ ...record, revision: record.revision + 1, state: "released" });
export function sessionRecoveryOwnsFence(recovery, current) {
  return recovery.attempts.some(attempt => H(attempt.fence_intention.record) === H(current)
    || attempt.retirement && H(releasedSessionRecoveryFence(attempt.fence_intention.record)) === H(current));
}
export function sessionCloseRecoveryEvidence(value) {
  return { instance_id: value.instance.instance_id, operation_id: value.record.operation_id,
    scope_id: value.instance.scope_id, model_sha256: value.instance.model_sha256, instance_sha256: value.instance.instance_sha256,
    journal_sha256: H(value.record), dispatch_sha256: H(value.capsule), native_sha256: H(value.native),
    records_sha256: H(value.records), configuration_sha256: H(value.execution), historical_proof_sha256: H(value.historical.proof),
    authority_sha256: value.context.authority_sha256, context_sha256: value.context.context_sha256,
    events_sha256: value.physical.events_sha256, run_file_sha256: value.physical.run_file_sha256, documents_sha256: H(value.physical.documents),
    original_fence_sha256: H(value.owner.lease.resource_fence), lock_sha256: value.owner.lock.sha256 };
}

// Pure closed suffix assessment; authentication and live ownership are separate.
export function assertSessionCloseCheckpointOnly({ plan, events, run }) {
  const ensure = (ok, code) => { if (!ok) fail(code); }, same = (a, b) => H(a) === H(b);
      ensure(run.sha256 === plan.run_file_sha256 && run.value.toString('utf8') === plan.run_id + '\n'
        && events.value.length > plan.event_log.bytes && events.value.length - plan.event_log.bytes <= 65536
        && events.value.at(-1) === 10 && bytesHash(events.value.subarray(0, plan.event_log.bytes)) === plan.event_log.sha256, 'STANDARD_SESSION_RECOVERY_EVENT_CHANGED');
      const rows = events.value.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line));
      const delta = events.value.subarray(plan.event_log.bytes).toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line));
      ensure(!rows.some(row => row.event === 'hook_session_close' && row.run_id === plan.run_id)
        && same(delta.map(row => row.event), ['gating_summary', 'reload_decision', 'checkpoint_summary'])
        && delta[0].result === 'warn' && delta[0].reason_code === 'L2_SIGNAL_TRIGGERED' && delta[0].gates_triggered.includes('R05')
        && ['ok', 'fallback'].includes(delta[1].result) && delta[2].result === 'ok' && delta[2].repair_layer_blocking === false
        && delta[1].run_id === delta[2].run_id && delta.every(row => row.branch === plan.branch && row.mode === plan.mode
          && Number.isFinite(Date.parse(row.ts)) && Date.parse(row.ts) >= plan.prepared_at_ms), 'STANDARD_SESSION_RECOVERY_CHECKPOINT_ONLY_REQUIRED');
  return { events_sha256: events.sha256, run_file_sha256: run.sha256 };
}
