import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { randomUUID } from "node:crypto";
import { createLocalAgentGitIntegration } from "../../src/adapters/runtime/local-agent-git-integration.mjs";
import { createAgentTaskIntegrationService } from "../../src/application/runtime/agent-task-integration-service.mjs";
import { fingerprintAgentExecutionValue as fingerprint } from "../../src/core/agents/agent-execution-contracts.mjs";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-git-integration-"));
const nonce = randomUUID(); fs.writeFileSync(path.join(temp, "owner"), nonce);
const repo = path.join(temp, "repository espace été"), resources = path.join(temp, "run resources été");
const ref = "refs/heads/codex/fixture-integration";
const author = { name: "AIDN Fixture", email: "fixture@example.invalid", timestamp: "2026-01-01T00:00:00Z" };
let checks = 0, ordinal = 0, cleanup = false;
const test = async (name, body) => { await body(); checks++; process.stdout.write(`PASS ${name}\n`); };
const git = (root, args, options = {}) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)));
  const result = spawnSync("git", ["-C", root, "-c", "user.name=AIDN Fixture", "-c", "user.email=fixture@example.invalid",
    "-c", "commit.gpgSign=false", "-c", `core.hooksPath=${path.join(temp, "no-hooks")}`, ...args], {
    encoding: "utf8", shell: false, windowsHide: true, timeout: 10000,
    env: { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null" }, ...options,
  });
  assert.equal(result.status, 0, `fixture git ${args[0]} failed: ${result.stderr}`); return result.stdout.trimEnd();
};
function factory(overrides = {}) {
  return createLocalAgentGitIntegration({ repositoryRoot: repo, resourcesRoot: resources, integrationRef: ref,
    verifyTermination: async ({ binding }) => ({ confirmed: true, attempt_id: binding.attempt_id }), ...overrides });
}
let port, base, identity;
async function worker(inputSha = base, instance = port) {
  const attemptId = `attempt.${++ordinal}`, workspace = instance.allocateAttemptWorkspace({ runId: "run.fixture", taskId: `task.${ordinal}`, attemptId, inputSha });
  const prepared = await instance.prepareAttemptWorkspace({ workspace, inputSha });
  const binding = { run_id: "run.fixture", task_id: `task.${ordinal}`, attempt_id: attemptId, cwd: prepared.cwd,
    branch: prepared.branch, input_sha: inputSha, repository_identity_sha256: prepared.repository_identity_sha256 };
  const baseline = await instance.captureBaseline({ binding }); return { binding, baseline };
}
async function source(file, content, inputSha = base) {
  const state = await worker(inputSha); fs.writeFileSync(path.join(state.binding.cwd, file), content);
  const capture = await port.captureTaskChanges({ ...state, termination: { fixture: true }, scope: [{ path: file, operations: ["update"] }] });
  return { ...state, capture, commit: await port.createTaskCommit({ capture, expectedCaptureSha256: capture.capture_sha256, commitIdentity: author }) };
}
async function rejectChange(mutator, scope, code, instance = port) {
  const state = await worker(base, instance); await mutator(state.binding.cwd);
  await assert.rejects(instance.captureTaskChanges({ ...state, termination: {}, scope }), error => error.code === code);
}
try {
  fs.mkdirSync(repo); git(repo, ["init", "--initial-branch=dev"]);
  fs.mkdirSync(path.join(repo, "src")); fs.mkdirSync(path.join(repo, "protected"));
  for (const file of ["a.txt", "b.txt", "conflict.txt"]) fs.writeFileSync(path.join(repo, "src", file), "base\n");
  fs.writeFileSync(path.join(repo, "protected", "sentinel.txt"), "preserve\n");
  fs.writeFileSync(path.join(repo, ".gitignore"), "ignored-*\n");
  git(repo, ["add", "."]); git(repo, ["commit", "-m", "fixture base"]); base = git(repo, ["rev-parse", "HEAD"]);
  await test("construction and allocation create no resources or integration ref", async () => {
    port = factory(); const plan = port.allocateAttemptWorkspace({ runId: "run.fixture", taskId: "task.pure", attemptId: "attempt.pure", inputSha: base });
    assert(!fs.existsSync(resources)); assert(!fs.existsSync(plan.cwd)); identity = await port.inspectIntegration({}, { phase: "head" });
    assert.equal(identity.head_sha, null); assert(!fs.existsSync(resources));
  });
  await test("initial integration ref is explicit and cannot reset a different head", async () => {
    assert.equal((await port.initializeIntegration({ baseSha: base })).head_sha, base);
    assert.equal((await port.initializeIntegration({ baseSha: base })).head_sha, base);
  });
  let a, b, first, second;
  await test("capture survives JSON reload; exact task commit leaves worker HEAD and index unchanged", async () => {
    const state = await worker(); const before = git(state.binding.cwd, ["ls-files", "--stage"]);
    fs.writeFileSync(path.join(state.binding.cwd, "src/a.txt"), "accepted A été\n");
    const capture = await factory().captureTaskChanges({ binding: state.binding, baseline: JSON.parse(JSON.stringify(state.baseline)), termination: {}, scope: [{ path: "src/a.txt", operations: ["update"] }] });
    const fresh = factory();
    // Captures are created by the same supervising adapter that commits them.
    const captured = await fresh.captureTaskChanges({ ...state, termination: {}, scope: [{ path: "src/a.txt", operations: ["update"] }] });
    const commit = await fresh.createTaskCommit({ capture: captured, expectedCaptureSha256: captured.capture_sha256, commitIdentity: author });
    assert.equal(git(state.binding.cwd, ["rev-parse", "HEAD"]), base); assert.equal(git(state.binding.cwd, ["ls-files", "--stage"]), before);
    assert.equal(git(repo, ["show", `${commit.source_sha}:src/a.txt`]), "accepted A été"); assert.equal(commit.parent_sha, base);
    assert.equal(capture.capture_sha256, captured.capture_sha256); a = { ...state, commit, capture: captured };
  });
  await test("source commit replays after crash before acceptance without moving worker refs", async () => {
    const replay = await factory().createTaskCommit({ capture: JSON.parse(JSON.stringify(a.capture)), expectedCaptureSha256: a.capture.capture_sha256, commitIdentity: author });
    assert.deepEqual(replay, a.commit); assert.equal(git(a.binding.cwd, ["rev-parse", "HEAD"]), base);
  });
  await test("independent task captures same base in another worktree", async () => {
    b = await source("src/b.txt", "accepted B\n"); assert.equal(a.commit.parent_sha, b.commit.parent_sha);
  });
  await test("prepared worktree does not move integration ref and survives fresh adapter", async () => {
    first = await port.prepareIntegration({ integrationId: "integration.a", sourceSha: a.commit.source_sha, expectedParent: base, commitIdentity: author });
    assert.equal(first.status, "prepared"); assert.equal(git(repo, ["rev-parse", ref]), base);
    assert.equal((await factory().inspectIntegration(first, { phase: "prepared" })).head_sha, base);
    assert.equal(git(first.workspace.cwd, ["show", ":src/a.txt"]), "accepted A été");
  });
  await test("CAS interruption is reconciled without duplicate application", async () => {
    const applied = await port.compareAndSwapIntegration({ prepared: first }); assert.equal(applied.status, "applied");
    const resumed = await factory().compareAndSwapIntegration({ prepared: JSON.parse(JSON.stringify(first)) });
    assert.equal(resumed.status, "already_applied"); assert.equal(resumed.observed_sha, first.result_sha);
    assert.deepEqual(applied.evidence, resumed.evidence);
    await assert.rejects(port.initializeIntegration({ baseSha: base }), error => error.code === "AGENT_GIT_REF_DIVERGED");
  });
  await test("prepared evidence exact bytes cannot be replaced by equivalent JSON", async () => {
    const proof = first.evidence[0], file = path.join(resources, proof.ref), original = fs.readFileSync(file);
    try {
      fs.appendFileSync(file, " ");
      await assert.rejects(factory().inspectIntegration(first, { phase: "prepared" }), error => error.code === "AGENT_GIT_PREPARED_PROOF_MISMATCH");
    } finally { fs.writeFileSync(file, original); }
    await factory().inspectIntegration(first, { phase: "prepared" });
  });
  await test("second independent source integrates atop first; dependent reads both real results", async () => {
    second = await port.prepareIntegration({ integrationId: "integration.b", sourceSha: b.commit.source_sha, expectedParent: first.result_sha, commitIdentity: author });
    await port.compareAndSwapIntegration({ prepared: second });
    const dependent = await worker(second.result_sha);
    assert.equal(fs.readFileSync(path.join(dependent.binding.cwd, "src/a.txt"), "utf8"), "accepted A été\n");
    assert.equal(fs.readFileSync(path.join(dependent.binding.cwd, "src/b.txt"), "utf8"), "accepted B\n");
    assert.equal(git(repo, ["rev-parse", `${second.result_sha}^`]), first.result_sha);
  });
  await test("outside tracked and ignored mutations are refused", async () => {
    for (const file of ["protected/sentinel.txt", "ignored-new.txt"]) await rejectChange(root => fs.writeFileSync(path.join(root, file), "escape\n"),
      [{ path: "src/a.txt", operations: ["update"] }], "AGENT_GIT_CHANGE_OUTSIDE_SCOPE");
  });
  await test("control metadata and baseline corruption are refused", async () => {
    await rejectChange(root => fs.writeFileSync(path.join(root, "AGENTS.md"), "unsafe"), [{ path: "AGENTS.md", operations: ["add"] }], "AGENT_GIT_SCOPE_INVALID");
    const state = await worker(), baseline = JSON.parse(JSON.stringify(state.baseline)); baseline.files["src/a.txt"].sha256 = "0".repeat(64);
    await assert.rejects(port.captureTaskChanges({ ...state, baseline, termination: {}, scope: [{ path: "src/a.txt", operations: ["update"] }] }), error => error.code === "AGENT_GIT_BASELINE_REQUIRED");
  });
  await test("termination verifier cannot be replaced by caller boolean", async () => {
    const noStop = factory({ verifyTermination: async () => ({ confirmed: false }) });
    await rejectChange(root => fs.writeFileSync(path.join(root, "src/a.txt"), "changed"), [{ path: "src/a.txt", operations: ["update"] }], "AGENT_GIT_TERMINATION_UNCONFIRMED", noStop);
  });
  await test("index edits and submodule index entries are refused", async () => {
    const state = await worker(); git(state.binding.cwd, ["update-index", "--add", "--cacheinfo", "160000", base, "module"]);
    await assert.rejects(port.captureTaskChanges({ ...state, termination: {}, scope: [{ path: "module", operations: ["add"] }] }), error => error.code === "AGENT_GIT_UNSUPPORTED_INDEX_ENTRY");
  });
  await test("executable index mode changes cannot bypass exact file permissions", async () => {
    const state = await worker(); git(state.binding.cwd, ["update-index", "--chmod=+x", "src/a.txt"]);
    await assert.rejects(port.captureTaskChanges({ ...state, termination: {}, scope: [{ path: "src/a.txt", operations: ["update"] }] }), error => error.code === "AGENT_GIT_AUTHORITY_CHANGED");
  });
  await test("hard links and directory redirects are refused", async () => {
    await rejectChange(root => fs.linkSync(path.join(root, "src/a.txt"), path.join(root, "linked.txt")), [{ path: "linked.txt", operations: ["add"] }], "AGENT_GIT_UNSAFE_FILE");
    await rejectChange(root => fs.symlinkSync(path.join(repo, "protected"), path.join(root, "redirect"), process.platform === "win32" ? "junction" : "dir"), [{ path: "src/a.txt", operations: ["update"] }], "AGENT_GIT_PATH_REDIRECT");
  });
  await test("ambiguous movement requires verified supervisor admission pairs", async () => {
    const scope = [{ path: "src/a.txt", operations: ["move"] }, { path: "src/moved.txt", operations: ["move-destination"] }];
    const move = root => fs.renameSync(path.join(root, "src/a.txt"), path.join(root, "src/moved.txt"));
    await rejectChange(move, scope, "AGENT_GIT_MOVE_PROOF_REQUIRED");
    const moving = factory({ verifyMoves: async () => [{ source: "src/a.txt", destination: "src/moved.txt" }] }), state = await worker(base, moving); move(state.binding.cwd);
    const capture = await moving.captureTaskChanges({ ...state, termination: {}, scope });
    const commit = await moving.createTaskCommit({ capture, expectedCaptureSha256: capture.capture_sha256, commitIdentity: author });
    assert.equal(git(repo, ["show", `${commit.source_sha}:src/moved.txt`]), "base");
    assert(!git(repo, ["ls-tree", commit.source_sha, "--", "src/a.txt"]));
  });
  await test("mutation between capture and commit preserves diagnosis and is refused", async () => {
    const state = await worker(); fs.writeFileSync(path.join(state.binding.cwd, "src/a.txt"), "before capture");
    const capture = await port.captureTaskChanges({ ...state, termination: {}, scope: [{ path: "src/a.txt", operations: ["update"] }] });
    fs.writeFileSync(path.join(state.binding.cwd, "src/a.txt"), "after capture");
    await assert.rejects(port.createTaskCommit({ capture, expectedCaptureSha256: capture.capture_sha256, commitIdentity: author }), error => error.code === "AGENT_GIT_CAPTURE_CHANGED");
    assert.equal(fs.readFileSync(path.join(state.binding.cwd, "src/a.txt"), "utf8"), "after capture");
  });
  await test("conflict leaves the integration worktree and index intact without moving ref", async () => {
    const left = await source("src/conflict.txt", "left\n"), right = await source("src/conflict.txt", "right\n");
    const accepted = await port.prepareIntegration({ integrationId: "conflict.left", sourceSha: left.commit.source_sha, expectedParent: second.result_sha, commitIdentity: author });
    await port.compareAndSwapIntegration({ prepared: accepted });
    const conflict = await port.prepareIntegration({ integrationId: "conflict.right", sourceSha: right.commit.source_sha, expectedParent: accepted.result_sha, commitIdentity: author });
    assert.equal(conflict.status, "conflict"); assert(git(conflict.workspace.cwd, ["ls-files", "--unmerged"]));
    assert.equal(git(repo, ["rev-parse", ref]), accepted.result_sha);
    assert(fs.readFileSync(path.join(conflict.workspace.cwd, "src/conflict.txt"), "utf8").includes("<<<<<<<"));
  });
  await test("unexpected ref blocks old prepared replay without reset", async () => {
    const before = git(repo, ["rev-parse", ref]);
    await assert.rejects(port.compareAndSwapIntegration({ prepared: second }), error => error.code === "AGENT_GIT_REF_DIVERGED");
    assert.equal(git(repo, ["rev-parse", ref]), before);
  });
  await test("external Git filters fail closed without invocation", async () => {
    git(repo, ["config", "filter.fixture.clean", "command-that-must-not-run"]);
    await assert.rejects(port.inspectIntegration({}, { phase: "head" }), error => error.code === "AGENT_GIT_EXTERNAL_DRIVER_UNSUPPORTED");
    git(repo, ["config", "--unset", "filter.fixture.clean"]);
  });
  await test("Git operations leave supervisor heartbeat timers runnable", async () => {
    let ticks = 0; const timer = setInterval(() => ticks++, 5);
    try { await worker(); assert(ticks > 2, "Git preparation must yield to the supervisor"); }
    finally { clearInterval(timer); }
  });
  await test("crash before durable integration journal preserves prepared files and refuses recalculation", async () => {
    const parent = git(repo, ["rev-parse", ref]), task = await source("src/b.txt", "prejournal\n", parent);
    const prepared = await port.prepareIntegration({ integrationId: "prejournal", sourceSha: task.commit.source_sha, expectedParent: parent, commitIdentity: author });
    const before = fs.readFileSync(path.join(resources, prepared.evidence[0].ref));
    await assert.rejects(factory().prepareIntegration({ integrationId: "prejournal", sourceSha: task.commit.source_sha, expectedParent: parent, commitIdentity: author }), error => error.code === "AGENT_GIT_PREPARATION_EXISTS");
    assert.equal(git(repo, ["rev-parse", ref]), parent); assert(fs.readFileSync(path.join(resources, prepared.evidence[0].ref)).equals(before));
    assert.equal((await factory().inspectIntegration(prepared, { phase: "prepared" })).head_sha, parent);
  });
  await test("Git timeout settles without close and preserves fenced operation until verified reconciliation", async () => {
    const owned = path.join(temp, "blocked-git-operations"), isolatedRef = "refs/heads/codex/blocked-operation";
    let capturedArgs, killed = 0, launches = 0;
    const fakeSpawn = (executable, argv, options) => {
      launches++;
      const child = new EventEmitter(); child.pid = 424242;
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.kill = () => { killed++; return false; }; child.unref = () => {};
      if (!argv.includes("update-ref")) {
        setImmediate(() => {
          let text = "", status = 0;
          if (argv.includes("--git-common-dir")) text = path.join(repo, ".git");
          else if (argv.includes("--show-object-format")) text = "sha1";
          else if (argv.includes(`${base}^{commit}`)) text = base;
          else if (argv.includes(`${isolatedRef}^{commit}`)) status = 128;
          else assert(argv.includes("config"), "unexpected fixture Git invocation");
          child.stdout.end(text + "\n"); child.emit("close", status, null);
        });
      } else capturedArgs = argv;
      return child; // Parent/descendant holding stdio never emits close.
    };
    const options = { resourcesRoot: owned, integrationRef: isolatedRef, spawnProcess: fakeSpawn, commandTimeoutMs: 100, stopGraceMs: 20 };
    const blocked = factory(options), started = performance.now();
    await assert.rejects(blocked.initializeIntegration({ baseSha: base }), error => error.code === "AGENT_GIT_TERMINATION_UNCONFIRMED");
    assert(performance.now() - started < 3000); assert.equal(killed, 1);
    for (const control of ["checkout.workers=1", "gc.auto=0", "maintenance.auto=false"]) assert(capturedArgs.includes(control));
    const state = await blocked.inspectGitOperations(), pending = state.operations.find(value => value.recovery_required);
    assert(pending); assert.equal(pending.observed.pid, 424242); assert.equal(pending.closed.parent_closed, false);
    assert.equal(pending.closed.descendants_termination, "unconfirmed"); assert.equal(pending.intent.repository_identity_sha256, identity.repository_identity_sha256);
    assert.equal(pending.intent.ref, isolatedRef); assert(!JSON.stringify(pending).includes("env"));
    const count = launches, files = fs.readdirSync(path.join(owned, "git-operations"));
    assert.deepEqual((await factory(options).inspectGitOperations()).operations, state.operations);
    await assert.rejects(factory(options).initializeIntegration({ baseSha: base }), error => error.code === "AGENT_GIT_RECOVERY_REQUIRED");
    await assert.rejects(factory(options).inspectIntegration({}, { phase: "head" }), error => error.code === "AGENT_GIT_RECOVERY_REQUIRED");
    assert.equal(launches, count); assert.deepEqual(fs.readdirSync(path.join(owned, "git-operations")), files);
    await assert.rejects(blocked.reconcileGitOperation({ operationId: pending.operation_id, proof: {} }), error => error.code === "AGENT_GIT_OPERATION_VERIFIER_REQUIRED");
    await assert.rejects(factory({ ...options, verifyGitTermination: async () => true }).reconcileGitOperation({ operationId: pending.operation_id, proof: {} }), error => error.code === "AGENT_GIT_TERMINATION_UNCONFIRMED");
    const recovery = factory({ ...options, verifyGitTermination: async ({ operation }) => ({ confirmed: true, operation_id: operation.operation_id,
      intent_sha256: operation.intent_sha256, descendants_stopped: true, git_operations_stopped: true }) });
    await recovery.reconcileGitOperation({ operationId: pending.operation_id, proof: { fixture: "memory-only-process-never-started" } });
    assert((await recovery.inspectGitOperations()).operations.every(value => !value.recovery_required));
    assert.equal((await factory({ resourcesRoot: owned, integrationRef: isolatedRef }).initializeIntegration({ baseSha: base })).head_sha, base);
  });
  await test("integration service checks immutable durable intent before CAS", async () => {
    const calls = [], sourceTask = await source("src/a.txt", "service change\n", git(repo, ["rev-parse", ref]));
    let intent, revision = 1, crash = true;
    const store = {
      async prepareIntegration({ integration }) { calls.push("prepared"); if (intent) assert.deepEqual(integration, intent); else intent = structuredClone(integration);
        return { control_revision: revision, integration: structuredClone(intent), prepared_sha256: fingerprint(intent) }; },
      async recordIntegrationApplied({ proof }) { calls.push("applied"); assert(proof.evidence.length); if (crash) { crash = false; throw new Error("injected-after-CAS"); } return { control_revision: ++revision }; },
    };
    const service = createAgentTaskIntegrationService({ git: port, store });
    const supervisor = { owner_id: "supervisor", generation: 1, lease_id: "lease.1" };
    const pending = await service.prepare({ runId: "run.fixture", planSha256: "a".repeat(64), taskId: sourceTask.binding.task_id,
      attemptId: sourceTask.binding.attempt_id, acceptanceSha256: "b".repeat(64), sequence: 1, integrationId: "service.integration",
      sourceSha: sourceTask.commit.source_sha, parentSha: sourceTask.binding.input_sha, supervisor, expectedControlRevision: revision, commitIdentity: author });
    await assert.rejects(service.applyPrepared({ prepared: pending.prepared, preparedSha256: pending.prepared_sha256, supervisor, expectedControlRevision: revision }), /injected-after-CAS/);
    const done = await service.applyPrepared({ prepared: JSON.parse(JSON.stringify(pending.prepared)), preparedSha256: pending.prepared_sha256, supervisor, expectedControlRevision: revision });
    assert.equal(done.observed.status, "already_applied"); assert.deepEqual(calls, ["prepared", "prepared", "applied", "prepared", "applied"]);
  });
  assert.equal(git(repo, ["rev-parse", "dev"]), base);
} finally {
  const resolved = fs.realpathSync.native(temp), parent = fs.realpathSync.native(os.tmpdir());
  assert.equal(path.dirname(resolved).toLowerCase(), parent.toLowerCase());
  assert.equal(fs.readFileSync(path.join(resolved, "owner"), "utf8"), nonce);
  fs.rmSync(resolved, { recursive: true, force: true }); cleanup = !fs.existsSync(resolved);
}
assert(cleanup); process.stdout.write(JSON.stringify({ status: "PASS", checks, cleanup: "PASS", postgres: "NOT_RUN", native_codex: "NOT_RUN" }) + "\n");
