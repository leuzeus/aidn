#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const catalog = JSON.parse(fs.readFileSync(path.join(repoRoot, "package", "catalogs", "gates.v1.json"), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const issues = [];
const families = new Set();
const ids = new Set();
const workflowFiles = {
  "architecture-gates": ".github/workflows/architecture-gates.yml",
  release: ".github/workflows/release.yml",
};
const workflowTexts = Object.fromEntries(
  Object.entries(workflowFiles).map(([name, relativePath]) => [
    name,
    fs.readFileSync(path.join(repoRoot, relativePath), "utf8"),
  ]),
);

function extractJobBlock(workflowText, jobName) {
  const lines = workflowText.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start < 0) return "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [a-zA-Z0-9_-]+:\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function publicationContractIssues({
  candidateCatalog,
  candidatePackageJson,
  releaseWorkflow,
  runner,
}) {
  const publicationIssues = [];
  const criticalGateIds = [
    "codex-pack-topology",
    "security-tracked-sensitivity",
  ];
  for (const gateId of criticalGateIds) {
    const gate = candidateCatalog.gates?.find((item) => item.id === gateId);
    if (!gate) {
      publicationIssues.push(`publication-critical gate missing: ${gateId}`);
      continue;
    }
    for (const context of ["main", "release"]) {
      if (gate.obligation?.[context] !== "required") {
        publicationIssues.push(`${gateId}: ${context} publication obligation must be required`);
      }
    }
  }
  const releaseWrapper = String(candidatePackageJson.scripts?.["verify:release"] ?? "");
  if (!releaseWrapper.includes("run-gate-family.mjs obligations")) {
    publicationIssues.push("verify:release must execute contextual catalog obligations");
  }
  if (!runner.includes('requested === "obligations"')) {
    publicationIssues.push("gate runner must select every catalog gate for obligations mode");
  }
  if (!releaseWorkflow.includes("pull_request:")
    || !releaseWorkflow.includes("branches: [dev, main]")) {
    publicationIssues.push("release verification must trigger for PRs to dev and main");
  }
  if (!releaseWorkflow.includes("push:")
    || !releaseWorkflow.includes("branches: [main]")) {
    publicationIssues.push("release publication must trigger only from a push to main");
  }
  for (const job of ["verify", "publish"]) {
    const block = extractJobBlock(releaseWorkflow, job);
    if (!block.includes("npm run verify:release")) {
      publicationIssues.push(`release/${job} must execute verify:release obligations`);
    }
    if (!block.includes("AIDN_BRANCH_POLICY_EXPECTED_SHA")
      || !block.includes("AIDN_BRANCH_POLICY_CONTAINS_REF")) {
      publicationIssues.push(`release/${job} must bind immutable remote provenance`);
    }
  }
  if (/\bnpm\s+publish\b/.test(releaseWorkflow)) {
    publicationIssues.push("release workflow must never run npm publish");
  }
  return publicationIssues;
}

for (const gate of catalog.gates ?? []) {
  if (ids.has(gate.id)) issues.push(`${gate.id}: duplicate gate id`);
  ids.add(gate.id);
  families.add(gate.family);
  for (const field of ["family", "script", "job", "surfaces", "condition", "obligation"]) {
    if (gate[field] == null || gate[field] === "") issues.push(`${gate.id}: missing ${field}`);
  }
  if (!packageJson.scripts?.[gate.script]) issues.push(`${gate.id}: package script missing: ${gate.script}`);
  if (!Array.isArray(gate.surfaces) || gate.surfaces.length === 0) issues.push(`${gate.id}: surfaces must be non-empty`);
  if (!catalog.condition_values?.includes(gate.condition)) {
    issues.push(`${gate.id}: invalid condition ${gate.condition}`);
  }
  for (const branch of ["dev", "main", "release"]) {
    if (!catalog.obligation_values.includes(gate.obligation?.[branch])) {
      issues.push(`${gate.id}: invalid ${branch} obligation`);
    }
  }
  const [workflowName, jobName] = String(gate.job).split("/");
  if (workflowFiles[workflowName]) {
    const workflowText = workflowTexts[workflowName];
    if (!new RegExp(`^  ${jobName}:`, "m").test(workflowText)) {
      issues.push(`${gate.id}: declared job does not exist: ${gate.job}`);
    } else {
      const jobBlock = extractJobBlock(workflowText, jobName);
      const directCommand = `npm run ${gate.script}`;
      const familyCommand = `npm run verify:${gate.family}`;
      if (!jobBlock.includes(directCommand) && !jobBlock.includes(familyCommand)) {
        issues.push(
          `${gate.id}: ${gate.job} runs neither ${directCommand} nor ${familyCommand}`,
        );
      }
    }
    if (gate.obligation?.dev === "required" && !workflowText.includes("branches: [dev, main]")) {
      issues.push(`${gate.id}: required dev gate workflow is not triggered for PRs to dev`);
    }
    if (gate.obligation?.release === "required" && !workflowText.includes("branches: [dev, main]")) {
      issues.push(`${gate.id}: required release gate workflow is not triggered for PRs to main`);
    }
  }
}
for (const family of catalog.required_families ?? []) {
  if (!families.has(family)) issues.push(`required family missing: ${family}`);
  if (!packageJson.scripts?.[`verify:${family}`]) issues.push(`stable wrapper missing: verify:${family}`);
}
for (const wrapper of ["verify:contracts", "verify:governance", "verify:runtime", "verify:codex", "verify:release", "verify:all"]) {
  if (!packageJson.scripts?.[wrapper]) issues.push(`required stable wrapper missing: ${wrapper}`);
}
if (JSON.stringify(catalog.outcomes) !== JSON.stringify(["PASS", "FAIL", "SKIP"])) {
  issues.push("outcomes must be exactly PASS, FAIL, SKIP");
}
if (catalog.schema_version !== 2) {
  issues.push("gate catalog schema_version must be 2");
}
const runnerText = fs.readFileSync(path.join(repoRoot, "tools", "verify", "run-gate-family.mjs"), "utf8");
for (const token of ["evaluateCondition", "gate.obligation?.[context]", "status: \"SKIP\"", "item.obligation !== \"required\""]) {
  if (!runnerText.includes(token)) {
    issues.push(`gate runner does not enforce catalog semantics: missing ${token}`);
  }
}
issues.push(...publicationContractIssues({
  candidateCatalog: catalog,
  candidatePackageJson: packageJson,
  releaseWorkflow: workflowTexts.release,
  runner: runnerText,
}));

const catalogMutation = structuredClone(catalog);
catalogMutation.gates.find((gate) => gate.id === "codex-pack-topology").obligation.release = "optional";
const catalogMutationRejected = publicationContractIssues({
  candidateCatalog: catalogMutation,
  candidatePackageJson: packageJson,
  releaseWorkflow: workflowTexts.release,
  runner: runnerText,
}).length > 0;
const workflowCommandMutationRejected = publicationContractIssues({
  candidateCatalog: catalog,
  candidatePackageJson: packageJson,
  releaseWorkflow: workflowTexts.release.replaceAll("npm run verify:release", "npm run perf:verify-release-version"),
  runner: runnerText,
}).length > 0;
const workflowTriggerMutationRejected = publicationContractIssues({
  candidateCatalog: catalog,
  candidatePackageJson: packageJson,
  releaseWorkflow: workflowTexts.release.replace("branches: [dev, main]", "branches: [main]"),
  runner: runnerText,
}).length > 0;
if (!catalogMutationRejected) {
  issues.push("negative probe failed: weakened publication catalog obligation was accepted");
}
if (!workflowCommandMutationRejected) {
  issues.push("negative probe failed: partial release command was accepted");
}
if (!workflowTriggerMutationRejected) {
  issues.push("negative probe failed: missing dev PR trigger was accepted");
}
const output = {
  ok: issues.length === 0,
  status: issues.length === 0 ? "PASS" : "FAIL",
  gates: catalog.gates?.length ?? 0,
  families: [...families].sort(),
  publication_obligations: {
    selector: "obligations",
    contexts: ["main", "release"],
    critical_gates: ["codex-pack-topology", "security-tracked-sensitivity"],
  },
  negative_probes: {
    weakened_catalog_obligation_rejected: catalogMutationRejected,
    partial_workflow_command_rejected: workflowCommandMutationRejected,
    missing_dev_pr_trigger_rejected: workflowTriggerMutationRejected,
  },
  issues,
};
console.log(JSON.stringify(output, null, 2));
if (!output.ok) {
  process.exitCode = 1;
}
