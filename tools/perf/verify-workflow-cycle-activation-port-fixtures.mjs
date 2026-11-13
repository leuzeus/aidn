import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createLocalWorkflowCycleActivation } from "../../src/adapters/runtime/local-workflow-cycle-activation.mjs";
import { assertWorkflowCycleActivationPort } from "../../src/core/ports/workflow-cycle-activation-port.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex"), owned = [], temp = fs.realpathSync(os.tmpdir());
const sourceBranch = "feature/C002-source", targetBranch = "feature/C001-selected", O = "op_" + "a".repeat(40), H = "b".repeat(64);
const script = fileURLToPath(import.meta.url), inputs = { source_branch: sourceBranch, target_branch: targetBranch };
let checks = 0;
const pass = message => { checks++; console.log("PASS " + message); };
function fixture({ configurationDifference = null, canonicalPrefix = "docs/audit" } = {}) {
  const root = fs.mkdtempSync(path.join(temp, "aidn-cycle-activation-")); owned.push(root);
  const git = (...args) => execFileSync("git", ["--no-optional-locks", "-C", root, "-c", "core.hooksPath=NUL",
    "-c", "filter.aidn_forbidden.clean=", "-c", "filter.aidn_forbidden.smudge=", "-c", "filter.aidn_forbidden.required=false", ...args],
  { encoding: "utf8", windowsHide: true, stdio: "pipe" }).trim();
  const write = (name, text) => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), text); };
  git("init", "-b", targetBranch); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  git("config", "core.logAllRefUpdates", "true"); git("config", "commit.gpgsign", "false");
  write(".gitignore", "/.aidn/runtime/\n/.codex/\n"); write(".gitattributes", "product/*.txt filter=aidn_forbidden\n");
  write("AGENTS.md", "Preserve this local project policy.\n"); write(".aidn/config.json", '{"fixture":"target"}\n');
  write(".agents/skills/aidn/SKILL.md", "Preserve installed project skills.\n");
  write(canonicalPrefix + "/CURRENT-STATE.md", "Target branch historical canonical state.\n");
  write("product/app.txt", "Selected product tree.\n"); write("product/selected-only.txt", "Selected-only product.\n");
  git("add", "."); git("commit", "-m", "fixture selected tree"); const targetHead = git("rev-parse", "HEAD");
  git("switch", "-c", sourceBranch);
  write("product/app.txt", "Source product tree.\n"); fs.unlinkSync(path.join(root, "product/selected-only.txt"));
  write("product/source-only.txt", "Source-only product.\n"); write(canonicalPrefix + "/CURRENT-STATE.md", "Accepted canonical carryover postimage.\n");
  write(canonicalPrefix + "/sessions/S002.md", "Current canonical session must survive.\n");
  if (configurationDifference) write(configurationDifference, "Source configuration differs.\n");
  git("add", "."); git("commit", "-m", "fixture source tree and checkpointed canonical carryover");
  const sourceHead = git("rev-parse", "HEAD");
  write(".aidn/runtime/retained-journal.json", '{"keep":"canonical runtime"}\n');
  write(".codex/config.toml", "# Preserve native client configuration\n"); write(".codex/hooks.json", '{"keep":"native trust definitions"}\n');
  git("config", "filter.aidn_forbidden.clean", "aidn-fixture-command-must-not-run");
  git("config", "filter.aidn_forbidden.smudge", "aidn-fixture-command-must-not-run"); git("config", "filter.aidn_forbidden.required", "true");
  write(".git/hooks/reference-transaction", "#!/bin/sh\nexit 73\n"); fs.chmodSync(path.join(root, ".git/hooks/reference-transaction"), 0o755);
  const port = createLocalWorkflowCycleActivation({ targetRoot: root });
  const preserved = () => [canonicalPrefix + "/CURRENT-STATE.md", canonicalPrefix + "/sessions/S002.md", ".aidn/config.json", ".aidn/runtime/retained-journal.json",
    ".codex/config.toml", ".codex/hooks.json", ".agents/skills/aidn/SKILL.md", "AGENTS.md", ".gitignore", ".git/config"].map(name => ({ path: name, sha256: sha(fs.readFileSync(path.join(root, name))) }));
  const snapshot = () => { const values = {}; const walk = dir => { for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = path.join(dir, item.name); assert.equal(fs.lstatSync(name).isSymbolicLink(), false);
    if (item.isDirectory()) walk(name); else values[path.relative(root, name)] = sha(fs.readFileSync(name));
  } }; walk(root); return values; };
  return { root, git, write, port, targetHead, sourceHead, preserved, snapshot,
    plan: () => ({ operation_id: O, plan_sha256: H, observed: port.inspect(inputs) }) };
}
async function check(name, run) { await run(); pass(name); }

if (process.argv[2] === "--inspect") {
  const root = process.argv[3], plan = JSON.parse(fs.readFileSync(process.argv[4]));
  console.log(JSON.stringify(createLocalWorkflowCycleActivation({ targetRoot: root }).inspectActivation(plan)));
} else {
  try {
  await check("port discovery is pure and has no source or permission supplied by JSON", () => {
    const methods = Object.fromEntries(["inspect", "activate", "inspectActivation"].map(name => [name, () => { throw Error("must not invoke"); }]));
    assert.equal(assertWorkflowCycleActivationPort(methods), methods); assert.throws(() => assertWorkflowCycleActivationPort({}));
  });
  await check("read-only inspection preserves every product, canonical, Git and configuration byte", () => {
    const f = fixture(), before = f.snapshot(), plan = f.plan(); assert.notEqual(f.sourceHead, f.targetHead);
    assert.equal(plan.observed.changes.length, 3); assert.deepEqual(f.snapshot(), before);
  });
  await check("missing explicit write or a revoked last-awaited grant refuses before locks or product effects", async () => {
    const f = fixture(), plan = f.plan(), before = f.snapshot();
    await assert.rejects(f.port.activate(plan, { assertAuthorized() {} }), { code: "WORKFLOW_ACTIVATION_EXPLICIT_WRITE_REQUIRED", effect_status: "no_effect" });
    await assert.rejects(f.port.activate(plan, { write: true, assertAuthorized: async () => { throw Object.assign(Error("revoked"), { code: "FIXTURE_REVOKED" }); } }),
      { code: "FIXTURE_REVOKED", effect_status: "no_effect" }); assert.deepEqual(f.snapshot(), before);
  });
  await check("foreign tracked work and a concurrently moved target are not overwritten", async () => {
    const f = fixture(), plan = f.plan(), preserved = f.preserved(); f.write("product/app.txt", "Foreign edit.\n");
    await assert.rejects(f.port.activate(plan, { write: true, assertAuthorized() {} }), { effect_status: "no_effect" });
    assert.equal(fs.readFileSync(path.join(f.root, "product/app.txt"), "utf8"), "Foreign edit.\n");
    f.write("product/app.txt", "Source product tree.\n"); const index = sha(fs.readFileSync(path.join(f.root, ".git/index")));
    await assert.rejects(f.port.activate(plan, { write: true, assertAuthorized: async () => {
      f.git("update-ref", "refs/heads/" + targetBranch, f.sourceHead, f.targetHead);
    } }), { effect_status: "no_effect" });
    assert.equal(f.git("rev-parse", targetBranch), f.sourceHead); assert.equal(f.git("branch", "--show-current"), sourceBranch);
    assert.equal(sha(fs.readFileSync(path.join(f.root, ".git/index"))), index); assert.deepEqual(f.preserved(), preserved);
  });
  await check("a target configuration change and special index flags are refused before effects", async () => {
    const other = fixture({ configurationDifference: ".aidn/config.json" }), before = other.snapshot();
    assert.throws(() => other.plan(), { code: "WORKFLOW_ACTIVATION_CONFIGURATION_DIFFERENCE" }); assert.deepEqual(other.snapshot(), before);
    const f = fixture(); f.git("update-index", "--skip-worktree", "product/app.txt"); const plan = f.plan(), bytes = f.snapshot();
    await assert.rejects(f.port.activate(plan, { write: true, assertAuthorized() {} }), { code: "WORKFLOW_ACTIVATION_INDEX_FLAGS_UNSUPPORTED", effect_status: "no_effect" });
    assert.deepEqual(f.snapshot(), bytes);
  });
  await check("installed project skills and case variants of the project policy are protected before effects", () => {
    for (const name of [".agents/skills/aidn/SKILL.md", "agents.md"]) {
      const f = fixture({ configurationDifference: name }), before = f.snapshot();
      assert.throws(() => f.plan(), { code: "WORKFLOW_ACTIVATION_CONFIGURATION_DIFFERENCE" });
      assert.deepEqual(f.snapshot(), before);
    }
  });
  await check("case variants of the canonical namespace preserve current history during actual activation", async () => {
    const f = fixture({ canonicalPrefix: "DOCS/AUDIT" }), preserved = f.preserved(), plan = f.plan();
    assert.equal(plan.observed.changes.length, 3);
    const result = await f.port.activate(plan, { write: true, assertAuthorized() {} });
    assert.equal(result.effect_status, "confirmed"); assert.equal(result.implementation_authorized, false);
    assert.equal(f.git("rev-parse", "HEAD"), f.targetHead); assert.deepEqual(f.preserved(), preserved);
  });
  await check("different-HEAD activation loads the selected product tree while preserving canonical and native configuration", async () => {
    const f = fixture(), plan = f.plan(), preserved = f.preserved(), result = await f.port.activate(plan, { write: true, assertAuthorized() {} });
    assert.equal(result.effect_status, "confirmed"); assert.equal(result.implementation_authorized, false); assert.equal(result.product_tree_checked_out, true);
    assert.equal(f.git("rev-parse", "HEAD"), f.targetHead); assert.equal(f.git("rev-parse", sourceBranch), f.sourceHead);
    assert.equal(f.git("rev-parse", targetBranch), f.targetHead); assert.equal(f.git("branch", "--show-current"), targetBranch);
    assert.equal(fs.readFileSync(path.join(f.root, "product/app.txt"), "utf8"), "Selected product tree.\n");
    assert.equal(fs.existsSync(path.join(f.root, "product/source-only.txt")), false); assert.equal(fs.existsSync(path.join(f.root, "product/selected-only.txt")), true);
    assert.deepEqual(f.preserved(), preserved); assert.deepEqual(f.git("diff", "--name-only").split(/\r?\n/), ["docs/audit/CURRENT-STATE.md"]);
    const privateRoot = fs.mkdtempSync(path.join(temp, "aidn-cycle-private-")); owned.push(privateRoot); const file = path.join(privateRoot, "plan.json");
    fs.writeFileSync(file, JSON.stringify(plan)); const before = f.snapshot(), cold = JSON.parse(execFileSync(process.execPath, [script, "--inspect", f.root, file], { encoding: "utf8", windowsHide: true, stdio: "pipe" }));
    assert.equal(cold.status, "confirmed"); assert.deepEqual(f.snapshot(), before);
    await assert.rejects(f.port.activate(plan, { write: true, assertAuthorized() {} }), { effect_status: "no_effect" }); assert.deepEqual(f.snapshot(), before);
    console.log(JSON.stringify({ physical_activation: true, root: f.root, source_head: f.sourceHead, target_head: f.targetHead, plan_file: file,
      canonical_preserved: true, hooks_and_required_filters_disabled: true, cold_read_only_confirmation: true, implementation_authorized: false,
      canonical_adoption: "NOT_EXECUTED", phase_admission: "NOT_RUN", common_operation_host: "NOT_RUN", native: "NOT_RUN" }));
  });
  await check("an already selected branch returns no-change without touching Git or the worktree", async () => {
    const f = fixture(), plan = { operation_id: O, plan_sha256: H, observed: f.port.inspect({ source_branch: sourceBranch, target_branch: sourceBranch }) }, before = f.snapshot();
    const result = await f.port.activate(plan, { write: true, assertAuthorized() {} }); assert.equal(result.status, "no_change"); assert.equal(result.effect_status, "no_effect");
    assert.deepEqual(f.snapshot(), before);
  });
  await check("loss after a real product replacement stays UNKNOWN and never rolls back or repeats the old plan", async () => {
    const f = fixture(), preserved = f.preserved(), plan = f.plan(), port = createLocalWorkflowCycleActivation({ targetRoot: f.root },
      { afterWorktreeChange: () => { throw Object.assign(Error("lost worktree acknowledgement"), { code: "FIXTURE_PRODUCT_ACK_LOST" }); } });
    await assert.rejects(port.activate(plan, { write: true, assertAuthorized() {} }), { code: "FIXTURE_PRODUCT_ACK_LOST", effect_status: "unknown" });
    assert.equal(fs.readFileSync(path.join(f.root, "product/app.txt"), "utf8"), "Selected product tree.\n"); assert.equal(f.git("rev-parse", "HEAD"), f.sourceHead);
    assert.deepEqual(f.preserved(), preserved); assert.equal(port.inspectActivation(plan).status, "not_confirmed"); const before = f.snapshot();
    await assert.rejects(port.activate(plan, { write: true, assertAuthorized() {} }), { effect_status: "no_effect" }); assert.deepEqual(f.snapshot(), before);
    console.log(JSON.stringify({ physical_product_partial: true, root: f.root, signed_operation_receipt: "NOT_RUN_PORT_ONLY", effect_status: "unknown", implementation_authorized: false }));
  });
  await check("lost acknowledgement after HEAD/index installation is UNKNOWN even when a fresh physical read confirms the original effect", async () => {
    const f = fixture(), plan = f.plan(), preserved = f.preserved(), port = createLocalWorkflowCycleActivation({ targetRoot: f.root },
      { afterEffect: () => { throw Object.assign(Error("lost final acknowledgement"), { code: "FIXTURE_ACTIVATION_ACK_LOST" }); } });
    await assert.rejects(port.activate(plan, { write: true, assertAuthorized() {} }), { code: "FIXTURE_ACTIVATION_ACK_LOST", effect_status: "unknown" });
    assert.deepEqual(f.preserved(), preserved); assert.equal(port.inspectActivation(plan).status, "confirmed"); const before = f.snapshot();
    await assert.rejects(port.activate(plan, { write: true, assertAuthorized() {} }), { effect_status: "no_effect" }); assert.deepEqual(f.snapshot(), before);
    console.log(JSON.stringify({ physical_activation_ack_loss: true, root: f.root, source_head: f.sourceHead, target_head: f.targetHead,
      returned_effect_status: "unknown", physical_observation: "confirmed", signed_operation_receipt: "NOT_RUN_PORT_ONLY", implementation_authorized: false }));
  });
  console.log(JSON.stringify({ status: "PASS", checks, scope: "PRIVATE_LOCAL_GIT_AND_PRODUCT_ACTIVATION_PORT", canonical_adoption: "NOT_EXECUTED",
    human_choice_or_phase_permission: "NOT_RUN", common_operation_host: "NOT_RUN", native: "NOT_RUN", full_standard_workflow: false }));
  } finally { console.error(JSON.stringify({ retained_owned_fixture_roots: owned })); }
}
