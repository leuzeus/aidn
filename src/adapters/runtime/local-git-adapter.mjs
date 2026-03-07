import { execSync, execFileSync } from "node:child_process";

export function createLocalGitAdapter() {
  return {
    getCurrentBranch(targetRoot) {
      try {
        return execSync(`git -C "${targetRoot}" branch --show-current`, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim() || "unknown";
      } catch {
        return "unknown";
      }
    },
    hasWorkingTreeChanges(targetRoot) {
      try {
        const out = execFileSync("git", ["-C", targetRoot, "status", "--porcelain", "--untracked-files=no"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        return out.length > 0;
      } catch {
        return false;
      }
    },
  };
}
