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
    GITHUB_REF: "",
    AIDN_BRANCH_POLICY_EVENT_NAME: "",
    AIDN_BRANCH_POLICY_HEAD_REF: "",
    AIDN_BRANCH_POLICY_BASE_REF: "",
    AIDN_BRANCH_POLICY_EXPECTED_SHA: "",
    AIDN_BRANCH_POLICY_CONTAINS_REF: "",
    AIDN_BRANCH_POLICY_SYNC_SOURCE_REF: "",
    AIDN_BRANCH_POLICY_VERSION: "",
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

function recordCase(results, name, result, expected, {
  containmentProved = null,
  remoteRefExact = null,
  syncSourceExact = null,
  branchSourceAncestor = null,
  hotfixPatchIncrement = null,
  expectedIssueIncludes = null,
} = {}) {
  assertStatus(name, result, expected);
  const payload = JSON.parse(String(result.stdout).trim());
  if (containmentProved != null
    && payload.provenance?.containment_proved !== containmentProved) {
    throw new Error(
      `${name}: expected containment_proved=${containmentProved}, got `
      + `${String(payload.provenance?.containment_proved)}`,
    );
  }
  if (remoteRefExact != null
    && payload.provenance?.remote_ref_exact !== remoteRefExact) {
    throw new Error(
      `${name}: expected remote_ref_exact=${remoteRefExact}, got `
      + `${String(payload.provenance?.remote_ref_exact)}`,
    );
  }
  if (syncSourceExact != null
    && payload.provenance?.sync_source_exact !== syncSourceExact) {
    throw new Error(
      `${name}: expected sync_source_exact=${syncSourceExact}, got `
      + `${String(payload.provenance?.sync_source_exact)}`,
    );
  }
  if (branchSourceAncestor != null
    && payload.provenance?.branch_source_ancestor !== branchSourceAncestor) {
    throw new Error(
      `${name}: expected branch_source_ancestor=${branchSourceAncestor}, got `
      + `${String(payload.provenance?.branch_source_ancestor)}`,
    );
  }
  if (hotfixPatchIncrement != null
    && payload.provenance?.hotfix_patch_increment !== hotfixPatchIncrement) {
    throw new Error(
      `${name}: expected hotfix_patch_increment=${hotfixPatchIncrement}, got `
      + `${String(payload.provenance?.hotfix_patch_increment)}`,
    );
  }
  if (expectedIssueIncludes != null
    && !payload.issues?.some((issue) => issue.includes(expectedIssueIncludes))) {
    throw new Error(
      `${name}: expected an issue containing ${JSON.stringify(expectedIssueIncludes)}, got `
      + JSON.stringify(payload.issues),
    );
  }
  results.push({
    name,
    status: expected === 0 ? "PASS" : "EXPECTED_FAIL",
    containment_proved: payload.provenance?.containment_proved ?? false,
    remote_ref_exact: payload.provenance?.remote_ref_exact ?? false,
    sync_source_exact: payload.provenance?.sync_source_exact ?? false,
    branch_source_ancestor: payload.provenance?.branch_source_ancestor ?? false,
    hotfix_patch_increment: payload.provenance?.hotfix_patch_increment ?? false,
  });
}

function main() {
  const results = [];
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-branch-policy-"));
  try {
    const remoteRoot = path.join(tempRoot, "remote.git");
    const sourceRoot = path.join(tempRoot, "source");
    const clientRoot = path.join(tempRoot, "client");
    fs.mkdirSync(sourceRoot, { recursive: true });
    git(["init", "--bare", "--quiet", remoteRoot], tempRoot);
    git(["init", "--initial-branch=dev", "--quiet"], sourceRoot);
    git(["config", "user.name", "aidn-tests"], sourceRoot);
    git(["config", "user.email", "aidn-tests@example.invalid"], sourceRoot);
    fs.writeFileSync(path.join(sourceRoot, "fixture.txt"), "branch policy fixture\n", "utf8");
    fs.writeFileSync(path.join(sourceRoot, "VERSION"), "0.7.0\n", "utf8");
    git(["add", "fixture.txt", "VERSION"], sourceRoot);
    git(["commit", "--quiet", "-m", "base fixture"], sourceRoot);
    const devSha = git(["rev-parse", "HEAD"], sourceRoot);
    git(["checkout", "--quiet", "-b", "codex/fixture"], sourceRoot);
    fs.writeFileSync(path.join(sourceRoot, "candidate.txt"), "candidate\n", "utf8");
    git(["add", "candidate.txt"], sourceRoot);
    git(["commit", "--quiet", "-m", "candidate fixture"], sourceRoot);
    const candidateSha = git(["rev-parse", "HEAD"], sourceRoot);
    const candidateTree = git(["rev-parse", `${candidateSha}^{tree}`], sourceRoot);
    const unrelatedSha = git(["commit-tree", candidateTree, "-m", "unrelated fixture"], sourceRoot);
    git(["branch", "codex/unrelated", unrelatedSha], sourceRoot);
    git(["branch", "sync/main-to-dev-v0.7.0", devSha], sourceRoot);
    git(["branch", "sync/main-to-dev-v0.7.0-diverged", candidateSha], sourceRoot);
    git(["remote", "add", "origin", remoteRoot], sourceRoot);
    git([
      "push",
      "--quiet",
      "origin",
      "dev:dev",
      "codex/fixture:codex/fixture",
      "codex/unrelated:codex/unrelated",
      "sync/main-to-dev-v0.7.0:sync/main-to-dev-v0.7.0",
      "sync/main-to-dev-v0.7.0-diverged:sync/main-to-dev-v0.7.0-diverged",
    ], sourceRoot);
    git(["push", "--quiet", "origin", "dev:main"], sourceRoot);
    git(["clone", "--quiet", remoteRoot, clientRoot], tempRoot);
    git(["fetch", "--quiet", "origin"], clientRoot);

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
          GITHUB_HEAD_REF: "release/v0.7.0",
          GITHUB_BASE_REF: "main",
        },
        expected: 0,
      },
      {
        name: "hotfix_to_main_pass",
        env: {
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_HEAD_REF: "hotfix/v0.7.1",
          GITHUB_BASE_REF: "main",
          AIDN_BRANCH_POLICY_VERSION: "0.7.1",
        },
        expected: 0,
        options: {
          hotfixPatchIncrement: true,
        },
      },
      {
        name: "hotfix_minor_increment_fail",
        env: {
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_HEAD_REF: "hotfix/v0.8.0",
          GITHUB_BASE_REF: "main",
          AIDN_BRANCH_POLICY_VERSION: "0.8.0",
        },
        expected: 1,
        options: {
          hotfixPatchIncrement: false,
          expectedIssueIncludes: "must increment exactly one patch",
        },
      },
      {
        name: "hotfix_skipped_patch_fail",
        env: {
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_HEAD_REF: "hotfix/v0.7.2",
          GITHUB_BASE_REF: "main",
          AIDN_BRANCH_POLICY_VERSION: "0.7.2",
        },
        expected: 1,
        options: {
          hotfixPatchIncrement: false,
          expectedIssueIncludes: "must increment exactly one patch",
        },
      },
      {
        name: "hotfix_major_increment_fail",
        env: {
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_HEAD_REF: "hotfix/v1.0.0",
          GITHUB_BASE_REF: "main",
          AIDN_BRANCH_POLICY_VERSION: "1.0.0",
        },
        expected: 1,
        options: {
          hotfixPatchIncrement: false,
          expectedIssueIncludes: "must increment exactly one patch",
        },
      },
      {
        name: "hotfix_prerelease_fail",
        env: {
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_HEAD_REF: "hotfix/v0.7.1-rc.1",
          GITHUB_BASE_REF: "main",
          AIDN_BRANCH_POLICY_VERSION: "0.7.1-rc.1",
        },
        expected: 1,
        options: {
          hotfixPatchIncrement: false,
          expectedIssueIncludes: "must increment exactly one patch",
        },
      },
      {
        name: "version_mismatched_release_to_main_fail",
        env: {
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_HEAD_REF: "release/v0.7.1",
          GITHUB_BASE_REF: "main",
        },
        expected: 1,
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
      {
        name: "hotfix_to_dev_fail",
        env: {
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_HEAD_REF: "hotfix/v0.7.0",
          GITHUB_BASE_REF: "dev",
        },
        expected: 1,
      },
      {
        name: "sync_to_main_fail",
        env: {
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_HEAD_REF: "sync/main-to-dev-v0.7.0",
          GITHUB_BASE_REF: "main",
        },
        expected: 1,
      },
      {
        name: "misnamed_sync_to_dev_fail",
        env: {
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_HEAD_REF: "sync/dev-to-main-v0.7.0",
          GITHUB_BASE_REF: "dev",
        },
        expected: 1,
      },
    ];
    for (const item of cases) {
      const result = run(process.execPath, [policyScript], sourceRoot, policyEnv(item.env));
      recordCase(results, item.name, result, item.expected, item.options);
    }

    git(["checkout", "--quiet", "sync/main-to-dev-v0.7.0"], sourceRoot);
    const exactSyncResult = run(process.execPath, [policyScript], sourceRoot, policyEnv({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_HEAD_REF: "sync/main-to-dev-v0.7.0",
      GITHUB_BASE_REF: "dev",
    }));
    recordCase(
      results,
      "exact_main_to_dev_sync_pass",
      exactSyncResult,
      0,
      { syncSourceExact: true },
    );

    const wrongVersionSyncResult = run(process.execPath, [policyScript], sourceRoot, policyEnv({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_HEAD_REF: "sync/main-to-dev-v9.9.9",
      GITHUB_BASE_REF: "dev",
    }));
    recordCase(
      results,
      "exact_main_wrong_sync_version_fail",
      wrongVersionSyncResult,
      1,
      {
        syncSourceExact: true,
        expectedIssueIncludes: "expected sync/main-to-dev-v0.7.0",
      },
    );

    const prereleaseSyncResult = run(process.execPath, [policyScript], sourceRoot, policyEnv({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_HEAD_REF: "sync/main-to-dev-v0.7.0-rc.1",
      GITHUB_BASE_REF: "dev",
    }));
    recordCase(
      results,
      "exact_main_prerelease_sync_version_fail",
      prereleaseSyncResult,
      1,
      {
        syncSourceExact: true,
        expectedIssueIncludes: "expected sync/main-to-dev-v0.7.0",
      },
    );

    git(["checkout", "--quiet", "sync/main-to-dev-v0.7.0-diverged"], sourceRoot);
    const divergedSyncResult = run(process.execPath, [policyScript], sourceRoot, policyEnv({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_HEAD_REF: "sync/main-to-dev-v0.7.0-diverged",
      GITHUB_BASE_REF: "dev",
    }));
    recordCase(
      results,
      "diverged_main_to_dev_sync_fail",
      divergedSyncResult,
      1,
      { syncSourceExact: false },
    );
    git(["checkout", "--quiet", "codex/fixture"], sourceRoot);

    git(["checkout", "--quiet", "codex/unrelated"], sourceRoot);
    const unrelatedFeatureResult = run(process.execPath, [policyScript], sourceRoot, policyEnv({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_HEAD_REF: "codex/unrelated",
      GITHUB_BASE_REF: "dev",
    }));
    recordCase(
      results,
      "feature_without_dev_ancestry_fail",
      unrelatedFeatureResult,
      1,
      { branchSourceAncestor: false },
    );

    const unrelatedHotfixResult = run(process.execPath, [policyScript], sourceRoot, policyEnv({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_HEAD_REF: "hotfix/v0.7.1",
      GITHUB_BASE_REF: "main",
      AIDN_BRANCH_POLICY_VERSION: "0.7.1",
    }));
    recordCase(
      results,
      "hotfix_without_main_ancestry_fail",
      unrelatedHotfixResult,
      1,
      { branchSourceAncestor: false },
    );
    git(["checkout", "--quiet", "codex/fixture"], sourceRoot);

    git(["checkout", "--quiet", "--detach", candidateSha], clientRoot);
    const containmentResult = run(process.execPath, [policyScript], clientRoot, policyEnv({
      AIDN_BRANCH_POLICY_BASE_REF: "dev",
      AIDN_BRANCH_POLICY_EXPECTED_SHA: candidateSha,
      AIDN_BRANCH_POLICY_CONTAINS_REF: "origin/codex/fixture",
    }));
    recordCase(
      results,
      "detached_exact_sha_remote_containment_pass",
      containmentResult,
      0,
      { containmentProved: true, remoteRefExact: true },
    );

    git(["checkout", "--quiet", "--detach", devSha], clientRoot);
    const ancestorOnlyResult = run(process.execPath, [policyScript], clientRoot, policyEnv({
      AIDN_BRANCH_POLICY_BASE_REF: "dev",
      AIDN_BRANCH_POLICY_EXPECTED_SHA: devSha,
      AIDN_BRANCH_POLICY_CONTAINS_REF: "origin/codex/fixture",
    }));
    recordCase(
      results,
      "detached_ancestor_of_remote_ref_fail",
      ancestorOnlyResult,
      1,
      { containmentProved: true, remoteRefExact: false },
    );
    git(["checkout", "--quiet", "--detach", candidateSha], clientRoot);

    const missingRemoteResult = run(process.execPath, [policyScript], clientRoot, policyEnv({
      AIDN_BRANCH_POLICY_BASE_REF: "dev",
      AIDN_BRANCH_POLICY_EXPECTED_SHA: candidateSha,
      AIDN_BRANCH_POLICY_CONTAINS_REF: "origin/missing",
    }));
    recordCase(
      results,
      "detached_missing_remote_ref_fail",
      missingRemoteResult,
      1,
      { containmentProved: false },
    );

    const mismatchRemoteResult = run(process.execPath, [policyScript], clientRoot, policyEnv({
      AIDN_BRANCH_POLICY_BASE_REF: "dev",
      AIDN_BRANCH_POLICY_EXPECTED_SHA: candidateSha,
      AIDN_BRANCH_POLICY_CONTAINS_REF: "origin/dev",
    }));
    recordCase(
      results,
      "detached_remote_mismatch_fail",
      mismatchRemoteResult,
      1,
      { containmentProved: false },
    );

    const expectedMismatchResult = run(process.execPath, [policyScript], clientRoot, policyEnv({
      AIDN_BRANCH_POLICY_BASE_REF: "dev",
      AIDN_BRANCH_POLICY_EXPECTED_SHA: devSha,
      AIDN_BRANCH_POLICY_CONTAINS_REF: "origin/codex/fixture",
    }));
    recordCase(
      results,
      "detached_expected_sha_mismatch_fail",
      expectedMismatchResult,
      1,
      { containmentProved: true, remoteRefExact: true },
    );

    git(["checkout", "--quiet", "--detach", devSha], clientRoot);
    const mainPushResult = run(process.execPath, [policyScript], clientRoot, policyEnv({
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/main",
      AIDN_BRANCH_POLICY_EXPECTED_SHA: devSha,
      AIDN_BRANCH_POLICY_CONTAINS_REF: "origin/main",
    }));
    recordCase(
      results,
      "detached_main_push_remote_pass",
      mainPushResult,
      0,
      { containmentProved: true, remoteRefExact: true },
    );

    const localOnlyRoot = path.join(tempRoot, "local-only");
    fs.mkdirSync(localOnlyRoot, { recursive: true });
    git(["init", "--initial-branch=codex/local-only", "--quiet"], localOnlyRoot);
    git(["config", "user.name", "aidn-tests"], localOnlyRoot);
    git(["config", "user.email", "aidn-tests@example.invalid"], localOnlyRoot);
    fs.writeFileSync(path.join(localOnlyRoot, "fixture.txt"), "local only\n", "utf8");
    git(["add", "fixture.txt"], localOnlyRoot);
    git(["commit", "--quiet", "-m", "local-only fixture"], localOnlyRoot);
    const localOnlySha = git(["rev-parse", "HEAD"], localOnlyRoot);
    git(["checkout", "--quiet", "--detach", localOnlySha], localOnlyRoot);
    const localOnlyResult = run(process.execPath, [policyScript], localOnlyRoot, policyEnv({
      AIDN_BRANCH_POLICY_HEAD_REF: "codex/local-only",
      AIDN_BRANCH_POLICY_BASE_REF: "dev",
      AIDN_BRANCH_POLICY_EXPECTED_SHA: localOnlySha,
    }));
    recordCase(
      results,
      "detached_local_only_ref_fail",
      localOnlyResult,
      1,
      { containmentProved: false },
    );
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
