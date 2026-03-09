#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyAgentRoster } from "../runtime/verify-agent-roster.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  let tempRoot = "";
  try {
    const installedFixture = path.resolve(process.cwd(), "tests/fixtures/repo-installed-core");
    const installed = await verifyAgentRoster({
      targetRoot: installedFixture,
    });
    assert(installed.pass === true, "installed fixture roster should pass");
    assert(installed.entries.some((entry) => entry.id === "codex"), "installed fixture should expose codex entry");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-agent-roster-verify-"));
    const auditRoot = path.join(tempRoot, "docs", "audit");
    const agentsRoot = path.join(tempRoot, ".aidn", "runtime", "agents");
    fs.mkdirSync(auditRoot, { recursive: true });
    fs.mkdirSync(agentsRoot, { recursive: true });
    fs.writeFileSync(path.join(agentsRoot, "external-auditor.mjs"), [
      "export function createExternalAuditorAdapter({ id }) {",
      "  return {",
      "    getProfile() {",
      "      return {",
      "        id,",
      "        label: 'External Auditor Adapter',",
      "        default_role: 'auditor',",
      "        supported_roles: ['auditor'],",
      "        capabilities_by_role: { auditor: ['audit', 'analyze', 'relay'] },",
      "      };",
      "    },",
      "    canHandleRole({ role, action } = {}) {",
      "      return role === 'auditor' && (!action || action === 'audit' || action === 'analyze' || action === 'relay');",
      "    },",
      "    runCommand() {",
      "      return { status: 0, stdout: '', stderr: '' };",
      "    },",
      "  };",
      "}",
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(auditRoot, "AGENT-ROSTER.md"), [
      "# Agent Roster",
      "",
      "default_agent_selection: auto",
      "",
      "## codex",
      "enabled: yes",
      "priority: 10",
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
    const valid = await verifyAgentRoster({
      targetRoot: tempRoot,
    });
    assert(valid.pass === true, "valid external roster should pass");
    assert(valid.entries.some((entry) => entry.id === "external-auditor" && entry.ok), "external adapter entry should pass");

    fs.writeFileSync(path.join(auditRoot, "AGENT-ROSTER.md"), [
      "# Agent Roster",
      "",
      "default_agent_selection: missing-agent",
      "",
      "## ghost-agent",
      "enabled: yes",
      "priority: 10",
      "roles: auditor",
      "",
      "## broken-external",
      "enabled: yes",
      "priority: 30",
      "roles: repair",
      "adapter_module: .aidn/runtime/agents/missing-adapter.mjs",
      "adapter_export: createMissingAdapter",
      "",
      "## codex-auditor",
      "enabled: yes",
      "priority: 40",
      "roles: repair",
      "",
    ].join("\n"), "utf8");
    const invalid = await verifyAgentRoster({
      targetRoot: tempRoot,
    });
    assert(invalid.pass === false, "invalid roster should fail");
    assert(invalid.issues.some((issue) => issue.includes("default_agent_selection references unknown adapter")), "invalid roster should flag bad default");
    assert(invalid.issues.some((issue) => issue.includes("ghost-agent: unknown adapter id with no adapter_module")), "invalid roster should flag unknown agent id");
    assert(invalid.issues.some((issue) => issue.includes("broken-external: adapter module missing")), "invalid roster should flag missing module");
    assert(invalid.issues.some((issue) => issue.includes("codex-auditor: roster roles not supported by adapter: repair")), "invalid roster should flag unsupported roster roles");

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

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
