import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { preWriteAdmit } from "../runtime/pre-write-admit.mjs";
import { createTrackedFixtureFilter, initGitRepo } from "./test-git-fixture-lib.mjs";
import { prepareActivationFixture } from "./test-activation-fixture-lib.mjs";
import { validateJsonSchema } from "../../src/core/contracts/json-schema-validator.mjs";
import schema from "../../src/core/contracts/cli-output/runtime-pre-write-admit.v1.schema.json" with { type: "json" };
export async function verifyPromotionPrewrite(mode = "files", { verbose = false } = {}) {
if (!["files", "dual", "db-only"].includes(mode)) throw Error("PROMOTION_PREWRITE_FIXTURE_MODE_INVALID");
const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, "aidn-promote-prewrite-"));
const sha = data => createHash("sha256").update(data).digest("hex"), checks = [];
const write = (name, text) => { const p = path.join(root, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const edit = (name, fn) => write(name, fn(fs.readFileSync(path.join(root, name), "utf8")));
const set = (text, key, value) => new RegExp("^" + key + ":.*$", "m").test(text) ? text.replace(new RegExp("^" + key + ":.*$", "m"), key + ": " + value) : text + "\n" + key + ": " + value + "\n";
function snapshot() {
  const result = [];
  function walk(dir) { for (const row of fs.readdirSync(dir, { withFileTypes: true })) {
    if (row.name === ".git") continue;
    const p = path.join(dir, row.name);
    if (row.isDirectory()) walk(p); else result.push([path.relative(root, p).replaceAll("\\", "/"), sha(fs.readFileSync(p))]);
  } }
  walk(root); return result.sort(([a], [b]) => a.localeCompare(b));
}
function sync() {
  if (mode !== "files") execFileSync(process.execPath, ["tools/perf/index-sync.mjs", "--target", root, "--store", "sqlite", "--with-content", "--json"], { encoding: "utf8", windowsHide: true, stdio: "pipe" });
}
async function admit(cycleId = null, skill = "promote-baseline") {
  sync(); const before = snapshot();
  const result = await preWriteAdmit({ targetRoot: root, skill, promotionCycleId: cycleId });
  assert.deepEqual(validateJsonSchema(result, schema, "$", { contractKind: "cli-output" }), []);
  assert.deepEqual(snapshot(), before, "read-only promotion admission must preserve all files and canonical SQLite bytes"); return result;
}
async function check(name, fn) { await fn(); checks.push(name); if (verbose) console.log("PASS " + name); }
try {
  const src = path.resolve("tests/fixtures/perf-handoff/ready"); fs.cpSync(src, root, { recursive: true, filter: createTrackedFixtureFilter(src) });
  initGitRepo(root, { workingBranch: "S101-alpha" }); prepareActivationFixture(root, process.cwd());
  write(".aidn/config.json", JSON.stringify({ runtime: { stateMode: mode } }));
  const current = "docs/audit/CURRENT-STATE.md", runtime = "docs/audit/RUNTIME-STATE.md", status = "docs/audit/cycles/C101-feature-alpha/status.md", gap = status.replace("status.md", "gap-report.md"), trace = status.replace("status.md", "traceability.md");
  edit(current, text => { for (const [k, v] of Object.entries({ active_cycle: "none", cycle_branch: "none", branch_kind: "session", dor_state: "NOT_READY", runtime_state_mode: mode })) text = set(text, k, v); return text; });
  edit(runtime, text => set(set(set(text, "runtime_state_mode", mode), "repair_layer_status", "ok"), "current_state_freshness", "ok"));
  edit(status, text => set(text, "state", "DONE")); write(trace, "# Traceability\n\n| REQ | TEST | Evidence |\n| REQ-001 | TEST-001 | fixture |\n"); write(gap, "# Gaps\n\nNo open gaps.\n");
  await check("completed cycle with no active focus is admitted without re-entering implementation DoR", async () => { const r = await admit(); assert.equal(r.ok, true, JSON.stringify(r.blocking_reasons)); assert.equal(r.context.active_cycle, "none"); assert.equal(r.checks.baseline_promotion_target.cycle_id, "C101"); });
  await check("public CLI returns one read-only JSON document with the same selected-target gate", async () => { sync(); const before = snapshot(); const r = JSON.parse(execFileSync(process.execPath, ["bin/aidn.mjs", "runtime", "pre-write-admit", "--target", root, "--skill", "promote-baseline", "--json"], { encoding: "utf8", windowsHide: true })); assert.equal(r.ok, true, JSON.stringify(r.blocking_reasons)); assert.equal(r.checks.baseline_promotion_target.pass, true); assert.deepEqual(snapshot(), before); });
  await check("public skill alias uses the same target admission", async () => { assert.equal((await admit(null, "aidn-promote-baseline")).ok, true); });
  await check("malformed and missing explicit targets never fall back to another DONE cycle", async () => { for (const id of ["bad", "", "C999"]) { const r = await admit(id); assert.equal(r.ok, false); assert.equal(r.checks.baseline_promotion_target.pass, false); } });
  await check("NO_GO cannot become a promotion success", async () => { edit(status, text => set(text, "state", "NO_GO")); const r = await admit("C101"); assert.equal(r.ok, false); assert.equal(r.checks.baseline_promotion_target.reason_code, "PROMOTE_BASELINE_CYCLE_NOT_DONE"); edit(status, text => set(text, "state", "DONE")); });
  await check("selected target still requires traceability and closed gaps", async () => {
    const original = fs.readFileSync(path.join(root, trace), "utf8"); write(trace, "# Traceability\n"); assert.equal((await admit("C101")).checks.baseline_promotion_target.reason_code, "PROMOTE_BASELINE_TRACEABILITY_INCOMPLETE"); write(trace, original);
    write(gap, "# Gaps\n- Status: open\n"); assert.equal((await admit("C101")).checks.baseline_promotion_target.reason_code, "PROMOTE_BASELINE_OPEN_GAPS"); write(gap, "# Gaps\nNo open gaps.\n");
  });
  await check("shared usage matrix stays blocking until verified or explicitly waived", async () => { edit(status, text => set(set(text, "usage_matrix_scope", "shared"), "usage_matrix_state", "NOT_DEFINED")); assert.equal((await admit("C101")).checks.baseline_promotion_target.reason_code, "PROMOTE_BASELINE_USAGE_MATRIX_INCOMPLETE"); edit(status, text => set(text, "usage_matrix_state", "VERIFIED")); assert.equal((await admit("C101")).ok, true); });
  await check("multiple DONE cycles need selection; an unrelated active cycle cannot replace the selected evidence", async () => {
    for (const name of [status, gap, trace]) write(name.replaceAll("C101", "C102"), fs.readFileSync(path.join(root, name), "utf8").replaceAll("C101", "C102"));
    assert.equal((await admit()).checks.baseline_promotion_target.reason_code, "PROMOTE_BASELINE_MULTIPLE_DONE_CYCLES");
    assert.equal((await admit("C101")).ok, true);
    edit(current, text => set(text, "active_cycle", "C102"));
    edit(status.replaceAll("C101", "C102"), text => set(set(set(text, "state", "IMPLEMENTING"), "usage_matrix_scope", "shared"), "usage_matrix_state", "NOT_DEFINED"));
    assert.equal((await admit("C101")).ok, true); assert.equal((await admit("C102")).ok, false);
    edit(current, text => set(text, "active_cycle", "none"));
  });
  await check("stale runtime freshness still blocks the promotion", async () => { edit(runtime, text => set(text, "current_state_freshness", "stale")); assert.equal((await admit("C101")).ok, false); });
  if (mode !== "files") await check("fileless canonical admission preserves SQLite without fallback to visible artifacts", async () => {
    edit(runtime, text => set(text, "current_state_freshness", "ok")); sync();
    for (const name of [current, runtime, status, trace, gap]) fs.unlinkSync(path.join(root, name));
    const before = snapshot(), r = await preWriteAdmit({ targetRoot: root, skill: "promote-baseline", promotionCycleId: "C101" });
    assert.equal(r.ok, true, JSON.stringify(r.blocking_reasons)); assert.equal(r.context.current_state_source, "sqlite"); assert.deepEqual(snapshot(), before);
  });
  return { ok: true, mode, checks, proof_class: "offline-actual-prewrite-and-canonical-promotion", baseline_writes: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" };
} finally {
  const resolved = fs.realpathSync(root); assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith("aidn-promote-prewrite-")); fs.rmSync(resolved, { recursive: true, force: true });
}
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(await verifyPromotionPrewrite(process.argv.find(v => v.startsWith("--mode="))?.slice(7) ?? "files", { verbose: true })));
}
