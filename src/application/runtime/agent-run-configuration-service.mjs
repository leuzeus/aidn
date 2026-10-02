import fs from "node:fs";
import { assertAgentLocalPath } from "../../core/agents/agent-local-path-policy.mjs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fingerprintAgentExecutionValue } from "../../core/agents/agent-execution-contracts.mjs";
import { assertWorkflowSegmentBinding } from "../../core/workflow/workflow-segment-binding.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const copy = value => structuredClone(value);
function object(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))
    || keys.some(key => !Object.hasOwn(value, key))) fail(code);
}
function absolute(value) {
  assertAgentLocalPath(value);
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")
    || value.split(/[\\/]/).includes("..")) fail("AGENT_RUN_ABSOLUTE_PATH_REQUIRED");
  return value;
}
function reference(value) {
  object(value, ["path", "sha256"], "AGENT_RUN_REFERENCE_INVALID");
  absolute(value.path); if (!HASH.test(value.sha256)) fail("AGENT_RUN_REFERENCE_INVALID");
}
export function assertAgentRunConfiguration(value) {
  // Canonical serialization first rejects non-JSON values/getters before reads.
  fingerprintAgentExecutionValue(value);
  const workflow = value?.contract_version === "agent-run-configuration.v2";
  object(value, ["contract_version", "run_id", "target_root", "resources_root", "planning_key",
    "integration_ref", "prepared_manifest", "git", "commit_identity", "native", "verification", ...(workflow ? ["workflow"] : [])], "AGENT_RUN_CONFIGURATION_INVALID");
  if (!workflow && value.contract_version !== "agent-run-configuration.v1" || !ID.test(value.run_id) || !ID.test(value.planning_key)) fail("AGENT_RUN_CONFIGURATION_INVALID");
  if (workflow) assertWorkflowSegmentBinding(value.workflow);
  absolute(value.target_root); absolute(value.resources_root);
  const relative = path.relative(value.target_root, value.resources_root), reverse = path.relative(value.resources_root, value.target_root);
  const inside = part => part === "" || !path.isAbsolute(part) && part !== ".." && !part.startsWith(".." + path.sep);
  if (inside(relative) || inside(reverse)) fail("AGENT_RUN_RESOURCE_OVERLAP");
  if (!/^refs\/heads\/codex\/[A-Za-z0-9][A-Za-z0-9_/-]*$/.test(value.integration_ref) || value.integration_ref.includes("//")) fail("AGENT_RUN_REF_INVALID");
  reference(value.prepared_manifest);
  object(value.git, ["executable", "sha256"], "AGENT_RUN_GIT_INVALID");
  absolute(value.git.executable); if (!HASH.test(value.git.sha256)) fail("AGENT_RUN_GIT_INVALID");
  object(value.commit_identity, ["name", "email", "timestamp"], "AGENT_RUN_COMMIT_IDENTITY_INVALID");
  if (Object.values(value.commit_identity).some(item => typeof item !== "string" || !item || item.length > 256 || /[\r\n\0]/.test(item))
    || !Number.isFinite(Date.parse(value.commit_identity.timestamp))) fail("AGENT_RUN_COMMIT_IDENTITY_INVALID");
  object(value.native, ["candidate", "runtime", "helper", "metadata_runner", "qualification", "profile"], "AGENT_RUN_NATIVE_CONFIGURATION_INVALID");
  object(value.native.metadata_runner, ["executable", "sha256"], "AGENT_RUN_NATIVE_CONFIGURATION_INVALID");
  absolute(value.native.metadata_runner.executable); if (!HASH.test(value.native.metadata_runner.sha256)) fail("AGENT_RUN_NATIVE_CONFIGURATION_INVALID");
  reference(value.native.qualification);
  object(value.native.profile, ["manifest", "policy", "consent"], "AGENT_RUN_NATIVE_CONFIGURATION_INVALID");
  reference(value.native.profile.manifest); reference(value.native.profile.policy);
  object(value.verification, ["runner", "environment", "audit_policy", "public_key", "private_key", "boundary"], "AGENT_RUN_VERIFICATION_INVALID");
  object(value.verification.runner, ["id", "executable"], "AGENT_RUN_VERIFICATION_INVALID");
  if (!ID.test(value.verification.runner.id)) fail("AGENT_RUN_VERIFICATION_INVALID");
  absolute(value.verification.runner.executable);
  for (const item of ["audit_policy", "public_key", "private_key"]) reference(value.verification[item]);
  object(value.verification.boundary, ["configuration", "qualification"], "AGENT_RUN_VERIFICATION_INVALID");
  reference(value.verification.boundary.configuration); reference(value.verification.boundary.qualification);
  return value;
}

export function agentRunPhysicalPath(input, { missing = false, directory = false } = {}) {
  absolute(input);
  const resolved = path.resolve(input), parsed = path.parse(resolved);
  let current = parsed.root, absent = false;
  for (const part of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (absent) continue;
    try { if (fs.lstatSync(current).isSymbolicLink()) fail("AGENT_RUN_PATH_REDIRECT"); }
    catch (cause) { if (missing && cause.code === "ENOENT") absent = true; else throw cause; }
  }
  if (absent) return resolved;
  const actual = fs.realpathSync.native(resolved);
  const key = value => process.platform === "win32" ? value.toLowerCase() : value;
  if (key(actual) !== key(resolved)) fail("AGENT_RUN_PATH_ALIAS");
  if (directory && !fs.statSync(actual).isDirectory()) fail("AGENT_RUN_DIRECTORY_REQUIRED");
  return actual;
}
export function assertAgentRunSecretScope(resourcesRoot, secretPath) {
  const root = agentRunPhysicalPath(resourcesRoot, { directory: true }), secret = agentRunPhysicalPath(secretPath);
  const inside = target => { const relative = path.relative(target, secret); return relative === "" || !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep); };
  if (!inside(root) || inside(path.join(root, "snapshots")) || inside(path.join(root, "scratch"))) fail("AGENT_RUN_SECRET_SCOPE_INVALID");
  return secret;
}
export function readAgentRunFile(input, { sha256, maxBytes = 8 * 1024 * 1024, json = true } = {}) {
  const file = agentRunPhysicalPath(input), before = fs.lstatSync(file);
  if (!before.isFile() || before.nlink !== 1 || before.size > maxBytes) fail("AGENT_RUN_FILE_INVALID");
  const descriptor = fs.openSync(file, "r");
  try {
    const opened = fs.fstatSync(descriptor);
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size) fail("AGENT_RUN_FILE_CHANGED");
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (!count) fail("AGENT_RUN_FILE_CHANGED"); offset += count;
    }
    const after = fs.fstatSync(descriptor), final = fs.lstatSync(file);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
      || final.ino !== opened.ino || final.dev !== opened.dev || final.isSymbolicLink()) fail("AGENT_RUN_FILE_CHANGED");
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (sha256 && digest !== sha256) fail("AGENT_RUN_FILE_CHANGED");
    return { value: json ? JSON.parse(bytes.toString("utf8")) : bytes, sha256: digest, bytes: bytes.length, path: file };
  } finally { fs.closeSync(descriptor); }
}
export function readAgentRunReference(reference, options = {}) {
  return readAgentRunFile(reference.path, { ...options, sha256: reference.sha256 });
}
export function readAgentRunConfiguration(file) {
  const read = readAgentRunFile(file);
  assertAgentRunConfiguration(read.value);
  return { configuration: copy(read.value), configuration_sha256: fingerprintAgentExecutionValue(read.value), file_sha256: read.sha256 };
}
