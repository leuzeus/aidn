import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readSourceBranch } from "../../src/lib/workflow/session-context-lib.mjs";

function runGit(target, args) {
  execFileSync("git", ["-C", target, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// Reference corpora are the tracked source, not a previously exercised local
// client. Never import ignored stores, cached observations or untracked files.
export function createTrackedFixtureFilter(sourceRoot, repoRoot = process.cwd()) {
  const root = path.resolve(repoRoot);
  const source = path.resolve(sourceRoot);
  const relative = path.relative(root, source).replaceAll("\\", "/");
  if (!relative || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error("Fixture source must be inside its repository");
  }
  const files = execFileSync("git", ["-C", root, "ls-files", "-z", "--", relative], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  }).split("\0").filter(Boolean);
  if (!files.length) throw new Error("Tracked fixture source is empty");
  const key = value => process.platform === "win32" ? value.toLowerCase() : value;
  const admitted = new Set(files.map(key));
  for (const file of files) {
    const parts = file.split("/");
    while (parts.length > 1) { parts.pop(); admitted.add(key(parts.join("/"))); }
  }
  return candidate => admitted.has(key(path.relative(root, path.resolve(candidate)).replaceAll("\\", "/")));
}

export function copyFixtureToTmp(source, tmpRoot, prefix, options = {}) {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  const destination = path.resolve(tmpRoot, `${prefix}-${stamp}-${randomUUID().slice(0, 8)}`);
  fs.mkdirSync(destination, { recursive: true });
  if (typeof options.onDestinationCreated === "function") {
    options.onDestinationCreated(destination);
  }
  fs.cpSync(source, destination, { recursive: true, ...(options.filter ? { filter: options.filter } : {}) });
  return destination;
}

export function initGitRepo(target, options = {}) {
  const sourceBranch = options.sourceBranch || readSourceBranch(target) || "main";
  const workingBranch = options.workingBranch || sourceBranch;
  runGit(target, ["init", "--initial-branch", sourceBranch]);
  runGit(target, ["config", "user.name", "aidn-tests"]);
  runGit(target, ["config", "user.email", "aidn-tests@example.invalid"]);
  runGit(target, ["add", "."]);
  runGit(target, ["commit", "-m", "fixture"]);
  if (workingBranch !== sourceBranch) {
    runGit(target, ["checkout", "-b", workingBranch]);
  }
  return {
    source_branch: sourceBranch,
    working_branch: workingBranch,
  };
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function removePathWithRetry(target, options = {}) {
  const retries = Number(options.retries ?? 5);
  const delayMs = Number(options.delayMs ?? 75);
  const rmSyncImpl = options.rmSyncImpl ?? fs.rmSync;
  let lastError = null;
  let attempts = 0;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    attempts = attempt + 1;
    try {
      rmSyncImpl(target, { recursive: true, force: true });
      return { ok: true, attempts, error: null };
    } catch (error) {
      lastError = error;
      const code = String(error?.code ?? "");
      if (!["EPERM", "EBUSY", "ENOTEMPTY"].includes(code) || attempt === retries) {
        break;
      }
      sleep(delayMs * (attempt + 1));
    }
  }
  return { ok: false, attempts, error: lastError };
}
