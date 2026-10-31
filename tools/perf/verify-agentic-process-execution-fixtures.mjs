#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createProjectAgenticProcessExecution } from "../../src/application/runtime/agentic-process-execution-composition.mjs";
import { runOwnedAgenticProcess } from "../../src/application/runtime/agentic-process-owned-run.mjs";
import { agenticProcessImplementationPins } from "../../src/application/runtime/agentic-process-implementation-pins.mjs";
import { agenticProcessPersistence, createAgenticProcessWorkerEnvironment } from "../../src/application/runtime/agentic-process-persistence.mjs";
import { createProjectArtifactStore } from "../../src/application/runtime/project-artifact-store-service.mjs";
import { resolveRuntimeProjectContext } from "../../src/application/runtime/runtime-project-context-service.mjs";
import { createArtifactStore } from "../../src/adapters/runtime/artifact-store.mjs";
import { createPostgresRuntimeArtifactStore } from "../../src/adapters/runtime/postgres-runtime-artifact-store.mjs";
import { createRuntimePersistenceFakePgClientFactory } from "./runtime-persistence-fake-pg-lib.mjs";
import { createAgenticProcessStore } from "../../src/adapters/runtime/agentic-process-store.mjs";
import { createAgenticCodexRpc } from "../../src/adapters/agents/agentic-codex-rpc.mjs";
import { normalizePermissionProfile, buildAgenticNativePermissionProfile, createAgenticCodexSessions } from "../../src/adapters/agents/agentic-codex-session.mjs";
import { applyAuthorization, planAuthorization, resolveActivationTarget, readActivation } from "../../src/application/install/project-activation-service.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { artifactContentHash, assertWorkflowRecordProjection } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { CODEX_STARTUP_ENVIRONMENT_PROFILES, createCodexHostEnvironment } from "../../src/core/agents/codex-startup-arguments.mjs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";

const sha = value => createHash("sha256").update(value).digest("hex");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-agentic-execution-")), checks = [];
let serial = 0;
const put = (base, name, text) => { const file = path.join(base, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
async function check(name, callback) { await callback(); checks.push(name); console.log("PASS " + name); }
function fixture() {
  const base = path.join(root, "case-" + ++serial), targetRoot = path.join(base, "project"), packageRoot = path.join(base, "package");
  fs.mkdirSync(targetRoot, { recursive: true });
  const version = fs.readFileSync(new URL("../../VERSION", import.meta.url), "utf8").trim();
  put(packageRoot, "VERSION", version + "\n"); put(packageRoot, "bin/aidn.mjs", "// fixture, never executed\n");
  applyAuthorization(planAuthorization({ targetRoot, action: "authorize" }));
  const identity = resolveActivationTarget({ targetRoot }), assets = {};
  for (const name of [".codex/hooks/aidn-hook-runtime.mjs", ".codex/hooks/aidn-session-start.mjs", ".codex/hooks/aidn-pre-tool-use.mjs", ".agents/skills/context-reload/SKILL.md", ".agents/skills/start-session/SKILL.md"]) {
    const text = "Neutral fixture\n"; put(targetRoot, name, text); assets[name] = { kind: "file", current: Buffer.from(text).toString("base64") };
  }
  const block = "<!-- CODEX-AUDIT-WORKFLOW START -->\nNeutral fixture\n<!-- CODEX-AUDIT-WORKFLOW END -->";
  put(targetRoot, "AGENTS.md", block); assets["AGENTS.md"] = { kind: "agents-block", current: block };
  const hooks = ["SessionStart", "PreToolUse"].map(event => ({ event, group: { matcher: "fixture" }, hook: { type: "command", command: "echo fixture" } }));
  put(targetRoot, ".codex/hooks.json", JSON.stringify({ hooks: Object.fromEntries(hooks.map(h => [h.event, [{ ...h.group, hooks: [h.hook] }]])) }));
  assets[".codex/hooks.json"] = { kind: "hooks", current: hooks };
  const receipt = { schema_version: 1, scope: "codex-integration", root_id: identity.root_id,
    package: { root: packageRoot, version, entry: "bin/aidn.mjs", entry_sha256: artifactContentHash(fs.readFileSync(path.join(packageRoot, "bin/aidn.mjs"), "utf8")), version_sha256: artifactContentHash(version + "\n") },
    assets, last_transaction: "a".repeat(32), last_action: "install", activation: { mode: identity.scope, authority_id: identity.authority_id } };
  const tx = { schema_version: 1, id: receipt.last_transaction, scope: "codex-integration", root_id: identity.root_id, status: "complete", operations: [], receipt_after: receipt };
  const seal = value => JSON.stringify({ ...value, integrity_sha256: shadowHash(value) });
  put(targetRoot, `.aidn/install/transactions/${tx.id}.json`, seal(tx)); put(targetRoot, ".aidn/install/receipt.json", seal(receipt));
  assert.equal(readActivation({ targetRoot }).state, "active");
  const dirs = Object.fromEntries(["product", "control", "review", "home"].map(name => [name, name === "product" ? path.join(targetRoot, name) : path.join(base, name)]));
  for (const directory of Object.values(dirs)) fs.mkdirSync(directory);
  put(dirs.product, "app.mjs", "export const value = 1;\n");
  const model = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agentic-process/compatible-work-and-review.json", import.meta.url)));
  model.policies[0].allowed_permissions.push("write:product");
  const pin = (name, text) => { const file = put(base, name, text); return { path: file, sha256: sha(text) }; };
  const configuration = { contract_version: "agentic-process-execution.v1", instance_id: "case", target_root: targetRoot,
    implementation_sha256: agenticProcessImplementationPins().sha256,
    product_root: dirs.product, control_root: dirs.control, review_root: dirs.review, product_files: ["app.mjs"],
    model: pin("model.json", JSON.stringify(model)), criteria: pin("criteria.md", "Value must be 2 after implementation."),
    authorities: { project: { path: path.join(targetRoot, "AGENTS.md"), sha256: sha(block) } },
    skills: { architecture: pin("architecture.md", "Inspect and preserve architecture."), tests: pin("tests.md", "Check the explicit criteria.") },
    instructions: { analyze: "Analyze the change.", implement: "Change value to 2.", review: "Review without correcting the work." },
    native: { executable: process.execPath, sha256: sha(fs.readFileSync(process.execPath)), home: dirs.home, tool_roots: [],
      hook_hashes: { work: ["sha256:" + "a".repeat(64), "sha256:" + "b".repeat(64)], review: [] }, model: "fixture-model", effort: "medium",
      startup: { mcp_server_ids: [], plugin_ids: [], app_ids: [], environment_override_names: [], environment_names: [...CODEX_STARTUP_ENVIRONMENT_PROFILES.worker],
        log_dir: dirs.control, sqlite_home: dirs.control } },
  };
  const authorize = () => { const at = Date.now(); return { approved: true, model_allowed: true, authorized_at_ms: at, global_deadline_ms: at + 60000,
    workflow_deadline_ms: at + 60000, max_turn_ms: 10000,
    max_responses: 6, max_bytes: 10 * 1024 * 1024, configuration_sha256: shadowHash(configuration) }; };
  return { configuration, authorize, base, dirs };
}
function persistenceFixture(f, backend, stateMode) {
  const targetRoot = f.configuration.target_root;
  put(targetRoot, ".aidn/config.json", JSON.stringify({ runtime: { stateMode, persistence: { backend,
    ...(backend === "postgres" ? { connectionRef: "env:AIDN_TEST_DB" } : {}) } } }));
  f.environment = { ...createCodexHostEnvironment(), AIDN_TEST_DB: "postgresql://fixture:fixture@127.0.0.1/never-connected" };
  if (backend === "sqlite") {
    if (stateMode !== "files") createArtifactStore({ sqliteFile: path.join(targetRoot, ".aidn/runtime/index/workflow-index.sqlite") }).close();
    return;
  }
  f.pgState = put(f.base, "postgres-state.json", JSON.stringify({ scope: resolveRuntimeProjectContext({ targetRoot }).runtime_scope_id,
    commits: 0, tables: { artifacts: [], artifact_blobs: [], runtime_heads: [] }, queries: [] }));
  f.artifactStoreFactory = options => createProjectArtifactStore({ ...options, workerRunner(executable, args, settings) {
    assert.match(args[0], /project-artifact-store-worker\.mjs$/);
    assert.equal(settings.env.AIDN_TEST_DB, f.environment.AIDN_TEST_DB);
    return spawnSync(executable, [fileURLToPath(new URL("agentic-postgres-worker-fixture.mjs", import.meta.url))],
      { ...settings, env: { ...settings.env, AIDN_TEST_PG_STATE: f.pgState } });
  } });
}
function mutatePg(f, changes) { const state = JSON.parse(fs.readFileSync(f.pgState)); Object.assign(state, changes); fs.writeFileSync(f.pgState, JSON.stringify(state)); }
function inlineTomlToJson(text) {
  let quoted = false, escaped = false, result = "";
  for (const character of text) {
    if (!escaped && character === '"') quoted = !quoted;
    result += !quoted && character === "=" ? ":" : character;
    escaped = quoted && !escaped && character === "\\";
  }
  return JSON.parse(result);
}
function transport(f, options = {}) {
  const sessions = [], calls = [];
  const rpcFactory = configuration => {
    const index = sessions.length + 1, thread = `thread-${index}`, permission = configuration.args.find(arg => arg.startsWith("permissions.aidn_agentic_"));
    const profile = permission.split("=")[0].slice("permissions.".length), parsed = inlineTomlToJson(permission.slice(permission.indexOf("=") + 1));
    const cfg = { model: "fixture-model", model_provider: "openai", model_reasoning_effort: "medium", approval_policy: "never", memories: { use_memories: false, generate_memories: false },
      features: { memories: false, plugins: false, apps: false, hooks: true, multi_agent: false }, agents: { enabled: false }, history: { persistence: "none" },
      project_doc_max_bytes: 0, instructions: "", developer_instructions: "",
      log_dir: path.join(f.dirs.control, `case/native-${index}-logs`), sqlite_home: path.join(f.dirs.control, `case/native-${index}-sqlite`),
      mcp_servers: {}, plugins: {}, apps: { _default: { enabled: false } },
      shell_environment_policy: { inherit: "all", ignore_default_excludes: true, filters: Object.fromEntries(CODEX_STARTUP_ENVIRONMENT_PROFILES.worker.map(name => [name, "include"])), set: {} },
      permissions: { [profile]: parsed } };
    const session = { thread, turns: 0, closed: false, configuration, cfg }; sessions.push(session);
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
        if (method === "config/read") { options.onConfigRead?.(); if (options.badProfile) return { config: {} }; return { config: cfg }; }
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
        await notify("item/completed", { threadId: thread, turnId: turn, item: { type: "agentMessage", phase: "commentary", text: "Working on the admitted activity." } });
        await notify("item/completed", { threadId: thread, turnId: turn, item: { type: "agentMessage", phase: "final_answer", text: JSON.stringify({ outcome: options.reject && index === 2 ? "rejected" : "completed", summary: "Fixture result." }) } });
        await notify("turn/completed", { threadId: thread, turn: { id: turn, status: "completed" } });
        if (options.unverifiableStorage) fs.symlinkSync(f.base, path.join(f.dirs.control, "case/unverifiable-link"), "junction");
        return { turn: { id: turn } };
      },
      notify() {}, async flush() {}, async close() { session.closed = true; return { closed: !options.closeFailure }; },
    };
  };
  return { rpcFactory, sessions, calls };
}
async function run(f, options = {}) {
  const t = transport(f, options), auth = f.authorize();
  if (options.maxResponses) auth.max_responses = options.maxResponses;
  if (options.silence) auth.max_turn_ms = 25;
  const result = await createProjectAgenticProcessExecution(f.configuration, { rpcFactory: t.rpcFactory,
    ...(f.artifactStoreFactory ? { artifactStoreFactory: f.artifactStoreFactory } : {}), ...(f.environment ? { environment: f.environment } : {}) }).run({ execute: true, authorization: auth, signal: options.signal });
  assert.equal(t.sessions.every(session => session.closed), true);
  assert.equal(fs.existsSync(path.join(f.dirs.control, "case/RESULT.json")), !result.seal?.startsWith("STDOUT_ONLY"));
  return { result, ...t };
}

try {
  await check("Windows root-read requirement retains explicit private, author and home denials", () => {
    const original = path.join(root, "profile-project"), product = path.join(original, "app"), slash = p => p.replaceAll("\\", "/");
    put(product, "server.mjs", "// private original\n"); put(product, "tmp/input.txt", "temporary original\n"); put(original, "metadata/common.md", "original metadata\n");
    const profile = buildAgenticNativePermissionProfile({ platform: "win32",
      native: { home: "C:\\Users\\fixture\\.codex", tool_roots: ["C:\\Windows", "G:\\cohort\\runtime"], protected_roots: ["G:\\cohort\\old-author-control"] },
      targetRoot: original, productRoot: product, controlRoot: "G:\\cohort\\control", cwd: "G:\\cohort\\review\\snapshot", writable: false, review: true });
    assert.equal(profile.filesystem[":root"], "read"); assert.equal(profile.filesystem["G:/"], undefined);
    assert.equal(profile.filesystem["C:/Users"], undefined); assert.equal(profile.filesystem["C:/Users/fixture/.codex"], "deny");
    assert.equal(profile.filesystem["G:/cohort/old-author-control"], "deny");
    assert.equal(profile.filesystem[slash(original)], undefined); assert.equal(profile.filesystem["G:/cohort/control"], "deny");
    assert.equal(profile.filesystem[slash(product)], "deny");
    assert.equal(profile.filesystem[slash(path.join(product, "server.mjs"))], undefined);
    assert.equal(profile.filesystem[slash(path.join(original, "metadata"))], "deny");
    assert.equal(profile.filesystem["G:/cohort/review/snapshot"], "read"); assert.equal(profile.filesystem["G:/cohort/runtime"], "read");
    assert.equal(profile.network.enabled, false);
  });
  await check("typed native permission null defaults normalize without discarding unexpected permissions", () => {
    const expected = { extends: ":workspace", filesystem: { ":root": "deny", ":minimal": "read" }, network: { enabled: false } };
    const native = { ...expected, description: null, workspace_roots: null,
      filesystem: { ...expected.filesystem, glob_scan_max_depth: null },
      network: { ...expected.network, proxy_url: null, enable_socks5: null, socks_url: null, enable_socks5_udp: null,
        allow_upstream_proxy: null, dangerously_allow_non_loopback_proxy: null, dangerously_allow_all_unix_sockets: null,
        mode: null, domains: null, unix_sockets: null, allow_local_binding: null, mitm: null } };
    assert.deepEqual(normalizePermissionProfile(native), expected);
    assert.notDeepEqual(normalizePermissionProfile({ ...native, unknown_policy: null }), expected);
    assert.notDeepEqual(normalizePermissionProfile({ ...native, network: { ...native.network, proxy_url: "http://foreign.invalid" } }), expected);
    assert.notDeepEqual(normalizePermissionProfile({ ...native, filesystem: { ...native.filesystem, ":root": "write" } }), expected);
  });
  await check("project preview performs no writes or native startup; explicit pinned authorization required", async () => {
    const f = fixture(), before = fs.readdirSync(f.dirs.control), t = transport(f);
    const service = createProjectAgenticProcessExecution(f.configuration, { rpcFactory: t.rpcFactory });
    assert.equal(service.preview().written, false); assert.deepEqual(fs.readdirSync(f.dirs.control), before); assert.equal(t.sessions.length, 0);
    await assert.rejects(() => service.run({ execute: true, authorization: {} }), /EXPLICIT_AUTHORIZATION_REQUIRED/);
    assert.equal(t.sessions.length, 0);
  });
  await check("actual internal CLI preview and fixed worker EOF path stay offline and reject unauthenticated execution", () => {
    const f = fixture(), text = JSON.stringify(f.configuration), file = put(f.base, "configuration.json", text);
    const runner = fileURLToPath(new URL("../runtime/run-agentic-process.mjs", import.meta.url));
    const command = spawnSync(process.execPath, [runner, "--preview", "--configuration", file, "--configuration-sha256", sha(text)],
      { encoding: "utf8", timeout: 10000, windowsHide: true });
    assert.equal(command.status, 0, command.stderr); assert.equal(JSON.parse(command.stdout).native_started, false);
    assert.deepEqual(fs.readdirSync(f.dirs.control), []);
    const worker = fileURLToPath(new URL("../../src/adapters/agents/agentic-process-worker.mjs", import.meta.url));
    const refused = spawnSync(process.execPath, [worker], { input: JSON.stringify({ configuration: f.configuration, authorization: {} }),
      encoding: "utf8", timeout: 10000, windowsHide: true });
    assert.equal(refused.status, 1); assert.equal(JSON.parse(refused.stdout).first_failure, "PROCESS_EXECUTION_EXPLICIT_AUTHORIZATION_REQUIRED");
    assert.match(refused.stderr, /PROCESS_EXECUTION_EXPLICIT_AUTHORIZATION_REQUIRED/);
    assert.deepEqual(fs.readdirSync(f.dirs.control), []);
  });
  await check("abort during pre-turn observation and exhausted deadline prohibit turn/start", async () => {
    for (const expired of [false, true]) {
      const f = fixture(), controller = new AbortController(); let armed = false;
      const t = transport(f, { onConfigRead() { if (armed && !expired) controller.abort(); } });
      const model = JSON.parse(fs.readFileSync(f.configuration.model.path));
      const sessions = createAgenticCodexSessions({ native: f.configuration.native, targetRoot: f.configuration.target_root,
        productRoot: f.dirs.product, controlRoot: path.join(f.dirs.control, "case"), rpcFactory: t.rpcFactory,
        evidence: { async retain() { return { ref: "fixture/native", sha256: "a".repeat(64) }; }, diagnostic() {} },
        budget: { maxTurnMs: 1000, remainingBytes: () => 1000000, response() {} } });
      try {
        const session = await sessions.open({ role: model.roles[0], policy: model.policies.find(row => row.id === "work"),
          input: { developer_instructions: "Common fixture authority." }, deadline: Date.now() + (expired ? -1 : 60000) });
        armed = true;
        await assert.rejects(() => session.run({ instruction: "Never start this turn.", request_sha256: "b".repeat(64), signal: controller.signal }),
          expired ? /PROCESS_SESSION_DEADLINE/ : /PROCESS_SESSION_BUSY_OR_CANCELLED/);
        assert.equal(t.calls.filter(row => row.method === "turn/start").length, 0);
      } finally { assert.equal((await sessions.close()).closed, true); }
    }
  });
  await check("pre-aborted composition retains cancellation without canonical initialization or native allocation", async () => {
    const f = fixture(), { result, sessions, calls } = await run(f, { signal: AbortSignal.abort() });
    assert.equal(result.first_failure, "PROCESS_EXECUTION_CANCELLED"); assert.equal(result.status, "FAILED");
    assert.equal(result.responses_observed, 0); assert.equal(sessions.length, 0); assert.equal(calls.length, 0);
    assert.equal(result.instance_sha256, null);
  });
  await check("unverifiable storage retains first failure, known usage and explicit unknown bytes on stdout", async () => {
    const { result } = await run(fixture(), { unverifiableStorage: true });
    assert.equal(result.first_failure, "PROCESS_EXECUTION_STORAGE_SYMLINK"); assert.equal(result.status, "FAILED");
    assert.equal(result.responses_observed, 1); assert.equal(result.consumption.thread_counters.length, 1);
    assert.equal(result.native_parent_closure.closed, true); assert.equal(result.bytes_retained, null);
    assert.equal(result.storage_budget_debit_bytes, null); assert.equal(result.seal, "STDOUT_ONLY_STORAGE_UNVERIFIABLE");
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 65536);
  });
  await check("failed footer write preserves the structured result and an earlier cancellation", async () => {
    for (const cancelled of [false, true]) {
      const f = fixture(), original = fs.writeFileSync;
      fs.writeFileSync = function(file, ...args) {
        if (file === path.join(f.dirs.control, "case/RESULT.json")) throw Object.assign(Error("fixture full disk"), { code: "ENOSPC" });
        return original.call(this, file, ...args);
      };
      try {
        const { result } = await run(f, cancelled ? { signal: AbortSignal.abort() } : {});
        assert.equal(result.first_failure, cancelled ? "PROCESS_EXECUTION_CANCELLED" : "PROCESS_EXECUTION_SEAL_WRITE_FAILED");
        assert.equal(result.status, "FAILED"); assert.equal(result.seal, "STDOUT_ONLY_WRITE_FAILED");
        assert.equal(result.native_parent_closure.closed, true); assert.ok(result.bytes_retained >= 0);
        if (!cancelled) { assert.equal(result.responses_observed, 3); assert.equal(result.consumption.thread_counters.length, 2); }
        assert.ok(Buffer.byteLength(JSON.stringify(result)) < 65536);
      } finally { fs.writeFileSync = original; }
    }
  });
  await check("real composition: same session across compatible roles; distinct independent reviewer and canonical results", async () => {
    const f = fixture(), { result, sessions } = await run(f);
    assert.equal(result.status, "COMPLETED", JSON.stringify(result)); assert.equal(sessions.length, 2);
    assert.deepEqual(sessions.map(session => session.turns), [2, 1]); assert.equal(result.responses_observed, 3);
    assert.notEqual(sessions[0].configuration.cwd, sessions[1].configuration.cwd);
    assert.equal(fs.readFileSync(path.join(sessions[1].configuration.cwd, "app.mjs"), "utf8"), "export const value = 2;\n");
    const state = createAgenticProcessStore({ targetRoot: f.configuration.target_root, stateMode: "files" }).read("case").record;
    const assignments = state.events.filter(row => row.kind === "assign");
    assert.equal(assignments[0].decision.execution_id, assignments[1].decision.execution_id);
    assert.notEqual(assignments[1].decision.lineage_id, assignments[2].decision.lineage_id);
    assert.equal(state.events.filter(row => row.kind === "result").length, 3);
    const next = createProjectAgenticProcessExecution(f.configuration, { rpcFactory: () => { throw Error("must not restart"); } });
    await assert.rejects(() => next.run({ execute: true, authorization: f.authorize() }), /EXISTING_INSTANCE_REQUIRES_RECONCILIATION/);
  });
  for (const backend of ["sqlite", "postgres"]) for (const mode of ["files", "dual", "db-only"])
    await check(`configured ${backend}/${mode}: real canonical CAS, review and projection contract`, async () => {
      const f = fixture(); persistenceFixture(f, backend, mode);
      const { result, sessions } = await run(f);
      assert.equal(result.status, "COMPLETED", JSON.stringify(result)); assert.equal(result.persistence.backend, backend);
      assert.deepEqual(sessions.map(session => session.turns), [2, 1]);
      assert.equal(sessions[0].configuration.env.AIDN_TEST_DB, backend === "postgres" ? f.environment.AIDN_TEST_DB : undefined);
      assert.equal(sessions[1].configuration.env.AIDN_TEST_DB, undefined);
      assert.equal(createCodexHostEnvironment(sessions[0].configuration.env).AIDN_TEST_DB, undefined);
      const store = createAgenticProcessStore({ targetRoot: f.configuration.target_root, stateMode: mode, env: f.environment,
        ...(f.artifactStoreFactory ? { artifactStoreFactory: f.artifactStoreFactory } : {}) });
      const state = store.read("case"); assert.equal(state.record.events.filter(row => row.kind === "result").length, 3);
      assert.throws(() => store.compareAndSwap(state.record, "a".repeat(64)), /REVISION_CONFLICT/);
      const visible = path.join(f.configuration.target_root, "docs/audit/workflows/process-instances/case.json");
      assert.equal(fs.existsSync(visible), mode !== "db-only");
      if (backend === "postgres") {
        assert.equal(fs.existsSync(path.join(f.configuration.target_root, ".aidn/runtime/index/workflow-index.sqlite")), false);
        const pg = JSON.parse(fs.readFileSync(f.pgState));
        assert.ok(pg.queries.some(sql => sql === "ROLLBACK")); assert.ok(pg.queries.some(sql => sql.includes("pg_advisory_xact_lock")));
        assert.equal(pg.queries.some(sql => /CREATE |ALTER |DROP |DELETE /i.test(sql)), false);
        assert.ok(result.persistence.canonical_payload_bytes_acknowledged > 0); assert.equal(result.persistence.server_physical_bytes, "NON_MESURE");
        assert.doesNotMatch(JSON.stringify(result), /fixture:fixture|never-connected/);
      }
    });
  await check("PostgreSQL outage refuses before native startup and never creates a SQLite fallback", async () => {
    const f = fixture(); persistenceFixture(f, "postgres", "files"); mutatePg(f, { unavailable: true });
    const t = transport(f), execution = createProjectAgenticProcessExecution(f.configuration,
      { rpcFactory: t.rpcFactory, artifactStoreFactory: f.artifactStoreFactory, environment: f.environment });
    assert.equal(execution.preview().persistence.backend, "postgres");
    await assert.rejects(() => execution.run({ execute: true, authorization: f.authorize() }), /ARTIFACT_POSTGRES_WORKER_UNAVAILABLE/);
    assert.equal(t.sessions.length, 0); assert.equal(fs.existsSync(path.join(f.configuration.target_root, ".aidn/runtime/index/workflow-index.sqlite")), false);
  });
  for (const [options, reason] of [[{ reserved: true }, "ARTIFACT_EXECUTION_SCOPE_RESERVED"], [{ failBlob: true }, "ARTIFACT_POSTGRES_COMMAND_FAILED"],
    [{ failReadAfterWrite: true }, "PROCESS_EXECUTION_PROJECTION_RECONCILIATION_REQUIRED"]])
    await check("PostgreSQL canonical refusal retained before model: " + reason, async () => {
      const f = fixture(); persistenceFixture(f, "postgres", "dual"); mutatePg(f, options);
      const { result, sessions } = await run(f); assert.equal(result.status, "FAILED"); assert.equal(result.first_failure, reason, JSON.stringify(result));
      assert.equal(sessions.length, 0);
      const pg = JSON.parse(fs.readFileSync(f.pgState));
      assert.equal(pg.tables.artifacts.length, options.failReadAfterWrite ? 1 : 0);
      assert.equal(fs.existsSync(path.join(f.configuration.target_root, ".aidn/runtime/index/workflow-index.sqlite")), false);
    });
  await check("changing a PostgreSQL project to SQLite during execution stops rather than accepting a foreign backend", async () => {
    const f = fixture(); persistenceFixture(f, "postgres", "db-only"); const { result } = await run(f, { backendDrift: true });
    assert.equal(result.status, "FAILED"); assert.equal(result.first_failure, "WORKFLOW_INSTANCE_PERSISTENCE_CHANGED");
    assert.equal(fs.existsSync(path.join(f.configuration.target_root, ".aidn/runtime/index/workflow-index.sqlite")), false);
  });
  await check("bulk projection cannot overwrite or omit process checkpoints on either backend", () => {
    for (const directory of ["instances", "definitions", "process-instances"]) {
      const row = { path: `workflows/${directory}/case.json`, content_format: "utf8", content: "canonical" };
      assert.doesNotThrow(() => assertWorkflowRecordProjection([row], [row]));
      assert.throws(() => assertWorkflowRecordProjection([row], [{ ...row, content: "stale" }]), /PROJECTION_CONFLICT/);
      assert.throws(() => assertWorkflowRecordProjection([row], []), /PROJECTION_CONFLICT/);
    }
  });
  await check("actual PostgreSQL bulk projection path protects canonical process instances before row replacement", async () => {
    const f = fixture(), fake = createRuntimePersistenceFakePgClientFactory();
    const store = createPostgresRuntimeArtifactStore({ targetRoot: f.configuration.target_root,
      connectionString: "postgres://fixture:fixture@localhost/never-connected", clientFactory: fake.factory });
    const row = { path: "workflows/process-instances/case.json", content_format: "utf8", content: "canonical process checkpoint", kind: "agentic_process_instance" };
    const payload = { schema_version: 2, generated_at: "2030-01-01T00:00:00Z", cycles: [], sessions: [], artifacts: [row] };
    await store.writeIndexProjection({ payload });
    await assert.rejects(store.writeIndexProjection({ payload: { ...payload, artifacts: [{ ...row, content: "stale projection" }] } }), /PROJECTION_CONFLICT/);
    await assert.rejects(store.writeIndexProjection({ payload: { ...payload, artifacts: [] } }), /PROJECTION_CONFLICT/);
    assert.ok(fake.state.queryLog.some(query => query.sql.includes("path LIKE 'workflows/process-instances/%'")));
  });
  await check("SQLite local lock refusal does not promote it to PostgreSQL or replay an abandoned writer", async () => {
    const f = fixture(); persistenceFixture(f, "sqlite", "files");
    put(f.configuration.target_root, "docs/audit/workflows/process-instances/case.json.lock", "retained lock, owner unknown");
    const { result, sessions } = await run(f);
    assert.equal(result.first_failure, "WORKFLOW_INSTANCE_LOCK_RECONCILIATION_REQUIRED"); assert.equal(sessions.length, 0);
  });
  await check("only trusted runtime/admission hosts receive PostgreSQL credentials; no model shell, review, pins or configuration contain them", async () => {
    const f = fixture(); persistenceFixture(f, "postgres", "db-only");
    const env = { ...f.environment, PGPASSWORD: "fixture-password", PGSSLMODE: "require", NODE_OPTIONS: "--bad-injection" };
    const pin = agenticProcessPersistence({ targetRoot: f.configuration.target_root, env });
    const workerEnv = createAgenticProcessWorkerEnvironment({ targetRoot: f.configuration.target_root, expectedBinding: pin.binding_sha256, env });
    assert.equal(workerEnv.AIDN_TEST_DB, env.AIDN_TEST_DB); assert.equal(workerEnv.PGPASSWORD, "fixture-password");
    assert.equal(workerEnv.PGSSLMODE, "require"); assert.equal(workerEnv.NODE_OPTIONS, undefined);
    assert.equal(createCodexHostEnvironment(workerEnv).AIDN_TEST_DB, undefined); assert.equal(createCodexHostEnvironment(workerEnv).PGPASSWORD, undefined);
    assert.doesNotMatch(JSON.stringify(pin), /fixture-password|fixture:fixture/);
    assert.throws(() => createAgenticProcessWorkerEnvironment({ targetRoot: f.configuration.target_root, expectedBinding: "a".repeat(64), env }), /PERSISTENCE_CHANGED/);
    assert.throws(() => createAgenticProcessWorkerEnvironment({ targetRoot: f.configuration.target_root, expectedBinding: pin.binding_sha256,
      env: { ...env, AIDN_TEST_DB: "" } }), /CONNECTION_UNAVAILABLE/);
    const worker = fileURLToPath(new URL("../../src/adapters/agents/agentic-process-worker.mjs", import.meta.url));
    f.configuration.controller = { node_sha256: sha(fs.readFileSync(process.execPath)), worker_sha256: sha(fs.readFileSync(worker)),
      helper_path: "fixture", helper_sha256: "a".repeat(64), helper_source_sha256: "b".repeat(64) };
    const authorization = f.authorize(); let captured;
    await runOwnedAgenticProcess({ configuration: f.configuration, authorization, execute: true }, { environment: env, controllerFactory: () => ({
      async checkAvailability() { return { available: true }; },
      async run(request, { onEvent }) {
        captured = request; assert.equal(request.env.AIDN_TEST_DB, env.AIDN_TEST_DB); assert.equal(request.env.NODE_OPTIONS, undefined);
        assert.doesNotMatch(request.stdin, /fixture-password|fixture:fixture/);
        const spec = JSON.parse(request.stdin); assert.equal(spec.persistenceBinding, pin.binding_sha256);
        await onEvent({ type: "stdout", bytes: Buffer.from(JSON.stringify({ contract_version: "agentic-process-execution-result.v1", status: "COMPLETED",
          first_failure: null, global_deadline_ms: spec.authorization.global_deadline_ms })) });
        return { outcome: "completed", termination_state: "confirmed", termination_proof: { active_processes: 0 } };
      },
    }) });
    assert.ok(captured);
    let invoked = false;
    const expired = createProjectArtifactStore({ targetRoot: f.configuration.target_root, env, deadlineMs: Date.now() - 1,
      workerRunner() { invoked = true; throw Error("must not execute"); } });
    assert.throws(() => expired.getArtifact("workflows/process-instances/case.json"), /DEADLINE_EXCEEDED/); assert.equal(invoked, false);
  });
  for (const [name, options, reason] of [
    ["foreign thread", { foreignThread: true }, "PROCESS_SESSION_FOREIGN_THREAD"],
    ["foreign turn", { foreignTurn: true }, "PROCESS_SESSION_FOREIGN_TURN"],
    ["missing usage", { noUsage: true }, "PROCESS_SESSION_CAPTURE_INCOMPLETE"],
    ["changed profile", { badProfile: true }, "PROCESS_SESSION_EFFECTIVE_PROFILE_CHANGED"],
    ["unavailable sandbox refuses provisioning", { backendMissing: true }, "PROCESS_SESSION_SANDBOX_NOT_PREEXISTING"],
    ["profile forbidden by managed requirements", { profileDenied: true }, "PROCESS_SESSION_PERMISSION_PROFILE_UNAVAILABLE"],
    ["unexpected native hooks", { foreignHook: true }, "PROCESS_SESSION_HOOKS_CHANGED"],
    ["assignment cannot replace native pre-write admission", { noAdmission: true }, "PROCESS_SESSION_ADMISSION_HOOKS_REQUIRED"],
    ["corrected reviewed artifact", { mutateReview: true }, "PROCESS_BINDING_UNAVAILABLE"],
    ["mutated read-only review snapshot", { mutateSnapshot: true }, "PROCESS_BINDING_UNAVAILABLE"],
    ["revoked activation", { revoke: true }, "PROCESS_AUTHORITY_UNAVAILABLE"],
    ["unconfirmed direct-child closure", { closeFailure: true }, "PROCESS_HOST_CLOSE_UNCONFIRMED"],
    ["response cap prohibits the next activity", { maxResponses: 1 }, "PROCESS_EXECUTION_RESPONSE_LIMIT"],
    ["per-turn timeout", { silence: true }, "PROCESS_SESSION_DEADLINE"],
  ]) await check("stop without retry and retain partial: " + name, async () => {
    const { result, sessions } = await run(fixture(), options);
    assert.equal(result.status, "FAILED"); assert.equal(result.first_failure, reason, JSON.stringify(result));
    assert.ok(sessions.length <= 2); assert.equal(result.retry, false);
  });
  await check("authenticated rejection remains terminal failure, never replaced by a favorable retry", async () => {
    const f = fixture(), { result } = await run(f, { reject: true }); assert.equal(result.status, "FAILED");
    const state = createAgenticProcessStore({ targetRoot: f.configuration.target_root, stateMode: "files" }).read("case").record;
    assert.equal(state.events.at(-1).result.outcome, "rejected"); assert.equal(result.responses_observed, 3);
  });
  await check("unexpected native storage overflow preserves first reason and structured stdout partial instead of masking it with seal failure", async () => {
    const { result } = await run(fixture(), { storage: true });
    assert.equal(result.first_failure, "PROCESS_EXECUTION_STORAGE_LIMIT");
    assert.equal(result.seal, "STDOUT_ONLY_STORAGE_LIMIT"); assert.ok(result.bytes_retained > 10 * 1024 * 1024);
    assert.equal(result.consumption.thread_counters.length, 1);
  });
  await check("pinned criteria and physical tool roots cannot silently change", () => {
    const f = fixture(); put(f.base, "criteria.md", "weaker criteria");
    assert.throws(() => createProjectAgenticProcessExecution(f.configuration), /INPUT_CHANGED/);
    const other = fixture(); other.configuration.native.tool_roots.push(other.base);
    assert.throws(() => createProjectAgenticProcessExecution(other.configuration), /TOOL_ROOT_OVERLAP/);
  });
  await check("expired budgets and altered implementation pins refuse before native allocation", async () => {
    const f = fixture(), t = transport(f), service = createProjectAgenticProcessExecution(f.configuration, { rpcFactory: t.rpcFactory });
    const auth = f.authorize(); auth.global_deadline_ms = auth.authorized_at_ms - 1;
    await assert.rejects(() => service.run({ execute: true, authorization: auth }), /EXPLICIT_AUTHORIZATION_REQUIRED/);
    assert.equal(t.sessions.length, 0);
    f.configuration.implementation_sha256 = "a".repeat(64);
    assert.throws(() => createProjectAgenticProcessExecution(f.configuration), /IMPLEMENTATION_CHANGED/);
  });
  await check("owned entry transmits the original deadline and requires process-tree termination proof", async () => {
    for (const confirmed of [true, false]) {
      const f = fixture(), worker = fileURLToPath(new URL("../../src/adapters/agents/agentic-process-worker.mjs", import.meta.url));
      f.configuration.controller = { node_sha256: sha(fs.readFileSync(process.execPath)), worker_sha256: sha(fs.readFileSync(worker)), helper_path: "fixture", helper_sha256: "a".repeat(64), helper_source_sha256: "b".repeat(64) };
      const auth = f.authorize(); auth.authorized_at_ms -= 12000; let sent;
      const result = await runOwnedAgenticProcess({ configuration: f.configuration, authorization: auth, execute: true }, { controllerFactory: () => ({
        async checkAvailability() { return { available: true }; },
        async run(request, { onEvent }) { sent = JSON.parse(request.stdin); assert.ok(request.maxDurationMs <= auth.global_deadline_ms - Date.now());
          await onEvent({ type: "stdout", bytes: Buffer.from(JSON.stringify({ contract_version: "agentic-process-execution-result.v1", status: "COMPLETED", first_failure: null, global_deadline_ms: sent.authorization.global_deadline_ms })) });
          return { outcome: "completed", termination_state: confirmed ? "confirmed" : "unknown", termination_proof: confirmed ? { active_processes: 0 } : null }; },
      }) });
      assert.equal(sent.authorization.global_deadline_ms, auth.global_deadline_ms);
      assert.equal(result.first_failure, confirmed ? null : "PROCESS_EXECUTION_TREE_CLOSE_UNCONFIRMED");
      assert.ok(result.elapsed_global_ms >= 12000);
    }
  });
  await check("real RPC parser correlates numeric reply IDs, rejects foreign IDs and stops on malformed notification", async () => {
    for (const mode of ["valid", "foreign", "notification"]) {
      const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.kill = () => { queueMicrotask(() => child.emit("close", 0)); return true; };
      const rpc = createAgenticCodexRpc({ executable: process.execPath, sha256: sha(fs.readFileSync(process.execPath)), args: [], cwd: root,
        env: {}, deadline: Date.now() + 10000, spawnProcess: () => child, onNotification() { throw Object.assign(Error("bad turn"), { code: "PROCESS_SESSION_FOREIGN_TURN" }); } });
      child.stdin.on("data", data => { const request = JSON.parse(data);
        child.stdout.write(JSON.stringify(mode === "notification" ? { method: "item/completed", params: {} } : { id: mode === "foreign" ? "call-id" : request.id, result: { ok: true } }) + "\n"); });
      if (mode === "valid") assert.deepEqual(await rpc.request("initialize", {}), { ok: true });
      else await assert.rejects(() => rpc.request("initialize", {}), mode === "foreign" ? /FOREIGN_REPLY/ : /FOREIGN_TURN/);
      assert.equal((await rpc.close()).closed, true);
    }
  });
  console.log(JSON.stringify({ ok: true, checks, proof_class: "offline-production-composition-with-fake-native-wire", model_calls: 0, native_client: "NOT_RUN", native_process_tree: "NOT_RUN" }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
