import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { resolveRuntimeProjectContext } from "../../src/application/runtime/runtime-project-context-service.mjs";
import { loadStandardWorkflowAssets } from "../../src/application/runtime/standard-workflow-composition.mjs";
import { createStandardHostAuthority } from "../../src/adapters/runtime/standard-host-authority.mjs";
import { assertWindowsEnrollmentIntent, windowsAuthorityVersion, windowsEnrollmentVersion, windowsOperatorScopeSlot } from "../../src/adapters/runtime/standard-windows-operator-authority.mjs";
import { operatorOffer } from "../../src/adapters/workflow-console/standard-operator-offer.mjs";
import { prepareWindowsPanelAnswer, serveWindowsDecisionPanel } from "../../src/adapters/workflow-console/standard-windows-decision-panel.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

// Enrollment and panel checks must qualify an archive whose public workflow loads.
loadStandardWorkflowAssets();
const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "aidn-windows-operator-fixture-"));
const temporary = fs.realpathSync(os.tmpdir());
let panel;
try {
  const folder = name => { const full = path.join(root, name); fs.mkdirSync(full); return full; };
  const target = folder("project");
  const home = folder("authority");
  const environment = { ...process.env, AIDN_STANDARD_HOST_HOME: home };
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: target, windowsHide: true });
  const scope = resolveRuntimeProjectContext({ targetRoot: target, env: environment });

  const free = createServer();
  await new Promise((resolve, reject) => free.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = free.address().port;
  await new Promise(resolve => free.close(resolve));
  const operator = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const outsider = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const intent = { contract_version: windowsEnrollmentVersion, project_id: scope.project_id, runtime_scope_id: scope.runtime_scope_id,
    thread_id: "10000000-0000-4000-8000-000000000001", origin: "http://localhost:" + port, operator_sid: "S-1-5-21-1-2-3-1001",
    decisions: [{ question_contract: "standard-mode-question.v1", choices: ["COMMITTING", "refused"] }] };
  assert.deepEqual(assertWindowsEnrollmentIntent(intent, scope), intent);
  assert.throws(() => assertWindowsEnrollmentIntent({ ...intent, thread_id: "prompt-derived" }, scope), /AUTHORITY_INVALID/);
  assert.throws(() => assertWindowsEnrollmentIntent({ ...intent, origin: "https://example.net" }, scope), /AUTHORITY_INVALID/);
  if (process.platform === "win32") {
    const cli = fileURLToPath(new URL("../../bin/aidn.mjs", import.meta.url));
    const prepare = fileURLToPath(new URL("../runtime/standard-windows-decisions.mjs", import.meta.url));
    const rules = path.join(root, "choices.json"), plan = path.join(root, "enrollment.json");
    fs.writeFileSync(rules, JSON.stringify(intent.decisions));
    const run = (...args) => execFileSync(process.execPath, args, { cwd: target, windowsHide: true, encoding: "utf8", env: environment });
    const prepared = run(prepare, "--prepare-enrollment", target, intent.thread_id, String(port), rules);
    fs.writeFileSync(plan, prepared);
    const enrollment = [cli, "install", "--target", target, "--standard-windows-operator-enrollment", plan];
    assert.match(run(...enrollment, "--dry-run"), new RegExp(createHash("sha256").update(prepared).digest("hex")));
    const refused = (extra, error) => assert.throws(() => run(...enrollment, ...extra), failure => failure.stderr.includes(error));
    refused([], "STANDARD_WINDOWS_OPERATOR_EXPECT_PLAN_REQUIRED");
    refused(["--expect-windows-operator-plan", "b".repeat(64)], "STANDARD_WINDOWS_OPERATOR_ENROLLMENT_CHANGED");
    refused(["--verify"], "separate installation action");
    assert.deepEqual(fs.readdirSync(target), [".git"]);
    assert.deepEqual(fs.readdirSync(home), []);
  }
  const approved = { ...intent, contract_version: windowsAuthorityVersion, credential_id: randomBytes(32).toString("base64url"),
    public_key: operator.publicKey.export({ format: "der", type: "spki" }).toString("base64url") };
  let registry = approved;
  const configuration = { target_root: target, instance_id: "fixture", control_root: folder("control"), review_root: folder("review"),
    native: { home: folder("native"), tool_roots: [], protected_roots: [home] } };
  const authority = createStandardHostAuthority({ configuration, environment, windowsOperatorAuthoritySha256: shadowHash(approved) }, {
    useProvider: false, readWindowsEnrollment(slot) {
      assert.equal(slot, windowsOperatorScopeSlot(scope));
      return registry;
    },
  });
  assert.equal(authority.humanPrincipals().length, 0);
  assert.deepEqual(authority.windowsOperatorPolicy(), approved);
  const question = { contract_version: "standard-mode-question.v1", operation_id: "op_" + "c".repeat(40),
    session_id: "S001", instance_id: "fixture", choices: ["THINKING", "EXPLORING", "COMMITTING", "refused"] };
  const ref = "ui-" + shadowHash(question) + "-1";
  const offer = { ...operatorOffer(question, ref), repository: null };
  const { body, options } = prepareWindowsPanelAnswer(approved, offer, { choice: "COMMITTING" });

  function assertion(prepared, { origin = approved.origin, rp = "localhost", flags = 5, type = "webauthn.get", id = approved.credential_id,
    key = operator.privateKey, crossOrigin = false } = {}) {
    const digest = value => createHash("sha256").update(value).digest();
    const clientData = Buffer.from(JSON.stringify({ type, origin, challenge: prepared.challenge, crossOrigin }));
    const authData = Buffer.concat([digest(rp), Buffer.of(flags), Buffer.from([0, 0, 0, 1])]);
    return { id, client_data: clientData.toString("base64url"), authenticator_data: authData.toString("base64url"),
      signature: sign("sha256", Buffer.concat([authData, digest(clientData)]), key).toString("base64url") };
  }

  const first = { ...body, assertion: assertion(options, {}) };
  assert.deepEqual(authority.verifyHumanEnvelope(first, ref, question), first);
  const bad = [
    { origin: "http://localhost:12345" }, { rp: "not-localhost" }, { flags: 1 }, { flags: 4 },
    { type: "webauthn.create" }, { id: randomBytes(32).toString("base64url") }, { key: outsider.privateKey }, { crossOrigin: true },
  ];
  for (const mutation of bad) assert.throws(() => authority.verifyHumanEnvelope({ ...body, assertion: assertion(options, mutation) }, ref, question),
    /PROOF_INVALID/);
  const modified = prepareWindowsPanelAnswer(approved, offer, { choice: "refused" }).body;
  assert.throws(() => authority.verifyHumanEnvelope({ ...modified, assertion: first.assertion }, ref, question), /PROOF_INVALID/);
  assert.throws(() => authority.verifyHumanEnvelope(first, ref, { ...question, session_id: "S002" }), /SOURCE_INVALID/);
  assert.throws(() => authority.verifyHumanEnvelope(first, ref + "0", question), /SOURCE_INVALID/);
  assert.throws(() => prepareWindowsPanelAnswer(approved, offer, { choice: "THINKING" }), /DECISION_REFUSED/);
  assert.throws(() => authority.verifyHumanEnvelope({
    ...first, contract_version: "standard-host-source.v1", signature: first.assertion.signature,
  }, ref, question), /SOURCE_INVALID/);
  const expired = prepareWindowsPanelAnswer(approved, offer, { choice: "COMMITTING" }, Date.now() - 3_700_000);
  assert.throws(() => authority.verifyHumanEnvelope({ ...expired.body, assertion: assertion(expired.options) }, ref, question), /SOURCE_INVALID/);
  registry = { ...approved, thread_id: "20000000-0000-4000-8000-000000000001" };
  assert.throws(() => authority.verifyHumanEnvelope(first, ref, question), /AUTHORITY_CHANGED/);
  registry = { ...approved, project_id: "foreign-project" };
  assert.throws(() => authority.verifyHumanEnvelope(first, ref, question), /SCOPE_CHANGED/);
  registry = approved;

  let deliveries = 0, receipt;
  const session = {
    windowsOperatorPolicy: authority.windowsOperatorPolicy,
    async question() { return receipt ? { status: "workflow" } : { status: "question", offer }; },
    session() { return { last_receipt: receipt }; },
    async submit(envelope) {
      authority.verifyHumanEnvelope(envelope, ref, question);
      deliveries++;
      receipt = { status: "received", choice: envelope.payload.choice, receipt_id: "virtual-fixture" };
      return receipt;
    },
  };
  await assert.rejects(serveWindowsDecisionPanel({ session, threadId: "another-chat" }), /CHAT_CHANGED/);
  panel = await serveWindowsDecisionPanel({ session, threadId: approved.thread_id });
  assert.equal((await fetch(approved.origin + "/")).status, 404);
  assert.match(await (await fetch(panel.url)).text(), /Décision AIDN/);
  const shown = await (await fetch(panel.url + "offer")).json();
  assert.deepEqual(shown.requestedSchema.properties.choice.enum, ["COMMITTING", "refused"]);
  const post = (route, data, origin = approved.origin) => fetch(panel.url + route, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(data),
  });
  const choice = { question_sha256: shown.question_sha256, fields: { choice: "COMMITTING" } };
  assert.equal((await post("challenge", choice, "https://example.net")).status, 404);
  assert.equal((await post("challenge", { ...choice, question_sha256: "a".repeat(64) })).status, 409);
  const proof = await (await post("challenge", choice)).json();
  const reply = { nonce: proof.nonce, assertion: assertion(proof.options) };
  assert.equal((await post("confirm", { ...reply, assertion: assertion(proof.options, { key: outsider.privateKey }) })).status, 409);
  assert.equal(deliveries, 0);
  const accepted = await (await post("confirm", reply)).json();
  assert.equal(accepted.status, "received");
  assert.equal((await post("confirm", reply)).status, 409);
  assert.deepEqual(await (await fetch(panel.url + "offer")).json(), accepted);
  assert.equal(deliveries, 1);
  console.log(JSON.stringify({ status: "PASS", authority: "fixture public keys", accepted: deliveries,
    refusals: ["unscoped", "stale", "different subject", "different choice", "wrong origin or RP", "no user verification", "wrong key", "duplicate"],
    windows_hello_live: "SKIP" }));
} finally {
  if (panel) {
    const closed = once(panel.server, "close");
    panel.close();
    await closed;
  }
  assert.equal(path.relative(temporary, fs.realpathSync(root)), path.basename(root));
  removePathWithRetry(root);
}
