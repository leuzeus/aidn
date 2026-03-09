#!/usr/bin/env node
import { createCodexAgentAdapter } from "../../src/adapters/codex/codex-agent-adapter.mjs";
import {
  AGENT_ROLES,
  buildAgentProfile,
  canAgentRolePerform,
  isKnownAgentRole,
  normalizeAgentRole,
} from "../../src/core/agents/agent-role-model.mjs";
import {
  normalizeRequestedAgentAction,
  normalizeRequestedAgentRole,
  validateAgentRoleRequest,
} from "../../src/core/ports/agent-adapter-port.mjs";

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-agent-role-model.mjs");
  console.log("  node tools/perf/verify-agent-role-model.mjs --json");
}

function parseArgs(argv) {
  const args = { json: false };
  for (const token of argv) {
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const adapter = createCodexAgentAdapter();
    const profile = adapter.getProfile();
    const synthetic = buildAgentProfile({
      id: "synthetic",
      label: "Synthetic",
      roles: ["coordinator", "implementer", "auditor", "repair"],
      defaultRole: "coordinator",
    });

    assert(Array.isArray(profile.supported_roles), "profile.supported_roles missing");
    assert(profile.supported_roles.length === AGENT_ROLES.length, "unexpected number of supported roles");
    for (const role of AGENT_ROLES) {
      assert(profile.supported_roles.includes(role), `missing role: ${role}`);
      assert(adapter.canHandleRole({ role }) === true, `adapter cannot handle role: ${role}`);
    }
    assert(adapter.canHandleRole({ role: "executor", action: "implement" }) === true, "executor should implement");
    assert(adapter.canHandleRole({ role: "auditor", action: "audit" }) === true, "auditor should audit");
    assert(adapter.canHandleRole({ role: "repair", action: "repair" }) === true, "repair should repair");
    assert(adapter.canHandleRole({ role: "executor", action: "repair" }) === false, "executor should not repair");

    assert(normalizeAgentRole("implementer") === "executor", "implementer alias should normalize to executor");
    assert(normalizeRequestedAgentRole("analyst") === "auditor", "analyst alias should normalize to auditor");
    assert(normalizeRequestedAgentAction("review") === "audit", "review action should normalize to audit");
    assert(isKnownAgentRole("executor") === true, "executor should be known");
    assert(canAgentRolePerform("coordinator", "reanchor") === true, "coordinator should reanchor");
    assert(canAgentRolePerform("repair", "implement") === false, "repair should not implement");
    assert(synthetic.supported_roles.includes("executor"), "synthetic profile should normalize implementer to executor");

    const validRequest = validateAgentRoleRequest({ role: "implementer", action: "implement" });
    assert(validRequest.role === "executor", "valid request should normalize role");
    assert(validRequest.action === "implement", "valid request should preserve action");

    const output = {
      ts: new Date().toISOString(),
      profile,
      checks: {
        adapter_supports_all_roles: true,
        alias_normalization: true,
        capability_matrix: true,
        request_validation: true,
      },
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
  }
}

main();
