import path from "node:path";
import { fingerprintAgentExecutionValue } from "../../core/agents/agent-execution-contracts.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const absolute = value => typeof value === "string" && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value)
  && path.isAbsolute(value) && path.normalize(value) === value
  && (process.platform !== "win32" || /^[a-z]:\\/i.test(value));
const contained = (parent, child) => {
  const relative = path.relative(parent, child);
  return !relative || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
};
const ids = value => Array.isArray(value) && value.length <= 128 && new Set(value).size === value.length
  && value.every(item => typeof item === "string" && item.length > 0 && item.length <= 256 && !/[\x00-\x1f\x7f]/.test(item));

// Match the environment accepted by createCodexWorkerEnvironment. Exact names
// also form the final native shell filter; empty set values alone are not removal.
export const CODEX_NATIVE_PROFILE_ENVIRONMENT_NAMES = Object.freeze([
  "SYSTEMROOT", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMDATA",
  "CODEX_HOME", "TEMP", "TMP", "AIDN_AGENT_ADMISSION_ENDPOINT", "AIDN_AGENT_ADMISSION_TOKEN", "AIDN_AGENT_ATTEMPT_ID", "AIDN_AGENT_REQUEST_SHA256",
]);
const reservedEnvironmentNames = new Set(CODEX_NATIVE_PROFILE_ENVIRONMENT_NAMES);
const environmentNames = names => Array.isArray(names) && names.length <= 128
  && names.every(name => typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(name)
    && !reservedEnvironmentNames.has(name.toUpperCase()))
  && new Set(names.map(name => name.toUpperCase())).size === names.length;

export function assertCodexNativeProfileEnvironmentOverrideNames(names) {
  if (!environmentNames(names)) fail("CODEX_NATIVE_PROFILE_ENVIRONMENT_NAMES_INVALID");
  return true;
}

// Local, bounded JSON policy only. Hashes reference supervisor observations;
// validating this document does not inspect files, establish trust or provision
// a backend. effective_settings_sha256 describes normalized settings: request
// model/effort and the derived state paths are checked separately by the probe.
export function assertCodexNativeProfilePolicy(policy) {
  try { fingerprintAgentExecutionValue(policy); } catch { fail("CODEX_NATIVE_PROFILE_POLICY_INVALID"); }
  if (!exact(policy, ["contract_version", "mode", "home", "client_sha256", "backend", "configuration", "hooks_sha256", "effects"])
      || policy.contract_version !== "codex-native-profile-policy.v1" || policy.mode !== "preexisting"
      || !exact(policy.home, ["physical_path", "identity_sha256"]) || !absolute(policy.home.physical_path) || !digest(policy.home.identity_sha256)
      || !digest(policy.client_sha256) || !digest(policy.hooks_sha256)
      || !exact(policy.backend, ["platform", "architecture", "sandbox", "provisioning"])
      || policy.backend.platform !== "win32" || policy.backend.architecture !== "x64"
      || policy.backend.sandbox !== "elevated" || policy.backend.provisioning !== "existing-only"
      || !exact(policy.configuration, ["sources_sha256", "effective_settings_sha256", "mcp_server_ids", "plugin_ids", "app_ids", "environment_override_names"])
      || !digest(policy.configuration.sources_sha256) || !digest(policy.configuration.effective_settings_sha256)
      || ![policy.configuration.mcp_server_ids, policy.configuration.plugin_ids, policy.configuration.app_ids].every(ids)
      || !environmentNames(policy.configuration.environment_override_names)
      || !exact(policy.effects, ["state_root", "shared_effects_sha256"]) || !absolute(policy.effects.state_root)
      || !digest(policy.effects.shared_effects_sha256)
      || contained(policy.home.physical_path, policy.effects.state_root) || contained(policy.effects.state_root, policy.home.physical_path)) {
    fail("CODEX_NATIVE_PROFILE_POLICY_INVALID");
  }
  return true;
}

export function fingerprintCodexNativeProfilePolicy(policy) {
  assertCodexNativeProfilePolicy(policy);
  return fingerprintAgentExecutionValue(policy);
}

export function assertCodexNativeProfileBinding(policy, request, runtime) {
  const reference = request?.execution?.native_profile;
  if (policy === undefined && reference === undefined) return false;
  if (!policy || !reference) fail("CODEX_NATIVE_PROFILE_POLICY_REQUIRED");
  const sha256 = fingerprintCodexNativeProfilePolicy(policy);
  if (!exact(reference, ["mode", "policy_sha256"]) || reference.mode !== "preexisting" || reference.policy_sha256 !== sha256
      || (runtime && (runtime.codexHome !== policy.home.physical_path || runtime.sha256 !== policy.client_sha256))) {
    fail("CODEX_NATIVE_PROFILE_BINDING_MISMATCH");
  }
  if (!absolute(request.cwd) || contained(request.cwd, policy.home.physical_path) || contained(policy.home.physical_path, request.cwd) || contained(request.cwd, policy.effects.state_root)
      || contained(policy.effects.state_root, request.cwd)) fail("CODEX_NATIVE_PROFILE_PATH_OVERLAP");
  return true;
}

export function resolveCodexNativeProfileStatePaths(policy, request) {
  assertCodexNativeProfileBinding(policy, request);
  if (typeof request.attempt_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(request.attempt_id)) fail("CODEX_NATIVE_PROFILE_ATTEMPT_INVALID");
  const root = path.join(policy.effects.state_root, fingerprintAgentExecutionValue(request.attempt_id));
  return { root, logs: path.join(root, "logs"), sqlite: path.join(root, "sqlite") };
}

// Inline TOML tables quote the integration identifier as a table key. A dotted
// CLI assignment with a quoted identifier can create a different literal key;
// an empty table merges with existing entries and does not disable them.
const disabledTable = names => `{${[...new Set(names)].sort().map(name => `${JSON.stringify(name)}={enabled=false}`).join(",")}}`;
export function buildCodexNativeProfileArguments(policy, request) {
  if (!assertCodexNativeProfileBinding(policy, request)) return [];
  const state = resolveCodexNativeProfileStatePaths(policy, request);
  const settings = [
    `mcp_servers=${disabledTable(policy.configuration.mcp_server_ids)}`,
    `plugins=${disabledTable(policy.configuration.plugin_ids)}`,
    `apps=${disabledTable(["_default", ...policy.configuration.app_ids])}`,
    "features.plugins=false", "features.apps=false", "notify=[]",
    'model_provider="openai"', 'history.persistence="none"',
    "memories.generate_memories=false", "memories.use_memories=false", "features.memories=false",
    'developer_instructions=""', 'instructions=""',
    `shell_environment_policy.set={${[...policy.configuration.environment_override_names].sort().map(name => `${JSON.stringify(name)}=""`).join(",")}}`,
    'shell_environment_policy.inherit="all"', "shell_environment_policy.ignore_default_excludes=true",
    `shell_environment_policy.filters={${CODEX_NATIVE_PROFILE_ENVIRONMENT_NAMES.map(name => `${JSON.stringify(name)}="include"`).join(",")}}`,
    `log_dir=${JSON.stringify(state.logs)}`, `sqlite_home=${JSON.stringify(state.sqlite)}`,
  ];
  // Never erase hook configuration: the live hooks/list observation must reject
  // every extra enabled hook and preserve the exact reviewed AIDN definitions.
  return settings.flatMap(setting => ["-c", setting]);
}

export function assertCodexNativeProfileVerification(decision, { policy, request, phase, challenge }) {
  const expected = {
    protocol_version: 1, ok: true, phase, challenge,
    policy_sha256: fingerprintCodexNativeProfilePolicy(policy), attempt_id: request.attempt_id,
    request_sha256: fingerprintAgentExecutionValue(request), home_identity_sha256: policy.home.identity_sha256,
    client_sha256: policy.client_sha256, backend: policy.backend.sandbox,
    sources_sha256: policy.configuration.sources_sha256, effective_settings_sha256: policy.configuration.effective_settings_sha256,
    hooks_sha256: policy.hooks_sha256, shared_effects_sha256: policy.effects.shared_effects_sha256,
    unexpected_hooks: 0, integrations_disabled: true, environment_restricted: true, provisioning_performed: false,
  };
  if (!["before_create", "before_resume"].includes(phase) || typeof challenge !== "string" || !/^[a-f0-9-]{36}$/.test(challenge)
      || !exact(decision, Object.keys(expected))) fail("CODEX_NATIVE_PROFILE_VERIFICATION_REFUSED");
  try {
    if (fingerprintAgentExecutionValue(decision) !== fingerprintAgentExecutionValue(expected)) fail("CODEX_NATIVE_PROFILE_VERIFICATION_REFUSED");
  } catch { fail("CODEX_NATIVE_PROFILE_VERIFICATION_REFUSED"); }
  return true;
}
