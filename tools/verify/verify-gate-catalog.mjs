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

for (const gate of catalog.gates ?? []) {
  if (ids.has(gate.id)) issues.push(`${gate.id}: duplicate gate id`);
  ids.add(gate.id);
  families.add(gate.family);
  for (const field of ["family", "script", "job", "surfaces", "condition", "obligation"]) {
    if (gate[field] == null || gate[field] === "") issues.push(`${gate.id}: missing ${field}`);
  }
  if (!packageJson.scripts?.[gate.script]) issues.push(`${gate.id}: package script missing: ${gate.script}`);
  if (!Array.isArray(gate.surfaces) || gate.surfaces.length === 0) issues.push(`${gate.id}: surfaces must be non-empty`);
  for (const branch of ["dev", "main", "release"]) {
    if (!catalog.obligation_values.includes(gate.obligation?.[branch])) {
      issues.push(`${gate.id}: invalid ${branch} obligation`);
    }
  }
  const [workflowName, jobName] = String(gate.job).split("/");
  if (workflowFiles[workflowName]) {
    const workflowText = fs.readFileSync(path.join(repoRoot, workflowFiles[workflowName]), "utf8");
    if (!new RegExp(`^  ${jobName}:`, "m").test(workflowText)) {
      issues.push(`${gate.id}: declared job does not exist: ${gate.job}`);
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
const output = {
  ok: issues.length === 0,
  status: issues.length === 0 ? "PASS" : "FAIL",
  gates: catalog.gates?.length ?? 0,
  families: [...families].sort(),
  issues,
};
console.log(JSON.stringify(output, null, 2));
if (!output.ok) {
  process.exitCode = 1;
}
