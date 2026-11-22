import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { createStandardConsoleFixture } from "./verify-standard-console-entry-fixtures.mjs";
import { createStandardOperatorSession } from "../../src/adapters/workflow-console/standard-operator-session.mjs";
import { createCodexDecisionChannel } from "../../src/adapters/workflow-console/codex-decision-channel.mjs";
import { operatorOffer, assertOperatorClaim } from "../../src/adapters/workflow-console/standard-operator-offer.mjs";
import { runStandardWorkflowEntry } from "../../src/application/runtime/standard-workflow-entry.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

const fixture = createStandardConsoleFixture();
const { target, config, configuration: request, dirs } = fixture;
const environment = { ...process.env, AIDN_STANDARD_HOST_HOME: dirs.authority };
const run = options => runStandardWorkflowEntry({ request, environment, ...options });
const session = dependencies => createStandardOperatorSession({ targetRoot: target, configuration: config, environment }, dependencies);
async function walkToQuestion() {
  for (let step = 0; step < 20; step++) {
    const planned = await run({});
    if (planned.preview.payload.question) return planned.preview.payload.question;
    assert(["prepare_host", "initialize", "operation", "dispatch", "call"].includes(planned.preview.kind));
    assert((await run({ preparedAction: planned.preview, execute: true, expectPlan: planned.action_sha256 })).written);
  }
  assert.fail("fixture did not reach a human question");
}
try {
  const secondOperator = generateKeyPairSync("ed25519");
  const other = { authority_id: "fixture_other", kinds: ["human"], public_key: secondOperator.publicKey.export({ format: "pem", type: "spki" }) };
  const enroll = principals => fs.writeFileSync(path.join(dirs.authority, "principals.json"), JSON.stringify({ contract_version: "standard-host-principals.v1", principals }));
  enroll([other]);
  const stopped = session({ enter: options => {
    if (options.execute) throw Error("FIXTURE_PROCESS_STOPPED");
    return runStandardWorkflowEntry(options);
  } });
  let answerCount = 0, lastAnswer;
  const channel = createCodexDecisionChannel({ session: { ...stopped, submit(e) { lastAnswer = e; return stopped.submit(e); } },
    formSupported: () => true, elicit: async form => {
      answerCount++; assert.deepEqual(form.requestedSchema.required, ["choice"]); return { action: "accept", content: { choice: "COMMITTING" } };
    } });
  const pub = channel.describe().public_key;
  enroll([other, { authority_id: "fixture_codex", kinds: ["human"], public_key: pub }]); // Disposable fixture enrollment.
  const q = await walkToQuestion();
  assert.equal(q.contract_version, "standard-mode-question.v1");
  const offer = (await session().question()).offer;
  assert.equal(offer.question_sha256, shadowHash(q));
  await assert.rejects(stopped.submit({ choice: "COMMITTING" }), /STANDARD_HOST_SOURCE_INVALID/);
  await assert.rejects(channel.decide(), /FIXTURE_PROCESS_STOPPED/);
  assert.equal(answerCount, 1);
  const { signature, ...body } = lastAnswer;
  assert(verify(null, Buffer.from(shadowHash(body)), pub, Buffer.from(signature, "base64")));
  const cold = session();
  assert.equal((await cold.question()).status, "retained");
  const altered = structuredClone(lastAnswer); altered.payload.choice = "THINKING";
  await assert.rejects(cold.submit(altered), /STANDARD_HOST_SOURCE_NOT_AUTHENTICATED/);
  const otherBody = { ...body, authority_id: other.authority_id, payload: { ...body.payload, authority_id: other.authority_id, choice: "THINKING" } };
  const otherAnswer = { ...otherBody, signature: sign(null, Buffer.from(shadowHash(otherBody)), secondOperator.privateKey).toString("base64") };
  await assert.rejects(cold.submit(otherAnswer), /OPERATOR_ANSWER_ALREADY_RECORDED/);
  const received = await cold.resume();
  assert.equal(received.choice, "COMMITTING"); assert.equal(received.outcome, "completed"); assert(received.receipt_id);
  assert.equal((await session().resume()).status, "workflow"); assert.deepEqual(session().session().last_receipt, received);
  await assert.rejects(session().submit(lastAnswer), /OPERATOR_QUESTION_CHANGED/);
  const record = JSON.parse(fs.readFileSync(path.join(target, "docs/audit/workflows/operation-records", q.operation_id + ".json")));
  assert.equal(record.results.length, 1); assert.equal(record.results[0].receipt.receipt_id, received.receipt_id);
  const subject = { repository_id: "R_test", pull_request_id: "PR_test", pull_request_number: 12, base_ref: "dev", head_oid: "a".repeat(40) };
  const merge = { ...q, contract_version: "standard-pr-merge-consent-question.v2", issued_at_ms: Date.now(), subject, choices: ["approve_merge", "refused"] };
  const consent = { ...lastAnswer.payload, contract_version: "human-pr-merge-consent.v1", source_event_id: "test-merge",
    choice: "approve_merge", rationale: "Reviewed this commit.", subject_sha256: shadowHash(subject), question_sha256: shadowHash(merge) };
  assert.equal(operatorOffer(merge, "test-merge").subject_sha256, consent.subject_sha256);
  assertOperatorClaim(consent, merge, "test-merge");
  assert.throws(() => assertOperatorClaim(consent, { ...merge, subject: { ...subject, head_oid: "b".repeat(40) } }, "test-merge"), /OPERATOR_DECISION_CHANGED/);
  console.log(JSON.stringify({ status: "PASS", proof: "Codex form fixture and public STANDARD FILES host", answers: answerCount, receipts: 1,
    cold_resume: true, changed_merge_head_refused: true, genuine_codex_user: "SKIP" }));
} finally {
  for (const dir of [fixture.base, ...fixture.owned]) fs.rmSync(dir, { recursive: true, force: true });
}
