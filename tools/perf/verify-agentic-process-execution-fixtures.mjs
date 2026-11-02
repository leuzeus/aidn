#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createProjectAgenticProcessExecution } from "../../src/application/runtime/agentic-process-execution-composition.mjs";
import { runOwnedAgenticProcess } from "../../src/application/runtime/agentic-process-owned-run.mjs";
import { createJournaledNativeAllocation } from "../../src/application/runtime/journaled-native-allocation.mjs";
import { createNativeAllocationWorkerAuthority } from "../../src/application/runtime/native-allocation-worker-authority.mjs";
import { assertNativeAllocationJournal, nativeJournalPath } from "../../src/core/workflow/native-allocation-journal.mjs";
import { controlDelivery } from "../../src/core/workflow/process-control-inbox.mjs";
import { agenticProcessImplementationPins } from "../../src/application/runtime/agentic-process-implementation-pins.mjs";
import { agenticProcessPersistence, createAgenticProcessWorkerEnvironment } from "../../src/application/runtime/agentic-process-persistence.mjs";
import { createProjectArtifactStore } from "../../src/application/runtime/project-artifact-store-service.mjs";
import { resolveRuntimeProjectContext } from "../../src/application/runtime/runtime-project-context-service.mjs";
import { createArtifactStore } from "../../src/adapters/runtime/artifact-store.mjs";
import { createPostgresRuntimeArtifactStore } from "../../src/adapters/runtime/postgres-runtime-artifact-store.mjs";
import { createRuntimePersistenceFakePgClientFactory } from "./runtime-persistence-fake-pg-lib.mjs";
import { createAgenticProcessStore } from "../../src/adapters/runtime/agentic-process-store.mjs";
import { createAgenticCodexRpc } from "../../src/adapters/agents/agentic-codex-rpc.mjs";
import { normalizePermissionProfile, buildAgenticNativePermissionProfile, createAgenticCodexSessions, summarizeAgenticNativeToolItem } from "../../src/adapters/agents/agentic-codex-session.mjs";
import { applyAuthorization, planAuthorization, resolveActivationTarget, readActivation } from "../../src/application/install/project-activation-service.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { artifactContentHash, assertWorkflowRecordProjection } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { CODEX_STARTUP_ENVIRONMENT_PROFILES, createCodexHostEnvironment } from "../../src/core/agents/codex-startup-arguments.mjs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { compileBpmnProcess } from "../../src/application/workflow/bpmn-process-service.mjs";
import { createAgenticProcess, inspectAgenticProcess, advanceAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { assertNativeHostState } from "../../src/core/workflow/native-host-state.mjs";
import { agenticPolicyPins } from "../../src/core/workflow/agentic-process-model.mjs";
import { assertAgenticControlScenario } from "../../src/core/workflow/agentic-process-control-scenario.mjs";
import { republishBrokerProductFile } from "../../src/adapters/runtime/broker-product-file.mjs";
import { createProjectWorkflowInstanceService } from "../../src/application/runtime/workflow-instance-composition.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-agentic-execution-")), checks = [];
let serial = 0;
const put = (base, name, text) => { const file = path.join(base, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
async function check(name, callback) { if (process.argv.includes("--v2-only") && !name.startsWith("v2 ")) return;
  if (process.argv.includes("--checkpoint-only") && !name.startsWith("checkpoint ")) return;
  if (process.argv.includes("--journal-only") && !name.startsWith("journal ")) return;
  if (process.argv.includes("--owned-only") && !/^(journal |owned )/.test(name)) return;
  if (process.argv.includes("--resume-only") && !name.startsWith("resume ")) return;
  if (process.argv.includes("--worker-only") && !name.startsWith("worker ")) return;
  await callback(); checks.push(name); console.log("PASS " + name); }
function fixture(options = {}) {
  const base = path.join(root, "case-" + ++serial), targetRoot = path.join(base, "project"), packageRoot = path.join(base, "package");
  fs.mkdirSync(targetRoot, { recursive: true });
  if (options.git) {
    const emptyHooks = path.join(base, "empty-hooks"); fs.mkdirSync(emptyHooks);
    for (const args of [["init", "-b", "main"], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture"]]) {
      const result = spawnSync("git", ["-c", "core.hooksPath=" + emptyHooks, ...args], { cwd: targetRoot, encoding: "utf8", shell: false }); assert.equal(result.status, 0, result.stderr);
    }
  }
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
      log_dir: JSON.parse(configuration.args.find(arg => arg.startsWith("log_dir=")).slice("log_dir=".length)),
      sqlite_home: JSON.parse(configuration.args.find(arg => arg.startsWith("sqlite_home=")).slice("sqlite_home=".length)),
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
        await notify("item/completed", { threadId: thread, turnId: turn, item: { type: "functionCallOutput", name: "exec", id: "fixture-tool", output: "private command/output must not be retained" } });
        await notify("item/completed", { threadId: thread, turnId: turn, item: { type: "agentMessage", phase: "commentary", text: "Working on the admitted activity." } });
        await notify("item/completed", { threadId: thread, turnId: turn, item: { type: "agentMessage", phase: "final_answer", text: JSON.stringify({ outcome: options.reject && index === 2 ? "rejected" : "completed", summary: "Fixture result." }) } });
        await notify("turn/completed", { threadId: thread, turn: { id: turn, status: "completed" } });
        if (options.unverifiableStorage) fs.symlinkSync(f.base, path.join(f.dirs.control, "case/unverifiable-link"), "junction");
        if (options.transientStorage) put(f.dirs.control, "case/transient.tmp", "transient");
        return { turn: { id: turn } };
      },
      notify() {}, async flush() {}, async close() {
        session.closed = true;
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

function journalFixture(options = {}) {
  const f = fixture({ git: options.git }), model = JSON.parse(fs.readFileSync(f.configuration.model.path));
  if (options.stateMode) persistenceFixture(f, "sqlite", options.stateMode);
  model.contract_version = "agentic-process-model.v2"; model.operation_pins = {};
  if (options.waitAtEntry) {
    const activity = model.nodes.find(node => node.kind === "activity");
    model.nodes.push({ id: "external_wait", kind: "event", participant_ref: activity.participant_ref, branches: [
      { flow_id: "continue", node_id: model.entry, event_key: "continue_snapshot" }, { flow_id: "check", node_id: "late_check", event_key: "check_snapshot" }] },
      { ...activity, id: "late_check" }); model.entry = "external_wait";
  } else if (options.wait) {
    const activity = model.nodes.find(node => node.kind === "activity");
    const review = model.nodes.find(node => node.kind === "activity" && model.policies.find(policy => policy.id === node.policy_ref)?.independent_review);
    model.nodes.push({ id: "journal_wait", kind: "sequence", participant_ref: activity.participant_ref, children: [model.entry, "external_wait"] },
      { id: "external_wait", kind: "event", participant_ref: activity.participant_ref, branches: [
        { flow_id: "review", node_id: "late_review", event_key: "review_snapshot" }, { flow_id: "cancel", node_id: "late_cancel", event_key: "cancel_snapshot" }] },
      { ...(options.resumeReview ? review : activity), id: "late_review" }, { ...activity, id: "late_cancel" });
    model.entry = "journal_wait";
  }
  fs.writeFileSync(f.configuration.model.path, JSON.stringify(model)); f.configuration.model.sha256 = sha(JSON.stringify(model));
  const worker = fileURLToPath(new URL("../../src/adapters/agents/agentic-process-worker.mjs", import.meta.url));
  f.configuration.controller = { node_sha256: sha(fs.readFileSync(process.execPath)), worker_sha256: sha(fs.readFileSync(worker)),
    helper_path: "fixture", helper_sha256: "a".repeat(64), helper_source_sha256: "b".repeat(64) };
  const key = Buffer.alloc(32, 73), t = transport(f, options), controllerFactory = journalController(f, t, options);
  const open = (readSigningKey = () => key) => createJournaledNativeAllocation({ configuration: f.configuration, readSigningKey,
    ...(f.environment ? { environment: f.environment } : {}), ...(options.controlSource ? { controlSource: options.controlSource } : {}) }, { controllerFactory });
  Object.assign(f, { key, t, open, actor: open() }); return f;
}
function journalController(f, t, options = {}) {
  return () => ({ async checkAvailability() { return { available: true }; },
    async run(request, { onEvent }) {
      f.launches = (f.launches ?? 0) + 1; await options.beforeWorker?.(f);
      if (options.controllerFailure) throw Object.assign(new Error("FIXTURE_CONTROLLER_INTERRUPTED"), { code: "FIXTURE_CONTROLLER_INTERRUPTED" });
      const sent = JSON.parse(request.stdin);
      options.mutateAdmission?.(sent.allocation, f);
      if (options.realWorker) {
        const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../src/adapters/agents/agentic-process-worker.mjs", import.meta.url))], {
          input: JSON.stringify(sent), env: request.env, cwd: request.cwd, encoding: "utf8", shell: false, timeout: 30000,
        });
        f.worker = { status: child.status, stderr: child.stderr, stdout: child.stdout };
        await onEvent({ type: "stdout", bytes: Buffer.from(child.stdout) });
        return { outcome: "completed", termination_state: "confirmed", termination_proof: { active_processes: 0 } };
      }
      const allocationAuthority = createNativeAllocationWorkerAuthority({ configuration: f.configuration, authorization: sent.authorization, admission: sent.allocation,
        ...(f.environment ? { environment: f.environment } : {}) });
      const native = createProjectAgenticProcessExecution(f.configuration, { rpcFactory: t.rpcFactory, allocationAuthority, ...(f.environment ? { environment: f.environment } : {}) });
      const result = await native.run({ execute: true, authorization: sent.authorization });
      await options.afterWorker?.(f, result);
      await onEvent({ type: "stdout", bytes: Buffer.from(JSON.stringify(result)) });
      return { outcome: "completed", termination_state: options.treeUnknown ? "unknown" : "confirmed", termination_proof: options.treeUnknown ? null : { active_processes: 0 } };
    } });
}
async function readyResumeFixture(options = {}) {
  let claim = null;
  const controlSource = { async read() { return claim; }, async verify({ source }) {
    assert.deepEqual(source, claim); return { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) };
  } };
  const f = journalFixture({ ...options, wait: true, resumeReview: true, git: true, controlSource });
  f.auth = f.authorize(); f.auth.global_deadline_ms += 180000; f.auth.workflow_deadline_ms += 180000;
  assert.equal((await f.actor.run({ execute: true, authorization: f.auth })).status, "WAITING");
  const state = f.actor.readCheckpoint(1).state.instance, frame = inspectAgenticProcess(state).occurrences.find(row => row.node_id === "external_wait");
  f.request = f.actor.prepareControl(frame.occurrence_id);
  claim = { contract_version: "process-control-source.v1", source_kind: "external", authority_id: "fixture_review", source_event_id: "review-1",
    subject_sha256: "a".repeat(64), request_sha256: shadowHash(f.request), event_key: "review_snapshot", payload_sha256: "b".repeat(64), evidence_refs: [{ ref: "provider:review-1", sha256: "c".repeat(64) }] };
  f.claim = claim;
  if (options.uncaptured) return f;
  f.capture = await f.actor.captureControl({ occurrenceId: frame.occurrence_id, sourceRef: "review", write: true });
  if (!options.undelivered) await f.actor.deliverControl(f.capture.inbox_id, { write: true });
  return f;
}

if (process.argv[2] === "--resume-allocation") {
  try {
    const data = JSON.parse(fs.readFileSync(process.argv[3])), f = { ...data.fixture, launches: 0 }, key = Buffer.from(data.key_hex, "hex"), t = transport(f);
    const actor = createJournaledNativeAllocation({ configuration: f.configuration, readSigningKey: () => key,
      ...(f.environment ? { environment: f.environment } : {}) }, { controllerFactory: journalController(f, t) });
    const result = await actor.run({ execute: true, resume: true, authorization: data.authorization });
    process.stdout.write(JSON.stringify({ result, launches: f.launches, sessions: t.sessions.length,
      closed: t.sessions.every(row => row.closed), leaked_key: JSON.stringify(t.sessions.map(row => row.configuration)).includes(key.toString("base64")) }) + "\n");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
} else try {
  await check("worker private allocation IPC executes the fixed entry without native startup or retained key bytes", async () => {
    for (const badOwner of [false, true]) {
      const f = journalFixture({ realWorker: true, waitAtEntry: true, mutateAdmission(value) { if (badOwner) value.owner_id = "not-the-reserved-owner"; } });
      const result = await f.actor.run({ execute: true, authorization: f.authorize() });
      assert.equal(f.worker.status, badOwner ? 1 : 0, f.worker.stderr);
      assert.equal(result.status, badOwner ? "FAILED" : "WAITING", JSON.stringify(result));
      assert.equal(f.t.sessions.length, 0); assert.equal(f.t.calls.length, 0);
      if (badOwner) assert.equal(result.first_failure, "PROCESS_WORKER_ALLOCATION_CHANGED");
      else { assert.equal(f.actor.readCheckpoint(1).state.resources.length, 0); assert.equal(f.actor.inspect().allocations[0].consumption.responses_observed, 0); }
      const evidence = JSON.stringify({ result, journal: f.actor.inspect(), worker: f.worker });
      assert.equal(evidence.includes(f.key.toString("base64")), false); assert.equal(evidence.includes("key_base64"), false);
      for (const name of fs.readdirSync(f.dirs.control, { recursive: true }).filter(name => name.endsWith(".json")))
        assert.equal(fs.readFileSync(path.join(f.dirs.control, name), "utf8").includes(f.key.toString("base64")), false);
    }
  });
  await check("resume refuses a self-hashed control event without authenticated inbox provenance", async () => {
    const f = await readyResumeFixture({ uncaptured: true }), store = createAgenticProcessStore({ targetRoot: f.configuration.target_root, stateMode: "files" }), before = store.read("case");
    const delivery = controlDelivery(f.request, f.claim), forged = advanceAgenticProcess(before.record, { event_id: "forged_control", kind: "control", occurrence_id: f.request.occurrence_id, delivery });
    store.compareAndSwap(forged, before.content_sha256);
    await assert.rejects(f.open().run({ execute: true, authorization: f.auth, resume: true }), /CONTROL_NOT_AUTHENTICATED/);
    assert.equal(f.launches, 1); assert.equal(f.actor.inspect().allocations.length, 1); assert.equal(f.t.sessions.length, 2);
  });
  await check("resume refuses changed head before delivery and after an accepted event", async () => {
    const f = await readyResumeFixture({ undelivered: true });
    const commit = () => { const result = spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "new head"], { cwd: f.configuration.target_root, encoding: "utf8", shell: false }); assert.equal(result.status, 0, result.stderr); };
    commit(); await assert.rejects(f.actor.deliverControl(f.capture.inbox_id, { write: true }), /CONTROL_CONTEXT_CHANGED/);
    assert.equal(f.launches, 1); assert.equal(f.actor.inspect().allocations.length, 1);
    // Restore the original head explicitly, deliver, then advance it again.
    const reset = spawnSync("git", ["reset", "--soft", f.request.head], { cwd: f.configuration.target_root, encoding: "utf8", shell: false }); assert.equal(reset.status, 0, reset.stderr);
    await f.actor.deliverControl(f.capture.inbox_id, { write: true }); commit();
    await assert.rejects(f.open().run({ execute: true, authorization: f.auth, resume: true }), /CONTROL_CONTEXT_CHANGED/); assert.equal(f.launches, 1);
  });
  await check("resume requires the current dual projection before reserving another worker", async () => {
    const f = await readyResumeFixture({ stateMode: "dual" }), visible = path.join(f.configuration.target_root, "docs/audit/workflows/process-instances/case.json");
    fs.unlinkSync(visible);
    await assert.rejects(f.open().run({ execute: true, authorization: f.auth, resume: true }), /PROJECTION_RECONCILIATION_REQUIRED/);
    assert.equal(f.launches, 1); assert.equal(f.actor.inspect().allocations.length, 1);
    assert.equal((await f.open().deliverControl(f.capture.inbox_id, { write: true })).retained, true); assert.equal(fs.existsSync(visible), true);
  });
  await check("resume worker authenticates its exact reservation and does not accept a supplied owner", async () => {
    const f = await readyResumeFixture({ mutateAdmission(admission, f) { if (f.launches === 2) admission.owner_id = "other-owner"; } });
    const result = await f.open().run({ execute: true, authorization: f.auth, resume: true });
    assert.equal(result.status, "WAITING_FOR_RECONCILIATION"); assert.equal(result.first_failure, "PROCESS_WORKER_ALLOCATION_CHANGED");
    assert.equal(f.t.sessions.length, 2); assert.equal(f.actor.inspect().allocations.at(-1).phase, "reserved");
  });
  for (const stateMode of ["files", "dual", "db-only"]) await check(`resume ${stateMode}: authenticated event resumes owned native allocation with historical review exclusions and exact replay`, async () => {
    let claim = null, reads = 0, verifies = 0;
    const controlSource = {
      async read() { reads++; return claim; },
      async verify({ source }) { verifies++; assert.deepEqual(source, claim); return { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) }; },
    };
    const f = journalFixture({ stateMode, wait: true, resumeReview: true, git: true, controlSource }), auth = f.authorize();
    auth.global_deadline_ms += 180000; auth.workflow_deadline_ms += 180000;
    const first = await f.actor.run({ execute: true, authorization: auth }); assert.equal(first.status, "WAITING", JSON.stringify(first));
    const snapshot = f.actor.readCheckpoint(1), oldWriter = snapshot.state.resources.find(row => row.executor.contributions.length).executor;
    const frame = inspectAgenticProcess(snapshot.state.instance).occurrences.find(row => row.node_id === "external_wait");
    const noEvent = await f.open().run({ execute: true, authorization: auth, resume: true }); assert.equal(noEvent.status, "WAITING"); assert.equal(noEvent.native_started, false); assert.equal(f.launches, 1);
    const request = f.actor.prepareControl(frame.occurrence_id);
    assert.equal((await f.actor.captureControl({ occurrenceId: frame.occurrence_id, sourceRef: "review", write: true })).status, "WAITING");
    assert.equal(f.actor.inspect().allocations.length, 1); assert.equal(f.launches, 1);
    claim = { contract_version: "process-control-source.v1", source_kind: "external", authority_id: "fixture_review", source_event_id: "review-1",
      subject_sha256: "a".repeat(64), request_sha256: shadowHash(request), event_key: "review_snapshot", payload_sha256: "b".repeat(64),
      evidence_refs: [{ ref: "provider:review-1", sha256: "c".repeat(64) }] };
    const captured = await f.open().captureControl({ occurrenceId: frame.occurrence_id, sourceRef: "review", write: true });
    const delivered = await f.open().deliverControl(captured.inbox_id, { write: true }); assert.ok(delivered.cursor.ready.length > 0);
    const beforeResume = f.actor.inspect(), nextAuth = { ...auth, authorized_at_ms: Date.now() };
    let second;
    if (stateMode === "files") {
      const input = put(f.base, "resume-input.json", JSON.stringify({ fixture: { configuration: f.configuration, dirs: f.dirs, base: f.base }, key_hex: f.key.toString("hex"), authorization: nextAuth }));
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--resume-allocation", input], { encoding: "utf8", shell: false, timeout: 120000 });
      assert.equal(child.status, 0, child.stderr); const evidence = JSON.parse(child.stdout); second = evidence.result;
      assert.equal(evidence.launches, 1); assert.equal(evidence.sessions, 1); assert.equal(evidence.closed, true); assert.equal(evidence.leaked_key, false);
    } else second = await f.open().run({ execute: true, authorization: nextAuth, resume: true });
    assert.equal(second.status, "COMPLETED", JSON.stringify(second)); assert.equal(second.journal_phase, "closed"); assert.equal(f.launches, stateMode === "files" ? 1 : 2);
    const journal = f.open().inspect(); assert.equal(journal.allocations.length, 2);
    assert.equal(journal.allocations[1].limits.max_responses, auth.max_responses - journal.allocations[0].consumption.responses_observed);
    assert.equal(journal.allocations[1].limits.max_bytes, auth.max_bytes - journal.allocations[0].consumption.storage_debit_bytes);
    assert.deepEqual(journal.allocations[0], beforeResume.allocations[0]);
    const final = f.open().readCheckpoint(2), state = final.state.instance, last = state.events.filter(row => row.kind === "assign").at(-1);
    assert.equal(final.state.resources.length, 3); assert.equal(final.state.results.length, 4); assert.equal(f.t.sessions.length, stateMode === "files" ? 2 : 3);
    assert.ok(last.request.reviewed_contributors.some(row => row.agent_id === oldWriter.agent_id && row.lineage_id === oldWriter.lineage_id));
    assert.ok(!snapshot.state.resources.some(row => row.executor.execution_id === last.decision.execution_id));
    assert.equal(final.state.resources.find(row => row.executor.execution_id === oldWriter.execution_id).executor.contributions.length, oldWriter.contributions.length);
    assert.equal(state.events.filter(row => row.kind === "control").length, 1);
    const simulated = simulateAgenticProcess({ instanceId: state.instance_id, model: state.model, policyPins: state.policy_pins, scopeId: state.scope_id, events: state.events });
    assert.equal(simulated.trace.at(-1).instance_sha256, state.instance_sha256);
    const providerReads = reads, providerVerifies = verifies;
    assert.equal((await f.open().deliverControl(captured.inbox_id, { write: true })).retained, true);
    assert.deepEqual([reads, verifies], [providerReads, providerVerifies]); assert.equal(f.launches, stateMode === "files" ? 1 : 2);
    const serialized = JSON.stringify({ journal, final, sessions: f.t.sessions.map(row => row.configuration) });
    assert.equal(serialized.includes(f.key.toString("base64")), false); assert.equal(serialized.includes("key_base64"), false);
    assert.ok(f.t.sessions.at(-1).cfg.permissions[Object.keys(f.t.sessions.at(-1).cfg.permissions)[0]].filesystem[f.dirs.control.replaceAll("\\", "/")] === "deny");
  });
  await check("journal preview retains no files, reservation or native allocation", async () => {
    const f = journalFixture(), view = f.actor.preview(); assert.equal(view.phase, "absent"); assert.equal(view.written, false);
    assert.equal(f.actor.inspect(), null); assert.equal(f.launches, undefined); assert.equal(f.t.sessions.length, 0);
    assert.equal(fs.existsSync(path.join(f.configuration.target_root, "docs/audit/workflows/native-allocations")), false);
    await assert.rejects(f.actor.run({ execute: true, authorization: { approved: true } }), /EXPLICIT_AUTHORIZATION_REQUIRED/);
  });
  await check("journal seals actual owned observations and reopens in a new Node process without effects", async () => {
    const f = journalFixture(), result = await f.actor.run({ execute: true, authorization: f.authorize() });
    assert.equal(result.journal_phase, "closed", JSON.stringify(result)); assert.equal(result.owned_result.status, "COMPLETED");
    const record = f.actor.inspect(), entry = record.allocations[0]; assertNativeAllocationJournal(record);
    assert.equal(entry.consumption.responses_observed, 3); assert.equal(entry.tree_closed, true); assert.equal(entry.phase, "closed");
    assert.ok(entry.consumption.storage_debit_bytes > result.owned_result.worker_result.storage_budget_debit_bytes);
    assert.equal(f.actor.readCheckpoint(1).state.results.length, 3);
    const file = put(f.base, "reopen.json", JSON.stringify({ configuration: f.configuration, key: f.key.toString("hex") }));
    const module = new URL("../../src/application/runtime/journaled-native-allocation.mjs", import.meta.url).href;
    const script = `import fs from 'node:fs'; import {createJournaledNativeAllocation} from ${JSON.stringify(module)};
      const c=JSON.parse(fs.readFileSync(process.argv[1])); const h=createJournaledNativeAllocation({configuration:c.configuration,readSigningKey:()=>Buffer.from(c.key,'hex')});
      console.log(JSON.stringify({journal:h.inspect(),checkpoint:h.readCheckpoint(1)}));`;
    const reopened = spawnSync(process.execPath, ["--input-type=module", "-e", script, file], { encoding: "utf8", shell: false });
    assert.equal(reopened.status, 0, reopened.stderr); assert.deepEqual(JSON.parse(reopened.stdout).journal, record);
    assert.equal(JSON.parse(reopened.stdout).checkpoint.state.parent_closed, true); assert.equal(f.launches, 1);
    const auth = f.authorize(); auth.global_deadline_ms = entry.limits.global_deadline_ms; auth.workflow_deadline_ms = entry.limits.workflow_deadline_ms;
    await assert.rejects(f.open().run({ execute: true, authorization: auth }), /EXISTING_INSTANCE_REQUIRES_RECONCILIATION/); assert.equal(f.launches, 1);
  });
  await check("journal reservation fences a competing launch before any native effect", async () => {
    const f = journalFixture({ async beforeWorker(f) {
      assert.equal(f.open().inspect().allocations[0].phase, "reserved");
      await assert.rejects(f.open().run({ execute: true, authorization: f.authorize() }), /RECONCILIATION_REQUIRED/);
      assert.equal(f.t.sessions.length, 0);
    } });
    const result = await f.actor.run({ execute: true, authorization: f.authorize() }); assert.equal(result.journal_phase, "closed", JSON.stringify(result)); assert.equal(f.launches, 1);
  });
  await check("journal retains an interrupted reservation and never infers owner death or retries", async () => {
    const f = journalFixture({ controllerFailure: true }), result = await f.actor.run({ execute: true, authorization: f.authorize() });
    assert.equal(result.journal_phase, "reconciliation_required"); assert.equal(result.owned_result, null);
    assert.equal(f.open().inspect().allocations[0].phase, "reserved"); assert.equal(f.actor.preview().consumption.known, false);
    await assert.rejects(f.open().run({ execute: true, authorization: f.authorize() }), /RECONCILIATION_REQUIRED/); assert.equal(f.launches, 1);
  });
  await check("journal never promotes unknown tree termination to a successful allocation", async () => {
    const f = journalFixture({ treeUnknown: true }), result = await f.actor.run({ execute: true, authorization: f.authorize() });
    assert.equal(result.owned_result.worker_result.status, "COMPLETED"); assert.equal(result.journal_phase, "unresolved");
    assert.equal(result.status, "WAITING_FOR_RECONCILIATION"); assert.equal(result.retry, false);
    assert.equal(f.actor.inspect().allocations[0].tree_closed, false);
    await assert.rejects(f.open().run({ execute: true, authorization: f.authorize() }), /RECONCILIATION_REQUIRED/);
  });
  await check("journal rejected results stay failed with contributions retained and no fresh attempt", async () => {
    const f = journalFixture({ reject: true }), result = await f.actor.run({ execute: true, authorization: f.authorize() });
    assert.equal(result.journal_phase, "failed", JSON.stringify(result)); assert.equal(f.actor.readCheckpoint(1).state.results.at(-1).result.outcome, "rejected");
    await assert.rejects(f.open().run({ execute: true, authorization: f.authorize() }), /TERMINAL_FAILURE/);
  });
  await check("journal refuses self-hashed records and changed signing capabilities", async () => {
    const f = journalFixture(); await f.actor.run({ execute: true, authorization: f.authorize() });
    assert.throws(() => f.open(() => Buffer.alloc(32, 74)).inspect(), /NOT_AUTHENTICATED/);
    const record = f.actor.inspect(), file = path.join(f.configuration.target_root, "docs/audit", nativeJournalPath(record.journal_id));
    record.revision++; fs.writeFileSync(file, JSON.stringify(record)); assert.throws(() => f.actor.inspect(), /NOT_AUTHENTICATED/);
  });
  await check("journal authenticates checkpoint, owned closure and nested native evidence bytes after restart", async () => {
    for (const kind of ["checkpoint", "closure", "native-result"]) {
      const f = journalFixture(); await f.actor.run({ execute: true, authorization: f.authorize() }); const record = f.actor.inspect();
      const file = kind === "checkpoint" ? record.allocations[0].checkpoint.path : kind === "closure" ? record.allocations[0].closure_ref.path
        : path.join(f.dirs.control, "case", fs.readdirSync(path.join(f.dirs.control, "case")).find(name => name.endsWith("-native-result.json")));
      fs.appendFileSync(file, "\n"); assert.throws(() => f.open().readCheckpoint(1), /EVIDENCE_CHANGED/);
    }
  });
  await check("journal retains reconciliation when canonical state disappears after the native worker", async () => {
    const f = journalFixture({ afterWorker(f) { fs.unlinkSync(path.join(f.configuration.target_root, "docs/audit/workflows/process-instances/case.json")); } });
    const result = await f.actor.run({ execute: true, authorization: f.authorize() });
    assert.equal(result.owned_result.status, "COMPLETED"); assert.equal(result.journal_phase, "unresolved");
    assert.equal(f.actor.inspect().allocations[0].first_failure, "NATIVE_ALLOCATION_CANONICAL_CHANGED");
  });
  await check("journal refuses budget resets and malformed generation history", async () => {
    const f = journalFixture(); await f.actor.run({ execute: true, authorization: f.authorize() }); const record = f.actor.inspect();
    const auth = f.authorize(); auth.max_responses++; await assert.rejects(f.open().run({ execute: true, authorization: auth }), /LIMIT_INCREASE_UNAUTHORIZED/);
    const bad = structuredClone(record); bad.allocations[0].generation = 2; assert.throws(() => assertNativeAllocationJournal(bad), /GENERATION_INVALID/);
    const unknown = structuredClone(record); unknown.allocations[0].consumption = null; assert.throws(() => assertNativeAllocationJournal(unknown), /CLOSURE_UNCONFIRMED/);
    const excess = structuredClone(record); excess.allocations[0].consumption.storage_debit_bytes = excess.allocations[0].limits.max_bytes + 1;
    assert.throws(() => assertNativeAllocationJournal(excess), /CONSUMPTION_EXCEEDS_LIMIT/);
    const turn = f.authorize(); turn.global_deadline_ms = record.allocations[0].limits.global_deadline_ms;
    turn.workflow_deadline_ms = record.allocations[0].limits.workflow_deadline_ms; turn.max_turn_ms++;
    await assert.rejects(f.open().run({ execute: true, authorization: turn }), /LIMIT_INCREASE_UNAUTHORIZED/);
  });
  await check("journal event wait closes only the allocation and retains an uncompleted workflow", async () => {
    const f = journalFixture({ wait: true }), result = await f.actor.run({ execute: true, authorization: f.authorize() });
    assert.equal(result.journal_phase, "closed", JSON.stringify(result)); assert.equal(result.status, "WAITING");
    assert.equal(inspectAgenticProcess(f.open().readCheckpoint(1).state.instance).status, "WAITING");
    assert.equal(f.actor.inspect().allocations[0].consumption.responses_observed, 3); assert.equal(f.launches, 1);
  });
  for (const stateMode of ["dual", "db-only"]) await check(`journal canonical SQLite/${stateMode} retains authenticated allocation and projection policy`, async () => {
    const f = journalFixture({ stateMode }), result = await f.actor.run({ execute: true, authorization: f.authorize() });
    assert.equal(result.journal_phase, "closed", JSON.stringify(result)); const record = f.open().inspect();
    assert.equal(f.open().readCheckpoint(1).state.instance.instance_sha256, record.allocations[0].checkpoint.instance_sha256);
    assert.equal(fs.existsSync(path.join(f.configuration.target_root, "docs/audit", nativeJournalPath(record.journal_id))), stateMode === "dual");
    assert.equal(record.allocations.length, 1); assert.equal(f.launches, 1);
  });
  await check("journal keeps actual completed worker outcome when canonical closure recording fails", async () => {
    const f = journalFixture({ stateMode: "db-only", async afterWorker(f) {
      const { DatabaseSync } = await import("node:sqlite"); const db = new DatabaseSync(path.join(f.configuration.target_root, ".aidn/runtime/index/workflow-index.sqlite"));
      try { db.exec("CREATE TRIGGER refuse_native_closure BEFORE UPDATE ON artifacts WHEN NEW.path LIKE 'workflows/native-allocations/%' BEGIN SELECT RAISE(ABORT, 'fixture allocation closure refusal'); END;"); }
      finally { db.close(); }
    } });
    const result = await f.actor.run({ execute: true, authorization: f.authorize() });
    assert.equal(result.journal_phase, "reconciliation_required"); assert.equal(result.owned_result.status, "COMPLETED");
    assert.equal(result.status, "WAITING_FOR_RECONCILIATION"); assert.equal(result.retry, false);
    assert.equal(f.open().inspect().allocations[0].phase, "reserved");
    await assert.rejects(f.open().run({ execute: true, authorization: f.authorize() }), /RECONCILIATION_REQUIRED/); assert.equal(f.launches, 1);
  });
  function checkpoint(f, result) {
    assert.ok(result.native_checkpoint);
    const match = /^execution\/case\/([0-9]{5}-native-host-state\.json)$/.exec(result.native_checkpoint.ref); assert.ok(match);
    const data = fs.readFileSync(path.join(f.dirs.control, "case", match[1])); assert.equal(sha(data), result.native_checkpoint.sha256);
    const retained = JSON.parse(data); assertNativeHostState(retained.state);
    assert.equal(retained.state.instance.instance_sha256, result.instance_sha256);
    assert.equal(retained.responses_observed, result.responses_observed);
    assert.equal(new Set(retained.response_sha256).size, retained.responses_observed);
    assert.equal(retained.authorized_limits.configuration_sha256, shadowHash(f.configuration));
    assert.equal(retained.authorized_limits.global_deadline_ms, result.global_deadline_ms);
    assert.equal(retained.authorized_limits.workflow_deadline_ms, result.workflow_deadline_ms);
    assert.equal(retained.authorized_limits.max_responses, 6);
    assert.equal(retained.authorized_limits.max_bytes, 10 * 1024 * 1024);
    assert.equal(retained.resume_authority, "NOT_ESTABLISHED_SUPERVISOR_AND_AUTHENTICATED_JOURNAL_REQUIRED");
    assert.equal(JSON.stringify(retained).includes("developer_instructions"), false);
    return retained;
  }
  await check("checkpoint retains host-issued identities, contributions, results and observed accounting after closure", async () => {
    const f = fixture(), { result } = await run(f); assert.equal(result.status, "COMPLETED", JSON.stringify(result));
    const retained = checkpoint(f, result);
    assert.equal(retained.state.parent_closed, true); assert.equal(retained.state.resources.length, 2); assert.equal(retained.state.results.length, 3);
    assert.equal(retained.state.resources[0].executor.contributions.length, 2);
    assert.equal(retained.state.resources[1].executor.contributions.length, 0);
    assert.equal(retained.state.native_usage.thread_counters.length, 2);
    const missing = structuredClone(retained.state); missing.resources[0].executor.contributions = [];
    assert.throws(() => assertNativeHostState(missing), { code: "NATIVE_HOST_STATE_CONTRIBUTION_MISSING" });
  });
  await check("checkpoint preserves rejected results and writer lineage instead of manufacturing a successful resume", async () => {
    const f = fixture(), { result } = await run(f, { reject: true }); assert.equal(result.status, "FAILED");
    const retained = checkpoint(f, result);
    assert.equal(retained.state.results.at(-1).result.outcome, "rejected");
    assert.equal(retained.state.resources[0].executor.contributions.length, 2);
    assert.equal(inspectAgenticProcess(retained.state.instance).status, "FAILED");
  });
  await check("checkpoint retains a possible contributor after an interrupted native turn with no accepted result", async () => {
    const f = fixture(), { result } = await run(f, { foreignThread: true }); assert.equal(result.first_failure, "PROCESS_SESSION_FOREIGN_THREAD");
    const retained = checkpoint(f, result);
    assert.equal(retained.state.results.length, 0); assert.equal(retained.state.resources.length, 1);
    assert.equal(retained.state.resources[0].executor.contributions.length, 1);
    assert.equal(retained.state.instance.events.at(-1).kind, "assign");
    assert.equal(retained.state.native_usage.incomplete_turns_may_be_unknown, true);
  });
  await check("checkpoint refuses changed native evidence after closure instead of sealing a successful result", async () => {
    const f = fixture(), { result } = await run(f, { corruptEvidenceOnClose: true });
    assert.equal(result.status, "FAILED"); assert.equal(result.first_failure, "PROCESS_EXECUTION_EVIDENCE_CHANGED");
    assert.equal(result.native_checkpoint, null); assert.equal(result.responses_observed, 3);
  });
  await check("v2 native-only JSON executes real role ports and preserves exact replay without operation fallback", async () => {
    const f = fixture(), model = JSON.parse(fs.readFileSync(f.configuration.model.path));
    model.contract_version = "agentic-process-model.v2"; model.operation_pins = {};
    const text = JSON.stringify(model); fs.writeFileSync(f.configuration.model.path, text); f.configuration.model.sha256 = sha(text);
    const { result, sessions } = await run(f);
    assert.equal(result.status, "COMPLETED", JSON.stringify(result)); assert.equal(result.responses_observed, 3);
    assert.equal(sessions.length, 2); assert.equal(result.native_parent_closure.closed, true);
    const retained = createAgenticProcessStore({ targetRoot: f.configuration.target_root, stateMode: "files" }).read("case").record;
    assert.equal(retained.contract_version, "agentic-process-instance.v2"); assert.equal(retained.profile, "structured-agentic-process.v2");
    assert.equal(retained.events.filter(event => event.kind === "assign").length, 3);
    assert.equal(retained.events.filter(event => event.kind === "result").length, 3);
    const simulation = simulateAgenticProcess({ instanceId: retained.instance_id, model: retained.model, policyPins: retained.policy_pins,
      scopeId: retained.scope_id, events: retained.events });
    assert.equal(simulation.trace.at(-1).instance_sha256, retained.instance_sha256);
  });
  await check("v2 native-only event wait closes resources and cannot restart its history as a pristine instance", async () => {
    const f = fixture(), model = JSON.parse(fs.readFileSync(f.configuration.model.path)), originalEntry = model.entry;
    model.contract_version = "agentic-process-model.v2"; model.operation_pins = {}; model.entry = "with_wait";
    const activity = model.nodes.find(node => node.kind === "activity"), participant_ref = activity.participant_ref;
    model.nodes.push({ id: "with_wait", kind: "sequence", participant_ref, children: [originalEntry, "external_wait"] },
      { id: "external_wait", kind: "event", participant_ref, branches: [
        { flow_id: "review", node_id: "late_review", event_key: "review_snapshot" },
        { flow_id: "checks", node_id: "late_checks", event_key: "checks_snapshot" }] },
      { ...activity, id: "late_review" }, { ...activity, id: "late_checks" });
    const text = JSON.stringify(model); fs.writeFileSync(f.configuration.model.path, text); f.configuration.model.sha256 = sha(text);
    const { result, sessions } = await run(f); assert.equal(result.status, "WAITING", JSON.stringify(result));
    assert.equal(result.responses_observed, 3); assert.equal(sessions.length, 2); assert.equal(result.native_parent_closure.closed, true);
    const retained = createAgenticProcessStore({ targetRoot: f.configuration.target_root, stateMode: "files" }).read("case").record;
    assert.equal(inspectAgenticProcess(retained).status, "WAITING");
    const t = transport(f);
    const reopened = createProjectAgenticProcessExecution(f.configuration, { rpcFactory: t.rpcFactory });
    assert.equal(reopened.preview().written, false);
    await assert.rejects(reopened.run({ execute: true, authorization: f.authorize() }), /PROCESS_EXECUTION_EXISTING_INSTANCE_REQUIRES_RECONCILIATION/);
    assert.equal(t.sessions.length, 0);
  });
  await check("v2 native-only composition refuses raw control facts before startup", () => {
    const f = fixture(), model = JSON.parse(fs.readFileSync(f.configuration.model.path)); model.contract_version = "agentic-process-model.v2"; model.operation_pins = {};
    const text = JSON.stringify(model); fs.writeFileSync(f.configuration.model.path, text); f.configuration.model.sha256 = sha(text);
    const control = JSON.stringify({ contract_version: "agentic-process-control-scenario.v1", initial_facts: { approved: true }, events: [] });
    f.configuration.control_scenario = { path: put(f.base, "control.json", control), sha256: sha(control) };
    const t = transport(f);
    assert.throws(() => createProjectAgenticProcessExecution(f.configuration, { rpcFactory: t.rpcFactory }), /PROCESS_EXECUTION_CONTROL_PROFILE_UNSUPPORTED/);
    assert.equal(t.sessions.length, 0); assert.deepEqual(fs.readdirSync(f.dirs.control), []);
  });
  await check("v2 native-only composition refuses raw control events before startup", () => {
    const f = fixture(), model = JSON.parse(fs.readFileSync(f.configuration.model.path)); model.contract_version = "agentic-process-model.v2"; model.operation_pins = {};
    const text = JSON.stringify(model); fs.writeFileSync(f.configuration.model.path, text); f.configuration.model.sha256 = sha(text);
    const control = JSON.stringify({ contract_version: "agentic-process-control-scenario.v1", initial_facts: {},
      events: [{ after_results: 0, event: { event_id: "raw-approval", kind: "facts", facts: { approved: true } } }] });
    f.configuration.control_scenario = { path: put(f.base, "control.json", control), sha256: sha(control) };
    const t = transport(f);
    assert.throws(() => createProjectAgenticProcessExecution(f.configuration, { rpcFactory: t.rpcFactory }), /PROCESS_EXECUTION_CONTROL_PROFILE_UNSUPPORTED/);
    assert.equal(t.sessions.length, 0); assert.deepEqual(fs.readdirSync(f.dirs.control), []);
  });
  await check("native tool observations retain counts and hashes without commands, outputs, arguments or reasoning", () => {
    const observation = summarizeAgenticNativeToolItem({ type: "functionCallOutput", name: "exec", output: 'private-secret Process running with session ID 123' });
    assert.equal(observation.tool, "exec"); assert.equal(observation.poll_marker_observed, true);
    assert.equal(JSON.stringify(observation).includes("private-secret"), false);
    assert.equal(summarizeAgenticNativeToolItem({ type: "reasoning", content: ["private-secret"] }), null);
    assert.equal(summarizeAgenticNativeToolItem({ type: "dynamicToolCall", tool: { secret: "private-secret" }, arguments: { password: "private-secret" } }).tool, "other");
  });
  await check("broker replacement preserves bytes across distinct control/product roots and cleans failed atomic staging", () => {
    const base = fs.mkdtempSync(path.join(root, "broker-")), product = path.join(base, "product"), control = path.join(base, "control");
    fs.mkdirSync(product); fs.mkdirSync(control);
    const file = path.join(product, "app.mjs"), data = Buffer.from("export const value = 2;\n"); fs.writeFileSync(file, data);
    republishBrokerProductFile(file, data, { fsPort: { ...fs, renameSync(from, to) {
      if (path.dirname(from) !== path.dirname(to)) throw Object.assign(Error("cross-volume"), { code: "EXDEV" });
      fs.renameSync(from, to);
    } } });
    assert.deepEqual(fs.readFileSync(file), data); assert.deepEqual(fs.readdirSync(product), ["app.mjs"]);
    for (const code of ["EXDEV", "EACCES"]) {
      assert.throws(() => republishBrokerProductFile(file, Buffer.from("replacement"), { fsPort: { ...fs, renameSync() { throw Object.assign(Error("private path must not escape"), { code }); } } }),
        error => error.code === "PROCESS_EXECUTION_BROKER_REPUBLISH_FAILED" && error.fs_code === code && /^[a-f0-9]{64}$/.test(error.path_sha256) && !error.message.includes("private"));
      assert.deepEqual(fs.readFileSync(file), data); assert.deepEqual(fs.readdirSync(product), ["app.mjs"]);
    }
  });
  await check("explicit pinned host scenario drives XML event, two loop iterations, collections and calls without model polling", async () => {
    const f = fixture(), example = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agentic-process/compatible-work-and-review.json", import.meta.url)));
    example.policies[0].allowed_permissions.push("write:product");
    const model = compileBpmnProcess({ xml: fs.readFileSync(new URL("../../tests/fixtures/agentic-process/extended-delivery.bpmn", import.meta.url), "utf8"),
      modelId: "native-control-fixture", revision: 1, participantId: "delivery", roles: example.roles, policies: example.policies,
      processRef: "ExtendedDelivery" }).model;
    const modelPath = put(f.base, "extended-model.json", JSON.stringify(model));
    f.configuration.model = { path: modelPath, sha256: sha(fs.readFileSync(modelPath)) };
    f.configuration.instructions = Object.fromEntries(model.nodes.filter(n => n.kind === "activity").map(n => [n.id, n.policy_ref === "review" ? "Review without correcting the work." : "Change value to 2."]));
    const initial = createAgenticProcess({ instanceId: "case", model, scopeId: "fixture", policyPins: agenticPolicyPins(model), facts: { refinement_done: false } });
    const wait = inspectAgenticProcess(initial).occurrences.find(row => row.wait_reason === "event");
    const scenario = { contract_version: "agentic-process-control-scenario.v1", initial_facts: { refinement_done: false }, events: [
      { after_results: 0, event: { event_id: "host-message", kind: "message", occurrence_id: wait.occurrence_id, correlation_id: wait.correlation_id, event_key: "approved" } },
      { after_results: 2, event: { event_id: "host-facts", kind: "facts", facts: { refinement_done: true } } }] };
    assertAgenticControlScenario(scenario);
    for (const invalid of [{ ...scenario, events: [...scenario.events].reverse() },
      { ...scenario, events: [{ after_results: 0, event: { event_id: "spoof", kind: "assign" } }] }]) {
      assert.throws(() => assertAgenticControlScenario(invalid), /PROCESS_CONTROL_SCENARIO_INVALID/);
    }
    const scenarioPath = put(f.base, "control-scenario.json", JSON.stringify(scenario));
    f.configuration.control_scenario = { path: scenarioPath, sha256: sha(fs.readFileSync(scenarioPath)) };
    const t = transport(f), auth = { ...f.authorize(), max_responses: 20, global_deadline_ms: Date.now() + 120000, workflow_deadline_ms: Date.now() + 110000 };
    const composition = createProjectAgenticProcessExecution(f.configuration, { rpcFactory: t.rpcFactory });
    assert.equal(composition.preview().written, false); assert.equal(t.sessions.length, 0);
    const result = await composition.run({ execute: true, authorization: auth });
    assert.equal(result.status, "COMPLETED", JSON.stringify(result)); assert.equal(result.responses_observed, 10);
    assert.equal(result.control_scenario.events_applied, 2); assert.deepEqual(t.sessions.map(s => s.turns), [9, 1]);
    const retained = createAgenticProcessStore({ targetRoot: f.configuration.target_root, stateMode: "files" }).read("case").record;
    assert.equal(retained.events.filter(e => e.kind === "message").length, 1);
    assert.equal(retained.events.filter(e => e.kind === "facts").length, 1);
    assert.equal(retained.events.filter(e => e.kind === "result").length, 10);
    assert.equal(t.sessions.every(s => s.closed), true);
    fs.appendFileSync(scenarioPath, " ");
    assert.throws(() => composition.preview(), /PROCESS_EXECUTION_INPUT_CHANGED/);
  });
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
  await check("native-only composition refuses the operation profile before native allocation", () => {
    const f = fixture(), model = { contract_version: "agentic-process-model.v2", model_id: "operations", revision: 1, participants: [{ id: "project" }], roles: [], policies: [],
      entry: "reload", operation_pins: { reload: "a".repeat(64) }, nodes: [{ id: "reload", kind: "operation", participant_ref: "project", binding_ref: "reload" }] };
    const text = JSON.stringify(model); fs.writeFileSync(f.configuration.model.path, text); f.configuration.model.sha256 = sha(text);
    const t = transport(f);
    assert.throws(() => createProjectAgenticProcessExecution(f.configuration, { rpcFactory: t.rpcFactory }), /PROCESS_EXECUTION_MODEL_PROFILE_UNSUPPORTED/);
    assert.equal(t.sessions.length, 0); assert.deepEqual(fs.readdirSync(f.dirs.control), []);
  });
  await check("actual internal CLI preview and fixed worker EOF path stay offline and reject unauthenticated execution", () => {
    const f = fixture(), text = JSON.stringify(f.configuration), file = put(f.base, "configuration.json", text);
    const runner = fileURLToPath(new URL("../runtime/run-agentic-process.mjs", import.meta.url));
    const command = spawnSync(process.execPath, [runner, "--preview", "--configuration", file, "--configuration-sha256", sha(text)],
      { encoding: "utf8", timeout: 10000, windowsHide: true });
    assert.equal(command.status, 0, command.stderr); assert.equal(JSON.parse(command.stdout).native_started, false);
    const publicCli = fileURLToPath(new URL("../../bin/aidn.mjs", import.meta.url));
    const ordinary = spawnSync(process.execPath, [publicCli, "runtime", "workflow-run", "--target", f.configuration.target_root,
      "--configuration", file, "--json"], { encoding: "utf8", timeout: 10000, windowsHide: true });
    assert.equal(ordinary.status, 0, ordinary.stderr + ordinary.stdout);
    const selected = JSON.parse(ordinary.stdout);
    assert.equal(selected.engine, "agentic"); assert.equal(selected.preview.native_started, false); assert.equal(selected.written, false);
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
  await check("live metadata disappearance is zero retained bytes; permission errors and missing required roots still stop", async () => {
    for (const mode of ["child-ENOENT", "child-EACCES", "root-ENOENT"]) {
      const f = fixture(), output = path.join(f.dirs.control, "case"), transient = path.join(output, "transient.tmp"), original = fs.lstatSync;
      let injected = false;
      fs.lstatSync = function(file, ...args) {
        if (!injected && file === (mode === "root-ENOENT" ? output : transient) && fs.existsSync(transient)) {
          injected = true;
          if (mode === "child-ENOENT") fs.unlinkSync(transient);
          throw Object.assign(Error("fixture metadata race"), { code: mode.endsWith("EACCES") ? "EACCES" : "ENOENT" });
        }
        return original.call(this, file, ...args);
      };
      try {
        const { result } = await run(f, { transientStorage: true }); assert.equal(injected, true);
        if (mode === "child-ENOENT") {
          assert.equal(result.status, "COMPLETED", JSON.stringify(result)); assert.equal(result.responses_observed, 3);
          assert.ok(result.storage_observation.vanished_entries >= 1); assert.equal(result.storage_observation.first_read_failure, null);
        } else {
          assert.equal(result.first_failure, "PROCESS_EXECUTION_STORAGE_UNVERIFIABLE"); assert.equal(result.status, "FAILED");
          const diagnostic = result.storage_observation.first_read_failure;
          assert.equal(diagnostic.error_code, mode.endsWith("EACCES") ? "EACCES" : "ENOENT");
          assert.equal(diagnostic.operation, "lstatSync"); assert.equal(diagnostic.entry_sha256, sha(Buffer.from(mode === "root-ENOENT" ? output : transient)));
          assert.ok(Number.isSafeInteger(diagnostic.observed_at_ms)); assert.equal(Object.hasOwn(diagnostic, "path"), false);
          assert.equal(result.responses_observed, 1); assert.equal(result.consumption.thread_counters.length, 1);
        }
        assert.equal(result.native_parent_closure.closed, true);
      } finally { fs.lstatSync = original; }
    }
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
  await check("default JSON creation enters the actual production host without replacing its pristine checkpoint", async () => {
    const f = fixture(), model = JSON.parse(fs.readFileSync(f.configuration.model.path));
    const service = createProjectWorkflowInstanceService({ targetRoot: f.configuration.target_root });
    const initial = service.initialize({ instanceId: f.configuration.instance_id, model, write: true });
    assert.equal(initial.record.events.length, 0);
    const { result, sessions } = await run(f);
    assert.equal(result.status, "COMPLETED", JSON.stringify(result)); assert.equal(sessions.length, 2);
    assert.equal(service.inspect(f.configuration.instance_id).cursor.status, "COMPLETED");
  });
  await check("real composition: same session across compatible roles; distinct independent reviewer and canonical results", async () => {
    const f = fixture(), { result, sessions } = await run(f);
    assert.equal(result.status, "COMPLETED", JSON.stringify(result)); assert.equal(sessions.length, 2);
    assert.deepEqual(sessions.map(session => session.turns), [2, 1]); assert.equal(result.responses_observed, 3);
    const receipts = fs.readdirSync(path.join(f.dirs.control, "case")).filter(name => name.endsWith("-native-result.json"))
      .map(name => JSON.parse(fs.readFileSync(path.join(f.dirs.control, "case", name))));
    assert.equal(receipts.length, 3);
    assert(receipts.every(row => row.exchanges.native_responses === 1 && row.exchanges.observed_tool_items === 1));
    const observations = fs.readdirSync(path.join(f.dirs.control, "case")).filter(name => name.endsWith("-native-tool.json"))
      .map(name => fs.readFileSync(path.join(f.dirs.control, "case", name), "utf8"));
    assert.equal(observations.length, 3); assert(observations.every(text => !text.includes("private command/output")));
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
  await check("owned reservation cannot spend the closure reserve and still launch a worker", async () => {
    const f = fixture(), worker = fileURLToPath(new URL("../../src/adapters/agents/agentic-process-worker.mjs", import.meta.url));
    f.configuration.controller = { node_sha256: sha(fs.readFileSync(process.execPath)), worker_sha256: sha(fs.readFileSync(worker)),
      helper_path: "fixture", helper_sha256: "a".repeat(64), helper_source_sha256: "b".repeat(64) };
    const originalDate = Date.now, descriptor = Object.getOwnPropertyDescriptor(performance, "now"), originalMono = performance.now.bind(performance);
    let offset = 0, launched = false, reserved = false;
    try {
      Date.now = () => originalDate() + offset;
      Object.defineProperty(performance, "now", { configurable: true, value: () => originalMono() + offset });
      await assert.rejects(runOwnedAgenticProcess({ configuration: f.configuration, authorization: f.authorize(), execute: true }, {
        controllerFactory: () => ({ async checkAvailability() { return { available: true }; }, async run() { launched = true; throw Error("must not launch"); } }),
        allocationObserver: { beforeLaunch() { reserved = true; offset = 45000; return { generation: 1 }; }, afterClosure() { throw Error("no closure exists"); } },
      }), /CLOSURE_RESERVE/);
      assert.equal(reserved, true); assert.equal(launched, false);
    } finally { Date.now = originalDate; if (descriptor) Object.defineProperty(performance, "now", descriptor); else delete performance.now; }
  });
  await check("owned entry transmits the original deadline and requires process-tree termination proof", async () => {
    for (const confirmed of [true, false]) {
      const f = fixture(), worker = fileURLToPath(new URL("../../src/adapters/agents/agentic-process-worker.mjs", import.meta.url));
      f.configuration.controller = { node_sha256: sha(fs.readFileSync(process.execPath)), worker_sha256: sha(fs.readFileSync(worker)), helper_path: "fixture", helper_sha256: "a".repeat(64), helper_source_sha256: "b".repeat(64) };
      const auth = f.authorize(); auth.authorized_at_ms -= 12000; let sent;
      const result = await runOwnedAgenticProcess({ configuration: f.configuration, authorization: auth, execute: true }, { controllerFactory: () => ({
        async checkAvailability() { return { available: true }; },
        async run(request, { onEvent }) { sent = JSON.parse(request.stdin); assert.ok(request.maxDurationMs <= auth.global_deadline_ms - Date.now());
          await onEvent({ type: "stdout", bytes: Buffer.from(JSON.stringify({ contract_version: "agentic-process-execution-result.v1", status: "COMPLETED", first_failure: null, storage_budget_debit_bytes: 0, global_deadline_ms: sent.authorization.global_deadline_ms })) });
          return { outcome: "completed", termination_state: confirmed ? "confirmed" : "unknown", termination_proof: confirmed ? { active_processes: 0 } : null }; },
      }) });
      assert.equal(sent.authorization.global_deadline_ms, auth.global_deadline_ms);
      assert.equal(result.first_failure, confirmed ? null : "PROCESS_EXECUTION_TREE_CLOSE_UNCONFIRMED");
      assert.ok(result.elapsed_global_ms >= 12000);
    }
  });
  await check("owned footer preserves stdout-only worker results, unknown bytes and closure write failures", async () => {
    for (const mode of ["STDOUT_ONLY_STORAGE_LIMIT", "STDOUT_ONLY_STORAGE_UNVERIFIABLE", "STDOUT_ONLY_WRITE_FAILED", "outer-write-failure", "outer-first-failure", "unknown-bytes", "outer-stat-failure"]) {
      const f = fixture(), worker = fileURLToPath(new URL("../../src/adapters/agents/agentic-process-worker.mjs", import.meta.url));
      f.configuration.controller = { node_sha256: sha(fs.readFileSync(process.execPath)), worker_sha256: sha(fs.readFileSync(worker)), helper_path: "fixture", helper_sha256: "a".repeat(64), helper_source_sha256: "b".repeat(64) };
      const auth = f.authorize(), originalWrite = fs.writeFileSync, originalExists = fs.existsSync;
      let closureWrites = 0;
      fs.writeFileSync = function(file, ...args) {
        if (file === path.join(f.dirs.control, "case-CLOSURE.json")) { closureWrites++; throw Object.assign(Error("fixture full disk"), { code: "ENOSPC" }); }
        return originalWrite.call(this, file, ...args);
      };
      fs.existsSync = function(file) {
        if (mode === "outer-stat-failure" && file === path.join(f.dirs.control, "case/RESULT.json")) throw Object.assign(Error("fixture unreadable"), { code: "EACCES" });
        return originalExists.call(this, file);
      };
      try {
        const prior = mode === "outer-first-failure" ? null : "PROCESS_EXECUTION_CANCELLED";
        const payload = { contract_version: "agentic-process-execution-result.v1", status: prior ? "FAILED" : "COMPLETED", first_failure: prior,
          global_deadline_ms: auth.global_deadline_ms, storage_budget_debit_bytes: mode === "unknown-bytes" || mode === "STDOUT_ONLY_STORAGE_UNVERIFIABLE" ? null : 100,
          responses_observed: 1, consumption: { observed_tokens: 42 }, ...(mode.startsWith("STDOUT_ONLY") ? { seal: mode } : {}) };
        const result = await runOwnedAgenticProcess({ configuration: f.configuration, authorization: auth, execute: true }, { controllerFactory: () => ({
          async checkAvailability() { return { available: true }; },
          async run(request, { onEvent }) { await onEvent({ type: "stdout", bytes: Buffer.from(JSON.stringify(payload)) });
            return { outcome: "completed", termination_state: "confirmed", termination_proof: { active_processes: 0 } }; },
        }) });
        assert.equal(result.first_failure, prior ?? "PROCESS_EXECUTION_SEAL_WRITE_FAILED"); assert.equal(result.status, "FAILED");
        assert.deepEqual(result.worker_result, payload); assert.equal(result.process_tree.termination_proof.active_processes, 0);
        assert.equal(result.seal, mode.startsWith("STDOUT_ONLY") ? mode : ["unknown-bytes", "outer-stat-failure"].includes(mode) ? "STDOUT_ONLY_STORAGE_UNVERIFIABLE" : "STDOUT_ONLY_WRITE_FAILED");
        assert.equal(closureWrites, mode.startsWith("outer-") && mode !== "outer-stat-failure" ? 1 : 0);
        assert.ok(Buffer.byteLength(JSON.stringify(result)) < 65536);
      } finally { fs.writeFileSync = originalWrite; fs.existsSync = originalExists; }
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
