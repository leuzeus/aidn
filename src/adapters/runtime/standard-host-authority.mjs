import { externalMergeQuestionVersion } from "../../core/workflow/standard-pr-external-merge.mjs";
import { postMergeQuestionVersion } from "../../core/workflow/standard-pr-post-merge-decision.mjs";
import fs from "node:fs";
import path from "node:path";
import { createHash, createHmac, createPublicKey, randomBytes, verify } from "node:crypto";
import { agentRunPhysicalPath, readAgentRunFile } from "../../application/runtime/agent-run-configuration-service.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { createStandardGithubProviderHost } from "./standard-github-provider-host.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const inside = (root, file) => { const r = path.relative(root, file); return r === "" || !path.isAbsolute(r) && r !== ".." && !r.startsWith(".." + path.sep); };
const exact = (value, fields) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === [...fields].sort().join(",");
const bytes = file => readAgentRunFile(file, { json: false, maxBytes: 262144 }).value;

function standardHostHome(environment) {
  const configured = environment.AIDN_STANDARD_HOST_HOME;
  if (!path.isAbsolute(configured ?? "")) fail("STANDARD_HOST_HOME_REQUIRED");
  return agentRunPhysicalPath(configured, { directory: true });
}

function standardHostInstance(home, target, instance) {
  const identity = shadowHash({ target: process.platform === "win32" ? target.toLowerCase() : target, instance });
  const keyFile = path.join(home, `${identity}.key`);
  const readKey = () => {
    const key = bytes(keyFile);
    if (key.length !== 32) fail("STANDARD_HOST_KEY_INVALID");
    return key;
  };
  return { identity, keyFile, readKey };
}

// A continuity reader may verify an origin instance without composing it or
// allocating its key. The protected host home is selected by the embedding
// process, and the journal can supply only the instance identifier.
export function readStandardHostInstance({ targetRoot, instanceId, environment = process.env }) {
  const home = standardHostHome(environment);
  const target = agentRunPhysicalPath(targetRoot, { directory: true });
  if (inside(target, home) || inside(home, target)) fail("STANDARD_HOST_HOME_OVERLAP");
  const { identity, readKey } = standardHostInstance(home, target, instanceId);
  return { home, identity, readKey };
}

// Host wiring, never a JSON-selected plugin/module. The private home is supplied
// by the embedding process and must be outside every native writable root.
// MAC keys authenticate journals; only independent Ed25519 principals can supply
// human/control/renewal claims. Possessing a journal key grants no human role.
export function createStandardHostAuthority({ configuration, environment = process.env }, { providerTransport, useProvider = true } = {}) {
  const home = standardHostHome(environment);
  for (const root of [configuration.target_root, configuration.control_root, configuration.review_root, configuration.native.home, ...configuration.native.tool_roots])
    if (inside(root, home) || inside(home, root)) fail("STANDARD_HOST_HOME_OVERLAP");
  if (!(configuration.native.protected_roots ?? []).includes(home)) fail("STANDARD_HOST_HOME_PROTECTION_REQUIRED");
  const { identity, keyFile, readKey } = standardHostInstance(home, configuration.target_root, configuration.instance_id);
  const githubProvider = useProvider ? createStandardGithubProviderHost({ configuration, environment, home, identity }, providerTransport) : null;
  function keyId() { return fs.existsSync(keyFile) ? createHash("sha256").update(readKey()).digest("hex") : null; }
  function ensureKey() {
    if (fs.existsSync(keyFile)) return readKey();
    const key = randomBytes(32);
    let fd;
    try { fd = fs.openSync(keyFile, "wx", 0o600); fs.writeFileSync(fd, key); fs.fsyncSync(fd); }
    catch (cause) { if (cause.code !== "EEXIST") throw cause; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
    return readKey();
  }
  const registryFile = path.join(home, "principals.json");
  function registry() {
    if (!fs.existsSync(registryFile)) return null;
    const value = JSON.parse(bytes(registryFile));
    if (!exact(value, ["contract_version", "principals"]) || value.contract_version !== "standard-host-principals.v1" || !Array.isArray(value.principals)
      || value.principals.length > 32 || new Set(value.principals.map(row => row.authority_id)).size !== value.principals.length) fail("STANDARD_HOST_PRINCIPALS_INVALID");
    for (const row of value.principals) if (!exact(row, ["authority_id", "kinds", "public_key"]) || !/^[a-z][a-z0-9_-]{0,95}$/.test(row.authority_id)
      || !Array.isArray(row.kinds) || !row.kinds.length || row.kinds.some(kind => !["human", "control", "native-renewal"].includes(kind))
      || typeof row.public_key !== "string" || createPublicKey(row.public_key).asymmetricKeyType !== "ed25519") fail("STANDARD_HOST_PRINCIPALS_INVALID");
    return value;
  }
  const trustSha = () => {
    const principals = registry();
    return shadowHash(githubProvider ? { principals, github: githubProvider.contextSha } : principals);
  };
  function capture(kind, sourceRef, subject, fresh) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(sourceRef ?? "")) fail("STANDARD_HOST_SOURCE_REF_INVALID");
    const file = path.join(home, "inbox", `${sourceRef}.json`);
    if (!fs.existsSync(file)) return null;
    const envelope = JSON.parse(bytes(file));
    if (!exact(envelope, ["contract_version", "kind", "authority_id", "source_ref", "subject_sha256", "payload", "issued_at_ms", "expires_at_ms", "signature"])
      || envelope.contract_version !== "standard-host-source.v1" || envelope.kind !== kind || envelope.source_ref !== sourceRef
      || envelope.subject_sha256 !== shadowHash(subject) || !Number.isSafeInteger(envelope.issued_at_ms) || !Number.isSafeInteger(envelope.expires_at_ms)
      || envelope.issued_at_ms > Date.now() || envelope.expires_at_ms <= envelope.issued_at_ms
      || envelope.expires_at_ms - envelope.issued_at_ms > 10800000 || fresh && envelope.expires_at_ms <= Date.now()
      || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature ?? "")) fail("STANDARD_HOST_SOURCE_INVALID");
    if (kind === "human" && ["standard-pr-merge-consent-question.v1", postMergeQuestionVersion, externalMergeQuestionVersion].includes(subject.contract_version)
      && (envelope.issued_at_ms < subject.issued_at_ms || envelope.issued_at_ms >= subject.expires_at_ms
        || envelope.expires_at_ms < subject.expires_at_ms)) fail("STANDARD_HOST_SOURCE_INVALID");
    const principal = registry()?.principals.find(row => row.authority_id === envelope.authority_id && row.kinds.includes(kind));
    const { signature, ...body } = envelope;
    if (!principal || !verify(null, Buffer.from(shadowHash(body)), createPublicKey(principal.public_key), Buffer.from(signature, "base64"))) fail("STANDARD_HOST_SOURCE_NOT_AUTHENTICATED");
    const claim = envelope.payload?.source ?? envelope.payload;
    if (claim?.authority_id !== envelope.authority_id) fail("STANDARD_HOST_SOURCE_AUTHOR_CHANGED");
    return envelope.payload;
  }
  function source(kind) {
    const subject = input => input.question ?? input.request;
    const read = input => capture(kind, input.sourceRef, subject(input), true);
    const check = input => {
      const value = capture(kind, input.sourceRef, subject(input), input.historical !== true), claim = value?.source ?? value;
      if (!value || shadowHash(claim) !== shadowHash(input.source ?? input.grant)
        || input.payload !== undefined && shadowHash(value.payload) !== shadowHash(input.payload)) fail("STANDARD_HOST_SOURCE_CHANGED");
      return { outcome: "verified", authority_id: claim.authority_id, source_sha256: shadowHash(claim),
        ...(kind === "native-renewal" ? { grant_sha256: shadowHash(claim), evidence_class: claim.closure?.evidence_class } : {}) };
    };
    return Object.freeze({ read, verify: check });
  }
  return Object.freeze({ home, keyId, readKey, ensureKey, trustSha, githubProvider,
    humanSource: source("human"), controlSource: source("control"), nativeAuthorizationSource: source("native-renewal"),
    authorizeOperation(preview, permittedSha) {
      if (preview.preview_sha256 !== permittedSha) fail("STANDARD_HOST_EXACT_OPERATION_REQUIRED");
      const principal = shadowHash({ host: keyId(), transport: "explicit-workflow-run" });
      return { authorized: true, authority_id: "standard_local_operator", principal_sha256: principal,
        grant_sha256: createHmac("sha256", readKey()).update(shadowHash({ preview: permittedSha, scope: preview.scope_id, principal })).digest("hex") };
    },
  });
}
