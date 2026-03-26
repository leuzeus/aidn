#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

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
  console.log("  node tools/perf/verify-coordinator-select-agent-fixtures.mjs");
  console.log("  node tools/perf/verify-coordinator-select-agent-fixtures.mjs --target tests/fixtures/repo-installed-core --json");
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
    const script = path.resolve(repoRoot, "tools", "runtime", "coordinator-select-agent.mjs");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-select-agent-"));
    const target = path.join(tempRoot, "target");
    fs.cpSync(sourceTarget, target, { recursive: true });

    const defaultAudit = runJson(script, ["--target", target, "--role", "auditor", "--action", "audit", "--json"], repoRoot, 0);
    const explicitCodex = runJson(script, ["--target", target, "--role", "auditor", "--action", "audit", "--agent", "codex", "--json"], repoRoot, 0);

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

    const externalAudit = runJson(script, ["--target", target, "--role", "auditor", "--action", "audit", "--json"], repoRoot, 0);

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
    const brokenAudit = runJson(script, ["--target", target, "--role", "auditor", "--action", "audit", "--json"], repoRoot, 0);

    assert(defaultAudit.selection.selected_agent === "codex-auditor", "default audit selection should prefer codex-auditor");
    assert(Array.isArray(defaultAudit.candidates) && defaultAudit.candidates[0]?.id === "codex-auditor", "default ranking should put codex-auditor first");
    assert(defaultAudit.candidates[0]?.health_status === "ready", "default ranking should expose candidate health");
    assert(explicitCodex.selection.selected_agent === "codex", "explicit codex selection should stay supported");
    assert(externalAudit.selection.selected_agent === "external-auditor", "external audit selection should prefer the registered adapter");
    assert(Array.isArray(externalAudit.candidates) && externalAudit.candidates[0]?.id === "external-auditor", "external ranking should put the registered adapter first");
    assert(externalAudit.candidates[0]?.health_status === "ready", "external ranking should expose ready health");
    assert(brokenAudit.selection.selected_agent === "codex-auditor", "broken external adapter should not win selection");
    assert(Array.isArray(brokenAudit.candidates) && brokenAudit.candidates.every((candidate) => candidate.id !== "broken-auditor"), "unavailable adapter should be excluded from candidates");

    const output = {
      ts: new Date().toISOString(),
      default_audit: defaultAudit,
      explicit_codex: explicitCodex,
      external_audit: externalAudit,
      broken_audit: brokenAudit,
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
      const cleanup = removePathWithRetry(tempRoot);
      if (!cleanup.ok) {
        throw cleanup.error;
      }
    }
  }
}

main();
