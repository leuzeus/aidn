import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { createLocalWorkflowBranchIntegration } from "./local-workflow-branch-integration.mjs";
import { agentRunPhysicalPath } from "../../application/runtime/agent-run-configuration-service.mjs";
import { checkShadowJson, shadowHash } from "../../core/workflow/shadow-json.mjs";
import { assertWorkflowCycleActivationPort } from "../../core/ports/workflow-cycle-activation-port.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = code => { throw Object.assign(Error(code), { code }); };
const key = value => process.platform === "win32" ? value.toLowerCase() : value;
const canonical = name => name.toLowerCase().startsWith("docs/audit/");
const configuration = name => /^(?:[.]aidn\/|[.]codex\/|[.]agents\/)/i.test(name) || ["agents.md", ".gitignore"].includes(name.toLowerCase());
const relative = name => typeof name === "string" && name && !/[\\:\u0000-\u001f]/.test(name)
  && !path.posix.isAbsolute(name) && !path.win32.isAbsolute(name)
  && !name.split("/").some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git");
const regular = row => row === null || !!row && ["100644", "100755"].includes(row.mode);

// Application composition supplies the branches and grant; authored workflow
// data cannot select a command, preserved namespace, executable or test port.
// A target index and raw product blobs are prepared privately. Canonical audit
// files and local configuration are never checked out from the selected ref.
export function createLocalWorkflowCycleActivation({ targetRoot, environment = process.env },
  { afterWorktreeChange = null, afterEffect = null, gitExecutable = "git" } = {}) {
  const root = agentRunPhysicalPath(path.resolve(targetRoot), { directory: true });
  const observer = createLocalWorkflowBranchIntegration({ targetRoot: root, environment }, { gitExecutable });
  const env = { ...Object.fromEntries(Object.entries(environment).filter(([name]) => !/^GIT_/i.test(name))),
    GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" };
  const fixed = ["--literal-pathspecs", "-C", root, "-c", "core.fsmonitor=false", "-c", "gc.auto=0",
    "-c", "maintenance.auto=false", "-c", "status.renames=false", "-c", "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null")];
  const filters = spawnSync(gitExecutable, [...fixed, "config", "--null", "--get-regexp", "^filter\\..*\\.(clean|smudge|process|required)$"],
    { env, encoding: "utf8", windowsHide: true, timeout: 10000, stdio: "pipe" });
  if (![0, 1].includes(filters.status)) fail("WORKFLOW_ACTIVATION_FILTER_CONTEXT_UNAVAILABLE");
  for (const name of new Set(filters.stdout.split("\0").filter(Boolean).map(row => /^filter\.(.+)\.(?:clean|smudge|process|required)\n/.exec(row)?.[1]))) {
    if (!name || /[\r\n\0]/.test(name)) fail("WORKFLOW_ACTIVATION_FILTER_CONTEXT_INVALID");
    for (const member of ["clean", "smudge", "process"]) fixed.push("-c", `filter.${name}.${member}=`);
    fixed.push("-c", `filter.${name}.required=false`);
  }
  function git(args, { input, variables = {} } = {}) {
    try { return execFileSync(gitExecutable, [...fixed, ...args], { env: { ...env, ...variables }, input, encoding: "utf8",
      windowsHide: true, timeout: 10000, maxBuffer: 4194304, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (cause) { throw Object.assign(Error("WORKFLOW_ACTIVATION_GIT_FAILED"), { code: "WORKFLOW_ACTIVATION_GIT_FAILED", command: args[0], exit_code: cause.status }); }
  }
  function liveBinding() {
    const output = execFileSync(gitExecutable, ["--literal-pathspecs", "-C", root, "rev-parse", "--path-format=absolute",
      "--absolute-git-dir", "--git-common-dir", "--git-path", "index"], { env: { ...env, GIT_COMMON_DIR: undefined }, encoding: "utf8",
      windowsHide: true, timeout: 10000, stdio: "pipe" }).trimEnd().split(/\r?\n/);
    if (output.length !== 3) fail("WORKFLOW_ACTIVATION_REPOSITORY_BINDING_INVALID");
    return output.map(value => agentRunPhysicalPath(path.resolve(root, value), { missing: true }));
  }
  const binding = liveBinding(), [gitDir, commonDir, index] = binding, indexLock = index + ".lock";
  env.GIT_COMMON_DIR = commonDir;
  fixed.push("--git-dir=" + gitDir, "--work-tree=" + root);
  const assertBinding = () => { if (shadowHash(liveBinding()) !== shadowHash(binding)) fail("WORKFLOW_ACTIVATION_REPOSITORY_BINDING_CHANGED"); };
  const gitPath = name => agentRunPhysicalPath(path.resolve(root, git(["rev-parse", "--git-path", name]).trim()), { missing: true });
  function file(name) {
    if (!relative(name)) fail("WORKFLOW_ACTIVATION_PATH_INVALID");
    const absolute = agentRunPhysicalPath(path.join(root, name), { missing: true });
    if (!fs.existsSync(absolute)) return null;
    const before = fs.lstatSync(absolute);
    if (!before.isFile() || before.nlink !== 1) fail("WORKFLOW_ACTIVATION_REGULAR_FILE_REQUIRED");
    const descriptor = fs.openSync(absolute, "r"), digest = createHash("sha256"), buffer = Buffer.alloc(65536);
    try { for (let count; (count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0;) digest.update(buffer.subarray(0, count)); }
    finally { fs.closeSync(descriptor); }
    const after = fs.lstatSync(absolute);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      fail("WORKFLOW_ACTIVATION_FILE_CHANGED");
    return { sha256: digest.digest("hex"), bytes: after.size, mode: after.mode & 0o777 };
  }
  function tree(head) {
    const rows = git(["ls-tree", "-r", "-z", "--full-tree", head]).split("\0").filter(Boolean).map(line => {
      const match = /^([0-7]{6}) blob ([a-f0-9]{40}|[a-f0-9]{64})\t(.+)$/.exec(line);
      if (!match || !relative(match[3])) fail("WORKFLOW_ACTIVATION_TREE_UNSUPPORTED");
      return { path: match[3], mode: match[1], oid: match[2] };
    });
    if (new Set(rows.map(row => key(row.path))).size !== rows.length || rows.some(row => !regular(row))) fail("WORKFLOW_ACTIVATION_TREE_UNSUPPORTED");
    return new Map(rows.map(row => [row.path, row]));
  }
  function inspect(branches) {
    assertBinding();
    const base = observer.inspect(branches), source = tree(base.source_head), target = tree(base.target_head);
    const names = [...new Set([...source.keys(), ...target.keys()])].sort(), changes = [], preserved = [], overlay = [];
    for (const name of names) {
      const left = source.get(name) ?? null, right = target.get(name) ?? null;
      if (configuration(name)) {
        if (shadowHash(left) !== shadowHash(right)) fail("WORKFLOW_ACTIVATION_CONFIGURATION_DIFFERENCE");
        continue;
      }
      if (canonical(name)) {
        preserved.push({ path: name, content: file(name) });
        if (shadowHash(left) !== shadowHash(right)) overlay.push(name);
        continue;
      }
      if (shadowHash(left) === shadowHash(right)) continue;
      const before = file(name);
      if ((left === null) !== (before === null)) fail("WORKFLOW_ACTIVATION_PATH_COLLISION");
      // File/directory transitions require a separate explicit reconciliation.
      // This port never recursively deletes a worktree directory or its data.
      for (let parent = path.posix.dirname(name); parent !== "."; parent = path.posix.dirname(parent))
        if (source.has(parent) || target.has(parent)) fail("WORKFLOW_ACTIVATION_PATH_COLLISION");
      changes.push({ path: name, before, target: right });
    }
    return { base, canonical: preserved, changes, canonical_overlay_paths: overlay };
  }
  function assertPlan(plan) {
    const observed = plan?.observed;
    if (checkShadowJson(plan) || Object.keys(plan ?? {}).sort().join(",") !== "observed,operation_id,plan_sha256"
      || !/^op_[a-f0-9]{40}$/.test(plan.operation_id ?? "") || !/^[a-f0-9]{64}$/.test(plan.plan_sha256 ?? "")
      || !observed || Object.keys(observed).sort().join(",") !== "base,canonical,canonical_overlay_paths,changes"
      || !Array.isArray(observed.canonical) || !Array.isArray(observed.changes) || !Array.isArray(observed.canonical_overlay_paths)
      || observed.canonical.some(row => !relative(row.path) || !canonical(row.path))
      || observed.changes.some(row => !relative(row.path) || canonical(row.path) || configuration(row.path) || !regular(row.target)))
      fail("WORKFLOW_ACTIVATION_PLAN_INVALID");
    const base = observed.base;
    if (base.current_ref !== base.source_ref || base.head !== base.source_head || !base.clean || base.lock_present || base.source_lock_present
      || base.source_symbolic || base.target_symbolic || base.target_checked_out_elsewhere) fail("WORKFLOW_ACTIVATION_PRECONDITIONS_REQUIRED");
    return observed;
  }
  const message = plan => "AIDN-Cycle-Activation: " + plan.operation_id + " " + plan.plan_sha256;
  function preserved(plan) { return plan.observed.canonical.every(row => shadowHash(file(row.path)) === shadowHash(row.content)); }
  function productMatches(row) {
    if (row.target === null) return file(row.path) === null;
    if (!file(row.path)) return false;
    return git(["hash-object", "--no-filters", "--", row.path]).trim() === row.target.oid;
  }
  function changedPaths() {
    return git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0").filter(Boolean).map(row => {
      if (row.length < 4 || /[RCU]/.test(row.slice(0, 2))) fail("WORKFLOW_ACTIVATION_STATUS_UNSUPPORTED");
      return row.slice(3);
    });
  }
  function indexMatches(head) {
    const result = spawnSync(gitExecutable, [...fixed, "diff", "--no-ext-diff", "--no-textconv", "--cached", "--quiet", head, "--"],
      { env, windowsHide: true, timeout: 10000, stdio: "pipe" });
    if (![0, 1].includes(result.status)) fail("WORKFLOW_ACTIVATION_INDEX_UNAVAILABLE");
    return result.status === 0;
  }
  function inspectActivation(plan) {
    assertBinding();
    const expected = assertPlan(plan), before = expected.base, actual = observer.inspect(before);
    if (before.source_ref === before.target_ref) return shadowHash(inspect(before)) === shadowHash(expected)
      ? { status: "no_change", head: before.head, effect_status: "no_effect" } : { status: "not_confirmed" };
    const log = fs.readFileSync(gitPath("logs/HEAD")), prior = before.head_reflog, appended = log.subarray(prior.byte_length).toString("utf8").split("\n");
    const causal = log.length > prior.byte_length && hash(log.subarray(0, prior.byte_length)) === prior.sha256
      && appended.length === 2 && appended[1] === "" && appended[0].startsWith(before.source_head + " " + before.target_head + " ")
      && appended[0].endsWith("\t" + message(plan));
    if (actual.current_ref !== before.target_ref || actual.head !== before.target_head || actual.source_head !== before.source_head
      || actual.target_head !== before.target_head || actual.lock_present || actual.source_lock_present || actual.source_symbolic || actual.target_symbolic
      || actual.target_checked_out_elsewhere || actual.worktree_bindings_sha256 !== before.worktree_bindings_sha256
      || actual.filter_context_sha256 !== before.filter_context_sha256 || shadowHash(actual.target_reflog) !== shadowHash(before.target_reflog)
      || !causal || !preserved(plan) || !expected.changes.every(productMatches)
      || changedPaths().some(name => !expected.canonical_overlay_paths.includes(name))
      || !indexMatches(before.target_head)) return { status: "not_confirmed" };
    return { status: "confirmed", branch: before.target_branch, head: before.target_head, source_head: before.source_head,
      target_ref_unchanged: true, canonical_preserved: true, canonical_overlay_paths: expected.canonical_overlay_paths,
      product_tree_checked_out: true, implementation_authorized: false };
  }
  async function activate(plan, { write = false, assertAuthorized } = {}) {
    const expected = assertPlan(plan), owned = [], applied = new Set(); let attempted = false, temporary = null, loose = null, primary = null;
    const inode = stat => String(stat.dev) + ":" + String(stat.ino);
    function release(row) {
      if (row.descriptor !== null) { fs.closeSync(row.descriptor); row.descriptor = null; }
      if (row.released) return;
      if (!fs.existsSync(row.path) || inode(fs.lstatSync(row.path)) !== row.inode || hash(fs.readFileSync(row.path)) !== row.sha256)
        fail("WORKFLOW_ACTIVATION_LOCK_CHANGED");
      fs.unlinkSync(row.path); row.released = true;
    }
    function acquire(name, field) {
      const token = JSON.stringify({ token: randomUUID(), operation_id: plan.operation_id, plan_sha256: plan.plan_sha256 });
      fs.mkdirSync(path.dirname(name), { recursive: true });
      let descriptor; try { descriptor = fs.openSync(name, "wx"); } catch { fail("WORKFLOW_ACTIVATION_LOCKED"); }
      attempted = true; const row = { path: name, field, descriptor, inode: inode(fs.fstatSync(descriptor)), sha256: hash(token), released: false };
      owned.push(row); fs.writeFileSync(descriptor, token); fs.fsyncSync(descriptor); return row;
    }
    function fresh() {
      assertBinding();
      const actual = observer.inspect(expected.base);
      for (const row of owned) {
        if (inode(fs.lstatSync(row.path)) !== row.inode || hash(fs.readFileSync(row.path)) !== row.sha256) fail("WORKFLOW_ACTIVATION_LOCK_CHANGED");
        actual[row.field] = false;
      }
      actual.clean = expected.base.clean;
      if (shadowHash(actual) !== shadowHash(expected.base) || !preserved(plan)
        || changedPaths().some(name => !applied.has(name))
        || expected.changes.some(row => applied.has(row.path) ? !productMatches(row) : shadowHash(file(row.path)) !== shadowHash(row.before)))
        fail("WORKFLOW_ACTIVATION_PREVIEW_CHANGED");
    }
    try {
      if (write !== true || typeof assertAuthorized !== "function") fail("WORKFLOW_ACTIVATION_EXPLICIT_WRITE_REQUIRED");
      if (shadowHash(inspect(expected.base)) !== shadowHash(expected)) fail("WORKFLOW_ACTIVATION_PREVIEW_CHANGED");
      if (git(["ls-files", "-v", "-z"]).split("\0").filter(Boolean).some(row => !row.startsWith("H "))) fail("WORKFLOW_ACTIVATION_INDEX_FLAGS_UNSUPPORTED");
      await assertAuthorized(); fresh();
      if (expected.base.source_ref === expected.base.target_ref) return { status: "no_change", head: expected.base.head, effect_status: "no_effect" };
      const indexOwner = acquire(indexLock, "lock_present"); acquire(gitPath(expected.base.source_ref + ".lock"), "source_lock_present");
      temporary = fs.mkdtempSync(path.join(gitDir, "aidn-cycle-activation-"));
      // Diagnostic attribution only: this marker grants no authority and is
      // never accepted in place of the caller's operation journal or grant.
      fs.writeFileSync(path.join(temporary, "owner.json"), JSON.stringify({ operation_id: plan.operation_id, plan_sha256: plan.plan_sha256 }) + "\n", { flag: "wx" });
      const privateIndex = path.join(temporary, "index"), variables = { GIT_INDEX_FILE: privateIndex };
      git(["read-tree", expected.base.target_head], { variables });
      for (const row of expected.changes.filter(row => row.target !== null)) {
        const staged = path.join(temporary, "files", row.path); fs.mkdirSync(path.dirname(staged), { recursive: true });
        const descriptor = fs.openSync(staged, "wx", 0o600);
        let result; try { result = spawnSync(gitExecutable, [...fixed, "cat-file", "blob", row.target.oid],
          { env, windowsHide: true, timeout: 10000, stdio: ["ignore", descriptor, "pipe"] }); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
        if (result.status !== 0 || git(["hash-object", "--no-filters", "--", staged]).trim() !== row.target.oid) fail("WORKFLOW_ACTIVATION_BLOB_UNAVAILABLE");
      }
      for (const row of expected.changes) {
        await assertAuthorized(); fresh();
        const absolute = agentRunPhysicalPath(path.join(root, row.path), { missing: true });
        if (row.target === null) fs.unlinkSync(absolute);
        else {
          fs.mkdirSync(path.dirname(absolute), { recursive: true }); agentRunPhysicalPath(path.dirname(absolute), { directory: true });
          loose = absolute + ".aidn-activation-" + randomUUID(); fs.copyFileSync(path.join(temporary, "files", row.path), loose, fs.constants.COPYFILE_EXCL);
          if (process.platform !== "win32") fs.chmodSync(loose, row.target.mode === "100755" ? 0o755 : 0o644);
          if (shadowHash(file(row.path)) !== shadowHash(row.before)) fail("WORKFLOW_ACTIVATION_FILE_CHANGED");
          fs.renameSync(loose, absolute); loose = null;
        }
        applied.add(row.path); await afterWorktreeChange?.(structuredClone(row));
      }
      await assertAuthorized(); fresh();
      const bytes = fs.readFileSync(privateIndex); fs.ftruncateSync(indexOwner.descriptor, 0); fs.writeSync(indexOwner.descriptor, bytes, 0, bytes.length, 0);
      fs.fsyncSync(indexOwner.descriptor); indexOwner.sha256 = hash(bytes); fs.closeSync(indexOwner.descriptor); indexOwner.descriptor = null;
      fresh();
      // Verify the target and CAS symbolic HEAD natively. The source ref and
      // index are fenced; neither branch tip is advanced or rewritten.
      git(["-c", "core.logAllRefUpdates=true", "update-ref", "--create-reflog", "-m", message(plan), "--stdin"], { input:
        "start\nverify " + expected.base.target_ref + " " + expected.base.target_head + "\noption no-deref\nsymref-update HEAD "
        + expected.base.target_ref + " ref " + expected.base.source_ref + "\nprepare\ncommit\n" });
      fs.renameSync(indexOwner.path, index); indexOwner.released = true;
      await afterEffect?.(structuredClone(plan)); await assertAuthorized();
      for (const row of [...owned].reverse()) release(row);
      const proof = inspectActivation(plan); if (proof.status !== "confirmed") fail("WORKFLOW_ACTIVATION_POSTCONDITION_UNCONFIRMED");
      return { ...proof, effect_status: "confirmed" };
    } catch (cause) { primary = cause; cause.effect_status = attempted ? "unknown" : "no_effect"; throw cause; }
    finally {
      try {
        for (const row of [...owned].reverse()) release(row);
        if (loose !== null && fs.existsSync(loose)) fs.unlinkSync(agentRunPhysicalPath(loose));
        if (temporary !== null && fs.existsSync(temporary)) {
          const actual = agentRunPhysicalPath(temporary, { directory: true });
          if (key(path.dirname(actual)) !== key(gitDir) || !path.basename(actual).startsWith("aidn-cycle-activation-")) fail("WORKFLOW_ACTIVATION_TEMP_SCOPE_CHANGED");
          fs.rmSync(actual, { recursive: true, force: true });
        }
      } catch (cause) { if (!primary) { cause.effect_status = attempted ? "unknown" : "no_effect"; throw cause; } }
    }
  }
  return assertWorkflowCycleActivationPort(Object.freeze({ inspect, activate, inspectActivation }));
}
