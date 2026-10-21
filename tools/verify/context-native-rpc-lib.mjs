import fs from "node:fs";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

// This is an invocation-local research transport, not a user config change or
// a tokenizer estimate. Bytes and native history tokens are separate bounds.
export const NATIVE_CONTEXT_OUTPUT_POLICY = Object.freeze({
  id: "bounded-context.v1", history_token_limit: 60000,
  suggested_exec_output_tokens: 60000, max_dynamic_tool_json_bytes: 131072,
});

function outputPolicy(profile) {
  if (profile === null) return null; // Explicit historical negative control.
  if (profile !== NATIVE_CONTEXT_OUTPUT_POLICY.id) throw new Error("NATIVE_PROBE_OUTPUT_PROFILE_UNSUPPORTED");
  return NATIVE_CONTEXT_OUTPUT_POLICY;
}

export function nativeProbeOutputInstructions(profile = NATIVE_CONTEXT_OUTPUT_POLICY.id) {
  const policy = outputPolicy(profile);
  return policy ? `Native output profile ${policy.id}: history capacity is invocation-local. For code-mode exec printing tool data, use // @exec: {"max_output_tokens":${policy.suggested_exec_output_tokens}} and print each actual result once. A transport refusal or clipped required body keeps dependent work readonly. Inspect the retained outcome and retrieve complete missing units in bounded official readonly calls; never repeat an action because its output failed. Increasing a limit does not restore content clipped in an earlier response.` : "";
}

export function nativeProbeRootSettings(text) {
  const root = String(text).split(/^\[/m)[0];
  // Never silently switch a configured profile/custom provider to built-in
  // OpenAI while preparing this deliberately narrow account-based qualifier.
  if (/^(profile|config_profile)\s*=/m.test(root)
      || /^model_provider\s*=/m.test(root) && !/^model_provider\s*=\s*["']openai["']\s*(?:#.*)?$/m.test(root))
    throw new Error("NATIVE_PROBE_PROFILE_OR_PROVIDER_NOT_SUPPORTED");
  return root.split(/\r?\n/).filter(line => /^(model|model_reasoning_effort|model_reasoning_summary|service_tier)\s*=/.test(line)).join("\n");
}

export function nativeProbeThreadParams(params, reviewedTestHooks = false, outputProfile = NATIVE_CONTEXT_OUTPUT_POLICY.id) {
  if (typeof reviewedTestHooks !== "boolean") throw new Error("NATIVE_PROBE_REVIEWED_HOOK_INTENT_REQUIRED");
  const policy = outputPolicy(outputProfile);
  const value = structuredClone(params);
  if (!reviewedTestHooks && value.config?.bypass_hook_trust === true)
    throw new Error("NATIVE_PROBE_REVIEWED_HOOK_INTENT_REQUIRED");
  if (reviewedTestHooks) value.config = { ...value.config, bypass_hook_trust: true };
  if (policy) {
    if (value.config != null && (typeof value.config !== "object" || Array.isArray(value.config)))
      throw new Error("NATIVE_PROBE_OUTPUT_CONFIG_INVALID");
    if (value.config?.tool_output_token_limit !== undefined && value.config.tool_output_token_limit !== policy.history_token_limit)
      throw new Error("NATIVE_PROBE_OUTPUT_PROFILE_CONFLICT");
    value.config = { ...value.config, tool_output_token_limit: policy.history_token_limit };
    // Do not replace inherited developer instructions on resume. Enrich only
    // the caller's explicit text, and keep the shared prefix once.
    const instructions = nativeProbeOutputInstructions(outputProfile);
    if (typeof value.developerInstructions === "string" && !value.developerInstructions.includes(instructions))
      value.developerInstructions += `\n\n${instructions}`;
  }
  return value;
}

export function nativeProbeToolResponse(result, outputProfile = NATIVE_CONTEXT_OUTPUT_POLICY.id) {
  const policy = outputPolicy(outputProfile);
  let text;
  try { text = JSON.stringify(result); } catch { /* Return a bounded transport failure, without source data. */ }
  const bytes = typeof text === "string" ? Buffer.byteLength(text) : null;
  const reason = bytes === null ? "NATIVE_PROBE_TOOL_OUTPUT_UNSERIALIZABLE"
    : policy && bytes > policy.max_dynamic_tool_json_bytes ? "NATIVE_PROBE_TOOL_OUTPUT_BYTES_EXCEEDED" : null;
  const observation = { output_profile: policy?.id ?? null, status: reason ? "refused" : "sent",
    reason, json_bytes: bytes, sha256: bytes === null ? null : createHash("sha256").update(text).digest("hex"),
    max_dynamic_tool_json_bytes: policy?.max_dynamic_tool_json_bytes ?? null,
    requested_history_token_limit: policy?.history_token_limit ?? null,
    provider_body_residency: "UNAVAILABLE", write_authorization: false };
  if (reason) text = JSON.stringify({ ok: false, error: reason, json_bytes: bytes,
    max_dynamic_tool_json_bytes: policy?.max_dynamic_tool_json_bytes ?? null,
    action_may_have_executed: true, retry_authorized: false, write_authorization: false,
    next_action: "Inspect the retained authoritative outcome. Retrieve required complete units in bounded readonly calls; never retry an action from this transport refusal." });
  return { response: { success: !reason, contentItems: [{ type: "inputText", text }] }, observation };
}

export function isNativeTurnCompletion(event, threadId, turnId) {
  return typeof turnId === "string" && turnId.length > 0 && event?.method === "turn/completed"
    && event.params?.threadId === threadId && event.params?.turn?.id === turnId;
}

// Native test transport: no permission escalation, no fallback tools and no
// automatic retry of a model turn or a potentially dispatched window request.
export function createContextNativeProbeClient({ binary, home, cwd, evidenceFile, onToolCall, reviewedTestHooks = false,
  outputProfile = NATIVE_CONTEXT_OUTPUT_POLICY.id }) {
  const policy = outputPolicy(outputProfile);
  // App-server does not forward the TUI's process-level hook flag. Its own
  // official exec client uses a typed per-thread override instead. Only the
  // explicit, reviewed test mode can forward that same invocation-local intent.
  const child = spawn(binary, ["app-server", "--listen", "stdio://"], { cwd,
    env: { ...process.env, CODEX_HOME: home }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let nextId = 0, stopped = false;
  const pending = new Map(), events = [], waiters = new Set(), outputObservations = [];
  const send = message => child.stdin.write(JSON.stringify(message) + "\n");
  const failPending = error => {
    for (const value of pending.values()) { clearTimeout(value.timer); value.reject(error); }
    pending.clear();
    for (const value of waiters) { clearTimeout(value.timer); value.reject(error); }
    waiters.clear();
  };
  const lines = readline.createInterface({ input: child.stdout });
  child.stderr.on("data", () => {}); // Raw runtime diagnostics may contain account details.
  child.once("error", failPending);
  child.once("close", code => { if (!stopped) failPending(new Error(`NATIVE_PROBE_EXIT_${code}`)); });
  lines.on("line", async line => {
    let message; try { message = JSON.parse(line); } catch { return; }
    if (message.id != null && !message.method) {
      const entry = pending.get(message.id); if (!entry) return;
      pending.delete(message.id); clearTimeout(entry.timer);
      if (message.error) entry.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
      else entry.resolve(message.result);
      return;
    }
    events.push(message);
    if (evidenceFile) fs.appendFileSync(evidenceFile, JSON.stringify(message) + "\n");
    for (const entry of waiters) if (entry.predicate(message)) { waiters.delete(entry); clearTimeout(entry.timer); entry.resolve(message); }
    if (message.id == null) return;
    if (message.method !== "item/tool/call" || !onToolCall) {
      send({ id: message.id, error: { code: -32601, message: "Qualification refuses unexpected request" } }); return;
    }
    try {
      const result = await onToolCall(message.params);
      const encoded = nativeProbeToolResponse(result, outputProfile);
      outputObservations.push({ thread_id: message.params.threadId, turn_id: message.params.turnId ?? null,
        call_id: message.params.callId ?? null, ...encoded.observation });
      send({ id: message.id, result: encoded.response });
    } catch {
      send({ id: message.id, result: { success: false, contentItems: [{ type: "inputText", text: "QUALIFICATION_TOOL_REFUSED" }] } });
    }
  });
  return {
    events,
    get outputPolicy() { return policy ? { ...policy } : null; },
    get outputObservations() { return structuredClone(outputObservations); },
    notify(method, params = {}) { send({ method, params }); },
    request(method, params, timeout = 120000) {
      if (["thread/start", "thread/resume"].includes(method)) params = nativeProbeThreadParams(params, reviewedTestHooks, outputProfile);
      return new Promise((resolve, reject) => {
        const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`NATIVE_PROBE_TIMEOUT_${method}`)); }, timeout);
        pending.set(id, { resolve, reject, timer }); send({ id, method, params });
      });
    },
    wait(predicate, after = 0, timeout = 120000) {
      const existing = events.slice(after).find(predicate); if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const entry = { predicate, resolve, reject, timer: null };
        entry.timer = setTimeout(() => { waiters.delete(entry); reject(new Error("NATIVE_PROBE_EVENT_TIMEOUT")); }, timeout);
        waiters.add(entry);
      });
    },
    async close() {
      stopped = true; failPending(new Error("NATIVE_PROBE_CLOSED")); lines.close(); child.stdin.end();
      if (child.exitCode !== null || child.signalCode !== null) return;
      const closed = new Promise(resolve => child.once("close", resolve)); child.kill();
      await Promise.race([closed, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("NATIVE_PROBE_STOP_UNCONFIRMED")), 5000); timer.unref(); })]);
    },
  };
}
