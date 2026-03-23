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
  console.log("  node tools/perf/verify-list-agent-adapters-fixtures.mjs");
  console.log("  node tools/perf/verify-list-agent-adapters-fixtures.mjs --target tests/fixtures/repo-installed-core --json");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runJson(script, args, repoRoot, expectStatus = 0) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    env: { ...process.env },
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
    const script = path.resolve(repoRoot, "tools", "runtime", "list-agent-adapters.mjs");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-list-agents-"));
    const target = path.join(tempRoot, "target");
    fs.cpSync(sourceTarget, target, { recursive: true });

    const defaultResult = runJson(script, ["--target", target, "--json"], repoRoot, 0);

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
      "## broken-auditor",
      "enabled: yes",
      "priority: 200",
      "roles: auditor",
      "adapter_module: .aidn/runtime/agents/missing-auditor.mjs",
      "adapter_export: createMissingAuditorAdapter",
      "",
    ].join("\n"), "utf8");
    const brokenResult = runJson(script, ["--target", target, "--json"], repoRoot, 0);

    assert(Array.isArray(defaultResult.adapters) && defaultResult.adapters.length >= 3, "default listing should expose built-in adapters");
    assert(defaultResult.adapters.some((adapter) => adapter.id === "codex"), "default listing should expose codex");
    assert(defaultResult.adapters.some((adapter) => adapter.id === "codex-auditor" && adapter.health_status === "ready"), "default listing should expose ready health");
    assert(defaultResult.auto_selection_preview.some((entry) => entry.role === "auditor" && entry.action === "audit" && entry.selected_agent === "codex-auditor"), "default preview should prefer codex-auditor for audit");
    assert(Array.isArray(externalResult.roster.registered_ids) && externalResult.roster.registered_ids.includes("external-auditor"), "external listing should expose registered adapter ids");
    assert(externalResult.adapters.some((adapter) => adapter.id === "external-auditor" && adapter.source === "registered"), "external listing should expose the registered adapter");
    assert(externalResult.auto_selection_preview.some((entry) => entry.role === "auditor" && entry.action === "audit" && entry.selected_agent === "external-auditor"), "external preview should prefer the registered external auditor");
    assert(brokenResult.adapters.some((adapter) => adapter.id === "broken-auditor" && adapter.health_status === "unavailable"), "broken listing should expose unavailable health");
    assert(brokenResult.auto_selection_preview.some((entry) => entry.role === "auditor" && entry.action === "audit" && entry.selected_agent === "codex-auditor"), "broken preview should fall back to a healthy auditor");

    const output = {
      ts: new Date().toISOString(),
      default: defaultResult,
      external: externalResult,
      broken: brokenResult,
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
