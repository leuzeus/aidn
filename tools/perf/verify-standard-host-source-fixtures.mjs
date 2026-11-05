import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import { createStandardHostAuthority } from "../../src/adapters/runtime/standard-host-authority.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

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
console.log(JSON.stringify({ status: "PASS", checks, scope: "production-source-adapter-fixture-principals", reducer_accepted_history: "NOT_RUN", genuine_human: "NOT_RUN", native: "NOT_RUN", base }));
