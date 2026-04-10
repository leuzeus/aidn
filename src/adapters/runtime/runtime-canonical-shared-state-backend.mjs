import { assertSharedStateBackend } from "../../core/ports/shared-state-backend-port.mjs";

export function createRuntimeCanonicalSharedStateBackend({
  runtimeArtifactStore,
  sharedRuntimeMode = "local-only",
  coordinationBackendKind = "none",
  projectionScope = "runtime-canonical",
  logicalRoot = null,
} = {}) {
  if (!runtimeArtifactStore || typeof runtimeArtifactStore.loadSnapshot !== "function" || typeof runtimeArtifactStore.describeBackend !== "function") {
    throw new TypeError("runtimeArtifactStore must expose loadSnapshot() and describeBackend()");
  }

  function describeBackend() {
    const runtimeBackend = runtimeArtifactStore.describeBackend();
    return {
      shared_runtime_mode: sharedRuntimeMode,
      coordination_backend_kind: coordinationBackendKind,
      projection_backend_kind: runtimeBackend?.backend_kind ?? "unknown",
      projection_scope: projectionScope,
      logical_root: logicalRoot || null,
      exists: true,
      runtime_backend: runtimeBackend,
    };
  }

  async function loadSnapshot({
    includePayload = true,
    includeRuntimeHeads = true,
  } = {}) {
    return await runtimeArtifactStore.loadSnapshot({
      includePayload,
      includeRuntimeHeads,
    });
  }

  return assertSharedStateBackend({
    describeBackend,
    loadSnapshot,
  }, "RuntimeCanonicalSharedStateBackend");
}
