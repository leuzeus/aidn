import { spawnSync } from "node:child_process";
import { createHash, createPublicKey, verify } from "node:crypto";
import path from "node:path";
import { resolveRuntimeProjectContext } from "../../application/runtime/runtime-project-context-service.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "../../core/workflow/shadow-json.mjs";
import schema from "../../core/contracts/workflow-definition/standard-windows-operator-authority.v1.schema.json" with { type: "json" };
import sourceSchema from "../../core/contracts/workflow-definition/standard-host-source.webauthn.v1.schema.json" with { type: "json" };

const enrollmentRoot = "HKLM\\SOFTWARE\\AIDN.StandardOperatorAuthority.v1";
export const windowsAuthorityVersion = schema["x-aidn-contract-version"];
export const windowsEnrollmentVersion = "standard-windows-operator-enrollment.v1";
export const windowsPanelSourceVersion = sourceSchema["x-aidn-contract-version"];
export const windowsOperatorId = "windows-operator";
const fail = code => { throw Object.assign(Error(code), { code }); };
const hash = bytes => createHash("sha256").update(bytes).digest();
const rpId = "localhost";
const rpHash = hash(rpId);

function binary(value, min, max) {
  if (typeof value !== "string" || value.length > Math.ceil(max * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value))
    fail("STANDARD_WINDOWS_OPERATOR_ENCODING_INVALID");
  const data = Buffer.from(value, "base64url");
  if (data.length < min || data.length > max || data.toString("base64url") !== value)
    fail("STANDARD_WINDOWS_OPERATOR_ENCODING_INVALID");
  return data;
}

function publicKey(policy) {
  let key;
  try { key = createPublicKey({ key: binary(policy.public_key, 91, 91), format: "der", type: "spki" }); }
  catch { fail("STANDARD_WINDOWS_OPERATOR_KEY_INVALID"); }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1")
    fail("STANDARD_WINDOWS_OPERATOR_KEY_INVALID");
  return key;
}

export function windowsOperatorScopeSlot({ project_id, runtime_scope_id }) {
  return hash(project_id + "\0" + runtime_scope_id).toString("hex");
}

const enrollmentRequired = schema.required.filter(key => !["credential_id", "public_key"].includes(key));
const enrollmentSchema = { ...schema, required: enrollmentRequired,
  properties: { ...Object.fromEntries(enrollmentRequired.map(key => [key, schema.properties[key]])),
    contract_version: { const: windowsEnrollmentVersion } } };

export function assertWindowsEnrollmentIntent(intent, scope) {
  if (checkShadowJson(intent) || validateJsonSchema(intent, enrollmentSchema, "$", { contractKind: "workflow-definition" }).length)
    fail("STANDARD_WINDOWS_OPERATOR_AUTHORITY_INVALID");
  if (intent.project_id !== scope.project_id || intent.runtime_scope_id !== scope.runtime_scope_id)
    fail("STANDARD_WINDOWS_OPERATOR_SCOPE_CHANGED");
  const unique = values => new Set(values).size === values.length;
  if (Number(intent.origin.split(":").at(-1)) > 65535 || !unique(intent.decisions.map(rule => rule.question_contract))
    || intent.decisions.some(rule => !unique(rule.choices))) fail("STANDARD_WINDOWS_OPERATOR_AUTHORITY_INVALID");
  return intent;
}

export function assertWindowsOperatorPolicy(policy, scope) {
  if (checkShadowJson(policy) || validateJsonSchema(policy, schema, "$", { contractKind: "workflow-definition" }).length)
    fail("STANDARD_WINDOWS_OPERATOR_AUTHORITY_INVALID");
  const { public_key, credential_id, ...intent } = policy;
  assertWindowsEnrollmentIntent({ ...intent, contract_version: windowsEnrollmentVersion }, scope);
  binary(policy.credential_id, 12, 1024);
  publicKey(policy);
  return policy;
}

export function windowsOperatorSystemDirectory() {
  if (process.platform !== "win32") fail("STANDARD_WINDOWS_OPERATOR_UNAVAILABLE");
  // ntdll is a Windows Known DLL. An authored configuration or PATH cannot
  // substitute the executable used to consult machine authority.
  const systemDll = process.report.getReport().sharedObjects.find(file => /^[A-Z]:\\.*\\System32\\ntdll[.]dll$/i.test(file));
  if (!systemDll) fail("STANDARD_WINDOWS_OPERATOR_UNAVAILABLE");
  return path.dirname(systemDll);
}

function readMachineEnrollment(slot) {
  const response = spawnSync(path.join(windowsOperatorSystemDirectory(), "reg.exe"), [
    "query", enrollmentRoot + "\\" + slot, "/v", "Authority", "/reg:64",
  ], { encoding: "utf8", timeout: 3000, maxBuffer: 65536, windowsHide: true });
  if (response.error) fail("STANDARD_WINDOWS_OPERATOR_UNAVAILABLE");
  if (response.status !== 0) fail("STANDARD_WINDOWS_OPERATOR_NOT_ENROLLED");
  const match = /^ *Authority +REG_SZ +(\{[^\r\n]+\}) *$/mi.exec(response.stdout);
  if (!match) fail("STANDARD_WINDOWS_OPERATOR_AUTHORITY_INVALID");
  try { return JSON.parse(match[1]); } catch { fail("STANDARD_WINDOWS_OPERATOR_AUTHORITY_INVALID"); }
}

export function readStandardWindowsOperator({ targetRoot, environment, expectedSha256 = null },
  { readEnrollment = readMachineEnrollment } = {}) {
  const scope = resolveRuntimeProjectContext({ targetRoot, env: environment });
  const policy = assertWindowsOperatorPolicy(readEnrollment(windowsOperatorScopeSlot(scope)), scope);
  if (expectedSha256 !== null && shadowHash(policy) !== expectedSha256) fail("STANDARD_WINDOWS_OPERATOR_AUTHORITY_CHANGED");
  return policy;
}

export function windowsOperatorChoices(policy, question) {
  const rule = policy.decisions.find(row => row.question_contract === question.contract_version);
  return question.choices.filter(choice => rule?.choices.includes(choice));
}

export function windowsPanelEvidence(policy, body) {
  const { evidence_refs, ...claim } = body.payload;
  return { ref: "codex:panel/" + policy.thread_id + "/decision/" + body.nonce,
    sha256: shadowHash({ authority_sha256: shadowHash(policy), ...body, payload: claim }) };
}

export function windowsPanelChallenge(policy, body) {
  return Buffer.from(shadowHash({
    contract_version: "standard-windows-panel-challenge.v1", authority_sha256: shadowHash(policy), envelope: body,
  }), "hex").toString("base64url");
}

export function verifyWindowsPanelAnswer(policy, envelope, question) {
  if (checkShadowJson(envelope) || validateJsonSchema(envelope, sourceSchema, "$", { contractKind: "workflow-definition" }).length)
    fail("STANDARD_WINDOWS_OPERATOR_PROOF_INVALID");
  const { assertion, ...body } = envelope;
  const evidence = body.payload?.evidence_refs;
  if (body.authority_id !== windowsOperatorId || body.payload?.authority_id !== windowsOperatorId
    || body.payload?.source_kind !== "human" || body.payload?.source_event_id !== body.source_ref
    || body.payload?.question_sha256 !== body.subject_sha256
    || body.issued_at_ms < (question.issued_at_ms ?? 0)
    || (question.expires_at_ms === undefined ? body.expires_at_ms > body.issued_at_ms + 3_600_000
      : body.expires_at_ms !== question.expires_at_ms)
    || !windowsOperatorChoices(policy, question).includes(body.payload.choice)
    || !Array.isArray(evidence) || evidence.length !== 1
    || shadowHash(evidence[0]) !== shadowHash(windowsPanelEvidence(policy, body)))
    fail("STANDARD_WINDOWS_OPERATOR_DECISION_REFUSED");
  binary(body.nonce, 32, 32);
  if (assertion.id !== policy.credential_id) fail("STANDARD_WINDOWS_OPERATOR_PROOF_INVALID");
  const data = binary(assertion.client_data, 24, 4096);
  const auth = binary(assertion.authenticator_data, 37, 37);
  const signature = binary(assertion.signature, 8, 72);
  let client;
  try { client = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)); }
  catch { fail("STANDARD_WINDOWS_OPERATOR_PROOF_INVALID"); }
  const flags = auth[32];
  if (client?.type !== "webauthn.get" || client.origin !== policy.origin || client.challenge !== windowsPanelChallenge(policy, body)
    || client.crossOrigin !== undefined && client.crossOrigin !== false || client.topOrigin !== undefined
    || !auth.subarray(0, 32).equals(rpHash) || (flags & 0x05) !== 0x05 || (flags & 0xc0) !== 0 || (flags & 0x18) === 0x10
    || !verify("sha256", Buffer.concat([auth, hash(data)]), publicKey(policy), signature))
    fail("STANDARD_WINDOWS_OPERATOR_PROOF_INVALID");
  return envelope;
}
