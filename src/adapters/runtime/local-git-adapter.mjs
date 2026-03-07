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
    getHeadCommit(targetRoot) {
      try {
        return execSync(`git -C "${targetRoot}" rev-parse HEAD`, {
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
    execStatusPorcelain(targetRoot, pathspec = "", includeUntrackedAll = false) {
      const args = [
        "-C",
        targetRoot,
        "status",
        "--porcelain",
        includeUntrackedAll ? "--untracked-files=all" : "--untracked-files=no",
      ];
      if (pathspec) {
        args.push("--", pathspec);
      }
      return execFileSync("git", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    },
  };
}
