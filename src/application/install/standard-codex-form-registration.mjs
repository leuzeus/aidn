
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentRunPhysicalPath, readAgentRunFile } from "../runtime/agent-run-configuration-service.mjs";
import { resolveRuntimeProjectContext } from "../runtime/runtime-project-context-service.mjs";
import { resolveEffectiveRuntimePersistence } from "../runtime/runtime-persistence-service.mjs";
import { readStandardProjectAuthorization } from "../../adapters/runtime/standard-project-authorization-store.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { writeFileAtomicSync } from "../../lib/fs/atomic-write-lib.mjs";
import { checkedHostPath } from "./global-runtime-store.mjs";
import { tomlKeys, tomlLines } from "./global-skills-migration-service.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
const bindingName = "codex-form-binding.json";
const configLimit = 1024 * 1024;
const optional = (file, maxBytes, json = false) => readAgentRunFile(file, { optional: true, maxBytes, json });
const within = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === "" || !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep);
};
const sameScope = (left, right) => left.project_id === right.project_id && left.runtime_scope_id === right.runtime_scope_id;

function registeredConfig(text, { name, command, args }) {
  let section = [], found = false;
  const fields = [];
  for (const { code } of tomlLines(text)) {
    const header = /^(\[\[?)(.*?)(\]\]?)$/u.exec(code);
    if (header) {
      section = tomlKeys(header[2]);
      if (section[0] === "mcp_servers" && section[1] === name) {
        if (found || section.length !== 2 || header[1] !== "[" || header[3] !== "]") fail("CODEX_FORM_REGISTRATION_CONFLICT");
        found = true;
      }
    } else if (code) {
      if (section[0] === "mcp_servers" && section[1] === name) fields.push(code);
      const assignment = /^((?:[^="']|"(?:[^"\\]|\\.)*"|'[^']*')+)\s*=/u.exec(code);
      if (assignment && section.length <= 1) {
        const key = [...section, ...tomlKeys(assignment[1])];
        if (key[0] === "mcp_servers" && (key.length === 1 || key[1] === name)) fail("CODEX_FORM_REGISTRATION_CONFLICT");
      }
    }
  }
  const desired = [
    "command = " + JSON.stringify(command),
    "args = " + JSON.stringify(args),
    "startup_timeout_sec = 30",
    "tool_timeout_sec = 600",
  ];
  if (found) {
    const managed = fields.filter(field => !/^enabled\s*=\s*(?:true|false)$/u.test(field));
    if (managed.length !== desired.length || fields.length - managed.length > 1 || !desired.every(field => managed.includes(field))) fail("CODEX_FORM_REGISTRATION_CONFLICT");
    return text;
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return [text, text && (text.endsWith("\n") ? eol : eol + eol), "[mcp_servers." + name + "]", eol,
    desired.join(eol), eol].join("");
}

export function prepareStandardCodexRegistration({ targetRoot, configuration, repoRoot, globalHome, approvedAuthorization, environment = process.env }) {
  if (process.platform !== "win32") fail("CODEX_DESKTOP_FORM_CLIENT_UNAVAILABLE");
  if (!path.isAbsolute(environment.AIDN_STANDARD_HOST_HOME ?? "")) fail("STANDARD_HOST_HOME_REQUIRED");
  const home = agentRunPhysicalPath(environment.AIDN_STANDARD_HOST_HOME, { directory: true });
  const config = readAgentRunFile(path.resolve(configuration), { maxBytes: 262144 });
  const request = config.value;
  if (request.windows_operator_authority_sha256 || !path.isAbsolute(request.execution?.target_root ?? "")) fail("CODEX_FORM_CONFIGURATION_INVALID");
  const root = agentRunPhysicalPath(request.execution.target_root, { directory: true });
  if (within(root, home) || within(home, root) || within(root, config.path) || within(targetRoot, config.path))
    fail("CODEX_FORM_CONFIGURATION_NOT_PROTECTED");
  if (![home, path.dirname(config.path)].every(dir => request.execution.native?.protected_roots?.some(base => path.isAbsolute(base) && within(base, dir))))
    fail("CODEX_FORM_CONFIGURATION_NOT_PROTECTED");
  const scope = resolveRuntimeProjectContext({ targetRoot, env: environment });
  if (!sameScope(scope, resolveRuntimeProjectContext({ targetRoot: root, env: environment }))) fail("STANDARD_AUTHORIZATION_SCOPE_CHANGED");
  const approval = approvedAuthorization ?? readStandardProjectAuthorization({ home, targetRoot, environment })?.current;
  const principals = approval?.principals.filter(row => row.codex_form &&
    (!environment.CODEX_THREAD_ID || row.codex_form.thread_id === environment.CODEX_THREAD_ID)) ?? [];
  if (!approval || !sameScope(approval, scope) || principals.length !== 1) fail("CODEX_FORM_INSTALLATION_ISSUER_REQUIRED");
  const [principal] = principals;
  const persistence = resolveEffectiveRuntimePersistence({ targetRoot: root, env: environment });
  const connection = persistence.backend === "postgres" ? /^env:([A-Za-z_][A-Za-z_0-9]*)$/.exec(persistence.connectionRef ?? "")?.[1] : null;
  const binding = { schema_version: 1, target_root: root, configuration: config.path, configuration_sha256: config.sha256,
    authority_id: principal.authority_id, connection_env: connection ?? null };
  const bindingFile = path.join(home, bindingName);
  const codexHome = checkedHostPath(environment.CODEX_HOME || path.join(os.homedir(), ".codex"));
  if (within(targetRoot, codexHome) || within(root, codexHome)) fail("CODEX_FORM_CONFIGURATION_NOT_PROTECTED");
  const name = "aidn_form_" + shadowHash({ scope: scope.runtime_scope_id, home }).slice(0, 16);
  const command = checkedHostPath(process.execPath);
  const args = globalHome
    ? [checkedHostPath(path.join(globalHome, "bin/global-launcher.mjs")), "__aidn-codex-form", bindingFile]
    : [checkedHostPath(path.join(repoRoot, "tools/runtime/standard-codex-decisions.mjs")), "--managed-form", bindingFile];
  const file = path.join(codexHome, "config.toml");
  const before = optional(file, configLimit);
  const text = before?.value.toString("utf8") ?? "";
  if (before && !before.value.equals(Buffer.from(text))) fail("CODEX_FORM_CODEX_CONFIG_INVALID");
  const plan = { home, file, binding, name, command, args, scope, authority_sha256: shadowHash(approval), before_sha256: before?.sha256 ?? null,
    binding_before_sha256: optional(bindingFile, 8192)?.sha256 ?? null };
  registeredConfig(text, plan);
  return plan;
}

export function applyStandardCodexRegistration({ plan, targetRoot, environment = process.env }) {
  const { home, file, binding } = plan;
  const state = readStandardProjectAuthorization({ home, targetRoot, environment });
  const issuer = state?.current?.principals.find(row => row.authority_id === binding.authority_id && row.codex_form);
  if (!issuer || !sameScope(state.scope, plan.scope) || state.current_sha256 !== plan.authority_sha256)
    fail("CODEX_FORM_INSTALLATION_ISSUER_REQUIRED");
  readAgentRunFile(binding.configuration, { sha256: binding.configuration_sha256, maxBytes: 262144 });
  const bindingFile = path.join(home, bindingName);
  const lock = checkedHostPath(path.join(path.dirname(file), ".aidn-form-install.lock"));
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  let fd;
  try { fd = fs.openSync(lock, "wx", 0o600); }
  catch (error) { if (error.code === "EEXIST") fail("CODEX_FORM_INSTALLATION_BUSY"); throw error; }
  try {
    const current = optional(file, configLimit);
    const before = current?.value.toString("utf8") ?? "";
    if (current && !current.value.equals(Buffer.from(before))) fail("CODEX_FORM_CODEX_CONFIG_INVALID");
    const next = registeredConfig(before, plan);
    if (next !== before && (current?.sha256 ?? null) !== plan.before_sha256) fail("CODEX_FORM_CODEX_CONFIG_CHANGED");
    const previous = optional(bindingFile, 8192, true);
    if (!previous || shadowHash(previous.value) !== shadowHash(binding)) {
      if ((previous?.sha256 ?? null) !== plan.binding_before_sha256) fail("CODEX_FORM_BINDING_CHANGED");
      writeFileAtomicSync(bindingFile, JSON.stringify(binding) + "\n", { mode: 0o600 });
    }
    if (next !== before) writeFileAtomicSync(file, next, { mode: 0o600 });
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

