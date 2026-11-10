import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createLocalWorkflowBranchIntegration } from "../../src/adapters/runtime/local-workflow-branch-integration.mjs";
import { assertWorkflowBranchIntegrationPort } from "../../src/core/ports/workflow-branch-integration-port.mjs";

const roots = [], checks = [], temp = fs.realpathSync(os.tmpdir());
const git = (root, ...args) => execFileSync("git", ["-C", root, "-c", "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null"), ...args],
  { encoding: "utf8", windowsHide: true, shell: false, stdio: "pipe" }).trim();
const put = (root, name, text) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const scope = { source_branch: "C001-feature", target_branch: "S001-session" };
const grant = { write: true, assertAuthorized() {} };
const denied = () => { throw Object.assign(Error("DENIED"), { code: "DENIED" }); };
function fixture() {
  const root = fs.mkdtempSync(path.join(temp, "aidn-branch-integration-")); roots.push(root);
  git(root, "init", "-b", scope.target_branch); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "core.autocrlf", "false"); git(root, "config", "commit.gpgSign", "false");
  put(root, "product/app.mjs", "export const value = 1;\n"); git(root, "add", "."); git(root, "commit", "-m", "fixture seed");
  git(root, "switch", "-c", scope.source_branch); put(root, "product/app.mjs", "export const value = 2;\n");
  git(root, "add", "."); git(root, "commit", "-m", "fixture retained cycle");
  const port = createLocalWorkflowBranchIntegration({ targetRoot: root });
  const plan = { operation_id: "op_" + "a".repeat(40), plan_sha256: "b".repeat(64), observed: port.inspect(scope) };
  return { root, port, plan };
}
async function check(name, run) { await run(); checks.push(name); console.log("PASS " + name); }
function refsUnchanged(f) {
  assert.equal(git(f.root, "rev-parse", scope.target_branch), f.plan.observed.target_head);
  assert.equal(git(f.root, "symbolic-ref", "HEAD"), f.plan.observed.source_ref);
}
let complete = false;
try {
  await check("port discovery invokes no method", () => {
    let calls = 0; const port = { inspect() { calls++; }, integrate() { calls++; }, inspectIntegration() { calls++; } };
    assert.equal(assertWorkflowBranchIntegrationPort(port), port); assert.equal(calls, 0);
  });
  await check("inspection preserves checkout, index and refs", () => {
    const f = fixture(), index = fs.readFileSync(path.join(f.root, ".git/index")), bytes = fs.readFileSync(path.join(f.root, "product/app.mjs"));
    assert.deepEqual(f.port.inspect(scope), f.plan.observed); refsUnchanged(f);
    assert.deepEqual(fs.readFileSync(path.join(f.root, ".git/index")), index); assert.deepEqual(fs.readFileSync(path.join(f.root, "product/app.mjs")), bytes);
    assert.equal(f.port.inspectIntegration(f.plan).status, "not_confirmed");
  });
  await check("equal source/target observations remain fresh for refs, locks and symbolic targets", () => {
    const f = fixture(), equal = { source_branch: scope.source_branch, target_branch: scope.source_branch };
    const initial = f.port.inspect(equal);
    assert.equal(initial.source_head, initial.target_head); assert.equal(initial.source_symbolic, false);
    assert.equal(initial.target_symbolic, false); assert.equal(initial.fast_forward, true);
    git(f.root, "update-ref", initial.source_ref, f.plan.observed.target_head);
    const moved = f.port.inspect(equal);
    assert.equal(moved.source_head, f.plan.observed.target_head); assert.equal(moved.target_head, moved.source_head);
    const lock = path.join(f.root, ".git", initial.source_ref + ".lock");
    put(f.root, ".git/" + initial.source_ref + ".lock", "foreign owner");
    assert.equal(f.port.inspect(equal).source_lock_present, true); fs.unlinkSync(lock);
    git(f.root, "symbolic-ref", initial.source_ref, f.plan.observed.target_ref);
    const symbolic = f.port.inspect(equal);
    assert.equal(symbolic.source_symbolic, true); assert.equal(symbolic.target_symbolic, true);
  });
  await check("distinct source and target retain fresh symbolic-ref refusals", async () => {
    const f = fixture();
    const { source_ref, target_ref } = f.plan.observed;
    git(f.root, "symbolic-ref", target_ref, source_ref);
    const target = f.port.inspect(scope);
    assert.equal(target.source_symbolic, false);
    assert.equal(target.target_symbolic, true);
    await assert.rejects(f.port.integrate({ ...f.plan, observed: target }, grant),
      { code: "WORKFLOW_BRANCH_PRECONDITIONS_REQUIRED", effect_status: "no_effect" });

    git(f.root, "symbolic-ref", "-d", target_ref);
    git(f.root, "update-ref", target_ref, f.plan.observed.target_head);
    git(f.root, "symbolic-ref", source_ref, target_ref);
    const source = f.port.inspect(scope);
    assert.equal(source.source_symbolic, true);
    assert.equal(source.target_symbolic, false);
    await assert.rejects(f.port.integrate({ ...f.plan, observed: source }, grant),
      { code: "WORKFLOW_BRANCH_PRECONDITIONS_REQUIRED", effect_status: "no_effect" });
  });
  await check("a missing source or target refuses without trusting rev-parse's unresolved text", () => {
    const f = fixture();
    for (const missing of [{ ...scope, source_branch: "missing-source" }, { ...scope, target_branch: "missing-target" }])
      assert.throws(() => f.port.inspect(missing), { code: "WORKFLOW_BRANCH_GIT_FAILED" });
    refsUnchanged(f);
  });
  await check("FF transaction binds reflogs and preserves source, index and product", async () => {
    const f = fixture(), index = fs.readFileSync(path.join(f.root, ".git/index")), bytes = fs.readFileSync(path.join(f.root, "product/app.mjs"));
    let grants = 0; const output = await f.port.integrate(f.plan, { write: true, assertAuthorized() { grants++; } });
    assert.equal(output.effect_status, "confirmed"); assert.equal(output.head, f.plan.observed.source_head); assert.equal(grants, 4);
    assert.equal(git(f.root, "symbolic-ref", "HEAD"), f.plan.observed.target_ref); assert.equal(git(f.root, "rev-parse", scope.source_branch), output.head);
    assert.equal(git(f.root, "status", "--porcelain"), ""); assert.deepEqual(fs.readFileSync(path.join(f.root, ".git/index")), index);
    assert.deepEqual(fs.readFileSync(path.join(f.root, "product/app.mjs")), bytes); assert.equal(f.port.inspectIntegration(f.plan).status, "confirmed");
    await assert.rejects(f.port.integrate(f.plan, grant), { code: "WORKFLOW_BRANCH_PREVIEW_CHANGED", effect_status: "no_effect" });
    assert.equal(fs.existsSync(path.join(f.root, ".git/index.lock")), false);
    assert.equal(fs.existsSync(path.join(f.root, ".git/refs/heads", scope.source_branch + ".lock")), false);
  });
  await check("write and fresh authorization are mandatory", async () => {
    const f = fixture();
    for (const options of [{}, { write: true }, { assertAuthorized() {} }])
      await assert.rejects(f.port.integrate(f.plan, options), { code: "WORKFLOW_BRANCH_EXPLICIT_WRITE_REQUIRED", effect_status: "no_effect" });
    await assert.rejects(f.port.integrate(f.plan, { write: true, assertAuthorized: denied }), { code: "DENIED", effect_status: "no_effect" }); refsUnchanged(f);
  });
  await check("dirty, staged and foreign untracked files refuse", async () => {
    for (const kind of ["dirty", "staged", "untracked"]) {
      const f = fixture(); put(f.root, kind === "untracked" ? "foreign.txt" : "product/app.mjs", "foreign\n");
      if (kind === "staged") git(f.root, "add", ".");
      await assert.rejects(f.port.integrate(f.plan, grant), { code: "WORKFLOW_BRANCH_PREVIEW_CHANGED", effect_status: "no_effect" }); refsUnchanged(f);
    }
  });
  await check("divergent and stale targets cannot be overwritten", async () => {
    const f = fixture(), tree = git(f.root, "rev-parse", scope.target_branch + "^{tree}");
    const foreign = execFileSync("git", ["-C", f.root, "commit-tree", tree, "-p", f.plan.observed.target_head], { input: "foreign\n", encoding: "utf8", windowsHide: true }).trim();
    git(f.root, "update-ref", f.plan.observed.target_ref, foreign);
    await assert.rejects(f.port.integrate(f.plan, grant), { code: "WORKFLOW_BRANCH_PREVIEW_CHANGED", effect_status: "no_effect" });
    assert.equal(git(f.root, "rev-parse", scope.target_branch), foreign);
    const plan = { ...f.plan, observed: f.port.inspect(scope) }; assert.equal(plan.observed.fast_forward, false);
    await assert.rejects(f.port.integrate(plan, grant), { code: "WORKFLOW_BRANCH_PRECONDITIONS_REQUIRED", effect_status: "no_effect" });
  });
  await check("target checked out in another worktree refuses", async () => {
    const f = fixture(), linked = path.join(f.root, "..", path.basename(f.root) + "-linked with spaces"); roots.push(linked);
    git(f.root, "worktree", "add", linked, scope.target_branch);
    const plan = { ...f.plan, observed: f.port.inspect(scope) }; assert.equal(plan.observed.target_checked_out_elsewhere, true);
    await assert.rejects(f.port.integrate(plan, grant), { code: "WORKFLOW_BRANCH_PRECONDITIONS_REQUIRED", effect_status: "no_effect" }); refsUnchanged(f);
  });
  await check("linked source worktree uses the common ref store", async () => {
    const f = fixture(), linked = path.join(f.root, "..", path.basename(f.root) + "-linked"); roots.push(linked);
    git(f.root, "switch", "--detach"); git(f.root, "worktree", "add", linked, scope.source_branch);
    const port = createLocalWorkflowBranchIntegration({ targetRoot: linked }), plan = { ...f.plan, observed: port.inspect(scope) };
    assert.equal((await port.integrate(plan, grant)).effect_status, "confirmed"); assert.equal(git(linked, "symbolic-ref", "HEAD"), plan.observed.target_ref);
    assert.equal(port.inspectIntegration(plan).status, "confirmed");
  });
  await check("configured filters stay disabled without invalidating their own preimage", async () => {
    const f = fixture(), marker = path.join(f.root, "FILTER_EXECUTED");
    put(f.root, ".gitattributes", "product/* filter=tripwire\n"); git(f.root, "add", ".gitattributes"); git(f.root, "commit", "-m", "fixture attributes");
    for (const name of ["clean", "smudge", "process"]) git(f.root, "config", "filter.tripwire." + name, "echo forbidden > FILTER_EXECUTED");
    git(f.root, "config", "filter.tripwire.required", "true");
    const stamp = new Date(Date.now() + 2000); fs.utimesSync(path.join(f.root, "product/app.mjs"), stamp, stamp);
    const port = createLocalWorkflowBranchIntegration({ targetRoot: f.root }), plan = { ...f.plan, observed: port.inspect(scope) };
    assert.equal(plan.observed.clean, true); assert.equal((await port.integrate(plan, grant)).effect_status, "confirmed"); assert.equal(fs.existsSync(marker), false);
    git(f.root, "config", "filter.tripwire.clean", "echo changed");
    assert.throws(() => port.inspect(scope), { code: "WORKFLOW_BRANCH_FILTER_CONTEXT_CHANGED" }); assert.equal(fs.existsSync(marker), false);
  });
  await check("foreign source/index locks are preserved", async () => {
    for (const file of [".git/index.lock", ".git/refs/heads/" + scope.source_branch + ".lock"]) {
      const f = fixture(); put(f.root, file, "foreign");
      await assert.rejects(f.port.integrate(f.plan, grant), { code: "WORKFLOW_BRANCH_PREVIEW_CHANGED", effect_status: "no_effect" });
      assert.equal(fs.readFileSync(path.join(f.root, file), "utf8"), "foreign"); refsUnchanged(f);
    }
  });
  await check("cold integration refuses effective filter configuration changed after its preview", async () => {
    const f = fixture(); git(f.root, "config", "filter.new.clean", "echo forbidden");
    const cold = createLocalWorkflowBranchIntegration({ targetRoot: f.root });
    await assert.rejects(cold.integrate(f.plan, grant), { code: "WORKFLOW_BRANCH_PREVIEW_CHANGED", effect_status: "no_effect" }); refsUnchanged(f);
  });
  await check("cold confirmation cannot substitute a new filter context after an observed integration", async () => {
    const f = fixture(); await f.port.integrate(f.plan, grant); git(f.root, "config", "filter.new.clean", "echo forbidden");
    const cold = createLocalWorkflowBranchIntegration({ targetRoot: f.root }); assert.equal(cold.inspectIntegration(f.plan).status, "not_confirmed");
  });
  await check("source locking and CAS preserve concurrent target/HEAD changes", async () => {
    for (const kind of ["target", "HEAD"]) {
      const f = fixture(), port = createLocalWorkflowBranchIntegration({ targetRoot: f.root }, { beforeTransaction() {
        assert.throws(() => git(f.root, "update-ref", f.plan.observed.source_ref, f.plan.observed.target_head));
        if (kind === "target") git(f.root, "update-ref", f.plan.observed.target_ref, f.plan.observed.source_head);
        else git(f.root, "symbolic-ref", "HEAD", f.plan.observed.target_ref);
      } });
      await assert.rejects(port.integrate(f.plan, grant), { code: "WORKFLOW_BRANCH_PREVIEW_CHANGED", effect_status: "unknown" });
      if (kind === "target") assert.equal(git(f.root, "rev-parse", scope.target_branch), f.plan.observed.source_head);
      else assert.equal(git(f.root, "symbolic-ref", "HEAD"), f.plan.observed.target_ref);
      assert.equal(port.inspectIntegration(f.plan).status, "not_confirmed");
    }
  });
  await check("failure after transaction is unknown; cold observation never repeats it", async () => {
    const f = fixture(), port = createLocalWorkflowBranchIntegration({ targetRoot: f.root }, { afterTransaction: denied });
    await assert.rejects(port.integrate(f.plan, grant), { code: "DENIED", effect_status: "unknown" });
    const cold = createLocalWorkflowBranchIntegration({ targetRoot: f.root }); assert.equal(cold.inspectIntegration(f.plan).status, "confirmed");
    await assert.rejects(cold.integrate(f.plan, grant), { code: "WORKFLOW_BRANCH_PREVIEW_CHANGED", effect_status: "no_effect" });
  });
  await check("grant loss after transaction stays unknown despite observable integration", async () => {
    const f = fixture(); let grants = 0;
    await assert.rejects(f.port.integrate(f.plan, { write: true, assertAuthorized() { if (++grants === 4) denied(); } }), { code: "DENIED", effect_status: "unknown" });
    assert.equal(f.port.inspectIntegration(f.plan).status, "confirmed");
  });
  await check("matching refs without operation reflogs and changed log histories cannot authenticate an effect", async () => {
    const f = fixture(); git(f.root, "update-ref", f.plan.observed.target_ref, f.plan.observed.source_head);
    git(f.root, "symbolic-ref", "HEAD", f.plan.observed.target_ref); assert.equal(f.port.inspectIntegration(f.plan).status, "not_confirmed");
    const g = fixture(); await g.port.integrate(g.plan, grant);
    fs.appendFileSync(path.join(g.root, ".git/logs/refs/heads", scope.target_branch), "foreign\n");
    assert.equal(g.port.inspectIntegration(g.plan).status, "not_confirmed");
  });
  await check("same-branch no-op differs from equal-head branch switch", async () => {
    const f = fixture(), plan = { ...f.plan, observed: f.port.inspect({ source_branch: scope.source_branch, target_branch: scope.source_branch }) };
    assert.equal((await f.port.integrate(plan, grant)).effect_status, "no_effect"); refsUnchanged(f);
    git(f.root, "update-ref", f.plan.observed.target_ref, f.plan.observed.source_head);
    const equal = { ...f.plan, observed: f.port.inspect(scope) }; assert.equal((await f.port.integrate(equal, grant)).effect_status, "confirmed");
  });
  complete = true;
  console.log(JSON.stringify({ ok: true, checks: checks.length, proof_class: "offline-real-Git-port-only", standard_model_binding: false }));
} finally {
  if (complete) {
    for (const root of [...roots].reverse()) {
      const resolved = path.resolve(root);
      if (path.dirname(resolved) !== temp || !path.basename(resolved).startsWith("aidn-branch-integration-")) throw Error("FIXTURE_CLEANUP_SCOPE");
      fs.rmSync(resolved, { recursive: true, force: true });
    }
    console.log(JSON.stringify({ cleanup: "completed", roots: roots.length }));
  } else console.error(JSON.stringify({ cleanup: "retained-after-failure", roots }));
}
