import { createPublicKey, verify } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { agentRunPhysicalPath, readAgentRunFile } from "../../application/runtime/agent-run-configuration-service.mjs";
import { resolveRuntimeProjectContext } from "../../application/runtime/runtime-project-context-service.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "../../core/workflow/shadow-json.mjs";
import { writeFileAtomicSync } from "../../lib/fs/atomic-write-lib.mjs";
import schema from "../../core/contracts/workflow-definition/standard-project-authorization.v1.schema.json" with { type: "json" };

const contractFile = "authorization.json";
const fail = code => { throw Object.assign(Error(code), { code }); };
const covers = (root, target) => {
  const relative = path.relative(root, target);
  return relative === "" || !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep);
};
const hasDuplicates = values => new Set(values).size !== values.length;

function publicKey(value) {
  // Accept only an SPKI PEM. Node's createPublicKey also accepts a private key.
  if (!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/.test(value))
    fail("STANDARD_AUTHORIZATION_PUBLIC_KEY_INVALID");
  try {
    const key = createPublicKey(value);
    if (key.asymmetricKeyType === "ed25519") return key;
  } catch { /* Report only the bounded contract error. */ }
  fail("STANDARD_AUTHORIZATION_PUBLIC_KEY_INVALID");
}

function verifyContract(contract, administrator, scope) {
  if (checkShadowJson(contract) || validateJsonSchema(contract, schema, "$", { contractKind: "workflow-definition" }).length)
    fail("STANDARD_AUTHORIZATION_CONTRACT_INVALID");
  if (contract.project_id !== scope.project_id || contract.runtime_scope_id !== scope.runtime_scope_id)
    fail("STANDARD_AUTHORIZATION_SCOPE_CHANGED");
  const { signature, ...body } = contract;
  const proof = Buffer.from(signature, "base64");
  if (proof.toString("base64") !== signature || !verify(null, Buffer.from(shadowHash(body)), administrator, proof))
    fail("STANDARD_AUTHORIZATION_APPROVAL_INVALID");
  if (hasDuplicates(contract.principals.map(principal => principal.authority_id))
    || hasDuplicates(contract.principals.map(principal => publicKey(principal.public_key).export({ format: "der", type: "spki" }).toString("hex")))
    || contract.principals.some(principal => hasDuplicates(principal.decisions.map(rule => rule.question_contract))
      || principal.decisions.some(rule => hasDuplicates(rule.choices)))
    || (contract.revision === 1) !== (contract.previous_sha256 === null))
    fail("STANDARD_AUTHORIZATION_CONTRACT_INVALID");
  return contract;
}

export function readStandardProjectAuthorization({ home, targetRoot, environment = process.env }) {
  const anchor = readAgentRunFile(path.join(home, "project-authorization-admin.pem"), { json: false, optional: true, maxBytes: 512 });
  const directory = path.join(home, "project-authorization");
  let revisions = [];
  try {
    const physical = agentRunPhysicalPath(directory, { directory: true });
    revisions = fs.readdirSync(physical).filter(name => !name.startsWith(".install-"));
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!anchor && revisions.length) fail("STANDARD_AUTHORIZATION_ADMIN_REQUIRED");
  if (!anchor) return null;

  const administrator = publicKey(anchor.value.toString("utf8"));
  const scope = resolveRuntimeProjectContext({ targetRoot, env: environment });
  revisions.sort((left, right) => Number(left) - Number(right));
  if (revisions.some((name, index) => name !== String(index + 1))) fail("STANDARD_AUTHORIZATION_HISTORY_INVALID");
  const latest = revisions.at(-1);
  const current = latest ? verifyContract(readAgentRunFile(path.join(directory, latest, contractFile), { maxBytes: 262144 }).value,
    administrator, scope) : null;
  if (current && current.revision !== Number(latest)) fail("STANDARD_AUTHORIZATION_HISTORY_INVALID");
  return { directory, administrator, administrator_sha256: anchor.sha256, scope, current, current_sha256: current ? shadowHash(current) : null };
}

function installationState(targetRoot, environment) {
  if (!path.isAbsolute(environment.AIDN_STANDARD_HOST_HOME ?? "")) fail("STANDARD_HOST_HOME_REQUIRED");
  const home = agentRunPhysicalPath(environment.AIDN_STANDARD_HOST_HOME, { directory: true });
  const target = agentRunPhysicalPath(targetRoot, { directory: true });
  if (covers(home, target) || covers(target, home)) fail("STANDARD_HOST_HOME_OVERLAP");
  const state = readStandardProjectAuthorization({ home, targetRoot: target, environment });
  if (!state) fail("STANDARD_AUTHORIZATION_ADMIN_REQUIRED");
  return state;
}

function checkSuccessor(state, contract, sha256) {
  if (state.current_sha256 === sha256) return false;
  if (contract.revision !== (state.current?.revision ?? 0) + 1 || contract.previous_sha256 !== state.current_sha256)
    fail("STANDARD_AUTHORIZATION_STALE");
  return true;
}

export function prepareStandardAuthorizationInstallation({ targetRoot, file, environment = process.env }) {
  const state = installationState(targetRoot, environment);
  const contract = verifyContract(readAgentRunFile(path.resolve(file), { maxBytes: 262144 }).value, state.administrator, state.scope);
  const contract_sha256 = shadowHash(contract);
  checkSuccessor(state, contract, contract_sha256);
  return { contract, contract_sha256, administrator_sha256: state.administrator_sha256, directory_sha256: shadowHash(state.directory) };
}

export function installStandardAuthorization({ targetRoot, plan, environment = process.env }) {
  const state = installationState(targetRoot, environment);
  const contract = verifyContract(plan.contract, state.administrator, state.scope);
  if (plan.administrator_sha256 !== state.administrator_sha256 || plan.directory_sha256 !== shadowHash(state.directory)
    || plan.contract_sha256 !== shadowHash(contract)) fail("STANDARD_AUTHORIZATION_INSTALLATION_CHANGED");
  if (!checkSuccessor(state, contract, plan.contract_sha256)) return;

  fs.mkdirSync(state.directory, { recursive: true, mode: 0o700 });
  agentRunPhysicalPath(state.directory, { directory: true });
  const temporary = fs.mkdtempSync(path.join(state.directory, ".install-"));
  try {
    writeFileAtomicSync(path.join(temporary, contractFile), JSON.stringify(contract) + "\n", { mode: 0o600 });
    try {
      // An existing published directory is nonempty. A competing installer
      // can neither replace it nor revert a successfully published revision.
      fs.renameSync(temporary, path.join(state.directory, String(contract.revision)));
    } catch (error) {
      const winner = installationState(targetRoot, environment);
      if (winner.current_sha256 !== plan.contract_sha256) throw Object.assign(Error("STANDARD_AUTHORIZATION_INSTALLATION_CONFLICT"), { cause: error });
    }
    if (installationState(targetRoot, environment).current_sha256 !== plan.contract_sha256)
      fail("STANDARD_AUTHORIZATION_INSTALLATION_CHANGED");
  } finally {
    if (fs.existsSync(temporary)) {
      fs.rmSync(path.join(temporary, contractFile), { force: true });
      fs.rmdirSync(temporary);
    }
  }
}
