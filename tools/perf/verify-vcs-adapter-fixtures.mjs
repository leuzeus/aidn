#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createLocalGitAdapter } from "../../src/adapters/runtime/local-git-adapter.mjs";
import { assertVcsAdapter } from "../../src/core/ports/vcs-adapter-port.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

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

    const remoteRoot = path.join(tempRoot, "origin.git");
    runGit(tempRoot, ["init", "--bare", remoteRoot]);
    runGit(targetRoot, ["remote", "add", "origin", remoteRoot]);
    runGit(targetRoot, ["push", "-u", "origin", "main"]);

    const adapter = assertVcsAdapter(createLocalGitAdapter(), "LocalGitAdapter");
    const branch = adapter.getCurrentBranch(targetRoot);
    const headCommit = adapter.getHeadCommit(targetRoot);
    const cleanWorkingTree = adapter.hasWorkingTreeChanges(targetRoot);
    const repoRoot = adapter.getRepoRoot(targetRoot);
    const upstreamBranch = adapter.getUpstreamBranch(targetRoot);
    const syncedDivergence = adapter.getAheadBehind(targetRoot, "HEAD", upstreamBranch);
    const mainBranchExists = adapter.refExists(targetRoot, "main");
    const missingBranchExists = adapter.refExists(targetRoot, "missing/ref");

    assert(branch === "main", `expected current branch main, received ${branch}`);
    assert(headCommit !== "unknown" && headCommit.length >= 7, "expected a concrete HEAD commit");
    assert(cleanWorkingTree === false, "expected clean working tree after initial commit");
    assert(path.resolve(repoRoot) === path.resolve(targetRoot), "expected repo root to match initialized repository");
    assert(upstreamBranch === "origin/main", `expected upstream branch origin/main, received ${upstreamBranch}`);
    assert(syncedDivergence.known === true && syncedDivergence.ahead === 0 && syncedDivergence.behind === 0, "expected synced branch divergence after initial push");
    assert(mainBranchExists === true, "expected main branch ref to exist");
    assert(missingBranchExists === false, "expected missing ref lookup to return false");

    fs.writeFileSync(readmePath, "# fixture\n\nupdated\n", "utf8");

    const dirtyWorkingTree = adapter.hasWorkingTreeChanges(targetRoot);
    const statusOutput = adapter.execStatusPorcelain(targetRoot, "README.md", true);

    assert(dirtyWorkingTree === true, "expected modified tracked file to mark the working tree dirty");
    assert(/\sM\s+README\.md/u.test(statusOutput), "expected porcelain status to include modified README.md");

    runGit(targetRoot, ["add", "README.md"]);
    runGit(targetRoot, ["commit", "-m", "local only"]);
    const aheadDivergence = adapter.getAheadBehind(targetRoot, "HEAD", upstreamBranch);
    const remoteAncestor = adapter.isAncestor(targetRoot, "origin/main", "HEAD");
    const headAncestorRemote = adapter.isAncestor(targetRoot, "HEAD", "origin/main");

    assert(aheadDivergence.known === true, "expected ahead/behind check to be available after local commit");
    assert(aheadDivergence.ahead === 1 && aheadDivergence.behind === 0, `expected branch to be ahead by 1, received ahead=${aheadDivergence.ahead} behind=${aheadDivergence.behind}`);
    assert(remoteAncestor === true, "expected origin/main to remain an ancestor of local HEAD after local-only commit");
    assert(headAncestorRemote === false, "expected local HEAD not to be an ancestor of origin/main after local-only commit");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      removePathWithRetry(tempRoot);
    }
  }
}

main();
