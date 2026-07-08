#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const PROFILES = new Set(["minimal", "default", "full", "postgres", "db-only"]);
const MODES = new Set(["install", "upgrade"]);

function parseArgs(argv) {
  const args = {
    target: ".",
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
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--mode") {
      args.mode = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--profile") {
      args.profile = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--project-name") {
      args.projectName = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--source-branch") {
      args.sourceBranch = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--runtime-persistence-connection-ref") {
      args.runtimePersistenceConnectionRef = String(argv[i + 1] ?? "").trim();
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

function printUsage() {
  console.log("Usage:");
  console.log("  aidn bootstrap --target . --profile default");
  console.log("  aidn bootstrap --target . --mode upgrade --profile default");
  console.log("  aidn bootstrap --target . --profile postgres --runtime-persistence-connection-ref env:AIDN_PG_URL");
  console.log("  aidn bootstrap --target . --profile db-only");
  console.log("  aidn bootstrap --target . --profile default --dry-run --json");
  console.log("  aidn bootstrap --target . --wizard");
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
  const verifyArgs = ["--target", targetRoot, "--pack", args.profile === "full" ? "extended" : "core", "--verify"];
  const operations = [];

  if (args.wizard) {
    operations.push({
      id: "project-config-wizard",
      command: [...configArgs, "--wizard"],
      env: {},
      mutates: !args.dryRun,
      optional: false,
    });
  }

  if (sourceBranch) {
    installArgs.push("--source-branch", sourceBranch);
  }
  if (args.dryRun) {
    installArgs.push("--dry-run");
  }
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

  const adapterConfigPath = path.join(targetRoot, ".aidn", "project", "workflow.adapter.json");
  if (mode === "upgrade" && !fs.existsSync(adapterConfigPath)) {
    operations.push({
      id: "migrate-adapter",
      command: [
        "project",
        "config",
        "--target",
        targetRoot,
        "--migrate-adapter",
        "--json",
        ...(args.dryRun ? ["--dry-run"] : []),
      ],
      env: {},
      mutates: !args.dryRun,
      optional: true,
    });
  }

  if (!args.dryRun && (args.verify || ["default", "full", "postgres", "db-only"].includes(args.profile))) {
    operations.push({
      id: "verify",
      command: ["install", ...verifyArgs],
      env: args.profile === "db-only" ? { AIDN_STATE_MODE: "db-only" } : {},
      mutates: false,
    });
  }

  return {
    mode,
    projectName,
    pack: args.profile === "full" ? "extended" : "core",
    operations,
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const targetRoot = path.resolve(process.cwd(), args.target);
  const plan = profilePlan(args, targetRoot);
  const operationResults = [];

  if (!args.json) {
    console.log(`AIDN bootstrap: mode=${plan.mode}, profile=${args.profile}, target=${targetRoot}`);
  }

  for (const operation of plan.operations) {
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
      }
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
    contract_version: "bootstrap.v1",
    command: args.dryRun ? "aidn bootstrap --dry-run --json" : "aidn bootstrap --json",
    effect_class: args.dryRun ? "preview" : "mutating",
    ok: blockingFailures.length === 0,
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
    errors: blockingFailures.map((item) => `${item.id} failed with status ${item.status}`),
    warnings: operationResults
      .filter((item) => !item.ok && item.optional)
      .map((item) => `${item.id} skipped or failed with status ${item.status}`),
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else if (output.ok) {
    console.log("");
    console.log("AIDN bootstrap: OK");
  }

  if (!output.ok) {
    process.exit(1);
  }
}

try {
  await main();
} catch (error) {
  if (process.argv.includes("--json")) {
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
