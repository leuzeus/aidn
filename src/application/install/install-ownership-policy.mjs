function normalizeRelativePath(value) {
  return String(value ?? "").replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "").trim();
}

const SEED_ONCE_PATHS = new Set([
  "docs/audit/baseline/current.md",
  "docs/audit/baseline/history.md",
  "docs/audit/parking-lot.md",
]);

const RUNTIME_STATE_PATHS = new Set([
  "docs/audit/snapshots/context-snapshot.md",
]);

export function resolveInstallOwnership(relativeTargetPath) {
  const normalized = normalizeRelativePath(relativeTargetPath);
  if (SEED_ONCE_PATHS.has(normalized)) {
    return "seed-once";
  }
  if (RUNTIME_STATE_PATHS.has(normalized)) {
    return "runtime-state";
  }
  return "managed-copy";
}

export function shouldSkipInstallWrite(relativeTargetPath, targetExists) {
  if (!targetExists) {
    return {
      skip: false,
      ownership: resolveInstallOwnership(relativeTargetPath),
    };
  }
  const ownership = resolveInstallOwnership(relativeTargetPath);
  if (ownership === "seed-once" || ownership === "runtime-state") {
    return {
      skip: true,
      ownership,
    };
  }
  return {
    skip: false,
    ownership,
  };
}
