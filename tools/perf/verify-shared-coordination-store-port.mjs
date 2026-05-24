#!/usr/bin/env node
import { SHARED_COORDINATION_STORE_METHODS, assertSharedCoordinationStore } from "../../src/core/ports/shared-coordination-store-port.mjs";
import { createPostgresSharedCoordinationStore } from "../../src/adapters/runtime/postgres-shared-coordination-store.mjs";

function verify() {
  const expectedMethods = [
    "describeContract",
    "bootstrap",
    "registerWorkspace",
    "registerWorktreeHeartbeat",
    "upsertPlanningState",
    "appendHandoffRelay",
    "appendCoordinationRecord",
    "getPlanningState",
    "getLatestHandoffRelay",
    "listCoordinationRecords",
    "healthcheck",
  ];
  const issues = [];

  if (JSON.stringify(SHARED_COORDINATION_STORE_METHODS) !== JSON.stringify(expectedMethods)) {
    issues.push("shared coordination store method list does not match the expected minimal port");
  }

  const store = createPostgresSharedCoordinationStore({
    connectionString: "postgres://example.invalid:5432/aidn",
    env: {},
  });

  try {
    assertSharedCoordinationStore(store, "PostgresSharedCoordinationStore");
  } catch (error) {
    issues.push(`store contract assertion failed: ${error.message}`);
  }

  if (typeof store.describeContract !== "function" || typeof store.healthcheck !== "function") {
    issues.push("store is missing required port methods");
  }

  const contract = store.describeContract();
  if (!contract || typeof contract !== "object") {
    issues.push("describeContract did not return an object");
  } else {
    const tables = Array.isArray(contract.tables) ? contract.tables.map((entry) => entry.table).filter(Boolean) : [];
    for (const table of ["workspace_registry", "worktree_registry", "planning_states", "handoff_relays", "coordination_records"]) {
      if (!tables.includes(table)) {
        issues.push(`describeContract is missing shared table ${table}`);
      }
    }
  }

  return {
    ok: issues.length === 0,
    method_count: SHARED_COORDINATION_STORE_METHODS.length,
    issues,
  };
}

function main() {
  const output = verify();
  if (output.ok) {
    console.log("Shared coordination store port: PASS");
    console.log(`- method_count=${output.method_count}`);
  } else {
    console.log("Shared coordination store port: FAIL");
    for (const issue of output.issues) {
      console.log(`- ${issue}`);
    }
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
