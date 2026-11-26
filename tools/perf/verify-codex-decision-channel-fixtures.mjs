import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serveCodexDecisions, loadManagedCodexDatabaseEnvironment } from "../runtime/standard-codex-decisions.mjs";
import { operatorOffer, assertOperatorClaim } from "../../src/adapters/workflow-console/standard-operator-offer.mjs";
import { codexFormEvidence } from "../../src/adapters/workflow-console/codex-form-evidence.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { bindOperatorChat, codexMessageEvidence } from "../../src/adapters/workflow-console/codex-message-recovery.mjs";

const q = { contract_version: "standard-mode-question.v1", operation_id: "op_" + "a".repeat(40), session_id: "S001",
  instance_id: "fixture", scope_id: "b".repeat(64), occurrence_id: "root/1", intent_sha256: "c".repeat(64),
  choices: ["THINKING", "EXPLORING", "COMMITTING", "refused", "deferred", "cancelled"] };
let current = q, principals = [], captured = [];
const transport = (recoverMessage, formIssuer) => {
  const input = new PassThrough(), output = new PassThrough(), lines = createInterface({ input: output });
  const send = msg => input.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
  const next = async () => JSON.parse((await once(lines, "line"))[0]);
  const session = {
    ...(recoverMessage && { recoverMessage }),
    session: () => ({ instance: "fixture", principals, last_receipt: null }),
    question: async () => captured.length ? { status: "workflow" } : { status: "question", offer: operatorOffer(current, "fixture-mode") },
    submit(value) {
      const { signature, ...body } = value;
      assertOperatorClaim(body.payload, current, "fixture-mode");
      assert(verify(null, Buffer.from(shadowHash(body)), principals[0].public_key, Buffer.from(signature, "base64")));
      captured.push(value); return { status: "received", choice: body.payload.choice };
    },
  };
  const done = serveCodexDecisions({ session, formIssuer, input, output });
  async function call(method, params, id) {
    const read = next(); send({ method, params, id }); return read;
  }
  const tool = (name, args = {}, id = 10, _meta) => call("tools/call", { name, arguments: args, _meta }, id);
  return { next, send, tool, async start() {
    await call("initialize", { protocolVersion: "2025-11-25", capabilities: { elicitation: { form: {} } } }, 1);
    send({ method: "notifications/initialized" });
    const response = await tool("session");
    return JSON.parse(response.result.content[0].text);
  }, async close() { input.end(); await done; lines.close(); } };
};

const chat = bindOperatorChat("10000000-0000-4000-9000-000000000001", "fixture_operator");
const a = transport(), b = transport(selector => ({ status: "awaiting_attestation", evidence: codexMessageEvidence(chat, selector) }));
try {
  const session = await a.start();
  assert.equal(session.form_supported, true); assert.equal(session.enrolled, false);
  assert.equal((await a.tool("ask")).result.content[0].text, "CODEX_DECISION_CHANNEL_NOT_ENROLLED");
  // Only the test authority can enroll this disposable connection.
  principals = [{ authority_id: "fixture_operator", public_key: session.public_key }];
  assert.equal((await b.start()).enrolled, false, "starting another local server must not inherit the genuine channel key");
  const selector = { operation_id: q.operation_id, question_sha256: shadowHash(q), turn_id: "20000000-0000-4000-9000-000000000002",
    message_id: "30000000-0000-4000-9000-000000000003", content_sha256: "e".repeat(64) };
  assert.equal((await a.tool("recover_message", selector)).error.message, "MCP_ARGUMENTS_REFUSED");
  assert.equal((await b.tool("recover_message", { ...selector, choice: "COMMITTING" })).result.content[0].text, "CODEX_MESSAGE_SELECTOR_INVALID");
  assert.equal(JSON.parse((await b.tool("recover_message", selector)).result.content[0].text).status, "awaiting_attestation");
  assert.equal((await b.tool("ask")).result.content[0].text, "CODEX_DECISION_CHANNEL_NOT_ENROLLED");
  assert.equal((await a.tool("ask", { choice: "COMMITTING" })).error.message, "MCP_ARGUMENTS_REFUSED");
  assert.equal((await a.tool("ask", { transcript: "je choisi committing" })).error.message, "MCP_ARGUMENTS_REFUSED");
  const form = await a.tool("ask");
  assert.equal(form.method, "elicitation/create");
  assert.deepEqual(form.params.requestedSchema.required, ["choice"]);
  assert.deepEqual(form.params.requestedSchema.properties.choice.enum, q.choices);
  let ack = a.next(); a.send({ id: form.id, result: { action: "decline", content: null } });
  assert.deepEqual(JSON.parse((await ack).result.content[0].text), { status: "unanswered" });
  const stale = await a.tool("ask"); current = { ...q, intent_sha256: "d".repeat(64) };
  ack = a.next(); a.send({ id: stale.id, result: { action: "accept", content: { choice: "COMMITTING" } } });
  assert.equal((await ack).result.content[0].text, "OPERATOR_QUESTION_CHANGED");
  assert.equal(captured.length, 0);
  const fresh = await a.tool("ask");
  ack = a.next(); a.send({ id: fresh.id, result: { action: "accept", content: { choice: "COMMITTING" } } });
  assert.equal(JSON.parse((await ack).result.content[0].text).status, "received");
  a.send({ id: fresh.id, result: { action: "accept", content: { choice: "THINKING" } } });
  assert.equal(JSON.parse((await a.tool("ask")).result.content[0].text).status, "workflow");
  assert.equal(captured.length, 1); assert.equal(captured[0].payload.choice, "COMMITTING");
  console.log(JSON.stringify({ status: "PASS", transport: "MCP stdio", client: "fixture", genuine_codex_user: "SKIP",
    unenrolled_client_refused: true, supplied_choice_refused: true, cancelled_unanswered: true, stale_answer_refused: true, one_signed_source: true }));
} finally { await a.close(); await b.close(); }

const issuer = generateKeyPairSync("ed25519");
const profile = { thread_id: chat.thread_id, client: "codex-desktop-windows" };
const formIssuer = { ...profile, authority_id: chat.authority_id, privateKey: issuer.privateKey };
try {
  current = q;
  captured = [];
  principals = [{ authority_id: chat.authority_id, public_key: issuer.publicKey.export({ format: "pem", type: "spki" }),
    codex_form: profile, decisions: [{ question_contract: q.contract_version, choices: ["COMMITTING"] }] }];
  const installed = transport(null, formIssuer);
  try {
    const enrolled = await installed.start();
    assert.equal(enrolled.enrolled, true);
    assert.equal(enrolled.form_chat_matches, false);
    const refused = await installed.tool("ask");
    assert.equal(refused.result.content[0].text, "CODEX_DECISION_CHAT_CHANGED");
    const form = await installed.tool("ask", {}, 10, { threadId: chat.thread_id });
    assert.equal(form.method, "elicitation/create");
    assert.deepEqual(form.params.requestedSchema.properties.choice.enum, ["COMMITTING"]);
    const result = installed.next();
    installed.send({ id: form.id, result: { action: "accept", content: { choice: "COMMITTING" }, request_id: chat.thread_id } });
    assert.equal(JSON.parse((await result).result.content[0].text).choice, "COMMITTING");
    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0].payload.evidence_refs, [codexFormEvidence(chat.thread_id, form.id, q, captured[0].payload)]);
    console.log(JSON.stringify({ status: "PASS", transport: "MCP stdio", conversation_bound: true, request_id_bound: true, live_desktop: "SKIP" }));
  } finally { await installed.close(); }
} finally { captured = []; }

const host = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "aidn-codex-form-env-"));
const envName = "AIDN_FORM_DATABASE_FIXTURE_URL";
const previous = process.env[envName];
try {
  const envFile = path.join(host, "codex-form-database.env");
  fs.writeFileSync(envFile, envName + "=postgresql://localhost/fixture\nUNRELATED=refused\n");
  assert.throws(() => loadManagedCodexDatabaseEnvironment(host, envName), /CODEX_FORM_DATABASE_ENV_INVALID/);
  assert.equal(process.env[envName], previous);
  fs.writeFileSync(envFile, envName + "=postgresql://localhost/fixture\n");
  loadManagedCodexDatabaseEnvironment(host, envName);
  assert.equal(process.env[envName], "postgresql://localhost/fixture");
  console.log(JSON.stringify({status:"PASS", managed_connector_process_environment:true, unexpected_variable_refused:true}));
} finally {
  if (previous === undefined) delete process.env[envName]; else process.env[envName] = previous;
  fs.unlinkSync(path.join(host,"codex-form-database.env"));
  fs.rmdirSync(host);
}
