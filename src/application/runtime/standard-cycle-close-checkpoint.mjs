import path from "node:path";
import { execFileSync } from "node:child_process";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";
const fail = code => { throw Object.assign(new Error(code), { code }); };
const stable = context => { const { git, head, documents, ...body } = context; return shadowHash({ ...body, documents: documents.map(({ ref, sha256 }) => ({ ref, sha256 })) }); };
function git(root, args, raw = false) {
  if (Object.keys(process.env).some(key => /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG(?:_.*)?)$/i.test(key))) fail("STANDARD_GIT_ENV_SCOPE_CONFLICT");
  return execFileSync("git", ["--literal-pathspecs", "-C", root, "-c", "core.fsmonitor=false", "-c", "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null"), ...args],
    { encoding: raw ? undefined : "utf8", shell: false, windowsHide: true, timeout: 10000, maxBuffer: 1048576, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, stdio: ["ignore", "pipe", "pipe"] });
}
// Same bounded Git-checkpoint protocol as the existing drift recovery port:
// capture reviewed postimages; observe an explicit external commit without
// authoring a commit, accepting caller hashes or changing the original record.
export function captureCycleCloseCheckpoint({ root, context }) {
  const entries = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0").filter(Boolean);
  if (entries.length > 128) fail("STANDARD_CYCLE_CLOSE_CHECKPOINT_LIMIT");
  const files = entries.map(entry => {
    if (!/^( M|M |A |AM|MM|\?\?)/.test(entry.slice(0, 2))) fail("STANDARD_CYCLE_CLOSE_CHECKPOINT_STATE_UNSUPPORTED");
    const file = entry.slice(3), physical = agentRunPhysicalPath(path.resolve(root, file)), relative = path.relative(root, physical);
    if (relative.startsWith("..") || path.isAbsolute(relative)) fail("STANDARD_CYCLE_CLOSE_CHECKPOINT_PATH_INVALID");
    return { path: file, sha256: readAgentRunFile(physical, { json: false, maxBytes: 1048576 }).sha256 };
  });
  return { snapshot_sha256: stable(context), head: context.head, files };
}
export function verifyCycleCloseCheckpoint({ root, context, state }) {
  if (!state || stable(context) !== state.snapshot_sha256 || context.git.other_changes.count !== 0) fail("STANDARD_CYCLE_CLOSE_CHECKPOINT_SOURCE_STALE");
  if (git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])) return false;
  if (context.head !== state.head) {
    try { git(root, ["merge-base", "--is-ancestor", state.head, context.head]); } catch { fail("STANDARD_CYCLE_CLOSE_CHECKPOINT_HISTORY_INVALID"); }
    const count = Number(git(root, ["rev-list", "--count", `${state.head}..${context.head}`]).trim());
    if (!Number.isSafeInteger(count) || count < 1 || count > 32) fail("STANDARD_CYCLE_CLOSE_CHECKPOINT_HISTORY_INVALID");
    const changed = git(root, ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", state.head, context.head, "--"]).split("\0").filter(Boolean);
    if (changed.some(file => !state.files.some(row => row.path === file))) fail("STANDARD_CYCLE_CLOSE_CHECKPOINT_SCOPE_CHANGED");
  }
  for (const file of state.files) if (readAgentRunFile(agentRunPhysicalPath(path.join(root, file.path)), { json: false, maxBytes: 1048576 }).sha256 !== file.sha256
    || artifactContentHash(git(root, ["show", `${context.head}:${file.path}`], true)) !== file.sha256) fail("STANDARD_CYCLE_CLOSE_CHECKPOINT_CONTENT_CHANGED");
  return true;
}
