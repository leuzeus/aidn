import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { agentRunPhysicalPath } from "../../application/runtime/agent-run-configuration-service.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { assertWorkflowBranchIntegrationPort } from "../../core/ports/workflow-branch-integration-port.mjs";
const hash = data => createHash("sha256").update(data).digest("hex");
const fail = code => { throw Object.assign(Error(code), { code }); };
const key = value => process.platform === "win32" ? value.toLowerCase() : value;
// Fixed local ref protocol. Source and target arrive from the trusted canonical
// session/closure reader, never a native prompt or caller-selected command.
// The target becomes the already checked-out source commit. One Git reference
// transaction CASes the target and symbolic HEAD while the source/index are
// locked; no checkout, filter, hook, merge driver or worktree-file overwrite.
export function createLocalWorkflowBranchIntegration({ targetRoot, environment = process.env }, { beforeTransaction = null, afterTransaction = null } = {}) {
  const root = agentRunPhysicalPath(path.resolve(targetRoot), { directory: true });
  if (Object.keys(environment).some(name => /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG(?:_.*)?)$/i.test(name))) fail("WORKFLOW_BRANCH_ENV_SCOPE_CONFLICT");
  const env = { ...Object.fromEntries(Object.entries(environment).filter(([name]) => !/^GIT_/i.test(name))), GIT_OPTIONAL_LOCKS: "0" };
  const fixed = ["--literal-pathspecs", "-C", root, "-c", "core.fsmonitor=false", "-c", "gc.auto=0", "-c", "maintenance.auto=false", "-c", "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null")];
  function git(args, input) {
    try { return execFileSync("git", [...fixed, ...args], { input, env, encoding: "utf8", shell: false, windowsHide: true, timeout: 10000, maxBuffer: 1048576, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (cause) { throw Object.assign(Error("WORKFLOW_BRANCH_GIT_FAILED"), { code: "WORKFLOW_BRANCH_GIT_FAILED", command: args[0], exit_code: cause.status }); }
  }
  if (key(path.resolve(git(["rev-parse", "--show-toplevel"]).trim())) !== key(root)) fail("WORKFLOW_BRANCH_TOPLEVEL_REQUIRED");
  // Read effective repository filters without our disabling overrides. Comparing
  // the overridden configuration to this preimage would reject every LFS repo.
  const configArguments = [...fixed];
  const configuredFilters = spawnSync("git", [...configArguments, "config", "--null", "--get-regexp", "^filter\\..*\\.(clean|smudge|process|required)$"],
    { env, encoding: "utf8", shell: false, windowsHide: true, timeout: 10000, stdio: "pipe" });
  if (![0, 1].includes(configuredFilters.status)) fail("WORKFLOW_BRANCH_FILTER_CONTEXT_UNAVAILABLE");
  const filterContextSha256 = hash(configuredFilters.stdout);
  for (const name of new Set(configuredFilters.stdout.split("\0").filter(Boolean).map(row => /^filter\.(.+)\.(?:clean|smudge|process|required)\n/.exec(row)?.[1]))) {
    if (!name || /[\r\n\0]/.test(name)) fail("WORKFLOW_BRANCH_FILTER_CONTEXT_INVALID");
    for (const member of ["clean", "smudge", "process"]) fixed.push("-c", `filter.${name}.${member}=`);
    fixed.push("-c", `filter.${name}.required=false`);
  }
  if (git(["ls-files", "--stage", "-z"]).split("\0").some(row => row.startsWith("160000 "))) fail("WORKFLOW_BRANCH_SUBMODULE_SCOPE_UNSUPPORTED");
  const index = agentRunPhysicalPath(path.resolve(root, git(["rev-parse", "--git-path", "index"]).trim())), lock = index + ".lock";
  const gitPath = name => agentRunPhysicalPath(path.resolve(root, git(["rev-parse", "--git-path", name]).trim()), { missing: true });
  function logBytes(ref) {
    const file = gitPath("logs/" + ref);
    if (!fs.existsSync(file)) return Buffer.alloc(0);
    const row = fs.lstatSync(file);
    if (!row.isFile() || row.nlink !== 1 || row.size > 4194304) fail("WORKFLOW_BRANCH_REFLOG_INVALID");
    return fs.readFileSync(file);
  }
  const logState = ref => { const bytes = logBytes(ref); return { byte_length: bytes.length, sha256: hash(bytes) }; };
  function branch(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,191}$/.test(value)) fail("WORKFLOW_BRANCH_IDENTITY_INVALID");
    git(["check-ref-format", "refs/heads/" + value]); return "refs/heads/" + value;
  }
  function indexHash() { const row = fs.lstatSync(index); if (!row.isFile() || row.nlink !== 1 || row.size > 4194304) fail("WORKFLOW_BRANCH_INDEX_INVALID"); return hash(fs.readFileSync(index)); }
  function worktrees() {
    const rows = []; let current = null;
    for (const line of git(["worktree", "list", "--porcelain", "-z"]).split("\0")) {
      if (line.startsWith("worktree ")) { current = { root: path.resolve(line.slice(9)), branch: null }; rows.push(current); }
      else if (line.startsWith("branch ") && current) current.branch = line.slice(7);
    }
    return rows;
  }
  function inspect({ source_branch, target_branch }) {
    const currentFilters = spawnSync("git", [...configArguments, "config", "--null", "--get-regexp", "^filter\\..*\\.(clean|smudge|process|required)$"],
      { env, encoding: "utf8", shell: false, windowsHide: true, timeout: 10000, stdio: "pipe" });
    if (![0, 1].includes(currentFilters.status) || hash(currentFilters.stdout) !== filterContextSha256) fail("WORKFLOW_BRANCH_FILTER_CONTEXT_CHANGED");
    if (git(["ls-files", "--stage", "-z"]).split("\0").some(row => row.startsWith("160000 "))) fail("WORKFLOW_BRANCH_SUBMODULE_SCOPE_UNSUPPORTED");
    // Equal references share one observation inside this synchronous inspect;
    // nothing is reused across calls or an awaited authorization/provider.
    const sourceRef = branch(source_branch), targetRef = source_branch === target_branch ? sourceRef : branch(target_branch);
    const currentRef = git(["symbolic-ref", "--quiet", "HEAD"]).trim();
    const sourceHead = git(["rev-parse", "--verify", sourceRef]).trim();
    const targetHead = targetRef === sourceRef ? sourceHead : git(["rev-parse", "--verify", targetRef]).trim();
    const ancestor = spawnSync("git", [...fixed, "merge-base", "--is-ancestor", targetHead, sourceHead], { env, shell: false, windowsHide: true, timeout: 10000, stdio: "pipe" });
    if (![0, 1].includes(ancestor.status)) fail("WORKFLOW_BRANCH_ANCESTRY_UNAVAILABLE");
    const rows = worktrees(), status = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    const sourceSymbolic = spawnSync("git", [...fixed, "symbolic-ref", "--quiet", sourceRef], { env, shell: false, windowsHide: true, timeout: 10000, stdio: "pipe" }).status !== 1;
    const targetSymbolic = targetRef === sourceRef ? sourceSymbolic
      : spawnSync("git", [...fixed, "symbolic-ref", "--quiet", targetRef], { env, shell: false, windowsHide: true, timeout: 10000, stdio: "pipe" }).status !== 1;
    return { source_branch, target_branch, source_ref: sourceRef, target_ref: targetRef, source_head: sourceHead, target_head: targetHead,
      current_ref: currentRef, head: git(["rev-parse", "HEAD"]).trim(), index_sha256: indexHash(), clean: status === "", lock_present: fs.existsSync(lock),
      filter_context_sha256: filterContextSha256,
      source_lock_present: fs.existsSync(gitPath(sourceRef + ".lock")),
      source_symbolic: sourceSymbolic,
      target_symbolic: targetSymbolic,
      head_reflog: logState("HEAD"), target_reflog: logState(targetRef),
      fast_forward: ancestor.status === 0, target_checked_out_elsewhere: rows.some(row => row.branch === targetRef && key(row.root) !== key(root)),
      worktree_bindings_sha256: shadowHash(rows.filter(row => key(row.root) !== key(root)).map(row => ({ root_sha256: hash(key(row.root)), branch: row.branch }))) };
  }
  function assertPlan(plan) {
    if (checkShadowJson(plan) || !/^op_[a-f0-9]{40}$/.test(plan?.operation_id ?? "") || !/^[a-f0-9]{64}$/.test(plan.plan_sha256 ?? "")
      || !plan.observed || Object.keys(plan).sort().join(",") !== "observed,operation_id,plan_sha256") fail("WORKFLOW_BRANCH_PLAN_INVALID");
    const view = plan.observed;
    if (view.current_ref !== view.source_ref || view.head !== view.source_head || !view.clean || view.lock_present || view.source_lock_present
      || view.source_symbolic || view.target_symbolic || !view.fast_forward || view.target_checked_out_elsewhere)
      fail("WORKFLOW_BRANCH_PRECONDITIONS_REQUIRED");
  }
  function fresh(plan, ownLocks = []) {
    assertPlan(plan); const observed = inspect(plan.observed);
    for (const owned of ownLocks) {
      const file = agentRunPhysicalPath(owned.path);
      if (fs.lstatSync(file).nlink !== 1 || fs.readFileSync(file, "utf8") !== owned.token) fail("WORKFLOW_BRANCH_LOCK_CHANGED");
      observed[owned.field] = false;
    }
    if (shadowHash(observed) !== shadowHash(plan.observed)) fail("WORKFLOW_BRANCH_PREVIEW_CHANGED");
  }
  const message = plan => "AIDN-Integration: " + plan.operation_id + " " + plan.plan_sha256;
  function appendedLog(ref, prior, oldHead, newHead, plan) {
    if (!Number.isSafeInteger(prior?.byte_length) || prior.byte_length < 0 || !/^[a-f0-9]{64}$/.test(prior.sha256 ?? "")) return false;
    const bytes = logBytes(ref);
    if (bytes.length <= prior.byte_length || hash(bytes.subarray(0, prior.byte_length)) !== prior.sha256) return false;
    const added = bytes.subarray(prior.byte_length).toString("utf8");
    const lines = added.split("\n");
    return lines.length === 2 && lines[1] === "" && lines[0].startsWith(oldHead + " " + newHead + " ") && lines[0].endsWith("\t" + message(plan));
  }
  function inspectIntegration(plan) {
    assertPlan(plan); const observed = inspect(plan.observed), expected = plan.observed;
    const matches = observed.current_ref === expected.target_ref && observed.head === expected.source_head && observed.source_head === expected.source_head
      && observed.target_head === expected.source_head && observed.index_sha256 === expected.index_sha256 && observed.clean && !observed.lock_present
      && !observed.source_lock_present && !observed.source_symbolic && !observed.target_symbolic && !observed.target_checked_out_elsewhere
      && observed.worktree_bindings_sha256 === expected.worktree_bindings_sha256 && observed.filter_context_sha256 === expected.filter_context_sha256
      && appendedLog("HEAD", expected.head_reflog, expected.source_head, expected.source_head, plan)
      && (expected.target_head === expected.source_head ? shadowHash(logState(expected.target_ref)) === shadowHash(expected.target_reflog)
        : appendedLog(expected.target_ref, expected.target_reflog, expected.target_head, expected.source_head, plan));
    return matches ? { status: "confirmed", source_branch: expected.source_branch, target_branch: expected.target_branch, head: expected.source_head,
      previous_target_head: expected.target_head, index_unchanged: true, tree_unchanged: true } : { status: "not_confirmed" };
  }
  async function integrate(plan, { write = false, assertAuthorized } = {}) {
    const owned = []; let attempted = false, primary = null;
    function release() {
      for (const row of [...owned].reverse()) {
        if (row.descriptor !== null) { fs.closeSync(row.descriptor); row.descriptor = null; }
        if (row.released) continue;
        if (!fs.existsSync(row.path) || fs.readFileSync(agentRunPhysicalPath(row.path), "utf8") !== row.token) fail("WORKFLOW_BRANCH_LOCK_CHANGED");
        fs.unlinkSync(row.path); row.released = true;
      }
    }
    function acquire(file, field) {
      const token = JSON.stringify({ token: randomUUID(), operation_id: plan.operation_id, plan_sha256: plan.plan_sha256 });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      let descriptor;
      try { descriptor = fs.openSync(file, "wx"); } catch { fail("WORKFLOW_BRANCH_INDEX_LOCKED"); }
      attempted = true; owned.push({ path: file, field, token, descriptor, released: false });
      fs.writeFileSync(descriptor, token); fs.fsyncSync(descriptor);
    }
    try {
      if (write !== true || typeof assertAuthorized !== "function") fail("WORKFLOW_BRANCH_EXPLICIT_WRITE_REQUIRED");
      fresh(plan); await assertAuthorized(); fresh(plan);
      if (plan.observed.source_ref === plan.observed.target_ref) return { status: "no_change", head: plan.observed.head, effect_status: "no_effect" };
      acquire(lock, "lock_present"); acquire(gitPath(plan.observed.source_ref + ".lock"), "source_lock_present");
      fresh(plan, owned); await assertAuthorized(); fresh(plan, owned);
      await beforeTransaction?.(structuredClone(plan)); fresh(plan, owned); await assertAuthorized(); fresh(plan, owned);
      // Git rejects verifying the source ref and changing its symbolic HEAD in
      // one transaction. Our source lock fences its OID; the native transaction
      // verifies HEAD's old referent and the target's old OID atomically.
      git(["-c", "core.logAllRefUpdates=true", "update-ref", "--create-reflog", "-m", message(plan), "--stdin"],
        "start\nupdate " + plan.observed.target_ref + " " + plan.observed.source_head + " " + plan.observed.target_head
        + "\noption no-deref\nsymref-update HEAD " + plan.observed.target_ref + " ref " + plan.observed.source_ref + "\nprepare\ncommit\n");
      await afterTransaction?.(structuredClone(plan)); await assertAuthorized(); release();
      const proof = inspectIntegration(plan); if (proof.status !== "confirmed") fail("WORKFLOW_BRANCH_POSTCONDITION_UNCONFIRMED");
      return { ...proof, effect_status: "confirmed" };
    } catch (cause) { primary = cause; cause.effect_status = attempted ? "unknown" : "no_effect"; throw cause; }
    finally { try { release(); } catch (cause) { if (!primary) { cause.effect_status = attempted ? "unknown" : "no_effect"; throw cause; } } }
  }
  return assertWorkflowBranchIntegrationPort(Object.freeze({ inspect, integrate, inspectIntegration }));
}
