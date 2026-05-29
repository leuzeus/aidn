import path from "node:path";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function getPathModule(platform = process.platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function normalizePlatformSeparators(value, platform = process.platform) {
  const normalized = normalizeScalar(value);
  if (!normalized) {
    return "";
  }
  return platform === "win32"
    ? normalized.replace(/\//g, "\\")
    : normalized.replace(/\\/g, "/");
}

export function canonicalizeRuntimePath(candidatePath, {
  platform = process.platform,
} = {}) {
  const pathModule = getPathModule(platform);
  const normalizedInput = normalizePlatformSeparators(candidatePath, platform);
  if (!normalizedInput) {
    return "";
  }

  const normalized = pathModule.normalize(normalizedInput);
  const withoutTrailing = normalized.replace(/[\\/]+$/u, "");
  const stable = withoutTrailing.replace(/\\/g, "/");
  if (!stable) {
    return "";
  }
  return platform === "win32" ? stable.toLowerCase() : stable;
}

export function resolveRuntimePath(basePath, candidatePath, {
  platform = process.platform,
} = {}) {
  const pathModule = getPathModule(platform);
  const normalizedCandidate = normalizePlatformSeparators(candidatePath, platform);
  if (!normalizedCandidate) {
    return "";
  }
  if (pathModule.isAbsolute(normalizedCandidate)) {
    return canonicalizeRuntimePath(normalizedCandidate, { platform });
  }

  const normalizedBase = normalizePlatformSeparators(basePath, platform);
  const absoluteBase = normalizedBase || (platform === "win32" ? "C:\\" : "/");
  return canonicalizeRuntimePath(pathModule.resolve(absoluteBase, normalizedCandidate), { platform });
}

export function isSameOrChildRuntimePath(candidatePath, parentPath, {
  platform = process.platform,
} = {}) {
  const candidate = canonicalizeRuntimePath(candidatePath, { platform });
  const parent = canonicalizeRuntimePath(parentPath, { platform });
  if (!candidate || !parent) {
    return false;
  }
  return candidate === parent || candidate.startsWith(`${parent}/`);
}
