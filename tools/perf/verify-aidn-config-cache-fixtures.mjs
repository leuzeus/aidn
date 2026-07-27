#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getAidnProjectConfigCacheStats,
  readAidnProjectConfig,
  resetAidnProjectConfigCache,
  writeAidnProjectConfig,
} from "../../src/lib/config/aidn-config-lib.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readStats() {
  return getAidnProjectConfigCacheStats();
}

function writeRawConfig(targetRoot, data) {
  const filePath = path.join(targetRoot, ".aidn", "config.json");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return filePath;
}

function expectWriteFailure(targetRoot, data, label, options = {}) {
  const filePath = path.join(targetRoot, ".aidn", "config.json");
  const before = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  let error = null;
  try {
    writeAidnProjectConfig(targetRoot, data, options);
  } catch (caught) {
    error = caught;
  }
  assert(error, `${label} should fail validation or atomic replacement`);
  const after = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  assert(
    before?.equals(after) ?? after == null,
    `${label} changed the previous config bytes`,
  );
  const directory = path.dirname(filePath);
  const temps = fs.existsSync(directory)
    ? fs.readdirSync(directory).filter((name) => name.endsWith(".tmp"))
    : [];
  assert(temps.length === 0, `${label} left an atomic temp file`);
}

function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-config-cache-"));
    const targetRoot = path.join(tempRoot, "repo");
    fs.mkdirSync(targetRoot, { recursive: true });
    resetAidnProjectConfigCache();

    const missingFirst = readAidnProjectConfig(targetRoot);
    const afterMissingFirst = readStats();
    const missingSecond = readAidnProjectConfig(targetRoot);
    const afterMissingSecond = readStats();
    assert(missingFirst.exists === false, "missing config should report exists=false");
    assert(missingSecond.exists === false, "cached missing config should report exists=false");
    assert(afterMissingFirst.misses === 1, "first missing read should miss");
    assert(afterMissingSecond.hits === 1, "second missing read should hit");

    writeRawConfig(targetRoot, {
      runtime: {
        stateMode: "dual",
      },
    });
    const created = readAidnProjectConfig(targetRoot);
    const afterCreated = readStats();
    assert(created.exists === true, "created config should report exists=true");
    assert(created.data.runtime.stateMode === "dual", "created config should be read after missing-cache invalidation");
    assert(afterCreated.invalidations >= 1, "created config should invalidate cached missing state");

    created.data.runtime.stateMode = "files";
    const rereadAfterMutation = readAidnProjectConfig(targetRoot);
    const afterMutationRead = readStats();
    assert(rereadAfterMutation.data.runtime.stateMode === "dual", "returned config data should be cloned before exposing cache");
    assert(afterMutationRead.hits >= 2, "unchanged config reread should hit");

    writeRawConfig(targetRoot, {
      runtime: {
        stateMode: "db-only",
        persistence: {
          backend: "postgres",
          connectionRef: "env:AIDN_PG_URL",
        },
      },
    });
    const modified = readAidnProjectConfig(targetRoot);
    const afterModified = readStats();
    assert(modified.data.runtime.stateMode === "db-only", "modified config should invalidate cached value");
    assert(modified.data.runtime.persistence.backend === "postgres", "modified config should preserve postgres persistence config");
    assert(afterModified.invalidations >= 2, "modified config should record invalidation");

    writeAidnProjectConfig(targetRoot, {
      runtime: {
        stateMode: "files",
      },
    });
    const afterWrite = readStats();
    const written = readAidnProjectConfig(targetRoot);
    const afterWrittenRead = readStats();
    assert(afterWrite.writes === 1, "write helper should record a cache-aware write");
    assert(written.data.runtime.stateMode === "files", "write helper should clear stale cached config");
    assert(afterWrittenRead.misses >= afterWrite.misses + 1, "first read after write helper should miss");
    assert(readStats().entries === 1, "cache should contain one target config entry");

    const invalidCases = [
      ["undefined", undefined],
      ["null", null],
      ["array", []],
      ["invalid-version", { version: 0 }],
      ["invalid-profile", { profile: "shared" }],
      ["invalid-section", { runtime: [] }],
      ["invalid-state-mode", { runtime: { stateMode: "shared" } }],
      ["invalid-index-store", { runtime: { indexStoreMode: "memory" } }],
      ["invalid-backend", { runtime: { persistence: { backend: "mysql" } } }],
      ["invalid-projection", { runtime: { persistence: { localProjectionPolicy: "implicit" } } }],
      ["invalid-connection-ref", { runtime: { persistence: { connectionRef: 42 } } }],
      ["invalid-db-only-strict", { runtime: { dbOnly: { strict: "true" } } }],
      ["invalid-visible-paths", {
        runtime: { dbOnly: { visibleArtifacts: { managedRuntimePaths: ["ok", 42] } } },
      }],
      ["invalid-cleanup-policy", {
        runtime: { dbOnly: { cleanup: { quarantine: "local" } } },
      }],
      ["invalid-bundle-limit", {
        runtime: { dbOnly: { codexBundle: { targetBytes: 2, hardLimitBytes: 1 } } },
      }],
      ["invalid-canonical-backend", {
        runtime: { dbOnly: { artifactImport: { canonicalBackend: "mysql" } } },
      }],
      ["nested-undefined", { runtime: { extension: undefined } }],
    ];
    for (const [label, value] of invalidCases) {
      expectWriteFailure(targetRoot, value, label);
    }
    expectWriteFailure(
      targetRoot,
      { version: 1, profile: "files", runtime: { stateMode: "files" } },
      "late-rename-failure",
      {
        fsImpl: {
          ...fs,
          renameSync() {
            throw new Error("injected rename failure");
          },
        },
      },
    );

    const freshInvalid = path.join(tempRoot, "fresh-invalid");
    expectWriteFailure(freshInvalid, undefined, "fresh-undefined");
    assert(!fs.existsSync(freshInvalid), "fresh invalid write created target directories");

    console.log(JSON.stringify({
      ok: true,
      status: "PASS",
      cache_checks: true,
      config_validation_cases: invalidCases.length + 1,
      undefined_preserved: true,
      late_failure_preserved: true,
      temp_files: 0,
    }, null, 2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  } finally {
    resetAidnProjectConfigCache();
    if (tempRoot && fs.existsSync(tempRoot)) {
      removePathWithRetry(tempRoot);
    }
  }
}

main();
