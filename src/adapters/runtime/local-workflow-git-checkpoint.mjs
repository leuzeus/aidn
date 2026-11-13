import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { assertWorkflowGitCheckpointPort } from "../../core/ports/workflow-git-checkpoint-port.mjs";
import { agentRunPhysicalPath } from "../../application/runtime/agent-run-configuration-service.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sha = value => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value ?? "");
const exact = value => JSON.stringify(value);
const sessionPath = name => /^(?:docs\/audit\/(?:CURRENT-STATE|RUNTIME-STATE)\.md|docs\/audit\/sessions\/S[0-9]{3,6}\.md)$/.test(name);

// This port writes Git objects, one approved ref and its worktree index. It
// does not execute repository hooks, filters, a shell or a remote operation.
// Configured commit signing remains applicable to commit-tree.
export function createLocalWorkflowGitCheckpoint({ targetRoot, environment = process.env }, {
  beforeRef = null, afterRef = null, profile = "session-metadata", approvedPaths = null,
} = {}) {
  const root = agentRunPhysicalPath(path.resolve(targetRoot), { directory: true });
  // Only trusted application composition supplies the terminal postimage set.
  // Process JSON never selects this profile or its paths.
  const relative = name => typeof name === "string" && name.length > 0 && name.length <= 2048
    && !/[\\\u0000-\u001f]/.test(name) && !path.posix.isAbsolute(name) && !path.win32.isAbsolute(name)
    && !name.split("/").some(part => !part || part === "." || part === "..")
    && !/^(?:[.]git|[.]aidn)(?:\/|$)/i.test(name);
  const choicePath = name => /^docs\/audit\/(?:CURRENT-STATE[.]md|sessions\/S[0-9]{3,6}[.]md|snapshots\/context-snapshot[.]md|cycles\/C[0-9]{3,6}-[A-Za-z0-9._-]+\/status[.]md)$/.test(name);
  if (!["session-metadata", "cycle-terminal", "cycle-choice"].includes(profile)
    || profile === "session-metadata" && approvedPaths !== null
    || profile !== "session-metadata" && (!Array.isArray(approvedPaths) || approvedPaths.length > (profile === "cycle-choice" ? 131 : 128)
      || new Set(approvedPaths).size !== approvedPaths.length || !approvedPaths.every(relative)
      || profile === "cycle-choice" && !approvedPaths.every(choicePath))) fail("WORKFLOW_GIT_SCOPE_PROFILE_INVALID");
  const approved = new Set(approvedPaths ?? []), scopePath = profile === "session-metadata" ? sessionPath : name => approved.has(name);
  const maxFiles = profile === "session-metadata" ? 3 : approved.size;
  if (Object.keys(environment).some(name => /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG(?:_.*)?)$/i.test(name)))
    fail("WORKFLOW_GIT_ENV_SCOPE_CONFLICT");
  const env = Object.fromEntries(Object.entries(environment).filter(([name]) => !/^GIT_/i.test(name)));
  const fixed = ["--literal-pathspecs", "-C", root, "-c", "core.fsmonitor=false", "-c", "gc.auto=0", "-c", "maintenance.auto=false",
    "-c", "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null")];
  const configArguments = [...fixed];
  function filters() {
    const result = spawnSync("git", [...configArguments, "config", "--null", "--get-regexp", "^filter\\..*\\.(clean|smudge|process|required)$"],
      { env, encoding: "utf8", shell: false, windowsHide: true, timeout: 60000, maxBuffer: 1048576, stdio: "pipe" });
    if (![0, 1].includes(result.status)) fail("WORKFLOW_GIT_FILTER_CONTEXT_UNAVAILABLE");
    return result.stdout;
  }
  // Pin the effective context before adding overrides, including on a cold
  // reopen. Status/diff may otherwise execute a configured clean/process filter.
  const configuredFilters = filters(), filterContextSha256 = hash(configuredFilters);
  for (const name of new Set(configuredFilters.split("\0").filter(Boolean).map(row => /^filter\.(.+)\.(?:clean|smudge|process|required)\n/.exec(row)?.[1]))) {
    if (!name || /[\r\n\0]/.test(name)) fail("WORKFLOW_GIT_FILTER_CONTEXT_INVALID");
    for (const member of ["clean", "smudge", "process"]) fixed.push("-c", `filter.${name}.${member}=`);
    fixed.push("-c", `filter.${name}.required=false`);
  }
  const run = (args, { input, binary = false, variables = {}, acceptable = [] } = {}) => {
    try { return execFileSync("git", [...fixed, ...args], {
      input, encoding: binary ? undefined : "utf8", env: { ...env, GIT_OPTIONAL_LOCKS: "0", ...variables },
      windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (cause) { if (acceptable.includes(cause.status)) return null; throw Object.assign(new Error("WORKFLOW_GIT_COMMAND_FAILED"), { code: "WORKFLOW_GIT_COMMAND_FAILED", command: args[0], exit_code: cause.status }); }
  };
  function repositoryObservation({ includeHead = false } = {}) {
    const args = ["rev-parse", "--show-toplevel", "--absolute-git-dir", "--git-path", "index"];
    if (includeHead) args.push("--verify", "HEAD");
    const output = run(args, { acceptable: includeHead ? [128] : [] });
    if (output === null) return null;
    const rows = output.trimEnd().split(/\r?\n/);
    if (rows.length !== (includeHead ? 4 : 3) || path.resolve(rows[0]).toLowerCase() !== root.toLowerCase()) fail("WORKFLOW_GIT_TOPLEVEL_REQUIRED");
    return { binding: { gitDir: agentRunPhysicalPath(rows[1], { directory: true }),
      indexPath: agentRunPhysicalPath(path.resolve(root, rows[2]), { missing: true }) },
      head: includeHead ? rows[3] : null };
  }
  const { binding } = repositoryObservation(), { gitDir, indexPath } = binding;
  const lockPath = indexPath + ".lock";
  function file(name) {
    if (!scopePath(name)) fail("WORKFLOW_GIT_PATH_SCOPE_INVALID");
    const absolute = agentRunPhysicalPath(path.join(root, name));
    const before = fs.lstatSync(absolute);
    if (!before.isFile() || before.nlink !== 1) fail("WORKFLOW_GIT_UNSAFE_FILE");
    if (before.size > 1048576) fail("WORKFLOW_GIT_FILE_LIMIT");
    const bytes = fs.readFileSync(absolute), after = fs.lstatSync(absolute);
    if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs) fail("WORKFLOW_GIT_FILE_RACE");
    return { bytes, sha256: hash(bytes) };
  }
  const indexHash = () => fs.existsSync(indexPath) ? hash(fs.readFileSync(agentRunPhysicalPath(indexPath))) : null;
  function inspect() {
    // A gitfile can be redirected while this capability is retained. Never
    // combine Git observations from its new repository with the old index.
    // Resolve the physical binding and HEAD together on each inspection. An
    // unresolved HEAD takes the original diagnostic path, including binding
    // and filter checks before Git reports the missing commit.
    const observed = repositoryObservation({ includeHead: true }) ?? repositoryObservation();
    if (exact(observed.binding) !== exact(binding)) fail("WORKFLOW_GIT_REPOSITORY_BINDING_CHANGED");
    if (hash(filters()) !== filterContextSha256) fail("WORKFLOW_GIT_FILTER_CONTEXT_CHANGED");
    const ref = run(["symbolic-ref", "--quiet", "HEAD"], { acceptable: [1] })?.trim() ?? null;
    const head = observed.head ?? run(["rev-parse", "--verify", "HEAD"]).trim();
    if (!sha(head) || !ref?.startsWith("refs/heads/")) fail("WORKFLOW_GIT_NAMED_HEAD_REQUIRED");
    const status = run(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    const changes = status.split("\0").filter(Boolean).map(entry => {
      if (entry.length < 4 || /[RCU]/.test(entry.slice(0, 2))) fail("WORKFLOW_GIT_STATUS_UNSUPPORTED");
      return { status: entry.slice(0, 2), path: entry.slice(3) };
    });
    const indexClean = run(["diff", "--cached", "--quiet", "HEAD", "--"], { acceptable: [1] }) !== null;
    const identity = run(["var", "GIT_AUTHOR_IDENT"]).trim().match(/^([^\r\n<>]+) <([^\r\n<>]+)> [0-9]+ [+-][0-9]{4}$/);
    if (!identity) fail("WORKFLOW_GIT_IDENTITY_REQUIRED");
    const signing = run(["config", "--bool", "--get", "commit.gpgSign"], { acceptable: [1] })?.trim() === "true";
    return { branch: ref.slice(11), ref, head, index_sha256: indexHash(), index_clean: indexClean,
      lock_present: fs.existsSync(lockPath), changes, identity: { name: identity[1], email: identity[2] }, signing, filter_context_sha256: filterContextSha256 };
  }
  function assertMaterial(plan) {
    if (!/^op_[a-f0-9]{40}$/.test(plan?.operation_id ?? "") || !/^[a-f0-9]{64}$/.test(plan.plan_sha256 ?? "")
      || !Number.isSafeInteger(plan.prepared_at_ms) || !Array.isArray(plan.files) || plan.files.length > maxFiles
      || new Set(plan.files.map(row => row.path)).size !== plan.files.length) fail("WORKFLOW_GIT_PLAN_INVALID");
    for (const row of plan.files) if (!scopePath(row.path) || !/^[a-f0-9]{64}$/.test(row.sha256)) fail("WORKFLOW_GIT_PLAN_INVALID");
  }
  function assertFresh(plan, { ownLock = false } = {}) {
    assertMaterial(plan);
    const current = inspect();
    for (const key of ["ref", "head", "index_sha256", "identity", "signing", "filter_context_sha256"])
      if (exact(current[key]) !== exact(plan.observed[key])) fail("WORKFLOW_GIT_PRECONDITION_CHANGED");
    if (!current.index_clean || current.lock_present && !ownLock || current.changes.some(row => !plan.files.some(file => file.path === row.path))
      || current.changes.length !== plan.files.length) fail("WORKFLOW_GIT_FOREIGN_CHANGES");
    for (const row of plan.files) if (file(row.path).sha256 !== row.sha256) fail("WORKFLOW_GIT_POSTIMAGE_CHANGED");
    return current;
  }
  const title = profile === "session-metadata" ? "chore: checkpoint governed session metadata"
    : profile === "cycle-choice" ? "chore: checkpoint canonical cycle choice" : "chore: checkpoint approved terminal cycle";
  const message = plan => `${title}\n\nAIDN-Operation: ${plan.operation_id}\nAIDN-Plan: ${plan.plan_sha256}\n`;
  function sampleTreeModes(head, names) {
    if (names.length < 2) return null;
    let rows;
    try {
      rows = run(["ls-tree", "-z", "--format=%(objectmode)%x09%(path)", head, "--", ...names]).split("\0");
    } catch (cause) {
      if (cause.code !== "WORKFLOW_GIT_COMMAND_FAILED") throw cause;
      return null;
    }
    if (rows.pop() !== "") return null;
    const modes = new Map(), requested = new Set(names);
    for (const row of rows) {
      const match = /^([0-7]{6})\t(.+)$/.exec(row);
      if (!match || !requested.has(match[2]) || modes.has(match[2])) return null;
      modes.set(match[2], match[1]);
    }
    return modes;
  }
  function treeMode(head, name, sample) {
    if (sample) return sample.get(name) ?? "";
    return run(["ls-tree", "--format=%(objectmode)", head, "--", name]).trim();
  }
  function gitMode(plan, name, sample) {
    const mode = treeMode(plan.observed.head, name, sample);
    if (mode) { if (!["100644", "100755"].includes(mode)) fail("WORKFLOW_GIT_FILE_MODE_UNSUPPORTED"); return mode; }
    const physical = agentRunPhysicalPath(path.join(root, name));
    return process.platform !== "win32" && fs.statSync(physical).mode & 0o111 ? "100755" : "100644";
  }
  function inspectCommit(plan) {
    assertMaterial(plan);
    if (plan.observed.filter_context_sha256 !== filterContextSha256 || hash(filters()) !== filterContextSha256)
      return { status: "not_confirmed", reason_code: "WORKFLOW_GIT_FILTER_CONTEXT_CHANGED" };
    const head = run(["rev-parse", "--verify", plan.observed.ref]).trim();
    if (head === plan.observed.head) return { status: "not_confirmed", reason_code: "WORKFLOW_GIT_COMMIT_NOT_OBSERVED" };
    const parent = run(["rev-list", "--parents", "-n", "1", head]).trim().split(" ");
    const body = run(["show", "-s", "--format=%B", head]);
    const paths = run(["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", head]).split("\0").filter(Boolean).sort();
    if (parent.length !== 2 || parent[1] !== plan.observed.head || body.trimEnd() !== message(plan).trimEnd()
      || exact(paths) !== exact(plan.files.map(row => row.path).sort())) return { status: "not_confirmed", reason_code: "WORKFLOW_GIT_COMMIT_AMBIGUOUS" };
    const names = plan.files.map(row => row.path);
    let modes;
    for (const row of plan.files) {
      if (hash(run(["show", `${head}:${row.path}`], { binary: true })) !== row.sha256)
        return { status: "not_confirmed", reason_code: "WORKFLOW_GIT_COMMIT_POSTIMAGE_MISMATCH" };
      modes ??= [sampleTreeModes(head, names), sampleTreeModes(plan.observed.head, names)];
      if (treeMode(head, row.path, modes[0]) !== gitMode(plan, row.path, modes[1]))
        return { status: "not_confirmed", reason_code: "WORKFLOW_GIT_COMMIT_MODE_MISMATCH" };
    }
    const workspace = inspect(), ready = workspace.ref === plan.observed.ref && workspace.head === head && workspace.index_clean && workspace.changes.length === 0;
    return { status: ready ? "confirmed" : "commit_observed", commit_sha: head, parent_sha: parent[1],
      index_reconciled: workspace.index_clean, working_tree_clean: workspace.changes.length === 0, lock_present: workspace.lock_present };
  }
  async function commit(plan, { assertAuthorized } = {}) {
    let attempted = false, lockFd = null, temporary = null, lockToken = null, primary = null;
    function releaseOwnLock() {
      if (lockFd !== null) { fs.closeSync(lockFd); lockFd = null; }
      if (lockToken !== null) {
        if (!fs.existsSync(lockPath) || fs.readFileSync(lockPath, "utf8") !== lockToken) fail("WORKFLOW_GIT_LOCK_OWNERSHIP_CHANGED");
        fs.unlinkSync(lockPath); lockToken = null;
      }
    }
    try {
      if (typeof assertAuthorized !== "function") fail("WORKFLOW_GIT_AUTHORIZATION_REQUIRED");
      assertFresh(plan); await assertAuthorized(); assertFresh(plan);
      if (!plan.files.length) return { status: "no_change", head: plan.observed.head, effect_status: "no_effect" };
      const sampledModes = sampleTreeModes(plan.observed.head, plan.files.map(row => row.path));
      const modes = new Map(plan.files.map(row => [row.path, gitMode(plan, row.path, sampledModes)]));
      lockToken = JSON.stringify({ operation_id: plan.operation_id, plan_sha256: plan.plan_sha256, token: randomUUID() });
      try { lockFd = fs.openSync(lockPath, "wx"); } catch { fail("WORKFLOW_GIT_INDEX_LOCKED"); }
      attempted = true; fs.writeFileSync(lockFd, lockToken); fs.fsyncSync(lockFd);
      assertFresh(plan, { ownLock: true });
      temporary = fs.mkdtempSync(path.join(gitDir, "aidn-metadata-checkpoint-"));
      const privateIndex = path.join(temporary, "index"), variables = { GIT_INDEX_FILE: privateIndex };
      run(["read-tree", plan.observed.head], { variables });
      for (const row of plan.files) {
        const captured = file(row.path); if (captured.sha256 !== row.sha256) fail("WORKFLOW_GIT_POSTIMAGE_CHANGED");
        const blob = run(["hash-object", "-w", "--stdin"], { input: captured.bytes, variables }).trim();
        run(["update-index", "--add", "--cacheinfo", `${modes.get(row.path)},${blob},${row.path}`], { variables });
      }
      const tree = run(["write-tree"], { variables }).trim(), date = `${Math.floor(plan.prepared_at_ms / 1000)} +0000`;
      const identity = { GIT_AUTHOR_NAME: plan.observed.identity.name, GIT_AUTHOR_EMAIL: plan.observed.identity.email,
        GIT_COMMITTER_NAME: plan.observed.identity.name, GIT_COMMITTER_EMAIL: plan.observed.identity.email, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
      const next = run(["commit-tree", ...(plan.observed.signing ? ["-S"] : []), tree, "-p", plan.observed.head], { input: message(plan), variables: { ...variables, ...identity } }).trim();
      await assertAuthorized(); assertFresh(plan, { ownLock: true });
      await beforeRef?.({ expected_head: plan.observed.head });
      run(["update-ref", plan.observed.ref, next, plan.observed.head]);
      await afterRef?.({ commit_sha: next });
      if (run(["symbolic-ref", "--quiet", "HEAD"]).trim() !== plan.observed.ref || indexHash() !== plan.observed.index_sha256)
        fail("WORKFLOW_GIT_INDEX_RECONCILIATION_REQUIRED");
      for (const row of plan.files) if (file(row.path).sha256 !== row.sha256) fail("WORKFLOW_GIT_POSTIMAGE_CHANGED");
      fs.renameSync(privateIndex, indexPath);
      const proof = inspectCommit(plan); if (proof.status !== "confirmed" || proof.commit_sha !== next) fail("WORKFLOW_GIT_COMMIT_UNCONFIRMED");
      await assertAuthorized();
      const final = inspect(); if (final.changes.length || !final.index_clean) fail("WORKFLOW_GIT_FINAL_STATE_UNCONFIRMED");
      fs.rmdirSync(temporary); temporary = null;
      releaseOwnLock();
      return { ...proof, lock_present: false, effect_status: "confirmed" };
    } catch (cause) { primary = cause; cause.effect_status = attempted ? "unknown" : "no_effect"; throw cause; }
    finally {
      try { releaseOwnLock(); } catch (cause) { if (!primary) { cause.effect_status = attempted ? "unknown" : "no_effect"; throw cause; } }
      // An uncertain private index is retained for explicit reconciliation.
    }
  }
  return assertWorkflowGitCheckpointPort(Object.freeze({ inspect, commit, inspectCommit }));
}
