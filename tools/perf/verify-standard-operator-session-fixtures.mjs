import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { createStandardConsoleFixture } from "./verify-standard-console-entry-fixtures.mjs";
import { createStandardOperatorSession } from "../../src/adapters/workflow-console/standard-operator-session.mjs";
import { createCodexDecisionChannel } from "../../src/adapters/workflow-console/codex-decision-channel.mjs";
import { bindOperatorChat, readCodexMessageReference } from "../../src/adapters/workflow-console/codex-message-recovery.mjs";
import { codexFormEvidence } from "../../src/adapters/workflow-console/codex-form-evidence.mjs";
import { loadWindowsCodexFormIssuer } from "../../src/adapters/workflow-console/windows-codex-form-issuer.mjs";
import { operatorOffer, assertOperatorClaim } from "../../src/adapters/workflow-console/standard-operator-offer.mjs";
import { codexChoiceLabel } from "../../src/adapters/workflow-console/codex-decision-presentation.mjs";
import { runStandardWorkflowEntry } from "../../src/application/runtime/standard-workflow-entry.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { resolveRuntimeProjectContext } from "../../src/application/runtime/runtime-project-context-service.mjs";
import { installStandardAuthorization, prepareStandardAuthorizationInstallation } from "../../src/adapters/runtime/standard-project-authorization-store.mjs";

const fixture = createStandardConsoleFixture();
const { target, config, configuration: request, dirs } = fixture;
const environment = { ...process.env, AIDN_STANDARD_HOST_HOME: dirs.authority };
const run = options => runStandardWorkflowEntry({ request, environment, ...options });
const session = dependencies => createStandardOperatorSession({ targetRoot: target, configuration: config, environment }, dependencies);
async function walkToQuestion(runEntry) {
  for (let step = 0; step < 20; step++) {
    const planned = await runEntry({});
    if (planned.preview.payload.question) return planned.preview.payload.question;
    assert(["prepare_host", "initialize", "operation", "dispatch", "call"].includes(planned.preview.kind));
    assert((await runEntry({ preparedAction: planned.preview, execute: true, expectPlan: planned.action_sha256 })).written);
  }
  assert.fail("fixture did not reach a human question");
}
try {
  const issuer = generateKeyPairSync("ed25519");
  const secondOperator = generateKeyPairSync("ed25519");
  const administrator = generateKeyPairSync("ed25519");
  const pem = key => key.export({ format: "pem", type: "spki" });
  const threadId = "10000000-0000-4000-8000-000000000001", requestId = "20000000-0000-4000-8000-000000000002";
  const profile = { thread_id: threadId, client: "codex-desktop-windows" };
  const formIssuer = { ...profile, authority_id: "fixture_codex", privateKey: issuer.privateKey };
  const other = { authority_id: "fixture_other", public_key: pem(secondOperator.publicKey), codex_form: profile };
  const principals = [{ authority_id: formIssuer.authority_id, public_key: pem(issuer.publicKey), codex_form: profile }, other]
    .map(row => ({ ...row, decisions: [{ question_contract: "standard-mode-question.v1", choices: ["COMMITTING", "THINKING"] }] }));
  const scope = resolveRuntimeProjectContext({ targetRoot: target, env: environment });
  const bodyForPolicy = { contract_version: "standard-project-authorization.v1", project_id: scope.project_id,
    runtime_scope_id: scope.runtime_scope_id, revision: 1, previous_sha256: null, principals };
  const signed = (body, key) => ({ ...body, signature: sign(null, Buffer.from(shadowHash(body)), key).toString("base64") });
  const file = path.join(fixture.base, "form-authorization.json");
  fs.writeFileSync(path.join(dirs.authority, "project-authorization-admin.pem"), pem(administrator.publicKey));
  fs.writeFileSync(file, JSON.stringify(signed(bodyForPolicy, administrator.privateKey)));
  const setup = { targetRoot: target, file, environment };
  installStandardAuthorization({ ...setup, plan: prepareStandardAuthorizationInstallation(setup) });
  assert.throws(() => loadWindowsCodexFormIssuer({ authorityId: formIssuer.authority_id, principals, home: dirs.authority }),
    /CODEX_DESKTOP_FORM_CLIENT_UNAVAILABLE/);
  const stopped = session({ enter: options => {
    if (options.execute) throw Error("FIXTURE_PROCESS_STOPPED");
    return runStandardWorkflowEntry(options);
  } });
  let answerCount = 0, lastAnswer;
  const channel = createCodexDecisionChannel({ session: { ...stopped, submit(e) { lastAnswer = e; return stopped.submit(e); } },
    formIssuer, formSupported: () => true, elicit: async form => {
      answerCount++;
      assert.deepEqual(form.requestedSchema.required, ["choice"]);
      return { action: "accept", content: { choice: codexChoiceLabel("COMMITTING") }, request_id: requestId };
    } });
  const pub = channel.describe().public_key;
  assert.equal(pub, principals[0].public_key);
  const q = await walkToQuestion(run);
  assert.equal(q.contract_version, "standard-mode-question.v1");
  const offer = (await session().question()).offer;
  assert.equal(offer.question_sha256, shadowHash(q));
  await assert.rejects(stopped.submit({ choice: "COMMITTING" }), /STANDARD_HOST_SOURCE_INVALID/);
  await assert.rejects(channel.decide(), /CODEX_DECISION_CHAT_CHANGED/);
  await assert.rejects(channel.decide({ threadId: requestId }), /CODEX_DECISION_CHAT_CHANGED/);
  await assert.rejects(channel.decide({ threadId, "x-codex-turn-metadata": { thread_id: requestId } }), /CODEX_DECISION_CHAT_CHANGED/);
  assert.equal(answerCount, 0);
  await assert.rejects(channel.decide({ "x-codex-turn-metadata": JSON.stringify({ thread_id: threadId }) }), /FIXTURE_PROCESS_STOPPED/);
  assert.equal(answerCount, 1);
  const { signature, ...body } = lastAnswer;
  assert(verify(null, Buffer.from(shadowHash(body)), pub, Buffer.from(signature, "base64")));
  const cold = session();
  assert.equal((await cold.question()).status, "retained");
  const altered = structuredClone(lastAnswer); altered.payload.choice = "THINKING";
  await assert.rejects(cold.submit(altered), /STANDARD_HOST_SOURCE_NOT_AUTHENTICATED/);
  const changedEvidence = { ...body, payload: { ...body.payload, choice: "THINKING" } };
  await assert.rejects(cold.submit(signed(changedEvidence, issuer.privateKey)), /STANDARD_AUTHORIZATION_CODEX_EVIDENCE_REQUIRED/);
  const changedChat = { ...body.payload, evidence_refs: [codexFormEvidence(requestId, threadId, q, body.payload)] };
  await assert.rejects(cold.submit(signed({ ...body, payload: changedChat }, issuer.privateKey)), /STANDARD_AUTHORIZATION_CODEX_EVIDENCE_REQUIRED/);
  const otherClaim = { ...body.payload, authority_id: other.authority_id, choice: "THINKING" };
  otherClaim.evidence_refs = [codexFormEvidence(threadId, requestId, q, otherClaim)];
  const otherAnswer = signed({ ...body, authority_id: other.authority_id, payload: otherClaim }, secondOperator.privateKey);
  await assert.rejects(cold.submit(otherAnswer), /OPERATOR_ANSWER_ALREADY_RECORDED/);
  const received = await cold.resume();
  assert.equal(received.choice, "COMMITTING"); assert.equal(received.outcome, "completed"); assert(received.receipt_id);
  assert.equal((await session().resume()).status, "workflow"); assert.deepEqual(session().session().last_receipt, received);
  await assert.rejects(session().submit(lastAnswer), /OPERATOR_QUESTION_CHANGED/);
  const record = JSON.parse(fs.readFileSync(path.join(target, "docs/audit/workflows/operation-records", q.operation_id + ".json")));
  assert.equal(record.results.length, 1);
  assert.equal(record.results[0].receipt.receipt_id, received.receipt_id);
  assert.deepEqual(record.results[0].output.evidence_refs.filter(row => row.ref.startsWith("codex:form/")), body.payload.evidence_refs);
  const subject = { repository_id: "R_test", pull_request_id: "PR_test", pull_request_number: 12, base_ref: "dev", head_oid: "a".repeat(40) };
  const merge = { ...q, contract_version: "standard-pr-merge-consent-question.v2", issued_at_ms: Date.now(), subject, choices: ["approve_merge", "refused"] };
  const consent = { ...lastAnswer.payload, contract_version: "human-pr-merge-consent.v1", source_event_id: "test-merge",
    choice: "approve_merge", rationale: "Reviewed this commit.", subject_sha256: shadowHash(subject), question_sha256: shadowHash(merge) };
  assert.equal(operatorOffer(merge, "test-merge").subject_sha256, consent.subject_sha256);
  assertOperatorClaim(consent, merge, "test-merge");
  assert.throws(() => assertOperatorClaim(consent, { ...merge, subject: { ...subject, head_oid: "b".repeat(40) } }, "test-merge"), /OPERATOR_DECISION_CHANGED/);
  console.log(JSON.stringify({ status: "PASS", proof: "installed Codex form issuer policy, fixture client and public STANDARD FILES host",
    answers: answerCount, receipts: 1, cold_resume: true, changed_merge_head_refused: true,
    wrong_conversation_refused: true, changed_form_evidence_refused: true, windows_live_client: "SKIP" }));
} finally {
  for (const dir of [fixture.base, ...fixture.owned]) fs.rmSync(dir, { recursive: true, force: true });
}

const historical = createStandardConsoleFixture();
try {
  const env = { ...process.env, AIDN_STANDARD_HOST_HOME: historical.dirs.authority };
  const threadId = "10000000-0000-4000-8000-000000000001", turnId = "20000000-0000-4000-8000-000000000002";
  const messageId = "30000000-0000-4000-8000-000000000003";
  const chat = bindOperatorChat(threadId, "fixture_operator"), keys = generateKeyPairSync("ed25519");
  const foreign = generateKeyPairSync("ed25519");
  const administrator = generateKeyPairSync("ed25519");
  const pem = key => key.export({ format: "pem", type: "spki" });
  const scope = resolveRuntimeProjectContext({ targetRoot: historical.target, env });
  const principals = [[chat.authority_id, keys], ["fixture_other", foreign]].map(([authority_id, key]) => ({
    authority_id, public_key: pem(key.publicKey), decisions: [{ question_contract: "standard-mode-question.v1", choices: ["COMMITTING"] }],
  }));
  fs.writeFileSync(path.join(historical.dirs.authority, "project-authorization-admin.pem"), pem(administrator.publicKey));
  const fileForPolicy = path.join(historical.base, "approved-authorization.json");
  const policy = { contract_version: "standard-project-authorization.v1", project_id: scope.project_id,
    runtime_scope_id: scope.runtime_scope_id, revision: 1, previous_sha256: null, principals };
  function install(policy) {
    const signed = { ...policy, signature: sign(null, Buffer.from(shadowHash(policy)), administrator.privateKey).toString("base64") };
    fs.writeFileSync(fileForPolicy, JSON.stringify(signed));
    const setup = { targetRoot: historical.target, file: fileForPolicy, environment: env };
    const plan = prepareStandardAuthorizationInstallation(setup);
    installStandardAuthorization({ ...setup, plan });
    return plan.contract_sha256;
  }
  const firstRevision = install(policy);
  const open = () => createStandardOperatorSession({ targetRoot: historical.target, configuration: historical.config, environment: env, operatorChat: chat });
  const q = await walkToQuestion(options => runStandardWorkflowEntry({ request: historical.configuration, environment: env, ...options }));
  const row = { turnId, item: { id: messageId, type: "userMessage", content: [{ type: "text", text: "COMMITTING\n" }] } };
  const ref = await readCodexMessageReference(async params => {
    assert.equal(params.threadId, threadId); assert.equal(params.turnId, turnId); assert.equal(params.limit, 1);
    if (params.sortDirection === "asc") { assert.equal(params.cursor.itemId, messageId); return { data: [] }; }
    assert.equal(params.cursor, undefined); return { data: [row] };
  }, { threadId, turnId, messageId });
  const selector = { ...ref, operation_id: q.operation_id, question_sha256: shadowHash(q) };
  const recover = value => open().recoverMessage(value);
  const awaited = await recover(selector);
  assert.equal(awaited.status, "awaiting_attestation");
  await assert.rejects(recover({ ...selector, choice: "COMMITTING" }), /CODEX_MESSAGE_SELECTOR_INVALID/);
  await assert.rejects(recover({ ...selector, question_sha256: "f".repeat(64) }), /OPERATOR_QUESTION_CHANGED/);
  const inbox = path.join(historical.dirs.authority, "inbox"), file = path.join(inbox, awaited.source_ref + ".json");
  assert(!fs.existsSync(file)); assert(!fs.existsSync(path.join(inbox, awaited.source_ref + ".pending")));
  fs.mkdirSync(inbox, { recursive: true });
  function publish(authority_id, key) {
    const payload = { contract_version: "human-mode-decision.v1", source_kind: "human", authority_id,
      source_event_id: awaited.source_ref, subject_sha256: shadowHash(q), question_sha256: shadowHash(q),
      choice: "COMMITTING", evidence_refs: [awaited.evidence] };
    const now = Date.now(), body = { contract_version: "standard-host-source.v1", kind: "human", authority_id, source_ref: awaited.source_ref,
      subject_sha256: shadowHash(q), payload, issued_at_ms: now, expires_at_ms: now + 60000 };
    fs.writeFileSync(file, JSON.stringify({ ...body, signature: sign(null, Buffer.from(shadowHash(body)), key.privateKey).toString("base64") }));
  }
  publish("fixture_other", foreign);
  await assert.rejects(recover(selector), /CODEX_MESSAGE_AUTHOR_CHANGED/);
  publish(chat.authority_id, keys);
  await assert.rejects(recover({ ...selector, content_sha256: "f".repeat(64) }), /CODEX_MESSAGE_EVIDENCE_CHANGED/);
  assert(!fs.existsSync(path.join(inbox, awaited.source_ref + ".pending")));
  const received = await recover(selector);
  assert.equal(received.choice, "COMMITTING"); assert.equal(received.outcome, "completed");
  fs.unlinkSync(file);
  assert.deepEqual(await recover(selector), received);
  install({ ...policy, revision: 2, previous_sha256: firstRevision, principals: [] });
  assert.deepEqual(await recover(selector), received);
  await assert.rejects(recover({ ...selector, message_id: threadId }), /CODEX_MESSAGE_EVIDENCE_CHANGED/);
  const record = JSON.parse(fs.readFileSync(path.join(historical.target, "docs/audit/workflows/operation-records", q.operation_id + ".json")));
  assert.equal(record.results.length, 1);
  assert(record.results[0].output.evidence_refs.some(e => e.ref === awaited.evidence.ref && e.sha256 === selector.content_sha256));
  console.log(JSON.stringify({ status: "PASS", proof: "independently signed fixture message through public STANDARD FILES with installed authorization",
    receipts: 1, prompts: 0, cold_recovery: true, retained_after_revocation: true, genuine_codex_attestation: "SKIP" }));
} finally {
  for (const dir of [historical.base, ...historical.owned]) fs.rmSync(dir, { recursive: true, force: true });
}
