#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-hydrate-context-runtime-state-fixtures.mjs");
}

function runJson(script, scriptArgs, options = {}) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
  });
  return JSON.parse(stdout);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  let tempRoot = "";
  try {
    const sourceTarget = path.resolve(process.cwd(), "tests/fixtures/repo-installed-core");
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-hydrate-runtime-state-"));
    const target = path.join(tempRoot, "repo");
    fs.cpSync(sourceTarget, target, { recursive: true });

    const hydrated = runJson("tools/codex/hydrate-context.mjs", [
      "--target",
      target,
      "--skill",
      "context-reload",
      "--json",
    ]);

    const runtimeStateFile = String(hydrated?.runtime_state?.output_file ?? "");
    assert(runtimeStateFile.length > 0, "runtime_state.output_file missing");
    assert(fs.existsSync(runtimeStateFile), "runtime_state output file not written");
    assert(String(hydrated?.runtime_state?.digest?.runtime_state_mode ?? "").length > 0, "runtime_state digest missing mode");
    assert(String(hydrated?.runtime_state?.digest?.current_state_freshness ?? "").length > 0, "runtime_state digest missing freshness");
    assert(String(hydrated?.runtime_state?.mode ?? "") === "auto", "runtime_state should auto-project in dual/db-only fixture");
    const handoffPacketFile = String(hydrated?.handoff_packet?.output_file ?? "");
    assert(handoffPacketFile.length > 0, "handoff_packet.output_file missing");
    assert(fs.existsSync(handoffPacketFile), "handoff_packet output file not written");
    assert(String(hydrated?.handoff_packet?.packet?.handoff_status ?? "").length > 0, "handoff packet missing status");
    assert(String(hydrated?.handoff_packet?.mode ?? "") === "auto", "handoff packet should auto-project in dual/db-only fixture");
    const agentHealthSummaryFile = String(hydrated?.agent_health_summary?.output_file ?? "");
    assert(agentHealthSummaryFile.length > 0, "agent_health_summary.output_file missing");
    assert(fs.existsSync(agentHealthSummaryFile), "agent health summary output file not written");
    assert(String(hydrated?.agent_health_summary?.verification?.pass ?? "").length > 0, "agent health summary verification missing");
    assert(String(hydrated?.agent_health_summary?.mode ?? "") === "auto", "agent health summary should auto-project when artifact exists");
    const agentSelectionSummaryFile = String(hydrated?.agent_selection_summary?.output_file ?? "");
    assert(agentSelectionSummaryFile.length > 0, "agent_selection_summary.output_file missing");
    assert(fs.existsSync(agentSelectionSummaryFile), "agent selection summary output file not written");
    assert(Array.isArray(hydrated?.agent_selection_summary?.summary?.adapters), "agent selection summary missing adapters");
    assert(String(hydrated?.agent_selection_summary?.mode ?? "") === "auto", "agent selection summary should auto-project when artifact exists");
    const multiAgentStatusFile = String(hydrated?.multi_agent_status?.output_file ?? "");
    assert(multiAgentStatusFile.length > 0, "multi_agent_status.output_file missing");
    assert(fs.existsSync(multiAgentStatusFile), "multi-agent status output file not written");
    assert(String(hydrated?.multi_agent_status?.recommendation?.role ?? "").length > 0, "multi-agent status recommendation missing role");
    assert(String(hydrated?.multi_agent_status?.mode ?? "") === "auto", "multi-agent status should auto-project when artifact exists");

    const markdown = fs.readFileSync(runtimeStateFile, "utf8");
    assert(markdown.includes("# Runtime State Digest"), "runtime state markdown header missing");
    assert(markdown.includes("current_state_freshness:"), "runtime state markdown freshness missing");
    assert(!markdown.includes("docs/audit/cycles/none-*/status.md"), "runtime state markdown leaked none cycle path");
    assert(!markdown.includes("docs/audit/sessions/none*.md"), "runtime state markdown leaked none session path");
    const handoffMarkdown = fs.readFileSync(handoffPacketFile, "utf8");
    assert(handoffMarkdown.includes("# Handoff Packet"), "handoff packet markdown header missing");
    assert(handoffMarkdown.includes("handoff_status:"), "handoff packet markdown status missing");
    const agentHealthMarkdown = fs.readFileSync(agentHealthSummaryFile, "utf8");
    assert(agentHealthMarkdown.includes("# Agent Health Summary"), "agent health summary markdown header missing");
    assert(agentHealthMarkdown.includes("## Adapter Health"), "agent health summary adapter section missing");
    const agentSelectionMarkdown = fs.readFileSync(agentSelectionSummaryFile, "utf8");
    assert(agentSelectionMarkdown.includes("# Agent Selection Summary"), "agent selection summary markdown header missing");
    assert(agentSelectionMarkdown.includes("Auto Selection Preview"), "agent selection summary preview missing");
    const multiAgentMarkdown = fs.readFileSync(multiAgentStatusFile, "utf8");
    assert(multiAgentMarkdown.includes("# Multi-Agent Status"), "multi-agent status markdown header missing");
    assert(multiAgentMarkdown.includes("roster_verification:"), "multi-agent status markdown roster verification missing");

    const noProject = runJson("tools/codex/hydrate-context.mjs", [
      "--target",
      target,
      "--skill",
      "context-reload",
      "--no-project-runtime-state",
      "--no-project-handoff-packet",
      "--no-project-agent-health-summary",
      "--no-project-agent-selection-summary",
      "--no-project-multi-agent-status",
      "--json",
    ]);
    assert(!("runtime_state" in noProject), "runtime_state should be absent when --no-project-runtime-state is set");
    assert(!("handoff_packet" in noProject), "handoff_packet should be absent when --no-project-handoff-packet is set");
    assert(!("agent_health_summary" in noProject), "agent_health_summary should be absent when --no-project-agent-health-summary is set");
    assert(!("agent_selection_summary" in noProject), "agent_selection_summary should be absent when --no-project-agent-selection-summary is set");
    assert(!("multi_agent_status" in noProject), "multi_agent_status should be absent when --no-project-multi-agent-status is set");

    fs.rmSync(path.join(target, "docs", "audit", "RUNTIME-STATE.md"), { force: true });
    fs.rmSync(path.join(target, "docs", "audit", "HANDOFF-PACKET.md"), { force: true });
    fs.rmSync(path.join(target, "docs", "audit", "AGENT-HEALTH-SUMMARY.md"), { force: true });
    fs.rmSync(path.join(target, "docs", "audit", "AGENT-SELECTION-SUMMARY.md"), { force: true });
    fs.rmSync(path.join(target, "docs", "audit", "MULTI-AGENT-STATUS.md"), { force: true });

    const dbOnlyAutoProject = runJson("tools/codex/hydrate-context.mjs", [
      "--target",
      target,
      "--skill",
      "context-reload",
      "--json",
    ], {
      env: {
        AIDN_STATE_MODE: "db-only",
      },
    });
    assert(String(dbOnlyAutoProject?.state_mode ?? "") === "db-only", "env db-only should override stale context state mode");
    assert(String(dbOnlyAutoProject?.state_mode_source ?? "") === "env-state-mode", "state mode source should report env override");
    assert(String(dbOnlyAutoProject?.runtime_state?.mode ?? "") === "auto", "runtime_state should auto-project in db-only without preexisting file");
    assert(String(dbOnlyAutoProject?.handoff_packet?.mode ?? "") === "auto", "handoff packet should auto-project in db-only without preexisting file");
    assert(String(dbOnlyAutoProject?.agent_health_summary?.mode ?? "") === "auto", "agent health summary should auto-project in db-only without preexisting file");
    assert(String(dbOnlyAutoProject?.agent_selection_summary?.mode ?? "") === "auto", "agent selection summary should auto-project in db-only without preexisting file");
    assert(String(dbOnlyAutoProject?.multi_agent_status?.mode ?? "") === "auto", "multi-agent status should auto-project in db-only without preexisting file");
    assert(fs.existsSync(String(dbOnlyAutoProject?.runtime_state?.output_file ?? "")), "runtime_state output file should be recreated in db-only");
    assert(fs.existsSync(String(dbOnlyAutoProject?.handoff_packet?.output_file ?? "")), "handoff packet output file should be recreated in db-only");
    assert(fs.existsSync(String(dbOnlyAutoProject?.agent_health_summary?.output_file ?? "")), "agent health summary output file should be recreated in db-only");
    assert(fs.existsSync(String(dbOnlyAutoProject?.agent_selection_summary?.output_file ?? "")), "agent selection summary output file should be recreated in db-only");
    assert(fs.existsSync(String(dbOnlyAutoProject?.multi_agent_status?.output_file ?? "")), "multi-agent status output file should be recreated in db-only");

    console.log("PASS");
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
