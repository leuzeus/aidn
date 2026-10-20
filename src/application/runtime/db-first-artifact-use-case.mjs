import path from "node:path";
import { buildCanonicalFromMarkdown } from "../../lib/workflow/markdown-render-lib.mjs";
import { createProjectArtifactStore } from './project-artifact-store-service.mjs';
import { applyArtifactReplacements } from './artifact-efficiency-service.mjs';
import { assertProjectArtifactCompareSwap } from '../../core/ports/project-artifact-store-port.mjs';
import { artifactMetadataHash } from '../../core/workflow/artifact-compare-swap.mjs';
import { resolveEffectiveRuntimePersistence } from './runtime-persistence-service.mjs';
import { readAidnProjectConfig, resolveConfigStateMode, resolveConfigRuntimePersistence } from '../../lib/config/aidn-config-lib.mjs';
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
  const replacing = options.replacements !== undefined;
  if (replacing && (options.sourceFile || options.content || options.kind && options.kind !== 'other'
      || options.family && options.family !== 'unknown' || options.subtype || options.sessionId || options.cycleId)) {
    throw new Error('ARTIFACT_REPLACEMENTS_OPTIONS_CONFLICT');
  }
  if (!replacing && options.expectedSha256 !== undefined) throw new Error('ARTIFACT_REPLACEMENTS_REQUIRED');
  if (replacing) {
    const config = readAidnProjectConfig(targetRoot);
    const configuredBackend = resolveConfigRuntimePersistence(config.data)?.backend;
    const backend = resolveEffectiveRuntimePersistence({ targetRoot, configData: config.data }).backend;
    if (configuredBackend === 'postgres' && backend !== 'postgres') throw new Error('ARTIFACT_REPLACEMENTS_CANONICAL_BACKEND_CONFLICT');
    // In files mode SQLite is an index, not the canonical preimage. Never
    // materialize a delta built from it over a newer authoritative file. The
    // legacy state-mode flag controls projection and cannot transfer authority.
    if ((resolveConfigStateMode(config.data) ?? 'files') === 'files' && backend !== 'postgres') {
      throw new Error('ARTIFACT_REPLACEMENTS_CANONICAL_DATABASE_REQUIRED');
    }
  }
  const fullContent = replacing ? null : loadContent(targetRoot, options.sourceFile ?? "", options.content ?? "");
  const pathCycleId = relPath.match(/^cycles\/(C\d+)[^/]*\/status\.md$/i)?.[1]?.toUpperCase();
  const pathSessionId = relPath.match(/^sessions\/(S\d+)(?:[-_.][^/]*)?\.md$/i)?.[1]?.toUpperCase();
  if ((pathCycleId && options.cycleId && options.cycleId !== pathCycleId)
      || (pathSessionId && options.sessionId && options.sessionId !== pathSessionId)) throw new Error("ARTIFACT_IDENTITY_CONFLICT");
  const store = createProjectArtifactStore({
    targetRoot,
    auditRoot: options.auditRoot,
    sqliteFile: path.isAbsolute(options.sqliteFile ?? "")
      ? options.sqliteFile
      : path.resolve(targetRoot, options.sqliteFile ?? ".aidn/runtime/index/workflow-index.sqlite"),
  });
  try {
    const previous = replacing ? store.getArtifact(relPath) : null;
    const content = replacing ? applyArtifactReplacements(previous, options.replacements, options.expectedSha256)
      : fullContent;
    const kind = previous?.kind ?? inferKind(relPath, options.kind ?? "other");
    const family = previous?.family ?? inferFamily(relPath, options.family ?? "unknown");
    const canonical = relPath.toLowerCase().endsWith(".md")
      ? buildCanonicalFromMarkdown(content, {
        relativePath: relPath,
        kind,
      })
      : null;

    const input = {
      ...(previous ?? {}),
      path: relPath,
      kind,
      family,
      subtype: previous?.subtype ?? (options.subtype || (pathCycleId ? "status" : null)),
      content,
      content_format: "utf8",
      canonical_format: canonical ? "markdown-canonical-v1" : null,
      canonical,
      session_id: previous?.session_id ?? (options.sessionId || pathSessionId || null),
      cycle_id: previous?.cycle_id ?? (options.cycleId || pathCycleId || null),
      sha256: undefined,
      size_bytes: undefined,
      updated_at: undefined,
      mtime_ns: undefined,
    };
    const artifact = replacing ? assertProjectArtifactCompareSwap(store).compareAndSwapArtifact({
      artifact: input, expectedSha256: options.expectedSha256, expectedMetadataSha256: artifactMetadataHash(previous),
    }) : store.upsertArtifact(input);
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
      ...(replacing ? { mutation: { kind: 'compare-and-swap-replacements', expected_sha256: options.expectedSha256,
        replacements: options.replacements.length } } : {}),
      materialize_result: materializeResult,
    };
  } finally {
    store.close();
  }
}
