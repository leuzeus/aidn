#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/repo-installed-core",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--target") {
      args.target = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--json") {
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
  console.log("  node tools/perf/verify-agent-selection-summary-fixtures.mjs");
  console.log("  node tools/perf/verify-agent-selection-summary-fixtures.mjs --target tests/fixtures/repo-installed-core --json");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runJson(script, args, repoRoot, expectStatus = 0) {
  return runJsonWithEnv(script, args, repoRoot, {}, expectStatus);
}

function runJsonWithEnv(script, args, repoRoot, env = {}, expectStatus = 0) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if ((result.status ?? 1) !== expectStatus) {
    throw new Error(`Command failed (${path.basename(script)}): ${String(result.stderr ?? result.stdout ?? "").trim()}`);
  }
  return JSON.parse(String(result.stdout ?? "{}"));
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const repoRoot = process.cwd();
    const sourceTarget = path.resolve(repoRoot, args.target);
    const script = path.resolve(repoRoot, "tools", "runtime", "project-agent-selection-summary.mjs");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-agent-selection-summary-"));
    const target = path.join(tempRoot, "target");
    fs.cpSync(sourceTarget, target, { recursive: true });

    const defaultResult = runJson(script, ["--target", target, "--json"], repoRoot, 0);
    const defaultSummaryText = fs.readFileSync(defaultResult.out_file, "utf8");

    const externalAgentDir = path.join(target, ".aidn", "runtime", "agents");
    fs.mkdirSync(externalAgentDir, { recursive: true });
    fs.writeFileSync(path.join(externalAgentDir, "external-auditor.mjs"), [
      "import { spawnSync } from \"node:child_process\";",
      "export function createExternalAuditorAdapter({ id }) {",
      "  return {",
      "    getProfile() { return { id, label: \"External Auditor Adapter\", default_role: \"auditor\", supported_roles: [\"auditor\"], capabilities_by_role: { auditor: [\"audit\", \"analyze\", \"relay\"] } }; },",
      "    canHandleRole({ role, action } = {}) { return role === \"auditor\" && (!action || action === \"audit\" || action === \"analyze\" || action === \"relay\"); },",
      "    runCommand({ command, commandArgs = [], envOverrides = {} }) {",
      "      if (process.platform === \"win32\" && /\\.(cmd|bat)$/i.test(command)) {",
      "        return spawnSync(\"cmd.exe\", [\"/d\", \"/s\", \"/c\", [command, ...commandArgs].join(\" \")], { encoding: \"utf8\", stdio: [\"ignore\", \"pipe\", \"pipe\"], cwd: process.cwd(), env: { ...process.env, ...envOverrides }, shell: false });",
      "      }",
      "      return spawnSync(command, commandArgs, { encoding: \"utf8\", stdio: [\"ignore\", \"pipe\", \"pipe\"], cwd: process.cwd(), env: { ...process.env, ...envOverrides }, shell: false });",
      "    },",
      "  };",
      "}",
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(target, "docs", "audit", "AGENT-ROSTER.md"), [
      "# Agent Roster",
      "",
      "default_agent_selection: auto",
      "",
      "## codex",
      "enabled: yes",
      "priority: 5",
      "roles: coordinator, executor, auditor, repair",
      "",
      "## external-auditor",
      "enabled: yes",
      "priority: 200",
      "roles: auditor",
      "adapter_module: .aidn/runtime/agents/external-auditor.mjs",
      "adapter_export: createExternalAuditorAdapter",
      "",
    ].join("\n"), "utf8");

    const externalResult = runJson(script, ["--target", target, "--json"], repoRoot, 0);
    const externalSummaryText = fs.readFileSync(externalResult.out_file, "utf8");

    assert(defaultResult.written === true, "default projection should write the summary");
    assert(defaultSummaryText.includes("# Agent Selection Summary"), "default summary should include the title");
    assert(defaultSummaryText.includes("roster_verification: pass"), "default summary should include roster verification status");
    assert(defaultSummaryText.includes("codex-auditor"), "default summary should include codex-auditor");
    assert(defaultSummaryText.includes("health=ready"), "default summary should expose adapter health");
    assert(externalResult.summary.adapters.some((adapter) => adapter.id === "external-auditor"), "external projection should include the registered adapter");
    assert(externalResult.roster_verification.pass === true, "external projection should pass roster verification");
    assert(externalSummaryText.includes("external-auditor"), "external summary should include the registered adapter");
    assert(externalSummaryText.includes("auditor + audit: external-auditor"), "external summary should show the auto selection preview for the external adapter");

    const dbOnlyTarget = path.join(tempRoot, "db-only-target");
    fs.cpSync(sourceTarget, dbOnlyTarget, { recursive: true });
    const dbOnlyEnv = {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    };
    runJsonWithEnv(path.resolve(repoRoot, "tools", "perf", "index-sync.mjs"), [
      "--target", dbOnlyTarget,
      "--store", "sqlite",
      "--with-content",
      "--json",
    ], repoRoot, dbOnlyEnv, 0);
    fs.rmSync(path.join(dbOnlyTarget, "docs", "audit", "AGENT-ROSTER.md"), { force: true });
    fs.rmSync(path.join(dbOnlyTarget, "docs", "audit", "AGENT-SELECTION-SUMMARY.md"), { force: true });
    const dbOnlyResult = runJsonWithEnv(script, ["--target", dbOnlyTarget, "--json"], repoRoot, dbOnlyEnv, 0);
    assert(dbOnlyResult.state_mode === "db-only", "db-only selection projection should resolve db-only state mode");
    assert(dbOnlyResult.db_first_applied === true, "db-only selection projection should write through SQLite");
    assert(dbOnlyResult.db_first_materialized === false, "db-only selection projection should not materialize markdown on disk");
    assert(dbOnlyResult.roster_verification.pass === true, "db-only selection projection should still validate roster from SQLite");
    assert(dbOnlyResult.summary.adapters.some((adapter) => adapter.id === "codex"), "db-only selection projection should still expose adapter summary");
    assert(fs.existsSync(path.join(dbOnlyTarget, "docs", "audit", "AGENT-SELECTION-SUMMARY.md")) === false, "db-only selection projection should not recreate AGENT-SELECTION-SUMMARY.md");

    const output = {
      ts: new Date().toISOString(),
      default: defaultResult,
      external: externalResult,
      pass: true,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log("PASS");
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
