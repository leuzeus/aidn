#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeCoordinatorNextAction } from "../runtime/coordinator-next-action.mjs";
import { executeCoordinatorDispatch } from "../runtime/coordinator-dispatch-execute.mjs";
import { computeCoordinatorDispatchPlan } from "../runtime/coordinator-dispatch-plan.mjs";
import { computeCoordinatorLoopState } from "../runtime/coordinator-loop.mjs";
import { orchestrateCoordinatorDispatch } from "../runtime/coordinator-orchestrate.mjs";
import { admitHandoff } from "../runtime/handoff-admit.mjs";
import { preWriteAdmit } from "../runtime/pre-write-admit.mjs";
import { projectMultiAgentStatus } from "../runtime/project-multi-agent-status.mjs";
import { projectCoordinationSummary } from "../runtime/project-coordination-summary.mjs";
import { projectHandoffPacket } from "../runtime/project-handoff-packet.mjs";
import { resumeCoordinatorDispatch } from "../runtime/coordinator-resume.mjs";
import { suggestCoordinatorArbitration } from "../runtime/coordinator-suggest-arbitration.mjs";
import { projectSharedCoordinationStatus } from "../runtime/shared-coordination-status.mjs";
import { runCycleCreateAdmitUseCase } from "../../src/application/runtime/cycle-create-admit-use-case.mjs";
import { initGitRepo, removePathWithRetry } from "./test-git-fixture-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function installCurrentStateBacklogPointer(targetRoot) {
  const currentStateFile = path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md");
  const currentStateText = fs.readFileSync(currentStateFile, "utf8");
  if (currentStateText.includes("active_backlog: backlog/BL-S101-session-planning.md")) {
    return;
  }
  fs.writeFileSync(currentStateFile, currentStateText.replace(
    "first_plan_step: implement alpha feature validation",
    [
      "first_plan_step: implement alpha feature validation",
      "active_backlog: backlog/BL-S101-session-planning.md",
      "backlog_status: promoted",
      "backlog_next_step: stale local backlog next step",
      "planning_arbitration_status: review_requested",
    ].join("\n"),
  ), "utf8");
}

function replacePacketField(packetFile, field, value) {
  const text = fs.readFileSync(packetFile, "utf8");
  const next = text.replace(new RegExp(`^${field}:\\s*.*$`, "m"), `${field}: ${value}`);
  fs.writeFileSync(packetFile, next, "utf8");
}

function createFakeResolution() {
  const state = {
    planningStates: [
      {
        workspace_id: "workspace-read-routing",
        planning_key: "session:S101",
        session_id: "S101",
        backlog_artifact_ref: "backlog/BL-S101-session-planning.md",
        planning_status: "promoted",
        planning_arbitration_status: "resolved",
        next_dispatch_scope: "cycle",
        next_dispatch_action: "implement",
        backlog_next_step: "implement alpha feature validation",
        selected_execution_scope: "current_cycle",
        dispatch_ready: true,
        source_worktree_id: "worktree-main",
        payload: {
          planning_status: "promoted",
          planning_arbitration_status: "resolved",
          next_dispatch_scope: "cycle",
          next_dispatch_action: "implement",
          backlog_next_step: "implement alpha feature validation",
          selected_execution_scope: "current_cycle",
          linked_cycles: ["C101"],
          backlog_items: ["implement alpha feature validation"],
          open_questions: [],
          addenda: [],
        },
        updated_at: "2030-01-01T00:00:00Z",
      },
    ],
    handoffRelays: [
      {
        workspace_id: "workspace-read-routing",
        relay_id: "handoff:worktree-main:2030-01-01T00:01:00Z",
        session_id: "S101",
        cycle_id: "C101",
        scope_type: "cycle",
        scope_id: "C101",
        source_worktree_id: "worktree-main",
        handoff_status: "ready",
        from_agent_role: "coordinator",
        from_agent_action: "relay",
        recommended_next_agent_role: "executor",
        recommended_next_agent_action: "implement",
        handoff_packet_ref: "docs/audit/HANDOFF-PACKET.md",
        handoff_packet_sha256: "",
        prioritized_artifacts: ["docs/audit/CURRENT-STATE.md"],
        metadata: {
          updated_at: "2030-01-01T00:01:00Z",
          handoff_status: "ready",
          handoff_from_agent_role: "coordinator",
          handoff_from_agent_action: "relay",
          recommended_next_agent_role: "executor",
          recommended_next_agent_action: "implement",
          next_agent_goal: "implement alpha feature validation",
          preferred_dispatch_source: "shared_planning",
          shared_planning_candidate_ready: "yes",
          shared_planning_candidate_aligned: "yes",
          shared_planning_dispatch_scope: "cycle",
          shared_planning_dispatch_action: "implement",
          scope_type: "cycle",
          scope_id: "C101",
          target_branch: "none",
          repair_layer_status: "unknown",
          repair_primary_reason: "unknown",
          prioritized_artifacts: ["docs/audit/CURRENT-STATE.md"],
        },
        created_at: "2030-01-01T00:01:00Z",
      },
    ],
    coordinationRecords: [
      {
        workspace_id: "workspace-read-routing",
        record_id: "coordination:1",
        record_type: "coordinator_dispatch",
        session_id: "S101",
        cycle_id: "C101",
        scope_type: "cycle",
        scope_id: "C101",
        source_worktree_id: "worktree-main",
        actor_role: "coordinator",
        actor_action: "implement",
        status: "executed",
        coordination_log_ref: "docs/audit/COORDINATION-LOG.md",
        coordination_summary_ref: "docs/audit/COORDINATION-SUMMARY.md",
        payload: {
          ts: "2030-01-01T00:02:00Z",
          event: "coordinator_dispatch",
          selected_agent: "codex",
          recommended_role: "executor",
          recommended_action: "implement",
          goal: "implement alpha feature validation",
          dispatch_status: "ready",
          execution_status: "executed",
          preferred_dispatch_source: "shared_planning",
        },
        created_at: "2030-01-01T00:02:00Z",
      },
    ],
  };

  const store = {
    describeContract() {
      return {
        backend_kind: "postgres",
      };
    },
    async bootstrap() {
      return { ok: true };
    },
    async healthcheck() {
      return {
        ok: true,
        database_name: "aidn_test",
        schema_name: "aidn_shared",
      };
    },
    async registerWorkspace(input) {
      return {
        ok: true,
        workspace: input,
      };
    },
    async registerWorktreeHeartbeat(input) {
      return {
        ok: true,
        worktree: input,
      };
    },
    async upsertPlanningState(input) {
      state.planningStates.push(input);
      return {
        ok: true,
        planning_state: input,
      };
    },
    async appendHandoffRelay(input) {
      state.handoffRelays.push({
        ...input,
        created_at: "2030-01-01T00:03:00Z",
      });
      return {
        ok: true,
        handoff_relay: state.handoffRelays.at(-1),
      };
    },
    async appendCoordinationRecord(input) {
      state.coordinationRecords.push({
        ...input,
        created_at: "2030-01-01T00:04:00Z",
      });
      return {
        ok: true,
        coordination_record: state.coordinationRecords.at(-1),
      };
    },
    async getPlanningState({ planningKey } = {}) {
      return {
        ok: true,
        planning_state: state.planningStates.find((item) => item.planning_key === planningKey) ?? null,
      };
    },
    async getLatestHandoffRelay() {
      return {
        ok: true,
        handoff_relay: state.handoffRelays.at(-1) ?? null,
      };
    },
    async listCoordinationRecords() {
      return {
        ok: true,
        records: state.coordinationRecords.slice().reverse(),
      };
    },
  };

  return {
    resolution: {
      enabled: true,
      configured: true,
      backend_kind: "postgres",
      status: "ready",
      reason: "fake postgres store",
      connection: {
        connection_ref: "env:AIDN_PG_URL",
        status: "resolved",
        driver: {
          package_name: "pg",
        },
      },
      contract: {
        driver: {
          package_name: "pg",
        },
      },
      store,
    },
    state,
  };
}

async function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-shared-read-routing-"));
    const targetRoot = path.join(tempRoot, "repo");
    fs.cpSync(path.resolve(process.cwd(), "tests/fixtures/perf-handoff/ready"), targetRoot, { recursive: true });
    installCurrentStateBacklogPointer(targetRoot);
    fs.rmSync(path.join(targetRoot, "docs", "audit", "backlog", "BL-S101-session-planning.md"), { force: true });
    initGitRepo(targetRoot, {
      workingBranch: "S101-alpha",
    });

    const fake = createFakeResolution();

    const handoff = await projectHandoffPacket({
      targetRoot,
      sharedCoordination: fake.resolution,
    });
    assert(handoff.packet.preferred_dispatch_source === "shared_planning", "handoff should prefer shared planning from shared coordination");
    assert(handoff.packet.shared_planning_candidate_ready === "yes", "handoff should expose a ready shared planning candidate");
    assert(handoff.packet.shared_planning_candidate_aligned === "yes", "handoff should expose an aligned shared planning candidate");
    assert(handoff.packet.shared_planning_artifact_source === "shared-coordination", "handoff should mark shared planning as coming from shared coordination");
    assert(handoff.packet.active_backlog === "docs/audit/backlog/BL-S101-session-planning.md", "handoff should project the shared backlog ref when the local backlog is absent");
    assert(handoff.packet.backlog_refs === "docs/audit/backlog/BL-S101-session-planning.md", "handoff should keep backlog_refs aligned with the shared backlog ref");
    assert(handoff.packet.backlog_status === "promoted", "handoff should project the shared backlog status");
    assert(handoff.packet.prioritized_artifacts.includes("docs/audit/backlog/BL-S101-session-planning.md"), "handoff should prioritize the shared backlog ref even when it is not materialized locally");
    assert(handoff.packet.backlog_next_step === "implement alpha feature validation", "handoff should expose the shared planning next step");
    assert(handoff.packet.planning_arbitration_status === "resolved", "handoff should prefer the shared planning arbitration status");

    const localPacketFile = path.join(targetRoot, "docs", "audit", "HANDOFF-PACKET.md");
    replacePacketField(localPacketFile, "updated_at", "2020-01-01T00:00:00Z");
    const sharedPreferred = await computeCoordinatorNextAction({
      targetRoot,
      sharedCoordination: fake.resolution,
    });
    assert(sharedPreferred.context.packet_source === "shared-coordination", "next-action should prefer the shared relay when it is newer than the local packet");
    assert(sharedPreferred.packet_resolution.selected_source === "shared-coordination", "packet resolution should explicitly select the shared relay");
    assert(sharedPreferred.packet_resolution.freshness_status === "shared-newer", "packet resolution should mark the shared relay as newer");

    replacePacketField(localPacketFile, "updated_at", "2035-01-01T00:00:00Z");
    const localPreferred = await computeCoordinatorNextAction({
      targetRoot,
      sharedCoordination: fake.resolution,
    });
    assert(localPreferred.context.packet_source === "file", "next-action should keep the local packet when it is newer than the shared relay");
    assert(localPreferred.packet_resolution.selected_source === "local-packet", "packet resolution should explicitly select the local packet");
    assert(localPreferred.packet_resolution.freshness_status === "local-newer", "packet resolution should mark the local packet as newer");

    replacePacketField(localPacketFile, "updated_at", localPreferred.packet_resolution.shared_relay_updated_at);
    replacePacketField(localPacketFile, "recommended_next_agent_action", "coordinate");
    const tiedDiverged = await computeCoordinatorNextAction({
      targetRoot,
      sharedCoordination: fake.resolution,
    });
    assert(tiedDiverged.context.packet_source === "file", "next-action should keep the local packet on same-age divergence");
    assert(tiedDiverged.packet_resolution.selected_source === "local-packet", "packet resolution should keep the local packet authoritative on same-age divergence");
    assert(tiedDiverged.packet_resolution.freshness_status === "same-age", "packet resolution should expose same-age freshness on tied timestamps");
    assert(tiedDiverged.packet_resolution.conflict_status === "diverged-local-preferred", "packet resolution should expose same-age divergence explicitly");

    fs.rmSync(path.join(targetRoot, "docs", "audit", "HANDOFF-PACKET.md"), { force: true });

    const nextAction = await computeCoordinatorNextAction({
      targetRoot,
      sharedCoordination: fake.resolution,
    });
    assert(nextAction.recommendation.role === "executor", "next-action should recover the role from the shared handoff relay");
    assert(nextAction.recommendation.action === "implement", "next-action should recover the action from the shared handoff relay");
    assert(nextAction.recommendation.source === "handoff-shared-planning", "next-action should preserve shared-planning provenance from the shared relay");
    assert(nextAction.context.packet_source === "shared-coordination", "next-action should mark the packet source as shared coordination when the local packet is missing");
    assert(nextAction.context.shared_planning_source === "shared-coordination", "next-action should expose shared planning provenance in context");

    const admittedSharedRelay = await admitHandoff({
      targetRoot,
      sharedCoordination: fake.resolution,
    });
    assert(admittedSharedRelay.admission_status === "admitted", "handoff-admit should admit the shared relay when the local packet is missing");
    assert(admittedSharedRelay.packet_source === "shared-coordination", "handoff-admit should expose shared coordination as the packet source when falling back to relay");
    assert(admittedSharedRelay.preferred_dispatch_source === "shared_planning", "handoff-admit should preserve shared-planning provenance from the relay");

    const dispatch = await computeCoordinatorDispatchPlan({
      targetRoot,
      sharedCoordination: fake.resolution,
    });
    assert(dispatch.shared_planning.shared_planning_source === "shared-coordination", "dispatch plan should read shared planning from shared coordination");
    assert(dispatch.shared_planning.dispatch_ready === true, "dispatch plan should expose the shared planning dispatch readiness");
    assert(dispatch.shared_planning.gate_status === "ok", "dispatch plan should admit resolved shared planning");
    assert(dispatch.notes.some((item) => String(item).includes("Shared planning backlog: backlog/BL-S101-session-planning.md")), "dispatch plan should mention the shared planning backlog");

    const status = await projectSharedCoordinationStatus({
      targetRoot,
      sharedCoordination: fake.resolution,
    });
    assert(status.snapshot?.planning_read?.status === "found", "status should expose the shared planning snapshot");
    assert(status.snapshot?.planning_read?.planning_state?.backlog_next_step === "implement alpha feature validation", "status should expose the shared planning next step");
    assert(status.snapshot?.handoff_read?.status === "found", "status should expose the latest shared handoff relay");
    assert(status.snapshot?.coordination_read?.status === "found", "status should expose recent shared coordination records");

    const preWrite = await preWriteAdmit({
      targetRoot,
      skill: "cycle-create",
      sharedCoordination: fake.resolution,
    });
    assert(preWrite.ok === false, "pre-write admission should still gate cycle-create when shared planning keeps the relay session-scoped");
    assert(preWrite.context.active_backlog === "backlog/BL-S101-session-planning.md", "pre-write admission should expose the shared planning backlog");
    assert(preWrite.context.backlog_selected_execution_scope === "current_cycle", "pre-write admission should expose the shared execution scope from shared coordination");
    assert(preWrite.context.shared_planning_source === "shared-coordination", "pre-write admission should expose shared planning provenance");
    assert(preWrite.blocking_reasons.some((item) => String(item).includes("selected execution scope is current_cycle")), "pre-write admission should enforce cycle-create scope rules from shared planning");

    fake.state.planningStates[0].selected_execution_scope = "new_cycle";
    fake.state.planningStates[0].payload.selected_execution_scope = "new_cycle";

    const cycleCreate = await runCycleCreateAdmitUseCase({
      targetRoot,
      mode: "COMMITTING",
      sharedCoordination: fake.resolution,
    });
    assert(cycleCreate.ok === true, "cycle-create admission should adopt the shared planning scope when it allows new_cycle");
    assert(cycleCreate.action === "proceed_r2_session_base_with_import", "cycle-create admission should keep the session continuity path");
    assert(cycleCreate.active_backlog === "backlog/BL-S101-session-planning.md", "cycle-create admission should expose the shared planning backlog");
    assert(cycleCreate.backlog_selected_execution_scope === "new_cycle", "cycle-create admission should expose the shared execution scope");

    const coordinationSummary = await projectCoordinationSummary({
      targetRoot,
      sharedCoordination: fake.resolution,
    });
    assert(coordinationSummary.history_source === "shared-coordination", "coordination summary should prefer shared coordination records");
    assert(coordinationSummary.summary.total_dispatches === 1, "coordination summary should count shared coordination dispatch records");
    assert(coordinationSummary.summary.last_recommended_role === "executor", "coordination summary should expose the shared dispatch recommendation");

    const loop = await computeCoordinatorLoopState({
      targetRoot,
      sharedCoordination: fake.resolution,
    });
    assert(loop.context.packet_source === "shared-coordination", "coordinator loop should preserve the shared relay packet source");
    assert(loop.loop.history_source === "shared-coordination", "coordinator loop should prefer shared coordination history");
    assert(loop.loop.history.total_dispatches === 1, "coordinator loop should see the shared dispatch record");
    assert(loop.loop.summary_source === "shared-coordination" || loop.loop.summary_source === "file", "coordinator loop should surface a valid shared-aware summary source");
    assert(fake.state.handoffRelays.length >= 2, "handoff projection should append a new shared relay");

    const arbitration = await suggestCoordinatorArbitration({
      targetRoot,
      sharedCoordination: fake.resolution,
    });
    assert(arbitration.dispatch.shared_planning.shared_planning_source === "shared-coordination", "arbitration suggestions should route dispatch planning through shared coordination");
    assert(arbitration.dispatch.shared_planning.dispatch_ready === true, "arbitration suggestions should expose the shared planning readiness from shared coordination");

    const resume = await resumeCoordinatorDispatch({
      targetRoot,
      sharedCoordination: fake.resolution,
    });
    assert(resume.resume_status === "ready", "coordinator resume should stay ready with a shared planning candidate");
    assert(resume.preferred_dispatch_source === "shared_planning", "coordinator resume should prefer the shared planning relay");
    assert(resume.context.packet_source === "shared-coordination", "coordinator resume should expose the shared relay packet source");

    const execute = await executeCoordinatorDispatch({
      targetRoot,
      sharedCoordination: fake.resolution,
    });
    assert(execute.execution_status === "dry_run", "dispatch execute without --execute should remain a dry run");
    assert(execute.dispatch_status === "ready", "dispatch execute dry run should keep the ready shared-planning dispatch");
    assert(execute.preferred_dispatch_source === "shared_planning", "dispatch execute should preserve shared-planning provenance");
    assert(execute.shared_coordination_sync?.ok === true, "dispatch execute dry run should append a shared coordination projection record");

    const multiAgentStatus = await projectMultiAgentStatus({
      targetRoot,
      sharedCoordination: fake.resolution,
    });
    assert(multiAgentStatus.coordinator.context.packet_source === "shared-coordination", "multi-agent status should reuse the shared relay packet source");
    assert(multiAgentStatus.coordination_summary.summary.total_dispatches >= 1, "multi-agent status should reuse a non-empty coordination summary");

    const orchestrated = await orchestrateCoordinatorDispatch({
      targetRoot,
      sharedCoordination: fake.resolution,
    });
    assert(orchestrated.orchestration_status === "dry_run", "coordinator-orchestrate should preserve the shared-aware ready dry-run state");
    assert(orchestrated.preferred_dispatch_source === "shared_planning", "coordinator-orchestrate should preserve shared-planning provenance");
    assert(orchestrated.initial_preview.context.packet_source === "shared-coordination", "coordinator-orchestrate should reuse the shared relay packet source");

    fake.state.handoffRelays = [];
    const currentStateFile = path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md");
    const currentStateText = fs.readFileSync(currentStateFile, "utf8")
      .replace("mode: COMMITTING", "mode: THINKING");
    fs.writeFileSync(currentStateFile, currentStateText, "utf8");
    fs.rmSync(path.join(targetRoot, "docs", "audit", "HANDOFF-PACKET.md"), { force: true });
    const fallbackNextAction = await computeCoordinatorNextAction({
      targetRoot,
      sharedCoordination: fake.resolution,
    });
    assert(fallbackNextAction.recommendation.source === "current-state-shared-planning", "next-action fallback should tag shared-planning-backed current-state routing");
    assert(fallbackNextAction.recommendation.goal === "implement alpha feature validation", "next-action fallback should reuse the shared planning next step");
    assert(fallbackNextAction.context.packet_source === "missing", "next-action fallback should expose the missing packet source when no relay exists");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
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

await main();
