#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { readStandardSessionClosureContext } from "../../src/application/runtime/standard-session-closure-context.mjs";
const mode = process.argv.find(value => value.startsWith("--mode="))?.slice(7) ?? "files";
if (!["files", "dual", "db-only"].includes(mode)) throw Error("FIXTURE_MODE_INVALID");
const owned = [], temporary = fs.realpathSync(os.tmpdir()); let completed = false, checks = 0;
const pass = name => { checks++; console.log("PASS " + name); };
function snapshot(root) { const rows = []; const walk = dir => { for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
  const at = path.join(dir, item.name); if (item.isDirectory()) walk(at); else if (item.isFile()) rows.push([path.relative(root, at), createHash("sha256").update(fs.readFileSync(at)).digest("hex")]);
} }; walk(root); return JSON.stringify(rows.sort((a,b) => a[0].localeCompare(b[0]))); }
try {
  const root = createFreshStandardWorkflowFixture(mode, owned), ops = createStandardWorkflowOperations({ targetRoot: root }), artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
  let plan = await ops.prepareSession({ session_id: "S001", session_branch: "S001-close-context", objective: "Read canonical session closure subject" });
  assert.equal((await ops.initializeSession(plan, { write: true, expectPlan: plan.plan_sha256 })).outcome, "completed");
  plan = await ops.prepareMode({ session_id: "S001", mode: "COMMITTING" }); assert.equal((await ops.applyMode(plan, { write: true, expectPlan: plan.plan_sha256 })).outcome, "completed");
  const before = snapshot(root), args = { targetRoot: root, sessionId: "S001" }, context = await readStandardSessionClosureContext(args);
  assert.equal(context.blocked, undefined); assert.equal(context.admission_allowed, true); assert.equal(context.session_id, "S001"); assert.equal(context.session_branch, "S001-close-context");
  assert.equal(context.session_close_gate_satisfied, false); assert.deepEqual(context.open_cycles, []);
  for (const ref of ["audit:sessions/S001.md", "audit:CURRENT-STATE.md", "audit:snapshots/context-snapshot.md"]) assert.ok(context.documents.some(row => row.ref === ref));
  assert.equal(snapshot(root), before); pass("actual canonical admission and subject capture leave every project byte unchanged");
  const again = await readStandardSessionClosureContext(args); assert.equal(again.context_sha256, context.context_sha256); assert.equal(snapshot(root), before);
  pass("unchanged canonical subject survives reread without timestamp-dependent question churn");
  const foreign = await readStandardSessionClosureContext({ ...args, sessionId: "S999" }); assert.equal(foreign.blocked, "STANDARD_SESSION_CLOSURE_ADMISSION_BLOCKED"); assert.equal(snapshot(root), before);
  pass("wrong owner remains blocked without guessing another session");
  await artifacts.withLocalEffectOwner("a".repeat(64), async () => {
    const row = artifacts.read("sessions/S001.md"); artifacts.compareAndSwapPreservingMetadata({ path: row.path, before_sha256: row.sha256,
      before_metadata_sha256: artifacts.metadataHash(row.path), after: row.content + "\nFixture canonical notes changed.\n" }); artifacts.project([row.path]); return { effect_status: "confirmed" };
  });
  const changedBefore = snapshot(root), changed = await readStandardSessionClosureContext(args);
  assert.equal(changed.blocked, undefined); assert.equal(changed.admission_allowed, true); assert.match(changed.context_sha256, /^[a-f0-9]{64}$/);
  assert.notEqual(changed.context_sha256, context.context_sha256); assert.equal(snapshot(root), changedBefore);
  pass("canonical document changes invalidate the reviewed subject without inspection writes");
  completed = true; console.log(JSON.stringify({ status: "PASS", checks, mode, actual_admission: true, read_only: true, model_calls: 0, R05_authority: "NOT_TESTED_HERE", session_closed: false, native: "NOT_RUN", installed_archive: "NOT_RUN" }));
} finally { for (const root of owned.reverse()) { const resolved = fs.realpathSync(root); assert.equal(path.dirname(resolved), temporary);
  if (!completed && process.argv.includes("--retain-on-failure")) console.error(JSON.stringify({ retained_fixture: resolved })); else fs.rmSync(resolved, { recursive: true, force: true }); } }
