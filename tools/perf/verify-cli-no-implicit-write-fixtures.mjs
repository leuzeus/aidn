#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listCliEffectPolicies } from "../../src/core/cli/effect-policy.mjs";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/repo-installed-core",
    json: false,
    keepTmp: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--keep-tmp") {
      args.keepTmp = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-cli-no-implicit-write-fixtures.mjs");
  console.log("  node tools/perf/verify-cli-no-implicit-write-fixtures.mjs --json");
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const AIDN_BIN = path.join(REPO_ROOT, "bin", "aidn.mjs");

function copyFixture(sourceRoot) {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "T").replace("Z", "Z");
  const tmpRoot = path.join(REPO_ROOT, "tests", "fixtures", `tmp-cli-no-implicit-write-${stamp}`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.cpSync(sourceRoot, tmpRoot, {
    recursive: true,
    filter(source) {
      const normalized = source.replace(/\\/g, "/");
      return !normalized.includes("/.git/");
    },
  });
  return tmpRoot;
}

function digestFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function shouldIgnore(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  return normalized === ".git" || normalized.startsWith(".git/");
}

function snapshotSelectedPaths(root, relativePaths) {
  const snapshot = new Map();
  function addFile(filePath) {
    const relativePath = path.relative(root, filePath).replace(/\\/g, "/");
    if (!shouldIgnore(relativePath)) {
      snapshot.set(relativePath, digestFile(filePath));
    }
  }
  function walk(currentDir) {
    if (!fs.existsSync(currentDir)) {
      return;
    }
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(root, absolutePath).replace(/\\/g, "/");
      if (shouldIgnore(relativePath)) {
        continue;
      }
      if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (entry.isFile()) {
        addFile(absolutePath);
      }
    }
  }
  for (const relativePath of relativePaths) {
    const absolutePath = path.resolve(root, relativePath);
    if (!fs.existsSync(absolutePath)) {
      snapshot.set(relativePath.replace(/\\/g, "/"), null);
      continue;
    }
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      walk(absolutePath);
    } else if (stat.isFile()) {
      addFile(absolutePath);
    }
  }
  return snapshot;
}

function diffSnapshots(before, after) {
  const issues = [];
  const paths = new Set([...before.keys(), ...after.keys()]);
  for (const relativePath of [...paths].sort()) {
    if (!before.has(relativePath)) {
      issues.push(`${relativePath}: added`);
    } else if (!after.has(relativePath)) {
      issues.push(`${relativePath}: removed`);
    } else if (before.get(relativePath) !== after.get(relativePath)) {
      issues.push(`${relativePath}: modified`);
    }
  }
  return issues;
}

function policyIsCheckable(policy) {
  if (!["read-only", "preview", "projector"].includes(policy.effect_class)) {
    return false;
  }
  if (policy.effect_class === "projector" && !policy.safe_args.includes("--dry-run")) {
    return false;
  }
  return policy.stability === "stable";
}

function guardedPathsForPolicy(policy) {
  return [
    "AGENTS.md",
    "docs/audit",
    ".codex",
    ".aidn/config.json",
    ".aidn/project",
    ...policy.no_mutation_paths,
  ];
}

function runPolicy(tmpRoot, policy) {
  const guardedPaths = guardedPathsForPolicy(policy);
  const before = snapshotSelectedPaths(tmpRoot, guardedPaths);
  const result = spawnSync(process.execPath, [
    AIDN_BIN,
    ...policy.safe_args,
    "--target",
    tmpRoot,
  ], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
  });
  const after = snapshotSelectedPaths(tmpRoot, guardedPaths);
  const mutationIssues = diffSnapshots(before, after);
  const exitOk = result.status === 0 || policy.allow_non_zero === true;
  const issues = [];
  if (!exitOk) {
    issues.push(`command exited with ${result.status}`);
  }
  issues.push(...mutationIssues);
  return {
    id: policy.id,
    command: policy.command,
    effect_class: policy.effect_class,
    checked_args: policy.safe_args,
    guarded_paths: guardedPaths,
    exit_code: result.status,
    ok: issues.length === 0,
    status: issues.length === 0 ? "pass" : "fail",
    changed_paths: mutationIssues,
    stderr: String(result.stderr ?? "").trim(),
    issues,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceRoot = path.resolve(REPO_ROOT, args.target);
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`Target fixture not found: ${sourceRoot}`);
  }
  const policies = listCliEffectPolicies().filter(policyIsCheckable);
  const tmpRoot = copyFixture(sourceRoot);
  const results = [];
  try {
    for (const policy of policies) {
      results.push(runPolicy(tmpRoot, policy));
    }
  } finally {
    if (!args.keepTmp) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
  const output = {
    ok: results.every((item) => item.ok),
    target_root: sourceRoot,
    tmp_root: args.keepTmp ? tmpRoot : "removed",
    checked_commands: results.length,
    results,
  };
  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`CLI no implicit write: ${output.ok ? "PASS" : "FAIL"}`);
    for (const result of results) {
      console.log(`- ${result.id}: ${result.status}`);
      for (const issue of result.issues) {
        console.log(`  - ${issue}`);
      }
    }
  }
  if (!output.ok) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  printUsage();
  process.exit(1);
}
