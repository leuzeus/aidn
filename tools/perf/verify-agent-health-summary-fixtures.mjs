#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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
    const repoRoot = process.cwd();
    const sourceTarget = path.resolve(repoRoot, "tests/fixtures/repo-installed-core");
    const script = path.resolve(repoRoot, "tools", "runtime", "project-agent-health-summary.mjs");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-agent-health-summary-"));
    const target = path.join(tempRoot, "target");
    fs.cpSync(sourceTarget, target, { recursive: true });

    const healthy = runJson(script, ["--target", target, "--json"], repoRoot, 0);
    const healthyText = fs.readFileSync(healthy.output_file, "utf8");
    assert(healthy.verification.pass === true, "healthy fixture should pass");
    assert(healthyText.includes("# Agent Health Summary"), "health summary should include title");
    assert(healthyText.includes("codex: health=ready"), "health summary should mark codex as ready");

    fs.writeFileSync(path.join(target, "docs", "audit", "AGENT-ROSTER.md"), [
      "# Agent Roster",
      "",
      "default_agent_selection: auto",
      "",
      "## broken-external",
      "enabled: yes",
      "priority: 40",
      "roles: auditor",
      "adapter_module: .aidn/runtime/agents/missing-adapter.mjs",
      "adapter_export: createMissingAdapter",
      "",
    ].join("\n"), "utf8");

    const broken = runJson(script, ["--target", target, "--json"], repoRoot, 0);
    const brokenText = fs.readFileSync(broken.output_file, "utf8");
    assert(broken.verification.pass === false, "broken fixture should fail verification");
    assert(brokenText.includes("broken-external: health=unavailable"), "health summary should mark missing external adapter unavailable");
    assert(brokenText.includes("adapter module missing"), "health summary should surface missing module");

    const externalAgentDir = path.join(target, ".aidn", "runtime", "agents");
    fs.mkdirSync(externalAgentDir, { recursive: true });
    fs.writeFileSync(path.join(externalAgentDir, "probe-failing-adapter.mjs"), [
      "import { spawnSync } from \"node:child_process\";",
      "export function createProbeFailingAdapter({ id }) {",
      "  return {",
      "    getProfile() { return { id, label: \"Probe Failing Adapter\", default_role: \"auditor\", supported_roles: [\"auditor\"], capabilities_by_role: { auditor: [\"audit\", \"analyze\", \"relay\"] } }; },",
      "    canHandleRole({ role, action } = {}) { return role === \"auditor\" && (!action || action === \"audit\" || action === \"analyze\" || action === \"relay\"); },",
      "    checkEnvironment() { return { status: \"unavailable\", reason: \"external runner is not configured\" }; },",
      "    runCommand({ command, commandArgs = [], envOverrides = {} }) { return spawnSync(command, commandArgs, { encoding: \"utf8\", stdio: [\"ignore\", \"pipe\", \"pipe\"], cwd: process.cwd(), env: { ...process.env, ...envOverrides }, shell: false }); },",
      "  };",
      "}",
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(target, "docs", "audit", "AGENT-ROSTER.md"), [
      "# Agent Roster",
      "",
      "default_agent_selection: auto",
      "",
      "## probe-failing",
      "enabled: yes",
      "priority: 80",
      "roles: auditor",
      "adapter_module: .aidn/runtime/agents/probe-failing-adapter.mjs",
      "adapter_export: createProbeFailingAdapter",
      "",
    ].join("\n"), "utf8");

    const probeFailing = runJson(script, ["--target", target, "--json"], repoRoot, 0);
    const probeFailingText = fs.readFileSync(probeFailing.output_file, "utf8");
    assert(probeFailing.verification.pass === false, "probe-failing fixture should fail verification");
    assert(probeFailingText.includes("probe-failing: health=unavailable"), "health summary should mark environment-incompatible adapter unavailable");
    assert(probeFailingText.includes("environment: unavailable"), "health summary should expose environment status");
    assert(probeFailingText.includes("external runner is not configured"), "health summary should expose environment probe reason");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
