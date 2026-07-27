#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const workflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "release.yml"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const issues = [];

const requiredTokens = [
  "pull_request:",
  "branches: [dev, main]",
  "push:",
  "github.event_name == 'pull_request'",
  "github.event_name == 'push' && github.ref == 'refs/heads/main'",
  "startswith(\"release/\")",
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
for (const token of requiredTokens) {
  if (!workflow.includes(token)) issues.push(`release workflow missing: ${token}`);
}
if (/\bnpm\s+publish\b/.test(workflow)) issues.push("release workflow must never run npm publish");
if (/refs\/tags\/v\*/.test(workflow) || /^\s+tags:/m.test(workflow)) {
  issues.push("release publication must not be triggered by a pre-created tag");
}
const verifyBlock = workflow.split(/\n  publish:\n/)[0] ?? "";
if (!verifyBlock.includes("branches: [dev, main]")) {
  issues.push("release verification must run for feature PRs to dev and release PRs to main");
}
if (/gh release create|git tag -a/.test(verifyBlock)) {
  issues.push("release PR verify job must not tag or publish");
}
if (!String(packageJson.scripts?.["verify:release"] ?? "").includes("run-gate-family.mjs obligations")) {
  issues.push("verify:release must execute every contextual catalog obligation");
}
const output = {
  ok: issues.length === 0,
  status: issues.length === 0 ? "PASS" : "FAIL",
  workflow: ".github/workflows/release.yml",
  publish_trigger: "push main after one merged release/* PR",
  npm_publish: false,
  verification_selector: "catalog obligations",
  issues,
};
console.log(JSON.stringify(output, null, 2));
if (!output.ok) process.exitCode = 1;
