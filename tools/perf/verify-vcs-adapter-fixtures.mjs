#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createLocalGitAdapter } from "../../src/adapters/runtime/local-git-adapter.mjs";
import { assertVcsAdapter } from "../../src/core/ports/vcs-adapter-port.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runGit(targetRoot, args) {
  const result = spawnSync("git", ["-C", targetRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr ?? result.stdout ?? "").trim()}`);
  }
  return String(result.stdout ?? "").trim();
}

function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-vcs-adapter-"));
    const targetRoot = path.join(tempRoot, "repo");
    fs.mkdirSync(targetRoot, { recursive: true });

    runGit(targetRoot, ["init", "--initial-branch=main"]);
    runGit(targetRoot, ["config", "user.name", "aidn"]);
    runGit(targetRoot, ["config", "user.email", "aidn@example.test"]);

    const readmePath = path.join(targetRoot, "README.md");
    fs.writeFileSync(readmePath, "# fixture\n", "utf8");
    runGit(targetRoot, ["add", "README.md"]);
    runGit(targetRoot, ["commit", "-m", "initial"]);

    const adapter = assertVcsAdapter(createLocalGitAdapter(), "LocalGitAdapter");
    const branch = adapter.getCurrentBranch(targetRoot);
    const headCommit = adapter.getHeadCommit(targetRoot);
    const cleanWorkingTree = adapter.hasWorkingTreeChanges(targetRoot);

    assert(branch === "main", `expected current branch main, received ${branch}`);
    assert(headCommit !== "unknown" && headCommit.length >= 7, "expected a concrete HEAD commit");
    assert(cleanWorkingTree === false, "expected clean working tree after initial commit");

    fs.writeFileSync(readmePath, "# fixture\n\nupdated\n", "utf8");

    const dirtyWorkingTree = adapter.hasWorkingTreeChanges(targetRoot);
    const statusOutput = adapter.execStatusPorcelain(targetRoot, "README.md", true);

    assert(dirtyWorkingTree === true, "expected modified tracked file to mark the working tree dirty");
    assert(/\sM\s+README\.md/u.test(statusOutput), "expected porcelain status to include modified README.md");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
