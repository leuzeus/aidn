import { shadowHash as H } from "../../core/workflow/shadow-json.mjs";
import { assertSessionCloseRecoveryRecord, sessionCloseRecoveryEvidence } from "../../core/workflow/standard-session-close-recovery.mjs";
import { observeLocalProcessOwner } from "../../adapters/runtime/local-process-identity.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };

// Internal ports only. The public composition supplies the canonical store,
// historical verifier and exact-identity retirement adapter, never JSON hooks.
export function createSessionRecoveryWriter({ request, signer, store, fence, observe, retire,
  implementationSha256, assertImplementation, observeOwner = observeLocalProcessOwner, boundary = async () => {} }) {
  const id = request.operation_id, requestSha = H(request);
  function read() {
    const found = store.read(id);
    if (found.record) {
      assertSessionCloseRecoveryRecord(found.record); signer.verify(found.record);
      if (found.record.request_sha256 !== requestSha || found.record.implementation_sha256 !== implementationSha256)
        fail("STANDARD_SESSION_RECOVERY_REQUEST_CHANGED");
    }
    return found;
  }
  function result(retained, written) {
    return { contract_version: "standard-session-close-recovery-result.v1", operation_id: id, instance_id: request.instance_id,
      record_sha256: H(retained.record), status: "reconciled_checkpoint_only", written, original_history_preserved: true,
      session_closed: false, workflow_resumed: false, native_started: false };
  }
  async function prepare() {
    assertImplementation();
    const retained = read();
    let observed = null;
    if (retained.record?.phase !== "completed") {
      const previous = retained.record?.attempts.at(-1);
      if (previous && observeOwner(previous.process_identity) !== "terminated") fail("STANDARD_SESSION_RECOVERY_OWNER_ACTIVE");
      if (retained.record?.attempts.length >= 32) fail("STANDARD_SESSION_RECOVERY_ATTEMPT_LIMIT");
      observed = await observe(retained.record);
      if (retained.record && H(retained.record.evidence) !== H(sessionCloseRecoveryEvidence(observed)))
        fail("STANDARD_SESSION_RECOVERY_SUBJECT_CHANGED");
    }
    const plan = { contract_version: "standard-session-close-recovery-plan.v1", operation_id: id, instance_id: request.instance_id,
      request_sha256: requestSha, implementation_sha256: implementationSha256,
      evidence_sha256: H(retained.record?.evidence ?? sessionCloseRecoveryEvidence(observed)),
      record_sha256: retained.content_sha256, fence_sha256: observed?.owner.fence.content_sha256 ?? retained.record.attempts.at(-1).released_fence.content_sha256,
      already_completed: retained.record?.phase === "completed", closure_status: "checkpoint_only", workflow_resumed: false };
    return { retained, observed, plan, action_sha256: H(plan) };
  }
  return {
    async preview() { const { plan, action_sha256 } = await prepare(); return { plan, action_sha256 }; },
    async execute({ expectPlan }) {
      let durableWrites = false;
      try {
      const prepared = await prepare();
      if (expectPlan !== prepared.action_sha256) fail("STANDARD_SESSION_RECOVERY_PLAN_CHANGED");
      let retained = prepared.retained;
      if (retained.record?.phase === "completed") return result(retained, false);
      const observed = prepared.observed;
      const permit = () => {
        assertImplementation(); observed.assertStable();
        if (read().content_sha256 !== retained.content_sha256) fail("STANDARD_SESSION_RECOVERY_RECORD_CHANGED");
      };
      const save = value => {
        permit(); const signed = signer.seal(value); assertSessionCloseRecoveryRecord(signed);
        const saved = store.compareAndSwap(signed, retained.content_sha256);
        durableWrites = true;
        if (saved.projection === "pending") store.materialize(id, { write: true });
        retained = read();
        if (H(retained.record) !== H(signed)) fail("STANDARD_SESSION_RECOVERY_RECORD_CHANGED");
      };
      const before = observed.owner.fence;
      const intention = fence.prepareAcquire({ expectedSha256: before.content_sha256 });
      const attempt = { process_identity: intention.record.process_identity, fence_intention: intention,
        process_observations: observed.processes, lease: null, retirement: null, released_fence: null };
      await boundary("before_intent"); permit();
      save({ contract_version: "standard-session-close-recovery-record.v1", operation_id: id, request_sha256: requestSha,
        implementation_sha256: implementationSha256, evidence: sessionCloseRecoveryEvidence(observed), phase: "pending",
        attempts: [...(retained.record?.attempts ?? []), attempt] });
      await boundary("intent"); permit();
      const lease = fence.acquire({ expectedSha256: before.content_sha256, prepared: intention,
        ...(before.record.state === "held" ? { dispositionLease: before.record } : {}) });
      await boundary("fence_acquired"); permit(); fence.assert(lease);
      const update = (fields, phase = "pending") => {
        const attempts = structuredClone(retained.record.attempts); Object.assign(attempts.at(-1), fields);
        save({ ...retained.record, attempts, phase });
      };
      update({ lease: { record: lease.record, content_sha256: lease.content_sha256, previous_sha256: lease.previous_sha256 } });
      await boundary("lease_retained"); permit(); fence.assert(lease);
      const retirement = retire({ observed, dispositionLease: lease, assertPermit: permit });
      await boundary("lock_retired"); permit(); fence.assert(lease);
      update({ retirement });
      await boundary("retirement_retained"); permit(); fence.assert(lease);
      const released = fence.release(lease);
      await boundary("fence_released"); permit();
      update({ released_fence: { record: released.record, content_sha256: released.content_sha256 } });
      await boundary("release_retained"); permit();
      update({}, "completed");
      await boundary("completed");
      return result(retained, true);
      } catch (cause) {
        if (durableWrites) cause.recovery_written = true;
        throw cause;
      }
    },
  };
}
