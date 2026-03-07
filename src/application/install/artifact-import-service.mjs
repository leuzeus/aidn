import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  defaultIndexStoreFromStateMode,
  normalizeIndexStoreMode,
  normalizeStateMode,
  resolveConfigIndexStore,
  resolveConfigStateMode,
  stateModeFromIndexStore,
} from "../../lib/config/aidn-config-lib.mjs";

export function resolveArtifactImportDefaults(args, configData = {}) {
  const explicitStore = normalizeIndexStoreMode(args?.artifactImportStore);
  if (explicitStore) {
    return {
      store: explicitStore,
      withContent: explicitStore === "sqlite" || explicitStore === "dual-sqlite" || explicitStore === "all",
      stateMode: stateModeFromIndexStore(explicitStore),
      source: "cli",
    };
  }

  const envStore = normalizeIndexStoreMode(process.env.AIDN_INDEX_STORE_MODE);
  if (envStore) {
    return {
      store: envStore,
      withContent: envStore === "sqlite" || envStore === "dual-sqlite" || envStore === "all",
      stateMode: stateModeFromIndexStore(envStore),
      source: "env-index-store",
    };
  }

  const envStateMode = normalizeStateMode(process.env.AIDN_STATE_MODE);
  if (envStateMode) {
    const store = defaultIndexStoreFromStateMode(envStateMode);
    return {
      store,
      withContent: store === "sqlite" || store === "dual-sqlite" || store === "all",
      stateMode: envStateMode,
      source: "env-state-mode",
    };
  }

  const configStore = resolveConfigIndexStore(configData);
  if (configStore) {
    return {
      store: configStore,
      withContent: configStore === "sqlite" || configStore === "dual-sqlite" || configStore === "all",
      stateMode: stateModeFromIndexStore(configStore),
      source: "config-index-store",
    };
  }

  const configStateMode = resolveConfigStateMode(configData);
  if (configStateMode) {
    const store = defaultIndexStoreFromStateMode(configStateMode);
    return {
      store,
      withContent: store === "sqlite" || store === "dual-sqlite" || store === "all",
      stateMode: configStateMode,
      source: "config-state-mode",
    };
  }

  return {
    store: "dual-sqlite",
    withContent: true,
    stateMode: "dual",
    source: "default",
  };
}

export function runArtifactImport(repoRoot, targetRoot, dryRun, args, configData = {}) {
  const defaults = resolveArtifactImportDefaults(args, configData);
  const auditRoot = path.resolve(targetRoot, "docs", "audit");
  if (!fs.existsSync(auditRoot)) {
    return {
      attempted: false,
      skipped: true,
      reason: "docs/audit not found",
      defaults,
    };
  }
  const scriptPath = path.join(repoRoot, "tools", "perf", "index-sync.mjs");
  if (!fs.existsSync(scriptPath)) {
    return {
      attempted: false,
      skipped: true,
      reason: "tools/perf/index-sync.mjs not found",
      defaults,
    };
  }
  const cmd = [
    scriptPath,
    "--target",
    targetRoot,
    "--store",
    defaults.store,
    "--json",
  ];
  if (defaults.withContent) {
    cmd.push("--with-content");
  }

  if (dryRun) {
    return {
      attempted: false,
      skipped: true,
      dryRun: true,
      reason: `dry-run (would run index-sync store=${defaults.store}, state_mode=${defaults.stateMode}, source=${defaults.source})`,
    };
  }

  const result = spawnSync(process.execPath, cmd, {
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    return {
      attempted: true,
      skipped: false,
      ok: false,
      reason: `process error: ${result.error.message}`,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
    };
  }
  if (result.status !== 0) {
    return {
      attempted: true,
      skipped: false,
      ok: false,
      reason: `exit ${result.status}`,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
    };
  }

  let payload;
  try {
    payload = JSON.parse(String(result.stdout ?? "{}"));
  } catch (error) {
    return {
      attempted: true,
      skipped: false,
      ok: false,
      reason: `invalid JSON output from index-sync: ${error.message}`,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
    };
  }

  return {
    attempted: true,
    skipped: false,
    ok: true,
    payload,
    defaults,
  };
}

function expectedArtifactImportFilesForStore(store) {
  const base = ".aidn/runtime/index";
  if (store === "file") {
    return [`${base}/workflow-index.json`];
  }
  if (store === "sql") {
    return [`${base}/workflow-index.sql`];
  }
  if (store === "dual") {
    return [`${base}/workflow-index.json`, `${base}/workflow-index.sql`];
  }
  if (store === "sqlite") {
    return [`${base}/workflow-index.sqlite`];
  }
  if (store === "dual-sqlite") {
    return [`${base}/workflow-index.json`, `${base}/workflow-index.sqlite`];
  }
  if (store === "all") {
    return [
      `${base}/workflow-index.json`,
      `${base}/workflow-index.sql`,
      `${base}/workflow-index.sqlite`,
    ];
  }
  return [];
}

export function verifyArtifactImportOutputs(targetRoot, args, configData = {}) {
  if (args.dryRun) {
    return {
      checked: false,
      skipped: true,
      reason: "dry-run",
      defaults: resolveArtifactImportDefaults(args, configData),
      expected_files: [],
      missing_files: [],
    };
  }
  if (args.skipArtifactImport) {
    return {
      checked: false,
      skipped: true,
      reason: "explicit --skip-artifact-import",
      defaults: resolveArtifactImportDefaults(args, configData),
      expected_files: [],
      missing_files: [],
    };
  }
  const auditRoot = path.resolve(targetRoot, "docs", "audit");
  if (!fs.existsSync(auditRoot)) {
    return {
      checked: false,
      skipped: true,
      reason: "docs/audit not found",
      defaults: resolveArtifactImportDefaults(args, configData),
      expected_files: [],
      missing_files: [],
    };
  }
  const defaults = resolveArtifactImportDefaults(args, configData);
  const expected = expectedArtifactImportFilesForStore(defaults.store);
  const missing = expected.filter((relativePath) => !fs.existsSync(path.resolve(targetRoot, relativePath)));
  return {
    checked: true,
    skipped: false,
    ok: missing.length === 0,
    defaults,
    expected_files: expected,
    missing_files: missing,
  };
}
