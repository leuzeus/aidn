import fs from "node:fs";
import path from "node:path";

export const SHARED_RUNTIME_LOCATOR_VERSION = 1;
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
  return {
    version: SHARED_RUNTIME_LOCATOR_VERSION,
    enabled: normalizeBoolean(base.enabled, false),
    workspaceId: normalizeString(base.workspaceId),
    backend: {
      kind: normalizeBackendKind(backend.kind ?? base.backendKind, "none"),
      root: normalizeString(backend.root ?? base.sharedRuntimeRoot),
      connectionRef: normalizeString(backend.connectionRef ?? base.connectionRef),
    },
    projection: {
      localIndexMode: normalizeString(projection.localIndexMode, DEFAULT_PROJECTION_POLICY),
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
  if (parsed.version != null && Number(parsed.version) !== SHARED_RUNTIME_LOCATOR_VERSION) {
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
