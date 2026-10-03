#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getAidnProjectConfigCacheStats,
  inspectInstalledAidnVersion,
  isAidnProductVersion,
  readAidnProjectConfig,
  resetAidnProjectConfigCache,
  validateAidnProjectConfig,
  withInstalledAidnVersion,
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

function verifyFreshConfigReads(tempRoot) {
  resetAidnProjectConfigCache();
  const checks = {};
  const check = (name, condition) => {
    assert(condition, name);
    checks[name] = true;
  };
  const expectReadFailure = (root, label, pattern, options = {}) => {
    let error;
    try { readAidnProjectConfig(root, options); } catch (caught) { error = caught; }
    check(label, Boolean(error) && pattern.test(String(error.message)));
    check(`${label}_uncached`, readStats().entries === 0);
    return error;
  };
  const config = ref => ({ runtime: { stateMode: "dual", persistence: { backend: "postgres", connectionRef: ref } } });
  const root = path.join(tempRoot, "physical-freshness");
  const file = writeRawConfig(root, config("env:ALPHA"));
  const stamp = new Date("2020-01-01T00:00:00Z");
  fs.utimesSync(file, stamp, stamp);
  readAidnProjectConfig(root);
  const before = fs.statSync(file, { bigint: true });
  const replacement = path.join(root, ".aidn", "replacement.json");
  fs.writeFileSync(replacement, `${JSON.stringify(config("env:BRAVO"), null, 2)}\n`);
  fs.utimesSync(replacement, stamp, stamp);
  fs.renameSync(replacement, file);
  const replaced = fs.statSync(file, { bigint: true });
  check("atomic_replacement_fixture_equal_mtime_and_size", before.mtimeNs === replaced.mtimeNs && before.size === replaced.size && before.ino !== replaced.ino);
  check("atomic_replacement_reads_fresh_connection_ref", readAidnProjectConfig(root).data.runtime.persistence.connectionRef === "env:BRAVO");
  writeRawConfig(root, config("env:DELTA"));
  fs.utimesSync(file, stamp, stamp);
  const inPlace = fs.statSync(file, { bigint: true });
  check("in_place_fixture_equal_inode_mtime_and_size", replaced.ino === inPlace.ino && replaced.mtimeNs === inPlace.mtimeNs && replaced.size === inPlace.size && replaced.ctimeNs !== inPlace.ctimeNs);
  const fresh = readAidnProjectConfig(root);
  check("in_place_write_reads_fresh_connection_ref", fresh.data.runtime.persistence.connectionRef === "env:DELTA");
  fresh.data.runtime.persistence.connectionRef = "env:POISON";
  check("nested_returns_are_cloned", readAidnProjectConfig(root).data.runtime.persistence.connectionRef === "env:DELTA");
  const otherRoot = path.join(tempRoot, "other-project");
  writeRawConfig(otherRoot, config("env:OTHER"));
  check("target_roots_have_independent_values", readAidnProjectConfig(otherRoot).data.runtime.persistence.connectionRef === "env:OTHER"
    && readAidnProjectConfig(root).data.runtime.persistence.connectionRef === "env:DELTA");
  fs.unlinkSync(file);
  check("deletion_invalidates_positive_cache", readAidnProjectConfig(root).exists === false);
  const negativeStats = readStats();
  check("unchanged_absence_hits_negative_cache", readAidnProjectConfig(root).exists === false && readStats().hits === negativeStats.hits + 1);
  writeRawConfig(root, config("env:BRAVO"));
  check("creation_invalidates_negative_cache", readAidnProjectConfig(root).data.runtime.persistence.connectionRef === "env:BRAVO");

  for (const field of ["dev", "ino", "mtimeNs", "ctimeNs", "size"]) {
    resetAidnProjectConfigCache();
    const signature = Object.fromEntries(["dev", "ino", "mtimeNs", "ctimeNs", "size"].map(key => [key, 2n ** 54n]));
    let text = JSON.stringify(config("env:ALPHA"));
    let reads = 0, stats = 0;
    const fsImpl = {
      statSync(_path, options) { assert(options.bigint === true, "stat must request lossless metadata"); stats += 1; return { ...signature, isFile: () => true }; },
      readFileSync() { reads += 1; return text; },
    };
    const syntheticRoot = path.join(tempRoot, `precision-${field}`);
    readAidnProjectConfig(syntheticRoot, { fsImpl });
    const firstStats = stats;
    readAidnProjectConfig(syntheticRoot, { fsImpl });
    check(`${field}_hit_still_observes_signature`, reads === 1 && stats === firstStats + 1);
    signature[field] += 1n;
    text = JSON.stringify(config("env:BRAVO"));
    check(`${field}_one_unit_change_above_safe_integer_invalidates`, readAidnProjectConfig(syntheticRoot, { fsImpl }).data.runtime.persistence.connectionRef === "env:BRAVO");
  }

  resetAidnProjectConfigCache();
  const raceRoot = path.join(tempRoot, "read-replacement");
  const raceFile = writeRawConfig(raceRoot, config("env:ALPHA"));
  fs.utimesSync(raceFile, stamp, stamp);
  let replacementReads = 0;
  const replacementFs = { ...fs, readFileSync(...args) {
    const text = fs.readFileSync(...args);
    if (++replacementReads === 1) {
      const next = `${raceFile}.replacement`;
      fs.writeFileSync(next, `${JSON.stringify(config("env:BRAVO"), null, 2)}\n`);
      fs.utimesSync(next, stamp, stamp);
      fs.renameSync(next, raceFile);
    }
    return text;
  } };
  const replacementRead = readAidnProjectConfig(raceRoot, { fsImpl: replacementFs });
  check("mid_read_replacement_retries_fresh_bytes", replacementRead.data.runtime.persistence.connectionRef === "env:BRAVO" && replacementReads === 2);
  replacementRead.data.runtime.persistence.connectionRef = "env:POISON";
  check("stable_retry_result_is_cloned_and_cached", readAidnProjectConfig(raceRoot, { fsImpl: replacementFs }).data.runtime.persistence.connectionRef === "env:BRAVO" && replacementReads === 2);

  resetAidnProjectConfigCache();
  const transientRoot = path.join(tempRoot, "transient-json");
  const transientFile = writeRawConfig(transientRoot, {});
  fs.writeFileSync(transientFile, "{");
  let transientReads = 0;
  const transientFs = { ...fs, readFileSync(...args) {
    const text = fs.readFileSync(...args);
    if (++transientReads === 1) writeRawConfig(transientRoot, config("env:BRAVO"));
    return text;
  } };
  check("changing_invalid_json_retries_before_validation", readAidnProjectConfig(transientRoot, { fsImpl: transientFs }).data.runtime.persistence.connectionRef === "env:BRAVO" && transientReads === 2);
  fs.writeFileSync(transientFile, "{");
  expectReadFailure(transientRoot, "stable_invalid_json_fails", /Invalid JSON/);
  fs.writeFileSync(transientFile, "[]");
  expectReadFailure(transientRoot, "stable_non_object_json_fails", /expected JSON object/);

  resetAidnProjectConfigCache();
  let mutationReads = 0;
  const mutableStat = { dev: 1n, ino: 2n, mtimeNs: 3n, ctimeNs: 4n, size: 5n };
  const mutationFs = {
    statSync() { return { ...mutableStat, isFile: () => true }; },
    readFileSync() { mutationReads += 1; mutableStat.ctimeNs += 1n; return JSON.stringify(config("env:BRAVO")); },
  };
  expectReadFailure(path.join(tempRoot, "continuous-mutation"), "continuous_mutation_fails_diagnostically", /no stable observation after 3 attempts/, { fsImpl: mutationFs });
  check("continuous_mutation_read_attempts_are_bounded", mutationReads === 3);

  resetAidnProjectConfigCache();
  const disappearingRoot = path.join(tempRoot, "disappearing");
  const disappearingFile = writeRawConfig(disappearingRoot, config("env:ALPHA"));
  let disappearanceReads = 0;
  const disappearingFs = { ...fs, readFileSync() {
    disappearanceReads += 1;
    fs.unlinkSync(disappearingFile);
    throw Object.assign(new Error("injected read disappearance"), { code: "ENOENT" });
  } };
  const disappeared = readAidnProjectConfig(disappearingRoot, { fsImpl: disappearingFs });
  check("read_enoent_observes_optional_absence", disappeared.exists === false && disappearanceReads === 1 && Object.keys(disappeared.data).length === 0);
  writeRawConfig(disappearingRoot, config("env:BRAVO"));
  let retryReads = 0;
  const retryFs = { ...fs, readFileSync(...args) {
    if (++retryReads === 1) {
      writeRawConfig(disappearingRoot, config("env:DELTA"));
      throw Object.assign(new Error("injected replacement disappearance"), { code: "ENOENT" });
    }
    return fs.readFileSync(...args);
  } };
  check("read_enoent_replacement_retries_fresh_config", readAidnProjectConfig(disappearingRoot, { fsImpl: retryFs }).data.runtime.persistence.connectionRef === "env:DELTA" && retryReads === 2);

  resetAidnProjectConfigCache();
  const errorRoot = path.join(tempRoot, "read-errors");
  const errorFile = writeRawConfig(errorRoot, config("env:ALPHA"));
  let statDenied = false, readDenied = false;
  const denied = () => Object.assign(new Error("injected config access denied"), { code: "EACCES" });
  const errorFs = { ...fs,
    statSync(...args) { if (statDenied) throw denied(); return fs.statSync(...args); },
    readFileSync(...args) { if (readDenied) throw denied(); return fs.readFileSync(...args); },
  };
  readAidnProjectConfig(errorRoot, { fsImpl: errorFs });
  statDenied = true;
  const statError = expectReadFailure(errorRoot, "stat_error_does_not_return_cached_config", /access denied/, { fsImpl: errorFs });
  check("stat_error_code_preserved", statError.code === "EACCES");
  statDenied = false;
  readAidnProjectConfig(errorRoot, { fsImpl: errorFs });
  writeRawConfig(errorRoot, config("env:BRAVO"));
  readDenied = true;
  const readError = expectReadFailure(errorRoot, "read_error_does_not_return_cached_config", /access denied/, { fsImpl: errorFs });
  check("read_error_code_preserved", readError.code === "EACCES");
  readDenied = false;
  check("read_recovers_from_fresh_source_after_error", readAidnProjectConfig(errorRoot, { fsImpl: errorFs }).data.runtime.persistence.connectionRef === "env:BRAVO");
  fs.unlinkSync(errorFile);
  fs.mkdirSync(errorFile);
  expectReadFailure(errorRoot, "directory_is_invalid_config_not_absence", /expected regular file/);
  const invalidParent = path.join(tempRoot, "invalid-parent");
  fs.mkdirSync(invalidParent);
  fs.writeFileSync(path.join(invalidParent, ".aidn"), "not a directory");
  const parentError = expectReadFailure(invalidParent, "invalid_parent_is_not_optional_absence", /ENOTDIR/);
  check("invalid_parent_error_code_preserved", parentError.code === "ENOTDIR");

  resetAidnProjectConfigCache();
  const fsIdentityRoot = path.join(tempRoot, "filesystem-identity");
  writeRawConfig(fsIdentityRoot, config("env:ALPHA"));
  readAidnProjectConfig(fsIdentityRoot);
  const alternateFs = { ...fs, readFileSync() { throw denied(); } };
  expectReadFailure(fsIdentityRoot, "injected_reader_cannot_inherit_another_reader_cache", /access denied/, { fsImpl: alternateFs });
  resetAidnProjectConfigCache();
  return checks;
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

    const bytesBeforeVersionHelpers = fs.readFileSync(written.path);
    const statsBeforeVersionHelpers = JSON.stringify(readStats());
    const legacyConfig = { runtime: { stateMode: "files" }, install: { artifactImportStore: "file", custom: { keep: true } } };
    const legacyBefore = JSON.stringify(legacyConfig);
    validateAidnProjectConfig({});
    validateAidnProjectConfig(legacyConfig);
    assert(inspectInstalledAidnVersion({}, "0.8.0").status === "unknown", "empty legacy config must not invent an installed version");
    assert(inspectInstalledAidnVersion(legacyConfig, "0.8.0").recorded_version === null, "legacy config without marker must remain unknown");
    const finalized = withInstalledAidnVersion(legacyConfig, "0.8.0");
    assert(finalized.version === 1, "product version must not replace root schema version");
    assert(finalized.install.aidnVersion === "0.8.0", "explicit finalization must set the supplied product version");
    assert(finalized.runtime.stateMode === "files" && finalized.install.artifactImportStore === "file", "finalization lost configured defaults");
    assert(JSON.stringify(legacyConfig) === legacyBefore, "pure finalization mutated its input");
    finalized.install.custom.keep = false;
    assert(legacyConfig.install.custom.keep === true, "pure finalization must clone nested extensions");
    assert(JSON.stringify(withInstalledAidnVersion(finalized, "0.8.0")) === JSON.stringify(finalized), "same-version finalization must be idempotent");
    assert(inspectInstalledAidnVersion(finalized, "0.8.0").status === "current", "matching recorded version should be current");
    const mismatch = inspectInstalledAidnVersion(finalized, "0.9.0");
    assert(mismatch.status === "mismatch" && mismatch.recorded_version === "0.8.0" && mismatch.cli_version === "0.9.0", "diagnostics must distinguish executing package from last successful install");
    const validVersions = ["0.0.0", "0.8.0", "1.2.3-rc.1", "1.2.3+build.001", "1.2.3-rc.1+build.001"];
    for (const version of validVersions) {
      assert(isAidnProductVersion(version), "valid semantic version rejected: " + version);
      validateAidnProjectConfig({ version: 1, install: { aidnVersion: version } });
    }
    const invalidVersions = [null, 8, "", "v0.8.0", " 0.8.0", "0.8.0 ", "0.8.0\n", "0.8.0\r\n", "0.8", "00.8.0", "0.08.0", "0.8.00", "0.8.0-01", "0.8.0-a..b", "0.8.0+", "0.8.0-rc_1"];
    for (const version of invalidVersions) {
      assert(!isAidnProductVersion(version), "invalid semantic version accepted: " + version);
      let threw = false;
      try { withInstalledAidnVersion(legacyConfig, version); } catch { threw = true; }
      assert(threw, "factory must refuse malformed installed version: " + version);
      assert(JSON.stringify(legacyConfig) === legacyBefore, "failed finalization changed config input");
    }
    assert(bytesBeforeVersionHelpers.equals(fs.readFileSync(written.path)), "pure helpers wrote the project config");
    assert(JSON.stringify(readStats()) === statsBeforeVersionHelpers, "pure helpers performed cache or write operations");

    const invalidCases = [
      ["undefined", undefined],
      ["null", null],
      ["array", []],
      ["invalid-version", { version: 0 }],
      ["unsupported-schema", { version: 2 }],
      ["product-version-as-schema", { version: "0.8.0" }],
      ...invalidVersions.map((version, index) => ["invalid-installed-version-" + index, { version: 1, install: { aidnVersion: version } }]),
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
    const freshnessChecks = verifyFreshConfigReads(tempRoot);

    console.log(JSON.stringify({
      ok: true,
      status: "PASS",
      cache_checks: true,
      freshness_checks: freshnessChecks,
      version_identity_checks: { legacy_compatible: true, pure_factory: true, schema_version: 1, valid_semver_cases: validVersions.length, invalid_semver_cases: invalidVersions.length, diagnostic_states: ["unknown", "current", "mismatch"] },
      config_validation_cases: invalidCases.length + 1,
      undefined_preserved: true,
      late_failure_preserved: true,
      temp_files: 0,
    }, null, 2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  } finally {
    resetAidnProjectConfigCache();
    if (tempRoot && fs.existsSync(tempRoot)) {
      removePathWithRetry(tempRoot);
    }
  }
}

main();
