import path from "node:path";
import { buildCanonicalFromMarkdown } from "../../lib/workflow/markdown-render-lib.mjs";
import { createProjectArtifactStore } from './project-artifact-store-service.mjs';
import {
  inferFamily,
  inferKind,
  loadContent,
  resolveStateMode,
  shouldMaterialize,
} from "./db-first-artifact-lib.mjs";

export function runDbFirstArtifactUseCase(options = {}) {
  const targetRoot = path.resolve(process.cwd(), options.target ?? ".");
  const stateMode = resolveStateMode(targetRoot, options.stateMode);
  const relPath = String(options.path ?? "").replace(/\\/g, "/");
  if (!relPath) {
    throw new Error("Missing path for upsertDbFirstArtifact");
  }
  const content = loadContent(targetRoot, options.sourceFile ?? "", options.content ?? "");
  const kind = inferKind(relPath, options.kind ?? "other");
  const family = inferFamily(relPath, options.family ?? "unknown");
  // Selective synchronization must retain path-defined ownership just like a
  // full index projection. Otherwise a status write clears its cycle_id and
  // makes the very next canonical closure/repair read inconsistent on SQLite.
  const pathCycleId = relPath.match(/^cycles\/(C\d+)[^/]*\/status\.md$/i)?.[1]?.toUpperCase();
  const pathSessionId = relPath.match(/^sessions\/(S\d+)(?:[-_.][^/]*)?\.md$/i)?.[1]?.toUpperCase();
  if ((pathCycleId && options.cycleId && options.cycleId !== pathCycleId)
      || (pathSessionId && options.sessionId && options.sessionId !== pathSessionId)) {
    throw new Error("ARTIFACT_IDENTITY_CONFLICT");
  }
  const canonical = relPath.toLowerCase().endsWith(".md")
    ? buildCanonicalFromMarkdown(content, {
      relativePath: relPath,
      kind,
    })
    : null;

  const store = createProjectArtifactStore({
    targetRoot,
    auditRoot: options.auditRoot,
    sqliteFile: path.isAbsolute(options.sqliteFile ?? "")
      ? options.sqliteFile
      : path.resolve(targetRoot, options.sqliteFile ?? ".aidn/runtime/index/workflow-index.sqlite"),
  });
  try {
    const artifact = store.upsertArtifact({
      path: relPath,
      kind,
      family,
      subtype: options.subtype || (pathCycleId ? "status" : null),
      content,
      content_format: "utf8",
      canonical_format: canonical ? "markdown-canonical-v1" : null,
      canonical,
      session_id: options.sessionId || pathSessionId || null,
      cycle_id: options.cycleId || pathCycleId || null,
    });
    const materialize = shouldMaterialize(stateMode, options.materialize ?? "");
    let materializeResult = null;
    if (materialize) {
      materializeResult = store.materializeArtifacts({
        targetRoot,
        auditRoot: options.auditRoot ?? "docs/audit",
        onlyPaths: [relPath],
        dryRun: false,
        limit: 10,
      });
    }
    return {
      ts: new Date().toISOString(),
      ok: true,
      target_root: targetRoot,
      state_mode: stateMode,
      backend: store.backend,
      materialized: materialize,
      artifact,
      materialize_result: materializeResult,
    };
  } finally {
    store.close();
  }
}
