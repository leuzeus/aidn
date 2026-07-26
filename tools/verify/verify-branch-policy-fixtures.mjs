#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { removePathWithRetry } from "../perf/test-git-fixture-lib.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const policyScript = path.join(repoRoot, "tools", "verify", "verify-branch-policy.mjs");

function run(command, args, cwd, env = process.env) {
  return spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024,
    shell: false,
  });
}

function git(args, cwd) {
  const result = run("git", args, cwd);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr).trim()}`);
  }
  return String(result.stdout).trim();
}

function policyEnv(overrides) {
  return {
    ...process.env,
    GITHUB_EVENT_NAME: "",
    GITHUB_HEAD_REF: "",
    GITHUB_BASE_REF: "",
    AIDN_BRANCH_POLICY_EVENT_NAME: "",
    AIDN_BRANCH_POLICY_HEAD_REF: "",
    AIDN_BRANCH_POLICY_BASE_REF: "",
    AIDN_BRANCH_POLICY_EXPECTED_SHA: "",
    AIDN_BRANCH_POLICY_CONTAINS_REF: "",
    ...overrides,
  };
}

function assertStatus(name, result, expected) {
  if (result.status !== expected) {
    throw new Error(
      `${name}: expected exit ${expected}, got ${result.status}\n`
      + `${String(result.stdout)}\n${String(result.stderr)}`,
    );
  }
}

function main() {
  const results = [];
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-branch-policy-"));
  try {
    git(["init", "--initial-branch=dev", "--quiet"], tempRoot);
    git(["config", "user.name", "aidn-tests"], tempRoot);
    git(["config", "user.email", "aidn-tests@example.invalid"], tempRoot);
    fs.writeFileSync(path.join(tempRoot, "fixture.txt"), "branch policy fixture\n", "utf8");
    git(["add", "fixture.txt"], tempRoot);
    git(["commit", "--quiet", "-m", "fixture"], tempRoot);
    git(["checkout", "--quiet", "-b", "codex/fixture"], tempRoot);
    const candidateSha = git(["rev-parse", "HEAD"], tempRoot);

    const cases = [
      {
        name: "feature_to_dev_pass",
        env: {
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_HEAD_REF: "codex/example-feature",
          GITHUB_BASE_REF: "dev",
        },
        expected: 0,
      },
      {
        name: "release_to_main_pass",
        env: {
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_HEAD_REF: "release/0.7.0",
          GITHUB_BASE_REF: "main",
        },
        expected: 0,
      },
      {
        name: "feature_to_main_fail",
        env: {
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_HEAD_REF: "codex/example-feature",
          GITHUB_BASE_REF: "main",
        },
        expected: 1,
      },
    ];
    for (const item of cases) {
      const result = run(process.execPath, [policyScript], tempRoot, policyEnv(item.env));
      assertStatus(item.name, result, item.expected);
      results.push({ name: item.name, status: item.expected === 0 ? "PASS" : "EXPECTED_FAIL" });
    }

    git(["update-ref", "refs/remotes/origin/codex/fixture", candidateSha], tempRoot);
    git(["checkout", "--quiet", "--detach", candidateSha], tempRoot);

    const explicitResult = run(process.execPath, [policyScript], tempRoot, policyEnv({
      AIDN_BRANCH_POLICY_HEAD_REF: "codex/fixture",
      AIDN_BRANCH_POLICY_BASE_REF: "dev",
      AIDN_BRANCH_POLICY_EXPECTED_SHA: candidateSha,
    }));
    assertStatus("detached_exact_sha_explicit_refs_pass", explicitResult, 0);
    results.push({ name: "detached_exact_sha_explicit_refs_pass", status: "PASS" });

    const containmentResult = run(process.execPath, [policyScript], tempRoot, policyEnv({
      AIDN_BRANCH_POLICY_BASE_REF: "dev",
      AIDN_BRANCH_POLICY_EXPECTED_SHA: candidateSha,
      AIDN_BRANCH_POLICY_CONTAINS_REF: "origin/codex/fixture",
    }));
    assertStatus("detached_remote_containment_pass", containmentResult, 0);
    results.push({ name: "detached_remote_containment_pass", status: "PASS" });
  } finally {
    const cleanup = removePathWithRetry(tempRoot);
    if (!cleanup.ok) {
      throw cleanup.error;
    }
  }

  console.log(JSON.stringify({
    ok: true,
    status: "PASS",
    cases: results,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
