#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const catalog = JSON.parse(fs.readFileSync(path.join(repoRoot, "package", "catalogs", "gates.v1.json"), "utf8"));
const requested = process.argv[2] ?? "";
const json = process.argv.includes("--json");

if (!requested || ![...catalog.required_families, "all"].includes(requested)) {
  console.error(`Usage: node tools/verify/run-gate-family.mjs <${[...catalog.required_families, "all"].join("|")}> [--json]`);
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const npmCommand = fs.existsSync(npmCli) ? process.execPath : "npm";
const npmPrefix = fs.existsSync(npmCli) ? [npmCli] : [];
const selected = catalog.gates.filter((gate) => requested === "all" || gate.family === requested);
const results = [];
const executed = new Map();

for (const gate of selected) {
  const started = Date.now();
  if (!packageJson.scripts?.[gate.script]) {
    results.push({
      id: gate.id,
      family: gate.family,
      script: gate.script,
      status: "SKIP",
      duration_ms: 0,
      reason: "script is not available",
    });
    continue;
  }
  if (executed.has(gate.script)) {
    results.push({
      id: gate.id,
      family: gate.family,
      script: gate.script,
      status: executed.get(gate.script),
      duration_ms: 0,
      reason: "deduplicated",
    });
    continue;
  }
  const result = spawnSync(npmCommand, [...npmPrefix, "run", gate.script], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    timeout: 900000,
    maxBuffer: 30 * 1024 * 1024,
    shell: false,
  });
  if (!json) {
    process.stdout.write(String(result.stdout ?? ""));
    process.stderr.write(String(result.stderr ?? ""));
  }
  const status = result.status === 0 ? "PASS" : "FAIL";
  executed.set(gate.script, status);
  results.push({
    id: gate.id,
    family: gate.family,
    script: gate.script,
    status,
    duration_ms: Date.now() - started,
    exit_code: result.status,
  });
}

const counts = Object.fromEntries(catalog.outcomes.map((status) => [
  status,
  results.filter((item) => item.status === status).length,
]));
const output = {
  ok: counts.FAIL === 0 && counts.SKIP === 0,
  requested,
  outcomes: catalog.outcomes,
  counts,
  results,
};
if (json) {
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log(`Gate family ${requested}: ${output.ok ? "PASS" : "FAIL"}`);
  for (const item of results) {
    console.log(`- ${item.id}: ${item.status} (${item.duration_ms} ms)`);
  }
}
if (!output.ok) {
  process.exitCode = 1;
}
