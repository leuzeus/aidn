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
