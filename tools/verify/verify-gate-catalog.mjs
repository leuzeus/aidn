#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  loadWorkflowModels,
  parseWorkflowYaml,
  validateGateAndWorkflowPolicy,
} from "./workflow-policy-lib.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const catalogPath = path.join(repoRoot, "package", "catalogs", "gates.v1.json");
const packagePath = path.join(repoRoot, "package.json");
const packageLockPath = path.join(repoRoot, "package-lock.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const workflowModels = loadWorkflowModels(repoRoot);
const issues = [];
const families = new Set();
let packageLock = null;

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
}

function clone(value) {
  return structuredClone(value);
}

function replaceWorkflow(models, relativePath, text) {
  return models.map((model) => model.path === relativePath
    ? parseWorkflowYaml(text, relativePath)
    : model);
}

function candidateRejected({
  candidateCatalog = catalog,
  candidatePackageJson = packageJson,
  candidateWorkflows = workflowModels,
}) {
  return validateGateAndWorkflowPolicy({
    catalog: candidateCatalog,
    packageJson: candidatePackageJson,
    workflowModels: candidateWorkflows,
  }).length > 0;
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
  /      - name: Verify PostgreSQL Driver Resolution\r?\n        run: node --input-type=module --eval "await import\('pg'\); console\.log\('PostgreSQL driver preflight: PASS'\)"\r?\n\r?\n/,
  "",
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
    candidateWorkflows: replaceWorkflow(workflowModels, releasePath, devTriggerCommentMutation),
  }),
  comment_only_release_command_rejected: candidateRejected({
    candidateWorkflows: replaceWorkflow(workflowModels, releasePath, commandCommentMutation),
  }),
  missing_job_rejected: candidateRejected({
    candidateWorkflows: replaceWorkflow(workflowModels, releasePath, missingJobMutation),
  }),
  duplicate_job_rejected: candidateRejected({
    candidateWorkflows: replaceWorkflow(workflowModels, releasePath, duplicateJobMutation),
  }),
  live_smoke_install_required: candidateRejected({
    candidateWorkflows: replaceWorkflow(workflowModels, liveSmokePath, missingLiveInstallMutation),
  }),
  live_smoke_optional_dependencies_required: candidateRejected({
    candidateWorkflows: replaceWorkflow(
      workflowModels,
      liveSmokePath,
      omittedOptionalDependenciesMutation,
    ),
  }),
  live_smoke_pg_preflight_required: candidateRejected({
    candidateWorkflows: replaceWorkflow(
      workflowModels,
      liveSmokePath,
      missingPgPreflightMutation,
    ),
  }),
  live_smoke_step_order_required: candidateRejected({
    candidateWorkflows: replaceWorkflow(workflowModels, liveSmokePath, liveSmokeOrderMutation),
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
