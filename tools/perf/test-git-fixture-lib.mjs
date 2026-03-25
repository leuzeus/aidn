import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readSourceBranch } from "../../src/lib/workflow/session-context-lib.mjs";

function runGit(target, args) {
  execFileSync("git", ["-C", target, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function copyFixtureToTmp(source, tmpRoot, prefix) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const destination = path.resolve(tmpRoot, `${prefix}-${stamp}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
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
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return { ok: true, attempts: attempt + 1, error: null };
    } catch (error) {
      lastError = error;
      const code = String(error?.code ?? "");
      if (!["EPERM", "EBUSY", "ENOTEMPTY"].includes(code) || attempt === retries) {
        break;
      }
      sleep(delayMs * (attempt + 1));
    }
  }
  return { ok: false, attempts: retries + 1, error: lastError };
}
