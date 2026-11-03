import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createLocalWorkflowGitCheckpoint } from "../../src/adapters/runtime/local-workflow-git-checkpoint.mjs";
import { assertWorkflowGitCheckpointPort } from "../../src/core/ports/workflow-git-checkpoint-port.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex"), temp = fs.realpathSync(os.tmpdir()), owned = [];
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true, stdio: "pipe" }).trim();
const write = (root, name, text) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const metadata = ["docs/audit/CURRENT-STATE.md", "docs/audit/RUNTIME-STATE.md", "docs/audit/sessions/S001.md"];
let checks = 0;
async function test(name, run) { await run(); checks++; console.log("PASS " + name); }
function fixture() {
  const root = fs.mkdtempSync(path.join(temp, "aidn-git-checkpoint-")); owned.push(root);
  git(root, "init", "-b", "session"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "commit.gpgSign", "false"); git(root, "config", "core.autocrlf", "false");
  write(root, "app.mjs", "export const value = 1;\n");
  for (const name of metadata.slice(0, 2)) write(root, name, "initial\n");
  git(root, "add", "."); git(root, "commit", "-m", "fixture seed");
  for (const name of metadata) write(root, name, "governed session\n");
  const port = createLocalWorkflowGitCheckpoint({ targetRoot: root });
  const plan = { operation_id: "op_" + "a".repeat(40), plan_sha256: "b".repeat(64), prepared_at_ms: Date.now(), observed: port.inspect(),
    files: metadata.map(name => ({ path: name, sha256: hash(fs.readFileSync(path.join(root, name))) })) };
  return { root, port, plan };
}
try {
  await test("port assertion never invokes supplied methods", () => {
    let calls = 0; const port = { inspect() { calls++; }, commit() { calls++; }, inspectCommit() { calls++; } };
    assert.equal(assertWorkflowGitCheckpointPort(port), port); assert.equal(calls, 0);
  });
  await test("inspection preserves checkout, HEAD and index bytes", () => {
    const f = fixture(), before = fs.readFileSync(path.join(f.root, ".git/index")), head = git(f.root, "rev-parse", "HEAD");
    assert.equal(f.port.inspect().changes.length, 3); assert.deepEqual(fs.readFileSync(path.join(f.root, ".git/index")), before);
    assert.equal(git(f.root, "rev-parse", "HEAD"), head);
  });
  await test("real bounded commit changes only approved metadata, observes exact parent and leaves Git clean", async () => {
    const f = fixture(); let grants = 0;
    const result = await f.port.commit(f.plan, { assertAuthorized: async () => { grants++; } });
    assert.equal(result.status, "confirmed"); assert.equal(result.parent_sha, f.plan.observed.head); assert.equal(grants, 3);
    assert.equal(result.lock_present, false);
    assert.equal(git(f.root, "status", "--porcelain"), ""); assert.equal(fs.readFileSync(path.join(f.root, "app.mjs"), "utf8"), "export const value = 1;\n");
    assert.equal(f.port.inspectCommit(f.plan).status, "confirmed");
    const count = git(f.root, "rev-list", "--count", "HEAD");
    await assert.rejects(f.port.commit(f.plan, { assertAuthorized() {} }), { code: "WORKFLOW_GIT_PRECONDITION_CHANGED", effect_status: "no_effect" });
    assert.equal(git(f.root, "rev-list", "--count", "HEAD"), count);
  });
  await test("clean no-op creates no commit or Git lock", async () => {
    const f = fixture(); git(f.root, "add", "."); git(f.root, "commit", "-m", "fixture settled");
    const plan = { ...f.plan, files: [], observed: f.port.inspect() };
    assert.equal((await f.port.commit(plan, { assertAuthorized() {} })).status, "no_change");
    assert.equal(git(f.root, "rev-parse", "HEAD"), plan.observed.head); assert.equal(fs.existsSync(path.join(f.root, ".git/index.lock")), false);
  });
  await test("foreign dirty files refuse before any approved-branch commit", async () => {
    const f = fixture(); write(f.root, "app.mjs", "foreign\n");
    await assert.rejects(f.port.commit(f.plan, { assertAuthorized() {} }), { code: "WORKFLOW_GIT_FOREIGN_CHANGES", effect_status: "no_effect" });
    assert.equal(git(f.root, "rev-parse", "HEAD"), f.plan.observed.head);
  });
  await test("staged files and changed postimages are refused", async () => {
    const f = fixture(); git(f.root, "add", "app.mjs", metadata[0]);
    await assert.rejects(f.port.commit(f.plan, { assertAuthorized() {} }), { code: "WORKFLOW_GIT_PRECONDITION_CHANGED" });
    const g = fixture(); write(g.root, metadata[0], "changed after preview\n");
    await assert.rejects(g.port.commit(g.plan, { assertAuthorized() {} }), { code: "WORKFLOW_GIT_POSTIMAGE_CHANGED", effect_status: "no_effect" });
  });
  await test("denied authorization and foreign index lock do not produce effects", async () => {
    const f = fixture();
    await assert.rejects(f.port.commit(f.plan, { assertAuthorized() { throw Object.assign(new Error("denied"), { code: "DENIED" }); } }), { code: "DENIED", effect_status: "no_effect" });
    write(f.root, ".git/index.lock", "foreign");
    await assert.rejects(f.port.commit(f.plan, { assertAuthorized() {} }), { code: "WORKFLOW_GIT_FOREIGN_CHANGES", effect_status: "no_effect" });
    assert.equal(fs.readFileSync(path.join(f.root, ".git/index.lock"), "utf8"), "foreign");
  });
  await test("loss after ref update reports unknown, observes the commit and never silently confirms the old index", async () => {
    const f = fixture(), port = createLocalWorkflowGitCheckpoint({ targetRoot: f.root }, { afterRef() { throw Object.assign(new Error("lost confirmation"), { code: "LOST" }); } });
    await assert.rejects(port.commit(f.plan, { assertAuthorized() {} }), { code: "LOST", effect_status: "unknown" });
    const reopened = createLocalWorkflowGitCheckpoint({ targetRoot: f.root }), proof = reopened.inspectCommit(f.plan);
    assert.equal(proof.status, "commit_observed"); assert.equal(proof.index_reconciled, false); assert.equal(proof.parent_sha, f.plan.observed.head);
    const count = git(f.root, "rev-list", "--count", "HEAD");
    await assert.rejects(reopened.commit(f.plan, { assertAuthorized() {} }), { code: "WORKFLOW_GIT_PRECONDITION_CHANGED" });
    assert.equal(git(f.root, "rev-list", "--count", "HEAD"), count);
  });
  await test("post-commit grant loss remains unknown despite an observable clean commit", async () => {
    const f = fixture(); let calls = 0;
    await assert.rejects(f.port.commit(f.plan, { assertAuthorized() { if (++calls === 3) throw Object.assign(new Error("revoked"), { code: "REVOKED" }); } }), { code: "REVOKED", effect_status: "unknown" });
    assert.equal(f.port.inspectCommit(f.plan).status, "confirmed");
  });
  await test("a concurrent ref update wins without being overwritten by the approved checkpoint", async () => {
    const f = fixture(); let foreign;
    const port = createLocalWorkflowGitCheckpoint({ targetRoot: f.root }, { beforeRef() {
      const tree = git(f.root, "rev-parse", "HEAD^{tree}");
      foreign = execFileSync("git", ["-C", f.root, "commit-tree", tree, "-p", f.plan.observed.head], { input: "foreign concurrent commit\n", encoding: "utf8", windowsHide: true }).trim();
      git(f.root, "update-ref", f.plan.observed.ref, foreign, f.plan.observed.head);
    } });
    await assert.rejects(port.commit(f.plan, { assertAuthorized() {} }), { code: "WORKFLOW_GIT_COMMAND_FAILED", effect_status: "unknown" });
    assert.equal(git(f.root, "rev-parse", "HEAD"), foreign); assert.equal(f.port.inspectCommit(f.plan).status, "not_confirmed");
  });
  await test("terminal scope requires a trusted explicit finite relative-path profile", () => {
    const f = fixture();
    for (const options of [{ profile: "unknown" }, { approvedPaths: ["app.mjs"] },
      ...[["../outside"], [".aidn/key"], [".git/index"], ["C:/outside"], ["/outside"], ["app.mjs", "app.mjs"]].map(approvedPaths => ({ profile: "cycle-terminal", approvedPaths }))])
      assert.throws(() => createLocalWorkflowGitCheckpoint({ targetRoot: f.root }, options), { code: "WORKFLOW_GIT_SCOPE_PROFILE_INVALID" });
    assert.equal(git(f.root, "rev-parse", "HEAD"), f.plan.observed.head);
  });
  await test("terminal profile commits exactly captured product/metadata paths and preserves an executable Git mode", async () => {
    const f = fixture(), goal = "docs/audit/cycles/C001-feature-example/goal.md", literal = "product/item[1].mjs";
    write(f.root, "product/item1.mjs", "unchanged neighbour\n"); git(f.root, "add", "product/item1.mjs");
    git(f.root, "update-index", "--chmod=+x", "app.mjs"); fs.chmodSync(path.join(f.root, "app.mjs"), 0o755);
    git(f.root, "commit", "-m", "fixture executable and neighbour");
    write(f.root, "app.mjs", "export const value = 2;\n"); write(f.root, goal, "approved cycle\n"); write(f.root, literal, "approved literal file\n");
    const approvedPaths = [...metadata, "app.mjs", goal, literal], port = createLocalWorkflowGitCheckpoint({ targetRoot: f.root }, { profile: "cycle-terminal", approvedPaths });
    const plan = { ...f.plan, observed: port.inspect(), files: approvedPaths.map(name => ({ path: name, sha256: hash(fs.readFileSync(path.join(f.root, name))) })) };
    await assert.rejects(f.port.commit(plan, { assertAuthorized() {} }), { code: "WORKFLOW_GIT_PLAN_INVALID", effect_status: "no_effect" });
    const proof = await port.commit(plan, { assertAuthorized() {} }); assert.equal(proof.status, "confirmed");
    assert.equal(git(f.root, "ls-tree", "--format=%(objectmode)", "HEAD", "--", "app.mjs"), "100755");
    assert.deepEqual(git(f.root, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").split("\n").sort(), approvedPaths.sort());
    assert.equal(fs.readFileSync(path.join(f.root, "product/item1.mjs"), "utf8"), "unchanged neighbour\n");
    const reopened = createLocalWorkflowGitCheckpoint({ targetRoot: f.root }, { profile: "cycle-terminal", approvedPaths });
    assert.equal(reopened.inspectCommit(plan).status, "confirmed"); assert.equal(git(f.root, "status", "--porcelain"), "");
  });
  await test("terminal scope refuses an uncaptured path and oversized postimage before Git effects", async () => {
    const f = fixture(), port = createLocalWorkflowGitCheckpoint({ targetRoot: f.root }, { profile: "cycle-terminal", approvedPaths: metadata });
    const foreign = { ...f.plan, files: [...f.plan.files.slice(0, 2), { path: "app.mjs", sha256: "c".repeat(64) }] };
    await assert.rejects(port.commit(foreign, { assertAuthorized() {} }), { code: "WORKFLOW_GIT_PLAN_INVALID", effect_status: "no_effect" });
    write(f.root, metadata[0], Buffer.alloc(1048577));
    await assert.rejects(port.commit(f.plan, { assertAuthorized() {} }), { code: "WORKFLOW_GIT_FILE_LIMIT", effect_status: "no_effect" });
    assert.equal(git(f.root, "rev-parse", "HEAD"), f.plan.observed.head);
  });
  console.log(JSON.stringify({ status: "PASS", checks, proof: "offline-real-git-port", application_binding: "NOT_RUN", full_standard_workflow: "NOT_COMPLETE", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
} finally {
  for (const root of owned) {
    const real = fs.realpathSync(root); if (path.dirname(real) !== temp || !path.basename(real).startsWith("aidn-git-checkpoint-")) throw Error("FIXTURE_CLEANUP_SCOPE_INVALID");
    fs.rmSync(real, { recursive: true, force: true });
  }
}
