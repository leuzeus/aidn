import path from "node:path";
import { execFileSync } from "node:child_process";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const inside = (root, file) => { const relative = path.relative(path.resolve(root), path.resolve(file)); return relative === "" || !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep); };
export function assertDiagnosticPathScope(file, deniedRoots = []) {
  if (deniedRoots.some(root => typeof root !== "string" || !path.isAbsolute(root) || inside(root, file))) fail("STANDARD_DRIFT_CONTEXT_SCOPE_DENIED");
}
// One fresh invocation, under the caller's existing Git environment and limits.
// Options are ordered: the first HEAD emits its object ID, the second its full
// symbolic name. Detached HEAD remains an empty branch, as with branch/show-current.
// This observation is never retained for another call or an awaited boundary.
export function readStandardGitHead(run) {
  const rows = run(["rev-parse", "HEAD", "--symbolic-full-name", "HEAD"]).trimEnd().split(/\r?\n/);
  if (rows.length !== 2 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(rows[0])
    || rows[1] !== "HEAD" && !rows[1].startsWith("refs/heads/")) fail("STANDARD_DRIFT_GIT_OBSERVATION_FAILED");
  return { branch: rows[1] === "HEAD" ? "" : rows[1].slice(11), head: rows[0] };
}
// Only declared product contents enter a model prompt. The trusted host hashes
// the other changes to detect staleness, without forwarding their paths/content.
export function readControlledDriftGit({ root, productRoot, productFiles, observedDocuments = [], deniedRoots = [], environment = process.env }) {
  if (!inside(root, productRoot) || !Array.isArray(productFiles) || !productFiles.length || productFiles.length > 128) fail("STANDARD_DRIFT_PRODUCT_SCOPE_INVALID");
  if (Object.keys(environment).some(key => /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG(?:_.*)?)$/i.test(key))) fail("STANDARD_GIT_ENV_SCOPE_CONFLICT");
  const files = productFiles.map(name => {
    if (typeof name !== "string" || path.isAbsolute(name) || name.split(/[\\/]/).some(part => !part || part === "." || part === "..")) fail("STANDARD_DRIFT_PRODUCT_SCOPE_INVALID");
    const absolute = path.resolve(productRoot, name); assertDiagnosticPathScope(absolute, deniedRoots);
    return path.relative(root, absolute).replaceAll("\\", "/");
  });
  const git = args => {
    try { return execFileSync("git", ["--literal-pathspecs", "-C", root, "-c", "core.fsmonitor=false", "-c", "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null"),
      "-c", "submodule.recurse=false", ...args], { encoding: "utf8", shell: false, windowsHide: true, timeout: 10000, maxBuffer: 262144,
        env: { ...environment, GIT_OPTIONAL_LOCKS: "0" }, stdio: ["ignore", "pipe", "pipe"] }); }
    catch { fail("STANDARD_DRIFT_GIT_OBSERVATION_FAILED"); }
  };
  const diff = git(["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "HEAD", "--", ...files]);
  const globalDiff = git(["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "HEAD", "--"]), status = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const known = new Set([...files, ...observedDocuments].map(value => process.platform === "win32" ? value.toLowerCase() : value));
  const other = [], entries = status.split("\0");
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]; if (!entry) continue;
    const file = entry.slice(3), state = entry.slice(0, 2), old = /[RC]/.test(state) ? entries[++index] : null;
    if (![file, ...(old ? [old] : [])].every(name => known.has(process.platform === "win32" ? name.toLowerCase() : name)))
      other.push({ status: state, path_sha256: artifactContentHash(file), previous_path_sha256: old ? artifactContentHash(old) : null });
  }
  return { ...readStandardGitHead(git), diff,
    diff_scope: "configured-product-files-only", diff_sha256: artifactContentHash(diff), global_diff_sha256: artifactContentHash(globalDiff),
    status_sha256: artifactContentHash(status), other_changes: { count: other.length, sha256: shadowHash(other) } };
}
