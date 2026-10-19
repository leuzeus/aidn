import fs from "node:fs";
import readline from "node:readline";
import { spawn } from "node:child_process";

export function nativeProbeRootSettings(text) {
  const root = String(text).split(/^\[/m)[0];
  // Never silently switch a configured profile/custom provider to built-in
  // OpenAI while preparing this deliberately narrow account-based qualifier.
  if (/^(profile|config_profile)\s*=/m.test(root)
      || /^model_provider\s*=/m.test(root) && !/^model_provider\s*=\s*["']openai["']\s*(?:#.*)?$/m.test(root))
    throw new Error("NATIVE_PROBE_PROFILE_OR_PROVIDER_NOT_SUPPORTED");
  return root.split(/\r?\n/).filter(line => /^(model|model_reasoning_effort|model_reasoning_summary|service_tier)\s*=/.test(line)).join("\n");
}

export function nativeProbeThreadParams(params, reviewedTestHooks = false) {
  if (typeof reviewedTestHooks !== "boolean") throw new Error("NATIVE_PROBE_REVIEWED_HOOK_INTENT_REQUIRED");
  const value = structuredClone(params);
  if (!reviewedTestHooks && value.config?.bypass_hook_trust === true)
    throw new Error("NATIVE_PROBE_REVIEWED_HOOK_INTENT_REQUIRED");
  if (reviewedTestHooks) value.config = { ...value.config, bypass_hook_trust: true };
  return value;
}

export function isNativeTurnCompletion(event, threadId, turnId) {
  return typeof turnId === "string" && turnId.length > 0 && event?.method === "turn/completed"
    && event.params?.threadId === threadId && event.params?.turn?.id === turnId;
}

// Native test transport: no permission escalation, no fallback tools and no
// automatic retry of a model turn or a potentially dispatched window request.
export function createContextNativeProbeClient({ binary, home, cwd, evidenceFile, onToolCall, reviewedTestHooks = false }) {
  // App-server does not forward the TUI's process-level hook flag. Its own
  // official exec client uses a typed per-thread override instead. Only the
  // explicit, reviewed test mode can forward that same invocation-local intent.
  const child = spawn(binary, ["app-server", "--listen", "stdio://"], { cwd,
    env: { ...process.env, CODEX_HOME: home }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let nextId = 0, stopped = false;
  const pending = new Map(), events = [], waiters = new Set();
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
      send({ id: message.id, result: { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(result) }] } });
    } catch {
      send({ id: message.id, result: { success: false, contentItems: [{ type: "inputText", text: "QUALIFICATION_TOOL_REFUSED" }] } });
    }
  });
  return {
    events,
    notify(method, params = {}) { send({ method, params }); },
    request(method, params, timeout = 120000) {
      if (["thread/start", "thread/resume"].includes(method)) params = nativeProbeThreadParams(params, reviewedTestHooks);
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
