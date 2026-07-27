#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import {
  loadWorkflowSources,
  parseWorkflowStructure,
  validateGateAndWorkflowPolicy,
  validateWorkflowYamlSyntax,
} from "./workflow-policy-lib.mjs";
import {
  branchSourceRefspecs,
  fetchBranchPolicySources,
} from "../ci/fetch-branch-policy-sources.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const catalogPath = path.join(repoRoot, "package", "catalogs", "gates.v1.json");
const packagePath = path.join(repoRoot, "package.json");
const packageLockPath = path.join(repoRoot, "package-lock.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const workflowSources = loadWorkflowSources(repoRoot);
const workflowModels = workflowSources.map(({ path: relativePath, text }) => (
  parseWorkflowStructure(text, relativePath)
));
const issues = [];
const families = new Set();
let packageLock = null;

const workflowSyntaxResults = workflowSources.map(({ path: relativePath, text }) => ({
  path: relativePath,
  issues: validateWorkflowYamlSyntax(text, relativePath),
}));
for (const result of workflowSyntaxResults) {
  issues.push(...result.issues);
}

try {
  packageLock = JSON.parse(fs.readFileSync(packageLockPath, "utf8"));
} catch (error) {
  issues.push(`package-lock.json: locked dependency graph is missing or invalid (${error.message})`);
}

if (packageLock) {
  if (!Number.isInteger(packageLock.lockfileVersion) || packageLock.lockfileVersion < 3) {
    issues.push("package-lock.json: lockfileVersion must be at least 3");
  }
  const declaredPg = packageJson.optionalDependencies?.pg;
  const lockedDeclaration = packageLock.packages?.[""]?.optionalDependencies?.pg;
  if (!declaredPg || lockedDeclaration !== declaredPg) {
    issues.push("package-lock.json: root pg optional dependency must match package.json");
  }
  const lockedPg = packageLock.packages?.["node_modules/pg"];
  if (!lockedPg?.version || !lockedPg?.integrity || lockedPg.optional !== true) {
    issues.push("package-lock.json: pg must be integrity-locked as an optional dependency");
  }
  const declaredYaml = packageJson.devDependencies?.yaml;
  const lockedYamlDeclaration = packageLock.packages?.[""]?.devDependencies?.yaml;
  if (!/^\d+\.\d+\.\d+$/u.test(String(declaredYaml ?? ""))
    || lockedYamlDeclaration !== declaredYaml) {
    issues.push("package-lock.json: root yaml dev dependency must be an exact matching version");
  }
  const lockedYaml = packageLock.packages?.["node_modules/yaml"];
  if (lockedYaml?.version !== declaredYaml
    || !lockedYaml?.integrity
    || lockedYaml.dev !== true) {
    issues.push("package-lock.json: yaml must be integrity-locked as an exact dev dependency");
  }
}

function clone(value) {
  return structuredClone(value);
}

function replaceWorkflowSource(sources, relativePath, text) {
  return sources.map((source) => source.path === relativePath
    ? { path: relativePath, text }
    : source);
}

function candidateRejected({
  candidateCatalog = catalog,
  candidatePackageJson = packageJson,
  candidateWorkflowSources = workflowSources,
}) {
  const syntaxIssues = candidateWorkflowSources.flatMap((source) => (
    validateWorkflowYamlSyntax(source.text, source.path)
  ));
  const candidateWorkflowModels = candidateWorkflowSources.map((source) => (
    parseWorkflowStructure(source.text, source.path)
  ));
  return validateGateAndWorkflowPolicy({
    catalog: candidateCatalog,
    packageJson: candidatePackageJson,
    workflowModels: candidateWorkflowModels,
  }).length > 0 || syntaxIssues.length > 0;
}

if (catalog.schema_version !== 2) {
  issues.push("gate catalog schema_version must be 2");
}
if (JSON.stringify(catalog.outcomes) !== JSON.stringify(["PASS", "FAIL", "SKIP"])) {
  issues.push("outcomes must be exactly PASS, FAIL, SKIP");
}
for (const gate of catalog.gates ?? []) {
  families.add(gate.family);
  for (const field of ["id", "family", "script", "job", "surfaces", "condition", "obligation"]) {
    if (gate[field] == null || gate[field] === "") {
      issues.push(`${gate.id ?? "unknown"}: missing ${field}`);
    }
  }
  if (!Array.isArray(gate.surfaces) || gate.surfaces.length === 0) {
    issues.push(`${gate.id}: surfaces must be non-empty`);
  }
  if (!catalog.condition_values?.includes(gate.condition)) {
    issues.push(`${gate.id}: invalid condition ${gate.condition}`);
  }
  for (const context of ["dev", "main", "release"]) {
    if (!catalog.obligation_values?.includes(gate.obligation?.[context])) {
      issues.push(`${gate.id}: invalid ${context} obligation`);
    }
  }
}
for (const family of catalog.required_families ?? []) {
  if (!families.has(family)) {
    issues.push(`required family missing: ${family}`);
  }
  if (!packageJson.scripts?.[`verify:${family}`]) {
    issues.push(`stable wrapper missing: verify:${family}`);
  }
}
for (const wrapper of [
  "verify:contracts",
  "verify:governance",
  "verify:runtime",
  "verify:codex",
  "verify:release",
  "verify:all",
]) {
  if (!packageJson.scripts?.[wrapper]) {
    issues.push(`required stable wrapper missing: ${wrapper}`);
  }
}
if (packageJson.scripts?.["verify:release"]
  !== "node tools/verify/run-gate-family.mjs obligations") {
  issues.push("verify:release must execute contextual catalog obligations");
}
issues.push(...validateGateAndWorkflowPolicy({
  catalog,
  packageJson,
  workflowModels,
}));

const releasePath = ".github/workflows/release.yml";
const releaseText = fs.readFileSync(path.join(repoRoot, releasePath), "utf8");
const releaseModel = workflowModels.find((item) => item.path === releasePath);
const releaseCommands = Object.values(releaseModel?.jobs ?? {})
  .flatMap((job) => job.commands);
if (releaseCommands.includes("npm:publish") || /\bnpm\s+publish\b/.test(releaseText)) {
  issues.push("release workflow must never run npm publish");
}
for (const requiredToken of [
  "GITHUB_SHA",
  "git tag -a",
  "gh release create",
  "release/checksums.txt",
  "perf:verify-release-artifacts",
]) {
  if (!releaseText.includes(requiredToken)) {
    issues.push(`release workflow missing publication invariant: ${requiredToken}`);
  }
}

const weakenedCatalog = clone(catalog);
weakenedCatalog.gates.find((gate) => gate.id === "cleanliness-worktree").obligation.dev = "skip";
weakenedCatalog.gates.find((gate) => gate.id === "cleanliness-worktree").obligation.main = "skip";
weakenedCatalog.gates.find((gate) => gate.id === "cleanliness-worktree").obligation.release = "skip";

const selfCancellingCleanlinessCatalog = clone(catalog);
selfCancellingCleanlinessCatalog.gates.find((gate) => gate.id === "cleanliness-worktree").condition
  = "git-clean-worktree";

const substitutedScriptCatalog = clone(catalog);
substitutedScriptCatalog.gates.find((gate) => gate.id === "runtime-db-runtime-cli").script
  = "perf:verify-db-schema-migrations";

const devTriggerCommentMutation = releaseText.replace(
  "branches: [dev, main]",
  "branches: [main]\n    # branches: [dev, main]",
);
const commandCommentMutation = releaseText.replaceAll(
  "run: npm run verify:release",
  "run: npm run perf:verify-release-version\n        # run: npm run verify:release",
);
const missingJobMutation = releaseText.replace("  verify:\n", "  verify_removed:\n");
const duplicateJobMutation = `${releaseText}\n  verify:\n    runs-on: ubuntu-latest\n    steps: []\n`;

const architecturePath = ".github/workflows/architecture-gates.yml";
const architectureText = fs.readFileSync(path.join(repoRoot, architecturePath), "utf8");
const canonicalBranchFetchCommand = "node tools/ci/fetch-branch-policy-sources.mjs";
function hasOwn(value, key) {
  return value != null && Object.prototype.hasOwnProperty.call(value, key);
}

function mutateNamedStepProperty(source, name, property, value) {
  const marker = `      - name: ${name}\n`;
  if (!source.includes(marker)) {
    throw new Error(`unable to find workflow step for mutation: ${name}`);
  }
  return source.replace(marker, `${marker}        ${property}: ${value}\n`);
}

function mutateNamedJobProperty(source, name, property, value) {
  const marker = `  ${name}:\n`;
  if (!source.includes(marker)) {
    throw new Error(`unable to find workflow job for mutation: ${name}`);
  }
  return source.replace(marker, `${marker}    ${property}: ${value}\n`);
}

function evaluateArchitectureBranchSourceFetch(source) {
  const sourceIssues = [];
  const document = parseDocument(source, {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    return document.errors.map((error) => (
      `${architecturePath}: invalid YAML while evaluating branch-source fetch `
      + `(${String(error.message).replace(/\s+/gu, " ").trim()})`
    ));
  }
  const model = document.toJS();
  const cleanlinessJob = model.jobs?.cleanliness;
  if (hasOwn(cleanlinessJob, "if")) {
    sourceIssues.push("architecture cleanliness job must not declare job.if");
  }
  if (hasOwn(cleanlinessJob, "continue-on-error")) {
    sourceIssues.push("architecture cleanliness job must not declare continue-on-error");
  }
  const fetchSteps = cleanlinessJob?.steps?.filter(
    (step) => step.name === "Fetch Announced Remote Head",
  ) ?? [];
  if (fetchSteps.length !== 1
    || String(fetchSteps[0].run ?? "").trim() !== canonicalBranchFetchCommand) {
    sourceIssues.push(
      `architecture branch gate must call only the canonical provenance helper: `
      + canonicalBranchFetchCommand,
    );
  }
  const fetchStep = fetchSteps.length === 1 ? fetchSteps[0] : null;
  if (fetchStep?.if !== "${{ github.event_name == 'pull_request' }}") {
    sourceIssues.push(
      "architecture branch-source fetch must use exactly "
      + "if: ${{ github.event_name == 'pull_request' }}",
    );
  }
  if (hasOwn(fetchStep, "continue-on-error")) {
    sourceIssues.push("architecture branch-source fetch must not declare continue-on-error");
  }
  const cleanlinessSteps = cleanlinessJob?.steps?.filter(
    (step) => step.name === "Verify Cleanliness With Remote Provenance",
  ) ?? [];
  const cleanlinessStep = cleanlinessSteps.length === 1 ? cleanlinessSteps[0] : null;
  if (cleanlinessSteps.length !== 1
    || String(cleanlinessStep?.run ?? "").trim() !== "npm run verify:cleanliness") {
    sourceIssues.push(
      "architecture branch gate must run exactly one blocking verify:cleanliness step",
    );
  }
  if (hasOwn(cleanlinessStep, "if")) {
    sourceIssues.push("architecture verify:cleanliness step must not declare step.if");
  }
  if (hasOwn(cleanlinessStep, "continue-on-error")) {
    sourceIssues.push("architecture verify:cleanliness step must not declare continue-on-error");
  }
  return sourceIssues;
}
issues.push(...evaluateArchitectureBranchSourceFetch(architectureText));
const capturedFetchCalls = [];
const fetchHelperResult = fetchBranchPolicySources({
  headRef: "codex/governance-probe",
  runGit(args) {
    capturedFetchCalls.push(args);
    return "";
  },
});
const expectedFetchRefspecs = [
  "+refs/heads/codex/governance-probe:refs/remotes/origin/codex/governance-probe",
  "+refs/heads/dev:refs/remotes/origin/dev",
  "+refs/heads/main:refs/remotes/origin/main",
];
const fetchHelperBehavior = {
  exact_refspecs: JSON.stringify(fetchHelperResult.refspecs)
    === JSON.stringify(expectedFetchRefspecs),
  one_canonical_git_call: JSON.stringify(capturedFetchCalls) === JSON.stringify([[
    "fetch",
    "--no-tags",
    "origin",
    ...expectedFetchRefspecs,
  ]]),
  unsafe_head_rejected: false,
};
try {
  branchSourceRefspecs("../main");
} catch {
  fetchHelperBehavior.unsafe_head_rejected = true;
}
for (const [proof, passed] of Object.entries(fetchHelperBehavior)) {
  if (!passed) {
    issues.push(`canonical branch-source fetch helper proof failed: ${proof}`);
  }
}
const missingGateDependencyInstallMutation = architectureText.replace(
  /      - name: Install Locked Gate Dependencies\r?\n        run: npm ci --include=dev --ignore-scripts --no-audit --no-fund\r?\n/,
  "",
);
const missingBranchSourceFetchMutation = architectureText.replace(
  `        run: ${canonicalBranchFetchCommand}`,
  "        run: |\n"
    + "          if false; then\n"
    + `            ${canonicalBranchFetchCommand}\n`
    + "          fi",
);
const architectureFetchIfFalseMutation = architectureText.replace(
  "        if: ${{ github.event_name == 'pull_request' }}",
  "        if: ${{ false }}",
);
const architectureFetchContinueOnErrorMutation = mutateNamedStepProperty(
  architectureText,
  "Fetch Announced Remote Head",
  "continue-on-error",
  "true",
);
const architectureJobIfFalseMutation = mutateNamedJobProperty(
  architectureText,
  "cleanliness",
  "if",
  "${{ false }}",
);
const architectureJobContinueOnErrorMutation = mutateNamedJobProperty(
  architectureText,
  "cleanliness",
  "continue-on-error",
  "true",
);
const architectureCleanlinessIfFalseMutation = mutateNamedStepProperty(
  architectureText,
  "Verify Cleanliness With Remote Provenance",
  "if",
  "${{ false }}",
);
const architectureCleanlinessContinueOnErrorMutation = mutateNamedStepProperty(
  architectureText,
  "Verify Cleanliness With Remote Provenance",
  "continue-on-error",
  "true",
);

const liveSmokePath = ".github/workflows/runtime-ops-live-smoke.yml";
const liveSmokeText = fs.readFileSync(path.join(repoRoot, liveSmokePath), "utf8");
const missingLiveInstallMutation = liveSmokeText.replace(
  /      - name: Install Locked Dependencies\r?\n        run: npm ci --include=optional --ignore-scripts --no-audit --no-fund\r?\n\r?\n/,
  "",
);
const omittedOptionalDependenciesMutation = liveSmokeText.replace(
  "npm ci --include=optional --ignore-scripts --no-audit --no-fund",
  "npm ci --ignore-scripts --no-audit --no-fund",
);
const missingPgPreflightMutation = liveSmokeText.replace(
  /      - name: Verify PostgreSQL Driver Resolution\r?\n        run: \|\r?\n          node --input-type=module --eval "await import\('pg'\); console\.log\('PostgreSQL driver preflight: PASS'\)"\r?\n\r?\n/,
  "",
);
const invalidLiveSmokeYamlScalarMutation = liveSmokeText.replace(
  /        run: \|\r?\n          node --input-type=module --eval "await import\('pg'\); console\.log\('PostgreSQL driver preflight: PASS'\)"/,
  "        run: node --input-type=module --eval \"await import('pg'); console.log('PostgreSQL driver preflight: PASS')\"",
);
const liveSmokeOrderMutation = liveSmokeText
  .replace(
    "npm run perf:verify-postgres-runtime-persistence-live-smoke",
    "npm run __aidn_runtime_smoke_order_sentinel",
  )
  .replace(
    "npm run perf:verify-postgres-shared-coordination-live-smoke",
    "npm run perf:verify-postgres-runtime-persistence-live-smoke",
  )
  .replace(
    "npm run __aidn_runtime_smoke_order_sentinel",
    "npm run perf:verify-postgres-shared-coordination-live-smoke",
  );

const negativeProbes = {
  required_to_skip_rejected: candidateRejected({ candidateCatalog: weakenedCatalog }),
  self_cancelling_cleanliness_condition_rejected: candidateRejected({
    candidateCatalog: selfCancellingCleanlinessCatalog,
  }),
  substituted_script_rejected: candidateRejected({ candidateCatalog: substitutedScriptCatalog }),
  comment_only_dev_trigger_rejected: candidateRejected({
    candidateWorkflowSources: replaceWorkflowSource(
      workflowSources,
      releasePath,
      devTriggerCommentMutation,
    ),
  }),
  comment_only_release_command_rejected: candidateRejected({
    candidateWorkflowSources: replaceWorkflowSource(
      workflowSources,
      releasePath,
      commandCommentMutation,
    ),
  }),
  missing_job_rejected: candidateRejected({
    candidateWorkflowSources: replaceWorkflowSource(
      workflowSources,
      releasePath,
      missingJobMutation,
    ),
  }),
  duplicate_job_rejected: candidateRejected({
    candidateWorkflowSources: replaceWorkflowSource(
      workflowSources,
      releasePath,
      duplicateJobMutation,
    ),
  }),
  gate_dependency_install_required: candidateRejected({
    candidateWorkflowSources: replaceWorkflowSource(
      workflowSources,
      architecturePath,
      missingGateDependencyInstallMutation,
    ),
  }),
  branch_source_fetch_required:
    evaluateArchitectureBranchSourceFetch(missingBranchSourceFetchMutation).length > 0,
  architecture_fetch_if_false_rejected:
    evaluateArchitectureBranchSourceFetch(architectureFetchIfFalseMutation).length > 0,
  architecture_fetch_continue_on_error_rejected:
    evaluateArchitectureBranchSourceFetch(
      architectureFetchContinueOnErrorMutation,
    ).length > 0,
  architecture_job_if_false_rejected:
    evaluateArchitectureBranchSourceFetch(architectureJobIfFalseMutation).length > 0,
  architecture_job_continue_on_error_rejected:
    evaluateArchitectureBranchSourceFetch(architectureJobContinueOnErrorMutation).length > 0,
  architecture_cleanliness_if_false_rejected:
    evaluateArchitectureBranchSourceFetch(architectureCleanlinessIfFalseMutation).length > 0,
  architecture_cleanliness_continue_on_error_rejected:
    evaluateArchitectureBranchSourceFetch(
      architectureCleanlinessContinueOnErrorMutation,
    ).length > 0,
  live_smoke_install_required: candidateRejected({
    candidateWorkflowSources: replaceWorkflowSource(
      workflowSources,
      liveSmokePath,
      missingLiveInstallMutation,
    ),
  }),
  live_smoke_optional_dependencies_required: candidateRejected({
    candidateWorkflowSources: replaceWorkflowSource(
      workflowSources,
      liveSmokePath,
      omittedOptionalDependenciesMutation,
    ),
  }),
  live_smoke_pg_preflight_required: candidateRejected({
    candidateWorkflowSources: replaceWorkflowSource(
      workflowSources,
      liveSmokePath,
      missingPgPreflightMutation,
    ),
  }),
  live_smoke_step_order_required: candidateRejected({
    candidateWorkflowSources: replaceWorkflowSource(
      workflowSources,
      liveSmokePath,
      liveSmokeOrderMutation,
    ),
  }),
  invalid_live_smoke_yaml_scalar_rejected: candidateRejected({
    candidateWorkflowSources: replaceWorkflowSource(
      workflowSources,
      liveSmokePath,
      invalidLiveSmokeYamlScalarMutation,
    ),
  }),
};
for (const [probe, rejected] of Object.entries(negativeProbes)) {
  if (!rejected) {
    issues.push(`negative probe accepted: ${probe}`);
  }
}

const output = {
  ok: issues.length === 0,
  status: issues.length === 0 ? "PASS" : "FAIL",
  gates: catalog.gates?.length ?? 0,
  families: [...families].sort(),
  dependency_lock: {
    path: "package-lock.json",
    lockfile_version: packageLock?.lockfileVersion ?? null,
    pg_version: packageLock?.packages?.["node_modules/pg"]?.version ?? null,
    yaml_version: packageLock?.packages?.["node_modules/yaml"]?.version ?? null,
  },
  branch_source_fetch_helper: fetchHelperBehavior,
  workflow_syntax: {
    parser: `yaml@${packageJson.devDependencies?.yaml ?? "missing"}`,
    files: workflowSyntaxResults.length,
    valid: workflowSyntaxResults.filter((result) => result.issues.length === 0).length,
    invalid: workflowSyntaxResults.filter((result) => result.issues.length > 0).length,
  },
  workflows: workflowModels.map((workflow) => ({
    path: workflow.path,
    triggers: Object.keys(workflow.triggers).sort(),
    jobs: Object.keys(workflow.jobs).sort(),
    npm_commands: Object.values(workflow.jobs).flatMap((job) => job.commands).length,
    steps: Object.values(workflow.jobs).flatMap((job) => job.steps ?? []).length,
  })),
  publication_obligations: {
    selector: "obligations",
    contexts: ["main", "release"],
    critical_gates: ["codex-pack-topology", "security-tracked-sensitivity"],
  },
  negative_probes: negativeProbes,
  issues,
};
console.log(JSON.stringify(output, null, 2));
if (!output.ok) {
  process.exitCode = 1;
}
