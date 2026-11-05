import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { applyAuthorization, planAuthorization } from "../../src/application/install/project-activation-service.mjs";
import { CODEX_STARTUP_ENVIRONMENT_PROFILES } from "../../src/core/agents/codex-startup-arguments.mjs";
const put = (root, name, content) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); return file; };

// Explicit native RPC double shared by in-process and independent child fixtures.
// No real native client is opened by this module.
function inlineTomlToJson(text) {
  let quoted = false, escaped = false, result = "";
  for (const character of text) {
    if (!escaped && character === '"') quoted = !quoted;
    result += !quoted && character === "=" ? ":" : character;
    escaped = quoted && !escaped && character === "\\";
  }
  return JSON.parse(result);
}
export function transport(f, options = {}) {
  const sessions = [], calls = [];
  const rpcFactory = configuration => {
    const index = sessions.length + 1, thread = `thread-${index}`, permission = configuration.args.find(arg => arg.startsWith("permissions.aidn_agentic_"));
    const profile = permission.split("=")[0].slice("permissions.".length), parsed = inlineTomlToJson(permission.slice(permission.indexOf("=") + 1));
    const cfg = { model: "fixture-model", model_provider: "openai", model_reasoning_effort: "medium", approval_policy: "never", memories: { use_memories: false, generate_memories: false },
      features: { memories: false, plugins: false, apps: false, hooks: true, multi_agent: false }, agents: { enabled: false }, history: { persistence: "none" },
      project_doc_max_bytes: 0, instructions: "", developer_instructions: "",
      log_dir: JSON.parse(configuration.args.find(arg => arg.startsWith("log_dir=")).slice("log_dir=".length)),
      sqlite_home: JSON.parse(configuration.args.find(arg => arg.startsWith("sqlite_home=")).slice("sqlite_home=".length)),
      mcp_servers: {}, plugins: {}, apps: { _default: { enabled: false } },
      shell_environment_policy: { inherit: "all", ignore_default_excludes: true, filters: Object.fromEntries(CODEX_STARTUP_ENVIRONMENT_PROFILES.worker.map(name => [name, "include"])), set: {} },
      permissions: { [profile]: parsed } };
    const session = { thread, turns: 0, closed: false, closeCalls: 0, configuration, cfg }; sessions.push(session);
    return {
      async request(method, params) {
        calls.push({ method, params, thread });
        if (method === "initialize") return {};
        if (method === "windowsSandbox/readiness") return { status: options.backendMissing ? "notReady" : "ready" };
        if (method === "permissionProfile/list") return { data: [{ id: profile, allowed: !options.profileDenied }], nextCursor: null };
        if (method === "hooks/list") {
          assert.equal(params.threadId, thread, "Inspect the actual loaded thread's hooks before any model turn");
          assert.equal(Object.hasOwn(params, "cwds"), false);
          const hooks = configuration.cwd === f.dirs.product ? ["preToolUse", "sessionStart"].map((eventName, index) => ({ eventName,
            enabled: true, trustStatus: "trusted", source: "project", handlerType: "command", async: false,
            sourcePath: path.join(f.configuration.target_root, ".codex/hooks.json"), currentHash: f.configuration.native.hook_hashes.work[index] })) : [];
          if (options.foreignHook) hooks.push({ enabled: true, trustStatus: "trusted", source: "global", currentHash: "sha256:" + "a".repeat(64) });
          if (options.noAdmission) hooks[0].eventName = "unrelatedEvent";
          return { data: [{ cwd: configuration.cwd, hooks, errors: [], warnings: [] }] };
        }
        if (method === "config/read") { await options.onConfigRead?.(); if (options.badProfile) return { config: {} }; return { config: cfg }; }
        if (method === "thread/start") return { thread: { id: thread }, model: cfg.model, approvalPolicy: "never", activePermissionProfile: { id: profile },
          sandbox: { type: Object.values(parsed.filesystem).includes("write") ? "workspaceWrite" : "readOnly", networkAccess: false } };
        if (method !== "turn/start") throw Error("unexpected method");
        const turn = `turn-${++session.turns}`;
        if (options.silence) return { turn: { id: turn } };
        if (params.input[0].text.includes("Change value")) put(f.dirs.product, "app.mjs", "export const value = 2;\n");
        if (index === 2 && options.mutateReview) put(f.dirs.product, "app.mjs", "export const value = 99;\n");
        if (index === 2 && options.mutateSnapshot) put(configuration.cwd, "app.mjs", "export const value = 99;\n");
        if (options.revoke) applyAuthorization(planAuthorization({ targetRoot: f.configuration.target_root, action: "revoke" }));
        if (options.backendDrift) put(f.configuration.target_root, ".aidn/config.json", JSON.stringify({ runtime: { persistence: { backend: "sqlite" } } }));
        if (options.storage) put(f.dirs.control, "case/native-overflow.bin", Buffer.alloc(11 * 1024 * 1024));
        const notify = (method, params) => configuration.onNotification({ method, params });
        await notify("rawResponse/completed", { threadId: options.foreignThread ? "other-thread" : thread, turnId: turn, responseId: `response-${session.turns}` });
        const usage = { inputTokens: 10 * session.turns, cachedInputTokens: 0, outputTokens: session.turns, reasoningOutputTokens: 0, totalTokens: 11 * session.turns };
        if (!options.noUsage) await notify("thread/tokenUsage/updated", { threadId: thread, turnId: options.foreignTurn ? "other-turn" : turn,
          tokenUsage: { total: usage, last: usage } });
        await notify("item/completed", { threadId: thread, turnId: turn, item: { type: "functionCallOutput", name: "exec", id: "fixture-tool", output: "private command/output must not be retained" } });
        await notify("item/completed", { threadId: thread, turnId: turn, item: { type: "agentMessage", phase: "commentary", text: "Working on the admitted activity." } });
        const answer = options.answer ? await options.answer({ params, index }) : { outcome: options.reject && index === 2 ? "rejected" : "completed", summary: "Fixture result." };
        await notify("item/completed", { threadId: thread, turnId: turn, item: { type: "agentMessage", phase: "final_answer", text: JSON.stringify(answer) } });
        await notify("turn/completed", { threadId: thread, turn: { id: turn, status: "completed" } });
        if (options.unverifiableStorage) fs.symlinkSync(f.base, path.join(f.dirs.control, "case/unverifiable-link"), "junction");
        if (options.transientStorage) put(f.dirs.control, "case/transient.tmp", "transient");
        return { turn: { id: turn } };
      },
      notify() {}, async flush() {}, async close() {
        session.closeCalls++; session.closed = true;
        if (options.corruptEvidenceOnClose) {
          const directory = path.join(f.dirs.control, "case"), file = fs.readdirSync(directory).find(name => name.endsWith("-native-result.json"));
          if (file) fs.appendFileSync(path.join(directory, file), "\n");
        }
        return { closed: !options.closeFailure };
      },
    };
  };
  return { rpcFactory, sessions, calls };
}
