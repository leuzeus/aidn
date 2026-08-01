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
import { runGovernanceRouteFixtureSuite } from "./verify-governance-route-fixtures.mjs";

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
let governanceRouteFixtures = null;

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
try {
  governanceRouteFixtures = runGovernanceRouteFixtureSuite(catalog);
} catch (error) {
  issues.push(`governance route fixtures failed: ${error.message}`);
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
  if (gate.execution_scope != null
    && !["admission", "manual-only"].includes(gate.execution_scope)) {
    issues.push(`${gate.id}: invalid execution_scope ${gate.execution_scope}`);
  }
  for (const context of ["dev", "main", "release"]) {
    if (!catalog.obligation_values?.includes(gate.obligation?.[context])) {
      issues.push(`${gate.id}: invalid ${context} obligation`);
    }
  }
}
const manualOnlyGateIds = (catalog.gates ?? [])
  .filter((gate) => gate.execution_scope === "manual-only")
  .map((gate) => gate.id)
  .sort();
if (JSON.stringify(manualOnlyGateIds) !== JSON.stringify([
  "runtime-postgres-persistence-live-cleanup",
  "runtime-postgres-shared-live-cleanup",
])) {
  issues.push("manual-only gates must be exactly the two optional live PostgreSQL smokes");
}
for (const gate of (catalog.gates ?? []).filter(
  (item) => item.execution_scope === "manual-only",
)) {
  if (Object.values(gate.obligation ?? {}).some((value) => value === "required")) {
    issues.push(`${gate.id}: manual-only gate cannot be a required obligation`);
  }
  if (gate.job !== "runtime-ops-live-smoke/live-smoke") {
    issues.push(`${gate.id}: manual-only gate must remain in the live-smoke workflow`);
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

const commandCommentMutation = releaseText.replaceAll(
  "run: npm run verify:release",
  "run: npm run perf:verify-release-version\n        # run: npm run verify:release",
);
const missingJobMutation = releaseText.replace("  publish:\n", "  publish_removed:\n");
const duplicateJobMutation = `${releaseText}\n  publish:\n    runs-on: ubuntu-latest\n    steps: []\n`;

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

const admissionPath = ".github/workflows/governance-admission.yml";
const admissionText = fs.readFileSync(path.join(repoRoot, admissionPath), "utf8");
const admissionRunnerCommand = "node tools/verify/run-gate-family.mjs "
  + "\"${{ matrix.family }}\" --context "
  + "\"${{ needs.classify.outputs.context }}\" --admission";
const admissionJobIds = Object.freeze(["classify", "gates", "admission"]);

function namedStep(job, name) {
  const matches = (job?.steps ?? []).filter((step) => step.name === name);
  return matches.length === 1 ? matches[0] : null;
}

function evaluateGovernanceAdmissionExecutable(source) {
  const sourceIssues = [];
  const document = parseDocument(source, {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    return document.errors.map((error) => (
      `${admissionPath}: invalid YAML while evaluating executable admission `
      + `(${String(error.message).replace(/\s+/gu, " ").trim()})`
    ));
  }
  const model = document.toJS();
  const unexpectedJobIds = Object.keys(model.jobs ?? {})
    .filter((jobId) => !admissionJobIds.includes(jobId));
  if (unexpectedJobIds.length > 0
    || admissionJobIds.some((jobId) => !hasOwn(model.jobs ?? {}, jobId))) {
    sourceIssues.push(
      `admission workflow jobs must be exactly: ${admissionJobIds.join(", ")}`,
    );
  }
  const classify = model.jobs?.classify;
  const gates = model.jobs?.gates;
  const admission = model.jobs?.admission;
  if (hasOwn(classify, "if") || hasOwn(classify, "continue-on-error")) {
    sourceIssues.push("admission classification job must be unconditional and blocking");
  }
  const routeStep = namedStep(classify, "Resolve Governance Route");
  if (!routeStep
    || String(routeStep.run ?? "").split("node tools/verify/resolve-governance-route.mjs").length - 1
      !== 1) {
    sourceIssues.push("admission must execute the canonical governance route resolver once");
  }
  const upload = namedStep(classify, "Upload Governance Route");
  if (!upload || upload.uses !== "actions/upload-artifact@v4" || upload.if !== "always()") {
    sourceIssues.push("admission must always upload the governance route artifact");
  }
  const classificationIntegrity = namedStep(classify, "Enforce Classification Integrity");
  if (!classificationIntegrity
    || classificationIntegrity.if !== "always()"
    || !String(classificationIntegrity.run ?? "").includes("!route.ok")) {
    sourceIssues.push("admission must fail on classification integrity errors");
  }
  if (gates?.if
    !== "${{ needs.classify.result == 'success' && needs.classify.outputs.family_count != '0' }}"
    || gates?.strategy?.["fail-fast"] !== false
    || gates?.strategy?.matrix?.family
      !== "${{ fromJSON(needs.classify.outputs.families) }}") {
    sourceIssues.push("admission gate matrix must use the classified unique family list");
  }
  if (hasOwn(gates, "continue-on-error")) {
    sourceIssues.push("admission gate matrix must not declare continue-on-error");
  }
  const gateSteps = gates?.steps ?? [];
  const fetchStep = namedStep(gates, "Fetch Announced Remote Head");
  if (!fetchStep
    || String(fetchStep.run ?? "").trim() !== canonicalBranchFetchCommand
    || fetchStep.if
      !== "${{ matrix.family == 'cleanliness' && github.event_name == 'pull_request' }}") {
    sourceIssues.push(`admission cleanliness must call the canonical fetch helper: ${canonicalBranchFetchCommand}`);
  }
  if (hasOwn(fetchStep, "continue-on-error")) {
    sourceIssues.push("admission branch-source fetch must not declare continue-on-error");
  }
  const installStep = namedStep(gates, "Install Locked Gate Dependencies");
  const installIndex = gateSteps.indexOf(installStep);
  const runnerStep = namedStep(gates, "Run Selected Family Once");
  const runnerIndex = gateSteps.indexOf(runnerStep);
  if (!installStep
    || String(installStep.run ?? "").trim()
      !== "npm ci --include=dev --ignore-scripts --no-audit --no-fund"
    || installStep.if
      !== "${{ matrix.family == 'cleanliness' || matrix.family == 'release' }}"
    || installIndex < 0
    || runnerIndex < 0
    || installIndex >= runnerIndex) {
    sourceIssues.push("dependency-bearing admission families must install locked dev dependencies first");
  }
  if (!runnerStep
    || String(runnerStep.run ?? "").trim() !== admissionRunnerCommand
    || String(source).split(admissionRunnerCommand).length - 1 !== 1) {
    sourceIssues.push("admission must execute each selected family through one canonical runner call");
  }
  if (hasOwn(runnerStep, "if") || hasOwn(runnerStep, "continue-on-error")) {
    sourceIssues.push("admission family execution must be unconditional and blocking inside its matrix cell");
  }
  const rollupStep = namedStep(admission, "Enforce Required Child Results");
  if (admission?.name !== "Governance Admission"
    || admission?.if !== "always()"
    || JSON.stringify(admission?.needs) !== JSON.stringify(["classify", "gates"])
    || !rollupStep
    || String(rollupStep.run ?? "").trim()
      !== "node tools/verify/enforce-governance-admission.mjs"
    || rollupStep.env?.AIDN_CLASSIFICATION_RESULT !== "${{ needs.classify.result }}"
    || rollupStep.env?.AIDN_GATES_RESULT !== "${{ needs.gates.result }}"
    || rollupStep.env?.AIDN_FAMILY_COUNT !== "${{ needs.classify.outputs.family_count }}"
    || rollupStep.env?.AIDN_GOVERNANCE_LANE !== "${{ needs.classify.outputs.lane }}"
    || hasOwn(rollupStep, "continue-on-error")
    || hasOwn(admission, "continue-on-error")) {
    sourceIssues.push("Governance Admission rollup must always fail on classification or required child failure");
  }
  return sourceIssues;
}
issues.push(...evaluateGovernanceAdmissionExecutable(admissionText));
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
const missingGateDependencyInstallMutation = admissionText.replace(
  /      - name: Install Locked Gate Dependencies[\s\S]*?        run: npm ci --include=dev --ignore-scripts --no-audit --no-fund\r?\n/,
  "",
);
const missingBranchSourceFetchMutation = admissionText.replace(
  `        run: ${canonicalBranchFetchCommand}`,
  "        run: |\n"
    + "          if false; then\n"
    + `            ${canonicalBranchFetchCommand}\n`
    + "          fi",
);
const admissionFetchIfFalseMutation = admissionText.replace(
  "        if: ${{ matrix.family == 'cleanliness' && github.event_name == 'pull_request' }}",
  "        if: ${{ false }}",
);
const admissionFetchContinueOnErrorMutation = mutateNamedStepProperty(
  admissionText,
  "Fetch Announced Remote Head",
  "continue-on-error",
  "true",
);
const admissionGatesIfFalseMutation = admissionText.replace(
  "    if: ${{ needs.classify.result == 'success' && needs.classify.outputs.family_count != '0' }}",
  "    if: ${{ false }}",
);
const admissionGatesContinueOnErrorMutation = mutateNamedJobProperty(
  admissionText,
  "gates",
  "continue-on-error",
  "true",
);
const admissionRollupIfFalseMutation = admissionText.replace(
  "  admission:\n    name: Governance Admission\n    needs: [classify, gates]\n    if: always()",
  "  admission:\n    name: Governance Admission\n    needs: [classify, gates]\n    if: ${{ false }}",
);
const admissionRollupContinueOnErrorMutation = mutateNamedJobProperty(
  admissionText,
  "admission",
  "continue-on-error",
  "true",
);
const admissionRollupBypassMutation = admissionText.replace(
  "        run: node tools/verify/enforce-governance-admission.mjs",
  "        run: echo bypassed",
);
const admissionRunnerDuplicateMutation = admissionText.replace(
  `        run: ${admissionRunnerCommand}`,
  `        run: |\n          ${admissionRunnerCommand}\n          ${admissionRunnerCommand}`,
);
const admissionRunnerContinueOnErrorMutation = mutateNamedStepProperty(
  admissionText,
  "Run Selected Family Once",
  "continue-on-error",
  "true",
);
const admissionUnexpectedJobMutation = `${admissionText.trimEnd()}

  compatibility-probe:
    runs-on: ubuntu-latest
    steps:
      - run: echo bypassed
`;
const admissionClassificationIfFalseMutation = mutateNamedJobProperty(
  admissionText,
  "classify",
  "if",
  "${{ false }}",
);
const missingAdmissionResolverMutation = admissionText.replace(
  "node tools/verify/resolve-governance-route.mjs",
  "echo governance-route-bypassed",
);
const missingAdmissionIntegrityMutation = admissionText.replace(
  /      - name: Enforce Classification Integrity[\s\S]*?\n\n  gates:/u,
  "\n  gates:",
);

const performanceWorkflowPath = ".github/workflows/perf-kpi.yml";
const performanceWorkflowText = fs.readFileSync(
  path.join(repoRoot, performanceWorkflowPath),
  "utf8",
);
function sameSet(actual, expected) {
  return JSON.stringify([...new Set(actual ?? [])].sort())
    === JSON.stringify([...new Set(expected ?? [])].sort());
}
function evaluatePerformanceWorkflowRouting(source) {
  const sourceIssues = [];
  const document = parseDocument(source, {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    return document.errors.map((error) => (
      `${performanceWorkflowPath}: invalid YAML while evaluating performance routing `
      + `(${String(error.message).replace(/\s+/gu, " ").trim()})`
    ));
  }
  const model = document.toJS();
  if (!sameSet(model.on?.pull_request?.branches, ["dev", "main"])) {
    sourceIssues.push("Perf KPI pull requests must target exactly dev and main");
  }
  if (!sameSet(
    model.on?.pull_request?.paths,
    catalog.governance_route_policy.performance_patterns,
  )) {
    sourceIssues.push("Perf KPI pull-request paths must match governance performance policy");
  }
  if (model.on?.workflow_dispatch == null || !model.jobs?.["perf-kpi"]) {
    sourceIssues.push("Perf KPI must remain manually dispatchable");
  }
  return sourceIssues;
}
issues.push(...evaluatePerformanceWorkflowRouting(performanceWorkflowText));
const overbroadPerformanceMutation = performanceWorkflowText.replace(
  /    paths:[\s\S]*?  workflow_dispatch:/u,
  "  workflow_dispatch:",
);
const missingPerformanceDispatchMutation = performanceWorkflowText.replace(
  /  workflow_dispatch:[\s\S]*?\n\npermissions:/u,
  "\npermissions:",
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
  governance_route_resolver_required:
    evaluateGovernanceAdmissionExecutable(missingAdmissionResolverMutation).length > 0,
  governance_route_integrity_required:
    evaluateGovernanceAdmissionExecutable(missingAdmissionIntegrityMutation).length > 0,
  admission_family_runner_single_execution_required:
    evaluateGovernanceAdmissionExecutable(admissionRunnerDuplicateMutation).length > 0,
  admission_family_runner_blocking:
    evaluateGovernanceAdmissionExecutable(admissionRunnerContinueOnErrorMutation).length > 0,
  admission_gate_matrix_condition_required:
    evaluateGovernanceAdmissionExecutable(admissionGatesIfFalseMutation).length > 0,
  admission_gate_matrix_blocking:
    evaluateGovernanceAdmissionExecutable(admissionGatesContinueOnErrorMutation).length > 0,
  admission_rollup_always_required:
    evaluateGovernanceAdmissionExecutable(admissionRollupIfFalseMutation).length > 0,
  admission_rollup_blocking:
    evaluateGovernanceAdmissionExecutable(admissionRollupContinueOnErrorMutation).length > 0,
  admission_rollup_child_failure_required:
    evaluateGovernanceAdmissionExecutable(admissionRollupBypassMutation).length > 0,
  admission_extra_job_rejected:
    evaluateGovernanceAdmissionExecutable(admissionUnexpectedJobMutation).length > 0,
  admission_classification_cannot_be_disabled:
    evaluateGovernanceAdmissionExecutable(admissionClassificationIfFalseMutation).length > 0,
  overbroad_performance_pr_routing_rejected:
    evaluatePerformanceWorkflowRouting(overbroadPerformanceMutation).length > 0,
  performance_manual_dispatch_required:
    evaluatePerformanceWorkflowRouting(missingPerformanceDispatchMutation).length > 0,
  required_to_skip_rejected: candidateRejected({ candidateCatalog: weakenedCatalog }),
  self_cancelling_cleanliness_condition_rejected: candidateRejected({
    candidateCatalog: selfCancellingCleanlinessCatalog,
  }),
  substituted_script_rejected: candidateRejected({ candidateCatalog: substitutedScriptCatalog }),
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
  gate_dependency_install_required:
    evaluateGovernanceAdmissionExecutable(missingGateDependencyInstallMutation).length > 0,
  branch_source_fetch_required:
    evaluateGovernanceAdmissionExecutable(missingBranchSourceFetchMutation).length > 0,
  admission_fetch_if_false_rejected:
    evaluateGovernanceAdmissionExecutable(admissionFetchIfFalseMutation).length > 0,
  admission_fetch_continue_on_error_rejected:
    evaluateGovernanceAdmissionExecutable(
      admissionFetchContinueOnErrorMutation,
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
  governance_route: governanceRouteFixtures,
  performance_routing: {
    pull_request_paths: catalog.governance_route_policy.performance_patterns,
    manual_dispatch: true,
  },
  negative_probes: negativeProbes,
  issues,
};
console.log(JSON.stringify(output, null, 2));
if (!output.ok) {
  process.exitCode = 1;
}
