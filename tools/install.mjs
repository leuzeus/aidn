#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeIndexStoreMode,
  normalizeRuntimeLocalProjectionPolicy,
  normalizeRuntimePersistenceBackend,
} from "../src/lib/config/aidn-config-lib.mjs";
import { runInstallUseCase } from "../src/application/install/install-use-case.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    pack: "",
    sourceBranch: "",
    adapterFile: "",
    standardAuthorizationFile: "",
    standardCodexConfigurationFile: "",
    windowsOperatorEnrollment: "",
    windowsOperatorPlan: null,
    initDefaults: false,
    projectName: "",
    dryRun: false,
    verifyOnly: false,
    skipArtifactImport: false,
    artifactImportStore: "",
    runtimePersistenceBackend: "",
    runtimePersistenceConnectionRef: "",
    runtimePersistenceLocalProjectionPolicy: "",
    persistencePolicy: undefined,
    assist: false,
    strict: false,
    skipAgents: false,
    forceAgentsMerge: false,
    codexMigrateCustom: false,
    verifyAfterInstall: false,
    materializeVisibleArtifacts: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--pack") {
      args.pack = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--source-branch") {
      args.sourceBranch = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--adapter-file") {
      args.adapterFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--standard-authorization") {
      const file = argv[++i];
      if (!file || file.startsWith("--") || args.standardAuthorizationFile) throw new Error("Expected one file for --standard-authorization");
      args.standardAuthorizationFile = file;
    } else if (token === "--standard-codex-configuration") {
      const file = argv[++i];
      if (!file || file.startsWith("--") || args.standardCodexConfigurationFile) throw Error("Expected one file for --standard-codex-configuration");
      args.standardCodexConfigurationFile = file;
    } else if (token === "--standard-windows-operator-enrollment") {
      const value = argv[++i];
      if (!value || value.startsWith("--") || args.windowsOperatorEnrollment) throw Error("Expected one Windows operator enrollment file");
      args.windowsOperatorEnrollment = value;
    } else if (token === "--expect-windows-operator-plan") {
      const value = argv[++i];
      if (!/^[a-f0-9]{64}$/.test(value ?? "") || args.windowsOperatorPlan !== null) throw Error("Expected one Windows operator plan digest");
      args.windowsOperatorPlan = value;
    } else if (token === "--init-defaults") {
      args.initDefaults = true;
    } else if (token === "--project-name") {
      args.projectName = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--verify-after-install") {
      args.verifyAfterInstall = true;
    } else if (token === "--verify") {
      args.verifyOnly = true;
    } else if (token === "--skip-artifact-import") {
      args.skipArtifactImport = true;
    } else if (token === "--artifact-import-store") {
      args.artifactImportStore = String(argv[i + 1] ?? "").toLowerCase();
      i += 1;
    } else if (token === "--runtime-persistence-backend") {
      args.runtimePersistenceBackend = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--runtime-persistence-connection-ref") {
      args.runtimePersistenceConnectionRef = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--runtime-persistence-local-projection-policy") {
      args.runtimePersistenceLocalProjectionPolicy = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--persistence-policy") {
      args.persistencePolicy = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--assist") {
      args.assist = true;
    } else if (token === "--strict") {
      args.strict = true;
    } else if (token === "--skip-agents") {
      args.skipAgents = true;
    } else if (token === "--force-agents-merge") {
      args.forceAgentsMerge = true;
    } else if (token === "--codex-migrate-custom") {
      args.codexMigrateCustom = true;
    } else if (token === "--no-codex-migrate-custom") {
      args.codexMigrateCustom = false;
    } else if (token === "--materialize-visible-artifacts") {
      args.materializeVisibleArtifacts = true;
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
  if (!args.target) {
    throw new Error("Missing required argument value: --target");
  }
  if (args.artifactImportStore && !normalizeIndexStoreMode(args.artifactImportStore)) {
    throw new Error("Invalid --artifact-import-store. Expected file|sql|dual|sqlite|dual-sqlite|all");
  }
  if (args.runtimePersistenceBackend && !normalizeRuntimePersistenceBackend(args.runtimePersistenceBackend)) {
    throw new Error("Invalid --runtime-persistence-backend. Expected sqlite|postgres");
  }
  if (args.runtimePersistenceLocalProjectionPolicy
    && !normalizeRuntimeLocalProjectionPolicy(args.runtimePersistenceLocalProjectionPolicy)) {
    throw new Error("Invalid --runtime-persistence-local-projection-policy. Expected keep-local-sqlite|keep-json|keep-sql|none");
  }
  if (args.persistencePolicy !== undefined && !["adopt", "verify-only"].includes(args.persistencePolicy)) {
    throw new Error("Invalid --persistence-policy. Expected adopt|verify-only");
  }
  if (args.verifyOnly && args.initDefaults) {
    args.verifyOnly = false;
    args.verifyAfterInstall = true;
  }
  if (args.verifyOnly && args.standardAuthorizationFile) {
    throw new Error("--standard-authorization requires installation or --dry-run");
  }
  if (args.verifyOnly && args.standardCodexConfigurationFile) throw Error("--standard-codex-configuration requires installation or --dry-run");
  if (args.windowsOperatorEnrollment) {
    const flags = ["--target", "--standard-windows-operator-enrollment", "--expect-windows-operator-plan", "--dry-run"];
    if (argv.some(token => token.startsWith("--") && !flags.includes(token)))
      throw Error("Windows operator enrollment is a separate installation action");
  } else if (args.windowsOperatorPlan !== null) {
    throw Error("--expect-windows-operator-plan requires Windows operator enrollment");
  }

  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/install.mjs --target ../repo");
  console.log("  node tools/install.mjs --target ../repo --pack core");
  console.log("  node tools/install.mjs --target ../repo --pack core --source-branch main");
  console.log("  node tools/install.mjs --target ../repo --pack core --adapter-file ./workflow.adapter.json");
  console.log("  node tools/install.mjs --target ../repo --standard-authorization ./approved-project-authorization.json");
  console.log("  node tools/install.mjs --target ../repo --standard-codex-configuration FILE [--standard-authorization FILE]");
  console.log("  node tools/install.mjs --target ../repo --standard-windows-operator-enrollment ./windows-enrollment.json --dry-run");
  console.log("  node tools/install.mjs --target ../repo --standard-windows-operator-enrollment ./windows-enrollment.json --expect-windows-operator-plan SHA256");
  console.log("  node tools/install.mjs --target ../repo --pack core --init-defaults --project-name my-project --verify");
  console.log("  node tools/install.mjs --target . --pack core --dry-run");
  console.log("  node tools/install.mjs --target . --pack core --verify");
  console.log("  node tools/install.mjs --target . --pack core --verify-after-install");
  console.log("  node tools/install.mjs --target . --pack core --skip-artifact-import");
  console.log("  node tools/install.mjs --target . --pack core --persistence-policy verify-only  # no import or database writes; PostgreSQL must already be ready");
  console.log("  Persistence policy: adopt (default) or verify-only. Dry-run never connects to a database.");
  console.log("  node tools/install.mjs --target . --pack core --artifact-import-store dual-sqlite");
  console.log("  node tools/install.mjs --target . --pack core --materialize-visible-artifacts");
  console.log("  node tools/install.mjs --target . --pack core --runtime-persistence-backend postgres --runtime-persistence-connection-ref env:AIDN_PG_URL");
  console.log("  node tools/install.mjs --target ../repo --pack core --assist");
  console.log("  node tools/install.mjs --target ../repo --pack core --strict");
  console.log("  node tools/install.mjs --target ../repo --pack core --skip-agents");
  console.log("  node tools/install.mjs --target ../repo --pack core --force-agents-merge");
  console.log("  node tools/install.mjs --target ../repo --pack core --codex-migrate-custom  # explicit optional LLM migration");
  console.log("  node tools/install.mjs --target ../repo --pack core --no-codex-migrate-custom  # default");
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(scriptDir, "..");
    const targetRoot = path.resolve(process.cwd(), args.target);
    if (args.windowsOperatorEnrollment) {
      const { installWindowsOperator, prepareWindowsOperatorInstallation } = await import("./runtime/standard-windows-decisions.mjs");
      const file = args.windowsOperatorEnrollment;
      if (args.dryRun) {
        const { sha256 } = prepareWindowsOperatorInstallation(targetRoot, file, args.windowsOperatorPlan);
        console.log(`STANDARD Windows operator plan: ${sha256}`);
      } else {
        const installed = installWindowsOperator(targetRoot, file, args.windowsOperatorPlan);
        console.log(`STANDARD Windows operator authority: ${installed.authority_sha256}`);
      }
      return;
    }
    await runInstallUseCase({
      args,
      repoRoot,
      targetRoot,
    });
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
