import assert from "node:assert/strict";
import { startNativeHumanVerificationPort, createWorkerHumanVerificationSource } from "../../src/application/runtime/native-human-verification-port.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

// Actual authenticated loopback ports; current H is an explicit test double.
// This does not execute the production parent/worker activity or a model client.
export async function verifyNativeHumanVerificationPort() {
  const source = { authority_id: "fixture_human", choice: "request_diagnosis", question_sha256: "a".repeat(64) };
  const question = { operation_id: "op_" + "a".repeat(40), subject: "exact-fixture-subject" };
  const reservation = { journal_id: "fixture-journal", generation: 2, owner_id: "fixture-owner" };
  let live = true, expired = false, onVerify = async () => {}, checks = 0;
  const transport = await startNativeHumanVerificationPort({ reservation, async verify(packet) {
    await onVerify();
    if (!live) throw Object.assign(Error(), { code: "PROCESS_HUMAN_NOT_AUTHENTICATED" });
    if (expired) throw Object.assign(Error(), { code: "STANDARD_DRIFT_DIAGNOSIS_REQUEST_EXPIRED" });
    if (packet.operation_id !== question.operation_id || packet.source_sha256 !== shadowHash(source) || packet.question_sha256 !== shadowHash(question))
      throw Object.assign(Error(), { code: "STANDARD_DRIFT_DIAGNOSIS_REQUEST_REQUIRED" });
  } });
  try {
    const worker = createWorkerHumanVerificationSource(transport.capability);
    const verify = change => worker.verify({ source, question, historical: false, ...change });
    assert.equal((await verify()).source_sha256, shadowHash(source)); checks++;
    live = false; await assert.rejects(verify(), { code: "PROCESS_HUMAN_NOT_AUTHENTICATED" }); checks++; live = true;
    for (const change of [{ source: { ...source, authority_id: "another" } }, { question: { ...question, subject: "another" } },
      { question: { ...question, operation_id: "op_" + "b".repeat(40) } }]) {
      await assert.rejects(verify(change), { code: "STANDARD_DRIFT_DIAGNOSIS_REQUEST_REQUIRED" }); checks++;
    }
    onVerify = async () => { await new Promise(resolve => setImmediate(resolve)); expired = true; };
    await assert.rejects(verify(), { code: "STANDARD_DRIFT_DIAGNOSIS_REQUEST_EXPIRED" }); checks++; expired = false; onVerify = async () => {};
    await assert.rejects(verify({ historical: true }), { code: "STANDARD_DRIFT_HUMAN_CURRENT_REQUIRED" }); checks++;
    onVerify = async () => { throw Object.assign(Error(), { code: "STANDARD_DRIFT_HUMAN_VERIFIED" }); };
    await assert.rejects(verify(), { code: "STANDARD_DRIFT_HUMAN_REQUEST_INVALID" }); checks++;
    const cancellation = new AbortController(); onVerify = async () => cancellation.abort();
    await assert.rejects(verify({ signal: cancellation.signal }), { code: "PROCESS_HUMAN_AUTHORITY_ABORTED" }); checks++;
    for (const change of [{ token: "b".repeat(64) }, { attempt_id: "another-owner" }, { request_sha256: "b".repeat(64) }]) {
      const wrong = createWorkerHumanVerificationSource({ ...transport.capability, ...change });
      await assert.rejects(wrong.verify({ source, question })); checks++;
    }
  } finally { await transport.close(); }
  await assert.rejects(createWorkerHumanVerificationSource(transport.capability).verify({ source, question })); checks++;
  return { checks, scope: "real-loopback-protocol-with-fixture-current-H", production_worker: "NOT_RUN", native: "NOT_RUN", published_process: "NOT_RUN" };
}
