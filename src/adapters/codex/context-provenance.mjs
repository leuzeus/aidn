import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveWorkspaceContext } from "../../application/runtime/workspace-resolution-service.mjs";
import { resolveEffectiveStateMode } from "../../core/state-mode/state-mode-policy.mjs";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MAX_BYTES = 64 * 1024 * 1024;
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000,
    maxBuffer: MAX_BYTES, windowsHide: true,
  });
}

function fileDigest(filePath, budget) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) return sha(`symlink:${fs.readlinkSync(filePath)}`);
  if (!stat.isFile()) throw new Error("unsupported_context_input");
  budget.bytes += stat.size;
  if (budget.bytes > MAX_BYTES) throw new Error("context_input_budget_exceeded");
  return sha(fs.readFileSync(filePath));
}

function directoryManifest(root, relative, budget, output) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) {
    output.push([relative.replaceAll("\\", "/"), null]);
    return;
  }
  const stat = fs.lstatSync(full);
  if (!stat.isDirectory()) {
    output.push([relative.replaceAll("\\", "/"), fileDigest(full, budget)]);
    return;
  }
  for (const name of fs.readdirSync(full).sort()) {
    directoryManifest(root, path.join(relative, name), budget, output);
  }
}

function rulesDigest(packageRoot) {
  const manifest = [];
  const budget = { bytes: 0 };
  // The shipped runtime implementation and policies are the rule revision.
  // No Git history or new rule authority is introduced for installed packages.
  for (const relative of ["package.json", "src", "tools", "bin"]) {
    directoryManifest(packageRoot, relative, budget, manifest);
  }
  return sha(JSON.stringify(manifest));
}

export function captureContextIdentity({ targetRoot, stateMode, packageRoot = PACKAGE_ROOT } = {}) {
  const root = path.resolve(targetRoot ?? ".");
  try {
    const workspace = resolveWorkspaceContext({ targetRoot: root });
    if (!workspace.is_git_repo) throw new Error("git_context_unavailable");
    const head = git(root, ["rev-parse", "--verify", "HEAD"]).trim();
    const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    const dirty = git(root, [
      "diff", "--binary", "--no-ext-diff", "--no-textconv", "HEAD", "--", ".",
      ":(exclude).aidn/runtime",
    ]);
    const staged = git(root, [
      "diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv", "HEAD", "--", ".",
      ":(exclude).aidn/runtime",
    ]);
    const untracked = git(root, ["ls-files", "-z", "--others", "--exclude-standard", "--", "."])
      .split("\0").filter(Boolean).filter((name) => !name.replaceAll("\\", "/").startsWith(".aidn/runtime/")).sort();
    const budget = { bytes: 0 };
    const inputs = untracked.map((name) => [name, fileDigest(path.join(root, name), budget)]);
    for (const relative of [".aidn/config.json", ".aidn/project", "AGENTS.md", ".agents", ".codex"]) {
      directoryManifest(root, relative, budget, inputs);
    }
    const effectiveMode = resolveEffectiveStateMode({ targetRoot: root, stateMode: stateMode || "files" });
    const identity = {
      target_root: root,
      project_id: workspace.project_id,
      workspace_id: workspace.workspace_id,
      worktree_id: workspace.worktree_id,
      worktree_root: workspace.worktree_root,
      git_dir: workspace.git_dir,
      head_commit: head,
      branch,
      state_mode: effectiveMode,
      content_sha256: sha(JSON.stringify({ dirty, staged, inputs })),
      rules_sha256: rulesDigest(packageRoot),
    };
    return {
      status: "captured", ...identity, fingerprint: sha(JSON.stringify(identity)),
      input_scope: "git-tracked-and-nonignored-untracked-plus-project-rules-and-aidn-config",
    };
  } catch {
    // Do not leak Git stderr, file content, paths or resolved connection material.
    return { status: "unavailable", reason: "context_capture_incomplete", target_root: root };
  }
}
