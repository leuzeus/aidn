import path from "node:path";
import { buildCanonicalFromMarkdown } from "../../../tools/perf/markdown-render-lib.mjs";
import { createArtifactStore } from "../../../tools/runtime/artifact-store.mjs";
import {
  inferFamily,
  inferKind,
  loadContent,
  resolveStateMode,
  shouldMaterialize,
} from "../../../tools/runtime/db-first-artifact.mjs";

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
  const canonical = relPath.toLowerCase().endsWith(".md")
    ? buildCanonicalFromMarkdown(content, {
      relativePath: relPath,
      kind,
    })
    : null;

  const store = createArtifactStore({
    sqliteFile: path.isAbsolute(options.sqliteFile ?? "")
      ? options.sqliteFile
      : path.resolve(targetRoot, options.sqliteFile ?? ".aidn/runtime/index/workflow-index.sqlite"),
  });
  try {
    const artifact = store.upsertArtifact({
      path: relPath,
      kind,
      family,
      subtype: options.subtype || null,
      content,
      content_format: "utf8",
      canonical_format: canonical ? "markdown-canonical-v1" : null,
      canonical,
      session_id: options.sessionId || null,
      cycle_id: options.cycleId || null,
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
      materialized: materialize,
      artifact,
      materialize_result: materializeResult,
    };
  } finally {
    store.close();
  }
}
