import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { createStandardHostAuthority } from "../../src/adapters/runtime/standard-host-authority.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { runStandardWorkflowAction } from "../../src/application/runtime/standard-workflow-entry.mjs";

// Separate each rejection boundary from slow CLI dispatch and other invalid
// fields. These are fixture Ed25519 principals, never genuine-human evidence.
const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "aidn-host-source-"));
const dirs = Object.fromEntries(["project", "control", "review", "home", "authority"].map(name => {
  const dir = path.join(base, name); fs.mkdirSync(dir); return [name, dir];
}));
fs.mkdirSync(path.join(dirs.authority, "inbox"));
const configuration = { target_root: dirs.project, control_root: dirs.control, review_root: dirs.review, instance_id: "source-boundaries",
  native: { home: dirs.home, tool_roots: [], protected_roots: [dirs.authority] } };
const environment = { AIDN_STANDARD_HOST_HOME: dirs.authority };
const host = createStandardHostAuthority({ configuration, environment });
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const registry = { contract_version: "standard-host-principals.v1", principals: [{ authority_id: "fixture_human", kinds: ["human"],
  public_key: publicKey.export({ type: "spki", format: "pem" }) }] };
const registryFile = path.join(dirs.authority, "principals.json");
fs.writeFileSync(registryFile, JSON.stringify(registry));
const question = { fixture: "exact-current-question" }, source = { authority_id: "fixture_human", choice: "deferred", question_sha256: shadowHash(question) };
const sourceRef = "boundary", file = path.join(dirs.authority, "inbox", sourceRef + ".json");
const input = { sourceRef, question, source };
function put(fields = {}, envelopeFields = {}) {
  const now = Date.now(), body = { contract_version: "standard-host-source.v1", kind: "human", authority_id: "fixture_human", source_ref: sourceRef,
    subject_sha256: shadowHash(question), payload: source, issued_at_ms: now - 1000, expires_at_ms: now + 60000, ...fields };
  fs.writeFileSync(file, JSON.stringify({ ...body, signature: sign(null, Buffer.from(shadowHash(body)), privateKey).toString("base64"), ...envelopeFields }));
}
let checks = 0;
function check(name, fn) { fn(); checks++; console.log("PASS " + name); }
const refuses = (code, fn = () => host.humanSource.read(input)) => assert.throws(fn, { code });
check("source preview creates no MAC key", () => assert.equal(host.keyId(), null));
check("private home must be protected", () => assert.throws(() => createStandardHostAuthority({ environment,
  configuration: { ...configuration, native: { ...configuration.native, protected_roots: [] } } }), { code: "STANDARD_HOST_HOME_PROTECTION_REQUIRED" }));
check("missing source waits without a claim", () => assert.equal(host.humanSource.read({ ...input, sourceRef: "missing" }), null));
check("fresh exact signature is authenticated", () => { put(); assert.deepEqual(host.humanSource.read(input), source); assert.equal(host.humanSource.verify(input).outcome, "verified"); });
check("well-shaped 64-byte forgery refuses authentication", () => { put({}, { signature: Buffer.alloc(64).toString("base64") }); refuses("STANDARD_HOST_SOURCE_NOT_AUTHENTICATED"); });
check("signature encoding is invalid independently of expiry", () => { put({}, { signature: "invalid" }); refuses("STANDARD_HOST_SOURCE_INVALID"); });
check("closed envelope rejects extra fields", () => { put({ unexpected: true }); refuses("STANDARD_HOST_SOURCE_INVALID"); });
check("expired signed unaccepted source refuses read", () => { put({ expires_at_ms: Date.now() - 1 }); refuses("STANDARD_HOST_SOURCE_INVALID"); });
check("expired signed unaccepted source refuses verification", () => refuses("STANDARD_HOST_SOURCE_INVALID", () => host.humanSource.verify(input)));
check("historical verification retains original expired dates", () => assert.equal(host.humanSource.verify({ ...input, historical: true }).outcome, "verified"));
check("fresh signed wrong subject refuses", () => { put({ subject_sha256: "f".repeat(64) }); refuses("STANDARD_HOST_SOURCE_INVALID"); });
check("fresh signed wrong source reference refuses", () => { put({ source_ref: "other" }); refuses("STANDARD_HOST_SOURCE_INVALID"); });
check("fresh signed wrong kind refuses", () => { put({ kind: "control" }); refuses("STANDARD_HOST_SOURCE_INVALID"); });
check("future issuance refuses", () => { put({ issued_at_ms: Date.now() + 30000 }); refuses("STANDARD_HOST_SOURCE_INVALID"); });
check("excessive duration refuses", () => { put({ expires_at_ms: Date.now() + 10800000 }); refuses("STANDARD_HOST_SOURCE_INVALID"); });
check("fresh unknown principal refuses authentication", () => { put({ authority_id: "unknown" }); refuses("STANDARD_HOST_SOURCE_NOT_AUTHENTICATED"); });
check("signed payload author must match signer", () => { put({ payload: { ...source, authority_id: "other" } }); refuses("STANDARD_HOST_SOURCE_AUTHOR_CHANGED"); });
check("trust role changes are observed on the next read", () => { put(); registry.principals[0].kinds = ["control"];
  fs.writeFileSync(registryFile, JSON.stringify(registry)); refuses("STANDARD_HOST_SOURCE_NOT_AUTHENTICATED"); });
check("exact operation authority cannot be substituted", () => refuses("STANDARD_HOST_EXACT_OPERATION_REQUIRED", () => host.authorizeOperation({ preview_sha256: "a" }, "b")));
check("source checks allocate no host key or Native evidence", () => { assert.equal(host.keyId(), null); assert.deepEqual(fs.readdirSync(dirs.control), []); });
host.ensureKey();
{
  const id = "op_" + "d".repeat(40), scope = "fixture_disposition", before = "a".repeat(64), after = "b".repeat(64);
  const unknown = { outcome: "reconciliation_required", effect_status: "unknown", receipt_id: "fixture_unknown" };
  const confirmed = { outcome: "completed", effect_status: "confirmed", receipt_id: "fixture_confirmed", output_sha256: "c".repeat(64) };
  const plan = { operation_id: id, assessment: "confirmed_reopen", instance_sha256: before, scope_id: scope, output_sha256: confirmed.output_sha256 };
  const state = { record: { scope_id: scope, instance_sha256: before, initial_parameters: {} }, cursor: { status: "WAITING",
    occurrences: [{ status: "WAITING", operation: { intent: { operation_id: id, binding_ref: "session_pr_correction_reopen" }, receipt: unknown } }] } };
  const journal = { results: [{ output: { observations: { reason_code: "STANDARD_PLAN_EXPIRED" } }, receipt: unknown }] };
  let grants = 0;
  const compose = (_operation, disposition) => {
    async function checkGrant(request) {
      const grant = await disposition.authorize({ request });
      assert.equal(grant.contract_version, "process-disposition-authorization-grant.v2");
      assert.equal(Object.hasOwn(grant, "expires_at_ms"), false);
      assert.equal((await disposition.verify({ request, grant })).outcome, "verified");
      const original = JSON.stringify(grant), realNow = Date.now;
      const { grant_sha256, ...body } = grant;
      const legacyBody = { ...body, contract_version: "process-disposition-authorization-grant.v1", expires_at_ms: grant.observed_at_ms + 60000 };
      const legacy = { ...legacyBody, grant_sha256: createHmac("sha256", host.readKey()).update(shadowHash(legacyBody)).digest("hex") };
      try {
        Date.now = () => grant.observed_at_ms + 86400000;
        assert.equal((await disposition.verify({ request, grant })).outcome, "verified");
        await assert.rejects(async () => disposition.verify({ request, grant: legacy }), { code: "STANDARD_HOST_DISPOSITION_GRANT_CHANGED" });
        Date.now = () => grant.observed_at_ms - 1000;
        assert.equal((await disposition.verify({ request, grant })).outcome, "verified");
        await assert.rejects(async () => disposition.verify({ request, grant: legacy }), { code: "STANDARD_HOST_DISPOSITION_GRANT_CHANGED" });
        Date.now = () => grant.observed_at_ms + 1;
        assert.equal((await disposition.verify({ request, grant: legacy })).outcome, "verified");
      } finally { Date.now = realNow; }
      assert.equal(JSON.stringify(grant), original);
      await assert.rejects(async () => disposition.verify({ request, grant: { ...grant, expires_at_ms: realNow() + 60000 } }),
        { code: "STANDARD_HOST_DISPOSITION_GRANT_CHANGED" });
      await assert.rejects(async () => disposition.verify({ request, grant: { ...grant, contract_version: "process-disposition-authorization-grant.v3" } }),
        { code: "STANDARD_HOST_DISPOSITION_GRANT_CHANGED" });
      await assert.rejects(async () => disposition.verify({ request, grant: { ...grant, principal_sha256: "e".repeat(64) } }),
        { code: "STANDARD_HOST_DISPOSITION_GRANT_CHANGED" });
      await assert.rejects(async () => disposition.authorize({ request: { ...request, action: "operation" } }),
        { code: "STANDARD_HOST_EXACT_DISPOSITION_REQUIRED" });
      grants++;
    }
    return { inspect: () => structuredClone(state), previewNative: () => ({ native_started: false }),
      step: async () => ({ kind: "reconciliation", status: "WAITING" }),
      readOperation: selected => { assert.equal(selected, id); return structuredClone(journal); },
      prepareOperationDisposition: async (selected, options) => {
        assert.equal(selected, id); assert.equal(options.expectedSha256, before); return structuredClone(plan);
      },
      async applyOperationDisposition(value, options) {
        assert.equal(options.write, true);
        assert.equal(options.expectedPlanSha256, shadowHash(value));
        await checkGrant({ action: "operation_disposition", plan: value, plan_sha256: shadowHash(value) });
        journal.results.push({ receipt: confirmed });
        return { status: "receipted", receipt: confirmed, written: true };
      },
      async acceptOperation(selected, options) {
        assert.equal(selected, id); assert.equal(options.receiptId, confirmed.receipt_id); assert.equal(options.write, true);
        await checkGrant({ action: "operation_disposition_accept", instance_sha256: before, scope_id: scope, receipt_sha256: shadowHash(confirmed) });
        state.record.instance_sha256 = after; state.cursor.status = "RUNNING";
        return structuredClone(state);
      },
    };
  };
  const input = { request: {}, configuration, parameters: {}, modelSource: {} };
  const run = options => runStandardWorkflowAction({ ...input, ...options }, { authority: host, compose });
  const apply = action => run({ preparedAction: action, execute: true, expectPlan: shadowHash(action) });
  const proposed = await run();
  assert.equal(proposed.preview.kind, "operation_disposition"); assert.equal(proposed.written, false); assert.equal(grants, 0);
  await assert.rejects(run({ preparedAction: proposed.preview, execute: true, expectPlan: "f".repeat(64) }), { code: "STANDARD_ENTRY_EXACT_ACTION_REQUIRED" });
  const applied = await apply(proposed.preview);
  assert.equal(applied.result.action_kind, "operation_disposition"); assert.equal(applied.result.process_status, "WAITING");
  assert.equal(state.record.instance_sha256, before); assert.equal(grants, 1);
  const accept = await run();
  assert.equal(accept.preview.kind, "operation_disposition_accept"); assert.equal(accept.written, false); assert.equal(grants, 1);
  const changed = structuredClone(accept.preview); changed.payload.receipt_sha256 = "e".repeat(64);
  await assert.rejects(apply(changed), { code: "STANDARD_ENTRY_ACTION_CHANGED" });
  const accepted = await apply(accept.preview);
  assert.equal(accepted.result.action_kind, "operation_disposition_accept"); assert.equal(accepted.result.process_status, "RUNNING");
  assert.equal(state.record.instance_sha256, after); assert.equal(grants, 2);
  check("corrective reopening requires separate exact entry grants to write and accept a receipt", () => assert.equal(journal.results.length, 2));
}
console.log(JSON.stringify({ status: "PASS", checks, scope: "production-source-adapter-fixture-principals", reducer_accepted_history: "NOT_RUN", genuine_human: "NOT_RUN", native: "NOT_RUN", base }));
