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

    console.log("PASS aidn config cache fixture checks");
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
