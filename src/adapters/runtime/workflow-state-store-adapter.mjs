import { createIndexStore } from "../../lib/index/index-store.mjs";
import { assertWorkflowStateStore } from "../../core/ports/workflow-state-store-port.mjs";
import {
  createRuntimeArtifactStore,
  resolveEffectiveRuntimePersistence,
} from "../../application/runtime/runtime-persistence-service.mjs";

function modeWritesSqlite(mode) {
  return ["sqlite", "dual-sqlite", "all"].includes(String(mode ?? "").trim().toLowerCase());
}

export function createWorkflowStateStoreAdapter(options = {}) {
  const projectionStore = createIndexStore(options);
  const targetRoot = options.targetRoot ?? ".";
  const runtimePersistence = resolveEffectiveRuntimePersistence({
    targetRoot,
    backend: options.runtimePersistenceBackend,
    connectionRef: options.runtimePersistenceConnectionRef,
    configData: options.configData ?? null,
    env: options.env ?? process.env,
  });
  const canonicalStore = createRuntimeArtifactStore({
    ...options,
    targetRoot,
    backend: runtimePersistence.backend,
    connectionRef: options.runtimePersistenceConnectionRef ?? runtimePersistence.connectionRef ?? "",
  });
  const localProjectionPolicy = String(
    options.localProjectionPolicy
      ?? runtimePersistence.config?.localProjectionPolicy
      ?? "keep-local-sqlite",
  ).trim().toLowerCase();
  const sqliteMirrorStore = runtimePersistence.backend === "postgres"
    && localProjectionPolicy === "keep-local-sqlite"
    && !modeWritesSqlite(projectionStore.mode)
    ? createIndexStore({
      ...options,
      mode: "sqlite",
    })
    : null;

  return assertWorkflowStateStore({
    mode: projectionStore.mode,
    async writeIndex({ payload }) {
      if (runtimePersistence.backend === "sqlite") {
        return projectionStore.write(payload);
      }
      const outputs = [];
      outputs.push(...await canonicalStore.writeIndexProjection({ payload }));
      outputs.push(...projectionStore.write(payload));
      if (sqliteMirrorStore) {
        outputs.push(...sqliteMirrorStore.write(payload));
      }
      return outputs;
    },
  }, "WorkflowStateStoreAdapter");
}
