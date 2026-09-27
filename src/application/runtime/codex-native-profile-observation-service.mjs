import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fingerprintAgentExecutionValue as fingerprint } from "../../core/agents/agent-execution-contracts.mjs";
import { assertCodexNativeProfilePolicy, assertCodexNativeProfileBinding, fingerprintCodexNativeProfilePolicy,
  resolveCodexNativeProfileStatePaths, buildCodexNativeProfileArguments, CODEX_NATIVE_PROFILE_ENVIRONMENT_NAMES,
  assertCodexNativeProfileEnvironmentOverrideNames } from "../../adapters/agents/codex-native-profile-policy.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const requireProof = (condition, code) => { if (!condition) fail(code); };
const same = (a, b) => fingerprint(a) === fingerprint(b);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const equalPath = (a, b) => typeof a === "string" && typeof b === "string" &&
  (process.platform === "win32" ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));
const inside = (root, file) => { const relative = path.relative(root, file); return !relative || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`)); };
const ZERO = "0".repeat(64);
const MAX_METADATA = 2 * 1024 * 1024;
const SETUP_FILES = Object.freeze([".sandbox/setup_marker.json", ".sandbox/deny_read_acl_state.json", ".sandbox_migration",
  ".sandbox-bin/codex-command-runner-0.158.0-alpha.2.1.exe", ".sandbox-bin/codex.exe"]);

export const CODEX_NATIVE_PROFILE_SHARED_EFFECTS = Object.freeze({
  contract_version: "codex-native-profile-shared-effects.v1",
  allowed_effects: Object.freeze(["native authentication refresh in the selected profile", "native logs and caches in the selected profile",
    "attempt-scoped logs, SQLite and temporary files below the consented state root",
    "native historical metadata backfill, including titles, first user messages and previews, into the attempt-scoped SQLite state"]),
  protected_effects: Object.freeze(["configuration, hook trust and rule files remain unchanged", "observed sandbox provisioning files remain unchanged",
    "no setup, login, configuration write or approval RPC"]),
  evidence_limit: "File preimages and readiness do not establish unchanged Windows accounts, ACLs or firewall state.",
});

function physical(file, kind, optional = false) {
  requireProof(typeof file === "string" && path.isAbsolute(file) && path.normalize(file) === file, "PROFILE_ABSOLUTE_PATH_REQUIRED");
  let cursor = file;
  while (true) {
    try { const stat = fs.lstatSync(cursor); requireProof(!stat.isSymbolicLink() && (!stat.isFile() || stat.nlink === 1), "PROFILE_UNSAFE_PATH"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  try {
    const stat = fs.statSync(file); requireProof(kind === "directory" ? stat.isDirectory() : stat.isFile(), "PROFILE_PATH_KIND_MISMATCH");
    requireProof(equalPath(fs.realpathSync.native(file), file), "PROFILE_PATH_ALIAS"); return file;
  } catch (error) { if (optional && error.code === "ENOENT") return null; throw error; }
}

function fileRecord(file, optional = true) {
  if (!physical(file, "file", optional)) return { path: file, present: false };
  const before = fs.statSync(file); const digest = createHash("sha256"), fd = fs.openSync(file, "r"), buffer = Buffer.alloc(65536);
  try { let length; while ((length = fs.readSync(fd, buffer, 0, buffer.length, null))) digest.update(buffer.subarray(0, length)); }
  finally { fs.closeSync(fd); }
  const after = fs.statSync(file);
  requireProof(before.size === after.size && before.mtimeMs === after.mtimeMs && before.ino === after.ino, "PROFILE_SOURCE_CHANGED_DURING_READ");
  return { path: file, present: true, size: before.size, sha256: digest.digest("hex") };
}

export function readCodexNativeProfileIdentity(home) {
  physical(home, "directory"); const stat = fs.statSync(home);
  return { physical_path: fs.realpathSync.native(home), device: stat.dev, inode: stat.ino, birthtime_ms: stat.birthtimeMs };
}

function workerRoots(manifest) {
  const roots = manifest?.roots?.filter(row => /^worker-[a-z0-9_-]+$/.test(row.role ?? ""));
  requireProof(roots?.length >= 1 && roots.length <= 4 && new Set(roots.map(row => row.role)).size === roots.length && new Set(roots.map(row => row.root)).size === roots.length, "PROFILE_WORKER_ROOTS_REQUIRED");
  return roots.sort((a, b) => a.role.localeCompare(b.role));
}

function protectedSnapshot(manifest, home, environment) {
  const files = new Set([path.join(home, "config.toml"), path.join(home, "hooks.json"), path.join(home, "AGENTS.md")]);
  const programData = Object.entries(environment).find(([key]) => key.toLowerCase() === "programdata")?.[1];
  if (programData) files.add(path.join(programData, "OpenAI", "Codex", "config.toml"));
  for (const row of manifest.roots) {
    let cursor = physical(row.root, "directory");
    while (true) { files.add(path.join(cursor, ".codex", "config.toml")); const parent = path.dirname(cursor); if (cursor === parent) break; cursor = parent; }
    if (row.hooks?.config?.path) files.add(row.hooks.config.path);
    for (const handler of row.hooks?.handlers ?? []) files.add(path.join(row.root, handler.path));
  }
  const ruleDirectories = [path.join(home, "rules"), ...manifest.roots.map(row => path.join(row.root, ".codex", "rules"))];
  for (const directory of ruleDirectories) {
    if (!physical(directory, "directory", true)) continue;
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    requireProof(entries.length <= 128 && entries.every(entry => entry.isFile()), "PROFILE_RULES_SNAPSHOT_UNSUPPORTED");
    for (const entry of entries) files.add(path.join(directory, entry.name));
  }
  requireProof(files.size <= 512, "PROFILE_SOURCE_LIMIT");
  return [...files].sort().map(file => fileRecord(file));
}

function setupSnapshot(home) { return SETUP_FILES.map(relative => ({ relative, ...fileRecord(path.join(home, relative), false) })); }
function sharedEffects(setup) { return { ...CODEX_NATIVE_PROFILE_SHARED_EFFECTS, immutable_setup_sha256: fingerprint(setup) }; }

export function readCodexNativeProfileSharedEffects(home) {
  return sharedEffects(setupSnapshot(home));
}

function checkedConsent(consent, policy, proposal = false) {
  requireProof(object(consent) && consent.approved === true && consent.state_root === policy.effects.state_root
    && (proposal ? consent.metadata_only === true : consent.shared_effects_sha256 === policy.effects.shared_effects_sha256), "PROFILE_EXPLICIT_CONSENT_REQUIRED");
}

function environmentFor(home, stateRoot, host) {
  const allowed = new Set(["systemroot", "windir", "comspec", "path", "pathext", "userprofile", "localappdata", "appdata", "programdata"]);
  return { ...Object.fromEntries(Object.entries(host).filter(([key, value]) => allowed.has(key.toLowerCase()) && typeof value === "string")),
    CODEX_HOME: home, TEMP: stateRoot, TMP: stateRoot };
}

// Preexisting profiles can retain inert legacy fields. This mode deliberately
// uses native compatibility parsing on its first and only launch; it never
// retries a rejected configuration with weaker flags. Effective controls and
// every observed source remain mandatory and fingerprinted below.
export function buildCodexNativeProfileObservationArguments(policy, request) {
  return ["-c", `model=${JSON.stringify(request.execution.model)}`, "-c", `model_reasoning_effort=${JSON.stringify(request.execution.effort)}`,
    "-c", `sandbox_mode=${JSON.stringify(request.execution.sandbox)}`, "-c", 'windows.sandbox="elevated"', "-c", 'approval_policy="never"', "-c", "agents.enabled=false",
    "-c", "sandbox_workspace_write.writable_roots=[]", "-c", "sandbox_workspace_write.network_access=false",
    "-c", "sandbox_workspace_write.exclude_tmpdir_env_var=true", "-c", "sandbox_workspace_write.exclude_slash_tmp=true",
    ...buildCodexNativeProfileArguments(policy, request), "app-server", "--listen", "stdio://"];
}

// Only this function owns protocol writes. Server requests are never dispatched.
// Raw responses/stderr exist transiently in memory and are never logged or saved.
export async function collectCodexNativeProfileMetadata(input,
  { spawnProcess = spawn, isAlive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; } }, timeoutMs = 10000 } = {}) {
  requireProof(!Object.hasOwn(input, "metadataProfile"), "PROFILE_METADATA_PROFILE_INVALID");
  const { executable, args, cwd, env, roots, signal } = input;
  requireProof(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000, "PROFILE_METADATA_TIMEOUT_INVALID");
  const deadline = performance.now() + timeoutMs;
  if (signal?.aborted) fail("PROFILE_METADATA_CANCELLED");
  const calls = [{ method: "initialize", params: { clientInfo: { name: "aidn-native-profile-observer", version: "1" }, capabilities: { experimentalApi: true } } },
    ...roots.map(root => ({ method: "config/read", params: { cwd: root.root, includeLayers: true } })),
    { method: "hooks/list", params: { cwds: roots.map(root => root.root) } }, { method: "windowsSandbox/readiness", params: null }];
  let child, closed = false, exitCode = null, exitSignal = null, failed = null, index = 0, bytes = 0, stderrBytes = 0, tail = "", buffer = "";
  const responses = [], decoder = new TextDecoder("utf-8", { fatal: true });
  await new Promise(resolve => {
    let done = false, exitTimer, forceTimer;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); clearTimeout(exitTimer); clearTimeout(forceTimer); signal?.removeEventListener("abort", abort); resolve(); };
    const stop = code => { failed ??= code; try { child?.stdin.end(); child?.kill(); } catch {} forceTimer ??= setTimeout(finish, 1000); };
    const abort = () => stop("PROFILE_METADATA_CANCELLED");
    const timer = setTimeout(() => stop("PROFILE_METADATA_TIMEOUT"), Math.max(1, timeoutMs - 1000));
    try { child = spawnProcess(executable, args, { cwd, env, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] }); }
    catch { failed = "PROFILE_METADATA_SPAWN_FAILED"; finish(); return; }
    const send = () => { try { child.stdin.write(JSON.stringify({ id: index + 1, ...calls[index] }) + "\n"); } catch { stop("PROFILE_METADATA_WRITE_FAILED"); } };
    child.on("error", () => { failed ??= "PROFILE_METADATA_SPAWN_FAILED"; finish(); });
    child.stdin.on("error", () => stop("PROFILE_METADATA_WRITE_FAILED"));
    child.on("close", (code, sig) => { closed = true; exitCode = code; exitSignal = sig; finish(); });
    child.stderr.on("data", chunk => {
      stderrBytes += chunk.length; tail = (tail + chunk.toString("utf8")).slice(-4096);
      if (stderrBytes > 32768) stop("PROFILE_METADATA_STDERR_LIMIT");
      if (/MCP.*(?:starting|spawn|startup failed)|(?:sandbox setup|setup_start|setupStart)/i.test(tail)) stop("PROFILE_METADATA_UNEXPECTED_ACTIVITY");
    });
    child.stdout.on("data", chunk => {
      if (failed) return;
      bytes += chunk.length; if (bytes > MAX_METADATA) { stop("PROFILE_METADATA_OUTPUT_LIMIT"); return; }
      try { buffer += decoder.decode(chunk, { stream: true }); } catch { stop("PROFILE_METADATA_PROTOCOL_INVALID"); return; }
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, ""); buffer = buffer.slice(newline + 1);
        let message; try { message = JSON.parse(line); } catch { stop("PROFILE_METADATA_PROTOCOL_INVALID"); return; }
        if (!object(message)) { stop("PROFILE_METADATA_PROTOCOL_INVALID"); return; }
        if (message.method) { if (message.id !== undefined || !["configWarning", "remoteControl/status/changed"].includes(message.method)) stop("PROFILE_METADATA_UNEXPECTED_RPC"); continue; }
        if (message.id !== index + 1 || message.error || !Object.hasOwn(message, "result")) { stop("PROFILE_METADATA_RPC_REFUSED"); return; }
        responses.push(message.result); index++;
        if (index === 1) child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
        if (index < calls.length) send(); else { child.stdin.end(); exitTimer = setTimeout(() => stop("PROFILE_METADATA_CLOSE_TIMEOUT"), 500); }
      }
    });
    signal?.addEventListener("abort", abort, { once: true }); send();
  });
  const absent = Number.isSafeInteger(child?.pid) && !isAlive(child.pid);
  const processEvidence = { closed, pid_absent: absent, exit_code: exitCode, signal: exitSignal, response_count: responses.length, budget_ms: timeoutMs };
  if (!closed || !absent) { const error = Object.assign(new Error("PROFILE_METADATA_TERMINATION_UNCONFIRMED"), { code: "PROFILE_METADATA_TERMINATION_UNCONFIRMED", process: processEvidence }); throw error; }
  try { buffer += decoder.decode(); } catch { failed ??= "PROFILE_METADATA_PROTOCOL_INVALID"; }
  if (performance.now() >= deadline) failed ??= "PROFILE_METADATA_TIMEOUT";
  if (failed || exitCode !== 0 || exitSignal !== null || responses.length !== calls.length || buffer.trim()) {
    const code = failed ?? "PROFILE_METADATA_INCOMPLETE"; throw Object.assign(new Error(code), { code, process: processEvidence });
  }
  return { configs: responses.slice(1, 1 + roots.length), hooks: responses.at(-2), readiness: responses.at(-1),
    process: processEvidence };
}

export function normalizeCodexNativeProfileConfiguration(config, policy, request) {
  requireProof(object(config), "PROFILE_CONFIG_MALFORMED"); const state = resolveCodexNativeProfileStatePaths(policy, request);
  for (const [key, expected] of [["mcp_servers", policy.configuration.mcp_server_ids], ["plugins", policy.configuration.plugin_ids], ["apps", ["_default", ...policy.configuration.app_ids]]]) {
    const actual = config[key]; requireProof(object(actual) && same(Object.keys(actual).sort(), [...new Set(expected)].sort())
      && Object.values(actual).every(row => object(row) && row.enabled === false), "PROFILE_INTEGRATION_ACTIVE_OR_CHANGED");
  }
  requireProof(config.features?.plugins === false && config.features?.apps === false && config.features?.memories === false
    && Array.isArray(config.notify) && config.notify.length === 0 && config.model_provider === "openai"
    && config.model === request.execution.model && config.model_reasoning_effort === request.execution.effort
    && config.history?.persistence === "none" && config.memories?.generate_memories === false && config.memories?.use_memories === false
    && config.instructions === "" && config.developer_instructions === ""
    && config.log_dir === state.logs && config.sqlite_home === state.sqlite, "PROFILE_EFFECTIVE_SETTINGS_REFUSED");
  requireProof(!config.model_providers?.openai && !config.openai_base_url && !config.auth_command, "PROFILE_PROVIDER_OVERRIDE_REFUSED");
  const environment = config.shell_environment_policy;
  requireProof(object(environment?.set) && same(Object.keys(environment.set).sort(), [...policy.configuration.environment_override_names].sort())
    && Object.values(environment.set).every(value => value === ""), "PROFILE_ENVIRONMENT_OVERRIDE_REFUSED");
  requireProof(environment.inherit === "all" && environment.ignore_default_excludes === true
    && object(environment.filters) && same(environment.filters, Object.fromEntries(CODEX_NATIVE_PROFILE_ENVIRONMENT_NAMES.map(name => [name, "include"])))
    && [environment.include_only, environment.exclude].every(list => list == null || (Array.isArray(list) && list.length === 0)),
  "PROFILE_ENVIRONMENT_FILTER_REFUSED");
  requireProof(["read-only", "workspace-write"].includes(request.execution.sandbox) && config.approval_policy === "never"
    && config.sandbox_mode === request.execution.sandbox && config.windows?.sandbox === "elevated"
    && config.agents?.enabled === false && config.sandbox_workspace_write?.network_access === false
    && Array.isArray(config.sandbox_workspace_write?.writable_roots) && config.sandbox_workspace_write.writable_roots.length === 0
    && config.sandbox_workspace_write.exclude_tmpdir_env_var === true && config.sandbox_workspace_write.exclude_slash_tmp === true,
  "PROFILE_SANDBOX_SETTINGS_REFUSED");
  const normalized = structuredClone(config);
  normalized.model = "$REQUEST_MODEL"; normalized.model_reasoning_effort = "$REQUEST_EFFORT";
  normalized.log_dir = "$ATTEMPT_LOGS"; normalized.sqlite_home = "$ATTEMPT_SQLITE";
  return normalized;
}

export function validateCodexNativeProfileMetadata({ metadata, manifest, policy, request, sourceFiles }) {
  const roots = workerRoots(manifest); requireProof(metadata.configs?.length === roots.length, "PROFILE_CONFIG_MALFORMED");
  requireProof(metadata.readiness?.status === "ready", "PROFILE_BACKEND_NOT_READY");
  const layers = [], settings = [];
  metadata.configs.forEach((response, index) => {
    requireProof(Array.isArray(response.layers) && response.layers.length > 0 && response.layers.length <= 64, "PROFILE_LAYERS_REQUIRED");
    settings.push({ role: roots[index].role, settings: normalizeCodexNativeProfileConfiguration(response.config, policy, request) });
    for (const layer of response.layers) {
      requireProof(object(layer.name) && typeof layer.name.type === "string" && typeof layer.version === "string", "PROFILE_LAYER_MALFORMED");
      if (layer.name.type === "sessionFlags") continue;
      requireProof(!layer.disabledReason, "PROFILE_LAYER_DISABLED");
      const file = layer.name.file ?? (layer.name.dotCodexFolder && path.join(layer.name.dotCodexFolder, "config.toml"));
      requireProof(file && sourceFiles.some(row => equalPath(row.path, file)), "PROFILE_SOURCE_UNOBSERVED");
      layers.push({ role: roots[index].role, name: layer.name, version: layer.version, config_sha256: fingerprint(layer.config ?? null) });
    }
  });
  const surfaces = metadata.hooks?.data;
  requireProof(Array.isArray(surfaces) && surfaces.length === roots.length, "PROFILE_HOOKS_REQUIRED");
  const hookRecords = [];
  for (const root of roots) {
    const matches = surfaces.filter(row => equalPath(row.cwd, root.root)); requireProof(matches.length === 1, "PROFILE_HOOK_ROOT_MISMATCH");
    const surface = matches[0]; requireProof(!surface.errors?.length && !surface.warnings?.length && surface.hooks?.length === 2, "PROFILE_EXTRA_OR_MISSING_HOOKS");
    for (const [native, configured] of [["preToolUse", "PreToolUse"], ["sessionStart", "SessionStart"]]) {
      const matching = surface.hooks.filter(row => row.eventName === native); requireProof(matching.length === 1, "PROFILE_EXTRA_OR_MISSING_HOOKS");
      const hook = matching[0], source = manifest.roots.find(row => row.role === "coordinator");
      requireProof(source && equalPath(source.hooks?.config?.path, hook.sourcePath) && hook.source === "project" && hook.enabled === true && hook.trustStatus === "trusted" && hook.handlerType === "command"
        && hook.async === false && /^sha256:[a-f0-9]{64}$/.test(hook.currentHash ?? ""), "PROFILE_HOOK_UNTRUSTED");
      let groups; try { groups = JSON.parse(source.hooks.definition).hooks?.[configured]; } catch { fail("PROFILE_HOOK_DEFINITION_INVALID"); }
      requireProof(groups?.length === 1 && groups[0].hooks?.length === 1, "PROFILE_HOOK_DEFINITION_INVALID");
      const definition = groups[0].hooks[0];
      requireProof(hook.command === (process.platform === "win32" ? definition.commandWindows ?? definition.command : definition.command)
        && hook.matcher === groups[0].matcher && hook.timeoutSec === definition.timeout && (native !== "preToolUse" || hook.matcher === ".*"), "PROFILE_HOOK_DEFINITION_CHANGED");
      hookRecords.push({ role: root.role, event: native, source_path: hook.sourcePath, current_hash: hook.currentHash,
        command_sha256: hash(hook.command), matcher: hook.matcher, timeout: hook.timeoutSec });
    }
  }
  return { sources_sha256: fingerprint({ files: sourceFiles, layers }), effective_settings_sha256: fingerprint(settings),
    hooks_sha256: fingerprint(hookRecords), integrations_disabled: true, unexpected_hooks: 0 };
}

function prepareObservation({ manifest, policy, request, consent, proposal }, host) {
  assertCodexNativeProfilePolicy(policy); checkedConsent(consent, policy, proposal);
  requireProof(process.platform === "win32" && process.arch === "x64", "PROFILE_PLATFORM_UNAVAILABLE");
  requireProof(manifest?.codex?.sha256 === policy.client_sha256 && equalPath(manifest.codex_home, policy.home.physical_path), "PROFILE_MANIFEST_BINDING_MISMATCH");
  requireProof(workerRoots(manifest).some(row => equalPath(row.root, request?.cwd)), "PROFILE_REQUEST_ROOT_MISMATCH");
  assertCodexNativeProfileBinding(policy, request);
  const home = readCodexNativeProfileIdentity(policy.home.physical_path);
  requireProof(fingerprint(home) === policy.home.identity_sha256, "PROFILE_HOME_CHANGED");
  requireProof(fileRecord(manifest.codex.binary_path, false).sha256 === policy.client_sha256, "PROFILE_CLIENT_CHANGED");
  const state = resolveCodexNativeProfileStatePaths(policy, request), env = environmentFor(policy.home.physical_path, state.root, host);
  requireProof(manifest.roots.every(root => !inside(root.root, policy.effects.state_root) && !inside(policy.effects.state_root, root.root)), "PROFILE_STATE_ROOT_UNSAFE");
  for (const directory of [state.root, state.logs, state.sqlite]) physical(directory, "directory", true);
  const setup = setupSnapshot(policy.home.physical_path), effects = sharedEffects(setup);
  if (!proposal) requireProof(fingerprint(effects) === policy.effects.shared_effects_sha256, "PROFILE_SETUP_STATE_CHANGED");
  const sources = protectedSnapshot(manifest, policy.home.physical_path, env);
  for (const root of manifest.roots) {
    requireProof(sources.find(file => equalPath(file.path, root.hooks?.config?.path))?.sha256 === root.hooks?.config?.sha256, "PROFILE_HOOK_FILE_CHANGED");
    for (const handler of root.hooks?.handlers ?? []) requireProof(sources.find(file => equalPath(file.path, path.join(root.root, handler.path)))?.sha256 === handler.sha256, "PROFILE_HOOK_FILE_CHANGED");
  }
  return { home, setup, effects, sources, env, state };
}

export function createCodexNativeProfileObserver({ collect = collectCodexNativeProfileMetadata, host = process.env } = {}) {
  return async function observe({ manifest, policy, request, consent, signal, proposal = false, metadataBootstrap = false, timeoutMs = 10000 }) {
    requireProof(typeof metadataBootstrap === "boolean" && Number.isInteger(timeoutMs) && timeoutMs > 0
      && (metadataBootstrap ? timeoutMs <= 60000 : timeoutMs === 10000), "PROFILE_METADATA_TIMEOUT_INVALID");
    if (signal?.aborted) fail("PROFILE_METADATA_CANCELLED");
    const before = prepareObservation({ manifest, policy, request, consent, proposal }, host);
    let metadata, failure;
    try { metadata = await collect({ executable: manifest.codex.binary_path, args: buildCodexNativeProfileObservationArguments(policy, request), cwd: request.cwd, env: before.env, roots: workerRoots(manifest), signal }, { timeoutMs }); }
    catch (error) { failure = error; }
    const after = prepareObservation({ manifest, policy, request, consent, proposal }, host);
    requireProof(same(before.home, after.home) && same(before.sources, after.sources) && same(before.setup, after.setup), "PROFILE_PRESERVATION_FAILED");
    if (failure) throw failure;
    if (signal?.aborted) throw Object.assign(new Error("PROFILE_METADATA_CANCELLED"), { code: "PROFILE_METADATA_CANCELLED", process: metadata.process });
    const evidence = validateCodexNativeProfileMetadata({ metadata, manifest, policy, request, sourceFiles: before.sources });
    if (!proposal) requireProof(evidence.sources_sha256 === policy.configuration.sources_sha256
      && evidence.effective_settings_sha256 === policy.configuration.effective_settings_sha256 && evidence.hooks_sha256 === policy.hooks_sha256, "PROFILE_POLICY_OBSERVATION_CHANGED");
    return { protocol_version: 1, status: proposal ? "proposal_observed" : "verified", ...evidence,
      home_identity_sha256: fingerprint(before.home), client_sha256: policy.client_sha256,
      shared_effects_sha256: fingerprint(before.effects), shared_effects: before.effects, sources: before.sources,
      setup_sha256: fingerprint(before.setup), process: metadata.process, preservation: "PASS", provisioning_performed: false, environment_restricted: true };
  };
}

export const observerMetadata = createCodexNativeProfileObserver();

// Bootstrap prepares native metadata for this exact request. Its evidence
// cannot satisfy challenge-bearing verification or admit a worker.
export function assertCodexNativeProfileBootstrap(result, { policy, request, rootCount = 2 } = {}) {
  requireProof(Number.isInteger(rootCount) && rootCount >= 1 && rootCount <= 4, "PROFILE_WORKER_ROOTS_REQUIRED");
  assertCodexNativeProfileBinding(policy, request);
  const state = resolveCodexNativeProfileStatePaths(policy, request);
  const expected = { protocol_version: 1, status: "bootstrap_completed", authorization: "NOT_GRANTED", native_execution: "NOT_RUN",
    attempt_id: request.attempt_id, request_sha256: fingerprint(request), policy_sha256: fingerprintCodexNativeProfilePolicy(policy), state_root: state.root,
    preservation: "PASS", home_identity_sha256: policy.home.identity_sha256, client_sha256: policy.client_sha256,
    sources_sha256: policy.configuration.sources_sha256, effective_settings_sha256: policy.configuration.effective_settings_sha256,
    hooks_sha256: policy.hooks_sha256, shared_effects_sha256: policy.effects.shared_effects_sha256, provisioning_performed: false, environment_restricted: true };
  const { tree_termination: tree, ...parentProcess } = object(result?.process) ? result.process : {};
  if (tree !== undefined) requireProof(object(tree) && Object.keys(tree).sort().join(",") === "bridge_sha256,candidate_inventory_sha256,collector_sha256,proof,request_sha256,runner,termination_state"
    && tree.termination_state === "confirmed" && tree.proof?.method === "windows-job-object" && tree.proof.active_processes === 0
    && object(tree.runner) && ["runner_id", "pid", "started_at", "job_name"].every(key => tree.runner[key] !== undefined && tree.proof[key] === tree.runner[key])
    && ["bridge_sha256", "collector_sha256", "candidate_inventory_sha256", "request_sha256"].every(key => /^[a-f0-9]{64}$/.test(tree[key] ?? "")), "PROFILE_BOOTSTRAP_REFUSED");
  requireProof(object(result) && Object.keys(result).length === Object.keys(expected).length + 3
    && Object.entries(expected).every(([key, value]) => result[key] === value)
    && /^[a-f0-9]{64}$/.test(result.setup_sha256 ?? "") && Number.isInteger(result.budget_ms) && result.budget_ms > 0 && result.budget_ms <= 60000
    && object(result.process) && same(parentProcess, { closed: true, pid_absent: true, exit_code: 0, signal: null, response_count: rootCount + 3, budget_ms: result.budget_ms }), "PROFILE_BOOTSTRAP_REFUSED");
  return true;
}

export function createCodexNativeProfileVerifier({ manifest, policy, outputRoot, consent, observer = observerMetadata } = {}) {
  assertCodexNativeProfilePolicy(policy); checkedConsent(consent, policy);
  const frozen = { manifest: structuredClone(manifest), policy: structuredClone(policy), consent: structuredClone(consent) };
  let lastRequest, initial, count = 0;
  async function observe(request, signal, { metadataBootstrap = false, timeoutMs = 10000 } = {}) {
    if (signal?.aborted) fail("PROFILE_METADATA_CANCELLED");
    assertCodexNativeProfileBinding(frozen.policy, request);
    const observation = await observer({ ...frozen, request: structuredClone(request), signal, metadataBootstrap, timeoutMs });
    if (signal?.aborted) throw Object.assign(new Error("PROFILE_METADATA_CANCELLED"), { code: "PROFILE_METADATA_CANCELLED", process: observation?.process });
    requireProof(observation.status === "verified" && observation.process?.closed === true && observation.process?.pid_absent === true
      && observation.process.budget_ms === timeoutMs
      && observation.preservation === "PASS" && observation.provisioning_performed === false
      && observation.home_identity_sha256 === policy.home.identity_sha256 && observation.client_sha256 === policy.client_sha256
      && observation.sources_sha256 === policy.configuration.sources_sha256 && observation.effective_settings_sha256 === policy.configuration.effective_settings_sha256
      && observation.hooks_sha256 === policy.hooks_sha256 && observation.shared_effects_sha256 === policy.effects.shared_effects_sha256
      && observation.integrations_disabled === true && observation.environment_restricted === true && observation.unexpected_hooks === 0, "PROFILE_OBSERVATION_INCOMPLETE");
    if (initial) requireProof(initial.sources_sha256 === observation.sources_sha256 && initial.setup_sha256 === observation.setup_sha256, "PROFILE_PRESERVATION_FAILED");
    if (!metadataBootstrap) {
      initial ??= observation;
      lastRequest = structuredClone(request);
    }
    if (outputRoot) {
      physical(outputRoot, "directory");
      requireProof(!inside(policy.home.physical_path, outputRoot) && !inside(outputRoot, policy.home.physical_path)
        && manifest.roots.every(root => !inside(root.root, outputRoot)), "PROFILE_EVIDENCE_ROOT_UNSAFE");
      const retained = metadataBootstrap ? { ...observation, status: "bootstrap_observed", authorization: "NOT_GRANTED", native_execution: "NOT_RUN" } : observation;
      fs.writeFileSync(path.join(outputRoot, `native-profile-${metadataBootstrap ? "bootstrap" : "observation"}-${++count}.json`), JSON.stringify(retained, null, 2) + "\n", { flag: "wx" });
    }
    return observation;
  }
  const verifier = async (request, { signal, phase, challenge } = {}) => {
    requireProof(["before_create", "before_resume"].includes(phase) && typeof challenge === "string" && /^[a-f0-9-]{36}$/.test(challenge), "PROFILE_VERIFICATION_CONTEXT_INVALID");
    await observe(request, signal);
    return { protocol_version: 1, ok: true, phase, challenge, policy_sha256: fingerprintCodexNativeProfilePolicy(policy), attempt_id: request.attempt_id,
      request_sha256: fingerprint(request), home_identity_sha256: policy.home.identity_sha256, client_sha256: policy.client_sha256,
      backend: policy.backend.sandbox, sources_sha256: policy.configuration.sources_sha256, effective_settings_sha256: policy.configuration.effective_settings_sha256,
      hooks_sha256: policy.hooks_sha256, shared_effects_sha256: policy.effects.shared_effects_sha256,
      unexpected_hooks: 0, integrations_disabled: true, environment_restricted: true, provisioning_performed: false };
  };
  verifier.bootstrap = async (request, { signal, timeoutMs = 60000 } = {}) => {
    requireProof(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000, "PROFILE_METADATA_TIMEOUT_INVALID");
    const observation = await observe(request, signal, { metadataBootstrap: true, timeoutMs });
    const result = { protocol_version: 1, status: "bootstrap_completed", authorization: "NOT_GRANTED", native_execution: "NOT_RUN",
      attempt_id: request.attempt_id, request_sha256: fingerprint(request), policy_sha256: fingerprintCodexNativeProfilePolicy(policy),
      state_root: resolveCodexNativeProfileStatePaths(policy, request).root, budget_ms: timeoutMs, process: observation.process,
      preservation: "PASS", home_identity_sha256: policy.home.identity_sha256, client_sha256: policy.client_sha256,
      sources_sha256: observation.sources_sha256, effective_settings_sha256: observation.effective_settings_sha256,
      hooks_sha256: observation.hooks_sha256, setup_sha256: observation.setup_sha256, shared_effects_sha256: observation.shared_effects_sha256,
      provisioning_performed: false, environment_restricted: true };
    assertCodexNativeProfileBootstrap(result, { policy, request, rootCount: workerRoots(manifest).length });
    return result;
  };
  verifier.finalize = async ({ signal, request = lastRequest } = {}) => {
    requireProof(initial && request, "PROFILE_INITIAL_OBSERVATION_REQUIRED");
    const observation = await observe(request, signal);
    return { ok: true, preservation: "PASS", provisioning_performed: false, sources_sha256: observation.sources_sha256,
      setup_sha256: observation.setup_sha256, shared_effects_sha256: observation.shared_effects_sha256, process: observation.process,
      evidence_limit: CODEX_NATIVE_PROFILE_SHARED_EFFECTS.evidence_limit };
  };
  return verifier;
}

// Bootstrap is metadata-only and yields a proposal, never a runnable decision.
// Final verification never learns new identifiers or substitutes missing hashes.
export async function inspectCodexNativeProfileProposal({ manifest, policyTemplate, request, consent, signal,
  collect = collectCodexNativeProfileMetadata, host = process.env, discoveryOnly = false,
  bootstrapMetadata = false, bootstrapTimeoutMs = 60000 } = {}) {
  requireProof(typeof bootstrapMetadata === "boolean" && Number.isInteger(bootstrapTimeoutMs) && bootstrapTimeoutMs > 0
    && bootstrapTimeoutMs <= 60000, "PROFILE_METADATA_TIMEOUT_INVALID");
  if (signal?.aborted) fail("PROFILE_METADATA_CANCELLED");
  const candidate = structuredClone(policyTemplate);
  candidate.configuration = { sources_sha256: ZERO, effective_settings_sha256: ZERO, mcp_server_ids: [], plugin_ids: [], app_ids: [], environment_override_names: [] };
  candidate.hooks_sha256 = ZERO; candidate.effects.shared_effects_sha256 = ZERO;
  const bind = () => ({ ...structuredClone(request), execution: { ...structuredClone(request.execution), native_profile: { mode: "preexisting", policy_sha256: fingerprintCodexNativeProfilePolicy(candidate) } } });
  let bound = bind(); const before = prepareObservation({ manifest, policy: candidate, request: bound, consent, proposal: true }, host);
  async function collectRound(timeoutMs) {
    let raw, failure;
    try { raw = await collect({ executable: manifest.codex.binary_path, args: buildCodexNativeProfileObservationArguments(candidate, bound), cwd: bound.cwd, env: before.env, roots: workerRoots(manifest), signal }, { timeoutMs }); }
    catch (error) { failure = error; }
    const after = prepareObservation({ manifest, policy: candidate, request: bound, consent, proposal: true }, host);
    requireProof(same(before.home, after.home) && same(before.sources, after.sources) && same(before.setup, after.setup), "PROFILE_PRESERVATION_FAILED");
    if (failure) throw failure;
    if (signal?.aborted) throw Object.assign(new Error("PROFILE_METADATA_CANCELLED"), { code: "PROFILE_METADATA_CANCELLED", process: raw.process });
    requireProof(same(raw.process, { closed: true, pid_absent: true, exit_code: 0, signal: null, response_count: workerRoots(manifest).length + 3, budget_ms: timeoutMs }), "PROFILE_METADATA_INCOMPLETE");
    return raw;
  }
  let bootstrap = null;
  if (bootstrapMetadata) {
    const prepared = await collectRound(bootstrapTimeoutMs);
    bootstrap = { status: "metadata_bootstrap_completed", authorization: "NOT_GRANTED", native_execution: "NOT_RUN",
      attempt_id: bound.attempt_id, request_sha256: fingerprint(bound), state_root: before.state.root, budget_ms: bootstrapTimeoutMs, process: prepared.process };
  }
  const raw = await collectRound(10000);
  for (const [key, field] of [["mcp_servers", "mcp_server_ids"], ["plugins", "plugin_ids"], ["apps", "app_ids"]]) {
    candidate.configuration[field] = [...new Set(raw.configs.flatMap(response => Object.keys(response.config?.[key] ?? {})))].filter(id => key !== "apps" || id !== "_default").sort();
  }
  candidate.configuration.environment_override_names = discoverCodexNativeProfileEnvironmentOverrideNames(raw.configs);
  assertCodexNativeProfilePolicy(candidate);
  if (discoveryOnly) {
    requireProof(["ready", "notConfigured", "updateRequired"].includes(raw.readiness?.status)
      && Array.isArray(raw.hooks?.data), "PROFILE_DISCOVERY_INCOMPLETE");
    const layers = raw.configs.map(response => {
      requireProof(Array.isArray(response.layers), "PROFILE_LAYERS_REQUIRED");
      return response.layers.filter(layer => layer.name?.type !== "sessionFlags").map(layer => ({
        name_sha256: fingerprint(layer.name), version_sha256: fingerprint(layer.version), config_sha256: fingerprint(layer.config ?? null), disabled: Boolean(layer.disabledReason) }));
    });
    return { status: "discovery_only", authorization: "NOT_GRANTED", native_execution: "NOT_RUN", metadata_bootstrap: bootstrap,
      integration_ids: { mcp_server_ids: candidate.configuration.mcp_server_ids, plugin_ids: candidate.configuration.plugin_ids, app_ids: candidate.configuration.app_ids },
      environment_override_names: candidate.configuration.environment_override_names,
      sources_sha256: fingerprint({ files: before.sources, layers }), shared_effects: before.effects,
      shared_effects_sha256: fingerprint(before.effects), readiness: raw.readiness.status, process: raw.process,
      hooks: raw.hooks.data.map(surface => ({ cwd_sha256: fingerprint(surface.cwd), errors: surface.errors?.length ?? 0, warnings: surface.warnings?.length ?? 0,
        entries: (surface.hooks ?? []).map(hook => ({ event_name_sha256: fingerprint(hook.eventName), source_path_sha256: fingerprint(hook.sourcePath),
          current_hash: /^sha256:[a-f0-9]{64}$/.test(hook.currentHash ?? "") ? hook.currentHash : null,
          enabled: hook.enabled === true, trust_status: ["trusted", "untrusted", "modified"].includes(hook.trustStatus) ? hook.trustStatus : "unknown" })) })) };
  }
  bound = bind();
  const observation = await createCodexNativeProfileObserver({ collect, host })({ manifest, policy: candidate, request: bound, consent, signal, proposal: true });
  candidate.configuration.sources_sha256 = observation.sources_sha256;
  candidate.configuration.effective_settings_sha256 = observation.effective_settings_sha256;
  candidate.hooks_sha256 = observation.hooks_sha256; candidate.effects.shared_effects_sha256 = observation.shared_effects_sha256;
  assertCodexNativeProfilePolicy(candidate);
  return { status: "proposal", policy_candidate: candidate, shared_effects: observation.shared_effects, metadata_bootstrap: bootstrap,
    process: observation.process, authorization: "NOT_GRANTED", native_execution: "NOT_RUN" };
}

export async function discoverCodexNativeProfileMetadata(options) {
  return inspectCodexNativeProfileProposal({ ...options, discoveryOnly: true });
}

// Discovery emits identifiers only. Inherited values remain transient, then the
// strict proposal must observe all frozen names blanked and final filters exact.
export function discoverCodexNativeProfileEnvironmentOverrideNames(configs) {
  requireProof(Array.isArray(configs) && configs.length > 0, "PROFILE_CONFIG_MALFORMED");
  const names = [...new Set(configs.flatMap(response => {
    requireProof(object(response?.config), "PROFILE_CONFIG_MALFORMED");
    const overrides = response.config.shell_environment_policy?.set ?? {};
    requireProof(object(overrides), "PROFILE_ENVIRONMENT_OVERRIDE_REFUSED");
    return Object.keys(overrides);
  }))].sort();
  assertCodexNativeProfileEnvironmentOverrideNames(names);
  return names;
}
