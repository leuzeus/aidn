import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createStandardConsoleFixture } from "./verify-standard-console-entry-fixtures.mjs";
import { createStandardOperatorSession } from "../../src/adapters/workflow-console/standard-operator-session.mjs";
import { operatorOffer, assertOperatorClaim } from "../../src/adapters/workflow-console/standard-operator-offer.mjs";
import { unlockOperatorKey, signedAnswer, digest } from "../../src/adapters/workflow-console/operator-key.mjs";
import { runStandardWorkflowEntry } from "../../src/application/runtime/standard-workflow-entry.mjs";
import { startWorkflowDashboard } from "../../src/adapters/workflow-console/dashboard-server.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

export function operatorFixture(fixture = createStandardConsoleFixture()) {
  const { target, base, config, configuration: request, dirs } = fixture;
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const password = "fixture-only";
  const pem = privateKey.export({ format: "pem", type: "pkcs8", cipher: "aes-256-cbc", passphrase: password });
  const principal = { authority_id: "fixture_operator", kinds: ["human"], public_key: publicKey.export({ format: "pem", type: "spki" }) };
  fs.mkdirSync(path.join(dirs.authority, "inbox"), { recursive: true });
  fs.writeFileSync(path.join(dirs.authority, "principals.json"), JSON.stringify({ contract_version: "standard-host-principals.v1", principals: [principal] }));
  const environment = { ...process.env, AIDN_STANDARD_HOST_HOME: dirs.authority };
  const run = options => runStandardWorkflowEntry({ request, environment, ...options });
  const session = dependencies => createStandardOperatorSession({ targetRoot: target, configuration: config, environment }, dependencies);
  async function walkToQuestion() {
    for (let step = 0; step < 20; step++) {
      const planned = await run({});
      if (planned.preview.payload.question) return planned.preview.payload.question;
      assert(["prepare_host", "initialize", "operation", "dispatch", "call"].includes(planned.preview.kind), planned.preview.kind);
      const applied = await run({ preparedAction: planned.preview, execute: true, expectPlan: planned.action_sha256 });
      assert(applied.written);
    }
    assert.fail("fixture did not reach an offered human question");
  }
  return { ...fixture, target, base, config, environment, run, session, walkToQuestion, pem, password, principal };
}
export async function verifyStandardOperator() {
  const f = operatorFixture();
  let server;
  try {
    const q = await f.walkToQuestion();
    assert.equal(q.contract_version, "standard-mode-question.v1");
    const service = f.session();
    const operator = await unlockOperatorKey(f.pem, f.password, service.session().principals);
    assert.equal(operator.key.extractable, false);
    await assert.rejects(unlockOperatorKey(f.pem, "wrong-password", [f.principal]));
    await assert.rejects(unlockOperatorKey(f.pem, f.password, []), /inscrit/);
    const offer = (await service.question()).offer;
    assert.equal(offer.question_sha256, shadowHash(q));
    const answer = await signedAnswer(operator, offer, "COMMITTING", {}, 60);
    const stopAfterCapture = f.session({ enter: options => {
      if (options.execute) throw Error("FIXTURE_PROCESS_STOPPED");
      return runStandardWorkflowEntry(options);
    } });
    server = await startWorkflowDashboard({ targetRoot: f.target, configuration: f.config, createDecisions: () => stopAfterCapture });
    const post = async (route, body, headers = {}) => {
      const response = await fetch(server.url + "/api/" + route, { method: "POST", headers: {
        Origin: server.url, Authorization: "Bearer " + server.token, "Content-Type": "application/json", ...headers,
      }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await post("session", {}, { Authorization: "" })).status, 403);
    assert.equal((await post("submit", answer, { Origin: "https://other.invalid" })).status, 403);
    assert.equal((await post("action", { execute: true })).status, 404);
    assert.equal((await post("submit", { choice: "COMMITTING" })).status, 400);
    const altered = structuredClone(answer); altered.payload.choice = "THINKING";
    assert.deepEqual((await post("submit", altered)).body.errors, ["STANDARD_HOST_SOURCE_NOT_AUTHENTICATED"]);
    assert.deepEqual(fs.readdirSync(path.join(f.dirs.authority, "inbox")), []);
    assert.deepEqual((await post("submit", answer)).body.errors, ["FIXTURE_PROCESS_STOPPED"]);
    server.close(); server = null;
    const cold = f.session();
    assert.equal((await cold.question()).status, "retained");
    const different = await signedAnswer(operator, offer, "THINKING", {}, 60);
    await assert.rejects(cold.submit(different), /OPERATOR_ANSWER_ALREADY_RECORDED/);
    const received = await cold.resume();
    assert.equal(received.choice, "COMMITTING");
    assert.equal(received.outcome, "completed");
    assert(received.receipt_id);
    assert.equal((await f.session().resume()).status, "workflow");
    assert.deepEqual(f.session().session().last_receipt, received);
    await assert.rejects(f.session().submit(answer), /OPERATOR_QUESTION_CHANGED/);
    const record = JSON.parse(fs.readFileSync(path.join(f.target, "docs/audit/workflows/operation-records", q.operation_id + ".json")));
    assert.equal(record.results.length, 1);
    assert.equal(record.results[0].receipt.receipt_id, received.receipt_id);
    // The same unlocked browser credential can answer another business question.
    const subject = { repository_id: "R_test", pull_request_id: "PR_test", pull_request_number: 12, base_ref: "dev", head_oid: "a".repeat(40) };
    const merge = { ...q, contract_version: "standard-pr-merge-consent-question.v2", issued_at_ms: Date.now(), subject,
      choices: ["approve_merge", "refused", "deferred", "cancelled"] };
    const mergeOffer = operatorOffer(merge, "fixture-merge"), consent = await signedAnswer(operator, mergeOffer, "approve_merge", { rationale: "Reviewed this commit." }, 60);
    assertOperatorClaim(consent.payload, merge, "fixture-merge");
    assert.equal(consent.payload.subject_sha256, await digest(subject));
    const moved = { ...merge, subject: { ...subject, head_oid: "b".repeat(40) } };
    assert.throws(() => assertOperatorClaim(consent.payload, moved, "fixture-merge"), /OPERATOR_DECISION_CHANGED/);
    console.log(JSON.stringify({ status: "PASS", proof: "public STANDARD FILES and synthetic operator", single_receipt: true, cold_resume: true, changed_merge_head_refused: true }));
  } finally {
    server?.close();
    for (const dir of [f.base, ...f.owned]) fs.rmSync(dir, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await verifyStandardOperator();
