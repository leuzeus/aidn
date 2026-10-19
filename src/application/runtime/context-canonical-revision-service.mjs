import { createRuntimeCanonicalSnapshotReader, resolveEffectiveRuntimePersistence } from "./runtime-persistence-service.mjs";
import { sha256, stableContextJson, memoryFailure } from "../../core/context/working-memory-policy.mjs";
import { resolveRuntimeProjectContext } from "./runtime-project-context-service.mjs";

// This observation is a disposable revision marker, never a write/admission
// receipt. Each call reads one fresh snapshot from the configured authority.
export async function observeContextCanonicalRevision({ targetRoot, stateMode,
  readerFactory = createRuntimeCanonicalSnapshotReader } = {}) {
  const persistence = resolveEffectiveRuntimePersistence({ targetRoot });
  if (stateMode === "files" && persistence.backend !== "postgres") return { backend: "files", revision: null };
  try {
    const reader = readerFactory({ targetRoot, backend: persistence.backend,
      connectionRef: persistence.connectionRef ?? "" });
    const snapshot = await reader.readCanonicalSnapshot({ includePayload: true, includeRuntimeHeads: true });
    if (!snapshot?.exists || !snapshot.payload || snapshot.warning
        || !snapshot.runtimeHeads || typeof snapshot.runtimeHeads !== "object"
        || Array.isArray(snapshot.runtimeHeads)) memoryFailure("WORKING_MEMORY_REVISION_UNAVAILABLE");
    const context = resolveRuntimeProjectContext({ targetRoot });
    if (!["artifacts", "cycles", "sessions"].every(key => Array.isArray(snapshot.payload[key])))
      memoryFailure("WORKING_MEMORY_REVISION_UNAVAILABLE");
    if (persistence.backend === "postgres" && ![context.runtime_scope_id, context.legacy_scope_key].includes(snapshot.scope_key))
      memoryFailure("WORKING_MEMORY_REVISION_UNAVAILABLE");
    // generated_at is the reader's observation time on SQLite, not a revision.
    const { generated_at, summary, ...payload } = snapshot.payload;
    const scope = snapshot.scope_key ?? context.runtime_scope_id;
    return { backend: persistence.backend, scope,
      revision: sha256(stableContextJson({ scope, payload, heads: snapshot.runtimeHeads })) };
  } catch {
    // Backend errors can contain connection material. No file/SQLite fallback.
    memoryFailure("WORKING_MEMORY_REVISION_UNAVAILABLE");
  }
}
