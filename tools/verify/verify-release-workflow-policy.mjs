#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const workflowPath = ".github/workflows/release.yml";
const workflow = fs.readFileSync(path.join(repoRoot, workflowPath), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

function activeShell(script) {
  return String(script ?? "")
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

function sameSet(actual, expected) {
  return JSON.stringify([...new Set(actual ?? [])].sort())
    === JSON.stringify([...new Set(expected)].sort());
}

function exactLineCount(script, expected) {
  return activeShell(script)
    .split("\n")
    .filter((line) => line.trim() === expected)
    .length;
}

function evaluateWorkflow(candidate) {
  const candidateIssues = [];
  const document = parseDocument(candidate, {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    return document.errors.map((error) => (
      `release workflow YAML is invalid: ${String(error.message).replace(/\s+/gu, " ").trim()}`
    ));
  }
  const model = document.toJS();
  if (!sameSet(model?.on?.pull_request?.branches, ["dev", "main"])) {
    candidateIssues.push("release verification must trigger on PRs to dev and main");
  }
  if (!sameSet(model?.on?.push?.branches, ["main"])) {
    candidateIssues.push("release publication must trigger only on pushes to main");
  }
  const verifyJob = model?.jobs?.verify;
  const publishJob = model?.jobs?.publish;
  if (verifyJob?.if !== "${{ github.event_name == 'pull_request' }}") {
    candidateIssues.push("release verify job must be restricted to pull_request");
  }
  if (publishJob?.if
    !== "${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}") {
    candidateIssues.push("release publish job must be restricted to pushes on refs/heads/main");
  }
  const verifySteps = Array.isArray(verifyJob?.steps) ? verifyJob.steps : [];
  const publishSteps = Array.isArray(publishJob?.steps) ? publishJob.steps : [];
  if (!verifySteps.some((step) => String(step?.run ?? "").trim() === "npm run verify:release")) {
    candidateIssues.push("release PR verify job must run the complete verify:release aggregate");
  }
  const verifyScripts = verifySteps.map((step) => activeShell(step?.run)).join("\n");
  for (const sourceRef of [
    "+refs/heads/dev:refs/remotes/origin/dev",
    "+refs/heads/main:refs/remotes/origin/main",
  ]) {
    if (!verifyScripts.includes(sourceRef)) {
      candidateIssues.push(`release verification must fetch provenance source ${sourceRef}`);
    }
  }

  const publicationSourceSteps = publishSteps.filter(
    (step) => step?.name === "Prove Main And Merged Publication PR",
  );
  if (publicationSourceSteps.length !== 1) {
    candidateIssues.push("release publish job must have exactly one publication-source proof step");
  }
  const publicationScript = activeShell(publicationSourceSteps[0]?.run);
  for (const line of [
    "test \"${GITHUB_REF}\" = \"refs/heads/main\"",
    "test \"$(git rev-parse HEAD)\" = \"${GITHUB_SHA}\"",
    "test \"$(git rev-parse origin/main)\" = \"${GITHUB_SHA}\"",
    "EXPECTED_RELEASE_BRANCH=\"release/v${VERSION}\"",
    "EXPECTED_HOTFIX_BRANCH=\"hotfix/v${VERSION}\"",
    "MERGED_MAIN_PR_COUNT=\"$(jq 'length' <<<\"${MERGED_MAIN_PRS_JSON}\")\"",
    "test \"${MERGED_MAIN_PR_COUNT}\" = \"1\"",
    "SOURCE_BRANCH=\"$(jq -r '.[0].head.ref' <<<\"${MERGED_MAIN_PRS_JSON}\")\"",
    "test -z \"$(git status --porcelain=v1 --untracked-files=all)\"",
  ]) {
    if (exactLineCount(publicationScript, line) !== 1) {
      candidateIssues.push(`publication-source proof requires one active line: ${line}`);
    }
  }
  if (!publicationScript.includes(
    "select(.base.ref == \"main\" and .merged_at != null)",
  )) {
    candidateIssues.push("publication-source proof must select merged PRs targeting main");
  }
  const sourceCase = publicationScript.match(
    /case\s+"\$\{SOURCE_BRANCH\}"\s+in([\s\S]*?)\besac\b/u,
  )?.[1] ?? "";
  if (!/"\$\{EXPECTED_RELEASE_BRANCH\}"\)\s*\n\s*SOURCE_KIND="release"/u.test(sourceCase)) {
    candidateIssues.push("publication-source case must actively classify the exact release branch");
  }
  if (!/"\$\{EXPECTED_HOTFIX_BRANCH\}"\)\s*\n\s*SOURCE_KIND="hotfix"/u.test(sourceCase)) {
    candidateIssues.push("publication-source case must actively classify the exact hotfix branch");
  }
  if (!/\*\)\s*\n[\s\S]*?exit 1/u.test(sourceCase)) {
    candidateIssues.push("publication-source case must fail closed for every other branch");
  }

  const publishScripts = publishSteps.map((step) => activeShell(step?.run)).join("\n");
  if (/\bnpm\s+publish\b/u.test(publishScripts)) {
    candidateIssues.push("release workflow must never run npm publish");
  }
  if (/refs\/tags\/v\*/u.test(publishScripts) || model?.on?.push?.tags != null) {
    candidateIssues.push("release publication must not be triggered by a pre-created tag");
  }
  for (const invariant of [
    "npm run verify:release",
    "node tools/build-release.mjs --source-ref \"${GITHUB_SHA}\" --require-clean",
    "npm run perf:verify-release-artifacts",
    "git ls-remote --exit-code --tags origin \"refs/tags/${TAG}\"",
    "git tag -a \"${TAG}\" \"${GITHUB_SHA}\" -m \"AIDN ${TAG}\"",
    "gh release create \"${TAG}\"",
  ]) {
    if (!publishScripts.includes(invariant)) {
      candidateIssues.push(`release publish job missing active invariant: ${invariant}`);
    }
  }
  if (/\bgh\s+release\s+create\b|\bgit\s+tag\s+-a\b/u.test(verifyScripts)) {
    candidateIssues.push("release PR verify job must not tag or publish");
  }
  return candidateIssues;
}

const issues = evaluateWorkflow(workflow);
if (!String(packageJson.scripts?.["verify:release"] ?? "").includes("run-gate-family.mjs obligations")) {
  issues.push("verify:release must execute every contextual catalog obligation");
}

const negativeProbes = {
  comment_only_hotfix_route_rejected: evaluateWorkflow(workflow.replace(
    "            \"${EXPECTED_HOTFIX_BRANCH}\")",
    "            \"__disabled_hotfix__\")\n"
      + "              # \"${EXPECTED_HOTFIX_BRANCH}\")",
  )).length > 0,
  comment_only_ambiguous_main_pr_count_rejected: evaluateWorkflow(workflow.replace(
    "test \"${MERGED_MAIN_PR_COUNT}\" = \"1\"",
    "test \"${MERGED_MAIN_PR_COUNT}\" -ge \"1\"\n"
      + "          # test \"${MERGED_MAIN_PR_COUNT}\" = \"1\"",
  )).length > 0,
  npm_publish_rejected: evaluateWorkflow(workflow.replace(
    "        run: npm run perf:verify-release-artifacts",
    "        run: |\n"
      + "          npm run perf:verify-release-artifacts\n"
      + "          npm publish",
  )).length > 0,
};
for (const [probe, rejected] of Object.entries(negativeProbes)) {
  if (!rejected) {
    issues.push(`release workflow negative probe accepted: ${probe}`);
  }
}

const output = {
  ok: issues.length === 0,
  status: issues.length === 0 ? "PASS" : "FAIL",
  workflow: workflowPath,
  publish_trigger: "push main after one exact version-matched release/* or hotfix/* PR",
  npm_publish: false,
  verification_selector: "catalog obligations",
  publication_sources: ["release/vX.Y.Z", "hotfix/vX.Y.Z"],
  negative_probes: negativeProbes,
  issues,
};
console.log(JSON.stringify(output, null, 2));
if (!output.ok) process.exitCode = 1;
