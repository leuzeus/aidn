#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { planCodexAssets, executeCodexAssets } from "../../src/application/install/codex-assets-service.mjs";
import { prepareActivationFixture } from "./test-activation-fixture-lib.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-host-journal-"));
const targetRoot = path.join(temp, "client é"), codexHome = path.join(temp, "profil Codex é");
const config = path.join(codexHome, "config.toml"), checks = [];
const hash = (data) => crypto.createHash("sha256").update(data).digest("hex");
function snapshot() {
  const found = [];
  function visit(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, e.name); if (e.isDirectory()) visit(file); else found.push([path.relative(temp,file), hash(fs.readFileSync(file))]);
  } }
  visit(temp); return found;
}
function plan(action = "migrate-global-skills") { return planCodexAssets({ repoRoot, targetRoot, codexHome, action }); }
function apply(action = "migrate-global-skills", extra = {}) {
  const preview = plan(action); assert(preview.ok, preview.errors.join("; "));
  return executeCodexAssets({ repoRoot, targetRoot, codexHome, action, dryRun: false, expectedPlanId: preview.plan_id, ...extra });
}
function ok(result) { assert(result.ok, result.errors.join("; ")); }
try {
  fs.mkdirSync(targetRoot); fs.mkdirSync(codexHome);
  prepareActivationFixture(targetRoot);
  const known = path.join(codexHome, "skills/pr-orchestrate/SKILL.md"), custom = path.join(codexHome, "skills/context-reload/SKILL.md");
  for (const file of [known, custom]) fs.mkdirSync(path.dirname(file), { recursive: true });
  const legacy = fs.readFileSync(path.join(repoRoot, "tests/fixtures/codex-legacy/v0.5.0-rc.1/pr-orchestrate/SKILL.md"));
  fs.writeFileSync(known, legacy); fs.writeFileSync(custom, "---\nname: context-reload\ndescription: custom AIDN rules\n---\nKeep client instructions.\n");
  const original = '# client comment\nmodel = "client-model"\n[mcp_servers.client]\ncommand = "client-mcp"\n';
  fs.writeFileSync(config, original);
  const before = snapshot(), preview = plan(); ok(preview); assert.deepEqual(snapshot(), before);
  assert(!JSON.stringify(preview).includes(Buffer.from(original).toString("base64")), "public plan must not disclose config pre-images");
  assert.equal(preview.global_skills.candidates.filter((c) => c.selected).length, 1);
  assert(preview.global_skills.candidates.some((c) => c.classification === "custom-aidn" && !c.selected));
  checks.push("preview preserves host and project; unknown/custom skills never selected");

  fs.appendFileSync(config, "# later user edit\n");
  const changed = snapshot();
  const stale = executeCodexAssets({ repoRoot, targetRoot, codexHome, action: "migrate-global-skills", dryRun: false, expectedPlanId: preview.plan_id });
  assert(!stale.ok); assert(stale.errors.includes("STALE_INSTALL_PLAN")); assert.deepEqual(snapshot(), changed);
  fs.writeFileSync(config, original);
  checks.push("stale global config refuses before any journal or asset mutation");

  const lock = path.join(codexHome, ".aidn-skills-migration.lock.json");
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, token: "live-owner" }));
  const lockedBefore = snapshot(); assert(!apply().ok); assert.deepEqual(snapshot(), lockedBefore); fs.unlinkSync(lock);
  checks.push("global config lock serializes different installation transactions");

  const interrupted = apply("migrate-global-skills", { failAfterHostWrite: true });
  assert(!interrupted.ok); assert(interrupted.pending);
  let disabled = fs.readFileSync(config, "utf8");
  assert(disabled.startsWith(original)); assert(disabled.includes("enabled = false"));
  assert(disabled.includes(JSON.stringify(known))); assert(!disabled.includes(JSON.stringify(custom)));
  assert.deepEqual(fs.readFileSync(known), legacy);
  const pending = JSON.parse(fs.readFileSync(path.join(targetRoot, ".aidn/install/pending.json"), "utf8"));
  assert.equal(pending.id, interrupted.pending);
  ok(apply("resume")); assert.equal(fs.readFileSync(config, "utf8"), disabled);
  const stable = snapshot(); const repeated = apply(); ok(repeated); assert(!repeated.written); assert.deepEqual(snapshot(), stable);
  checks.push("interruption resumes existing journal without duplicate entries or skill edits");

  const second = path.join(codexHome, "skills/start-session/SKILL.md");
  fs.mkdirSync(path.dirname(second), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "scaffold/codex/aidn-start-session/SKILL.md"), second);
  ok(apply()); disabled = fs.readFileSync(config, "utf8");
  assert(disabled.includes(JSON.stringify(second)));
  const saved = JSON.parse(fs.readFileSync(path.join(targetRoot, ".aidn/install/receipt.json"), "utf8")).global_skills_migration.operation;
  assert.equal(saved.before, Buffer.from(original).toString("base64")); assert.equal(saved.after, Buffer.from(disabled).toString("base64"));
  checks.push("extended migration keeps the initial pre-image and updates its post-image");

  fs.appendFileSync(config, "# after installation\n");
  const diverged = snapshot(); const restoreConflict = plan("restore-global-skills");
  assert(!restoreConflict.ok); assert(restoreConflict.errors.some((e) => e.includes("GLOBAL_SKILLS_POSTIMAGE_CHANGED"))); assert.deepEqual(snapshot(), diverged);
  fs.writeFileSync(config, disabled);
  const stoppedRestore = apply("restore-global-skills", { failAfterHostWrite: true }); assert(!stoppedRestore.ok); assert(stoppedRestore.pending);
  ok(apply("resume")); assert.equal(fs.readFileSync(config, "utf8"), original);
  assert.equal(JSON.parse(fs.readFileSync(path.join(targetRoot, ".aidn/install/receipt.json"), "utf8")).global_skills_migration, undefined);
  assert.deepEqual(fs.readFileSync(known), legacy);
  checks.push("restore compares exact post-image and retains all original host settings");
  console.log(JSON.stringify({ status: "PASS", checks, proof_class: "temporary-host-and-installed-client", native_client_execution: "NOT_EXECUTED" }, null, 2));
} finally { const result = removePathWithRetry(temp); if (!result.ok) throw result.error; }
