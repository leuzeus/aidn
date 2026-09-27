import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createLocalAgentGitIntegration } from "../../src/adapters/runtime/local-agent-git-integration.mjs";
import { fingerprintAgentExecutionValue as fingerprint } from "../../src/core/agents/agent-execution-contracts.mjs";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-run-workspaces-")), nonce = randomUUID();
fs.writeFileSync(path.join(temp, "owner"), nonce);
const repo = path.join(temp, "repository été"), resources = path.join(temp, "resources été"), ref = "refs/heads/codex/run-fixture";
let count = 0;
const check = async (name, operation) => { await operation(); count++; process.stdout.write(`PASS ${name}\n`); };
const git = (cwd, args) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  const output = spawnSync("git", ["-C", cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgSign=false", ...args], {
    env: { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null" }, encoding: "utf8", timeout: 10000, windowsHide: true });
  assert.equal(output.status, 0, output.stderr); return output.stdout.trim();
};
const make = (extra = {}) => createLocalAgentGitIntegration({ repositoryRoot: repo, resourcesRoot: resources, integrationRef: ref,
  verifyTermination: async () => ({ confirmed: true }), verifyCleanupTermination: async () => ({ confirmed: true }), ...extra });
try {
  await check("read-only execution journals survive restart and reject a foreign termination runner", async () => {
    const repositoryRoot = path.join(temp, "journal-repo"), common = path.join(repositoryRoot, ".git"), resourcesRoot = path.join(temp, "journal-resources");
    fs.mkdirSync(repositoryRoot); fs.mkdirSync(common); fs.mkdirSync(resourcesRoot);
    fs.writeFileSync(path.join(resourcesRoot, "owner.json"), JSON.stringify({ repository_identity_sha256: fingerprint({ common_dir: common, object_format: "sha1" }), ref }));
    let count = 0;
    const options = { repositoryRoot, resourcesRoot, journalReadOperations: true, requireConfirmedGitTermination: true,
      spawnProcess: () => { throw new Error("forbidden spawn fallback"); }, runGitProcess: async (request, { onEvent }) => {
        count++; const runner = { runner_id: request.operation_id, pid: 5555, started_at: "2026-09-27T00:00:00Z", job_name: "Local\\aidn-execution-" + "d".repeat(32) };
        await onEvent({ type: "prepared", ...runner, suspended: true, job_assigned: true });
        const output = request.args.includes("--git-common-dir") ? common : request.args.includes("--show-object-format") ? "sha1"
          : request.args.includes("config") ? "" : "1".repeat(40);
        await onEvent({ type: "stdout", bytes: Buffer.from(output) });
        return { outcome: "completed", reason_code: "PROCESS_EXITED", termination_state: "confirmed", exit_code: 0, signal: null,
          termination_proof: { ...runner, active_processes: 0, method: "FIXTURE_ONLY" } };
      } };
    const adapter = make(options); await adapter.inspectIntegration({}, { phase: "head" });
    const records = await make(options).inspectGitOperations(); assert.equal(count, 4); assert.equal(records.operations.length, 4);
    assert(records.operations.every(row => row.intent.effect_class === "read-only" && row.recovery_required === false));
    const chosen = records.operations[0], file = path.join(resourcesRoot, "git-operations", `${chosen.operation_id}.closed.json`);
    const changed = JSON.parse(fs.readFileSync(file)); changed.termination_proof.runner_id = randomUUID(); fs.writeFileSync(file, JSON.stringify(changed));
    assert((await make(options).inspectGitOperations()).operations.find(row => row.operation_id === chosen.operation_id).recovery_required);
    await assert.rejects(make(options).inspectIntegration({}, { phase: "head" }), /AGENT_GIT_RECOVERY_REQUIRED/); assert.equal(count, 4);
  });
  await check("prepared catalog refuses aliased roots, branches and worktree identities before effects", () => {
    const row = (taskId, suffix) => ({ task_id: taskId, task_contract_sha256: "a".repeat(64), workspace: { cwd: path.join(temp, `catalog-${suffix}`),
      branch: `codex/${suffix}`, worktree_id: `root.${suffix}`, input_sha: "1".repeat(40) }, preparation: { state: {}, preimage_sha256: fingerprint({}) } });
    const catalog = { contract_version: "agent-prepared-workspaces.v1", preparation_id: "fixture", base_sha: "1".repeat(40), workspaces: [row("a", "a"), row("b", "b")] };
    assert.equal(typeof make({ preparedWorkspaces: catalog }).allocateAttemptWorkspace, "function");
    for (const field of ["cwd", "branch", "worktree_id"]) {
      const altered = structuredClone(catalog); altered.workspaces[1].workspace[field] = altered.workspaces[0].workspace[field];
      assert.throws(() => make({ preparedWorkspaces: altered }), /AGENT_GIT_PREPARED_CATALOG_INVALID/);
      if (field !== "worktree_id") {
        altered.workspaces[1].workspace[field] = altered.workspaces[0].workspace[field].toUpperCase();
        assert.throws(() => make({ preparedWorkspaces: altered }), /AGENT_GIT_PREPARED_CATALOG_INVALID/);
      }
    }
  });
  await check("unclaimed preparation admits only the exact catalog creation journal and refuses foreign or pending operations", async () => {
    const repositoryRoot = path.join(temp, "unclaimed-repository"), common = path.join(repositoryRoot, ".git"), resourcesRoot = path.join(temp, "unclaimed-resources");
    fs.mkdirSync(repositoryRoot); fs.mkdirSync(common); fs.writeFileSync(path.join(common, "config"), "fixture");
    const base = "1".repeat(40), branches = new Map(); let launches = 0, cleanupHead = base, removals = 0;
    const options = { repositoryRoot, resourcesRoot, requireConfirmedGitTermination: true,
      spawnProcess: () => { throw new Error("forbidden spawn fallback"); }, runGitProcess: async (request, { onEvent }) => {
        launches++; const args = request.args.slice(request.args.indexOf("rerere.autoupdate=false") + 1), cwd = request.cwd;
        const runner = { runner_id: request.operation_id, pid: 7777, started_at: "2026-09-27T00:00:00Z", job_name: "Local\\aidn-execution-" + "e".repeat(32) };
        await onEvent({ type: "prepared", ...runner, suspended: true, job_assigned: true });
        let output = "", status = 0;
        if (args[0] === "worktree" && args[1] === "add") {
          const branch = args[3], worker = args[4], gitDir = path.join(common, "worktrees", path.basename(worker));
          fs.mkdirSync(worker); fs.mkdirSync(gitDir, { recursive: true }); branches.set(worker, branch);
          fs.writeFileSync(path.join(worker, ".git"), `gitdir: ${gitDir}\n`); fs.writeFileSync(path.join(gitDir, "HEAD"), `ref: refs/heads/${branch}\n`); fs.writeFileSync(path.join(gitDir, "index"), "fixture-index");
        } else if (args[0] === "worktree" && args[1] === "list") output = [...branches.keys()].map(worker => `worktree ${worker}\0`).join("");
        else if (args[0] === "worktree" && args[1] === "remove") { removals++; throw new Error("fixture deletion must not occur"); }
        else if (args.includes("--git-common-dir")) output = common;
        else if (args.includes("--show-object-format")) output = "sha1";
        else if (args.includes("--absolute-git-dir")) output = path.join(common, "worktrees", path.basename(cwd));
        else if (args[0] === "symbolic-ref") output = args.includes("--short") ? branches.get(cwd) : `refs/heads/${branches.get(cwd)}`;
        else if (args[0] === "rev-parse") {
          if (args.at(-1) === `${ref}^{commit}`) output = cleanupHead;
          else if (args.at(-1).startsWith("refs/heads/")) status = 128;
          else output = args.at(-1).endsWith("^{tree}") ? "2".repeat(40) : base;
        }
        await onEvent({ type: "stdout", bytes: Buffer.from(output) });
        return { outcome: status ? "failed" : "completed", reason_code: status ? "PROCESS_FAILED" : "PROCESS_EXITED", termination_state: "confirmed", exit_code: status, signal: null,
          termination_proof: { ...runner, active_processes: 0, method: "FIXTURE_ONLY" } };
      } };
    const preparing = make(options), row = await preparing.prepareUnassignedWorkspace({ preparationId: "prepared.unclaimed", taskId: "a", taskContractSha256: "a".repeat(64), baseSha: base });
    const sealed = await preparing.sealPreparedAttemptWorkspace({ preparedWorkspace: row });
    const catalog = { contract_version: "agent-prepared-workspaces.v1", preparation_id: "prepared.unclaimed", base_sha: base, workspaces: [sealed] };
    const inspect = () => make({ ...options, preparedWorkspaces: catalog }).inspectUnclaimedPreparation({ preparedWorkspaces: catalog });
    const before = fs.readdirSync(resourcesRoot).sort(), observed = await inspect();
    assert.deepEqual(fs.readdirSync(resourcesRoot).sort(), before); assert.equal(observed.operations.length, 1);
    assert.equal(observed.observation.workspaces[0].creation_operation_id, observed.operations[0].operation_id);
    assert.deepEqual((await inspect()).observation, observed.observation);
    const first = observed.operations[0], directory = path.join(resourcesRoot, "git-operations"), firstFile = path.join(directory, `${first.operation_id}.intent.json`);
    const retained = Object.fromEntries(["intent", "observed", "closed"].map(suffix => [suffix, fs.readFileSync(path.join(directory, `${first.operation_id}.${suffix}.json`))]));
    for (const foreign of [{ invocation_sha256: "f".repeat(64) }, { executable: "foreign-git" }, { input_sha256: "f".repeat(64) }]) {
      const changed = { ...first.intent, ...foreign }, digest = fingerprint(changed); fs.writeFileSync(firstFile, JSON.stringify(changed));
      for (const suffix of ["observed", "closed"]) fs.writeFileSync(path.join(directory, `${first.operation_id}.${suffix}.json`), JSON.stringify({ ...JSON.parse(retained[suffix]), intent_sha256: digest }));
      await assert.rejects(inspect(), /AGENT_GIT_UNCLAIMED_MUTATION_UNEXPECTED/);
      for (const [suffix, bytes] of Object.entries(retained)) fs.writeFileSync(path.join(directory, `${first.operation_id}.${suffix}.json`), bytes);
    }
    const duplicate = randomUUID(), duplicatedIntent = { ...first.intent, operation_id: duplicate }, duplicatedDigest = fingerprint(duplicatedIntent);
    fs.writeFileSync(path.join(directory, `${duplicate}.intent.json`), JSON.stringify(duplicatedIntent));
    const priorLaunches = launches; await assert.rejects(inspect(), /AGENT_GIT_RECOVERY_REQUIRED/); assert.equal(launches, priorLaunches);
    fs.writeFileSync(path.join(directory, `${duplicate}.observed.json`), JSON.stringify({ ...first.observed, operation_id: duplicate, runner_id: duplicate, intent_sha256: duplicatedDigest }));
    fs.writeFileSync(path.join(directory, `${duplicate}.closed.json`), JSON.stringify({ ...first.closed, operation_id: duplicate, intent_sha256: duplicatedDigest,
      termination_proof: { ...first.closed.termination_proof, runner_id: duplicate } }));
    await assert.rejects(inspect(), /AGENT_GIT_UNCLAIMED_MUTATION_UNEXPECTED/);
    for (const suffix of ["intent", "observed", "closed"]) fs.unlinkSync(path.join(directory, `${duplicate}.${suffix}.json`));
    fs.writeFileSync(path.join(row.workspace.cwd, "foreign.txt"), "changed");
    await assert.rejects(inspect(), /AGENT_GIT_PREPARATION_CHANGED/);
    fs.unlinkSync(path.join(row.workspace.cwd, "foreign.txt"));
    const cleanupPort = make(options), resource = await cleanupPort.prepareCleanupRetention({ resourceId: "resource.unclaimed", kind: "attempt_worktree", cwd: row.workspace.cwd, attemptId: "attempt.unclaimed" });
    const cleanup = { cleanup_id: "cleanup.unclaimed", integration_ref: ref, integrated_sha: base, resources: [resource] }, ownership = { owner_id: "fixture", generation: 1 };
    await assert.rejects(cleanupPort.removeOwnedWorktree({ resource, cleanup, ownership, verifyAuthority: async () => {
      cleanupHead = "3".repeat(40); return { cleanup_sha256: fingerprint(cleanup), resource_sha256: fingerprint(resource), ownership, control_revision: 1 };
    } }), /AGENT_GIT_CLEANUP_HEAD_CHANGED/);
    assert.equal(removals, 0); assert(fs.existsSync(resource.cwd));
    assert(!fs.readdirSync(resourcesRoot).some(name => name.endsWith(".removed.json") || name.startsWith("cleanup-") && name.endsWith(".intent.json")));
  });
  if (!process.argv.includes("--journal-only")) {
  fs.mkdirSync(repo); git(repo, ["init", "--initial-branch=dev"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "initial\n"); fs.writeFileSync(path.join(repo, "b.txt"), "initial\n");
  git(repo, ["add", "."]); git(repo, ["commit", "-m", "initial"]); const base = git(repo, ["rev-parse", "HEAD"]);
  const preparing = make(), rows = [];
  await check("explicit preparation creates three distinct unassigned roots without integration ref", async () => {
    for (const taskId of ["a", "b", "dependent"]) {
      const row = await preparing.prepareUnassignedWorkspace({ preparationId: "prep.fixture", taskId, taskContractSha256: "a".repeat(64), baseSha: base });
      fs.mkdirSync(path.join(row.workspace.cwd, ".aidn")); fs.writeFileSync(path.join(row.workspace.cwd, ".aidn", "receipt-fixture.json"), '{"fixture":true}\n');
      rows.push(await preparing.sealPreparedAttemptWorkspace({ preparedWorkspace: row }));
    }
    assert.equal(new Set(rows.map(row => row.workspace.cwd)).size, 3);
    assert.equal((await preparing.inspectIntegration({}, { phase: "head" })).head_sha, null);
  });
  const catalog = { contract_version: "agent-prepared-workspaces.v1", preparation_id: "prep.fixture", base_sha: base, workspaces: rows };
  const port = make({ preparedWorkspaces: catalog });
  const allocation = (taskId, inputSha = base) => port.allocateAttemptWorkspace({ runId: "run.fixture", taskId, attemptId: "attempt." + taskId, inputSha });
  const binding = workspace => ({ run_id: "run.fixture", task_id: workspace.prepared_task_id, attempt_id: "attempt." + workspace.prepared_task_id,
    cwd: workspace.cwd, input_sha: workspace.input_sha });
  await check("catalog allocation and inspection preserve every prepared preimage", async () => {
    for (const row of rows) {
      assert.equal(allocation(row.task_id).cwd, row.workspace.cwd);
      assert.equal((await port.inspectPreparedAttemptWorkspace({ preparedWorkspace: row, expectedPreparationSha256: row.preparation.preimage_sha256 })).preimage_sha256, row.preparation.preimage_sha256);
    }
    assert.throws(() => allocation("foreign"), error => error.code === "AGENT_GIT_PREPARED_WORKSPACE_UNAVAILABLE");
  });
  await check("adoption requires current authority and rejects dirty prepared roots", async () => {
    const workspace = allocation("a");
    await assert.rejects(port.prepareAttemptWorkspace({ workspace, inputSha: base }), /AGENT_GIT_ADOPTION_AUTHORITY_REQUIRED/);
    fs.writeFileSync(path.join(workspace.cwd, "untracked.txt"), "foreign\n");
    await assert.rejects(port.prepareAttemptWorkspace({ workspace, inputSha: base, attemptBinding: binding(workspace), verifyAuthority: async () => {} }), /AGENT_GIT_PREPARATION_CHANGED/);
    fs.unlinkSync(path.join(workspace.cwd, "untracked.txt"));
  });
  await check("unchanged-base adoption replays only the exact same completed receipt", async () => {
    const workspace = allocation("a"); let called = 0;
    const options = { workspace, inputSha: base, attemptBinding: binding(workspace), verifyAuthority: async () => { called++; } };
    const first = await port.prepareAttemptWorkspace(options), replay = await make({ preparedWorkspaces: catalog }).prepareAttemptWorkspace(options);
    assert.deepEqual(first, replay); assert.equal(called, 2);
    assert.equal(git(workspace.cwd, ["rev-parse", "HEAD"]), base);
  });
  fs.writeFileSync(path.join(repo, "a.txt"), "accepted A\n"); git(repo, ["add", "a.txt"]); git(repo, ["commit", "-m", "first predecessor"]);
  fs.writeFileSync(path.join(repo, "b.txt"), "accepted B\n"); git(repo, ["add", "b.txt"]); git(repo, ["commit", "-m", "second predecessor"]);
  const integrated = git(repo, ["rev-parse", "HEAD"]);
  await check("dependent prepared root adopts actual integrated SHA while preserving installed bytes", async () => {
    const workspace = allocation("dependent", integrated), receipt = fs.readFileSync(path.join(workspace.cwd, ".aidn", "receipt-fixture.json")); let fenced = 0;
    await port.prepareAttemptWorkspace({ workspace, inputSha: integrated, attemptBinding: binding(workspace), verifyAuthority: async () => { fenced++; } });
    assert.equal(git(workspace.cwd, ["rev-parse", "HEAD"]), integrated); assert.equal(fenced, 2);
    assert.equal(fs.readFileSync(path.join(workspace.cwd, "a.txt"), "utf8"), "accepted A\n");
    assert.equal(fs.readFileSync(path.join(workspace.cwd, "b.txt"), "utf8"), "accepted B\n");
    assert(fs.readFileSync(path.join(workspace.cwd, ".aidn", "receipt-fixture.json")).equals(receipt));
  });
  await check("interruption after placement preserves intent and refuses blind retry", async () => {
    const workspace = allocation("b", integrated); let calls = 0;
    const options = { workspace, inputSha: integrated, attemptBinding: binding(workspace), verifyAuthority: async () => { if (++calls === 2) throw new Error("injected authority loss"); } };
    await assert.rejects(port.prepareAttemptWorkspace(options), /injected authority loss/);
    assert.equal(git(workspace.cwd, ["rev-parse", "HEAD"]), base);
    assert.equal(fs.readFileSync(path.join(workspace.cwd, "a.txt"), "utf8"), "accepted A\n");
    await assert.rejects(port.prepareAttemptWorkspace({ ...options, verifyAuthority: async () => {} }), /AGENT_GIT_ADOPTION_RECOVERY_REQUIRED/);
  });
  let resource;
  await check("cleanup retention preview is deterministic and writes no blobs or receipt", async () => {
    const before = fs.readdirSync(resources).sort();
    const options = { resourceId: "resource.a", kind: "attempt_worktree", cwd: rows[0].workspace.cwd, attemptId: "attempt.a" };
    const first = await port.previewCleanupRetention(options), second = await port.previewCleanupRetention(options);
    assert.deepEqual(first, second); assert.deepEqual(fs.readdirSync(resources).sort(), before);
    assert(!fs.existsSync(path.join(resources, first.resource.retention.ref))); assert(!fs.existsSync(path.join(resources, "retained-blobs")));
  });
  await check("retention preserves complete successful worktree content before cleanup", async () => {
    const options = { resourceId: "resource.a", kind: "attempt_worktree", cwd: rows[0].workspace.cwd, attemptId: "attempt.a" };
    const preview = await port.previewCleanupRetention(options); resource = await port.prepareCleanupRetention(options);
    assert.deepEqual(resource, preview.resource);
    const observed = await port.inspectCleanup(resource); assert(observed.retained && observed.clean && observed.registered);
    const retained = JSON.parse(fs.readFileSync(path.join(resources, resource.retention.ref), "utf8"));
    assert(retained.retained.some(item => item.path === ".aidn/receipt-fixture.json"));
    assert(retained.retained.some(item => item.area === "gitdir" && item.path === "index"));
  });
  await check("cleanup refuses altered retained blobs and unconfirmed termination", async () => {
    const retained = JSON.parse(fs.readFileSync(path.join(resources, resource.retention.ref), "utf8")), file = path.join(resources, retained.retained[0].ref), original = fs.readFileSync(file);
    try { fs.appendFileSync(file, "x"); await assert.rejects(port.inspectCleanup(resource), /AGENT_GIT_RETENTION_CHANGED/); }
    finally { fs.writeFileSync(file, original); }
    await assert.rejects(make({ verifyCleanupTermination: async () => ({ confirmed: false }) }).inspectCleanup(resource), /AGENT_GIT_TERMINATION_UNCONFIRMED/);
  });
  await check("owned cleanup is fenced, retains source branch and recognizes factual absence", async () => {
    await port.initializeIntegration({ baseSha: integrated });
    const cleanup = { cleanup_id: "cleanup.fixture", run_id: "run.fixture", integration_ref: ref, integrated_sha: integrated, resources: [resource] }, ownership = { owner_id: "fixture", generation: 1 };
    await assert.rejects(port.removeOwnedWorktree({ resource, cleanup, ownership, verifyAuthority: async () => ({}) }), /AGENT_GIT_CLEANUP_AUTHORITY_CHANGED/);
    const result = await port.removeOwnedWorktree({ resource, cleanup, ownership, verifyAuthority: async () => ({ cleanup_sha256: fingerprint(cleanup), resource_sha256: fingerprint(resource), ownership, control_revision: 1 }) });
    assert.equal(result.outcome, "removed"); assert(!fs.existsSync(resource.cwd));
    assert.equal(git(repo, ["rev-parse", `refs/heads/${rows[0].workspace.branch}`]), base);
    const absent = await port.inspectCleanup(resource, { phase: "after" }); assert(!absent.exists && !absent.registered && absent.retained);
    const replay = await port.reconcileOwnedWorktreeRemoval({ resource, cleanup, ownership, verifyAuthority: async () => ({ cleanup_sha256: fingerprint(cleanup), resource_sha256: fingerprint(resource), ownership, control_revision: 2 }) });
    assert.deepEqual(replay, result);
    assert(fs.existsSync(rows[1].workspace.cwd)); assert(fs.existsSync(rows[2].workspace.cwd));
  });
  await check("validation snapshots stay inside the dedicated read-only subtree and retain exact descriptor", async () => {
    const snapshotsRoot = path.join(resources, "snapshots"), isolated = make({ verificationSnapshotsRoot: snapshotsRoot });
    assert(!fs.existsSync(snapshotsRoot));
    const verification = await isolated.prepareVerificationSnapshot({ snapshotId: "snapshot.run", purpose: "run", runId: "run.fixture", candidateSha: integrated, validatorManifestSha256: "f".repeat(64) });
    assert.equal(path.dirname(verification.snapshot.cwd), snapshotsRoot);
    const options = { resourceId: "resource.verification", kind: "verification_worktree", cwd: verification.snapshot.cwd,
      binding: { run_id: "run.fixture" }, verificationSnapshot: verification };
    await assert.rejects(isolated.previewCleanupRetention({ ...options, binding: { run_id: "foreign" } }), /AGENT_GIT_SNAPSHOT_BINDING_INVALID/);
    const preview = await isolated.previewCleanupRetention(options), kept = await isolated.prepareCleanupRetention(options); assert.deepEqual(kept, preview.resource);
    assert.equal(kept.snapshot_sha256, verification.snapshot_sha256);
    const cleanup = { cleanup_id: "cleanup.verification", integration_ref: ref, integrated_sha: integrated, resources: [kept] }, ownership = { owner_id: "fixture", generation: 1 };
    await isolated.removeOwnedWorktree({ resource: kept, cleanup, ownership, run: { run_id: "run.fixture" }, verifyAuthority: async () => ({ cleanup_sha256: fingerprint(cleanup), resource_sha256: fingerprint(kept), ownership, control_revision: 1 }) });
    assert(!fs.existsSync(verification.snapshot.cwd)); assert(fs.existsSync(path.join(resources, kept.retention.ref)));
    assert(fs.existsSync(rows[2].workspace.cwd));
  });
  await check("a moved worktree never counts as a deleted owned worktree", async () => {
    const cwd = rows[2].workspace.cwd;
    const movedResource = await port.prepareCleanupRetention({ resourceId: "resource.moved", kind: "attempt_worktree", cwd, attemptId: "attempt.dependent" });
    const moved = cwd + "-relocated"; git(repo, ["worktree", "move", cwd, moved]);
    await assert.rejects(port.inspectCleanup(movedResource, { phase: "after" }), /AGENT_GIT_CLEANUP_NOT_REMOVED/);
    assert(fs.existsSync(moved));
  });
  await check("controlled Git journals bound fixture termination and filters inherited secrets", async () => {
    const controlledResources = path.join(temp, "controlled resources"), controlledRef = "refs/heads/codex/controlled-fixture";
    const saved = process.env.AIDN_PG_URL; process.env.AIDN_PG_URL = "fixture-secret-never-forwarded";
    let calls = 0;
    try {
      const options = { resourcesRoot: controlledResources, integrationRef: controlledRef, requireConfirmedGitTermination: true,
        spawnProcess: () => { throw new Error("forbidden spawn fallback"); },
        runGitProcess: async (request, { onEvent }) => {
          calls++; assert(!Object.hasOwn(request.env, "AIDN_PG_URL")); assert(!Object.hasOwn(request.env, "NODE_OPTIONS"));
          const runner = { runner_id: request.operation_id, pid: 9876, started_at: "2026-09-27T00:00:00Z", job_name: "Local\\aidn-execution-" + "f".repeat(32) };
          await onEvent({ type: "prepared", suspended: true, job_assigned: true, ...runner }); await onEvent({ type: "resumed", ...runner });
          const result = spawnSync("git", request.args, { cwd: request.cwd, env: request.env, input: request.stdin, timeout: 10000, windowsHide: true });
          if (result.stdout?.length) await onEvent({ type: "stdout", bytes: result.stdout });
          return { termination_state: "confirmed", outcome: result.status === 0 ? "completed" : "failed", reason_code: result.status === 0 ? "PROCESS_EXITED" : "PROCESS_FAILED", exit_code: result.status, signal: null,
            termination_proof: { ...runner, active_processes: 0, method: "FIXTURE_ONLY" } };
        } };
      const controlled = make(options);
      await controlled.initializeIntegration({ baseSha: base });
      const beforeCalls = calls, operations = await controlled.inspectGitOperations(); assert.equal(calls, beforeCalls);
      assert.equal(operations.operations.length, 1); assert.equal(operations.operations[0].closed.descendants_termination, "confirmed");
      assert.equal(operations.operations[0].closed.termination_proof.runner_id, operations.operations[0].operation_id);
      assert.equal(operations.uncertain_read, null);
      const running = make({ ...options, journalReadOperations: true });
      await running.inspectIntegration({}, { phase: "head" });
      const all = await running.inspectGitOperations();
      assert.equal(all.operations.length, 5); assert(all.operations.every(row => row.closed?.descendants_termination === "confirmed"));
      assert.equal(all.operations.filter(row => row.intent.effect_class === "read-only").length, 4);
      assert.equal(all.operations.filter(row => row.intent.effect_class === "mutating").length, 1);
      assert(all.operations.every(row => row.intent.repository_identity_sha256 === operations.operations[0].intent.repository_identity_sha256));
    } finally { if (saved === undefined) delete process.env.AIDN_PG_URL; else process.env.AIDN_PG_URL = saved; }
  });
  await check("unconfirmed controlled Git quarantines subsequent mutations without spawn fallback", async () => {
    let calls = 0;
    const uncertainRoot = path.join(temp, "unknown controlled"); fs.mkdirSync(uncertainRoot);
    fs.copyFileSync(path.join(resources, "owner.json"), path.join(uncertainRoot, "owner.json"));
    const options = { resourcesRoot: uncertainRoot, requireConfirmedGitTermination: true, journalReadOperations: true,
      spawnProcess: () => { throw new Error("forbidden spawn fallback"); }, runGitProcess: async () => { calls++; return { termination_state: "unknown", outcome: "indeterminate" }; } };
    const uncertain = make(options);
    await assert.rejects(uncertain.inspectIntegration({}, { phase: "head" }), /AGENT_GIT_TERMINATION_UNCONFIRMED/);
    const record = await uncertain.inspectGitOperations(); assert(record.uncertain_read);
    await assert.rejects(uncertain.initializeIntegration({ baseSha: base }), /AGENT_GIT_RECOVERY_REQUIRED/); assert.equal(calls, 1);
    const restarted = make(options), persisted = await restarted.inspectGitOperations();
    assert.equal(persisted.uncertain_read, null); assert.equal(persisted.operations.length, 1); assert(persisted.operations[0].recovery_required);
    await assert.rejects(restarted.inspectIntegration({}, { phase: "head" }), /AGENT_GIT_RECOVERY_REQUIRED/); assert.equal(calls, 1);
  });
  await check("cleanup cancellation reaches the controlled Git child and never fabricates removal", async () => {
    const stop = new AbortController(), cleanupRoot = path.join(temp, "cancelled cleanup"); let stopObserved = false;
    const controlled = make({ resourcesRoot: cleanupRoot, integrationRef: "refs/heads/codex/cancelled-cleanup", requireConfirmedGitTermination: true,
      spawnProcess: () => { throw new Error("forbidden spawn fallback"); }, runGitProcess: async (request, { signal, onEvent }) => {
        const runner = { runner_id: request.operation_id, pid: 9877, started_at: "2026-09-27T00:00:00Z", job_name: "Local\\aidn-execution-" + "e".repeat(32) };
        await onEvent({ type: "prepared", suspended: true, job_assigned: true, ...runner });
        if (request.args.includes("remove")) {
          stop.abort(); stopObserved = signal.aborted;
          return { termination_state: "unknown", outcome: "indeterminate", reason_code: "PROCESS_HELPER_TERMINATION_UNCONFIRMED" };
        }
        await onEvent({ type: "resumed", ...runner });
        const result = spawnSync("git", request.args, { cwd: request.cwd, env: request.env, input: request.stdin, timeout: 10000, windowsHide: true });
        if (result.stdout?.length) await onEvent({ type: "stdout", bytes: result.stdout });
        return { termination_state: "confirmed", outcome: result.status === 0 ? "completed" : "failed", reason_code: result.status === 0 ? "PROCESS_EXITED" : "PROCESS_FAILED", exit_code: result.status, signal: null,
          termination_proof: { ...runner, active_processes: 0, method: "FIXTURE_ONLY" } };
      } });
    const prepared = await controlled.prepareUnassignedWorkspace({ preparationId: "preparation.cancel", taskId: "cancel", taskContractSha256: "c".repeat(64), baseSha: base });
    await controlled.initializeIntegration({ baseSha: base });
    const resource = await controlled.prepareCleanupRetention({ resourceId: "resource.cancel", kind: "attempt_worktree", attemptId: "attempt.cancel", cwd: prepared.workspace.cwd });
    const cleanup = { cleanup_id: "cleanup.cancel", integration_ref: "refs/heads/codex/cancelled-cleanup", integrated_sha: base, resources: [resource] }, ownership = { owner_id: "fixture", generation: 1 };
    await assert.rejects(controlled.removeOwnedWorktree({ resource, cleanup, ownership, signal: stop.signal,
      verifyAuthority: async () => ({ cleanup_sha256: fingerprint(cleanup), resource_sha256: fingerprint(resource), ownership, control_revision: 1 }) }), /AGENT_GIT_TERMINATION_UNCONFIRMED/);
    assert(stopObserved); assert(fs.existsSync(resource.cwd));
    assert(!fs.readdirSync(cleanupRoot).some(name => name.endsWith(".removed.json")));
    const operations = await controlled.inspectGitOperations(); assert(operations.uncertain_read);
    assert(operations.operations.some(row => row.recovery_required));
  });
  }
} finally {
  const physical = fs.realpathSync.native(temp); assert.equal(path.dirname(physical).toLowerCase(), fs.realpathSync.native(os.tmpdir()).toLowerCase());
  assert.equal(fs.readFileSync(path.join(physical, "owner"), "utf8"), nonce); fs.rmSync(physical, { recursive: true, force: true });
}
assert(!fs.existsSync(temp)); process.stdout.write(JSON.stringify({ status: "PASS", checks: count, cleanup: "PASS", postgres: "NOT_RUN", native_codex: "NOT_RUN", controlled_git: "INJECTED_FIXTURE_ONLY" }) + "\n");
