import path from "node:path";

export const PRODUCT_SCAFFOLD_ROOT = "scaffold";

export function getScaffoldRelativePath(...segments) {
  return path.posix.join(PRODUCT_SCAFFOLD_ROOT, ...segments);
}

export function resolveScaffoldPath(repoRoot, ...segments) {
  return path.resolve(repoRoot, getScaffoldRelativePath(...segments));
}
