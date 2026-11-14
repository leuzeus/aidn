import { startAgentAdmissionTransport, requestAgentAdmission } from "../../adapters/runtime/agent-admission-transport.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const fields = (value, names) => value && !checkShadowJson(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
// This live, reservation-bound capability travels only over trusted worker stdin.
// It is never authored model data, an environment variable or native prompt data.
// The existing transport authenticates each request and response with a fresh nonce.
export async function startNativeHumanVerificationPort({ reservation, verify }) {
  if (typeof verify !== "function") fail("STANDARD_DRIFT_HUMAN_PORT_REQUIRED");
  const attemptId = reservation.owner_id, requestSha256 = shadowHash(reservation);
  const transport = await startAgentAdmissionTransport({ attemptId, requestSha256, async admit(packet, { signal }) {
    let allowed = false, reason = "STANDARD_DRIFT_HUMAN_REQUEST_INVALID";
    if (fields(packet, ["attempt_id", "request_sha256", "operation_id", "source_sha256", "question_sha256"])) {
      try { await verify(packet, signal); allowed = true; reason = "STANDARD_DRIFT_HUMAN_VERIFIED"; }
      catch (error) { if (/^[A-Z][A-Z0-9_]{0,95}$/.test(error.code ?? "") && error.code !== "STANDARD_DRIFT_HUMAN_VERIFIED") reason = error.code; }
    }
    return { protocol_version: 1, ok: allowed, outcome: allowed ? "allow" : "deny", reason_code: reason, attempt_id: attemptId, request_sha256: requestSha256 };
  } });
  return Object.freeze({ capability: Object.freeze({ contract_version: "native-human-verification.v1", endpoint: transport.endpoint, token: transport.token,
    attempt_id: attemptId, request_sha256: requestSha256 }), close: () => transport.close() });
}

export function createWorkerHumanVerificationSource(capability) {
  if (!fields(capability, ["contract_version", "endpoint", "token", "attempt_id", "request_sha256"])
    || capability.contract_version !== "native-human-verification.v1") fail("STANDARD_DRIFT_HUMAN_PORT_REQUIRED");
  const retained = Object.freeze(structuredClone(capability));
  return Object.freeze({ async verify({ source, question, historical, signal }) {
    if (historical || signal?.aborted) fail("STANDARD_DRIFT_HUMAN_CURRENT_REQUIRED");
    const result = await requestAgentAdmission({ endpoint: retained.endpoint, token: retained.token, timeoutMs: 4500,
      request: { attempt_id: retained.attempt_id, request_sha256: retained.request_sha256, operation_id: question.operation_id,
        source_sha256: shadowHash(source), question_sha256: shadowHash(question) } });
    if (signal?.aborted) fail("PROCESS_HUMAN_AUTHORITY_ABORTED");
    if (result.outcome !== "allow") fail(result.reason_code);
    return { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) };
  } });
}
