#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const workflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "release.yml"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

const requiredTokens = [
  "pull_request:",
  "branches: [dev, main]",
  "push:",
  "github.event_name == 'pull_request'",
  "github.event_name == 'push' && github.ref == 'refs/heads/main'",
  "EXPECTED_RELEASE_BRANCH=\"release/v${VERSION}\"",
  "EXPECTED_HOTFIX_BRANCH=\"hotfix/v${VERSION}\"",
  "MERGED_MAIN_PR_COUNT",
  "test \"${MERGED_MAIN_PR_COUNT}\" = \"1\"",
  "SOURCE_KIND=\"release\"",
  "SOURCE_KIND=\"hotfix\"",
  "+refs/heads/dev:refs/remotes/origin/dev",
  "+refs/heads/main:refs/remotes/origin/main",
  "GITHUB_SHA",
  "git status --porcelain=v1",
  "npm run verify:release",
  "AIDN_BRANCH_POLICY_EXPECTED_SHA",
  "AIDN_BRANCH_POLICY_CONTAINS_REF",
  "--require-clean",
  "git tag -a",
  "gh release create",
  "git ls-remote --exit-code --tags",
];

function evaluateWorkflow(candidate) {
  const candidateIssues = [];
  for (const token of requiredTokens) {
    if (!candidate.includes(token)) {
      candidateIssues.push(`release workflow missing: ${token}`);
    }
  }
  if (/\bnpm\s+publish\b/.test(candidate)) {
    candidateIssues.push("release workflow must never run npm publish");
  }
  if (/refs\/tags\/v\*/.test(candidate) || /^\s+tags:/m.test(candidate)) {
    candidateIssues.push("release publication must not be triggered by a pre-created tag");
  }
  const verifyBlock = candidate.split(/\n  publish:\n/)[0] ?? "";
  if (!verifyBlock.includes("branches: [dev, main]")) {
    candidateIssues.push(
      "release verification must run for feature PRs to dev and publication PRs to main",
    );
  }
  if (/gh release create|git tag -a/.test(verifyBlock)) {
    candidateIssues.push("release PR verify job must not tag or publish");
  }
  return candidateIssues;
}

const issues = evaluateWorkflow(workflow);
if (!String(packageJson.scripts?.["verify:release"] ?? "").includes("run-gate-family.mjs obligations")) {
  issues.push("verify:release must execute every contextual catalog obligation");
}

const negativeProbes = {
  missing_hotfix_route_rejected: evaluateWorkflow(workflow.replace(
    "EXPECTED_HOTFIX_BRANCH=\"hotfix/v${VERSION}\"",
    "EXPECTED_HOTFIX_BRANCH=\"release/v${VERSION}\"",
  )).length > 0,
  ambiguous_main_pr_count_rejected: evaluateWorkflow(workflow.replace(
    "test \"${MERGED_MAIN_PR_COUNT}\" = \"1\"",
    "test \"${MERGED_MAIN_PR_COUNT}\" -ge \"1\"",
  )).length > 0,
  npm_publish_rejected: evaluateWorkflow(`${workflow}\n# npm publish\n`).length > 0,
};
for (const [probe, rejected] of Object.entries(negativeProbes)) {
  if (!rejected) {
    issues.push(`release workflow negative probe accepted: ${probe}`);
  }
}

const output = {
  ok: issues.length === 0,
  status: issues.length === 0 ? "PASS" : "FAIL",
  workflow: ".github/workflows/release.yml",
  publish_trigger: "push main after one exact version-matched release/* or hotfix/* PR",
  npm_publish: false,
  verification_selector: "catalog obligations",
  publication_sources: ["release/vX.Y.Z", "hotfix/vX.Y.Z"],
  negative_probes: negativeProbes,
  issues,
};
console.log(JSON.stringify(output, null, 2));
if (!output.ok) process.exitCode = 1;
