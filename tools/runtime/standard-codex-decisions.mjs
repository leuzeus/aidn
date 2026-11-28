#!/usr/bin/env node
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createStandardOperatorSession } from "../../src/adapters/workflow-console/standard-operator-session.mjs";
import { createCodexDecisionChannel } from "../../src/adapters/workflow-console/codex-decision-channel.mjs";
import { bindOperatorChat, codexMessageSelectorSchema } from "../../src/adapters/workflow-console/codex-message-recovery.mjs";
import { loadWindowsCodexFormIssuer } from "../../src/adapters/workflow-console/windows-codex-form-issuer.mjs";
import { readAgentRunFile } from "../../src/application/runtime/agent-run-configuration-service.mjs";
import { parseEnv } from "node:util";

const noArgs = { type: "object", properties: {}, additionalProperties: false };
const baseMethods = [
  { name: "session", description: "Read the AIDN operator channel enrollment and last host receipt.", inputSchema: noArgs, annotations: { readOnlyHint: true } },
  { name: "question", description: "Read the exact pending STANDARD question in this project.", inputSchema: noArgs, annotations: { readOnlyHint: true } },
  { name: "ask", description: "Present the pending AIDN question as a native Codex form and deliver its linked result. When review_ready is returned, display its document links in the chat before calling ask again. Preparing review copies consumes no Human decision.", inputSchema: noArgs },
];
const safeError = err => /^[A-Z][A-Z_0-9]{0,100}$/.test(err?.message) ? err.message : "CODEX_DECISION_UNAVAILABLE";
const maxLine = 524288;
export async function serveCodexDecisions({ session, formIssuer, useChannel, input = process.stdin, output = process.stdout }) {
  const methods = session?.recoverMessage ? [...baseMethods, {
    name: "recover_message", description: "Recover an already attested Codex message for one pending AIDN operation, or read its existing receipt. Never presents a form.",
    inputSchema: codexMessageSelectorSchema,
  }] : baseMethods;
  let started = false, initialized = false, form = false, pending = null;
  const calls = new Set();
  const send = obj => output.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\n");
  function elicit(params, callId) {
    if (pending) throw Error("CODEX_DECISION_IN_PROGRESS");
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      pending = { id, callId, resolve, reject };
      send({ id, method: "elicitation/create", params });
    });
  }
  let activeCall = null;
  const transport = { elicit: params => elicit(params, activeCall), formSupported: () => form };
  const channel = session && createCodexDecisionChannel({ session, formIssuer, ...transport });
  async function dispatch(m) {
    if (m.method === "initialize" && !started) {
      started = true;
      const capabilities = m.params?.capabilities?.elicitation;
      form = Boolean(capabilities && (Object.hasOwn(capabilities, "form") || Object.keys(capabilities).length === 0));
      const versions = ["2025-11-25", "2025-06-18"];
      const protocolVersion = versions.includes(m.params?.protocolVersion) ? m.params.protocolVersion : versions[0];
      return { protocolVersion, serverInfo: { name: "aidn-decisions", version: "1.0.0" }, capabilities: { tools: {} } };
    }
    if (m.method === "ping") return {};
    if (!initialized) throw Error("MCP_INITIALIZATION_REQUIRED");
    if (m.method === "tools/list") return { tools: methods };
    if (m.method === "resources/list") return { resources: [] };
    if (m.method === "resources/templates/list") return { resourceTemplates: [] };
    if (m.method === "prompts/list") return { prompts: [] };
    if (m.method !== "tools/call") throw Error("MCP_METHOD_UNAVAILABLE");
    const { name, arguments: args = {}, _meta: meta } = m.params ?? {};
    if (!methods.some(t => t.name === name) || !args || typeof args !== "object" || Array.isArray(args) || name !== "recover_message" && Object.keys(args).length)
      throw Error("MCP_ARGUMENTS_REFUSED");
    const delivery = name === "ask" || name === "recover_message";
    if (delivery && activeCall !== null) throw Error("CODEX_DECISION_IN_PROGRESS");
    if (delivery) activeCall = m.id;
    try {
      const handle = source => name === "ask" ? source.decide(meta)
        : name === "question" ? source.present(meta) : source.describe(meta);
      const data = name === "recover_message" ? await session.recoverMessage(args)
        : await (useChannel ? useChannel(transport, handle) : handle(channel));
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    } catch (err) { return { isError: true, content: [{ type: "text", text: safeError(err) }] }; }
    finally { if (delivery) activeCall = null; }
  }
  function closePending(code) {
    const request = pending;
    pending = null;
    request?.reject(Error(code));
  }
  function message(m) {
    if (!m || typeof m !== "object" || m.jsonrpc !== "2.0") return;
    if (!Object.hasOwn(m, "method")) {
      if (!pending || m.id !== pending.id) return;
      const request = pending;
      pending = null;
      if (m.error) request.reject(Error("CODEX_FORM_UNAVAILABLE"));
      else request.resolve({ ...m.result, request_id: request.id });
      return;
    }
    if (!Object.hasOwn(m, "id")) {
      if (m.method === "notifications/initialized" && started) initialized = true;
      if (m.method === "notifications/cancelled" && pending?.callId === m.params?.requestId) closePending("CODEX_DECISION_CANCELLED");
      return;
    }
    if (!["string", "number"].includes(typeof m.id) || calls.has(m.id)) return;
    calls.add(m.id);
    dispatch(m).then(result => send({ id: m.id, result }), err => send({ id: m.id, error: { code: -32602, message: safeError(err) } }))
      .finally(() => calls.delete(m.id));
  }
  let buffer = "";
  input.setEncoding("utf8");
  try {
    for await (const chunk of input) {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length > maxLine) throw Error("MCP_MESSAGE_LIMIT");
        if (line) message(JSON.parse(line));
      }
      if (buffer.length > maxLine) throw Error("MCP_MESSAGE_LIMIT");
    }
  } finally { closePending("CODEX_DECISION_CHANNEL_CLOSED"); }
}
export async function launchCodexDecisions({ targetRoot, configuration, operatorChat, formAuthority, environment = process.env }) {
  const session = createStandardOperatorSession({ targetRoot, configuration, operatorChat, environment });
  const formIssuer = formAuthority === undefined ? undefined : loadWindowsCodexFormIssuer({
    authorityId: formAuthority, principals: session.session().principals, home: environment.AIDN_STANDARD_HOST_HOME,
  });
  return serveCodexDecisions({ session, formIssuer });
}

// STANDARD includes stores that obtain their environment from the host
// process. This stdio process serves one installed binding throughout its
// lifetime, so its database reference is available to those stores as well.
export function loadManagedCodexDatabaseEnvironment(home, name) {
  if (!name) return;
  if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(name)) throw Error("CODEX_FORM_BINDING_INVALID");
  const file = readAgentRunFile(path.join(home, "codex-form-database.env"), { json: false, optional: true, maxBytes: 16384 });
  if (!file) return;
  const values = parseEnv(file.value.toString("utf8"));
  if (Object.keys(values).length !== 1 || !Object.hasOwn(values, name)) throw Error("CODEX_FORM_DATABASE_ENV_INVALID");
  process.env[name] = values[name];
}

export function openManagedCodexForm(bindingFile, transport) {
  const binding = readAgentRunFile(bindingFile, { maxBytes: 8192 }).value;
  if (binding.schema_version !== 1 || !path.isAbsolute(binding.target_root ?? "") || !path.isAbsolute(binding.configuration ?? "")
    || !/^[a-f0-9]{64}$/.test(binding.configuration_sha256 ?? "")) throw Error("CODEX_FORM_BINDING_INVALID");
  const home = path.dirname(bindingFile);
  readAgentRunFile(binding.configuration, { sha256: binding.configuration_sha256, maxBytes: 262144 });
  loadManagedCodexDatabaseEnvironment(home, binding.connection_env);
  const environment = { ...process.env, AIDN_STANDARD_HOST_HOME: home };
  const session = createStandardOperatorSession({ targetRoot: binding.target_root, configuration: binding.configuration, environment });
  const formIssuer = loadWindowsCodexFormIssuer({ authorityId: binding.authority_id, principals: session.session().principals, home });
  return createCodexDecisionChannel({ session, formIssuer, ...transport });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [intent, targetRoot, configuration, ...rest] = process.argv.slice(2);
  if (intent === "--managed-form" && path.isAbsolute(targetRoot ?? "") && configuration === undefined) {
    await serveCodexDecisions({ useChannel: (transport, handle) => handle(openManagedCodexForm(targetRoot, transport)) });
  } else {
    const chat = rest.length === 3 && rest[0] === "--chat";
    const installedForm = rest.length === 2 && rest[0] === "--form-issuer";
    if (intent !== "--serve" || !targetRoot || !configuration || rest.length && !chat && !installedForm)
      throw Error("AIDN_CODEX_PROJECT_CONFIGURATION_REQUIRED");
    await launchCodexDecisions({ targetRoot: path.resolve(targetRoot), configuration,
      operatorChat: chat ? bindOperatorChat(rest[1], rest[2]) : undefined, formAuthority: installedForm ? rest[1] : undefined });
  }
}
