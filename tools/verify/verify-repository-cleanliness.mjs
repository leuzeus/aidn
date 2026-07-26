#!/usr/bin/env node
import { captureGitWorktreeStatus } from "./git-worktree-state-lib.mjs";

const worktree = captureGitWorktreeStatus(process.cwd());
const ok = worktree.ok && worktree.clean;
const output = {
  ok,
  status: ok ? "PASS" : "FAIL",
  failure_kind: worktree.failure_kind,
  reason: !worktree.ok
    ? "git status failed"
    : (worktree.clean ? "Git worktree is clean" : "Git worktree contains tracked or untracked changes"),
  entries: worktree.entries,
  entry_count: worktree.entry_count,
  entries_truncated: worktree.entries_truncated,
  git_status: worktree.command,
};
console.log(JSON.stringify(output, null, 2));
if (!output.ok) {
  process.exitCode = 1;
}
