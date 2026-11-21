import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
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

function hasGitFile(worktreeRoot) {
  try {
    return fs.lstatSync(path.join(worktreeRoot, ".git")).isFile();
  } catch {
    return false;
  }
}

export function readLocalWorkspaceGit(targetRoot) {
  const result = spawnSync("git", ["-C", targetRoot, "rev-parse", "--path-format=absolute",
    "--show-toplevel", "--absolute-git-dir", "--git-common-dir", "--is-inside-work-tree",
    "--verify", "--quiet", "HEAD"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  // --verify --quiet exits 1 for an unborn HEAD, after emitting the four checkout fields.
  if (result.error || result.signal || ![0, 1].includes(result.status)) return null;
  const lines = result.stdout.trimEnd().split(/\r?\n/);
  if (lines.length !== (result.status === 0 ? 5 : 4)) return null;
  const [worktreeRoot, gitDir, gitCommonDir, inside, headCommit = "unknown"] = lines;
  if (![worktreeRoot, gitDir, gitCommonDir].every(value => path.isAbsolute(value))
      || inside !== "true" || (result.status === 0 && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(headCommit))) return null;
  return { worktreeRoot, repoRoot: worktreeRoot, gitDir, gitCommonDir, linkedWorktree: hasGitFile(worktreeRoot),
    headCommit, insideWorkTree: true };
}

export function createLocalGitAdapter() {
  return assertVcsAdapter({
    getCurrentBranch(targetRoot) {
      return runGitString(targetRoot, ["branch", "--show-current"]) || "unknown";
    },
    getHeadCommit(targetRoot) {
      return runGitString(targetRoot, ["rev-parse", "HEAD"]) || "unknown";
    },
    hasWorkingTreeChanges(targetRoot) {
      try {
        const out = execFileSync("git", ["-C", targetRoot, "status", "--porcelain", "--untracked-files=no"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
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
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
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
    isInsideWorkTree(targetRoot) {
      return runGitString(targetRoot, ["rev-parse", "--is-inside-work-tree"]) === "true";
    },
    isLinkedWorktree(targetRoot) {
      const repoRoot = runGitString(targetRoot, ["rev-parse", "--show-toplevel"]);
      return repoRoot ? hasGitFile(repoRoot) : false;
    },
    getUpstreamBranch(targetRoot, ref = "HEAD", { fullName = false } = {}) {
      try {
        return execFileSync("git", [
          "-C",
          targetRoot,
          "rev-parse",
          ...(fullName ? [] : ["--abbrev-ref"]),
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
