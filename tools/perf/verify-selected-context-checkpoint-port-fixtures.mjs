import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createLocalWorkflowGitCheckpoint } from "../../src/adapters/runtime/local-workflow-git-checkpoint.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex"),
  suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-context-checkpoint-fixtures-")),
  environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name))),
  cases = [];
let checks = 0;
const pass = name => { checks++; console.log("PASS " + name); };
function inventory(root, omitGit = false) {
  const rows = [];
  function visit(dir, prefix = "") { for (const name of fs.readdirSync(dir).sort()) {
    if (omitGit && !prefix && name === ".git") continue;
    const relative = prefix + name, absolute = path.join(dir, name), stat = fs.lstatSync(absolute);
    assert.equal(stat.isSymbolicLink(), false);
    if (stat.isDirectory()) visit(absolute, relative + "/");
    else rows.push({ path: relative, sha256: sha(fs.readFileSync(absolute)) });
  } } visit(root); return rows;
}
function fixture(name, dirty = true) {
  const root = path.join(suiteRoot, name); fs.mkdirSync(root);
  const git = (...args) => execFileSync("git", ["--no-optional-locks", "-C", root, "-c", "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null"), ...args],
    { env: environment, windowsHide: true, stdio: "pipe", encoding: "utf8", timeout: 10000 });
  const write = (name, content) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
  git("init", "-b", "feature/C001-selected");
  for (const [key, value] of [["user.name", "Context Fixture"], ["user.email", "fixture@example.invalid"], ["core.autocrlf", "false"], ["commit.gpgsign", "false"], ["core.attributesFile", process.platform === "win32" ? "NUL" : "/dev/null"]]) git("config", key, value);
  const names = ["docs/audit/CURRENT-STATE.md", "docs/audit/RUNTIME-STATE.md", "docs/audit/sessions/S002.md", "docs/audit/snapshots/context-snapshot.md"];
  for (let id = 1; id <= 6; id++) for (const file of ["status", "brief", "plan", "audit-spec", "traceability"])
    names.push("docs/audit/cycles/C" + String(id).padStart(3, "0") + "-feature-context/" + file + ".md");
  const absent = "docs/audit/cycles/C009-feature-report/plan.md", added = "docs/audit/sessions/S003.md";
  for (const name of [...names, absent]) write(name, "original target context: " + name + "\n");
  write("src/product.mjs", "export const product = 'selected branch product';\n"); write("AGENTS.md", "fixture configuration\n");
  git("add", "."); git("commit", "-m", "fixture selected branch before canonical context");
  const parent = git("rev-parse", "HEAD").trim(); git("branch", "S002-context", parent);
  if (dirty) { for (const name of names) write(name, "preserved current canonical context: " + name + "\n"); write(added, "preserved newly attached session\n"); fs.unlinkSync(path.join(root, absent)); }
  const approved = dirty ? [...names, absent, added].sort() : [],
    port = options => createLocalWorkflowGitCheckpoint({ targetRoot: root, environment }, { profile: "cycle-context", approvedPaths: approved, ...options });
  const adapter = port(), observed = adapter.inspect(), files = approved.map(name => ({ path: name, sha256: fs.existsSync(path.join(root, name)) ? sha(fs.readFileSync(path.join(root, name))) : null })),
    body = { operation_id: "op_" + sha(name).slice(0, 40), prepared_at_ms: Date.now() - 86400000, observed, files },
    plan = { ...body, plan_sha256: sha(JSON.stringify(body)) };
  return { root, git, write, parent, approved, files, plan, adapter, port, absent, added };
}
function retain(f, name, result) {
  const row = { name, root: f.root, parent: f.parent, plan: f.plan, ...result };
  fs.writeFileSync(path.join(suiteRoot, name + ".json"), JSON.stringify(row, null, 2) + "\n", { flag: "wx" }); cases.push(row);
}
async function refusal(name, mutate, expected) {
  const f = fixture(name); await mutate(f); const before = inventory(f.root);
  await assert.rejects(f.adapter.commit(f.plan, { assertAuthorized: async () => {} }), { code: expected, effect_status: "no_effect" });
  assert.deepEqual(inventory(f.root), before); retain(f, name, { outcome: "no_effect", reason_code: expected }); pass(name + ": refuses before effects and preserves every byte");
}
const nominal = fixture("nominal");
for (const names of [["src/product.mjs"], [".aidn/config.json"], ["docs/audit/workflows/private.md"], ["docs/audit/.codex/config.md"], ["docs/audit/../product.md"]])
  assert.throws(() => createLocalWorkflowGitCheckpoint({ targetRoot: nominal.root, environment }, { profile: "cycle-context", approvedPaths: names }), { code: "WORKFLOW_GIT_SCOPE_PROFILE_INVALID" });
assert.throws(() => createLocalWorkflowGitCheckpoint({ targetRoot: nominal.root, environment }, { profile: "cycle-choice", approvedPaths: ["docs/audit/cycles/C001-feature-context/brief.md"] }), { code: "WORKFLOW_GIT_SCOPE_PROFILE_INVALID" });
assert.throws(() => createLocalWorkflowGitCheckpoint({ targetRoot: nominal.root, environment }, { profile: "cycle-choice", approvedPaths: Array.from({ length: 132 }, (_, i) => "docs/audit/sessions/S" + String(i).padStart(3, "0") + ".md") }), { code: "WORKFLOW_GIT_SCOPE_PROFILE_INVALID" });
pass("context scope is canonical-only and the historical choice profile keeps its path and 131-file boundaries");
const beforeRead = inventory(nominal.root); nominal.port().inspect(); assert.deepEqual(inventory(nominal.root), beforeRead);
pass("cold context observation preserves the checkout and Git bytes");
const productBefore = inventory(nominal.root, true), configBefore = sha(fs.readFileSync(path.join(nominal.root, ".git/config")));
let permissions = 0;
const applied = await nominal.adapter.commit(nominal.plan, { assertAuthorized: async () => { permissions++; } });
assert.equal(applied.status, "confirmed"); assert.equal(applied.effect_status, "confirmed"); assert.ok(permissions >= 4);
assert.equal(nominal.git("rev-parse", "HEAD^").trim(), nominal.parent); assert.equal(nominal.git("rev-parse", "S002-context").trim(), nominal.parent);
assert.equal(nominal.git("status", "--porcelain"), ""); assert.deepEqual(inventory(nominal.root, true), productBefore);
assert.equal(sha(fs.readFileSync(path.join(nominal.root, ".git/config"))), configBefore);
assert.equal(nominal.git("rev-parse", "HEAD:src/product.mjs").trim(), nominal.git("rev-parse", nominal.parent + ":src/product.mjs").trim());
assert.equal(nominal.git("ls-tree", "--name-only", "HEAD", "--", nominal.absent), "");
assert.deepEqual(nominal.git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").trim().split(/\r?\n/).sort(), nominal.approved);
assert.equal(nominal.port().inspectCommit(nominal.plan).status, "confirmed");
retain(nominal, "nominal", { outcome: "confirmed", result: applied, canonical_worktree_and_product_preserved: true });
pass("a day-old exact context plan commits additions, modifications and canonical absence without product/configuration effects");
const replayBefore = inventory(nominal.root);
await assert.rejects(nominal.adapter.commit(nominal.plan, { assertAuthorized: async () => {} }), { code: "WORKFLOW_GIT_PRECONDITION_CHANGED", effect_status: "no_effect" });
assert.deepEqual(inventory(nominal.root), replayBefore); pass("an old applied plan cannot create a second checkpoint");
const empty = fixture("no-change", false), emptyBefore = inventory(empty.root);
assert.equal((await empty.adapter.commit(empty.plan, { assertAuthorized: async () => {} })).status, "no_change");
assert.deepEqual(inventory(empty.root), emptyBefore); retain(empty, "no-change", { outcome: "no_effect" }); pass("an exact empty context has no Git effect");
const revoked = fixture("revoked"), revokedBefore = inventory(revoked.root);
await assert.rejects(revoked.adapter.commit(revoked.plan, { assertAuthorized: async () => { throw Object.assign(Error("FIXTURE_CONTEXT_GRANT_REVOKED"), { code: "FIXTURE_CONTEXT_GRANT_REVOKED" }); } }), { code: "FIXTURE_CONTEXT_GRANT_REVOKED", effect_status: "no_effect" });
assert.deepEqual(inventory(revoked.root), revokedBefore); retain(revoked, "revoked", { outcome: "no_effect" }); pass("a revoked current grant leaves no effect resource or Git change");
await refusal("foreign-product", f => f.write("src/product.mjs", "foreign product change\n"), "WORKFLOW_GIT_FOREIGN_CHANGES");
await refusal("canonical-postimage", f => f.write(f.approved[0], "changed canonical postimage\n"), "WORKFLOW_GIT_POSTIMAGE_CHANGED");
await refusal("absence-reappeared", f => f.write(f.absent, "projection reappeared\n"), "WORKFLOW_GIT_POSTIMAGE_CHANGED");
await refusal("head-moved", f => f.git("commit", "--allow-empty", "-m", "fixture external branch move"), "WORKFLOW_GIT_PRECONDITION_CHANGED");
const old = fixture("old-profile-absence"), oldAdapter = createLocalWorkflowGitCheckpoint({ targetRoot: old.root, environment }, { profile: "cycle-terminal", approvedPaths: old.approved }), oldBefore = inventory(old.root);
await assert.rejects(oldAdapter.commit(old.plan, { assertAuthorized: async () => {} }), { code: "WORKFLOW_GIT_PLAN_INVALID", effect_status: "no_effect" });
assert.deepEqual(inventory(old.root), oldBefore); retain(old, "old-profile-absence", { outcome: "no_effect" }); pass("a null deletion postimage remains invalid for the historical terminal profile");
const afterRef = fixture("grant-after-ref"), refIndex = path.resolve(afterRef.root, afterRef.git("rev-parse", "--git-path", "index").trim()), refIndexBefore = sha(fs.readFileSync(refIndex)), refFiles = inventory(afterRef.root, true);
let live = true;
await assert.rejects(afterRef.port({ afterRef: async () => { live = false; } }).commit(afterRef.plan, { assertAuthorized: async () => { if (!live) throw Object.assign(Error("FIXTURE_CONTEXT_GRANT_REVOKED_AFTER_REF"), { code: "FIXTURE_CONTEXT_GRANT_REVOKED_AFTER_REF" }); } }), { code: "FIXTURE_CONTEXT_GRANT_REVOKED_AFTER_REF", effect_status: "unknown" });
assert.notEqual(afterRef.git("rev-parse", "HEAD").trim(), afterRef.parent); assert.equal(sha(fs.readFileSync(refIndex)), refIndexBefore); assert.deepEqual(inventory(afterRef.root, true), refFiles);
const refProof = afterRef.port().inspectCommit(afterRef.plan); assert.equal(refProof.status, "commit_observed"); assert.equal(refProof.index_reconciled, false);
retain(afterRef, "grant-after-ref", { outcome: "unknown", result: refProof, original_unknown_not_upgraded: true }); pass("revocation after ref update preserves UNKNOWN and does not install the index");
const lost = fixture("index-ack-loss"), lostIndex = path.resolve(lost.root, lost.git("rev-parse", "--git-path", "index").trim()), lostFiles = inventory(lost.root, true), originalRename = fs.renameSync;
let injected = false;
fs.renameSync = function (from, to) { const result = originalRename.apply(this, arguments); if (!injected && path.resolve(to) === lostIndex) { injected = true; throw Object.assign(Error("FIXTURE_CONTEXT_INDEX_ACK_LOST"), { code: "FIXTURE_CONTEXT_INDEX_ACK_LOST" }); } return result; };
try { await assert.rejects(lost.adapter.commit(lost.plan, { assertAuthorized: async () => {} }), { code: "FIXTURE_CONTEXT_INDEX_ACK_LOST", effect_status: "unknown" }); }
finally { fs.renameSync = originalRename; }
assert.equal(injected, true); assert.deepEqual(inventory(lost.root, true), lostFiles); const lostProof = lost.port().inspectCommit(lost.plan); assert.equal(lostProof.status, "confirmed");
retain(lost, "index-ack-loss", { outcome: "unknown", result: lostProof, original_unknown_not_upgraded: true }); pass("a cold confirmed postimage never upgrades the thrown UNKNOWN after index ACK loss");
console.log(JSON.stringify({ status: "PASS", checks, root: suiteRoot, cases: cases.map(({ name, root, outcome }) => ({ name, root, outcome })),
  proof_class: "PRIVATE_PHYSICAL_CONTEXT_CHECKPOINT_PORT", canonical_DB: "NOT_RUN_PHYSICAL_ABSENCE_ONLY", accepted_activation_source: "NOT_CONNECTED", common_host: "NOT_CONNECTED", phase_admission: "NOT_RUN", native: "NOT_RUN", full_standard: false }));
