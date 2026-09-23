import path from "node:path";
import { executeCodexAssets } from "../../src/application/install/codex-assets-service.mjs";

// Keep historical corpora untouched. Only the temporary client's runtime data
// is copied; its integration assets and authorization are installed afresh.
export function isActivationFixtureSource(sourceRoot, source, { freshContext = false, freshCoordination = false } = {}) {
  const relative = path.relative(sourceRoot, source).replaceAll("\\", "/");
  return ![".git", ".agents", ".codex", ".aidn/codex", ".aidn/install", "AGENTS.md",
    ...(freshContext ? [".aidn/runtime/context"] : []),
    ...(freshCoordination ? [".aidn/runtime/context/coordination-history.ndjson", ".aidn/runtime/context/raw"] : [])]
    .some((excluded) => relative === excluded || relative.startsWith(`${excluded}/`));
}

// Test clients use the real installer and authority; no production bypass flag.
export function prepareActivationFixture(targetRoot, repoRoot = path.resolve(import.meta.dirname, "../..")) {
  const result = executeCodexAssets({ targetRoot, repoRoot, dryRun: false });
  if (!result.ok) throw new Error(`Activation fixture installation failed: ${result.errors.join("; ")}`);
  return result;
}
