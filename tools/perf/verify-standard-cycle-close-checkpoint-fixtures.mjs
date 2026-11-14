import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { captureCycleCloseCheckpoint, verifyCycleCloseCheckpoint } from "../../src/application/runtime/standard-cycle-close-checkpoint.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
const temporary = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(temporary, "aidn-close-checkpoint-"));
const git = (...args) => execFileSync("git", ["-C", root, "-c", "core.hooksPath=NUL", ...args], { encoding: "utf8", stdio: "pipe", windowsHide: true }).trim();
let checks = 0; const pass = name => { checks++; console.log("PASS " + name); };
try {
  git("init", "-b", "feature"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  const product = path.join(root, "product.txt"); fs.writeFileSync(product, "original\n"); git("add", "."); git("commit", "-m", "fixture seed");
  fs.writeFileSync(product, "reviewed\n");
  const context = { head: git("rev-parse", "HEAD"), branch: "feature", git: { other_changes: { count: 0 } },
    documents: [{ ref: "fixture:approved", sha256: artifactContentHash("reviewed\n") }], cycle_id: "C001" };
  const before = fs.readFileSync(path.join(root, ".git/index")), state = captureCycleCloseCheckpoint({ root, context });
  assert.deepEqual(fs.readFileSync(path.join(root, ".git/index")), before); assert.equal(state.files.length, 1);
  assert.equal(verifyCycleCloseCheckpoint({ root, context, state }), false); pass("capture is read-only and dirty reviewed bytes still require an explicit checkpoint");
  git("add", "."); git("commit", "-m", "fixture approved checkpoint"); context.head = git("rev-parse", "HEAD");
  assert.equal(verifyCycleCloseCheckpoint({ root, context, state }), true); pass("actual descendant checkpoint and exact approved physical/commit contents agree");
  assert.throws(() => verifyCycleCloseCheckpoint({ root, context: { ...context, branch: "foreign" }, state }), { code: "STANDARD_CYCLE_CLOSE_CHECKPOINT_SOURCE_STALE" });
  assert.throws(() => verifyCycleCloseCheckpoint({ root, context, state: { ...state, files: [{ ...state.files[0], sha256: "f".repeat(64) }] } }), { code: "STANDARD_CYCLE_CLOSE_CHECKPOINT_CONTENT_CHANGED" });
  fs.writeFileSync(product, "changed after checkpoint\n"); assert.equal(verifyCycleCloseCheckpoint({ root, context, state }), false); fs.writeFileSync(product, "reviewed\n");
  pass("changed context, forged content and post-checkpoint work cannot satisfy the captured evidence");
  fs.writeFileSync(path.join(root, "foreign.txt"), "unreviewed\n"); git("add", "."); git("commit", "-m", "fixture foreign scope"); context.head = git("rev-parse", "HEAD");
  assert.throws(() => verifyCycleCloseCheckpoint({ root, context, state }), { code: "STANDARD_CYCLE_CLOSE_CHECKPOINT_SCOPE_CHANGED" });
  pass("an unrelated committed path cannot be hidden by a clean working tree");
  console.log(JSON.stringify({ status: "PASS", checks, proof: "actual-git-checkpoint-observation", context_authority: "fixture", workflow_host: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
} finally {
  const resolved = fs.realpathSync(root); assert.equal(path.dirname(resolved), temporary); assert.ok(path.basename(resolved).startsWith("aidn-close-checkpoint-")); fs.rmSync(resolved, { recursive: true, force: true });
}
