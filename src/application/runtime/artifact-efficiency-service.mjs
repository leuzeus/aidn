import { createHash } from "node:crypto";
import { completeMarkdownUnit } from "../codex/scoped-context-selection.mjs";

const hash = text => createHash("sha256").update(text, "utf8").digest("hex");

// Explicit consultation only: no implicit discovery, truncation or read cache.
export function parseArtifactPaths(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 16 * 1024) throw new Error('ARTIFACT_PATHS_INVALID');
  let paths;
  try { paths = JSON.parse(value); } catch { throw new Error('ARTIFACT_PATHS_INVALID'); }
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 32
      || paths.some(p => typeof p !== 'string' || !p.trim() || p !== p.trim() || p.includes('\0'))) throw new Error('ARTIFACT_PATHS_INVALID');
  const normalized = paths.map(p => p.replace(/\\/g, '/').replace(/^docs\/audit\//i, ''));
  if (new Set(normalized).size !== paths.length) throw new Error('ARTIFACT_PATHS_DUPLICATE');
  return paths;
}

// A display projection only. Canonical content and all admission decisions stay
// in their existing services; no excerpt becomes write or workflow authority.
export function artifactAgentView(artifact, { includeContent = false, heading = "" } = {}) {
  if (!artifact) return { artifact: null };
  const { content, canonical, canonical_json, ...metadata } = artifact;
  const result = { artifact: { ...metadata, has_content: typeof content === "string" } };
  if (heading) {
    if (typeof content !== "string" || ![undefined, "utf8"].includes(artifact.content_format)) throw new Error("ARTIFACT_CONTEXT_TEXT_REQUIRED");
    const unit = completeMarkdownUnit(content, heading);
    if (!unit) throw new Error("ARTIFACT_CONTEXT_HEADING_MISSING_OR_AMBIGUOUS");
    result.context_excerpt = { ...unit, heading, source_sha256: hash(content),
      excerpt_sha256: hash(unit.content), consultative_only: true };
  } else if (includeContent) result.artifact.content = content ?? null;
  return result;
}

export { applyArtifactReplacements } from "../../core/workflow/artifact-replacements.mjs";
