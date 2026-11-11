import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createStandardDriftRollback } from "../../src/application/runtime/standard-drift-rollback.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { LOCAL_ARTIFACT_FENCE_PATH } from "../../src/application/runtime/local-artifact-resource-fence.mjs";

const temp = fs.realpathSync(os.tmpdir()), owned = [];
const agedPlan = process.argv.includes("--aged-plan");
const hex = "a".repeat(64), operation = "op_" + "a".repeat(40);
const input = { recovery_record_operation_id: operation }, instance = { instance_id: "case", instance_sha256: hex };
const paths = ["product/added.txt", "product/change.txt", "product/removed.txt"];
function fixture() {
  const root = fs.mkdtempSync(path.join(temp, "aidn-drift-rollback-"));
  owned.push(root);
  const git = (...args) => execFileSync("git", ["--no-optional-locks", "-C", root, "-c",
    "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null"), ...args],
    { encoding: "utf8", windowsHide: true, timeout: 30000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = (name, text) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const file = name => path.join(root, name), bytes = name => fs.readFileSync(file(name), "utf8");
  const remove = name => fs.unlinkSync(file(name));
  const branch = "feature/C001-drift";
  git("init", "-b", branch);
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "commit.gpgSign", "false");
  git("config", "core.autocrlf", "false");
  write(".aidn/config.json", JSON.stringify({ runtime: { stateMode: "files" } }));
  write(".gitignore", ".aidn/runtime/\n/docs/audit/" + LOCAL_ARTIFACT_FENCE_PATH + "\n");
  write("docs/audit/CURRENT-STATE.md", "# Continuity\n");
  write("unrelated.txt", "owned elsewhere\n");
  write(paths[1], "checkpoint\n");
  write(paths[2], "restore\n");
  git("add", ".");
  git("commit", "-m", "accepted checkpoint fixture");
  const checkpoint = git("rev-parse", "HEAD");
  write(paths[0], "introduced\n");
  write(paths[1], "drift\n");
  remove(paths[2]);
  git("add", "-A");
  git("commit", "-m", "terminal fixture");
  const head = git("rev-parse", "HEAD");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
  const observeContext = async () => {
    const context = { branch: git("branch", "--show-current"), head: git("rev-parse", "HEAD"), mode: "COMMITTING", cycle_id: "C001", session_id: "S001",
      product_sha256: shadowHash(paths.map(name => fs.existsSync(file(name)) ? artifactContentHash(fs.readFileSync(file(name))) : null)),
      git: { other_changes: { count: 0 } }, documents: ["CURRENT-STATE.md"].map(name => ({ ref: "audit:" + name, sha256: artifacts.read(name).sha256 })) };
    return { context, context_sha256: shadowHash(context) };
  };
  let selected;
  let planClock = agedPlan ? Date.now() - 86400000 : null;
  const rollback = createStandardDriftRollback({ targetRoot: root, observeContext, readCurrent: () => instance, readSource: async () => selected, now: () => planClock ?? Date.now() });
  return { root, git, file, bytes, write, artifacts, head, branch, rollback,
    async prepare() {
      selected = { choice: "rollback", review: { cycle_id: "C001", session_id: "S001" }, productPaths: paths, deniedRoots: [],
        checkpoint: { operation_id: operation, receipt_sha256: hex, head: checkpoint, branch },
        transition: { after_context_sha256: (await observeContext()).context_sha256 } };
      const prepared = await rollback.prepare(instance, input);
      if (agedPlan && prepared.can_apply && planClock !== null) { planClock = null; assert.ok(Date.now() - prepared.plan.prepared_at_ms >= 86400000); }
      return prepared;
    } };
}
let checks = 0;
const check = async (name, fn) => { await fn(); console.log("PASS " + name); checks++; };
const apply = (f, preview, assertAuthorized = () => {}) => f.rollback.apply(instance, preview, { write: true, expectPlan: preview.plan_sha256, assertAuthorized });
try {
  const f = fixture(), index = fs.readFileSync(f.file(".git/index"));
  const preview = await f.prepare();
  await check("exact read-only preview binds add, replacement and deletion without Git or canonical effects", async () => {
    assert.equal(preview.can_apply, true);
    assert.deepEqual(preview.plan.changes.map(change => change.path), paths);
    assert.equal(f.git("status", "--porcelain"), "");
    assert.equal(f.artifacts.ownerPending(), false);
    assert.deepEqual(fs.readFileSync(f.file(".git/index")), index);
    await assert.rejects(f.rollback.apply(instance, preview, { expectPlan: preview.plan_sha256 }), { effect_status: "no_effect" });
  });
  await check("malformed preparation time refuses before ownership or product writes", async () => {
    const malformed = structuredClone(preview); malformed.plan.prepared_at_ms = Number.MAX_SAFE_INTEGER + 1;
    malformed.plan_sha256 = shadowHash(malformed.plan);
    await assert.rejects(apply(f, malformed), { code: "STANDARD_DRIFT_ROLLBACK_EXPLICIT_EFFECT_REQUIRED", effect_status: "no_effect" });
    assert.equal(f.artifacts.ownerPending(), false); assert.equal(f.git("status", "--porcelain"), "");
    assert.deepEqual(fs.readFileSync(f.file(".git/index")), index);
  });
  await check(agedPlan ? "day-old rollback plan verifies exact product postimages with current source and grant" : "authorized rollback verifies exact product postimages and preserves index, branch, HEAD and continuity", async () => {
    const result = await apply(f, preview);
    assert.equal(result.effect_status, "confirmed", JSON.stringify(result));
    assert.deepEqual(result.facts, { drift_recovery_rollback_applied: true, drift_check_completed: false });
    assert.equal(fs.existsSync(f.file(paths[0])), false);
    assert.equal(f.bytes(paths[1]), "checkpoint\n");
    assert.equal(f.bytes(paths[2]), "restore\n");
    assert.equal(f.bytes("unrelated.txt"), "owned elsewhere\n");
    assert.equal(f.bytes("docs/audit/CURRENT-STATE.md"), "# Continuity\n");
    assert.equal(f.git("rev-parse", "HEAD"), f.head);
    assert.equal(f.git("branch", "--show-current"), f.branch);
    assert.deepEqual(fs.readFileSync(f.file(".git/index")), index);
    assert.equal(f.artifacts.ownerPending(), false);
  });
  await check("foreign bytes after preview and grant refusal before first write are no-effect", async () => {
    const g = fixture(), before = await g.prepare();
    const denied = await apply(g, before, () => { throw Object.assign(Error("denied"), { code: "DENIED" }); });
    assert.equal(denied.effect_status, "no_effect");
    assert.equal(denied.observations.reason_code, "DENIED");
    g.write(paths[1], "concurrent\n");
    const changed = await apply(g, before);
    assert.equal(changed.effect_status, "no_effect");
    assert.equal(g.bytes(paths[1]), "concurrent\n");
    assert.equal(g.bytes(paths[0]), "introduced\n");
    assert.equal(g.artifacts.ownerPending(), false);
  });
  await check("grant loss after one file change leaves an unknown result and retained owner", async () => {
    const g = fixture(), before = await g.prepare();
    let calls = 0;
    const result = await apply(g, before, () => { if (++calls === 2) throw Object.assign(Error("lost"), { code: "LOST" }); });
    assert.equal(result.effect_status, "unknown");
    assert.deepEqual(result.observations.changed_paths, [paths[0]]);
    assert.deepEqual(result.facts, {});
    assert.equal(g.artifacts.ownerPending(), true);
    assert.equal((await g.prepare()).reason_code, "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
  });
  await check("configured external Git filters refuse before product reads and effects", async () => {
    const g = fixture();
    g.git("config", "filter.fixture.clean", "echo forbidden");
    g.write(".git/info/attributes", "product/* filter=fixture\n");
    await assert.rejects(g.prepare(), { code: "STANDARD_DRIFT_ROLLBACK_EXTERNAL_FILTER" });
    assert.equal(g.artifacts.ownerPending(), false);
  });
  console.log(JSON.stringify({ status: "PASS", checks, git: "actual", authority: "fixture-capabilities", published_route: "NOT_RUN", rediagnosis: "NOT_RUN" }));
} finally {
  for (const root of owned) {
    const exact = fs.realpathSync(root);
    assert.equal(path.dirname(exact), temp);
    assert.ok(path.basename(exact).startsWith("aidn-drift-rollback-"));
    fs.rmSync(exact, { recursive: true, force: true });
  }
}
