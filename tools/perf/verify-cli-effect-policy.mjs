#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  classifyCliOptionEffect,
  getCliEffectProfile,
  listCliEffectPolicies,
  resolveCliEffectClass,
  validateCliEffectPolicies,
} from "../../src/core/cli/effect-policy.mjs";
import {
  buildCommandDescriptorIndex,
  listDispatchableCommandDescriptors,
  validateCommandRegistryDescriptors,
} from "../../src/core/cli/command-registry.mjs";
import { parserOptionsFor } from "../governance/surface-catalog-lib.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

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
    const contractCommands = Array.isArray(schema["x-aidn-commands"])
      ? schema["x-aidn-commands"]
      : [schema["x-aidn-command"]];
    if (!contractCommands.includes(policy.command)) {
      issues.push(`${policy.id}: schema command mismatch (${contractCommands.filter(Boolean).join(" | ") || "missing"} != ${policy.command})`);
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

function verifyRuntimeAliasCoverage(policies) {
  const runtimeAliases = listDispatchableCommandDescriptors()
    .filter((item) => item.group === "runtime" && item.visibility === "public")
    .map((item) => item.name)
    .sort();
  const covered = new Set(policies.map((policy) => policy.surface.replace(/^aidn runtime /, "")));
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

function verifyRegistryMutations() {
  const descriptors = listDispatchableCommandDescriptors();
  const seed = descriptors.find((item) => item.command === "aidn runtime db-status");
  const reordered = {
    fixed_args: [...seed.fixed_args],
    aliases: [...seed.aliases],
    dispatch_kind: seed.dispatch_kind,
    implementation: seed.implementation,
    json_contracts: [...seed.json_contracts],
    registry_source: seed.registry_source,
    effect_authority: "src/core/cli/effect-policy.mjs#aidn runtime catalog-bypass",
    owner: seed.owner,
    visibility: seed.visibility,
    name: "catalog-bypass",
    group: seed.group,
    command: "aidn runtime catalog-bypass",
    id: "runtime:catalog-bypass",
  };
  const added = [...descriptors, reordered];
  const removed = descriptors.filter((item) => item.command !== seed.command);
  const incomplete = [...descriptors, { id: "runtime:incomplete" }];
  const emptyRequired = [...descriptors, {
    ...seed,
    id: "runtime:empty-owner",
    command: "aidn runtime empty-owner",
    name: "empty-owner",
    owner: "",
  }];
  const duplicate = [...descriptors, { ...seed }];
  const aliasCollision = descriptors.map((item) => (
    item.id === seed.id ? { ...item, aliases: ["help"] } : item
  ));
  const requiredBuiltins = [
    "aidn help",
    "aidn version",
    "aidn codex help",
    "aidn project help",
    "aidn runtime help",
    "aidn perf help",
  ];
  const checks = {
    reordered_fields_valid: validateCommandRegistryDescriptors(added).ok,
    added_command_indexed: buildCommandDescriptorIndex(added).has(reordered.command),
    removed_command_absent: !buildCommandDescriptorIndex(removed).has(seed.command),
    incomplete_rejected: !validateCommandRegistryDescriptors(incomplete).ok,
    empty_required_rejected: !validateCommandRegistryDescriptors(emptyRequired).ok,
    duplicate_rejected: !validateCommandRegistryDescriptors(duplicate).ok,
    alias_collision_rejected: !validateCommandRegistryDescriptors(aliasCollision).ok,
    builtins_registered: requiredBuiltins.every((command) => descriptors.some(
      (item) => item.command === command && item.dispatch_kind === "builtin",
    )),
  };
  return {
    ok: Object.values(checks).every(Boolean),
    checks,
  };
}

function verifyInvocationMatrix() {
  const rows = [];
  const issues = [];
  const descriptors = listDispatchableCommandDescriptors()
    .filter((item) => item.visibility === "public");
  for (const descriptor of descriptors) {
    const surface = descriptor.command;
    let profile;
    try {
      profile = getCliEffectProfile(surface);
    } catch (error) {
      issues.push(`${surface}: ${error.message}`);
      continue;
    }
    const options = parserOptionsFor(path.join(REPO_ROOT, descriptor.implementation));
    const selectorCombinations = [
      [],
      ...["--json", "--help", "-h", "--dry-run"]
        .filter((token) => options.includes(token))
        .map((token) => [token]),
      ...profile.variants.flatMap((variant) => [
        [...variant.when_args],
        ...(options.includes("--json") ? [[...variant.when_args, "--json"]] : []),
      ]),
    ];
    const uniqueCombinations = [
      ...new Map(
        selectorCombinations.map((argv) => [[...new Set(argv)].sort().join("\0"), [...new Set(argv)]]),
      ).values(),
    ];
    for (const argv of uniqueCombinations) {
      let effectClass = "";
      try {
        effectClass = resolveCliEffectClass(surface, argv);
      } catch (error) {
        issues.push(`${surface} ${argv.join(" ")}: ${error.message}`);
        continue;
      }
      const withoutJson = argv.filter((token) => token !== "--json");
      const expectedWithoutJson = resolveCliEffectClass(surface, withoutJson);
      if (effectClass !== expectedWithoutJson) {
        issues.push(`${surface}: --json changed ${expectedWithoutJson} to ${effectClass}`);
      }
      if (argv.includes("--help") || argv.includes("-h")) {
        if (effectClass !== "read-only") {
          issues.push(`${surface}: help variant must be read-only (${argv.join(" ")})`);
        }
      } else if (argv.includes("--dry-run") && effectClass !== "preview") {
        issues.push(`${surface}: --dry-run variant must be preview (${argv.join(" ")})`);
      }
      rows.push({
        surface,
        variant: argv.length > 0 ? argv.join("+") : "base",
        argv,
        effect_class: effectClass,
      });
    }
    for (const option of options) {
      const classification = classifyCliOptionEffect(surface, option);
      const serializedClassification = JSON.stringify(classification);
      if ([...FORBIDDEN_EFFECT_SENTINELS].some(
        (sentinel) => serializedClassification.includes(sentinel),
      )) {
        issues.push(`${surface} ${option}: forbidden effect sentinel`);
      }
      if (option === "--dry-run" && resolveCliEffectClass(surface, [option, "--json"]) !== "preview") {
        issues.push(`${surface}: --dry-run must resolve preview`);
      }
      rows.push({
        surface,
        variant: option,
        argv: [option, "--json"],
        effect_class: resolveCliEffectClass(surface, [option, "--json"]),
        option_rule: classification,
      });
    }
    for (const variant of profile.variants) {
      const resolved = resolveCliEffectClass(surface, [...variant.when_args, "--json"]);
      if (resolved !== variant.effect_class) {
        issues.push(`${variant.policy}: expected ${variant.effect_class}, got ${resolved}`);
      }
    }
  }
  return {
    ok: issues.length === 0,
    surfaces: descriptors.length,
    rows: rows.length,
    issues,
    matrix: rows,
  };
}

function runAidn(argv, { cwd = REPO_ROOT, env = {} } = {}) {
  const mergedEnv = { ...process.env, ...env };
  for (const [key, value] of Object.entries(env)) {
    if (value == null) {
      delete mergedEnv[key];
    }
  }
  const result = spawnSync(process.execPath, [
    path.resolve(REPO_ROOT, "bin", "aidn.mjs"),
    ...argv,
  ], {
    cwd,
    env: mergedEnv,
    encoding: "utf8",
    timeout: 240000,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  const stdout = String(result.stdout ?? "").trim();
  let payload = null;
  if (stdout.startsWith("{")) {
    try {
      payload = JSON.parse(stdout);
    } catch {
    }
  }
  return {
    status: result.status ?? 1,
    payload,
    stdout,
    stderr: String(result.stderr ?? "").trim(),
  };
}

function makeCodexPrerequisiteStub(tempRoot) {
  const binDir = path.join(tempRoot, "codex-stub");
  fs.mkdirSync(binDir, { recursive: true });
  if (process.platform === "win32") {
    fs.writeFileSync(
      path.join(binDir, "codex.cmd"),
      "@echo off\r\nif \"%1\"==\"login\" if \"%2\"==\"status\" echo Logged in\r\nexit /b 0\r\n",
      "utf8",
    );
  } else {
    const commandPath = path.join(binDir, "codex");
    fs.writeFileSync(commandPath, "#!/usr/bin/env sh\necho \"Logged in\"\n", "utf8");
    fs.chmodSync(commandPath, 0o755);
  }
  return binDir;
}

function verifyBehavioralEffectProbes() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-cli-effect-behavior-"));
  const checks = {};
  let daemonTarget = "";
  try {
    const adapterSource = path.resolve(
      REPO_ROOT,
      "tests",
      "fixtures",
      "repo-installed-core",
      ".aidn",
      "project",
      "workflow.adapter.json",
    );
    const projectWriteTarget = path.join(tempRoot, "project-write");
    const projectPreviewTarget = path.join(tempRoot, "project-preview");
    fs.mkdirSync(projectWriteTarget, { recursive: true });
    fs.mkdirSync(projectPreviewTarget, { recursive: true });
    const projectWrite = runAidn([
      "project",
      "config",
      "--target",
      projectWriteTarget,
      "--adapter-file",
      adapterSource,
      "--write",
      "--json",
    ]);
    const projectPreview = runAidn([
      "project",
      "config",
      "--target",
      projectPreviewTarget,
      "--adapter-file",
      adapterSource,
      "--json",
    ]);
    checks.project_adapter_write_mutating = projectWrite.status === 0
      && projectWrite.payload?.effect_class === "mutating"
      && projectWrite.payload?.written === true
      && fs.existsSync(path.join(projectWriteTarget, ".aidn", "project", "workflow.adapter.json"));
    checks.project_adapter_preview_non_mutating = projectPreview.status === 0
      && projectPreview.payload?.effect_class === "preview"
      && projectPreview.payload?.written === false
      && !fs.existsSync(path.join(projectPreviewTarget, ".aidn"));

    const separator = process.platform === "win32" ? ";" : ":";
    const codexStub = makeCodexPrerequisiteStub(tempRoot);
    const installTarget = path.join(tempRoot, "install-dry-run");
    fs.mkdirSync(installTarget, { recursive: true });
    const installDryRun = runAidn([
      "install",
      "--target",
      installTarget,
      "--pack",
      "core",
      "--init-defaults",
      "--project-name",
      "effect-probe",
      "--skip-artifact-import",
      "--no-codex-migrate-custom",
      "--dry-run",
    ], {
      env: {
        PATH: `${codexStub}${separator}${process.env.PATH ?? ""}`,
      },
    });
    checks.install_dry_run_preview = installDryRun.status === 0
      && resolveCliEffectClass("aidn install", ["--dry-run"]) === "preview"
      && fs.readdirSync(installTarget).length === 0;

    const sharedTarget = path.resolve(REPO_ROOT, "tests", "fixtures", "repo-installed-core");
    const restorePreview = runAidn([
      "runtime",
      "shared-coordination-restore",
      "--target",
      sharedTarget,
      "--json",
    ], {
      env: { AIDN_PG_URL: null },
    });
    const restoreWrite = runAidn([
      "runtime",
      "shared-coordination-restore",
      "--target",
      sharedTarget,
      "--write",
      "--json",
    ], {
      env: { AIDN_PG_URL: null },
    });
    checks.restore_availability_independent = restorePreview.payload?.effect_class === "preview"
      && restoreWrite.payload?.effect_class === "mutating";

    daemonTarget = path.join(tempRoot, "daemon");
    fs.cpSync(
      path.resolve(REPO_ROOT, "tests", "fixtures", "repo-installed-core"),
      daemonTarget,
      { recursive: true },
    );
    const daemonAbsent = runAidn([
      "runtime",
      "local-daemon",
      "--status",
      "--target",
      daemonTarget,
      "--json",
    ]);
    const daemonStart = runAidn([
      "runtime",
      "local-daemon",
      "--start",
      "--port",
      "0",
      "--target",
      daemonTarget,
      "--json",
    ]);
    const daemonPresent = runAidn([
      "runtime",
      "local-daemon",
      "--status",
      "--target",
      daemonTarget,
      "--json",
    ]);
    const daemonStop = runAidn([
      "runtime",
      "local-daemon",
      "--stop",
      "--target",
      daemonTarget,
      "--json",
    ]);
    checks.daemon_status_availability_independent =
      daemonAbsent.payload?.effect_class === "read-only"
      && daemonAbsent.payload?.command === "aidn runtime local-daemon --status --json"
      && daemonStart.payload?.effect_class === "executor"
      && daemonPresent.payload?.effect_class === "read-only"
      && daemonPresent.payload?.command === "aidn runtime local-daemon --status --json"
      && daemonStop.payload?.effect_class === "executor";
  } finally {
    if (daemonTarget) {
      runAidn([
        "runtime",
        "local-daemon",
        "--stop",
        "--target",
        daemonTarget,
        "--json",
      ]);
    }
    const cleanup = removePathWithRetry(tempRoot);
    if (!cleanup.ok) {
      throw cleanup.error;
    }
  }
  return {
    ok: Object.values(checks).every(Boolean),
    checks,
  };
}

const FORBIDDEN_EFFECT_SENTINELS = new Set([
  "inherited",
  "unclassified-internal",
  "ambiguous",
  "unknown-effect",
]);

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
  const registryMutations = verifyRegistryMutations();
  const invocationMatrix = verifyInvocationMatrix();
  const behavioralProbes = verifyBehavioralEffectProbes();
  const issues = [
    ...validation.issues,
    ...verifyContractsExist(policies),
    ...verifySafeArgs(policies),
    ...runtimeAliasCoverage.issues,
    ...(registryMutations.ok ? [] : ["command registry mutation probes failed"]),
    ...invocationMatrix.issues,
    ...(behavioralProbes.ok ? [] : ["behavioral effect probes failed"]),
  ];
  const output = {
    ok: issues.length === 0,
    checked_policies: policies.length,
    runtime_aliases: runtimeAliasCoverage.runtime_aliases,
    covered_runtime_aliases: runtimeAliasCoverage.covered_aliases,
    missing_runtime_aliases: runtimeAliasCoverage.missing_aliases,
    registry_mutations: registryMutations,
    invocation_matrix: invocationMatrix,
    behavioral_probes: behavioralProbes,
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
