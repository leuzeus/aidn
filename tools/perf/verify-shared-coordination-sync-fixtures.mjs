#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordCoordinatorArbitration } from "../runtime/coordinator-record-arbitration.mjs";
import { projectHandoffPacket } from "../runtime/project-handoff-packet.mjs";
import { runSessionPlan } from "../runtime/session-plan.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createFakeResolution() {
  const state = {
    registrations: [],
    planningStates: [],
    handoffRelays: [],
    coordinationRecords: [],
  };
  const store = {
    describeContract() {
      return {
        backend_kind: "postgres",
      };
    },
    async bootstrap() {
      return {
        ok: true,
      };
    },
    async healthcheck() {
      return {
        ok: true,
      };
    },
    async registerWorkspace(input) {
      state.registrations.push({
        type: "workspace",
        input,
      });
      return {
        ok: true,
        workspace: input,
      };
    },
    async registerWorktreeHeartbeat(input) {
      state.registrations.push({
        type: "worktree",
        input,
      });
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
      state.handoffRelays.push(input);
      return {
        ok: true,
        handoff_relay: input,
      };
    },
    async appendCoordinationRecord(input) {
      state.coordinationRecords.push(input);
      return {
        ok: true,
        coordination_record: input,
      };
    },
    async getPlanningState() {
      return {
        ok: true,
        planning_state: state.planningStates.at(-1) ?? null,
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
        records: state.coordinationRecords.slice(),
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
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-shared-coordination-sync-"));
    const targetRoot = path.join(tempRoot, "repo");
    fs.cpSync(path.resolve(process.cwd(), "tests/fixtures/perf-handoff/ready"), targetRoot, { recursive: true });

    const fake = createFakeResolution();

    const sessionPlan = await runSessionPlan({
      targetRoot,
      promote: true,
      title: "session-planning",
      items: ["define rollout"],
      questions: ["which cycle first?"],
      nextStep: "pick cycle to create",
      dispatchScope: "cycle",
      dispatchAction: "implement",
      planningArbitrationStatus: "resolved",
      sharedCoordination: fake.resolution,
    });
    assert(sessionPlan.shared_coordination_backend.backend_kind === "postgres", "session-plan should expose postgres shared coordination backend");
    assert(sessionPlan.shared_coordination_sync.ok === true, "session-plan should sync shared planning");
    assert(fake.state.planningStates.length === 1, "session-plan should write one shared planning state");

    const handoff = await projectHandoffPacket({
      targetRoot,
      sharedCoordination: fake.resolution,
    });
    assert(handoff.shared_coordination_sync.ok === true, "handoff should sync shared relay");
    assert(fake.state.handoffRelays.length === 1, "handoff should append one shared relay");

    const arbitration = await recordCoordinatorArbitration({
      targetRoot,
      decision: "continue",
      note: "validated by fixture",
      sharedCoordination: fake.resolution,
    });
    assert(arbitration.shared_coordination_sync.ok === true, "arbitration should sync shared coordination record");
    assert(fake.state.coordinationRecords.length === 1, "arbitration should append one shared coordination record");

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
