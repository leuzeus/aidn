#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    root: ".",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--root") {
      args.root = argv[i + 1] ?? "";
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
  if (!args.root) {
    throw new Error("Missing --root");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-reanchor-template.mjs");
  console.log("  node tools/perf/verify-reanchor-template.mjs --root . --json");
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const root = path.resolve(process.cwd(), args.root);

    const files = {
      kernel: path.join(root, "scaffold", "docs_audit", "WORKFLOW-KERNEL.md"),
      currentState: path.join(root, "scaffold", "docs_audit", "CURRENT-STATE.md"),
      runtimeState: path.join(root, "scaffold", "docs_audit", "RUNTIME-STATE.md"),
      integrationRisk: path.join(root, "scaffold", "docs_audit", "INTEGRATION-RISK.md"),
      handoffPacket: path.join(root, "scaffold", "docs_audit", "HANDOFF-PACKET.md"),
      agentRoster: path.join(root, "scaffold", "docs_audit", "AGENT-ROSTER.md"),
      agentAdapters: path.join(root, "scaffold", "docs_audit", "AGENT-ADAPTERS.md"),
      agentHealthSummary: path.join(root, "scaffold", "docs_audit", "AGENT-HEALTH-SUMMARY.md"),
      agentSelectionSummary: path.join(root, "scaffold", "docs_audit", "AGENT-SELECTION-SUMMARY.md"),
      multiAgentStatus: path.join(root, "scaffold", "docs_audit", "MULTI-AGENT-STATUS.md"),
      exampleExternalAgent: path.join(root, "scaffold", "runtime_agents", "example-external-auditor.mjs"),
      coordinationSummary: path.join(root, "scaffold", "docs_audit", "COORDINATION-SUMMARY.md"),
      coordinationLog: path.join(root, "scaffold", "docs_audit", "COORDINATION-LOG.md"),
      userArbitration: path.join(root, "scaffold", "docs_audit", "USER-ARBITRATION.md"),
      reanchorPrompt: path.join(root, "scaffold", "docs_audit", "REANCHOR_PROMPT.md"),
      crashRecoveryRunbook: path.join(root, "scaffold", "docs_audit", "CRASH-RECOVERY-RUNBOOK.md"),
      artifactManifest: path.join(root, "scaffold", "docs_audit", "ARTIFACT_MANIFEST.md"),
      workflowSummary: path.join(root, "scaffold", "docs_audit", "WORKFLOW_SUMMARY.md"),
      projectWorkflow: path.join(root, "scaffold", "docs_audit", "PROJECT_WORKFLOW.md"),
      index: path.join(root, "scaffold", "docs_audit", "index.md"),
      agents: path.join(root, "scaffold", "root", "AGENTS.md"),
      codexOnline: path.join(root, "scaffold", "codex", "README_CodexOnline.md"),
    };

    const missingFiles = Object.values(files).filter((filePath) => !exists(filePath));

    const workflowSummaryText = exists(files.workflowSummary) ? readText(files.workflowSummary) : "";
    const projectWorkflowText = exists(files.projectWorkflow) ? readText(files.projectWorkflow) : "";
    const indexText = exists(files.index) ? readText(files.index) : "";
    const agentsText = exists(files.agents) ? readText(files.agents) : "";
    const codexOnlineText = exists(files.codexOnline) ? readText(files.codexOnline) : "";
    const currentStateText = exists(files.currentState) ? readText(files.currentState) : "";
    const runtimeStateText = exists(files.runtimeState) ? readText(files.runtimeState) : "";
    const reanchorPromptText = exists(files.reanchorPrompt) ? readText(files.reanchorPrompt) : "";
    const crashRecoveryRunbookText = exists(files.crashRecoveryRunbook) ? readText(files.crashRecoveryRunbook) : "";

    const checks = {
      workflow_kernel_present: exists(files.kernel),
      current_state_present: exists(files.currentState),
      runtime_state_present: exists(files.runtimeState),
      integration_risk_present: exists(files.integrationRisk),
      handoff_packet_present: exists(files.handoffPacket),
      agent_roster_present: exists(files.agentRoster),
      agent_adapters_present: exists(files.agentAdapters),
      agent_health_summary_present: exists(files.agentHealthSummary),
      agent_selection_summary_present: exists(files.agentSelectionSummary),
      multi_agent_status_present: exists(files.multiAgentStatus),
      example_external_agent_present: exists(files.exampleExternalAgent),
      coordination_summary_present: exists(files.coordinationSummary),
      coordination_log_present: exists(files.coordinationLog),
      user_arbitration_present: exists(files.userArbitration),
      reanchor_prompt_present: exists(files.reanchorPrompt),
      crash_recovery_runbook_present: exists(files.crashRecoveryRunbook),
      artifact_manifest_present: exists(files.artifactManifest),
      summary_references_handoff_packet: workflowSummaryText.includes("HANDOFF-PACKET.md"),
      summary_references_kernel: workflowSummaryText.includes("WORKFLOW-KERNEL.md"),
      summary_references_current_state: workflowSummaryText.includes("CURRENT-STATE.md"),
      summary_references_runtime_state: workflowSummaryText.includes("RUNTIME-STATE.md"),
      summary_references_integration_risk: workflowSummaryText.includes("INTEGRATION-RISK.md"),
      project_workflow_references_handoff_packet: projectWorkflowText.includes("HANDOFF-PACKET.md"),
      project_workflow_references_kernel: projectWorkflowText.includes("WORKFLOW-KERNEL.md"),
      project_workflow_references_current_state: projectWorkflowText.includes("CURRENT-STATE.md"),
      project_workflow_references_reanchor_prompt: projectWorkflowText.includes("REANCHOR_PROMPT.md"),
      project_workflow_references_crash_recovery_runbook: projectWorkflowText.includes("CRASH-RECOVERY-RUNBOOK.md"),
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
      index_references_crash_recovery_runbook: indexText.includes("CRASH-RECOVERY-RUNBOOK.md"),
      index_references_manifest: indexText.includes("ARTIFACT_MANIFEST.md"),
      agents_references_handoff_packet: agentsText.includes("HANDOFF-PACKET.md"),
      agents_references_agent_adapters: agentsText.includes("AGENT-ADAPTERS.md"),
      agents_references_kernel: agentsText.includes("WORKFLOW-KERNEL.md"),
      agents_references_current_state: agentsText.includes("CURRENT-STATE.md"),
      agents_references_runtime_state: agentsText.includes("RUNTIME-STATE.md"),
      agents_references_reanchor_prompt: agentsText.includes("REANCHOR_PROMPT.md"),
      agents_references_crash_recovery_runbook: agentsText.includes("CRASH-RECOVERY-RUNBOOK.md"),
      agents_mentions_shared_planning_handoff: agentsText.includes("prefer `backlog_refs` first when `preferred_dispatch_source=shared_planning`"),
      agents_has_pre_write_gate: agentsText.includes("## Pre-Write Gate (MANDATORY)"),
      agents_mentions_apply_patch: agentsText.includes("`apply_patch`"),
      agents_mentions_start_session_read_only_admission: agentsText.includes("read-only intent prevents durable writes; it does not exempt the agent from session admission"),
      current_state_references_handoff_packet: currentStateText.includes("HANDOFF-PACKET.md"),
      current_state_references_manifest: currentStateText.includes("ARTIFACT_MANIFEST.md"),
      current_state_references_runtime_state: currentStateText.includes("RUNTIME-STATE.md"),
      runtime_state_references_handoff_packet: runtimeStateText.includes("HANDOFF-PACKET.md"),
      runtime_state_mentions_freshness: runtimeStateText.includes("current_state_freshness"),
      reanchor_prompt_references_crash_recovery_runbook: reanchorPromptText.includes("CRASH-RECOVERY-RUNBOOK.md"),
      reanchor_prompt_mentions_dispatch_source: reanchorPromptText.includes("preferred dispatch source"),
      reanchor_prompt_mentions_shared_planning_candidate: reanchorPromptText.includes("shared planning candidate readiness/alignment"),
      reanchor_prompt_mentions_backlog_refs: reanchorPromptText.includes("backlog_refs"),
      crash_recovery_runbook_mentions_skill: crashRecoveryRunbookText.includes("`crash-recovery` skill"),
      crash_recovery_runbook_mentions_handoff_admit: crashRecoveryRunbookText.includes("handoff-admit"),
      crash_recovery_runbook_mentions_session_plan_promote: crashRecoveryRunbookText.includes("session-plan --target . --session-id S###"),
      crash_recovery_runbook_mentions_reanchor: crashRecoveryRunbookText.includes("shared-runtime-reanchor"),
      codex_online_references_handoff_packet: codexOnlineText.includes("HANDOFF-PACKET.md"),
      codex_online_references_kernel: codexOnlineText.includes("WORKFLOW-KERNEL.md"),
      codex_online_references_current_state: codexOnlineText.includes("CURRENT-STATE.md"),
      codex_online_references_runtime_state: codexOnlineText.includes("RUNTIME-STATE.md"),
      codex_online_references_reanchor_prompt: codexOnlineText.includes("REANCHOR_PROMPT.md"),
      codex_online_mentions_shared_planning_handoff: codexOnlineText.includes("preferred_dispatch_source=shared_planning"),
      codex_online_mentions_apply_patch: codexOnlineText.includes("`apply_patch`"),
      codex_online_mentions_durable_write: codexOnlineText.includes("durable write"),
      codex_online_mentions_start_session_read_only_admission: codexOnlineText.includes("still run `start-session` even when the immediate user request is analysis-only"),
    };

    const pass = missingFiles.length === 0
      && Object.values(checks).every((value) => value === true);

    const output = {
      ts: new Date().toISOString(),
      root,
      files,
      missing_files: missingFiles,
      checks,
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Root: ${root}`);
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
