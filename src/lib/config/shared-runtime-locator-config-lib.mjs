import fs from "node:fs";
import path from "node:path";

export const SHARED_RUNTIME_LOCATOR_VERSION = 2;
const SUPPORTED_SHARED_RUNTIME_LOCATOR_VERSIONS = new Set([1, 2]);
export const VALID_SHARED_RUNTIME_BACKEND_KINDS = new Set(["none", "sqlite-file", "postgres"]);
const DEFAULT_PROJECTION_POLICY = "preserve-current";

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeBackendKind(value, fallback = "none") {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (!VALID_SHARED_RUNTIME_BACKEND_KINDS.has(normalized)) {
    throw new Error(`Invalid shared runtime backend kind: ${value}`);
  }
  return normalized;
}

export function resolveSharedRuntimeLocatorPath(targetRoot) {
  return path.resolve(targetRoot, ".aidn", "project", "shared-runtime.locator.json");
}

export function resolveSharedRuntimeLocatorRef() {
  return ".aidn/project/shared-runtime.locator.json";
}

export function createDefaultSharedRuntimeLocator(data = {}) {
  return normalizeSharedRuntimeLocator(data);
}

export function normalizeSharedRuntimeLocator(data = {}) {
  const base = isPlainObject(data) ? data : {};
  const backend = isPlainObject(base.backend) ? base.backend : {};
  const projection = isPlainObject(base.projection) ? base.projection : {};
  const project = isPlainObject(base.project) ? base.project : {};
  const compat = isPlainObject(base.compat) ? base.compat : {};
  const rawVersion = Number(base.version ?? 1);
  if (!SUPPORTED_SHARED_RUNTIME_LOCATOR_VERSIONS.has(rawVersion)) {
    throw new Error(`Unsupported shared runtime locator version: ${base.version}`);
  }
  const workspaceId = normalizeString(base.workspaceId);
  const projectId = normalizeString(base.projectId, rawVersion === 1 ? workspaceId : "");
  const legacyWorkspaceIdentity = normalizeString(compat.legacyWorkspaceIdentity, workspaceId);
  return {
    version: SHARED_RUNTIME_LOCATOR_VERSION,
    enabled: normalizeBoolean(base.enabled, false),
    projectId,
    workspaceId,
    project: {
      root: normalizeString(project.root ?? base.projectRoot),
      rootRef: normalizeString(project.rootRef, "none"),
    },
    backend: {
      kind: normalizeBackendKind(backend.kind ?? base.backendKind, "none"),
      root: normalizeString(backend.root ?? base.sharedRuntimeRoot),
      connectionRef: normalizeString(backend.connectionRef ?? base.connectionRef),
    },
    projection: {
      localIndexMode: normalizeString(projection.localIndexMode, DEFAULT_PROJECTION_POLICY),
    },
    compat: {
      legacyWorkspaceIdentity,
    },
  };
}

export function readSharedRuntimeLocator(targetRoot) {
  const filePath = resolveSharedRuntimeLocatorPath(targetRoot);
  if (!fs.existsSync(filePath)) {
    return {
      exists: false,
      path: filePath,
      ref: resolveSharedRuntimeLocatorRef(),
      data: createDefaultSharedRuntimeLocator(),
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`Invalid config root in ${filePath}: expected JSON object`);
  }
  if (parsed.version != null && !SUPPORTED_SHARED_RUNTIME_LOCATOR_VERSIONS.has(Number(parsed.version))) {
    throw new Error(`Unsupported shared runtime locator version in ${filePath}: ${parsed.version}`);
  }

  return {
    exists: true,
    path: filePath,
    ref: resolveSharedRuntimeLocatorRef(),
    data: normalizeSharedRuntimeLocator(parsed),
  };
}

export function readSharedRuntimeLocatorSafe(targetRoot) {
  const filePath = resolveSharedRuntimeLocatorPath(targetRoot);
  const ref = resolveSharedRuntimeLocatorRef();
  if (!fs.existsSync(filePath)) {
    return {
      exists: false,
      valid: true,
      path: filePath,
      ref,
      data: createDefaultSharedRuntimeLocator(),
      error: null,
    };
  }

  try {
    const state = readSharedRuntimeLocator(targetRoot);
    return {
      ...state,
      valid: true,
      error: null,
    };
  } catch (error) {
    return {
      exists: true,
      valid: false,
      path: filePath,
      ref,
      data: createDefaultSharedRuntimeLocator(),
      error: {
        message: String(error?.message ?? error),
      },
    };
  }
}

export function writeSharedRuntimeLocator(targetRoot, data) {
  const filePath = resolveSharedRuntimeLocatorPath(targetRoot);
  const normalized = normalizeSharedRuntimeLocator(data);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return filePath;
}

export function findDescendantSharedRuntimeLocators(targetRoot, {
  maxResults = Infinity,
  skipDirs = [".git", "node_modules", ".next", ".turbo", "dist", "build"],
} = {}) {
  const root = path.resolve(targetRoot);
  const results = [];
  const skipped = new Set(skipDirs.map((entry) => normalizeString(entry)));

  function visit(currentRoot) {
    if (results.length >= maxResults) {
      return;
    }

    const locatorPath = resolveSharedRuntimeLocatorPath(currentRoot);
    if (currentRoot !== root && fs.existsSync(locatorPath)) {
      results.push(locatorPath);
      if (results.length >= maxResults) {
        return;
      }
    }

    let entries = [];
    try {
      entries = fs.readdirSync(currentRoot, {
        withFileTypes: true,
      });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) {
        return;
      }
      if (!entry.isDirectory()) {
        continue;
      }
      if (skipped.has(normalizeString(entry.name))) {
        continue;
      }
      visit(path.join(currentRoot, entry.name));
    }
  }

  visit(root);
  return results;
}
