#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { readStandardDriftContext, captureStandardDriftContextFence } from "../../src/application/runtime/standard-drift-report.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { getDatabaseSync, rebuildRuntimeHeads } from "../../src/lib/sqlite/workflow-db-schema-lib.mjs";
import { resolveRuntimeSqliteFile } from "../../src/application/runtime/runtime-persistence-service.mjs";
const mode = process.argv.find(value => value.startsWith("--mode="))?.slice(7) ?? "files";
if (!["files", "dual", "db-only"].includes(mode)) throw Error("FIXTURE_MODE_INVALID");
const owned = [], temporary = fs.realpathSync(os.tmpdir()); let complete = false, checks = 0;
const pass = name => { checks++; console.log("PASS " + name); };
try {
  const root = createFreshStandardWorkflowFixture(mode, owned), ops = createStandardWorkflowOperations({ targetRoot: root }), artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
  // Establish an absent optional artifact in this new disposable test corpus
  // before any context observation. This is fixture setup, not a workflow delete.
  const optionalName = "baseline/history.md", optionalVisible = path.join(root, "docs/audit", optionalName);
  assert.ok(fs.realpathSync(root).startsWith(temporary + path.sep));
  if (mode !== "files") {
    const db = new (getDatabaseSync())(resolveRuntimeSqliteFile({ targetRoot: root }));
    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare("DELETE FROM artifact_blobs WHERE artifact_id IN (SELECT artifact_id FROM artifacts WHERE path = ?)").run(optionalName);
      db.prepare("DELETE FROM artifacts WHERE path = ?").run(optionalName);
      rebuildRuntimeHeads(db); db.exec("COMMIT");
    } finally { db.close(); }
  }
  if (fs.existsSync(optionalVisible)) fs.unlinkSync(optionalVisible);
  assert.equal(artifacts.read(optionalName).sha256, null);
  let plan = await ops.prepareSession({ session_id: "S001", session_branch: "S001-drift-close", objective: "Observe all canonical baseline completion changes before session closure" });
  assert.equal((await ops.initializeSession(plan, { write: true, expectPlan: plan.plan_sha256 })).outcome, "completed");
  plan = await ops.prepareMode({ session_id: "S001", mode: "COMMITTING" });
  assert.equal((await ops.applyMode(plan, { write: true, expectPlan: plan.plan_sha256 })).outcome, "completed");
  const productRoot = path.join(root, "product"); fs.mkdirSync(productRoot); fs.writeFileSync(path.join(productRoot, "app.mjs"), "export const value = 3;\n");
  const git = (...args) => execFileSync("git", ["-C", root, "-c", "core.hooksPath=NUL", ...args], { encoding: "utf8", windowsHide: true, stdio: "pipe", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).trim();
  git("add", "."); git("commit", "--allow-empty", "-m", "fixture baseline context");
  // Canonical postimages are fixture material. No promotion or session closure
  // is claimed by preparing these two legitimate baseline completion changes.
  const names = ["baseline/history.md", "index.md"];
  const args = { targetRoot: root, productRoot, productFiles: ["app.mjs"], productSha256: shadowHash({ product: fs.readFileSync(path.join(productRoot, "app.mjs"), "utf8") }) };
  const productHash = () => shadowHash({ product: fs.readFileSync(path.join(productRoot, "app.mjs"), "utf8") });
  const absentObserved = await readStandardDriftContext(args);
  assert.equal(artifacts.read(optionalName).sha256, null);
  assert.ok(!absentObserved.context.documents.some(row => row.ref === "audit:" + optionalName));
  const absentFence = captureStandardDriftContextFence({ ...args, observed: absentObserved, readProductSha256: productHash });
  assert.doesNotThrow(absentFence);
  await artifacts.withLocalEffectOwner("c".repeat(64), async () => {
    await new Promise(resolve => setImmediate(resolve));
    artifacts.compareAndSwap({ path: optionalName, before_sha256: null, after: "# Baseline history\n\nCreated during the awaited fixture boundary.\n" });
    return { effect_status: "confirmed" };
  });
  assert.notEqual(artifacts.read(optionalName).sha256, null);
  assert.throws(absentFence, { code: "STANDARD_DRIFT_DIAGNOSIS_REQUEST_STALE" });
  if (mode !== "files") assert.equal(fs.existsSync(optionalVisible), false);
  pass("optional canonical artifact is absent at capture and created during the await; the original fence refuses without projection fallback");
  const missing = names.filter(name => artifacts.read(name).sha256 === null);
  if (missing.length) {
    const initial = await readStandardDriftContext(args);
    assert.ok(missing.every(name => !initial.context.documents.some(row => row.ref === "audit:" + name)));
    assert.ok(missing.every(name => artifacts.read(name).sha256 === null));
    pass("optional absent canonical documents are not invented or imported by inspection");
  }

  await artifacts.withLocalEffectOwner("a".repeat(64), async () => {
    for (const name of names) { const row = artifacts.read(name);
      // DB bootstrap may not import these optional canonical artifacts. Seed
      // fixture postimages explicitly; never read a visible Markdown fallback.
      const after = (row.content ?? (name === "index.md" ? "# Audit index\n" : "# Baseline history\n")) + "\n- fixture baseline completion observed\n";
      if (row.sha256 === null) artifacts.compareAndSwap({ path: name, before_sha256: null, after });
      else artifacts.compareAndSwapPreservingMetadata({ path: name, before_sha256: row.sha256, before_metadata_sha256: artifacts.metadataHash(name), after }); }
    artifacts.project(names); return { effect_status: "confirmed" };
  });
  const before = names.map(name => ({ path: name, sha256: artifacts.read(name).sha256, metadata_sha256: artifacts.metadataHash(name) }));
  const observed = await readStandardDriftContext(args);
  for (const row of before) { const document = observed.context.documents.find(item => item.ref === "audit:" + row.path);
    assert.ok(document, "baseline completion artifact missing from R05 context: " + row.path); assert.equal(document.sha256, row.sha256); }
  pass("R05 observes actual canonical baseline history and index postimages");
  assert.equal(observed.context.git.other_changes.count, 0, JSON.stringify(observed.context.git.other_changes));
  pass("known canonical completion paths are covered without hiding unrelated changes");
  assert.deepEqual(names.map(name => ({ path: name, sha256: artifacts.read(name).sha256, metadata_sha256: artifacts.metadataHash(name) })), before);
  pass("context inspection preserves canonical content and metadata");
  const fence = captureStandardDriftContextFence({ ...args, observed, readProductSha256: productHash });
  assert.doesNotThrow(fence);
  pass("fresh synchronous context fence accepts unchanged canonical and physical witnesses");
  await Promise.resolve().then(() => git("commit", "--allow-empty", "-m", "fixture last awaited H HEAD change"));
  assert.throws(fence, { code: "STANDARD_DRIFT_DIAGNOSIS_REQUEST_STALE" });
  pass("HEAD-only change after an await refuses the original context fence");
  const refreshed = await readStandardDriftContext(args);
  const canonicalFence = captureStandardDriftContextFence({ ...args, observed: refreshed, readProductSha256: productHash });
  const parking = artifacts.read("parking-lot.md"), visible = path.join(root, "docs/audit/parking-lot.md");
  const visibleBefore = fs.existsSync(visible) ? fs.readFileSync(visible) : null;
  await artifacts.withLocalEffectOwner("b".repeat(64), async () => {
    const change = { path: parking.path, before_sha256: parking.sha256, after: (parking.content ?? "# Parking lot\n") + "\nFixture last awaited H canonical change.\n" };
    if (parking.sha256 === null) artifacts.compareAndSwap(change);
    else artifacts.compareAndSwapPreservingMetadata({ ...change, before_metadata_sha256: artifacts.metadataHash(parking.path) });
    return { effect_status: "confirmed" };
  });
  assert.throws(canonicalFence, { code: "STANDARD_DRIFT_DIAGNOSIS_REQUEST_STALE" });
  if (mode !== "files") assert.deepEqual(fs.existsSync(visible) ? fs.readFileSync(visible) : null, visibleBefore);
  pass("canonical-only context change refuses without requiring or importing a projection");
  fs.writeFileSync(path.join(root, "unrelated.txt"), "unobserved scope\n");
  const foreign = await readStandardDriftContext(args); assert.ok(foreign.context.git.other_changes.count > 0);
  pass("unrelated paths still make context incomplete");
  complete = true; console.log(JSON.stringify({ status: "PASS", checks, mode, actual_context_reader: true, model_calls: 0, promotion: "NOT_EXECUTED", session_closed: false, native: "NOT_RUN", installed_archive: "NOT_RUN" }));
} finally {
  for (const root of owned.reverse()) { const resolved = fs.realpathSync(root); if (!resolved.startsWith(temporary + path.sep)) throw Error("FIXTURE_CLEANUP_SCOPE_INVALID");
    if (!complete && process.argv.includes("--retain-on-failure")) console.error(JSON.stringify({ retained_fixture: resolved })); else fs.rmSync(resolved, { recursive: true, force: true }); }
}
