import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { createAgenticCodexRpc } from "./agentic-codex-rpc.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { processFail as fail } from "../../core/workflow/agentic-process-model.mjs";
import { buildCodexStartupArguments, createCodexHostEnvironment } from "../../core/agents/codex-startup-arguments.mjs";

// Called only inside the owned worker. Tests replace the wire, not the host's
// assignment/result authorities. Native policy acceptance remains fail-closed.
export function createAgenticCodexSessions({ native, targetRoot, productRoot, controlRoot, evidence, budget,
  governanceEnvironment = {}, rpcFactory = createAgenticCodexRpc }) {
  let serial = 0;
  const clients = new Set(), usageByThread = new Map();
  return Object.freeze({
    metrics() { return { thread_counters: [...usageByThread.values()].map(row => structuredClone(row)),
      aggregation: "latest observed cumulative snapshot per thread; not a billed total", incomplete_turns_may_be_unknown: true }; },
    async close() { let closed = true; for (const rpc of clients) try { if ((await rpc.close()).closed !== true) closed = false; } catch { closed = false; }
      return { closed }; },
    async open({ role, policy, input, deadline }) {
    const index = ++serial, review = policy.independent_review || policy.context_isolation_required;
    const cwd = review ? input.review_root : productRoot;
    if (!path.isAbsolute(cwd ?? "") || cwd === controlRoot) fail("PROCESS_SESSION_WORKSPACE_INVALID");
    if (policy.allowed_permissions.some(permission => !["read:product", "write:product"].includes(permission))
      || !policy.allowed_permissions.includes("read:product") || review && policy.allowed_permissions.includes("write:product")) fail("PROCESS_SESSION_PERMISSION_UNSUPPORTED");
    const writable = policy.allowed_permissions.includes("write:product");
    const toolTemp = writable ? path.join(productRoot, "tmp") : controlRoot;
    if (writable) {
      fs.mkdirSync(toolTemp, { recursive: true });
      const stat = fs.lstatSync(toolTemp);
      if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(toolTemp) !== toolTemp) fail("PROCESS_SESSION_TEMP_INVALID");
    }
    const profileId = `aidn_agentic_${index}`, sandbox = writable ? "workspaceWrite" : "readOnly";
    const permissionProfile = buildAgenticNativePermissionProfile({ native, targetRoot, productRoot, controlRoot, cwd, writable, review });
    const developer = input.developer_instructions;
    const sessionId = `context-${randomUUID()}`; // host-owned context identity, never an alias inferred from a native ID
    let threadId = null, nativeSessionId = null, binding = null, closed = false, active = null, wireFailure = null;
    const context = [shadowHash(developer)];
    const expectedConfig = { profileId, permissionProfile, model: native.model, effort: native.effort };
    const args = [...buildCodexStartupArguments({ ...native.startup, log_dir: path.join(controlRoot, `native-${index}-logs`),
      sqlite_home: path.join(controlRoot, `native-${index}-sqlite`) }),
      "-c", `permissions.${profileId}=${toml(permissionProfile)}`, "-c", 'approval_policy="never"',
      "-c", 'windows.sandbox="elevated"', "-c", "features.hooks=true", "-c", "features.multi_agent=false", "-c", "agents.enabled=false", "-c", "project_doc_max_bytes=0",
      "-c", `model=${JSON.stringify(native.model)}`, "-c", `model_reasoning_effort=${JSON.stringify(native.effort)}`,
      "app-server", "--listen", "stdio://"];
    async function notification(message) {
      const p = message.params ?? {};
      if (!["rawResponse/completed", "thread/tokenUsage/updated", "turn/completed", "item/completed"].includes(message.method)) return;
      if (!active) { if (threadId && (p.turnId || p.turn?.id)) fail("PROCESS_SESSION_EVENT_OUT_OF_ORDER"); return; }
      if (p.threadId !== threadId) fail("PROCESS_SESSION_FOREIGN_THREAD");
      if (!active.turnId) { if (active.pending.length >= 64) fail("PROCESS_SESSION_EVENT_LIMIT"); active.pending.push(message); return; }
      const turnId = p.turnId ?? p.turn?.id;
      if (turnId !== active.turnId) fail("PROCESS_SESSION_FOREIGN_TURN");
      if (active.terminal) fail("PROCESS_SESSION_EVENT_AFTER_COMPLETION");
      if (message.method === "rawResponse/completed") {
        if (typeof p.responseId !== "string" || !p.responseId) fail("PROCESS_SESSION_RESPONSE_ID_MISSING");
        budget.response(threadId, p.responseId);
      } else if (message.method === "thread/tokenUsage/updated") {
        const valid = row => row && ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens", "totalTokens"]
          .every(key => Number.isSafeInteger(row[key]) && row[key] >= 0);
        if (!valid(p.tokenUsage?.total) || !valid(p.tokenUsage?.last)) fail("PROCESS_SESSION_USAGE_INVALID");
        active.usage = p.tokenUsage; // native counters, never inferred zero
        usageByThread.set(threadId, { thread_id: threadId, turn_id: turnId, native_usage: structuredClone(p.tokenUsage) });
        await evidence.retain("native-usage", usageByThread.get(threadId));
      } else if (message.method === "item/completed" && p.item?.type === "agentMessage") {
        if (typeof p.item.text !== "string" || Buffer.byteLength(p.item.text) > 65536) fail("PROCESS_SESSION_ANSWER_LIMIT");
        if (![null, undefined, "commentary", "partial_answer", "final_answer"].includes(p.item.phase)) fail("PROCESS_SESSION_PHASE_UNKNOWN");
        if (p.item.phase === "final_answer" || p.item.phase == null) active.answers.push({ text: p.item.text, phase: p.item.phase ?? null });
      } else if (message.method === "turn/completed") {
        active.terminal = true;
        if (p.turn?.status !== "completed") { active.reject(Object.assign(Error("PROCESS_SESSION_TURN_FAILED"), { code: "PROCESS_SESSION_TURN_FAILED" })); return; }
        active.resolve();
      }
    }
    const rpc = rpcFactory({ executable: native.executable, sha256: native.sha256, args, cwd,
      // The trusted native parent invokes pinned admission hooks. Its shell
      // filter below admits OS/bootstrap names only, never database credentials.
      // Independent review has neither those credentials nor the author home.
      env: { ...createCodexHostEnvironment(), ...(!review ? governanceEnvironment : {}), CODEX_HOME: native.home, TEMP: toolTemp, TMP: toolTemp }, deadline,
      notificationMethods: ["rawResponse/completed", "thread/tokenUsage/updated", "turn/completed", "item/completed"],
      onNotification: notification, onFailure: error => { wireFailure ??= error; active?.reject(error); },
      diagnostic: record => evidence.diagnostic(record), maxBytes: budget.remainingBytes() });
    clients.add(rpc);
    async function observe() {
      if (closed || !threadId) fail("PROCESS_SESSION_NOT_OPEN");
      if (wireFailure) throw wireFailure;
      const cfg = await rpc.request("config/read", { cwd, includeLayers: false });
      const c = cfg?.config;
      if (c?.model !== native.model || c?.model_reasoning_effort !== native.effort || c?.approval_policy !== "never"
        || c?.memories?.use_memories !== false || c?.features?.memories !== false
        || shadowHash(normalizePermissionProfile(c?.permissions?.[profileId] ?? null)) !== shadowHash(permissionProfile)
        || c?.features?.plugins !== false || c?.features?.apps !== false || c?.features?.hooks !== true || c?.features?.multi_agent !== false || c?.agents?.enabled !== false
        || c?.history?.persistence !== "none" || c?.memories?.generate_memories !== false || c?.model_provider !== "openai"
        || c?.project_doc_max_bytes !== 0 || c?.instructions !== "" || c?.developer_instructions !== ""
        || c?.log_dir !== path.join(controlRoot, `native-${index}-logs`) || c?.sqlite_home !== path.join(controlRoot, `native-${index}-sqlite`)
        || c?.model_providers?.openai || c?.openai_base_url || c?.auth_command) fail("PROCESS_SESSION_EFFECTIVE_PROFILE_CHANGED");
      for (const [key, expected] of [["mcp_servers", native.startup.mcp_server_ids], ["plugins", native.startup.plugin_ids], ["apps", ["_default", ...native.startup.app_ids]]]) {
        if (!c[key] || shadowHash(Object.keys(c[key]).sort()) !== shadowHash([...expected].sort())
          || Object.values(c[key]).some(row => row?.enabled !== false)) fail("PROCESS_SESSION_INTEGRATION_CHANGED");
      }
      const environment = c.shell_environment_policy;
      if (!environment || environment.inherit !== "all" || environment.ignore_default_excludes !== true
        || shadowHash(environment.filters) !== shadowHash(Object.fromEntries(native.startup.environment_names.map(name => [name, "include"])))
        || shadowHash(environment.set) !== shadowHash(Object.fromEntries(native.startup.environment_override_names.map(name => [name, ""])))
        || [environment.include_only, environment.exclude].some(list => list != null && (!Array.isArray(list) || list.length))) fail("PROCESS_SESSION_ENVIRONMENT_CHANGED");
      return { session_id: sessionId, binding_sha256: binding, closed: false, permissions: [...policy.allowed_permissions],
        guarantees: review ? ["context-isolated", "protected-verdict"] : [], context_sha256: [...context], skills: [...role.skills] };
    }
    try {
      // A 20 s initialize timed out; a longer-ceiling metadata probe completed
      // in 45 s overall. This clips to the original deadline in the RPC layer.
      await rpc.request("initialize", { clientInfo: { name: "aidn-agentic-process", version: "1" }, capabilities: { experimentalApi: true } }, 90000);
      rpc.notify("initialized", {});
      const readiness = await rpc.request("windowsSandbox/readiness", null);
      if (readiness?.status !== "ready") fail("PROCESS_SESSION_SANDBOX_NOT_PREEXISTING");
      const profiles = await rpc.request("permissionProfile/list", { cwd });
      if (!profiles?.data?.some(row => row.id === profileId && row.allowed === true)) fail("PROCESS_SESSION_PERMISSION_PROFILE_UNAVAILABLE");
      const started = await rpc.request("thread/start", { cwd, permissions: profileId, approvalPolicy: "never", model: native.model,
        allowProviderModelFallback: false, ephemeral: true, experimentalRawEvents: true, developerInstructions: developer });
      if (typeof started?.thread?.id !== "string" || started.model !== native.model || started.approvalPolicy !== "never"
        || started.activePermissionProfile?.id !== profileId || started.sandbox?.type !== sandbox
        || started.sandbox?.networkAccess === true) fail("PROCESS_SESSION_NATIVE_POLICY_REFUSED");
      threadId = started.thread.id;
      nativeSessionId = started.thread.sessionId ?? null;
      // The loaded-thread view is authoritative for its selected environments.
      // On the pinned native client the cwd-only inventory can be empty even
      // though the newly loaded thread contains project hooks.
      const hooks = await rpc.request("hooks/list", { threadId });
      const surface = hooks?.data?.find(row => path.resolve(row.cwd) === path.resolve(cwd));
      const expectedHooks = native.hook_hashes[review ? "review" : "work"];
      if (!surface || hooks.data.length !== 1 || surface.errors?.length || surface.warnings?.length
        || !Array.isArray(surface.hooks) || surface.hooks.some(row => row.enabled !== true || row.trustStatus !== "trusted" || row.source !== "project")
        || shadowHash(surface.hooks.map(row => row.currentHash).sort()) !== shadowHash([...expectedHooks].sort())) fail("PROCESS_SESSION_HOOKS_CHANGED");
      if (!review && (surface.hooks.length !== 2 || !["preToolUse", "sessionStart"].every(event => surface.hooks.filter(row => row.eventName === event).length === 1)
        || surface.hooks.some(row => row.handlerType !== "command" || row.async !== false
          || path.resolve(row.sourcePath ?? "") !== path.join(targetRoot, ".codex/hooks.json")))) fail("PROCESS_SESSION_ADMISSION_HOOKS_REQUIRED");
      binding = shadowHash({ sessionId, threadId, nativeSessionId, cwd, sandbox: started.sandbox, active_profile: started.activePermissionProfile,
        native_sha256: native.sha256, config: expectedConfig, developer_sha256: context[0] });
      await observe();
      await evidence.retain("native-session", { host_context_id: sessionId, thread_id: threadId, native_session_id: nativeSessionId, binding_sha256: binding,
        permissions: started.sandbox, profile: profileId, declared_guarantee_scope: "fresh thread, disabled memories and restricted native tool profile; not full-client OS confinement" });
    } catch (error) { await rpc.close(); throw error; }
    return Object.freeze({ observe,
      async run({ instruction, request_sha256, signal }) {
        if (active || closed || signal?.aborted) fail("PROCESS_SESSION_BUSY_OR_CANCELLED");
        await observe();
        let resolve, reject;
        const completion = new Promise((yes, no) => { resolve = yes; reject = no; });
        completion.catch(() => {}); // rejection may precede the turn/start reply
        active = { turnId: null, pending: [], answers: [], usage: null, resolve, reject };
        const turnRemaining = Math.min(budget.maxTurnMs, deadline - Date.now());
        const timer = setTimeout(() => reject(Object.assign(Error("PROCESS_SESSION_DEADLINE"), { code: "PROCESS_SESSION_DEADLINE" })), Math.max(1, turnRemaining));
        const abort = () => reject(Object.assign(Error("PROCESS_SESSION_CANCELLED"), { code: "PROCESS_SESSION_CANCELLED" })); signal?.addEventListener("abort", abort, { once: true });
        try {
          const result = await rpc.request("turn/start", { threadId, effort: native.effort,
            input: [{ type: "text", text: instruction, text_elements: [] }], outputSchema: {
              type: "object", additionalProperties: false, required: ["outcome", "summary"], properties: {
              outcome: { type: "string", enum: ["completed", "failed", "rejected"] }, summary: { type: "string" } } } }, Math.max(1, turnRemaining));
          if (typeof result?.turn?.id !== "string") fail("PROCESS_SESSION_TURN_ID_MISSING");
          active.turnId = result.turn.id;
          for (const event of active.pending.splice(0)) await notification(event);
          await completion; await rpc.flush();
          if (active.answers.length !== 1 || active.usage === null) fail("PROCESS_SESSION_CAPTURE_INCOMPLETE");
          let answer; try { answer = JSON.parse(active.answers[0].text); } catch { fail("PROCESS_SESSION_ANSWER_INVALID"); }
          if (!["completed", "failed", "rejected"].includes(answer?.outcome) || typeof answer.summary !== "string"
            || Object.keys(answer).some(key => !["outcome", "summary"].includes(key))) fail("PROCESS_SESSION_ANSWER_INVALID");
          context.push(shadowHash(instruction));
          const ref = await evidence.retain("native-result", { thread_id: threadId, turn_id: active.turnId,
            request_sha256, binding_sha256: binding, answer, native_usage: active.usage,
            usage_scope: "native thread counters; cumulative snapshots are not summed" });
          return { session_id: sessionId, binding_sha256: binding, outcome: answer.outcome, evidence_refs: [ref] };
        } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); active = null; }
      },
      async close() { closed = true; return rpc.close(); },
    });
  } });
}

function toml(value) {
  if (value && typeof value === "object") return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}=${toml(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

// config/read serializes typed optional fields as null. Treat only these
// observed schema fields as omitted defaults; never strip unknown/non-null
// policy values or weaken the comparison of effective permissions.
export function normalizePermissionProfile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const result = structuredClone(value);
  const removeNull = (object, names) => { if (object && typeof object === "object") for (const name of names) if (object[name] === null) delete object[name]; };
  removeNull(result, ["description", "workspace_roots"]);
  removeNull(result.filesystem, ["glob_scan_max_depth"]);
  removeNull(result.network, ["proxy_url", "enable_socks5", "socks_url", "enable_socks5_udp", "allow_upstream_proxy",
    "dangerously_allow_non_loopback_proxy", "dangerously_allow_all_unix_sockets", "mode", "domains", "unix_sockets", "allow_local_binding", "mitm"]);
  return result;
}

export function buildAgenticNativePermissionProfile({ native, targetRoot, productRoot, controlRoot, cwd, writable, review,
  platform = process.platform }) {
  const slash = value => value.replaceAll("\\", "/");
  const filesystem = { ":root": platform === "win32" ? "read" : "deny", ":minimal": "read" };
  // Windows requires effective root read. Do not deny entire drives or the
  // system-owned Users directory; protect explicit private roots instead.
  for (const root of native.protected_roots ?? []) filesystem[slash(root)] = "deny";
  for (const root of native.tool_roots ?? []) filesystem[slash(root)] = "read";
  if (review) {
    if (platform !== "win32") filesystem[slash(targetRoot)] = "deny";
    else {
      // Deny the broker-owned product directory itself, never only an ancestor
      // that a prior explicit workspace grant can override. Per-file denial
      // failed on the actual actor-created corpus; retain controlled roots.
      const inside = (base, file) => { const rel = path.relative(base, file); return rel === "" || rel && !path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + path.sep); };
      let visited = 0;
      const protect = directory => {
        for (const name of fs.readdirSync(directory)) {
          if (++visited > 512) fail("PROCESS_SESSION_PROTECTED_TREE_LIMIT");
          const file = path.join(directory, name), stat = fs.lstatSync(file);
          if (stat.isSymbolicLink()) fail("PROCESS_SESSION_PROTECTED_TREE_SYMLINK");
          if (stat.isDirectory() && file !== productRoot && inside(file, productRoot)) protect(file);
          else filesystem[slash(file)] = "deny";
        }
      };
      protect(targetRoot);
    }
  }
  filesystem[slash(cwd)] = writable ? "write" : "read";
  filesystem[slash(controlRoot)] = "deny";
  filesystem[slash(native.home)] = "deny";
  return { extends: writable ? ":workspace" : ":read-only", filesystem, network: { enabled: false } };
}
