#!/usr/bin/env node
import { planRuntimeBackendAdoption, executeRuntimeBackendAdoption } from "../../src/application/runtime/runtime-backend-adoption-service.mjs";
import { createRuntimePersistenceFakePgClientFactory } from "./runtime-persistence-fake-pg-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  try {
    const transferFake = createRuntimePersistenceFakePgClientFactory();
    const transferPlan = await planRuntimeBackendAdoption({
      targetRoot: "tests/fixtures/repo-installed-core",
      backend: "postgres",
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: transferFake.factory,
    });
    assert(transferPlan.action === "transfer-from-sqlite", "missing target schema with sqlite source should require transfer");
    assert(transferPlan.prerequisites.includes("bootstrap-target"), "missing target schema should require bootstrap before transfer");

    const transferExecution = await executeRuntimeBackendAdoption({
      targetRoot: "tests/fixtures/repo-installed-core",
      backend: "postgres",
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: transferFake.factory,
      plan: transferPlan,
      write: true,
    });
    assert(transferExecution.ok === true, "transfer execution should succeed");
    assert(transferExecution.verification?.ok === true, "transfer execution should verify digests");
    assert(transferFake.state.runtimeSnapshots.size === 1, "transfer execution should persist one canonical snapshot");
    assert(transferFake.state.adoptionEvents.length === 1, "transfer execution should record one adoption event");

    const emptyReadyFake = createRuntimePersistenceFakePgClientFactory({
      initialTables: ["schema_migrations", "runtime_snapshots", "runtime_heads", "adoption_events"],
      initialSchemaMigrations: [1],
    });
    const emptyReadyPlan = await planRuntimeBackendAdoption({
      targetRoot: "tests/fixtures/repo-empty",
      backend: "postgres",
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: emptyReadyFake.factory,
      sqliteFile: ".aidn/runtime/index/workflow-index.sqlite",
    });
    assert(emptyReadyPlan.action === "noop", "empty target with no sqlite source should stay noop");

    const partialSchemaFake = createRuntimePersistenceFakePgClientFactory({
      initialTables: ["schema_migrations", "runtime_snapshots"],
      initialSchemaMigrations: [1],
    });
    const partialSchemaPlan = await planRuntimeBackendAdoption({
      targetRoot: "tests/fixtures/repo-installed-core",
      backend: "postgres",
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: partialSchemaFake.factory,
    });
    assert(partialSchemaPlan.action === "blocked-conflict", "partial target schema with sqlite source should block");
    assert(partialSchemaPlan.blocked === true, "partial target schema should be marked blocked");

    const matchingPayloadFake = createRuntimePersistenceFakePgClientFactory({
      initialTables: ["schema_migrations", "runtime_snapshots", "runtime_heads", "adoption_events"],
      initialSchemaMigrations: [1],
      initialSnapshots: [{
        scope_key: "G:\\projets\\aidn\\tests\\fixtures\\repo-installed-core",
        project_root_ref: "G:\\projets\\aidn\\tests\\fixtures\\repo-installed-core",
        payload: {
          schema_version: 2,
          artifacts: [
            {
              path: "CURRENT-STATE.md",
              kind: "other",
              subtype: "current_state",
              sha256: "sha-fixture-current",
              updated_at: "2026-03-11T18:12:00.000Z",
            },
          ],
          summary: {
            artifacts_count: 1,
          },
        },
      }],
    });
    const matchingPlan = await planRuntimeBackendAdoption({
      targetRoot: "tests/fixtures/repo-installed-core",
      backend: "postgres",
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: matchingPayloadFake.factory,
    });
    assert(matchingPlan.action === "blocked-conflict", "existing populated target with a mismatched payload should block");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

await main();
