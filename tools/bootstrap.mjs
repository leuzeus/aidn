#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { executeCodexAssets, diagnoseCodexAssets } from "../src/application/install/codex-assets-service.mjs";
import { planInstallation, executeInstallation, diagnoseInstallation } from "../src/application/install/installation-service.mjs";
import { loadWorkflowAdapterConfigState } from "../src/application/project/project-config-use-case.mjs";
import { runWorkflowAdapterConfigWizard } from "../src/application/project/workflow-adapter-config-wizard.mjs";
import { inspectCodexCapabilities } from "../src/application/codex/codex-capabilities-service.mjs";

const PROFILES = new Set(["minimal", "default", "full", "postgres", "db-only"]);
const MODES = new Set(["install", "upgrade"]);

function scalarValue(argv, index, flag) {
  const value = String(argv[index + 1] ?? "").trim();
  if (!value || value.startsWith("-")) throw new Error(`Missing value for ${flag}`);
  return value;
}

function parseArgs(argv) {
  const args = {
    target: ".",
    action: "",
    scope: "codex-integration",
    write: false,
    expectedPlanId: "",
    codexMigrateCustom: false,
    mode: "",
    profile: "default",
    dryRun: false,
    json: false,
    verify: false,
    wizard: false,
    projectName: "",
    sourceBranch: "",
    runtimePersistenceConnectionRef: "",
    materializeVisibleArtifacts: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = scalarValue(argv, i, token);
      i += 1;
    } else if (token === "--diagnose") {
      selectAction(args, "diagnose");
    } else if (token === "--repair") {
      selectAction(args, "repair");
    } else if (token === "--resume") {
      selectAction(args, "resume");
    } else if (token === "--rollback") {
      selectAction(args, "rollback");
    } else if (token === "--uninstall") {
      selectAction(args, "uninstall");
    } else if (token === "--scope") {
      args.scope = scalarValue(argv, i, token);
      i += 1;
    } else if (token === "--write") {
      args.write = true;
    } else if (token === "--expect-plan") {
      args.expectedPlanId = scalarValue(argv, i, token);
      i += 1;
    } else if (token === "--codex-migrate-custom") {
      args.codexMigrateCustom = true;
    } else if (token === "--no-codex-migrate-custom") {
      args.codexMigrateCustom = false;
    } else if (token === "--mode") {
      args.mode = scalarValue(argv, i, token).toLowerCase();
      i += 1;
    } else if (token === "--profile") {
      args.profile = scalarValue(argv, i, token).toLowerCase();
      i += 1;
    } else if (token === "--project-name") {
      args.projectName = scalarValue(argv, i, token);
      i += 1;
    } else if (token === "--source-branch") {
      args.sourceBranch = scalarValue(argv, i, token);
      i += 1;
    } else if (token === "--runtime-persistence-connection-ref") {
      args.runtimePersistenceConnectionRef = scalarValue(argv, i, token);
      i += 1;
    } else if (token === "--materialize-visible-artifacts") {
      args.materializeVisibleArtifacts = true;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--verify") {
      args.verify = true;
    } else if (token === "--wizard") {
      args.wizard = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (argv.includes("--codex-migrate-custom") && argv.includes("--no-codex-migrate-custom")) {
    throw new Error("--codex-migrate-custom conflicts with --no-codex-migrate-custom");
  }
  if (!["codex-integration", "installation"].includes(args.scope)) throw new Error("Invalid --scope. Expected codex-integration|installation");
  if (argv.includes("--scope") && !args.action) throw new Error("--scope requires a diagnostic/lifecycle action");
  if (args.write && (args.dryRun || !args.action || args.action === "diagnose")) {
    throw new Error("--write requires a lifecycle action and cannot be combined with --dry-run or --diagnose");
  }
  if (args.action && (args.wizard || args.mode || args.codexMigrateCustom || args.materializeVisibleArtifacts || args.verify)) {
    throw new Error("Diagnostic/lifecycle actions cannot be combined with install, wizard, migration, materialization or verification options");
  }
  if (args.write && !args.expectedPlanId) throw new Error("Preview first and apply with --write --expect-plan <plan_id>");
  if (args.expectedPlanId && (!args.action || args.action === "diagnose")) throw new Error("--expect-plan requires a lifecycle action");
  if (!args.target) {
    throw new Error("Missing required argument value: --target");
  }
  if (args.mode && !MODES.has(args.mode)) {
    throw new Error("Invalid --mode. Expected install|upgrade");
  }
  if (!PROFILES.has(args.profile)) {
    throw new Error("Invalid --profile. Expected minimal|default|full|postgres|db-only");
  }
  if (args.profile === "postgres" && !args.runtimePersistenceConnectionRef) {
    throw new Error("Profile postgres requires --runtime-persistence-connection-ref <ref>");
  }
  if (args.json && args.wizard) {
    throw new Error("--wizard cannot be combined with --json");
  }

  return args;
}

function selectAction(args, action) {
  if (args.action) throw new Error("Choose exactly one diagnostic/lifecycle action");
  args.action = action;
}

function printUsage() {
  console.log("Usage:");
  console.log("  aidn bootstrap --target . --profile default");
  console.log("  aidn bootstrap --target . --mode upgrade --profile default");
  console.log("  aidn bootstrap --target . --profile postgres --runtime-persistence-connection-ref env:AIDN_PG_URL");
  console.log("  aidn bootstrap --target . --profile db-only");
  console.log("  aidn bootstrap --target . --profile default --dry-run --json");
  console.log("  aidn bootstrap --target . --wizard");
  console.log("  aidn bootstrap --target . --diagnose --json");
  console.log("  aidn bootstrap --target . --repair|--resume|--rollback|--uninstall --json");
  console.log("  aidn bootstrap --target . --repair --write --expect-plan <plan_id> --json");
  console.log("  Default lifecycle scope: codex-integration. Add --scope installation for all recorded local installation assets.");
  console.log("  Sessions, cycles, history, business data and databases are retained in both scopes.");
  console.log("  Optional LLM customization migration: --codex-migrate-custom (disabled by default).");
}

function detectMode(targetRoot) {
  const markers = [
    path.join(targetRoot, ".aidn", "config.json"),
    path.join(targetRoot, "AGENTS.md"),
    path.join(targetRoot, "docs", "audit", "SPEC.md"),
  ];
  return markers.some((marker) => fs.existsSync(marker)) ? "upgrade" : "install";
}

function readExistingSourceBranch(targetRoot) {
  const candidates = [
    path.join(targetRoot, ".aidn", "config.json"),
    path.join(targetRoot, "docs", "audit", "WORKFLOW.md"),
    path.join(targetRoot, "docs", "audit", "WORKFLOW_SUMMARY.md"),
    path.join(targetRoot, "docs", "audit", "CODEX_ONLINE.md"),
    path.join(targetRoot, "docs", "audit", "index.md"),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    const text = fs.readFileSync(candidate, "utf8");
    if (candidate.endsWith("config.json")) {
      try {
        const parsed = JSON.parse(text);
        const value = String(parsed?.workflow?.sourceBranch ?? "").trim();
        if (value) {
          return value;
        }
      } catch {
        // continue with rendered docs
      }
    }
    const matches = [
      text.match(/source_branch:\s*`?([A-Za-z0-9._/-]+)`?/),
      text.match(/Source branch:\s*`([A-Za-z0-9._/-]+)`/),
      text.match(/Configured source branch:\s*`([A-Za-z0-9._/-]+)`/),
    ];
    for (const match of matches) {
      const value = String(match?.[1] ?? "").trim();
      if (value && value.toUpperCase() !== "TO_DEFINE") {
        return value;
      }
    }
  }
  return "";
}

function profilePlan(args, targetRoot) {
  const mode = args.mode || detectMode(targetRoot);
  const projectName = args.projectName || path.basename(path.resolve(targetRoot)) || "aidn-project";
  const sourceBranch = args.sourceBranch || (mode === "upgrade" ? readExistingSourceBranch(targetRoot) : "");
  const installArgs = ["--target", targetRoot, "--pack", args.profile === "full" ? "extended" : "core"];
  const configArgs = ["project", "config", "--target", targetRoot];
  if (args.verify || ["default", "full", "postgres", "db-only"].includes(args.profile)) installArgs.push("--verify-after-install");
  const operations = [];

  if (args.wizard) {
    operations.push({
      id: "project-config-wizard",
      command: [...configArgs, "--wizard"],
      env: {},
      mutates: false,
      optional: false,
    });
  }

  if (sourceBranch) {
    installArgs.push("--source-branch", sourceBranch);
  }
  if (args.dryRun) {
    installArgs.push("--dry-run");
  }
  if (args.codexMigrateCustom) installArgs.push("--codex-migrate-custom");
  if (args.materializeVisibleArtifacts) {
    installArgs.push("--materialize-visible-artifacts");
  }
  if (args.profile === "postgres") {
    installArgs.push(
      "--runtime-persistence-backend",
      "postgres",
      "--runtime-persistence-connection-ref",
      args.runtimePersistenceConnectionRef,
    );
  }
  if (!args.wizard) {
    installArgs.push("--init-defaults", "--project-name", projectName);
  }
  if (args.profile === "db-only") {
    installArgs.push("--skip-artifact-import");
  }

  operations.push({
    id: "install",
    command: ["install", ...installArgs],
    env: args.profile === "db-only" ? { AIDN_STATE_MODE: "db-only" } : {},
    mutates: !args.dryRun,
  });


  return {
    mode,
    projectName,
    pack: args.profile === "full" ? "extended" : "core",
    operations,
  };
}

function installationArgs(args, plan) {
  return {
    pack: plan.pack, sourceBranch: args.sourceBranch || (plan.mode === "upgrade" ? readExistingSourceBranch(path.resolve(args.target)) : ""),
    initDefaults: true, projectName: plan.projectName,
    ...(args.adapterData ? { adapterData: args.adapterData } : {}),
    codexMigrateCustom: args.codexMigrateCustom,
    materializeVisibleArtifacts: args.materializeVisibleArtifacts,
    skipArtifactImport: args.profile === "db-only",
    ...(args.profile === "db-only" ? { runtimeStateMode: "db-only" } : {}),
    runtimePersistenceBackend: args.profile === "postgres" ? "postgres" : "",
    runtimePersistenceConnectionRef: args.runtimePersistenceConnectionRef,
    verifyAfterInstall: args.verify || ["default", "full", "postgres", "db-only"].includes(args.profile),
  };
}

function runAidn(repoRoot, operation, capture) {
  const binPath = path.join(repoRoot, "bin", "aidn.mjs");
  const result = spawnSync(process.execPath, [binPath, ...operation.command], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...operation.env,
    },
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    timeout: 240000,
    maxBuffer: 30 * 1024 * 1024,
  });
  return {
    id: operation.id,
    command: ["aidn", ...operation.command].join(" "),
    status: result.status ?? 1,
    ok: (result.status ?? 1) === 0,
    optional: operation.optional === true,
    mutates: operation.mutates === true,
    stdout: capture ? String(result.stdout ?? "") : "",
    stderr: capture ? String(result.stderr ?? "") : "",
    error: result.error ? result.error.message : "",
  };
}

function assetOptions(args, repoRoot, targetRoot) {
  return {
    repoRoot, targetRoot,
    templateVars: {
      VERSION: fs.readFileSync(path.join(repoRoot, "VERSION"), "utf8").trim(),
      ...(args.sourceBranch ? { SOURCE_BRANCH: args.sourceBranch } : {}),
      ...(args.projectName ? { PROJECT_NAME: args.projectName } : {}),
    },
    ...(args.action ? { action: args.action } : {}),
  };
}

function integrationOutput(args, targetRoot, fields = {}) {
  const diagnostic = args.action === "diagnose";
  return {
    contract_version: diagnostic ? "bootstrap-diagnostics.v1" : "bootstrap-lifecycle.v1",
    command: "aidn bootstrap --" + args.action + (args.write ? " --write" : "") + " --json",
    effect_class: diagnostic ? "read-only" : args.write ? "mutating" : "preview",
    ok: false,
    ts: new Date().toISOString(),
    target_root: targetRoot,
    action: args.action,
    scope: args.scope ?? "codex-integration",
    dry_run: diagnostic || !args.write,
    written: false,
    plan_id: "",
    operations: [],
    conflicts: [],
    write_targets: [],
    ...(diagnostic ? { assets: {}, capabilities: { states: { installed: "unknown", detected: "unknown", approved: "unknown", connected: "not_applicable", operational: "unverified", degraded: true } }, trust_instructions: [] } : {}),
    errors: [],
    warnings: [],
    ...fields,
  };
}

async function runIntegrationAction(args, repoRoot, targetRoot) {
  const options = assetOptions(args, repoRoot, targetRoot);
  let output;
  if (args.action === "diagnose") {
    const assets = await (args.scope === "installation" ? diagnoseInstallation(options) : diagnoseCodexAssets(options));
    const capabilities = await inspectCodexCapabilities({ targetRoot });
    output = integrationOutput(args, targetRoot, { ok: assets.ok !== false, assets, capabilities,
      errors: assets.errors ?? [],
      warnings: [...(assets.warnings ?? []), ...(capabilities.warnings ?? [])],
      trust_instructions: [
        "Open this project in Codex and review the project trust and hook permissions.",
        "Approve only after reviewing the installed AIDN hooks; this command does not grant trust.",
        "Use a real session to verify startup and refusal on the tools listed as covered.",
      ] });
  } else {
    const execute = args.scope === "installation" ? executeInstallation : executeCodexAssets;
    const result = await execute({ ...options, dryRun: !args.write, expectedPlanId: args.expectedPlanId || undefined });
    output = integrationOutput(args, targetRoot, { ...result, action: args.action,
      written: args.write && result.written === true });
  }
  if (args.json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log("AIDN Codex " + args.action + ": " + (output.ok ? "OK" : "CONFLICT") + " (" + output.effect_class + ")");
    console.log(JSON.stringify(output, null, 2));
  }
  if (!output.ok) process.exitCode = 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const targetRoot = path.resolve(process.cwd(), args.target);
  if (args.action) return runIntegrationAction(args, repoRoot, targetRoot);
  // Read-only preflight precedes wizard/configuration writes as well as installation.
  const plan = profilePlan(args, targetRoot);
  let installation = await planInstallation({ repoRoot, targetRoot, args: installationArgs(args, plan) });
  let assets = installation.asset_plan ?? { ok: false, operations: [], conflicts: [], errors: installation.errors ?? [] };
  let assetBlocked = assets.ok === false || assets.conflicts?.length > 0 || installation.ok === false || installation.conflicts?.length > 0;
  const operationResults = [];

  if (!args.json) {
    console.log(`AIDN bootstrap: mode=${plan.mode}, profile=${args.profile}, target=${targetRoot}`);
  }

  for (const operation of (assetBlocked ? [] : plan.operations)) {
    if (args.dryRun) {
      const planned = {
        id: operation.id,
        command: ["aidn", ...operation.command].join(" "),
        status: 0,
        ok: true,
        optional: operation.optional === true,
        mutates: false,
        stdout: "",
        stderr: "",
        error: "",
      };
      operationResults.push(planned);
      if (!args.json) {
        console.log("");
        console.log(`[dry-run] ${operation.id}: ${planned.command}`);
        if (operation.id === "install") console.log(JSON.stringify(installation, null, 2));
      }
      continue;
    }
    if (operation.id === "project-config-wizard") {
      const defaults = { projectName: plan.projectName, ...(args.profile === "db-only" ? { preferredStateMode: "db-only", defaultIndexStore: "sqlite" } : {}) };
      const state = loadWorkflowAdapterConfigState({ targetRoot, defaults });
      const wizard = await runWorkflowAdapterConfigWizard({ initialConfig: state.data, defaults });
      operationResults.push({ id: operation.id, command: ["aidn", ...operation.command].join(" "), status: wizard.saved ? 0 : 1, ok: wizard.saved, optional: false, mutates: false, stdout: "", stderr: "", error: wizard.saved ? "" : "Workflow adapter configuration cancelled" });
      if (!wizard.saved) break;
      args.adapterData = wizard.data;
      installation = await planInstallation({ repoRoot, targetRoot, args: installationArgs(args, plan) });
      assets = installation.asset_plan ?? assets;
      assetBlocked = installation.ok === false || installation.conflicts?.length > 0;
      if (assetBlocked) break;
      continue;
    }
    if (args.wizard && operation.id === "install") {
      const result = await executeInstallation({ repoRoot, targetRoot, args: installationArgs(args, plan), dryRun: false, expectedPlanId: installation.plan_id });
      const stdout = (result.messages ?? []).join("\n");
      if (stdout) console.log(stdout);
      operationResults.push({ id: operation.id, command: ["aidn", ...operation.command].join(" "), status: result.ok ? 0 : 1, ok: result.ok, optional: false, mutates: result.written === true, stdout, stderr: "", error: (result.errors ?? []).join("; ") });
      if (!result.ok) break;
      continue;
    }
    if (args.json) {
      const result = runAidn(repoRoot, operation, true);
      operationResults.push(result);
      if (!result.ok && !operation.optional) {
        break;
      }
      continue;
    }
    console.log("");
    console.log(`==> ${operation.id}: aidn ${operation.command.join(" ")}`);
    const result = runAidn(repoRoot, operation, false);
    operationResults.push(result);
    if (!result.ok && !operation.optional) {
      process.exit(result.status);
    }
  }

  const blockingFailures = operationResults.filter((item) => !item.ok && !item.optional);
  const output = {
    asset_plan: assets,
    installation_plan: installation,
    contract_version: "bootstrap.v1",
    command: args.dryRun ? "aidn bootstrap --dry-run --json" : "aidn bootstrap --json",
    effect_class: args.dryRun ? "preview" : "mutating",
    ok: !assetBlocked && blockingFailures.length === 0,
    ts: new Date().toISOString(),
    target_root: targetRoot,
    mode: plan.mode,
    mode_source: args.mode ? "explicit" : "auto",
    profile: args.profile,
    pack: plan.pack,
    dry_run: args.dryRun,
    wizard: args.wizard,
    verify_requested: args.verify,
    operations: operationResults.map((item) => ({
      id: item.id,
      command: item.command,
      ok: item.ok,
      status: item.status,
      optional: item.optional,
      mutates: item.mutates,
      stdout: item.stdout,
      stderr: item.stderr,
      error: item.error,
    })),
    errors: [...new Set([...(assets.errors ?? []), ...(installation.errors ?? [])]), ...blockingFailures.map((item) => `${item.id} failed with status ${item.status}`)],
    warnings: [...(installation.warnings ?? []), ...operationResults
      .filter((item) => !item.ok && item.optional)
      .map((item) => `${item.id} skipped or failed with status ${item.status}`)],
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else if (output.ok) {
    console.log("");
    console.log("AIDN bootstrap: OK");
  } else {
    console.error("AIDN bootstrap: blocked");
    for (const error of output.errors) console.error(error);
    for (const operation of operationResults) if (operation.error) console.error(operation.error);
  }

  if (!output.ok) {
    process.exit(1);
  }
}

try {
  await main();
} catch (error) {
  const action = ["diagnose", "repair", "resume", "rollback", "uninstall"].find((name) => process.argv.includes("--" + name));
  if (action && process.argv.includes("--json")) {
    const targetIndex = process.argv.indexOf("--target");
    const rawTarget = targetIndex >= 0 ? String(process.argv[targetIndex + 1] ?? "").trim() : "";
    const errorTarget = rawTarget && !rawTarget.startsWith("-") ? rawTarget : ".";
    console.log(JSON.stringify(integrationOutput({
      action, scope: process.argv[process.argv.indexOf("--scope") + 1] === "installation" ? "installation" : "codex-integration", write: process.argv.includes("--write") && !process.argv.includes("--dry-run"),
    }, path.resolve(process.cwd(), errorTarget), {
      errors: [error.message],
    }), null, 2));
  } else if (process.argv.includes("--json")) {
    console.log(JSON.stringify({
      contract_version: "bootstrap.v1",
      command: process.argv.includes("--dry-run") ? "aidn bootstrap --dry-run --json" : "aidn bootstrap --json",
      effect_class: process.argv.includes("--dry-run") ? "preview" : "mutating",
      ok: false,
      ts: new Date().toISOString(),
      target_root: path.resolve(process.cwd(), "."),
      mode: "",
      mode_source: "",
      profile: "",
      pack: "",
      dry_run: process.argv.includes("--dry-run"),
      wizard: process.argv.includes("--wizard"),
      verify_requested: process.argv.includes("--verify"),
      operations: [],
      errors: [error.message],
      warnings: [],
    }, null, 2));
  } else {
    console.error(`ERROR: ${error.message}`);
    printUsage();
  }
  process.exit(1);
}
