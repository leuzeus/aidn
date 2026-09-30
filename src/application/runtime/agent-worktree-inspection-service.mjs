import fs from "node:fs";
import { assertAgentLocalPath } from "../../core/agents/agent-local-path-policy.mjs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readActivation, createActivationGitEnvironment } from "../install/project-activation-service.mjs";
import { inventoryRuntime, checkedHostPath } from "../install/global-runtime-store.mjs";
import { fingerprintAgentExecutionValue } from "../../core/agents/agent-execution-contracts.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const samePath = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const fail = code => { throw new Error(code); };
const read = file => JSON.parse(fs.readFileSync(checkedHostPath(file), "utf8"));

// Denial-only preflight of local pointers. It does not unseal receipts, authorize
// installation, resolve Git configuration, or replace canonical readActivation.
// The pointers are re-read after activation; this is not an atomic OS boundary.
export function inspectAgentWorktreeLocalPointers(targetRoot, { expectedPackageRoot } = {}) {
  const files = new Map(), limit = 8 * 1024 * 1024;
  function local(input) {
    assertAgentLocalPath(input);
    if (typeof input !== "string" || !path.isAbsolute(input) || input.length > 8192 || /[\x00-\x1f\x7f]/u.test(input)) fail("DELEGATED_LOCAL_POINTER_INVALID");
    const result = path.resolve(input); assertAgentLocalPath(result); return result;
  }
  function stat(input) {
    const file = local(input), parsed = path.parse(file); let cursor = parsed.root, found = null;
    for (const part of file.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, part);
      try { found = fs.lstatSync(cursor); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
      if (found.isSymbolicLink() || !found.isDirectory() && (!found.isFile() || found.nlink !== 1)) fail("DELEGATED_LOCAL_POINTER_ALIAS");
      if (cursor !== file && !found.isDirectory()) fail("DELEGATED_LOCAL_POINTER_INVALID");
    }
    if (!found) found = fs.lstatSync(file);
    if (!samePath(fs.realpathSync.native(file), file)) fail("DELEGATED_LOCAL_POINTER_ALIAS");
    return found;
  }
  function bytes(input, maximum = limit) {
    const file = local(input), before = stat(file);
    if (!before) { files.set(file, { path: file, sha256: null, bytes: 0 }); return null; }
    if (!before.isFile() || before.size > maximum) fail("DELEGATED_LOCAL_POINTER_INVALID");
    const fd = fs.openSync(file, "r");
    try {
      const opened = fs.fstatSync(fd); if (opened.dev !== before.dev || opened.ino !== before.ino) fail("DELEGATED_LOCAL_POINTER_CHANGED");
      const content = Buffer.alloc(before.size); let offset = 0;
      while (offset < content.length) { const count = fs.readSync(fd, content, offset, content.length - offset, null); if (!count) fail("DELEGATED_LOCAL_POINTER_CHANGED"); offset += count; }
      if (fs.readSync(fd, Buffer.alloc(1), 0, 1, null)) fail("DELEGATED_LOCAL_POINTER_CHANGED");
      const after = fs.fstatSync(fd), final = stat(file);
      if (!final || [after, final].some(row => row.dev !== before.dev || row.ino !== before.ino || row.size !== before.size
        || row.mtimeMs !== before.mtimeMs || row.ctimeMs !== before.ctimeMs)) fail("DELEGATED_LOCAL_POINTER_CHANGED");
      files.set(file, { path: file, sha256: hash(content), bytes: content.length }); return content;
    } finally { fs.closeSync(fd); }
  }
  function json(file) {
    const content = bytes(file); if (content === null) return null;
    try { const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content));
      if (!value || typeof value !== "object" || Array.isArray(value)) fail("DELEGATED_LOCAL_POINTER_INVALID"); return value;
    } catch { fail("DELEGATED_LOCAL_POINTER_INVALID"); }
  }
  function pointer(content, base, prefix = "") {
    let text; try { text = new TextDecoder("utf-8", { fatal: true }).decode(content); } catch { fail("DELEGATED_LOCAL_POINTER_INVALID"); }
    if (prefix && !text.startsWith(prefix)) fail("DELEGATED_LOCAL_POINTER_INVALID"); text = text.slice(prefix.length).replace(/\r?\n$/u, "");
    if (!text || /[\x00-\x1f\x7f]/u.test(text) || text !== text.trim()) fail("DELEGATED_LOCAL_POINTER_INVALID");
    assertAgentLocalPath(text); return local(path.resolve(base, text));
  }
  const target = local(targetRoot); stat(target); let markerRoot = target, marker = null;
  for (let depth = 0; depth < 256; depth++) {
    const candidate = path.join(markerRoot, ".git"), observed = stat(candidate);
    if (observed) { marker = { path: candidate, stat: observed }; break; }
    files.set(candidate, { path: candidate, sha256: null, bytes: 0 });
    const next = path.dirname(markerRoot); if (next === markerRoot) { markerRoot = target; break; } markerRoot = next;
    if (depth === 255) fail("DELEGATED_LOCAL_POINTER_LIMIT");
  }
  let gitDir = null, commonDir = null;
  if (marker) {
    gitDir = marker.stat.isDirectory() ? marker.path : pointer(bytes(marker.path, 65536), markerRoot, "gitdir: ");
    const gitStat = stat(gitDir); if (!gitStat?.isDirectory()) fail("DELEGATED_LOCAL_POINTER_INVALID");
    const common = bytes(path.join(gitDir, "commondir"), 65536); commonDir = common === null ? gitDir : pointer(common, gitDir);
    if (!stat(commonDir)?.isDirectory()) fail("DELEGATED_LOCAL_POINTER_INVALID");
    if (!samePath(gitDir, commonDir)) {
      const backlink = bytes(path.join(gitDir, "gitdir"), 65536);
      if (backlink !== null) pointer(backlink, gitDir);
    }
  }
  // Inspect declared names only; canonical receipt/transaction authority stays
  // in readActivation. Their target files must not be observed by this preflight.
  function relativePointer(value) {
    if (typeof value !== "string" || !value || value.length > 8192) fail("DELEGATED_LOCAL_POINTER_INVALID");
    assertAgentLocalPath(value);
  }
  function mapPointers(value) {
    if (value === undefined) return;
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("DELEGATED_LOCAL_POINTER_INVALID");
    const names = Object.keys(value); if (names.length > 20000) fail("DELEGATED_LOCAL_POINTER_LIMIT");
    names.forEach(relativePointer);
  }
  const receipt = json(path.join(markerRoot, ".aidn/install/receipt.json"));
  mapPointers(receipt?.assets); mapPointers(receipt?.installation?.assets);
  if (receipt?.last_transaction !== undefined) {
    if (typeof receipt.last_transaction !== "string" || !/^[a-f0-9]{32}$/u.test(receipt.last_transaction)) fail("DELEGATED_LOCAL_POINTER_INVALID");
    const transaction = json(path.join(markerRoot, ".aidn/install/transactions", receipt.last_transaction + ".json"));
    if (transaction) {
      if (!Array.isArray(transaction.operations) || transaction.operations.length > 20000) fail("DELEGATED_LOCAL_POINTER_INVALID");
      for (const operation of transaction.operations) relativePointer(operation?.path);
    }
  }
  if (receipt?.package?.root !== undefined) {
    const root = local(receipt.package.root);
    if (expectedPackageRoot !== undefined && !samePath(root, local(expectedPackageRoot))) fail("DELEGATED_CANDIDATE_BINDING_CHANGED");
    stat(root);
  }
  if (receipt?.global_runtime !== undefined) {
    const home = local(receipt.global_runtime?.home); stat(home);
    const pending = bytes(path.join(home, "pending.json"));
    // A pending global transaction is refused canonically before any generation.
    if (pending === null) {
      const runtime = json(path.join(home, "runtime.json"));
      if (runtime) {
        if (!Array.isArray(runtime.assets) || runtime.assets.length > 4096 || !/^[a-f0-9-]{36}$/u.test(runtime.active?.id ?? "")) fail("DELEGATED_LOCAL_POINTER_INVALID");
        for (const asset of runtime.assets) {
          const file = local(asset?.path); stat(file);
          if (file.endsWith(`${path.sep}SKILL.md`)) stat(path.join(path.dirname(path.dirname(path.dirname(file))), "config.toml"));
        }
        const generation = local(path.join(home, "generations", runtime.active.id));
        const manifest = json(path.join(generation, "manifest.json"));
        if (manifest?.files && typeof manifest.files === "object" && !Array.isArray(manifest.files)) {
          const names = Object.keys(manifest.files); if (names.length > 20000) fail("DELEGATED_LOCAL_POINTER_LIMIT");
          for (const name of names) {
            if (!name || name.includes("\\") || name.includes(":") || name.split("/").some(part => !part || part === "." || part === "..")) fail("DELEGATED_LOCAL_POINTER_INVALID");
            assertAgentLocalPath(name);
          }
        }
        const packageRoot = path.join(generation, "node_modules", "aidn-workflow");
        if (expectedPackageRoot !== undefined && !samePath(packageRoot, local(expectedPackageRoot))) fail("DELEGATED_CANDIDATE_BINDING_CHANGED");
      }
    }
  }
  return { target_root: target, git_dir: gitDir, common_dir: commonDir, files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)) };
}
// Candidate inventory is captured from the exact installed tarball, outside all
// writable worker roots. This factory performs no installation or authorization.
export function createAgentWorktreeInspector({ candidate } = {}) {
  if (!candidate || !path.isAbsolute(candidate.packageRoot ?? "") || !path.isAbsolute(candidate.archivePath ?? "")
      || !/^[a-f0-9]{64}$/.test(candidate.sha256 ?? "") || !candidate.inventory || typeof candidate.version !== "string") throw new TypeError("AGENT_CANDIDATE_REQUIRED");
  const expected = structuredClone(candidate);
  return async function inspectWorktree({ attempt, request }, { signal } = {}) {
    const live = () => { if (signal?.aborted) fail("DELEGATED_ADMISSION_CANCELLED"); };
    live();
    for (const selected of [attempt?.worktree?.cwd, request?.cwd, expected.packageRoot, expected.archivePath]) assertAgentLocalPath(selected);
    const pointers = inspectAgentWorktreeLocalPointers(attempt.worktree.cwd, { expectedPackageRoot: expected.packageRoot });
    const state = readActivation({ targetRoot: attempt.worktree.cwd, beforeObserve: assertAgentLocalPath });
    if (fingerprintAgentExecutionValue(pointers) !== fingerprintAgentExecutionValue(inspectAgentWorktreeLocalPointers(attempt.worktree.cwd, { expectedPackageRoot: expected.packageRoot }))) fail("DELEGATED_LOCAL_POINTER_CHANGED");
    if (state.state !== "active" || !state.active || !state.authorization || !state.receipt || !state.identity.git_dir) fail("DELEGATED_ACTIVATION_REQUIRED");
    live();
    const root = state.identity.target_root, receipt = state.receipt;
    if (!samePath(root, attempt.worktree.cwd) || !samePath(receipt.package.root, expected.packageRoot)
        || receipt.package.version !== expected.version) fail("DELEGATED_CANDIDATE_BINDING_CHANGED");
    const relativeEngine = path.relative(root, expected.packageRoot), relativeArchive = path.relative(root, expected.archivePath);
    for (const relative of [relativeEngine, relativeArchive]) {
      if (!relative || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))) fail("DELEGATED_CANDIDATE_INSIDE_WORKER");
    }
    if (hash(fs.readFileSync(checkedHostPath(expected.archivePath))) !== expected.sha256
        || fs.readFileSync(checkedHostPath(path.join(expected.packageRoot, "VERSION")), "utf8").trim() !== expected.version
        || fingerprintAgentExecutionValue(inventoryRuntime(expected.packageRoot, { beforeObserve: assertAgentLocalPath })) !== fingerprintAgentExecutionValue(expected.inventory)) fail("DELEGATED_CANDIDATE_CHANGED");
    live();
    const transaction = read(path.join(root, `.aidn/install/transactions/${receipt.last_transaction}.json`));
    // readActivation has already verified this transaction's seal and completion.
    if (transaction.installation_context?.args?.persistencePolicy !== "verify-only") fail("DELEGATED_PERSISTENCE_POLICY_REQUIRED");
    const marker = read(path.join(root, ".codex/aidn-agent-attempt.json"));
    if (marker.protocol_version !== 1 || marker.attempt_id !== attempt.attempt_id
        || marker.request_sha256 !== fingerprintAgentExecutionValue(request)) fail("DELEGATED_MARKER_CHANGED");
    const git = spawnSync("git", ["-C", root, "rev-parse", "--verify", "HEAD"], {
      env: createActivationGitEnvironment(), encoding: "utf8", windowsHide: true, timeout: 1500, maxBuffer: 65536,
    });
    live();
    const branch = spawnSync("git", ["-C", root, "symbolic-ref", "--quiet", "--short", "HEAD"], {
      env: createActivationGitEnvironment(), encoding: "utf8", windowsHide: true, timeout: 1500, maxBuffer: 65536,
    });
    if (git.error || git.status !== 0 || git.signal || branch.error || branch.status !== 0 || branch.signal) fail("DELEGATED_GIT_OBSERVATION_FAILED");
    live();
    return { physical_root: root, worktree_id: state.identity.root_id, branch: branch.stdout.trim(), head: git.stdout.trim(),
      active: true, activation: { authority_id: state.authorization.authority_id, revision: state.authorization.revision },
      engine: { version: expected.version, sha256: expected.sha256 }, receipt_valid: true, persistence_policy: "verify-only" };
  };
}
