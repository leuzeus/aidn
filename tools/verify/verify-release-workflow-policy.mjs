#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import {
  classifyPublicationSource,
  provePublicationSource,
} from "../ci/prove-publication-source.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const workflowPath = ".github/workflows/release.yml";
const workflow = fs.readFileSync(path.join(repoRoot, workflowPath), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const fetchCommand = "node tools/ci/fetch-branch-policy-sources.mjs";
const publicationProofCommand = "node tools/ci/prove-publication-source.mjs";
const refusalScript = `VERSION="$(cat VERSION)"
TAG="v\${VERSION}"
if git ls-remote --exit-code --tags origin "refs/tags/\${TAG}" >/dev/null 2>&1; then
  echo "Tag \${TAG} already exists" >&2
  exit 1
fi
if gh release view "\${TAG}" >/dev/null 2>&1; then
  echo "GitHub Release \${TAG} already exists" >&2
  exit 1
fi
echo "value=\${VERSION}" >> "\${GITHUB_OUTPUT}"
echo "tag=\${TAG}" >> "\${GITHUB_OUTPUT}"`;
const publicationScript = `git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git tag -a "\${TAG}" "\${GITHUB_SHA}" -m "AIDN \${TAG}"
git push origin "refs/tags/\${TAG}"
gh release create "\${TAG}" \\
  "release/dist/aidn-workflow-\${VERSION}.zip" \\
  "release/checksums.txt" \\
  "release/manifest.json" \\
  --title "AIDN \${TAG}" \\
  --generate-notes \\
  --verify-tag`;

function parseWorkflow(candidate) {
  const document = parseDocument(candidate, {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    return {
      model: null,
      issues: document.errors.map((error) => (
        `release workflow YAML is invalid: ${String(error.message).replace(/\s+/gu, " ").trim()}`
      )),
    };
  }
  return { model: document.toJS(), issues: [] };
}

function sameSet(actual, expected) {
  return JSON.stringify([...new Set(actual ?? [])].sort())
    === JSON.stringify([...new Set(expected)].sort());
}

function namedStep(job, name) {
  const matches = (Array.isArray(job?.steps) ? job.steps : [])
    .filter((step) => step?.name === name);
  return matches.length === 1 ? matches[0] : null;
}

function exactRun(step, command) {
  return String(step?.run ?? "").trim() === command.trim();
}

function hasOwn(value, key) {
  return value != null && Object.prototype.hasOwnProperty.call(value, key);
}

function requireBlockingStep(step, label, issues, { expectedIf } = {}) {
  if (!step) return;
  if (expectedIf == null) {
    if (hasOwn(step, "if")) {
      issues.push(`${label} must not declare step.if`);
    }
  } else if (step.if !== expectedIf) {
    issues.push(`${label} must use exactly if: ${expectedIf}`);
  }
  if (hasOwn(step, "continue-on-error")) {
    issues.push(`${label} must not declare continue-on-error`);
  }
}

function mutateNamedStepProperty(candidate, name, property, value) {
  const marker = `      - name: ${name}\n`;
  if (!candidate.includes(marker)) {
    throw new Error(`unable to find workflow step for mutation: ${name}`);
  }
  return candidate.replace(marker, `${marker}        ${property}: ${value}\n`);
}

function mutateNamedJobProperty(candidate, name, property, value) {
  const marker = `  ${name}:\n`;
  if (!candidate.includes(marker)) {
    throw new Error(`unable to find workflow job for mutation: ${name}`);
  }
  return candidate.replace(marker, `${marker}    ${property}: ${value}\n`);
}

function evaluateWorkflow(candidate) {
  const parsed = parseWorkflow(candidate);
  if (!parsed.model) {
    return parsed.issues;
  }
  const issues = [];
  const { model } = parsed;
  if (!sameSet(model?.on?.pull_request?.branches, ["dev", "main"])) {
    issues.push("release verification must trigger on PRs to dev and main");
  }
  if (!sameSet(model?.on?.push?.branches, ["main"]) || model?.on?.push?.tags != null) {
    issues.push("release publication must trigger only on pushes to main");
  }
  const verifyJob = model?.jobs?.verify;
  const publishJob = model?.jobs?.publish;
  if (verifyJob?.if !== "${{ github.event_name == 'pull_request' }}") {
    issues.push("release verify job must be restricted to pull_request");
  }
  if (publishJob?.if
    !== "${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}") {
    issues.push("release publish job must be restricted to pushes on refs/heads/main");
  }
  if (hasOwn(verifyJob, "continue-on-error")) {
    issues.push("release verify job must not declare continue-on-error");
  }
  if (hasOwn(publishJob, "continue-on-error")) {
    issues.push("release publish job must not declare continue-on-error");
  }

  const fetchStep = namedStep(verifyJob, "Fetch Announced Remote Head");
  if (!fetchStep || !exactRun(fetchStep, fetchCommand)) {
    issues.push(`release verification must call only the canonical fetch helper: ${fetchCommand}`);
  }
  requireBlockingStep(fetchStep, "release verification fetch", issues);
  const verifyStep = namedStep(verifyJob, "Verify All Context Obligations Without Publishing");
  if (!verifyStep || !exactRun(verifyStep, "npm run verify:release")) {
    issues.push("release PR verify job must run only the complete verify:release aggregate");
  }
  requireBlockingStep(verifyStep, "release PR verify:release step", issues);
  const proofStep = namedStep(publishJob, "Prove Main And Merged Publication PR");
  if (!proofStep || !exactRun(proofStep, publicationProofCommand)) {
    issues.push(`release publication must call only the canonical proof helper: ${publicationProofCommand}`);
  }
  requireBlockingStep(proofStep, "release publication proof", issues);
  if (proofStep?.env?.GH_TOKEN !== "${{ github.token }}") {
    issues.push("publication-source proof must receive the scoped github.token");
  }
  const publicationVerificationStep = namedStep(
    publishJob,
    "Verify Version, Provenance, Topology, And Sensitivity",
  );
  if (!publicationVerificationStep
    || !exactRun(publicationVerificationStep, "npm run verify:release")) {
    issues.push("release publication must run only the complete verify:release aggregate");
  }
  requireBlockingStep(
    publicationVerificationStep,
    "release publication verify:release step",
    issues,
  );
  const buildStep = namedStep(publishJob, "Build Exact Main Commit");
  if (!buildStep
    || !exactRun(
      buildStep,
      "node tools/build-release.mjs --source-ref \"${GITHUB_SHA}\" --require-clean",
    )) {
    issues.push("release build must use the exact clean GITHUB_SHA");
  }
  requireBlockingStep(buildStep, "release build step", issues);
  const artifactStep = namedStep(publishJob, "Verify Built Checksums And Provenance");
  if (!artifactStep || !exactRun(artifactStep, "npm run perf:verify-release-artifacts")) {
    issues.push("release publication must verify built checksums and provenance");
  }
  requireBlockingStep(artifactStep, "release artifact verification step", issues);
  const refusalStep = namedStep(publishJob, "Refuse Existing Tag Or Release");
  if (!refusalStep || !exactRun(refusalStep, refusalScript)) {
    issues.push("tag/release refusal must match the canonical fail-closed script");
  }
  requireBlockingStep(refusalStep, "tag/release refusal step", issues);
  const createStep = namedStep(publishJob, "Create Annotated Tag And GitHub Release");
  if (!createStep || !exactRun(createStep, publicationScript)) {
    issues.push("annotated-tag and GitHub Release creation must match the canonical script");
  }
  requireBlockingStep(createStep, "tag and GitHub Release creation step", issues);
  const activeRuns = [
    ...(Array.isArray(verifyJob?.steps) ? verifyJob.steps : []),
    ...(Array.isArray(publishJob?.steps) ? publishJob.steps : []),
  ].map((step) => String(step?.run ?? "")).join("\n");
  if (/\bnpm\s+publish\b/u.test(activeRuns)) {
    issues.push("release workflow must never run npm publish");
  }
  return issues;
}

function pullRequest(branch, {
  base = "main",
  mergedAt = "2026-07-27T00:00:00Z",
  mergeCommitSha = "a".repeat(40),
} = {}) {
  return {
    base: { ref: base },
    head: { ref: branch },
    merged_at: mergedAt,
    merge_commit_sha: mergeCommitSha,
  };
}

async function evaluateHelperBehavior() {
  const issues = [];
  const cases = [];
  const version = "0.7.0";
  const sha = "a".repeat(40);
  const scenarios = [
    {
      name: "exact_release_pass",
      pullRequests: [pullRequest("release/v0.7.0")],
      expectedKind: "release",
    },
    {
      name: "exact_hotfix_pass",
      pullRequests: [pullRequest("hotfix/v0.7.0")],
      expectedKind: "hotfix",
    },
    { name: "zero_merged_main_pr_fail", pullRequests: [], expectedError: true },
    {
      name: "ambiguous_merged_main_pr_fail",
      pullRequests: [
        pullRequest("release/v0.7.0"),
        pullRequest("hotfix/v0.7.0"),
      ],
      expectedError: true,
    },
    {
      name: "unmerged_pr_fail",
      pullRequests: [pullRequest("release/v0.7.0", { mergedAt: null })],
      expectedError: true,
    },
    {
      name: "wrong_base_fail",
      pullRequests: [pullRequest("release/v0.7.0", { base: "dev" })],
      expectedError: true,
    },
    {
      name: "foreign_branch_fail",
      pullRequests: [pullRequest("feature/not-release")],
      expectedError: true,
    },
    {
      name: "hotfix_lookalike_fail",
      pullRequests: [pullRequest("hotfix/v0.7.0-extra")],
      expectedError: true,
    },
    {
      name: "version_mismatched_release_fail",
      pullRequests: [pullRequest("release/v0.7.1")],
      expectedError: true,
    },
    {
      name: "associated_pr_merge_sha_mismatch_fail",
      pullRequests: [
        pullRequest("release/v0.7.0", { mergeCommitSha: "b".repeat(40) }),
      ],
      expectedError: true,
    },
  ];
  for (const scenario of scenarios) {
    let result = null;
    let error = null;
    try {
      result = classifyPublicationSource({
        pullRequests: scenario.pullRequests,
        version,
        githubSha: sha,
      });
    } catch (caught) {
      error = caught;
    }
    const passed = scenario.expectedError
      ? Boolean(error)
      : !error && result?.kind === scenario.expectedKind;
    if (!passed) {
      issues.push(`${scenario.name}: publication-source classification did not fail closed`);
    }
    cases.push({
      name: scenario.name,
      status: passed ? (scenario.expectedError ? "EXPECTED_FAIL" : "PASS") : "FAIL",
    });
  }

  const gitCalls = [];
  let requestedUrl = "";
  let output = "";
  const proofResult = await provePublicationSource({
    env: {
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: sha,
      GITHUB_REPOSITORY: "fixture/aidn",
      GITHUB_API_URL: "https://api.github.invalid",
      GITHUB_OUTPUT: "fixture-output",
      GH_TOKEN: "fixture-token",
    },
    runGit(args) {
      gitCalls.push(args);
      if (args[0] === "rev-parse") return sha;
      if (args[0] === "status") return "";
      return "";
    },
    readFile: () => "0.7.0\n",
    appendFile: (_path, content) => {
      output += content;
    },
    request: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => [pullRequest("release/v0.7.0")],
      };
    },
  });
  const expectedGitCalls = [
    ["fetch", "--no-tags", "origin", "main"],
    ["rev-parse", "HEAD"],
    ["rev-parse", "origin/main"],
    ["status", "--porcelain=v1", "--untracked-files=all"],
  ];
  const proofPassed = proofResult.kind === "release"
    && JSON.stringify(gitCalls) === JSON.stringify(expectedGitCalls)
    && requestedUrl.endsWith(`/repos/fixture/aidn/commits/${sha}/pulls?per_page=100`)
    && output === "kind=release\nbranch=release/v0.7.0\n";
  if (!proofPassed) {
    issues.push("publication helper did not prove exact ref/SHA/API/cleanliness/output plumbing");
  }
  cases.push({
    name: "publication_helper_plumbing_pass",
    status: proofPassed ? "PASS" : "FAIL",
  });

  const baseProofOptions = {
    env: {
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: sha,
      GITHUB_REPOSITORY: "fixture/aidn",
      GITHUB_API_URL: "https://api.github.invalid",
      GITHUB_OUTPUT: "fixture-output",
      GH_TOKEN: "fixture-token",
    },
    readFile: () => "0.7.0\n",
    appendFile: () => {},
    request: async () => ({
      ok: true,
      status: 200,
      json: async () => [pullRequest("release/v0.7.0")],
    }),
  };
  const proofFailureScenarios = [
    {
      name: "publication_wrong_ref_fail",
      options: {
        ...baseProofOptions,
        env: { ...baseProofOptions.env, GITHUB_REF: "refs/heads/dev" },
        runGit: () => "",
      },
    },
    {
      name: "publication_sha_mismatch_fail",
      options: {
        ...baseProofOptions,
        runGit: (args) => (args[0] === "rev-parse" ? "b".repeat(40) : ""),
      },
    },
    {
      name: "publication_dirty_checkout_fail",
      options: {
        ...baseProofOptions,
        runGit: (args) => {
          if (args[0] === "rev-parse") return sha;
          if (args[0] === "status") return "?? untracked";
          return "";
        },
      },
    },
    {
      name: "publication_api_failure_fail",
      options: {
        ...baseProofOptions,
        runGit: (args) => (args[0] === "rev-parse" ? sha : ""),
        request: async () => ({ ok: false, status: 503 }),
      },
    },
  ];
  for (const scenario of proofFailureScenarios) {
    let rejected = false;
    try {
      await provePublicationSource(scenario.options);
    } catch {
      rejected = true;
    }
    if (!rejected) {
      issues.push(`${scenario.name}: publication helper did not fail closed`);
    }
    cases.push({
      name: scenario.name,
      status: rejected ? "EXPECTED_FAIL" : "FAIL",
    });
  }
  return { issues, cases };
}

const helperBehavior = await evaluateHelperBehavior();
const issues = [...evaluateWorkflow(workflow), ...helperBehavior.issues];
if (packageJson.scripts?.["verify:release"]
  !== "node tools/verify/run-gate-family.mjs obligations") {
  issues.push("verify:release must execute every contextual catalog obligation");
}

function candidateRejected(candidate) {
  return evaluateWorkflow(candidate).length > 0;
}

const negativeProbes = {
  dormant_publication_helper_rejected: candidateRejected(workflow.replace(
    `        run: ${publicationProofCommand}`,
    "        run: |\n"
      + "          if false; then\n"
      + `            ${publicationProofCommand}\n`
      + "          fi\n"
      + "          echo bypassed",
  )),
  dormant_fetch_helper_rejected: candidateRejected(workflow.replace(
    `        run: ${fetchCommand}`,
    "        run: |\n"
      + "          if false; then\n"
      + `            ${fetchCommand}\n`
      + "          fi",
  )),
  release_fetch_if_false_rejected: candidateRejected(mutateNamedStepProperty(
    workflow,
    "Fetch Announced Remote Head",
    "if",
    "${{ false }}",
  )),
  release_fetch_continue_on_error_rejected: candidateRejected(mutateNamedStepProperty(
    workflow,
    "Fetch Announced Remote Head",
    "continue-on-error",
    "true",
  )),
  publication_proof_if_false_rejected: candidateRejected(mutateNamedStepProperty(
    workflow,
    "Prove Main And Merged Publication PR",
    "if",
    "${{ false }}",
  )),
  publication_proof_continue_on_error_rejected: candidateRejected(mutateNamedStepProperty(
    workflow,
    "Prove Main And Merged Publication PR",
    "continue-on-error",
    "true",
  )),
  release_verify_job_continue_on_error_rejected: candidateRejected(mutateNamedJobProperty(
    workflow,
    "verify",
    "continue-on-error",
    "true",
  )),
  release_publish_job_continue_on_error_rejected: candidateRejected(mutateNamedJobProperty(
    workflow,
    "publish",
    "continue-on-error",
    "true",
  )),
  release_pr_aggregate_if_false_rejected: candidateRejected(mutateNamedStepProperty(
    workflow,
    "Verify All Context Obligations Without Publishing",
    "if",
    "${{ false }}",
  )),
  release_pr_aggregate_continue_on_error_rejected: candidateRejected(mutateNamedStepProperty(
    workflow,
    "Verify All Context Obligations Without Publishing",
    "continue-on-error",
    "true",
  )),
  publication_aggregate_if_false_rejected: candidateRejected(mutateNamedStepProperty(
    workflow,
    "Verify Version, Provenance, Topology, And Sensitivity",
    "if",
    "${{ false }}",
  )),
  publication_aggregate_continue_on_error_rejected: candidateRejected(
    mutateNamedStepProperty(
      workflow,
      "Verify Version, Provenance, Topology, And Sensitivity",
      "continue-on-error",
      "true",
    ),
  ),
  tag_release_refusal_if_false_rejected: candidateRejected(mutateNamedStepProperty(
    workflow,
    "Refuse Existing Tag Or Release",
    "if",
    "${{ false }}",
  )),
  tag_release_refusal_continue_on_error_rejected: candidateRejected(
    mutateNamedStepProperty(
      workflow,
      "Refuse Existing Tag Or Release",
      "continue-on-error",
      "true",
    ),
  ),
  release_build_if_false_rejected: candidateRejected(mutateNamedStepProperty(
    workflow,
    "Build Exact Main Commit",
    "if",
    "${{ false }}",
  )),
  release_build_continue_on_error_rejected: candidateRejected(mutateNamedStepProperty(
    workflow,
    "Build Exact Main Commit",
    "continue-on-error",
    "true",
  )),
  artifact_verification_if_false_rejected: candidateRejected(mutateNamedStepProperty(
    workflow,
    "Verify Built Checksums And Provenance",
    "if",
    "${{ false }}",
  )),
  artifact_verification_continue_on_error_rejected: candidateRejected(
    mutateNamedStepProperty(
      workflow,
      "Verify Built Checksums And Provenance",
      "continue-on-error",
      "true",
    ),
  ),
  tag_release_creation_if_false_rejected: candidateRejected(mutateNamedStepProperty(
    workflow,
    "Create Annotated Tag And GitHub Release",
    "if",
    "${{ false }}",
  )),
  tag_release_creation_continue_on_error_rejected: candidateRejected(
    mutateNamedStepProperty(
      workflow,
      "Create Annotated Tag And GitHub Release",
      "continue-on-error",
      "true",
    ),
  ),
  ambiguous_main_pr_logic_rejected: helperBehavior.cases
    .some((item) => item.name === "ambiguous_merged_main_pr_fail"
      && item.status === "EXPECTED_FAIL"),
  hotfix_lookalike_rejected: helperBehavior.cases
    .some((item) => item.name === "hotfix_lookalike_fail"
      && item.status === "EXPECTED_FAIL"),
  associated_pr_merge_sha_mismatch_rejected: helperBehavior.cases
    .some((item) => item.name === "associated_pr_merge_sha_mismatch_fail"
      && item.status === "EXPECTED_FAIL"),
  npm_publish_rejected: candidateRejected(workflow.replace(
    "        run: npm run perf:verify-release-artifacts",
    "        run: |\n"
      + "          npm run perf:verify-release-artifacts\n"
      + "          npm publish",
  )),
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
  publish_trigger:
    "push main after one exact version-matched release/* or hotfix/* PR "
    + "whose merge_commit_sha equals GITHUB_SHA",
  npm_publish: false,
  verification_selector: "catalog obligations",
  publication_sources: ["release/vX.Y.Z", "hotfix/vX.Y.Z"],
  helper_behavior: helperBehavior.cases,
  negative_probes: negativeProbes,
  issues,
};
console.log(JSON.stringify(output, null, 2));
if (!output.ok) process.exitCode = 1;
