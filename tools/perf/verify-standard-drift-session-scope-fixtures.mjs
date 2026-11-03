#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { readStandardDriftContext } from "../../src/application/runtime/standard-drift-report.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
const mode = process.argv.find(value => value.startsWith("--mode="))?.slice(7) ?? "files";
if (!["files", "dual", "db-only"].includes(mode)) throw Error("FIXTURE_MODE_INVALID");
const owned = [], temporary = fs.realpathSync(os.tmpdir()); let complete = false, checks = 0;
const pass = name => { checks++; console.log("PASS " + name); };
try {
  const root = createFreshStandardWorkflowFixture(mode, owned), ops = createStandardWorkflowOperations({ targetRoot: root }), artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
  let plan = await ops.prepareSession({ session_id: "S001", session_branch: "S001-drift-close", objective: "Observe all canonical baseline completion changes before session closure" });
  assert.equal((await ops.initializeSession(plan, { write: true, expectPlan: plan.plan_sha256 })).outcome, "completed");
  plan = await ops.prepareMode({ session_id: "S001", mode: "COMMITTING" });
  assert.equal((await ops.applyMode(plan, { write: true, expectPlan: plan.plan_sha256 })).outcome, "completed");
  const productRoot = path.join(root, "product"); fs.mkdirSync(productRoot); fs.writeFileSync(path.join(productRoot, "app.mjs"), "export const value = 3;\n");
  const git = (...args) => execFileSync("git", ["-C", root, "-c", "core.hooksPath=NUL", ...args], { encoding: "utf8", windowsHide: true, stdio: "pipe", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).trim();
  git("add", "."); git("commit", "--allow-empty", "-m", "fixture baseline context");
  // Canonical postimages are fixture material. No promotion or session closure
  // is claimed by preparing these two legitimate baseline completion changes.
  const names = ["baseline/history.md", "INDEX.md"];
  const args = { targetRoot: root, productRoot, productFiles: ["app.mjs"], productSha256: shadowHash({ product: fs.readFileSync(path.join(productRoot, "app.mjs"), "utf8") }) };
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
      const after = (row.content ?? (name === "INDEX.md" ? "# Audit index\n" : "# Baseline history\n")) + "\n- fixture baseline completion observed\n";
      if (row.sha256 === null) artifacts.compareAndSwap({ path: name, before_sha256: null, after });
      else artifacts.compareAndSwapPreservingMetadata({ path: name, before_sha256: row.sha256, before_metadata_sha256: artifacts.metadataHash(name), after }); }
    artifacts.project(names);
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
  fs.writeFileSync(path.join(root, "unrelated.txt"), "unobserved scope\n");
  const foreign = await readStandardDriftContext(args); assert.ok(foreign.context.git.other_changes.count > 0);
  pass("unrelated paths still make context incomplete");
  complete = true; console.log(JSON.stringify({ status: "PASS", checks, mode, actual_context_reader: true, model_calls: 0, promotion: "NOT_EXECUTED", session_closed: false, native: "NOT_RUN", installed_archive: "NOT_RUN" }));
} finally {
  for (const root of owned.reverse()) { const resolved = fs.realpathSync(root); if (!resolved.startsWith(temporary + path.sep)) throw Error("FIXTURE_CLEANUP_SCOPE_INVALID");
    if (!complete && process.argv.includes("--retain-on-failure")) console.error(JSON.stringify({ retained_fixture: resolved })); else fs.rmSync(resolved, { recursive: true, force: true }); }
}
