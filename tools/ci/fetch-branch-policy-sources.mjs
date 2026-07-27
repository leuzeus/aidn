#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function defaultGit(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function branchSourceRefspecs(headRef) {
  const head = String(headRef ?? "").trim();
  if (!head || head.startsWith("-") || head.includes("..") || /[\s~^:?*[\\]/u.test(head)) {
    throw new Error(`GITHUB_HEAD_REF is not a safe branch name: ${head || "missing"}`);
  }
  return [...new Set([head, "dev", "main"])].map(
    (branch) => `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
  );
}

export function fetchBranchPolicySources({
  headRef = process.env.GITHUB_HEAD_REF,
  runGit = defaultGit,
} = {}) {
  const refspecs = branchSourceRefspecs(headRef);
  runGit(["fetch", "--no-tags", "origin", ...refspecs]);
  return { head_ref: String(headRef).trim(), refspecs };
}

function main() {
  const result = fetchBranchPolicySources();
  console.log(JSON.stringify({ ok: true, status: "PASS", ...result }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
