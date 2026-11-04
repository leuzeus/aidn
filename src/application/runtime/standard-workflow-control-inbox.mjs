import { assertControlRequest, assertControlSource, assertControlReviewPayload, controlInboxId, controlDelivery } from "../../core/workflow/process-control-inbox.mjs";
import { checkShadowJson, shadowHash } from "../../core/workflow/shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
export function createStandardControlInbox({ store, signer, source, projectionRequired }) {
  function read(id) {
    const value = store.read(id); if (!value.record) fail("PROCESS_CONTROL_CAPTURE_UNAVAILABLE");
    signer.verify(value.record); return value;
  }
  function persist(body, before) {
    const record = signer.seal(body); store.compareAndSwap(record, before);
    if (projectionRequired) store.materialize(record.inbox_id, { write: true });
    return record;
  }
  async function invoke(method, input, signal) {
    if (typeof source?.[method] !== "function") fail("PROCESS_CONTROL_AUTHORITY_UNAVAILABLE");
    const stop = new AbortController(), combined = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
    if (combined.aborted) fail("PROCESS_CONTROL_AUTHORITY_ABORTED");
    let timer, onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(Object.assign(new Error("PROCESS_CONTROL_AUTHORITY_ABORTED"), { code: "PROCESS_CONTROL_AUTHORITY_ABORTED" }));
      combined.addEventListener("abort", onAbort, { once: true });
    });
    const expired = new Promise((_, reject) => { timer = setTimeout(() => {
      reject(Object.assign(new Error("PROCESS_CONTROL_AUTHORITY_TIMEOUT"), { code: "PROCESS_CONTROL_AUTHORITY_TIMEOUT" })); stop.abort();
    }, 5000); });
    try {
      const value = await Promise.race([Promise.resolve().then(() => source[method]({ ...structuredClone(input), signal: combined })), expired, aborted]);
      if (value !== null && checkShadowJson(value)) fail("PROCESS_CONTROL_AUTHORITY_INVALID");
      if (combined.aborted) fail("PROCESS_CONTROL_AUTHORITY_ABORTED");
      return structuredClone(value);
    } finally { clearTimeout(timer); combined.removeEventListener("abort", onAbort); stop.abort(); }
  }
  async function verify(record, signal) {
    const proof = await invoke(record.contract_version === "process-control-inbox.v2" ? "verifyReview" : "verify",
      { source: record.source, sourceRef: record.source_ref, request: record.request,
        ...(record.contract_version === "process-control-inbox.v2" ? { payload: record.payload } : {}) }, signal);
    if (proof?.outcome !== "verified" || proof.authority_id !== record.source.authority_id
      || proof.source_sha256 !== shadowHash(record.source)) fail("PROCESS_CONTROL_NOT_AUTHENTICATED");
  }
  async function reserve(request, sourceRef, { signal } = {}, withPayload = false) {
      assertControlRequest(request);
      if (typeof sourceRef !== "string" || !sourceRef || sourceRef.length > 256 || /[\x00-\x1f]/.test(sourceRef)) fail("PROCESS_CONTROL_SOURCE_REF_INVALID");
      const capture = await invoke(withPayload ? "readReview" : "read", { sourceRef, request }, signal);
      if (capture === null) return null;
      if (withPayload && (Object.keys(capture).sort().join(",") !== "payload,source")) fail("PROCESS_CONTROL_REVIEW_CAPTURE_INVALID");
      const claim = withPayload ? capture.source : capture;
      assertControlSource(claim, request);
      if (withPayload) assertControlReviewPayload(capture.payload, claim, request);
      const body = { contract_version: withPayload ? "process-control-inbox.v2" : "process-control-inbox.v1", inbox_id: controlInboxId(claim), source_ref: sourceRef,
        ...(withPayload ? { payload: capture.payload } : {}),
        request: structuredClone(request), source: claim, delivery: controlDelivery(request, claim), phase: "reserved", delivered_instance_sha256: null };
      await verify(body, signal);
      const before = store.read(body.inbox_id);
      if (before.record) {
        signer.verify(before.record);
        if (before.record.contract_version !== body.contract_version || shadowHash(before.record.request) !== shadowHash(request) || shadowHash(before.record.source) !== shadowHash(claim)
          || withPayload && shadowHash(before.record.payload) !== shadowHash(capture.payload)
          || before.record.source_ref !== sourceRef) fail("PROCESS_CONTROL_SOURCE_ALREADY_USED");
        if (projectionRequired) store.materialize(body.inbox_id, { write: true });
        return before.record;
      }
      return persist(body, null);
  }
  return Object.freeze({
    read: id => structuredClone(read(id).record),
    reserve: (request, sourceRef, options) => reserve(request, sourceRef, options),
    reserveReview: (request, sourceRef, options) => reserve(request, sourceRef, options, true),
    async verifyDelivery(id, signal) { const record = read(id).record; await verify(record, signal); return record.delivery; },
    acknowledge(id, instanceSha256) {
      const before = read(id), record = before.record;
      if (record.phase === "delivered") {
        if (record.delivered_instance_sha256 !== instanceSha256) fail("PROCESS_CONTROL_ACK_CHANGED");
        if (projectionRequired) store.materialize(id, { write: true });
        return record;
      }
      const { authentication, key_id, ...body } = record;
      return persist({ ...body, phase: "delivered", delivered_instance_sha256: instanceSha256 }, before.content_sha256);
    },
  });
}
