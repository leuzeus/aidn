import fs from "node:fs";
import path from "node:path";
import { readYamlFile } from "../../adapters/manifest/yaml-reader.mjs";

export function loadWorkflowManifests(repoRoot) {
  const workflowManifestPath = path.join(
    repoRoot,
    "package",
    "manifests",
    "workflow.manifest.yaml",
  );
  const compatMatrixPath = path.join(
    repoRoot,
    "package",
    "manifests",
    "compat.matrix.yaml",
  );

  if (!fs.existsSync(workflowManifestPath)) {
    throw new Error(`Missing required workflow manifest: ${workflowManifestPath}`);
  }
  if (!fs.existsSync(compatMatrixPath)) {
    throw new Error(`Missing required compatibility matrix: ${compatMatrixPath}`);
  }

  return {
    workflowManifestPath,
    compatMatrixPath,
    workflowManifest: readYamlFile(workflowManifestPath),
    compatMatrix: readYamlFile(compatMatrixPath),
  };
}

export function loadPackManifest(repoRoot, packName) {
  const manifestPath = path.join(repoRoot, "packs", packName, "manifest.yaml");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Pack manifest not found: ${manifestPath}`);
  }
  return { manifestPath, manifest: readYamlFile(manifestPath) };
}

export function resolvePackOrder(repoRoot, requestedPacks) {
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();
  const packCache = new Map();

  function visit(packName) {
    if (visited.has(packName)) {
      return;
    }
    if (visiting.has(packName)) {
      throw new Error(`Pack dependency cycle detected at: ${packName}`);
    }

    visiting.add(packName);
    let packInfo = packCache.get(packName);
    if (!packInfo) {
      packInfo = loadPackManifest(repoRoot, packName);
      packCache.set(packName, packInfo);
    }

    const dependsOn = packInfo.manifest.depends_on ?? [];
    if (!Array.isArray(dependsOn)) {
      throw new Error(`depends_on must be an array in pack ${packName}`);
    }
    for (const dep of dependsOn) {
      if (typeof dep !== "string" || !dep.trim()) {
        throw new Error(`Invalid depends_on entry in pack ${packName}`);
      }
      visit(dep.trim());
    }

    visiting.delete(packName);
    visited.add(packName);
    ordered.push(packName);
  }

  for (const pack of requestedPacks) {
    if (typeof pack !== "string" || !pack.trim()) {
      throw new Error("Requested pack list contains invalid entries");
    }
    visit(pack.trim());
  }

  return { ordered, packCache };
}
