#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listCliEffectPolicies,
  validateCliEffectPolicies,
} from "../../src/core/cli/effect-policy.mjs";

function parseArgs(argv) {
  const args = {
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-cli-effect-policy.mjs");
  console.log("  node tools/perf/verify-cli-effect-policy.mjs --json");
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTRACT_DIR = path.join(REPO_ROOT, "src", "core", "contracts", "cli-output");
const AIDN_BIN = path.join(REPO_ROOT, "bin", "aidn.mjs");

function verifyContractsExist(policies) {
  const issues = [];
  for (const policy of policies) {
    if (!policy.json_contract) {
      continue;
    }
    const contractPath = path.join(CONTRACT_DIR, policy.json_contract);
    if (!fs.existsSync(contractPath)) {
      issues.push(`${policy.id}: missing JSON contract ${policy.json_contract}`);
      continue;
    }
    const schema = JSON.parse(fs.readFileSync(contractPath, "utf8"));
    if (schema["x-aidn-command"] !== policy.command) {
      issues.push(`${policy.id}: schema command mismatch (${schema["x-aidn-command"] ?? "missing"} != ${policy.command})`);
    }
  }
  return issues;
}

function verifySafeArgs(policies) {
  const issues = [];
  for (const policy of policies) {
    if (policy.safe_args.length === 0) {
      issues.push(`${policy.id}: missing safe_args`);
      continue;
    }
    if (policy.safe_args[0] === "aidn") {
      issues.push(`${policy.id}: safe_args must omit the aidn binary token`);
    }
    if (policy.command.includes("--json") && !policy.safe_args.includes("--json")) {
      issues.push(`${policy.id}: JSON command safe_args must include --json`);
    }
  }
  return issues;
}

function parseRuntimeAliases() {
  const text = fs.readFileSync(AIDN_BIN, "utf8");
  const match = text.match(/const RUNTIME_ALIASES = \{([\s\S]*?)\n\};/);
  if (!match) {
    throw new Error("Unable to parse RUNTIME_ALIASES from bin/aidn.mjs");
  }
  return [...match[1].matchAll(/"([a-z0-9-]+)": \{ file:/g)].map((item) => item[1]).sort();
}

function verifyRuntimeAliasCoverage(policies) {
  const runtimeAliases = parseRuntimeAliases();
  const covered = new Set(policies.map((policy) => policy.id.replace(/^runtime-/, "")));
  const issues = [];
  for (const alias of runtimeAliases) {
    if (!covered.has(alias)) {
      issues.push(`runtime alias missing from effect policy: ${alias}`);
    }
  }
  return {
    runtime_aliases: runtimeAliases.length,
    covered_aliases: runtimeAliases.filter((alias) => covered.has(alias)).length,
    missing_aliases: runtimeAliases.filter((alias) => !covered.has(alias)),
    issues,
  };
}

function summarizeByEffect(policies) {
  const summary = {};
  for (const policy of policies) {
    summary[policy.effect_class] = (summary[policy.effect_class] ?? 0) + 1;
  }
  return summary;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const validation = validateCliEffectPolicies();
  const policies = listCliEffectPolicies();
  const runtimeAliasCoverage = verifyRuntimeAliasCoverage(policies.filter((policy) => policy.id.startsWith("runtime-")));
  const issues = [
    ...validation.issues,
    ...verifyContractsExist(policies),
    ...verifySafeArgs(policies),
    ...runtimeAliasCoverage.issues,
  ];
  const output = {
    ok: issues.length === 0,
    checked_policies: policies.length,
    runtime_aliases: runtimeAliasCoverage.runtime_aliases,
    covered_runtime_aliases: runtimeAliasCoverage.covered_aliases,
    missing_runtime_aliases: runtimeAliasCoverage.missing_aliases,
    by_effect_class: summarizeByEffect(policies),
    effect_classes: validation.effect_classes,
    stability_levels: validation.stability_levels,
    issues,
    policies,
  };
  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`CLI effect policy: ${output.ok ? "PASS" : "FAIL"}`);
    console.log(`- checked_policies=${output.checked_policies}`);
    for (const [effectClass, count] of Object.entries(output.by_effect_class)) {
      console.log(`- ${effectClass}=${count}`);
    }
    for (const issue of output.issues) {
      console.log(`  - ${issue}`);
    }
  }
  if (!output.ok) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  printUsage();
  process.exit(1);
}
