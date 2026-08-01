#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  parseGitNameStatusZ,
  resolveGovernanceRoute,
} from "./governance-route-lib.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

function argumentValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] ?? "") : fallback;
}

function booleanArgument(name, fallback = false) {
  const value = argumentValue(name, fallback ? "true" : "false").toLowerCase();
  return ["1", "true", "yes"].includes(value);
}

function git(args) {
  return spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function gitText(args) {
  const result = git(args);
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || `git ${args[0]} failed`).trim());
  }
  return String(result.stdout ?? "").trim();
}

function currentBranch() {
  try {
    return gitText(["branch", "--show-current"]);
  } catch {
    return "";
  }
}

const baseBranch = argumentValue("--base-branch", process.env.GITHUB_BASE_REF || "dev");
const headBranch = argumentValue("--head-branch", process.env.GITHUB_HEAD_REF || currentBranch());
const baseRef = argumentValue(
  "--base-ref",
  process.env.AIDN_GOVERNANCE_BASE_REF || process.env.GITHUB_BASE_SHA || `origin/${baseBranch}`,
);
const headRef = argumentValue(
  "--head-ref",
  process.env.AIDN_GOVERNANCE_HEAD_REF || process.env.GITHUB_SHA || "HEAD",
);
const requestedLane = argumentValue(
  "--requested-lane",
  process.env.AIDN_GOVERNANCE_REQUESTED_LANE || "",
);
const draft = booleanArgument(
  "--draft",
  String(process.env.AIDN_GOVERNANCE_DRAFT ?? "").toLowerCase() === "true",
);
const catalog = JSON.parse(fs.readFileSync(
  path.join(repoRoot, "package", "catalogs", "gates.v1.json"),
  "utf8",
));
const surfaceCatalog = JSON.parse(fs.readFileSync(
  path.join(repoRoot, "package", "catalogs", "surfaces.v1.json"),
  "utf8",
));
const projectVersion = fs.readFileSync(path.join(repoRoot, "VERSION"), "utf8").trim();

let baseSha = null;
let headSha = null;
let mergeBaseSha = null;
let changes = [];
let diffResolved = true;
let resolutionError = "";
try {
  baseSha = gitText(["rev-parse", "--verify", `${baseRef}^{commit}`]);
  headSha = gitText(["rev-parse", "--verify", `${headRef}^{commit}`]);
  mergeBaseSha = gitText(["merge-base", baseSha, headSha]);
  const diff = git(["diff", "--name-status", "-z", "--find-renames", `${baseSha}...${headSha}`]);
  if (diff.status !== 0) {
    throw new Error(String(diff.stderr || diff.stdout || "git diff failed").trim());
  }
  changes = parseGitNameStatusZ(diff.stdout);
} catch (error) {
  diffResolved = false;
  resolutionError = String(error?.message ?? error);
  console.error(`governance route provenance degraded: ${resolutionError}`);
}

const output = resolveGovernanceRoute({
  catalog,
  surfaceCatalog,
  changes,
  baseBranch,
  headBranch,
  baseRef,
  headRef,
  baseSha,
  headSha,
  mergeBaseSha,
  diffResolved,
  draft,
  requestedLane,
  projectVersion,
});
if (resolutionError) {
  output.provenance.resolution_error = resolutionError;
}
console.log(JSON.stringify(output, null, 2));
if (!output.ok) {
  process.exitCode = 1;
}
