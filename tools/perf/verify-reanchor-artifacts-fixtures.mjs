#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/repo-installed-core",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.target) {
    throw new Error("Missing --target");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-reanchor-artifacts-fixtures.mjs");
  console.log("  node tools/perf/verify-reanchor-artifacts-fixtures.mjs --target tests/fixtures/repo-installed-core --json");
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const auditRoot = path.join(targetRoot, "docs", "audit");
    const agentsFile = path.join(targetRoot, "AGENTS.md");
    const workflowFile = path.join(auditRoot, "WORKFLOW.md");
    const codexOnlineFile = path.join(auditRoot, "CODEX_ONLINE.md");
    const requiredFiles = [
      path.join(auditRoot, "WORKFLOW-KERNEL.md"),
      path.join(auditRoot, "CURRENT-STATE.md"),
      path.join(auditRoot, "RUNTIME-STATE.md"),
      path.join(auditRoot, "INTEGRATION-RISK.md"),
      path.join(auditRoot, "HANDOFF-PACKET.md"),
      path.join(auditRoot, "AGENT-ROSTER.md"),
      path.join(auditRoot, "AGENT-ADAPTERS.md"),
      path.join(auditRoot, "AGENT-HEALTH-SUMMARY.md"),
      path.join(auditRoot, "AGENT-SELECTION-SUMMARY.md"),
      path.join(auditRoot, "MULTI-AGENT-STATUS.md"),
      path.join(targetRoot, ".aidn", "runtime", "agents", "example-external-auditor.mjs"),
      path.join(auditRoot, "COORDINATION-SUMMARY.md"),
      path.join(auditRoot, "COORDINATION-LOG.md"),
      path.join(auditRoot, "USER-ARBITRATION.md"),
      path.join(auditRoot, "REANCHOR_PROMPT.md"),
      path.join(auditRoot, "ARTIFACT_MANIFEST.md"),
      path.join(auditRoot, "WORKFLOW_SUMMARY.md"),
      workflowFile,
      codexOnlineFile,
      path.join(auditRoot, "index.md"),
      agentsFile,
    ];

    const missingFiles = requiredFiles.filter((filePath) => !exists(filePath));

    const summaryText = exists(path.join(auditRoot, "WORKFLOW_SUMMARY.md"))
      ? readText(path.join(auditRoot, "WORKFLOW_SUMMARY.md"))
      : "";
    const indexText = exists(path.join(auditRoot, "index.md"))
      ? readText(path.join(auditRoot, "index.md"))
      : "";
    const workflowText = exists(workflowFile) ? readText(workflowFile) : "";
    const codexOnlineText = exists(codexOnlineFile) ? readText(codexOnlineFile) : "";
    const agentsText = exists(agentsFile) ? readText(agentsFile) : "";
    const currentStateText = exists(path.join(auditRoot, "CURRENT-STATE.md"))
      ? readText(path.join(auditRoot, "CURRENT-STATE.md"))
      : "";
    const runtimeStateText = exists(path.join(auditRoot, "RUNTIME-STATE.md"))
      ? readText(path.join(auditRoot, "RUNTIME-STATE.md"))
      : "";

    const checks = {
      workflow_kernel_present: exists(path.join(auditRoot, "WORKFLOW-KERNEL.md")),
      current_state_present: exists(path.join(auditRoot, "CURRENT-STATE.md")),
      runtime_state_present: exists(path.join(auditRoot, "RUNTIME-STATE.md")),
      integration_risk_present: exists(path.join(auditRoot, "INTEGRATION-RISK.md")),
      handoff_packet_present: exists(path.join(auditRoot, "HANDOFF-PACKET.md")),
      agent_roster_present: exists(path.join(auditRoot, "AGENT-ROSTER.md")),
      agent_adapters_present: exists(path.join(auditRoot, "AGENT-ADAPTERS.md")),
      agent_health_summary_present: exists(path.join(auditRoot, "AGENT-HEALTH-SUMMARY.md")),
      agent_selection_summary_present: exists(path.join(auditRoot, "AGENT-SELECTION-SUMMARY.md")),
      multi_agent_status_present: exists(path.join(auditRoot, "MULTI-AGENT-STATUS.md")),
      example_external_agent_present: exists(path.join(targetRoot, ".aidn", "runtime", "agents", "example-external-auditor.mjs")),
      coordination_summary_present: exists(path.join(auditRoot, "COORDINATION-SUMMARY.md")),
      coordination_log_present: exists(path.join(auditRoot, "COORDINATION-LOG.md")),
      user_arbitration_present: exists(path.join(auditRoot, "USER-ARBITRATION.md")),
      reanchor_prompt_present: exists(path.join(auditRoot, "REANCHOR_PROMPT.md")),
      artifact_manifest_present: exists(path.join(auditRoot, "ARTIFACT_MANIFEST.md")),
      summary_references_handoff_packet: summaryText.includes("HANDOFF-PACKET.md"),
      summary_references_kernel: summaryText.includes("WORKFLOW-KERNEL.md"),
      summary_references_current_state: summaryText.includes("CURRENT-STATE.md"),
      summary_references_runtime_state: summaryText.includes("RUNTIME-STATE.md"),
      summary_references_integration_risk: summaryText.includes("INTEGRATION-RISK.md"),
      index_references_handoff_packet: indexText.includes("HANDOFF-PACKET.md"),
      index_references_agent_roster: indexText.includes("AGENT-ROSTER.md"),
      index_references_agent_adapters: indexText.includes("AGENT-ADAPTERS.md"),
      index_references_agent_health_summary: indexText.includes("AGENT-HEALTH-SUMMARY.md"),
      index_references_agent_selection_summary: indexText.includes("AGENT-SELECTION-SUMMARY.md"),
      index_references_multi_agent_status: indexText.includes("MULTI-AGENT-STATUS.md"),
      index_references_coordination_summary: indexText.includes("COORDINATION-SUMMARY.md"),
      index_references_coordination_log: indexText.includes("COORDINATION-LOG.md"),
      index_references_user_arbitration: indexText.includes("USER-ARBITRATION.md"),
      index_references_kernel: indexText.includes("WORKFLOW-KERNEL.md"),
      index_references_current_state: indexText.includes("CURRENT-STATE.md"),
      index_references_runtime_state: indexText.includes("RUNTIME-STATE.md"),
      index_references_integration_risk: indexText.includes("INTEGRATION-RISK.md"),
      index_references_manifest: indexText.includes("ARTIFACT_MANIFEST.md"),
      workflow_references_handoff_packet: workflowText.includes("HANDOFF-PACKET.md"),
      workflow_references_kernel: workflowText.includes("WORKFLOW-KERNEL.md"),
      workflow_references_current_state: workflowText.includes("CURRENT-STATE.md"),
      workflow_references_reanchor_prompt: workflowText.includes("REANCHOR_PROMPT.md"),
      agents_references_handoff_packet: agentsText.includes("HANDOFF-PACKET.md"),
      agents_references_kernel: agentsText.includes("WORKFLOW-KERNEL.md"),
      agents_references_current_state: agentsText.includes("CURRENT-STATE.md"),
      agents_references_runtime_state: agentsText.includes("RUNTIME-STATE.md"),
      agents_references_reanchor_prompt: agentsText.includes("REANCHOR_PROMPT.md"),
      agents_has_pre_write_gate: agentsText.includes("## Pre-Write Gate (MANDATORY)"),
      agents_mentions_apply_patch: agentsText.includes("`apply_patch`"),
      current_state_references_handoff_packet: currentStateText.includes("HANDOFF-PACKET.md"),
      current_state_references_manifest: currentStateText.includes("ARTIFACT_MANIFEST.md"),
      current_state_references_runtime_state: currentStateText.includes("RUNTIME-STATE.md"),
      runtime_state_references_handoff_packet: runtimeStateText.includes("HANDOFF-PACKET.md"),
      runtime_state_mentions_freshness: runtimeStateText.includes("current_state_freshness"),
      codex_online_references_handoff_packet: codexOnlineText.includes("HANDOFF-PACKET.md"),
      codex_online_references_kernel: codexOnlineText.includes("WORKFLOW-KERNEL.md"),
      codex_online_references_current_state: codexOnlineText.includes("CURRENT-STATE.md"),
      codex_online_references_runtime_state: codexOnlineText.includes("RUNTIME-STATE.md"),
      codex_online_references_reanchor_prompt: codexOnlineText.includes("REANCHOR_PROMPT.md"),
      codex_online_mentions_apply_patch: codexOnlineText.includes("`apply_patch`"),
      codex_online_mentions_durable_write: codexOnlineText.includes("durable write"),
    };

    const pass = missingFiles.length === 0
      && Object.values(checks).every((value) => value === true);

    const output = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      audit_root: auditRoot,
      missing_files: missingFiles,
      checks,
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${targetRoot}`);
      console.log(`Missing files: ${missingFiles.length}`);
      for (const [key, value] of Object.entries(checks)) {
        console.log(`- ${key}: ${value ? "yes" : "no"}`);
      }
      console.log(`Result: ${pass ? "PASS" : "FAIL"}`);
    }

    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
