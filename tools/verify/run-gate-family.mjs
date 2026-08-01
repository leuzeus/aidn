#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  GATE_CONTEXTS,
  formatGateFamilySummary,
  inferGateContext,
  runGateFamily,
} from "./gate-runner-lib.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const catalog = JSON.parse(fs.readFileSync(
  path.join(repoRoot, "package", "catalogs", "gates.v1.json"),
  "utf8",
));
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const requested = process.argv[2] ?? "";
const json = process.argv.includes("--json");
const contextIndex = process.argv.indexOf("--context");
const explicitContext = contextIndex >= 0 ? String(process.argv[contextIndex + 1] ?? "") : "";
const gateIndex = process.argv.indexOf("--gate");
const explicitGate = gateIndex >= 0 ? String(process.argv[gateIndex + 1] ?? "") : "";
const admission = process.argv.includes("--admission");
const supportedSelectors = [...catalog.required_families, "all", "obligations"];

if (!requested || !supportedSelectors.includes(requested)) {
  console.error(
    `Usage: node tools/verify/run-gate-family.mjs <${supportedSelectors.join("|")}> `
    + "[--gate <id>] [--json] [--admission] [--context dev|main|release]",
  );
  process.exit(1);
}
if (gateIndex >= 0 && !explicitGate) {
  console.error("Missing value for --gate");
  process.exit(1);
}
if (explicitContext && !GATE_CONTEXTS.includes(explicitContext)) {
  console.error(`Invalid gate context: ${explicitContext}`);
  process.exit(1);
}

const context = inferGateContext({
  explicitContext,
  env: process.env,
  repoRoot,
});

let output;
try {
  output = runGateFamily({
    repoRoot,
    catalog,
    packageJson,
    requested,
    explicitGate,
    admission,
    context,
    env: process.env,
    json,
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (json) {
  console.log(JSON.stringify(output, null, 2));
} else {
  process.stdout.write(formatGateFamilySummary(output));
}
if (!output.ok) {
  process.exitCode = 1;
}
