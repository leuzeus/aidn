#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { planInstallation, executeInstallation, verifyInstallationCandidate } from "../../src/application/install/installation-service.mjs";
import { createRuntimePersistenceFakePgClientFactory } from "./runtime-persistence-fake-pg-lib.mjs";
import { listPostgresRuntimeRelationalTargetStructures, POSTGRES_RUNTIME_RELATIONAL_TARGET_SCHEMA_VERSION } from "../../src/application/runtime/postgres-runtime-persistence-contract-service.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-installation-persistence-policy-"));
const started = Date.now();
const checks = [];
const failures = [];
const args = {
  pack: "core", initDefaults: true, projectName: "neutral-persistence-policy",
  sourceBranch: "dev", runtimeStateMode: "db-only", runtimePersistenceBackend: "postgres",
  runtimePersistenceConnectionRef: "env:AIDN_FIXTURE_PG_URL", persistencePolicy: "verify-only",
};
const envNames = ["AIDN_INDEX_STORE_MODE", "AIDN_STATE_MODE", "AIDN_RUNTIME_PERSISTENCE_BACKEND", "AIDN_RUNTIME_PERSISTENCE_CONNECTION_REF"];
const oldEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
for (const name of envNames) delete process.env[name];
const target = (name) => { const root = path.join(temp, name); fs.mkdirSync(root); return root; };
function put(root, relative, content) { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
const readJson = (root, relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const readyTables = () => listPostgresRuntimeRelationalTargetStructures().filter((item) => item.kind === "table").map((item) => item.name);
function oldConfig(root, backend = "postgres") {
  put(root, ".aidn/config.json", JSON.stringify({ version: 1, install: { aidnVersion: "0.7.2" }, runtime: { stateMode: "db-only", persistence: { backend, ...(backend === "postgres" ? { connectionRef: "env:AIDN_FIXTURE_PG_URL" } : {}) } }, client: { keep: true } }));
}
function snapshot(root) {
  const result = {};
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(dir, entry.name), relative = path.relative(root, absolute).replace(/\\/g, "/");
      if (entry.isDirectory()) { result[relative] = "directory"; visit(absolute); }
      else result[relative] = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
    }
  }
  visit(root); return result;
}
function fakePg({ ready = true, beforeQuery = null, allowWrites = false } = {}) {
  const fake = createRuntimePersistenceFakePgClientFactory({
    initialTables: ready ? readyTables() : [],
    initialSchemaMigrations: ready ? [POSTGRES_RUNTIME_RELATIONAL_TARGET_SCHEMA_VERSION] : [],
  });
  const calls = { connects: 0, reads: 0, writes: [] };
  const factory = (options) => {
    const client = fake.factory(options);
    return {
      async connect() { calls.connects++; await client.connect(); },
      async end() { await client.end(); },
      async query(sql, values) {
        if (beforeQuery) await beforeQuery(String(sql), calls, fake.state);
        if (/^\s*SELECT\b/i.test(sql)) calls.reads++;
        else { calls.writes.push(String(sql).trim().split(/\s+/).slice(0, 3).join(" ")); if (!allowWrites) throw new Error("FIXTURE_REFUSED_DATABASE_WRITE"); }
        return client.query(sql, values);
      },
    };
  };
  return { calls, state: fake.state, options: { connectionString: "postgres://fixture:fixture@unused.invalid/fixture", clientFactory: factory } };
}
async function check(name, run) {
  try { await run(); checks.push({ name, status: "PASS" }); }
  catch (error) { checks.push({ name, status: "FAIL" }); failures.push({ name, error: String(error.message).slice(0, 1200) }); }
}
let cleanup = { ok: false };
try {
  await check("setup_candidate_preflight_reads_postgres_without_local_or_database_writes", async () => {
    for (const ready of [true, false]) {
      const root = target(`candidate-${ready}`), pg = fakePg({ ready }), before = snapshot(root);
      const options = { repoRoot, targetRoot: root, args, runtimeBackendAdoptionOptions: pg.options };
      if (ready) assert.equal((await verifyInstallationCandidate(options)).ok, true);
      else await assert.rejects(verifyInstallationCandidate(options), /PERSISTENCE_VERIFY_ONLY_REQUIRES_NOOP/);
      assert(pg.calls.reads > 0); assert.deepEqual(pg.calls.writes, []); assert.deepEqual(snapshot(root), before);
    }
  });
  await check("preview_never_reads_database_and_declares_import_skipped", async () => {
    const root = target("preview"), pg = fakePg(); const before = snapshot(root);
    const result = await planInstallation({ repoRoot, targetRoot: root, args, runtimeBackendAdoptionOptions: pg.options });
    assert(result.ok, result.errors?.join("; "));
    assert.equal(pg.calls.connects, 0); assert.deepEqual(snapshot(root), before);
    assert.equal(result.external_effects.find((effect) => effect.id === "artifact-import").state, "skipped");
    assert.equal(result.external_effects.find((effect) => effect.id === "persistence-adoption").readiness, "unknown");
  });
  await check("nonready_postgres_refuses_before_any_local_or_database_write", async () => {
    const root = target("not-ready"), pg = fakePg({ ready: false }); const before = snapshot(root);
    const result = await executeInstallation({ repoRoot, targetRoot: root, args, dryRun: false, runtimeBackendAdoptionOptions: pg.options });
    assert.equal(result.ok, false);
    assert.deepEqual(pg.calls.writes, [], "verify-only must never invoke database writes");
    assert.deepEqual(snapshot(root), before, "database readiness must be checked before installation writes");
    assert(result.conflicts.some((item) => item.code === "PERSISTENCE_VERIFY_ONLY_REQUIRES_NOOP"));
  });
  await check("unavailable_postgres_is_not_treated_as_verified", async () => {
    const root = target("unavailable"), pg = fakePg({ beforeQuery() { throw new Error("FIXTURE_DATABASE_UNAVAILABLE"); } });
    const before = snapshot(root);
    const result = await executeInstallation({ repoRoot, targetRoot: root, args, dryRun: false, runtimeBackendAdoptionOptions: pg.options });
    assert.equal(result.ok, false); assert(result.errors.includes("PERSISTENCE_VERIFY_ONLY_REQUIRES_NOOP"));
    assert.deepEqual(pg.calls.writes, []); assert.deepEqual(snapshot(root), before);
  });
  await check("ready_postgres_revalidated_and_never_written", async () => {
    const root = target("ready"), pg = fakePg();
    const result = await executeInstallation({ repoRoot, targetRoot: root, args, dryRun: false, runtimeBackendAdoptionOptions: pg.options });
    assert(result.ok, result.errors?.join("; "));
    assert.deepEqual(pg.calls.writes, []);
    assert.equal(pg.calls.connects, 2, "readiness must be checked before writes and before completion");
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".aidn/install/receipt.json"), "utf8")).installation.args.persistencePolicy, "verify-only");
  });
  await check("unspecified_policy_preserves_existing_verify_only_receipt", async () => {
    const root = target("saved-policy"), pg = fakePg();
    const installed = await executeInstallation({ repoRoot, targetRoot: root, args, dryRun: false, runtimeBackendAdoptionOptions: pg.options });
    assert(installed.ok, installed.errors?.join("; "));
    pg.state.tablesPresent.clear(); const before = snapshot(root);
    const inheritedArgs = { ...args, persistencePolicy: undefined };
    const preview = await planInstallation({ repoRoot, targetRoot: root, args: inheritedArgs });
    assert(preview.ok, preview.errors?.join("; "));
    assert.equal(preview.external_effects.find((effect) => effect.id === "persistence-adoption").policy, "verify-only");
    const refused = await executeInstallation({ repoRoot, targetRoot: root, args: inheritedArgs, dryRun: false, runtimeBackendAdoptionOptions: pg.options });
    assert.equal(refused.ok, false); assert(refused.errors.includes("PERSISTENCE_VERIFY_ONLY_REQUIRES_NOOP"));
    assert.deepEqual(snapshot(root), before); assert.deepEqual(pg.calls.writes, []);
  });
  await check("revalidation_failure_keeps_old_version_and_resume_cannot_weaken_policy", async () => {
    const root = target("changed-readiness"); oldConfig(root);
    let inspections = 0;
    const pg = fakePg({ beforeQuery(sql, _calls, state) {
      if (sql.includes("FROM information_schema.tables") && ++inspections === 2) state.tablesPresent.clear();
    } });
    const failed = await executeInstallation({ repoRoot, targetRoot: root, args, dryRun: false, runtimeBackendAdoptionOptions: pg.options });
    assert.equal(failed.ok, false); assert(failed.errors.includes("PERSISTENCE_VERIFY_ONLY_REQUIRES_NOOP"));
    assert.equal(readJson(root, ".aidn/config.json").install.aidnVersion, "0.7.2");
    const pending = readJson(root, ".aidn/install/pending.json");
    const tx = readJson(root, `.aidn/install/transactions/${pending.id}.json`);
    assert.equal(tx.installation_context.args.persistencePolicy, "verify-only");
    assert.deepEqual(pg.calls.writes, []);
    const interrupted = snapshot(root);
    const denied = await executeInstallation({ repoRoot, targetRoot: root, action: "resume", args: { persistencePolicy: "adopt" }, dryRun: false, runtimeBackendAdoptionOptions: pg.options });
    assert.equal(denied.ok, false); assert(denied.errors.includes("PERSISTENCE_POLICY_FROZEN_BY_TRANSACTION"));
    assert.deepEqual(snapshot(root), interrupted, "resume preflight must refuse before changing pending assets");
    assert.deepEqual(pg.calls.writes, []);
    pg.state.tablesPresent = new Set(readyTables());
    const resumed = await executeInstallation({ repoRoot, targetRoot: root, action: "resume", args: { persistencePolicy: "verify-only" }, dryRun: false, runtimeBackendAdoptionOptions: pg.options });
    assert(resumed.ok, resumed.errors?.join("; "));
    assert.equal(readJson(root, ".aidn/install/receipt.json").installation.args.persistencePolicy, "verify-only");
    assert.equal(readJson(root, ".aidn/config.json").install.aidnVersion, fs.readFileSync(path.join(repoRoot, "VERSION"), "utf8").trim());
    assert.deepEqual(readJson(root, ".aidn/config.json").client, { keep: true });
    assert.deepEqual(pg.calls.writes, []);
  });
  await check("completed_verification_checkpoint_is_revalidated_before_version_resume", async () => {
    const root = target("completed-checkpoint"); oldConfig(root); const pg = fakePg();
    const failed = await executeInstallation({ repoRoot, targetRoot: root, args, dryRun: false, failBeforeVersion: true, runtimeBackendAdoptionOptions: pg.options });
    assert.equal(failed.ok, false); assert(failed.errors.includes("INJECTED_INSTALLATION_BEFORE_VERSION"));
    const pending = readJson(root, ".aidn/install/pending.json");
    const tx = readJson(root, `.aidn/install/transactions/${pending.id}.json`);
    assert.equal(tx.external_effect_results["persistence-adoption"].status, "completed");
    assert.equal(tx.external_effect_results["persistence-adoption"].read_only, true);
    pg.state.tablesPresent.clear(); const before = snapshot(root);
    const denied = await executeInstallation({ repoRoot, targetRoot: root, action: "resume", dryRun: false, runtimeBackendAdoptionOptions: pg.options });
    assert.equal(denied.ok, false); assert(denied.errors.includes("PERSISTENCE_VERIFY_ONLY_REQUIRES_NOOP"));
    assert.deepEqual(snapshot(root), before); assert.deepEqual(pg.calls.writes, []);
  });
  await check("rollback_and_interrupted_rollback_resume_never_consult_postgres", async () => {
    const root = target("rollback"); oldConfig(root); const pg = fakePg();
    const installed = await executeInstallation({ repoRoot, targetRoot: root, args, dryRun: false, runtimeBackendAdoptionOptions: pg.options });
    assert(installed.ok, installed.errors?.join("; "));
    const count = pg.calls.connects;
    const partial = await executeInstallation({ repoRoot, targetRoot: root, action: "rollback", dryRun: false, failAfter: 1, runtimeBackendAdoptionOptions: pg.options });
    assert.equal(partial.ok, false); assert(partial.pending);
    pg.state.tablesPresent.clear();
    const resumed = await executeInstallation({ repoRoot, targetRoot: root, action: "resume", dryRun: false, runtimeBackendAdoptionOptions: pg.options });
    assert(resumed.ok, resumed.errors?.join("; ")); assert.equal(pg.calls.connects, count);
    assert.equal(readJson(root, ".aidn/config.json").install.aidnVersion, "0.7.2");
  });
  await check("sqlite_policy_skips_import_and_schema_without_opening_runtime_data", async () => {
    const root = target("sqlite"); oldConfig(root, "sqlite"); const pg = fakePg();
    const sentinel = "Opaque existing runtime data; this test must not open or migrate it.\n";
    put(root, ".aidn/runtime/index/workflow-index.sqlite", sentinel);
    const localArgs = { ...args, runtimePersistenceBackend: "sqlite", runtimePersistenceConnectionRef: "", artifactImportStore: "sqlite", skipArtifactImport: false };
    const preview = await planInstallation({ repoRoot, targetRoot: root, args: localArgs });
    assert(preview.ok, preview.errors?.join("; "));
    assert.equal(preview.external_effects.find((effect) => effect.id === "sqlite-schema").state, "skipped");
    const applied = await executeInstallation({ repoRoot, targetRoot: root, args: localArgs, dryRun: false, expectedPlanId: preview.plan_id, runtimeBackendAdoptionOptions: pg.options });
    assert(applied.ok, applied.errors?.join("; "));
    assert.equal(fs.readFileSync(path.join(root, ".aidn/runtime/index/workflow-index.sqlite"), "utf8"), sentinel);
    assert(!fs.existsSync(path.join(root, ".aidn/runtime/index/workflow-index.json")));
    assert.equal(pg.calls.connects, 0);
  });
  await check("default_adopt_preserves_existing_database_setup_behavior", async () => {
    const root = target("default-adopt"), pg = fakePg({ ready: false, allowWrites: true });
    const defaultArgs = { ...args, skipArtifactImport: true }; delete defaultArgs.persistencePolicy;
    const result = await executeInstallation({ repoRoot, targetRoot: root, args: defaultArgs, dryRun: false, runtimeBackendAdoptionOptions: pg.options });
    assert(result.ok, result.errors?.join("; ")); assert(pg.calls.writes.length > 0);
    assert.equal(readJson(root, ".aidn/install/receipt.json").installation.args.persistencePolicy, "adopt");
  });
  await check("resume_rejects_a_stricter_policy_instead_of_silently_executing_old_write_intent", async () => {
    const root = target("frozen-adopt"), pg = fakePg();
    const stopped = await executeInstallation({ repoRoot, targetRoot: root, args: { ...args, persistencePolicy: "adopt", skipArtifactImport: true }, dryRun: false, failAfter: 0, runtimeBackendAdoptionOptions: pg.options });
    assert(!stopped.ok); assert(stopped.pending);
    const before = snapshot(root), connects = pg.calls.connects;
    const resumed = await executeInstallation({ repoRoot, targetRoot: root, action: "resume", args: { persistencePolicy: "verify-only" }, dryRun: false, runtimeBackendAdoptionOptions: pg.options });
    assert(!resumed.ok); assert(resumed.errors.includes("PERSISTENCE_POLICY_FROZEN_BY_TRANSACTION"));
    assert.deepEqual(snapshot(root), before); assert.equal(pg.calls.connects, connects); assert.deepEqual(pg.calls.writes, []);
  });
  await check("stale_or_invalid_policy_refuses_without_database_or_local_writes", async () => {
    const root = target("invalid"), pg = fakePg(); const before = snapshot(root);
    const stale = await executeInstallation({ repoRoot, targetRoot: root, args, dryRun: false, expectedPlanId: "stale", runtimeBackendAdoptionOptions: pg.options });
    assert.equal(stale.ok, false); assert(stale.errors.includes("STALE_INSTALL_PLAN"));
    const invalid = await executeInstallation({ repoRoot, targetRoot: root, args: { ...args, persistencePolicy: "unknown" }, dryRun: false, runtimeBackendAdoptionOptions: pg.options });
    assert.equal(invalid.ok, false); assert(invalid.errors.includes("INVALID_INSTALLATION_PERSISTENCE_POLICY"));
    assert.equal(pg.calls.connects, 0); assert.deepEqual(snapshot(root), before);
  });
  await check("install_cli_accepts_policy_preview_and_rejects_invalid_values", async () => {
    const root = target("cli"); const before = snapshot(root);
    const common = [path.join(repoRoot, "bin/aidn.mjs"), "install", "--target", root, "--pack", "core", "--init-defaults", "--source-branch", "dev", "--dry-run", "--runtime-persistence-backend", "postgres", "--runtime-persistence-connection-ref", "env:AIDN_FIXTURE_UNSET"];
    const run = (value) => spawnSync(process.execPath, [...common, "--persistence-policy", value], { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 15000 });
    const preview = run("verify-only"); assert.equal(preview.error, undefined); assert.equal(preview.status, 0, preview.stderr); assert.deepEqual(snapshot(root), before);
    const invalid = run("unknown"); assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /Invalid --persistence-policy/); assert.deepEqual(snapshot(root), before);
  });
} finally {
  for (const name of envNames) { if (oldEnv[name] === undefined) delete process.env[name]; else process.env[name] = oldEnv[name]; }
  const resolved = path.resolve(temp);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("cleanup outside temporary root");
  cleanup = removePathWithRetry(resolved);
}
console.log(JSON.stringify({ status: failures.length === 0 && cleanup.ok ? "PASS" : "FAIL", proof_class: "fixture", checks, failures, cleanup, elapsed_ms: Date.now() - started, postgres_live: "SKIP: fake client only" }, null, 2));
process.exitCode = failures.length === 0 && cleanup.ok ? 0 : 1;
