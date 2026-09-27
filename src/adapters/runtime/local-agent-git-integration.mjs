import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { assertAgentGitIntegration } from "../../core/ports/agent-git-integration-port.mjs";
import { assertAgentExecutionContract, fingerprintAgentExecutionValue as fingerprint, isExactExecutionPath } from "../../core/agents/agent-execution-contracts.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = code => { throw Object.assign(new Error(code), { code }); };
const requireProof = (condition, code) => { if (!condition) fail(code); };
const key = value => process.platform === "win32" ? value.toLowerCase() : value;
const same = (a, b) => fingerprint(a) === fingerprint(b);
const sha = value => typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const id = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const inside = (root, target) => { const relative = path.relative(root, target); return relative && !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`); };
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object"
  ? `{${Object.keys(value).sort().map(name => `${JSON.stringify(name)}:${canonical(value[name])}`).join(",")}}` : JSON.stringify(value);

function safePath(input, { missing = false } = {}) {
  requireProof(typeof input === "string" && path.isAbsolute(input), "AGENT_GIT_ABSOLUTE_PATH_REQUIRED");
  const absolute = path.resolve(input), parsed = path.parse(absolute);
  let current = parsed.root, absent = false;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (absent) continue;
    try { requireProof(!fs.lstatSync(current).isSymbolicLink(), "AGENT_GIT_PATH_REDIRECT"); }
    catch (error) { if (missing && error.code === "ENOENT") absent = true; else throw error; }
  }
  return absent ? absolute : fs.realpathSync.native(absolute);
}

function fileState(file) {
  const before = fs.lstatSync(file);
  requireProof(before.isFile() && !before.isSymbolicLink() && before.nlink === 1, "AGENT_GIT_UNSAFE_FILE");
  const bytes = fs.readFileSync(file), after = fs.lstatSync(file);
  requireProof(before.ino === after.ino && before.dev === after.dev && before.size === after.size
    && before.mtimeMs === after.mtimeMs && before.mode === after.mode, "AGENT_GIT_CAPTURE_RACE");
  return { sha256: hash(bytes), bytes: bytes.length, executable: Boolean(before.mode & 0o111) };
}

async function snapshot(root, limits) {
  const files = {}, dirs = [], aliases = new Set(); let bytes = 0;
  async function walk(directory, prefix) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      if (!prefix && entry.name === ".git") continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      requireProof(isExactExecutionPath(relative), "AGENT_GIT_UNSAFE_ENTRY_PATH");
      const folded = relative.toLowerCase(); requireProof(!aliases.has(folded), "AGENT_GIT_PATH_ALIAS"); aliases.add(folded);
      const absolute = path.join(directory, entry.name), stat = fs.lstatSync(absolute);
      requireProof(!stat.isSymbolicLink(), "AGENT_GIT_PATH_REDIRECT");
      if (stat.isDirectory()) { dirs.push(relative); await walk(absolute, relative); }
      else { requireProof(bytes + stat.size <= limits.maxBytes, "AGENT_GIT_CAPTURE_LIMIT"); files[relative] = fileState(absolute); bytes += files[relative].bytes; }
      requireProof(aliases.size <= limits.maxEntries && bytes <= limits.maxBytes, "AGENT_GIT_CAPTURE_LIMIT");
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  await walk(root, ""); return { files, dirs };
}

function protectedPath(relative) {
  return /(^|\/)(?:\.git|\.aidn|\.codex|\.agents)(?:\/|$)/i.test(relative)
    || /(^|\/)agents(?:\.override)?\.md$/i.test(relative);
}

/** Bound to one repository and one dedicated integration ref. No command runs at construction. */
export function createLocalAgentGitIntegration({ repositoryRoot, resourcesRoot, integrationRef,
  verifyTermination, verifyMoves, verifyGitTermination, gitExecutable = "git", spawnProcess = spawn,
  commandTimeoutMs = 10000, stopGraceMs = 1000, maxEntries = 20000, maxBytes = 128 * 1024 * 1024 } = {}) {
  requireProof(path.isAbsolute(repositoryRoot ?? "") && path.isAbsolute(resourcesRoot ?? ""), "AGENT_GIT_ABSOLUTE_PATH_REQUIRED");
  requireProof(/^refs\/heads\/codex\/[A-Za-z0-9][A-Za-z0-9_/-]*$/.test(integrationRef ?? "")
    && !integrationRef.includes("//"), "AGENT_GIT_INTEGRATION_REF_INVALID");
  requireProof(typeof verifyTermination === "function", "AGENT_GIT_TERMINATION_VERIFIER_REQUIRED");
  requireProof(typeof spawnProcess === "function" && Number.isSafeInteger(commandTimeoutMs) && commandTimeoutMs > 0 && commandTimeoutMs <= 10000
    && Number.isSafeInteger(stopGraceMs) && stopGraceMs > 0 && stopGraceMs <= 1000, "AGENT_GIT_PROCESS_LIMIT_INVALID");
  requireProof(Number.isSafeInteger(maxEntries) && maxEntries > 0 && maxEntries <= 100000
    && Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 512 * 1024 * 1024, "AGENT_GIT_LIMIT_INVALID");
  const resourcePath = path.resolve(resourcesRoot), repoPath = path.resolve(repositoryRoot);
  requireProof(!inside(repoPath, resourcePath) && !inside(resourcePath, repoPath) && key(repoPath) !== key(resourcePath), "AGENT_GIT_RESOURCE_OVERLAP");
  const limits = { maxEntries, maxBytes };
  const operationDirectory = path.join(resourcePath, "git-operations"), activeOperations = new Set(), settledOperations = new Set();
  let uncertainRead = null;
  function operationFile(operationId, suffix) { requireProof(/^[a-f0-9-]{36}$/.test(operationId), "AGENT_GIT_OPERATION_INVALID"); return path.join(operationDirectory, `${operationId}.${suffix}.json`); }
  function saveOperation(operationId, suffix, value) {
    const file = operationFile(operationId, suffix), bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
    requireProof(bytes.length <= 65536, "AGENT_GIT_OPERATION_LIMIT");
    if (fs.existsSync(file)) requireProof(fs.readFileSync(safePath(file)).equals(bytes), "AGENT_GIT_OPERATION_CHANGED");
    else fs.writeFileSync(file, bytes, { flag: "wx" });
  }
  async function readOperations({ pendingOnly = false } = {}) {
    if (!fs.existsSync(operationDirectory)) return [];
    const names = fs.readdirSync(safePath(operationDirectory));
    requireProof(names.length <= 100000, "AGENT_GIT_OPERATION_LIMIT");
    const end = performance.now() + 4500, records = [];
    for (const name of names.filter(name => name.endsWith(".intent.json") && (!pendingOnly || !settledOperations.has(name.slice(0, -".intent.json".length)))).sort()) {
      const operationId = name.slice(0, -".intent.json".length);
      const read = suffix => { const file = operationFile(operationId, suffix); if (!fs.existsSync(file)) return null; requireProof(fs.lstatSync(file).size <= 65536, "AGENT_GIT_OPERATION_LIMIT"); fileState(file); return JSON.parse(fs.readFileSync(safePath(file), "utf8")); };
      const intent = read("intent"), observed = read("observed"), closed = read("closed"), reconciliation = read("reconciled");
      requireProof(intent.operation_id === operationId && intent.repository_root === repoPath && intent.ref === integrationRef, "AGENT_GIT_OPERATION_CHANGED");
      const digest = fingerprint(intent);
      for (const value of [observed, closed, reconciliation]) if (value) requireProof(value.operation_id === operationId && value.intent_sha256 === digest, "AGENT_GIT_OPERATION_CHANGED");
      const recoveryRequired = !reconciliation && (!closed || closed.stop_requested || !closed.parent_closed);
      if (!recoveryRequired) settledOperations.add(operationId);
      records.push({ operation_id: operationId, intent_sha256: digest, intent, observed, closed, reconciliation, recovery_required: recoveryRequired });
      requireProof(performance.now() < end, "AGENT_GIT_OPERATION_INSPECTION_LIMIT");
      if (records.length % 8 === 0) await new Promise(resolve => setImmediate(resolve));
    }
    return records;
  }
  async function assertOperationsAvailable() {
    requireProof(!uncertainRead && !(await readOperations({ pendingOnly: true })).some(record => record.recovery_required && !activeOperations.has(record.operation_id)), "AGENT_GIT_RECOVERY_REQUIRED");
  }
  async function git(root, args, { input, env = {}, allowFailure = false, buffer = false, integrationIntentSha256 = null } = {}) {
    await assertOperationsAvailable();
    const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)));
    const argv = ["-C", root, "-c", `core.hooksPath=${path.join(resourcePath, "no-hooks")}`,
      "-c", "core.fsmonitor=false", "-c", "commit.gpgSign=false", "-c", "core.autocrlf=false",
      "-c", "checkout.workers=1", "-c", "gc.auto=0", "-c", "maintenance.auto=false",
      "-c", "rerere.enabled=false", "-c", "rerere.autoupdate=false", ...args];
    const mutating = args[0] === "worktree" ? args[1] !== "list"
      : ["read-tree", "update-index", "hash-object", "write-tree", "commit-tree", "update-ref", "cherry-pick"].includes(args[0]);
    const operationId = randomUUID(), intent = { operation_id: operationId, repository_root: repoPath, ref: integrationRef,
      cwd: root, executable: gitExecutable, invocation_sha256: fingerprint(argv), input_sha256: input === undefined ? null : hash(input),
      started_at: new Date().toISOString(), command_timeout_ms: commandTimeoutMs, stop_grace_ms: stopGraceMs };
    if (integrationIntentSha256 !== null) {
      requireProof(/^[a-f0-9]{64}$/.test(integrationIntentSha256), "AGENT_GIT_INTENT_MISMATCH");
      intent.integration_intent_sha256 = integrationIntentSha256;
    }
    let intentDigest = fingerprint(intent);
    if (mutating) {
      requireProof(fs.existsSync(path.join(resourcePath, "owner.json")), "AGENT_GIT_RESOURCE_OWNER_MISMATCH");
      intent.repository_identity_sha256 = JSON.parse(fs.readFileSync(safePath(path.join(resourcePath, "owner.json")), "utf8")).repository_identity_sha256;
      intentDigest = fingerprint(intent);
      if (!fs.existsSync(operationDirectory)) fs.mkdirSync(operationDirectory);
      safePath(operationDirectory); saveOperation(operationId, "intent", intent); activeOperations.add(operationId);
    }
    const result = await new Promise(resolve => {
      let error = null, count = 0, done = false, stopped = false, child = null, grace = null, timeout = null;
      const stdout = [], stderr = [];
      const finish = (status, signal, parentClosed) => {
        if (done) return; done = true; clearTimeout(timeout); clearTimeout(grace);
        const observation = { operation_id: operationId, intent_sha256: intentDigest, pid: child?.pid ?? null,
          parent_closed: parentClosed, status, signal, stop_requested: stopped, descendants_termination: "unconfirmed" };
        try { if (mutating) saveOperation(operationId, "closed", observation); } catch (value) { error ??= value; stopped = true; }
        if (mutating && parentClosed && !stopped) settledOperations.add(operationId);
        activeOperations.delete(operationId);
        if (stopped || !parentClosed) uncertainRead = { intent, observation };
        child?.stdin?.destroy(); child?.stdout?.destroy(); child?.stderr?.destroy(); child?.unref();
        resolve({ status, signal, error, uncertain: stopped || !parentClosed, operation: { intent, observation },
          stdout: buffer ? Buffer.concat(stdout) : Buffer.concat(stdout).toString("utf8") });
      };
      const stop = value => {
        if (done) return; error ??= value; if (stopped) return; stopped = true;
        grace = setTimeout(() => finish(null, null, false), stopGraceMs);
        try { child?.kill(); } catch { /* The preserved operation requires explicit reconciliation. */ }
      };
      try {
        child = spawnProcess(gitExecutable, argv, { shell: false, windowsHide: true,
          env: { ...environment, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
            GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", ...env } });
      } catch (value) { error = value; finish(null, null, true); return; }
      child.on("error", value => stop(value));
      child.stdin.on("error", value => stop(value));
      for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on("data", chunk => {
        if (done) return;
        count += chunk.length;
        if (count > maxBytes) stop(new Error("AGENT_GIT_OUTPUT_LIMIT"));
        else chunks.push(chunk);
      });
      child.on("close", (status, signal) => finish(status, signal, true));
      timeout = setTimeout(() => stop(new Error("AGENT_GIT_COMMAND_TIMEOUT")), commandTimeoutMs);
      try {
        if (mutating) saveOperation(operationId, "observed", { operation_id: operationId, intent_sha256: intentDigest,
          pid: child.pid ?? null, observed_at: new Date().toISOString() });
        child.stdin.end(input);
      } catch (value) { stop(value); }
    });
    if (result.uncertain) throw Object.assign(new Error("AGENT_GIT_TERMINATION_UNCONFIRMED"), { code: "AGENT_GIT_TERMINATION_UNCONFIRMED", operation: result.operation });
    if (!allowFailure) requireProof(!result.error && result.status === 0 && !result.signal, "AGENT_GIT_COMMAND_FAILED");
    return allowFailure ? result : buffer ? result.stdout : result.stdout.trimEnd();
  }
  async function repository() {
    const root = safePath(repoPath), common = safePath(await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
    const objectFormat = await git(root, ["rev-parse", "--show-object-format"]);
    requireProof(["sha1", "sha256"].includes(objectFormat), "AGENT_GIT_OBJECT_FORMAT_UNSUPPORTED");
    // Reject external conversion/merge programs, even when inherited by includes.
    const config = await git(root, ["config", "--null", "--list"]);
    for (const line of config.split("\0")) {
      const at = line.indexOf("\n"), name = line.slice(0, at), value = line.slice(at + 1);
      requireProof(!value || !/^(?:filter\..+\.(?:clean|smudge|process)|merge\..+\.driver)$/i.test(name), "AGENT_GIT_EXTERNAL_DRIVER_UNSUPPORTED");
    }
    const identity = { common_dir: common, object_format: objectFormat };
    return { root, ...identity, repository_identity_sha256: fingerprint(identity) };
  }
  async function head(root, ref = "HEAD", nullable = false) {
    const result = await git(root, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], { allowFailure: nullable });
    if (nullable && result.status !== 0) {
      requireProof(!result.error && result.status === 128, "AGENT_GIT_REF_READ_FAILED"); return null;
    }
    const value = nullable ? result.stdout.trim() : result;
    requireProof(sha(value), "AGENT_GIT_SHA_INVALID"); return value;
  }
  async function parents(root, commit) {
    requireProof(sha(commit), "AGENT_GIT_SHA_INVALID");
    const fields = (await git(root, ["rev-list", "--parents", "-n", "1", commit])).split(" ");
    requireProof(fields[0] === commit && fields.length === 2, "AGENT_GIT_SINGLE_PARENT_REQUIRED"); return fields[1];
  }
  function ensureResources(identity) {
    safePath(resourcePath, { missing: true });
    const owner = { repository_identity_sha256: identity.repository_identity_sha256, ref: integrationRef };
    if (!fs.existsSync(resourcePath)) { fs.mkdirSync(resourcePath, { recursive: true }); fs.writeFileSync(path.join(resourcePath, "owner.json"), JSON.stringify(owner), { flag: "wx" }); }
    requireProof(same(JSON.parse(fs.readFileSync(path.join(resourcePath, "owner.json"), "utf8")), owner), "AGENT_GIT_RESOURCE_OWNER_MISMATCH");
    const hookDir = path.join(resourcePath, "no-hooks");
    if (!fs.existsSync(hookDir)) fs.mkdirSync(hookDir);
    requireProof(fs.readdirSync(safePath(hookDir)).length === 0, "AGENT_GIT_UNEXPECTED_HOOK");
  }
  async function bindingState(binding) {
    requireProof(binding && [binding.run_id, binding.task_id, binding.attempt_id].every(id) && sha(binding.input_sha), "AGENT_GIT_BINDING_INVALID");
    const identity = await repository(), root = safePath(binding.cwd);
    requireProof(inside(resourcePath, root) && binding.repository_identity_sha256 === identity.repository_identity_sha256, "AGENT_GIT_REPOSITORY_MISMATCH");
    requireProof(key(safePath(await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]))) === key(identity.common_dir), "AGENT_GIT_REPOSITORY_MISMATCH");
    requireProof(await git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]) === binding.branch && await head(root) === binding.input_sha, "AGENT_GIT_WORKER_HEAD_CHANGED");
    const gitDir = safePath(await git(root, ["rev-parse", "--absolute-git-dir"]));
    const controls = {};
    for (const file of [path.join(root, ".git"), path.join(gitDir, "HEAD"), path.join(gitDir, "index"), path.join(identity.common_dir, "config")]) {
      controls[file] = fs.existsSync(file) ? fileState(file) : null;
    }
    // No submodule contents, staged changes or synthetic modes are hidden by a filesystem snapshot.
    const entries = (await git(root, ["ls-files", "--stage", "-z"])).split("\0").filter(Boolean);
    requireProof(entries.every(line => /^100(?:644|755) [a-f0-9]+ 0\t/.test(line)), "AGENT_GIT_UNSUPPORTED_INDEX_ENTRY");
    return { identity, root, controls };
  }
  function identityEnvironment(value) {
    requireProof(value && typeof value.name === "string" && /^[^\r\n<>\0]{1,128}$/.test(value.name)
      && typeof value.email === "string" && /^[^\s<>\0]+@[^\s<>\0]+$/.test(value.email)
      && typeof value.timestamp === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value.timestamp)
      && Number.isFinite(Date.parse(value.timestamp)), "AGENT_GIT_COMMIT_IDENTITY_REQUIRED");
    return { GIT_AUTHOR_NAME: value.name, GIT_COMMITTER_NAME: value.name, GIT_AUTHOR_EMAIL: value.email,
      GIT_COMMITTER_EMAIL: value.email, GIT_AUTHOR_DATE: value.timestamp, GIT_COMMITTER_DATE: value.timestamp };
  }
  function saveEvidence(name, value) {
    requireProof(isExactExecutionPath(name) && !name.includes("/"), "AGENT_GIT_EVIDENCE_PATH_INVALID");
    const file = path.join(resourcePath, name), bytes = Buffer.from(canonical(value));
    if (fs.existsSync(file)) { fileState(safePath(file)); requireProof(fs.readFileSync(file).equals(bytes), "AGENT_GIT_EVIDENCE_CHANGED"); }
    else fs.writeFileSync(file, bytes, { flag: "wx" });
    return { ref: name, sha256: hash(bytes), bytes: bytes.length };
  }
  function readEvidence(name) {
    const file = safePath(path.join(resourcePath, name));
    requireProof(fs.lstatSync(file).size <= maxBytes, "AGENT_GIT_CAPTURE_LIMIT"); fileState(file);
    const bytes = fs.readFileSync(file); return { value: JSON.parse(bytes), evidence: { ref: name, sha256: hash(bytes), bytes: bytes.length } };
  }
  async function verificationState(cwd) {
    const identity = await repository(), physical = safePath(cwd);
    requireProof(inside(resourcePath, physical), "AGENT_GIT_REPOSITORY_MISMATCH");
    requireProof(key(safePath(await git(physical, ["rev-parse", "--path-format=absolute", "--git-common-dir"]))) === key(identity.common_dir), "AGENT_GIT_REPOSITORY_MISMATCH");
    const gitDir = safePath(await git(physical, ["rev-parse", "--absolute-git-dir"])), controls = {};
    for (const file of [path.join(physical, ".git"), path.join(gitDir, "HEAD"), path.join(gitDir, "index"), path.join(identity.common_dir, "config")]) controls[file] = fileState(file);
    const branch = await git(physical, ["symbolic-ref", "--quiet", "HEAD"], { allowFailure: true });
    requireProof(!branch.error && [0, 1].includes(branch.status), "AGENT_GIT_HEAD_OBSERVATION_FAILED");
    const entries = (await git(physical, ["ls-files", "--stage", "-z"])).split("\0").filter(Boolean);
    requireProof(entries.every(line => /^100(?:644|755) [a-f0-9]+ 0\t/.test(line)), "AGENT_GIT_UNSUPPORTED_INDEX_ENTRY");
    const stat = fs.lstatSync(physical), headSha = await head(physical);
    const indexed = Object.fromEntries(entries.map(line => { const at = line.indexOf("\t"), [mode, oid] = line.slice(0, at).split(" "); return [line.slice(at + 1), { mode, oid }]; }));
    const treeEntries = (await git(physical, ["ls-tree", "-r", "-z", headSha])).split("\0").filter(Boolean);
    requireProof(treeEntries.every(line => /^100(?:644|755) blob [a-f0-9]+\t/.test(line)), "AGENT_GIT_UNSUPPORTED_INDEX_ENTRY");
    const treeFiles = Object.fromEntries(treeEntries.map(line => { const at = line.indexOf("\t"), [mode, , oid] = line.slice(0, at).split(" "); return [line.slice(at + 1), { mode, oid }]; }));
    const files = await snapshot(physical, limits), worktreeGit = await snapshot(gitDir, limits), blobs = {}, modes = {}, directoryModes = {};
    for (const name of Object.keys(files.files)) {
      const absolute = path.join(physical, name), bytes = fs.readFileSync(absolute);
      requireProof(hash(bytes) === files.files[name].sha256, "AGENT_GIT_CAPTURE_RACE");
      blobs[name] = createHash(identity.object_format).update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
      modes[name] = fs.lstatSync(absolute).mode;
      await new Promise(resolve => setImmediate(resolve));
    }
    for (const name of files.dirs) { directoryModes[name] = fs.lstatSync(path.join(physical, name)).mode; await new Promise(resolve => setImmediate(resolve)); }
    return { cwd: physical, physical_identity: { device: stat.dev, inode: stat.ino, birthtime_ms: stat.birthtimeMs },
      repository_identity_sha256: identity.repository_identity_sha256, head_sha: headSha,
      tree_sha: await git(physical, ["rev-parse", `${headSha}^{tree}`]), detached: branch.status === 1,
      controls, worktree_git: worktreeGit, root_mode: stat.mode, directory_modes: directoryModes,
      index_entries: indexed, tree_entries: treeFiles, blobs, modes, ...files };
  }
  function checkIntent(intent, intentSha256) {
    assertAgentExecutionContract("integration-intent", intent);
    requireProof(fingerprint(intent) === intentSha256 && intent.ref === integrationRef
      && same(intent.workspace, port.allocateIntegrationWorkspace({ integrationId: intent.integration_id })), "AGENT_GIT_INTENT_MISMATCH");
    identityEnvironment(intent.commit_identity);
    return intent;
  }
  function localPrepared(local, evidence, intent, intentSha256) {
    requireProof(local.intent_sha256 === intentSha256 && local.integration_id === intent.integration_id
      && local.source_sha === intent.source_sha && local.parent_sha === intent.parent_sha
      && local.repository_identity_sha256 === intent.repository_identity_sha256 && local.ref === intent.ref
      && local.workspace.cwd === intent.workspace.cwd, "AGENT_GIT_PREPARED_PROOF_MISMATCH");
    const { created_by, workspace, commit_identity, ...fields } = intent;
    return assertAgentExecutionContract("integration-prepared", { ...fields, contract_version: "agent-integration-prepared.v1",
      intent_sha256: intentSha256, result_sha: local.result_sha, prepared_by: local.prepared_by, evidence: [evidence] });
  }
  const port = {
    allocateIntegrationWorkspace({ integrationId }) {
      requireProof(id(integrationId), "AGENT_GIT_INTEGRATION_INVALID");
      return { cwd: path.join(resourcePath, `integration-${hash(integrationId)}`), detached: true };
    },
    async inspectLocalIntegration({ intent, intentSha256 }) {
      intent = structuredClone(checkIntent(intent, intentSha256));
      const identity = await repository();
      requireProof(identity.repository_identity_sha256 === intent.repository_identity_sha256, "AGENT_GIT_REPOSITORY_MISMATCH");
      const cwd = intent.workspace.cwd, suffix = hash(intent.integration_id), originFile = path.join(resourcePath, `integration-${suffix}.origin.json`);
      const exists = fs.existsSync(cwd), originExists = fs.existsSync(originFile);
      if (!exists && !originExists) {
        const partial = () => ({ status: "partial", integration_id: intent.integration_id, intent_sha256: intentSha256, workspace: intent.workspace });
        for (const name of [`integration-${suffix}.prepared.json`, `integration-${suffix}.conflict.json`]) {
          if (fs.existsSync(path.join(resourcePath, name))) return partial();
        }
        // A surviving object proof or operation cannot be relabelled as absence.
        // Bound the scan; a missing summary receipt never permits recomputation.
        const names = fs.existsSync(resourcePath) ? fs.readdirSync(safePath(resourcePath)) : [];
        requireProof(names.length <= maxEntries, "AGENT_GIT_PREPARATION_INSPECTION_LIMIT");
        const end = performance.now() + 4500; let totalBytes = 0;
        for (const name of names.filter(name => /^prepared-(?:[a-f0-9]{40}|[a-f0-9]{64})\.json$/.test(name))) {
          totalBytes += fs.lstatSync(safePath(path.join(resourcePath, name))).size;
          requireProof(totalBytes <= maxBytes && performance.now() < end, "AGENT_GIT_PREPARATION_INSPECTION_LIMIT");
          const prior = readEvidence(name).value;
          if (prior.integration_id === intent.integration_id || prior.intent_sha256 === intentSha256) return partial();
          await new Promise(resolve => setImmediate(resolve));
        }
        if ((await readOperations()).some(row => row.intent.integration_intent_sha256 === intentSha256)) return partial();
        // A removed/incomplete working directory must not hide Git's registration.
        const worktrees = await git(identity.root, ["worktree", "list", "--porcelain", "-z"]);
        const registered = worktrees.split("\0").some(line => line.startsWith("worktree ") && key(path.resolve(line.slice(9))) === key(path.resolve(cwd)));
        requireProof(!registered, "AGENT_GIT_PREPARATION_CHANGED");
        return { status: "absent", integration_id: intent.integration_id, intent_sha256: intentSha256,
          repository_identity_sha256: identity.repository_identity_sha256, ref: intent.ref, workspace: intent.workspace,
          head_sha: await head(identity.root, integrationRef, true) };
      }
      requireProof(originExists, "AGENT_GIT_PREPARATION_CHANGED");
      const origin = readEvidence(path.basename(originFile)).value;
      requireProof(same(origin.intent, intent) && origin.intent_sha256 === intentSha256, "AGENT_GIT_INTENT_MISMATCH");
      if (!exists) return { status: "partial", integration_id: intent.integration_id, intent_sha256: intentSha256, workspace: intent.workspace };
      const physical = safePath(cwd);
      requireProof(key(safePath(await git(physical, ["rev-parse", "--path-format=absolute", "--git-common-dir"]))) === key(identity.common_dir), "AGENT_GIT_REPOSITORY_MISMATCH");
      const current = await head(physical), conflictName = `integration-${suffix}.conflict.json`;
      if (fs.existsSync(path.join(resourcePath, conflictName))) {
        const recorded = readEvidence(conflictName), value = recorded.value;
        const index = safePath(await git(physical, ["rev-parse", "--git-path", "index"]));
        requireProof(value.intent_sha256 === intentSha256 && current === intent.parent_sha && value.index_sha256 === fileState(index).sha256
          && same(value.files, await snapshot(physical, limits))
          && value.unmerged_sha256 === hash(await git(physical, ["ls-files", "--unmerged", "-z"])), "AGENT_GIT_PREPARATION_CHANGED");
        return { status: "conflict", integration_id: intent.integration_id, intent_sha256: intentSha256,
          workspace: intent.workspace, evidence: [recorded.evidence] };
      }
      const name = `prepared-${current}.json`, completedName = `integration-${suffix}.prepared.json`;
      if (current === intent.parent_sha || !fs.existsSync(path.join(resourcePath, name)) || !fs.existsSync(path.join(resourcePath, completedName))) return { status: "partial", integration_id: intent.integration_id,
        intent_sha256: intentSha256, workspace: intent.workspace };
      const recorded = readEvidence(name), completed = readEvidence(completedName).value;
      requireProof(completed.intent_sha256 === intentSha256 && same(completed.evidence, recorded.evidence)
        && same(completed.prepared_by, origin.prepared_by), "AGENT_GIT_PREPARED_PROOF_MISMATCH");
      const prepared = localPrepared(recorded.value, recorded.evidence, intent, intentSha256);
      requireProof(same(prepared.prepared_by, origin.prepared_by), "AGENT_GIT_PREPARATION_CHANGED");
      const observed = await port.inspectIntegration({ ...prepared, intent }, { phase: "prepared" });
      requireProof([intent.parent_sha, prepared.result_sha].includes(observed.head_sha), "AGENT_GIT_REF_DIVERGED");
      requireProof(recorded.value.verification_state && same(recorded.value.verification_state, await verificationState(physical)), "AGENT_GIT_PREPARATION_CHANGED");
      return { status: "prepared", prepared, prepared_sha256: fingerprint(prepared), workspace: recorded.value.workspace,
        intent, intent_sha256: intentSha256 };
    },
    async prepareVerificationSnapshot({ snapshotId, purpose, runId, taskId = null, attemptId = null, candidateSha, validatorManifestSha256 }) {
      requireProof(id(snapshotId) && id(runId) && ["task", "run"].includes(purpose) && sha(candidateSha)
        && /^[a-f0-9]{64}$/.test(validatorManifestSha256 ?? "")
        && (purpose === "task" ? id(taskId) && id(attemptId) : taskId === null && attemptId === null), "AGENT_GIT_SNAPSHOT_INVALID");
      const identity = await repository(); ensureResources(identity);
      const suffix = hash(snapshotId), cwd = path.join(resourcePath, `verification-${suffix}`), name = `verification-${suffix}.snapshot.json`;
      const expected = { snapshot_id: snapshotId, purpose, run_id: runId, task_id: taskId, attempt_id: attemptId,
        candidate_sha: candidateSha, validator_manifest_sha256: validatorManifestSha256, repository_identity_sha256: identity.repository_identity_sha256, cwd };
      if (fs.existsSync(path.join(resourcePath, name))) {
        const prior = readEvidence(name), descriptor = prior.value;
        requireProof(Object.keys(expected).every(field => same(descriptor[field], expected[field])), "AGENT_GIT_SNAPSHOT_CHANGED");
        const observed = await port.inspectVerificationSnapshot({ snapshot: descriptor, expectedSnapshotSha256: fingerprint(descriptor),
          observationId: randomUUID(), challenge: randomUUID(), phase: `${purpose}-before` });
        requireProof(JSON.parse(observed.content).pristine, "AGENT_GIT_SNAPSHOT_CHANGED");
        return { snapshot: descriptor, snapshot_sha256: fingerprint(descriptor), evidence: [prior.evidence, readEvidence(`verification-${suffix}.baseline.json`).evidence] };
      }
      requireProof(!fs.existsSync(cwd) && !fs.existsSync(path.join(resourcePath, `verification-${suffix}.baseline.json`)), "AGENT_GIT_SNAPSHOT_PARTIAL");
      requireProof(await head(identity.root, candidateSha) === candidateSha, "AGENT_GIT_SHA_INVALID");
      await git(identity.root, ["worktree", "add", "--detach", cwd, candidateSha]);
      const state = await verificationState(cwd);
      requireProof(state.detached && state.head_sha === candidateSha && same(state.index_entries, state.tree_entries)
        && same(Object.keys(state.files).sort(), Object.keys(state.tree_entries).sort())
        && Object.entries(state.tree_entries).every(([name, entry]) => state.blobs[name] === entry.oid), "AGENT_GIT_SNAPSHOT_CHANGED");
      const baseline = { ...expected, state }, descriptor = { ...expected, tree_sha: state.tree_sha, baseline_sha256: fingerprint(baseline) };
      const baselineProof = saveEvidence(`verification-${suffix}.baseline.json`, baseline), proof = saveEvidence(name, descriptor);
      return freeze({ snapshot: descriptor, snapshot_sha256: fingerprint(descriptor), evidence: [proof, baselineProof] });
    },
    async inspectVerificationSnapshot({ snapshot: descriptor, expectedSnapshotSha256, observationId, challenge, phase, controlFiles = [] }) {
      descriptor = structuredClone(descriptor); controlFiles = structuredClone(controlFiles);
      requireProof(descriptor && fingerprint(descriptor) === expectedSnapshotSha256 && id(descriptor.snapshot_id) && id(observationId)
        && typeof challenge === "string" && /^[A-Za-z0-9._:-]{16,256}$/.test(challenge)
        && ["task-before", "task-after", "run-before", "run-after", "audit-before", "audit-after"].includes(phase), "AGENT_GIT_SNAPSHOT_BINDING_INVALID");
      requireProof(descriptor.purpose === "task" ? phase.startsWith("task-") : !phase.startsWith("task-"), "AGENT_GIT_SNAPSHOT_BINDING_INVALID");
      const suffix = hash(descriptor.snapshot_id);
      requireProof(descriptor.cwd === path.join(resourcePath, `verification-${suffix}`), "AGENT_GIT_SNAPSHOT_BINDING_INVALID");
      requireProof(same(readEvidence(`verification-${suffix}.snapshot.json`).value, descriptor), "AGENT_GIT_SNAPSHOT_CHANGED");
      const baseline = readEvidence(`verification-${suffix}.baseline.json`).value;
      requireProof(fingerprint(baseline) === descriptor.baseline_sha256 && baseline.candidate_sha === descriptor.candidate_sha, "AGENT_GIT_SNAPSHOT_CHANGED");
      const current = await verificationState(descriptor.cwd), previous = baseline.state;
      requireProof(Array.isArray(controlFiles) && controlFiles.length <= maxEntries && controlFiles.every(value => value && isExactExecutionPath(value.path))
        && new Set(controlFiles.map(value => value.path.toLowerCase())).size === controlFiles.length, "AGENT_GIT_SNAPSHOT_BINDING_INVALID");
      const control_files = controlFiles.map(value => ({ path: value.path, sha256: current.files[value.path]?.sha256 ?? null,
        git_mode: current.index_entries[value.path]?.mode ?? null, tree_git_mode: current.tree_entries[value.path]?.mode ?? null }));
      const different = (left, right) => [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(name => !same(left[name] ?? null, right[name] ?? null)).sort();
      const changes = { files: [...new Set([...different(previous.files, current.files), ...different(previous.modes, current.modes)])].sort(),
        directories: [...new Set([...different(previous.directory_modes, current.directory_modes), ...previous.dirs, ...current.dirs].filter(name => previous.directory_modes[name] !== current.directory_modes[name]))].sort(),
        controls: [...different(previous.controls, current.controls),
          ...different(previous.worktree_git.files, current.worktree_git.files).map(name => `worktree_git/${name}`),
          ...[...new Set([...previous.worktree_git.dirs, ...current.worktree_git.dirs])].filter(name => previous.worktree_git.dirs.includes(name) !== current.worktree_git.dirs.includes(name)).map(name => `worktree_git/${name}/`)] };
      if (previous.root_mode !== current.root_mode || !same(previous.physical_identity, current.physical_identity)) changes.controls.push("worktree_root");
      const observation = { contract_version: "agent-verification-observation.v1", observation_id: observationId, challenge, phase,
        snapshot_sha256: expectedSnapshotSha256, candidate_sha: descriptor.candidate_sha, head_sha: current.head_sha, tree_sha: current.tree_sha,
        repository_identity_sha256: current.repository_identity_sha256, cwd: current.cwd, detached: current.detached,
        physical_identity: current.physical_identity, baseline_sha256: descriptor.baseline_sha256, current_sha256: fingerprint(current),
        files_sha256: fingerprint(current.files), directories_sha256: fingerprint(current.dirs), controls: current.controls, control_files, changes,
        pristine: same(current, previous) && current.head_sha === descriptor.candidate_sha && current.tree_sha === descriptor.tree_sha && current.detached };
      const content = canonical(observation), bytes = Buffer.byteLength(content);
      requireProof(bytes <= 4 * 1024 * 1024, "AGENT_GIT_OBSERVATION_LIMIT");
      return freeze({ content, sha256: hash(content), bytes });
    },
    async inspectGitOperations() { return freeze({ operations: await readOperations(), uncertain_read: structuredClone(uncertainRead) }); },
    async reconcileGitOperation({ operationId, proof }) {
      requireProof(typeof verifyGitTermination === "function", "AGENT_GIT_OPERATION_VERIFIER_REQUIRED");
      const record = (await readOperations()).find(value => value.operation_id === operationId);
      requireProof(record && record.recovery_required, "AGENT_GIT_OPERATION_RECONCILIATION_NOT_REQUIRED");
      const controller = new AbortController(), end = performance.now() + 4500; let timer, verified;
      try {
        verified = await Promise.race([
          Promise.resolve().then(() => verifyGitTermination({ operation: structuredClone(record), proof: structuredClone(proof), signal: controller.signal })),
          new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("AGENT_GIT_TERMINATION_UNCONFIRMED"), { code: "AGENT_GIT_TERMINATION_UNCONFIRMED" })), 4500); }),
        ]);
        requireProof(performance.now() < end, "AGENT_GIT_TERMINATION_UNCONFIRMED");
      } finally { clearTimeout(timer); controller.abort(); }
      requireProof(verified?.confirmed === true && verified.operation_id === operationId && verified.intent_sha256 === record.intent_sha256
        && verified.descendants_stopped === true && verified.git_operations_stopped === true, "AGENT_GIT_TERMINATION_UNCONFIRMED");
      saveOperation(operationId, "reconciled", { operation_id: operationId, intent_sha256: record.intent_sha256, proof: structuredClone(proof), verification: verified });
      if (uncertainRead?.intent.operation_id === operationId) uncertainRead = null;
      return { operation_id: operationId, reconciled: true };
    },
    allocateAttemptWorkspace({ runId, taskId, attemptId, inputSha }) {
      requireProof([runId, taskId, attemptId].every(id) && sha(inputSha), "AGENT_GIT_ALLOCATION_INVALID");
      const suffix = fingerprint({ runId, taskId, attemptId }), cwd = path.join(resourcePath, `worker-${suffix}`);
      return { cwd, branch: `codex/agent-${suffix}`, input_sha: inputSha, worktree_id: hash(key(cwd)) };
    },
    async initializeIntegration({ baseSha }) {
      requireProof(sha(baseSha), "AGENT_GIT_SHA_INVALID"); const identity = await repository(); ensureResources(identity);
      requireProof(await head(identity.root, baseSha) === baseSha, "AGENT_GIT_BASE_CHANGED");
      const current = await head(identity.root, integrationRef, true);
      if (current === null) await git(identity.root, ["update-ref", integrationRef, baseSha, "0".repeat(baseSha.length)]);
      else requireProof(current === baseSha, "AGENT_GIT_REF_DIVERGED");
      return port.inspectIntegration({}, { phase: "head" });
    },
    async prepareAttemptWorkspace({ workspace, inputSha }) {
      const identity = await repository(); ensureResources(identity);
      requireProof(workspace && sha(inputSha) && workspace.input_sha === inputSha && inside(resourcePath, path.resolve(workspace.cwd))
        && /^codex\/agent-[a-f0-9]{64}$/.test(workspace.branch) && !fs.existsSync(workspace.cwd), "AGENT_GIT_WORKSPACE_INVALID");
      safePath(workspace.cwd, { missing: true });
      requireProof(await head(identity.root, `refs/heads/${workspace.branch}`, true) === null, "AGENT_GIT_WORKSPACE_EXISTS");
      await git(identity.root, ["worktree", "add", "-b", workspace.branch, workspace.cwd, inputSha]);
      const physical = safePath(workspace.cwd);
      requireProof(hash(key(physical)) === workspace.worktree_id && await head(physical) === inputSha, "AGENT_GIT_WORKSPACE_IDENTITY_CHANGED");
      return { ...workspace, cwd: physical, repository_identity_sha256: identity.repository_identity_sha256 };
    },
    async captureBaseline({ binding }) {
      const state = await bindingState(binding); ensureResources(state.identity);
      const baseline = { binding: structuredClone(binding), controls: state.controls,
        ...await snapshot(state.root, limits) };
      const digest = fingerprint(baseline), file = path.join(resourcePath, `baseline-${fingerprint(binding)}.json`);
      const bytes = Buffer.from(JSON.stringify(baseline, null, 2) + "\n");
      if (fs.existsSync(file)) requireProof(fs.readFileSync(safePath(file)).equals(bytes), "AGENT_GIT_BASELINE_CHANGED");
      else fs.writeFileSync(file, bytes, { flag: "wx" });
      return freeze({ ...baseline, baseline_sha256: digest, evidence: [{ ref: path.basename(file), bytes: bytes.length, sha256: hash(bytes) }] });
    },
    async captureTaskChanges({ binding, termination, baseline, scope }) {
      const { baseline_sha256: baselineDigest, evidence: baselineEvidence, ...baselineBody } = baseline ?? {};
      requireProof(baseline && same(baseline.binding, binding) && fingerprint(baselineBody) === baselineDigest
        && Array.isArray(baselineEvidence) && baselineEvidence.length === 1, "AGENT_GIT_BASELINE_REQUIRED");
      const baselineFile = path.join(resourcePath, `baseline-${fingerprint(binding)}.json`);
      requireProof(baselineEvidence[0].ref === path.basename(baselineFile), "AGENT_GIT_BASELINE_REQUIRED");
      const baselineBytes = fs.readFileSync(safePath(baselineFile));
      requireProof(hash(baselineBytes) === baselineEvidence[0].sha256 && baselineBytes.length === baselineEvidence[0].bytes
        && same(JSON.parse(baselineBytes), baselineBody), "AGENT_GIT_BASELINE_CHANGED");
      const verified = await verifyTermination({ binding: structuredClone(binding), termination: structuredClone(termination) });
      requireProof(verified?.confirmed === true && verified.attempt_id === binding.attempt_id, "AGENT_GIT_TERMINATION_UNCONFIRMED");
      const state = await bindingState(binding), current = await snapshot(state.root, limits);
      requireProof(same(state.controls, baseline.controls), "AGENT_GIT_AUTHORITY_CHANGED");
      requireProof(Array.isArray(scope) && scope.length > 0 && scope.every(entry => isExactExecutionPath(entry.path)
        && !protectedPath(entry.path) && Array.isArray(entry.operations)), "AGENT_GIT_SCOPE_INVALID");
      const changes = [], ambiguous = [];
      for (const name of [...new Set([...Object.keys(baseline.files), ...Object.keys(current.files)])].sort()) {
        const before = baseline.files[name] ?? null, after = current.files[name] ?? null;
        if (same(before, after)) continue;
        const permission = scope.find(entry => entry.path === name), operation = before === null ? "add" : after === null ? "delete" : "update";
        requireProof(permission && !protectedPath(name), "AGENT_GIT_CHANGE_OUTSIDE_SCOPE");
        requireProof(!before || !after || before.executable === after.executable, "AGENT_GIT_MODE_CHANGE_REFUSED");
        requireProof(before !== null || !after.executable, "AGENT_GIT_MODE_CHANGE_REFUSED");
        if (!permission.operations.includes(operation)) {
          requireProof((operation === "delete" && permission.operations.includes("move"))
            || (operation === "add" && permission.operations.includes("move-destination")), "AGENT_GIT_OPERATION_REFUSED");
          ambiguous.push({ path: name, operation });
        }
        changes.push({ path: name, operation, before, after });
      }
      requireProof(changes.length > 0, "AGENT_GIT_EMPTY_CAPTURE");
      // Empty directory mutations are outside Git, but cannot be an escape hatch.
      for (const directory of [...baseline.dirs, ...current.dirs]) if (baseline.dirs.includes(directory) !== current.dirs.includes(directory)) {
        requireProof(changes.some(change => change.path.startsWith(directory + "/")), "AGENT_GIT_DIRECTORY_OUTSIDE_SCOPE");
      }
      let moves = [];
      if (ambiguous.length) {
        requireProof(typeof verifyMoves === "function", "AGENT_GIT_MOVE_PROOF_REQUIRED");
        moves = await verifyMoves({ binding: structuredClone(binding), changes: structuredClone(changes) });
        requireProof(Array.isArray(moves) && moves.length > 0, "AGENT_GIT_MOVE_PROOF_REQUIRED");
        const used = new Set();
        for (const pair of moves) {
          requireProof(pair && pair.source !== pair.destination && !used.has(pair.source) && !used.has(pair.destination)
            && changes.some(c => c.path === pair.source && c.operation === "delete") && changes.some(c => c.path === pair.destination && c.operation === "add")
            && scope.some(s => s.path === pair.source && s.operations.includes("move"))
            && scope.some(s => s.path === pair.destination && s.operations.includes("move-destination")), "AGENT_GIT_MOVE_PROOF_INVALID");
          used.add(pair.source); used.add(pair.destination);
        }
        requireProof(ambiguous.every(c => used.has(c.path)), "AGENT_GIT_MOVE_PROOF_INVALID");
      }
      const capture = { binding: structuredClone(binding), controls: state.controls, files: current.files, dirs: current.dirs, changes, moves };
      capture.capture_sha256 = fingerprint(capture);
      const file = path.join(resourcePath, `capture-input-${capture.capture_sha256}.json`), bytes = Buffer.from(JSON.stringify(capture, null, 2) + "\n");
      if (fs.existsSync(file)) requireProof(fs.readFileSync(safePath(file)).equals(bytes), "AGENT_GIT_CAPTURE_CHANGED");
      else fs.writeFileSync(file, bytes, { flag: "wx" });
      return freeze(capture);
    },
    async createTaskCommit({ capture, expectedCaptureSha256, commitIdentity }) {
      const { capture_sha256: digest, ...material } = capture ?? {};
      requireProof(digest === expectedCaptureSha256 && fingerprint(material) === digest, "AGENT_GIT_CAPTURE_CHANGED");
      const captureFile = safePath(path.join(resourcePath, `capture-input-${digest}.json`)); fileState(captureFile);
      requireProof(same(JSON.parse(fs.readFileSync(captureFile, "utf8")), capture), "AGENT_GIT_CAPTURE_CHANGED");
      const state = await bindingState(capture.binding); ensureResources(state.identity);
      requireProof(same(state.controls, capture.controls) && same(await snapshot(state.root, limits), { files: capture.files, dirs: capture.dirs }), "AGENT_GIT_CAPTURE_CHANGED");
      const identityEnv = identityEnvironment(commitIdentity), identityHash = fingerprint(commitIdentity);
      const file = path.join(resourcePath, `capture-${digest}.json`), taskRef = `refs/aidn/tasks/${digest}`;
      if (fs.existsSync(file)) {
        const bytes = fs.readFileSync(safePath(file)), record = JSON.parse(bytes), { capture: prior, ...result } = record;
        requireProof(same(prior, capture) && result.commit_identity_sha256 === identityHash
          && result.repository_identity_sha256 === state.identity.repository_identity_sha256
          && result.parent_sha === capture.binding.input_sha && await parents(state.root, result.source_sha) === result.parent_sha
          && await head(state.root, taskRef) === result.source_sha
          && await git(state.root, ["rev-parse", `${result.source_sha}^{tree}`]) === result.tree_sha, "AGENT_GIT_CAPTURE_CHANGED");
        return { ...result, evidence: [{ ref: path.basename(file), sha256: hash(bytes), bytes: bytes.length }] };
      }
      // A partial private index is evidence, never reused or silently reset.
      const env = { ...identityEnv, GIT_INDEX_FILE: path.join(resourcePath, `index-${digest}-${randomUUID()}`) };
      await git(state.root, ["read-tree", capture.binding.input_sha], { env });
      for (const change of capture.changes) {
        if (change.after === null) await git(state.root, ["update-index", "--force-remove", "--", change.path], { env });
        else {
          const bytes = fs.readFileSync(path.join(state.root, change.path)); requireProof(hash(bytes) === change.after.sha256, "AGENT_GIT_CAPTURE_CHANGED");
          const blob = await git(state.root, ["hash-object", "-w", "--stdin"], { input: bytes });
          const mode = change.before ? (await git(state.root, ["ls-tree", capture.binding.input_sha, "--", change.path])).slice(0, 6) : "100644";
          requireProof(["100644", "100755"].includes(mode), "AGENT_GIT_MODE_CHANGE_REFUSED");
          await git(state.root, ["update-index", "--add", "--cacheinfo", mode, blob, change.path], { env });
        }
      }
      const finalState = await bindingState(capture.binding);
      requireProof(same(finalState.controls, capture.controls) && same(await snapshot(state.root, limits), { files: capture.files, dirs: capture.dirs }), "AGENT_GIT_CAPTURE_CHANGED");
      const tree = await git(state.root, ["write-tree"], { env });
      const source = await git(state.root, ["commit-tree", tree, "-p", capture.binding.input_sha], { env,
        input: `AIDN task ${capture.binding.task_id}\n\nAttempt: ${capture.binding.attempt_id}\nCapture: ${digest}\n` });
      // Keep the object reachable without moving the worker branch or its index.
      const previous = await head(state.root, taskRef, true);
      if (previous === null) await git(state.root, ["update-ref", taskRef, source, "0".repeat(source.length)]);
      else requireProof(previous === source, "AGENT_GIT_CAPTURE_CHANGED");
      const record = { source_sha: source, tree_sha: tree, parent_sha: capture.binding.input_sha,
        capture_sha256: digest, commit_identity_sha256: identityHash, repository_identity_sha256: state.identity.repository_identity_sha256 };
      const bytes = Buffer.from(JSON.stringify({ ...record, capture }, null, 2) + "\n");
      fs.writeFileSync(file, bytes, { flag: "wx" });
      return { ...record, evidence: [{ ref: path.basename(file), sha256: hash(bytes), bytes: bytes.length }] };
    },
    async prepareIntegration({ integrationId, sourceSha, expectedParent, commitIdentity, intent = null, intentSha256 = null, preparedBy = null }) {
      if (intent) {
        intent = structuredClone(checkIntent(intent, intentSha256)); preparedBy = structuredClone(preparedBy);
        integrationId = intent.integration_id; sourceSha = intent.source_sha; expectedParent = intent.parent_sha; commitIdentity = intent.commit_identity;
        requireProof(preparedBy && id(preparedBy.owner_id) && id(preparedBy.lease_id) && Number.isSafeInteger(preparedBy.generation) && preparedBy.generation > 0, "AGENT_GIT_PRODUCER_REQUIRED");
        requireProof((await port.inspectLocalIntegration({ intent, intentSha256 })).status === "absent", "AGENT_GIT_PREPARATION_EXISTS");
      }
      requireProof(id(integrationId) && sha(sourceSha) && sha(expectedParent), "AGENT_GIT_INTEGRATION_INVALID");
      const identity = await repository(); ensureResources(identity); const sourceParent = await parents(identity.root, sourceSha);
      requireProof(await head(identity.root, integrationRef, true) === expectedParent, "AGENT_GIT_REF_DIVERGED");
      const cwd = path.join(resourcePath, `integration-${hash(integrationId)}`);
      requireProof(!fs.existsSync(cwd), "AGENT_GIT_PREPARATION_EXISTS");
      if (intent) saveEvidence(`integration-${hash(integrationId)}.origin.json`, { intent, intent_sha256: intentSha256, prepared_by: preparedBy });
      const operation = intent ? { integrationIntentSha256: intentSha256 } : {};
      await git(identity.root, ["worktree", "add", "--detach", cwd, expectedParent], operation);
      const outcome = await git(cwd, ["cherry-pick", "--no-commit", sourceSha], { ...operation, allowFailure: true });
      if (outcome.error || outcome.status !== 0 || outcome.signal) {
        const unmerged = await git(cwd, ["ls-files", "--unmerged", "-z"]);
        requireProof(Boolean(unmerged), "AGENT_GIT_PREPARATION_FAILED");
        const evidence = intent ? [saveEvidence(`integration-${hash(integrationId)}.conflict.json`, { intent_sha256: intentSha256,
          prepared_by: preparedBy, index_sha256: fileState(safePath(await git(cwd, ["rev-parse", "--git-path", "index"]))).sha256,
          unmerged_sha256: hash(unmerged), files: await snapshot(cwd, limits) })] : [];
        return { status: "conflict", integration_id: integrationId, source_sha: sourceSha, parent_sha: expectedParent,
          repository_identity_sha256: identity.repository_identity_sha256, ref: integrationRef, workspace: { cwd, head_sha: expectedParent }, evidence };
      }
      requireProof(await head(cwd) === expectedParent && await parents(identity.root, sourceSha) === sourceParent, "AGENT_GIT_PREPARATION_DRIFT");
      const tree = await git(cwd, ["write-tree"], operation), result = await git(cwd, ["commit-tree", tree, "-p", expectedParent], {
        ...operation, env: identityEnvironment(commitIdentity), input: `AIDN integration ${integrationId}\n\nSource: ${sourceSha}\n` });
      // The validation worktree names the actual candidate commit. This changes
      // only its detached HEAD; the dedicated integration ref remains untouched.
      await git(cwd, ["update-ref", "--no-deref", "HEAD", result, expectedParent], operation);
      const prepared = { status: "prepared", integration_id: integrationId, source_sha: sourceSha, parent_sha: expectedParent,
        result_sha: result, source_parent_sha: sourceParent, tree_sha: tree, repository_identity_sha256: identity.repository_identity_sha256,
        ref: integrationRef, workspace: { cwd, head_sha: result } };
      if (intent) Object.assign(prepared, { intent_sha256: intentSha256, prepared_by: preparedBy, verification_state: await verificationState(cwd) });
      const file = path.join(resourcePath, `prepared-${result}.json`), bytes = Buffer.from(JSON.stringify(prepared, null, 2) + "\n");
      fs.writeFileSync(file, bytes, { flag: "wx" });
      const evidence = { ref: path.basename(file), sha256: hash(bytes), bytes: bytes.length };
      if (intent) {
        saveEvidence(`integration-${hash(integrationId)}.prepared.json`, { intent_sha256: intentSha256, prepared_by: preparedBy, evidence });
        return { status: "prepared", prepared: localPrepared(prepared, evidence, intent, intentSha256), workspace: prepared.workspace,
          intent, intent_sha256: intentSha256 };
      }
      return { ...prepared, evidence: [evidence] };
    },
    async inspectIntegration(input = {}, options = {}) {
      const identity = await repository();
      if (input.repository_identity_sha256 !== undefined) requireProof(input.repository_identity_sha256 === identity.repository_identity_sha256, "AGENT_GIT_REPOSITORY_MISMATCH");
      if (input.ref !== undefined) requireProof(input.ref === integrationRef, "AGENT_GIT_REF_MISMATCH");
      const phase = options.phase ?? input.phase ?? "head", current = await head(identity.root, integrationRef, true);
      const sourceParent = input.source_sha ? await parents(identity.root, input.source_sha) : null;
      const resultParent = input.result_sha ? await parents(identity.root, input.result_sha) : null;
      requireProof(phase === "head" || sourceParent !== null && resultParent === input.parent_sha, "AGENT_GIT_INTEGRATION_PARENT_MISMATCH");
      if (phase !== "head") {
        const file = safePath(path.join(resourcePath, `prepared-${input.result_sha}.json`)); fileState(file);
        const bytes = fs.readFileSync(file), evidence = input.evidence?.find(value => value.ref === path.basename(file));
        requireProof(evidence && evidence.sha256 === hash(bytes) && evidence.bytes === bytes.length, "AGENT_GIT_PREPARED_PROOF_MISMATCH");
        const recorded = JSON.parse(bytes);
        requireProof(["ref", "parent_sha", "source_sha", "result_sha", "repository_identity_sha256"].every(name => recorded[name] === input[name])
          && recorded.source_parent_sha === sourceParent && await git(identity.root, ["rev-parse", `${input.result_sha}^{tree}`]) === recorded.tree_sha,
        "AGENT_GIT_PREPARED_PROOF_MISMATCH");
        if (input.intent_sha256) {
          requireProof(recorded.intent_sha256 === input.intent_sha256 && same(recorded.prepared_by, input.prepared_by), "AGENT_GIT_PREPARED_PROOF_MISMATCH");
          if (input.intent) localPrepared(recorded, evidence, checkIntent(input.intent, input.intent_sha256), input.intent_sha256);
        }
      }
      return { ok: true, repository_identity_sha256: identity.repository_identity_sha256, ref: integrationRef, head_sha: current,
        source_parent_sha: sourceParent, result_parent_sha: resultParent };
    },
    async compareAndSwapIntegration({ prepared, intent = null }) {
      // The application service verifies the immutable PostgreSQL prepared record
      // and current authority immediately before this operation. Git provides CAS,
      // not a distributed PostgreSQL/Git transaction.
      const inspection = intent ? { ...prepared, intent } : prepared;
      const before = await port.inspectIntegration(inspection, { phase: "prepared" });
      const alreadyApplied = before.head_sha === prepared.result_sha;
      if (!alreadyApplied) {
        requireProof(before.head_sha === prepared.parent_sha, "AGENT_GIT_REF_DIVERGED");
        await git((await repository()).root, ["update-ref", integrationRef, prepared.result_sha, prepared.parent_sha]);
      }
      const after = await port.inspectIntegration(inspection, { phase: "applied" });
      requireProof(after.head_sha === prepared.result_sha, "AGENT_GIT_REF_DIVERGED");
      const file = path.join(resourcePath, `applied-${prepared.result_sha}.json`);
      const bytes = Buffer.from(JSON.stringify({ ...after, prepared_sha256: fingerprint(prepared) }, null, 2) + "\n");
      if (fs.existsSync(file)) requireProof(fs.readFileSync(safePath(file)).equals(bytes), "AGENT_GIT_APPLIED_PROOF_CHANGED");
      else fs.writeFileSync(file, bytes, { flag: "wx" });
      return { status: alreadyApplied ? "already_applied" : "applied", observed_sha: after.head_sha, ...after,
        evidence: [{ ref: path.basename(file), bytes: bytes.length, sha256: hash(bytes) }] };
    },
  };
  return Object.freeze(assertAgentGitIntegration(port));
}
