import fs from "node:fs";
import path from "node:path";
import { execSync, execFileSync } from "node:child_process";
import { assertVcsAdapter } from "../../core/ports/vcs-adapter-port.mjs";

function runGitString(targetRoot, args) {
  try {
    return execFileSync("git", ["-C", targetRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export function createLocalGitAdapter() {
  return assertVcsAdapter({
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
    getRepoRoot(targetRoot) {
      return runGitString(targetRoot, ["rev-parse", "--show-toplevel"]) || null;
    },
    getWorktreeRoot(targetRoot) {
      return runGitString(targetRoot, ["rev-parse", "--show-toplevel"]) || null;
    },
    getGitDir(targetRoot) {
      return runGitString(targetRoot, ["rev-parse", "--absolute-git-dir"]) || null;
    },
    getGitCommonDir(targetRoot) {
      return runGitString(targetRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]) || null;
    },
    isLinkedWorktree(targetRoot) {
      const repoRoot = runGitString(targetRoot, ["rev-parse", "--show-toplevel"]);
      if (!repoRoot) {
        return false;
      }
      try {
        return fs.lstatSync(path.join(repoRoot, ".git")).isFile();
      } catch {
        return false;
      }
    },
    getUpstreamBranch(targetRoot, ref = "HEAD") {
      try {
        return execFileSync("git", [
          "-C",
          targetRoot,
          "rev-parse",
          "--abbrev-ref",
          "--symbolic-full-name",
          `${ref}@{upstream}`,
        ], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim() || null;
      } catch {
        return null;
      }
    },
    getAheadBehind(targetRoot, leftRef = "HEAD", rightRef = "@{upstream}") {
      try {
        const output = execFileSync("git", [
          "-C",
          targetRoot,
          "rev-list",
          "--left-right",
          "--count",
          `${leftRef}...${rightRef}`,
        ], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        const match = output.match(/^(\d+)\s+(\d+)$/);
        if (!match) {
          return {
            known: false,
            ahead: 0,
            behind: 0,
          };
        }
        return {
          known: true,
          ahead: Number.parseInt(match[1], 10) || 0,
          behind: Number.parseInt(match[2], 10) || 0,
        };
      } catch {
        return {
          known: false,
          ahead: 0,
          behind: 0,
        };
      }
    },
    refExists(targetRoot, ref) {
      try {
        execFileSync("git", [
          "-C",
          targetRoot,
          "rev-parse",
          "--verify",
          "--quiet",
          ref,
        ], {
          encoding: "utf8",
          stdio: ["ignore", "ignore", "ignore"],
        });
        return true;
      } catch {
        return false;
      }
    },
    isAncestor(targetRoot, ancestorRef, descendantRef) {
      try {
        execFileSync("git", [
          "-C",
          targetRoot,
          "merge-base",
          "--is-ancestor",
          ancestorRef,
          descendantRef,
        ], {
          encoding: "utf8",
          stdio: ["ignore", "ignore", "ignore"],
        });
        return true;
      } catch (error) {
        if (typeof error?.status === "number" && error.status === 1) {
          return false;
        }
        return false;
      }
    },
  }, "LocalGitAdapter");
}
