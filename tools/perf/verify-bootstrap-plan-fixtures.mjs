#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-bootstrap-plan-"));
const target = path.join(temp, "client espace é");
const checks = [];
function digest() {
  const files = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else files.push([path.relative(target, file), crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")]);
    }
  }
  visit(target);
  return JSON.stringify(files);
}
function run(args, success = true) {
  const result = spawnSync(process.execPath, [path.join(root, "bin/aidn.mjs"), "bootstrap", "--target", target,
    "--profile", "minimal", "--source-branch", "dev", "--mode", "upgrade", ...args, "--json"], {
    cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 12 * 1024 * 1024, windowsHide: true,
  });
  assert.equal(result.error, undefined);
  const data = JSON.parse(result.stdout);
  assert.equal(result.status === 0, success, JSON.stringify({ errors: data.errors, stderr: result.stderr }));
  return data;
}
try {
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "AGENTS.md"), "Client instructions remain unchanged.\n");
  const before = digest();
  const preview = run(["--dry-run"]);
  assert.equal(digest(), before);
  const applied = run(["--expect-plan", preview.installation_plan.plan_id]);
  assert.equal(applied.ok, true);
  assert.ok(fs.readFileSync(path.join(target, "AGENTS.md"), "utf8").startsWith("Client instructions remain unchanged."));
  checks.push({ name: "upgrade accepts the exact installation preview", status: "PASS" });

  const next = run(["--dry-run"]);
  fs.appendFileSync(path.join(target, "AGENTS.md"), "\nLater client instruction.\n");
  const modified = digest();
  const stale = run(["--expect-plan", next.installation_plan.plan_id], false);
  assert.ok(stale.errors.some((message) => message.includes("STALE_INSTALL_PLAN")), JSON.stringify(stale.errors));
  assert.equal(digest(), modified);
  checks.push({ name: "stale upgrade preview refuses before any target mutation", status: "PASS" });
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  removePathWithRetry(temp);
}
