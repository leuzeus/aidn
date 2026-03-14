import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { listBuiltInCodexAgentAdapters } from "../../adapters/codex/codex-agent-adapter.mjs";
import { listBuiltInLocalShellAgentAdapters } from "../../adapters/local/local-shell-agent-adapter.mjs";
import { assertAgentAdapter } from "../../core/ports/agent-adapter-port.mjs";

export function listBuiltInAgentAdapters() {
  return [
    ...listBuiltInCodexAgentAdapters(),
    ...listBuiltInLocalShellAgentAdapters(),
  ];
}

function resolveExportedFactory(moduleNamespace, exportName) {
  const normalizedExport = String(exportName ?? "default").trim() || "default";
  const exported = normalizedExport === "default"
    ? moduleNamespace.default
    : moduleNamespace[normalizedExport];
  if (typeof exported !== "function" && (!exported || typeof exported !== "object")) {
    throw new Error(`Agent adapter module is missing export: ${normalizedExport}`);
  }
  return exported;
}

async function instantiateRegisteredAdapter({ targetRoot, id, config }) {
  const modulePath = String(config?.adapter_module ?? "").trim();
  if (!modulePath) {
    return null;
  }
  const absoluteModulePath = path.isAbsolute(modulePath)
    ? path.resolve(modulePath)
    : path.resolve(targetRoot, modulePath);
  const moduleNamespace = await import(pathToFileURL(absoluteModulePath).href);
  const exported = resolveExportedFactory(moduleNamespace, config?.adapter_export);
  const candidate = typeof exported === "function"
    ? await exported({
      id,
      config,
      settings: config?.settings ?? {},
      targetRoot,
      modulePath: absoluteModulePath,
    })
    : exported;
  const adapter = assertAgentAdapter(candidate, `RegisteredAgentAdapter(${id})`);
  if (adapter.getProfile().id !== id) {
    throw new Error(`Registered agent adapter id mismatch: expected ${id} but got ${adapter.getProfile().id}`);
  }
  return adapter;
}

export async function inspectRegisteredAgentAdapters({
  targetRoot,
  roster = null,
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const registeredEntries = Object.entries(roster?.agents ?? {})
    .filter(([, config]) => String(config?.adapter_module ?? "").trim());
  const inspections = [];
  for (const [id, config] of registeredEntries) {
    const modulePath = String(config?.adapter_module ?? "").trim();
    const absoluteModulePath = path.isAbsolute(modulePath)
      ? path.resolve(modulePath)
      : path.resolve(absoluteTargetRoot, modulePath);
    const exportName = String(config?.adapter_export ?? "default").trim() || "default";
    try {
      const adapter = await instantiateRegisteredAdapter({
        targetRoot: absoluteTargetRoot,
        id,
        config,
      });
      inspections.push({
        id,
        module_path: absoluteModulePath,
        export_name: exportName,
        exists: true,
        loaded: true,
        adapter,
        error: "",
      });
    } catch (error) {
      inspections.push({
        id,
        module_path: absoluteModulePath,
        export_name: exportName,
        exists: absoluteModulePath ? fs.existsSync(absoluteModulePath) : false,
        loaded: false,
        adapter: null,
        error: String(error?.message ?? error),
      });
    }
  }
  return inspections;
}

export async function loadRegisteredAgentAdapters({
  targetRoot,
  roster = null,
  ignoreLoadFailures = false,
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const adapters = [...listBuiltInAgentAdapters()];
  const registeredEntries = Object.entries(roster?.agents ?? {})
    .filter(([, config]) => String(config?.adapter_module ?? "").trim());
  for (const [id, config] of registeredEntries) {
    let adapter = null;
    try {
      adapter = await instantiateRegisteredAdapter({
        targetRoot: absoluteTargetRoot,
        id,
        config,
      });
    } catch (error) {
      if (!ignoreLoadFailures) {
        throw error;
      }
      adapter = null;
    }
    if (adapter) {
      adapters.push(adapter);
    }
  }
  return adapters;
}
