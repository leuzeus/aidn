import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { syncBuiltinESMExports } from "node:module";
import { fingerprintAgentExecutionValue as fingerprint } from "../../src/core/agents/agent-execution-contracts.mjs";
import { MANAGED_SANDBOX_RESOURCE_KINDS as kinds, assertManagedSandboxEffectsManifest as validate,
  fingerprintManagedSandboxEffectsManifest as manifestHash, buildManagedSandboxPreparationPlan as build,
  assertManagedSandboxPreparationApproval as approve, compareManagedSandboxInventory as compare } from "../../src/core/agents/codex-managed-sandbox-contracts.mjs";

const checks = [], H = "a".repeat(64), H2 = "b".repeat(64), NOW = "2026-09-27T12:02:00.000Z";
const mutate = (value, change) => { const next = structuredClone(value); change(next); return next; };
const code = expected => error => error.code === `MANAGED_SANDBOX_${expected}`;
async function check(name, fn) { try { await fn(); checks.push({ name, status: "PASS" }); }
  catch (error) { checks.push({ name, status: "FAIL", detail: String(error.stack ?? error).slice(0, 2000) }); } }

function fixture() {
  const profile = "C:\\Codex Équipe", supervisor = "G:\\AIDN supervisor", runtime = "C:\\Program Files\\Codex";
  const manifest = { contract_version: "codex-managed-sandbox-effects.v1", mode: "managed-elevated", platform: "win32", host_id: "fixture-host",
    client: { executable: `${runtime}\\codex.exe`, sha256: H }, setup: { executable: `${runtime}\\setup.exe`, sha256: H },
    command_runner: { executable: `${runtime}\\command-runner.exe`, sha256: H }, profile_root: profile,
    roots: [{ role: "profile", path: profile }, { role: "supervisor", path: supervisor },
      { role: "snapshots", path: `${supervisor}\\snapshots` }, { role: "scratch", path: `${supervisor}\\scratch` },
      { role: "runtime", path: runtime }, { role: "sandbox_state", path: `${profile}\\.sandbox` },
      { role: "sandbox_secrets", path: `${profile}\\.sandbox-secrets` }, { role: "sandbox_bin", path: `${profile}\\.sandbox-bin` }],
    resources: kinds.map(kind => ({ kind, id: kind === "filesystem" ? `${profile}\\.sandbox\\state.json`
      : kind === "filesystem_acl" ? `${profile}\\.sandbox` : `fixture-${kind}`, operations: ["create", "update"] })),
    protected_resources: ["codex.exe", "setup.exe", "command-runner.exe"].map(name => ({ kind: "filesystem", id: `${runtime}\\${name}` })) };
  manifest.protected_resources.push({ kind: "filesystem", id: `${supervisor}\\proof-key.pem` });
  const inventory = { contract_version: "codex-managed-sandbox-inventory.v1", host_id: manifest.host_id, client_sha256: H,
    manifest_sha256: manifestHash(manifest), observed_at: "2026-09-27T12:00:00.000Z",
    coverage: kinds.map(kind => ({ kind, scope_id: `fixture.${kind}.v1`, scope_sha256: H, complete: true, outside_authority_sha256: H, reason_code: null })),
    resources: manifest.resources.map(row => ({ kind: row.kind, id: row.id, sha256: H })),
    protected_resources: manifest.protected_resources.map(row => ({ ...row, sha256: H })) };
  return { manifest, inventory };
}
function partial(inventory, kind = "wfp_rule") { return mutate(inventory, value => Object.assign(value.coverage.find(row => row.kind === kind),
  { complete: false, outside_authority_sha256: null, reason_code: "COLLECTOR_NOT_IMPLEMENTED" })); }
function approvalFor(plan) { return { contract_version: "codex-managed-sandbox-preparation-approval.v1", approval_id: "fixture-consent",
  plan_sha256: plan.plan_sha256, host_id: plan.host_id, client_sha256: plan.client_sha256, manifest_sha256: plan.manifest_sha256, inventory_sha256: plan.inventory_sha256,
  decision: "approve", valid_from: "2026-09-27T12:01:00.000Z", valid_until: "2026-09-27T12:05:00.000Z", approver: { kind: "user", reference: "fixture-explicit-message" } }; }
function approvalInput(plan) { return { plan, expectPlan: plan.plan_sha256, execute: true, approval: approvalFor(plan), at: NOW }; }
function comparison(change, changeBefore) {
  const { manifest, inventory } = fixture(); if (changeBefore) changeBefore(inventory, manifest);
  inventory.manifest_sha256 = manifestHash(manifest);
  const after = mutate(inventory, value => { value.observed_at = NOW; change(value, manifest); });
  return compare({ manifest, before: inventory, after });
}

await check("complete preparation is immutable, deterministic, non-authorizing and leaves inputs intact", () => {
  const input = fixture(), original = structuredClone(input), plan = build(input);
  assert.equal(validate(input.manifest), true); assert.equal(manifestHash(input.manifest), fingerprint(input.manifest));
  assert.equal(plan.status, "PREPARED_NOT_AUTHORIZED"); assert.equal(plan.native, false); assert.equal(plan.execution_available, false);
  assert.equal(plan.qualification, "NOT_RUN"); assert.deepEqual(plan.effects, input.manifest.resources);
  assert.deepEqual(input, original); assert(Object.isFrozen(plan) && Object.isFrozen(plan.manifest.resources[0]));
  const reordered = Object.fromEntries(Object.entries(input.manifest).reverse());
  assert.equal(manifestHash(reordered), plan.manifest_sha256); assert.equal(build(input).plan_sha256, plan.plan_sha256);
});
await check("material client, effects, roots and observation changes invalidate the plan fingerprint", () => {
  const input = fixture(), baseline = build(input).plan_sha256;
  for (const edit of [m => { m.client.sha256 = H2; }, m => { m.resources[0].operations = ["update"]; },
    m => { m.roots.find(row => row.role === "scratch").path += "-other"; }]) {
    const next = mutate(input, value => edit(value.manifest)); next.inventory.manifest_sha256 = manifestHash(next.manifest);
    next.inventory.client_sha256 = next.manifest.client.sha256; next.inventory.protected_resources[0].sha256 = next.manifest.client.sha256;
    assert.notEqual(build(next).plan_sha256, baseline);
  }
  assert.notEqual(build(mutate(input, value => { value.inventory.observed_at = NOW; })).plan_sha256, baseline);
});
for (const [name, edit, expected] of [
  ["unknown field", m => { m.implicit_setup = true; }, "MANIFEST_INVALID"],
  ["wrong platform", m => { m.platform = "linux"; }, "MANIFEST_INVALID"],
  ["wrong mode", m => { m.mode = "existing-only"; }, "MANIFEST_INVALID"],
  ["root case alias", m => { m.roots.push({ role: "runtime", path: m.roots[0].path.toUpperCase() }); }, "ROOTS_AMBIGUOUS"],
  ["profile inside supervisor", m => { m.roots.find(row => row.role === "supervisor").path = "C:\\Codex Équipe\\owner"; }, "ROOT_OVERLAP"],
  ["scratch contains supervisor", m => { m.roots.find(row => row.role === "scratch").path = "G:\\AIDN supervisor-parent"; m.roots.find(row => row.role === "supervisor").path += "-parent\\owner"; }, "ROOT_OVERLAP"],
  ["sandbox path not exact", m => { m.roots.find(row => row.role === "sandbox_bin").path += "-other"; }, "SANDBOX_ROOT_MISMATCH"],
  ["resource case alias", m => { m.resources.push({ ...m.resources[0], id: m.resources[0].id.toUpperCase() }); }, "RESOURCE_AMBIGUOUS"],
  ["resource also protected", m => { const { kind, id } = m.resources[0]; m.protected_resources.push({ kind, id }); }, "RESOURCE_AMBIGUOUS"],
  ["file outside roots", m => { m.resources.find(row => row.kind === "filesystem").id = "G:\\unrelated\\file.json"; }, "RESOURCE_OUTSIDE_ROOTS"],
  ["delete operation", m => { m.resources[0].operations = ["delete"]; }, "RESOURCE_INVALID"],
  ["wildcard resource", m => { m.resources[0].id = "fixture-*"; }, "RESOURCE_INVALID"],
  ["unprotected executable", m => { m.protected_resources.shift(); }, "EXECUTABLE_NOT_PROTECTED"],
  ["conflicting binary pins", m => { m.setup.executable = m.client.executable; m.setup.sha256 = H2; }, "EXECUTABLE_PIN_CONFLICT"],
]) await check(`manifest rejects ${name}`, () => assert.throws(() => validate(mutate(fixture().manifest, edit)), code(expected)));
for (const invalid of [null, true, 12]) for (const field of ["host", "scope", "approval"]) await check(`${field} identity rejects ${JSON.stringify(invalid)} without coercion`, () => {
  const input = fixture();
  if (field === "host") assert.throws(() => validate(mutate(input.manifest, value => { value.host_id = invalid; })), code("MANIFEST_INVALID"));
  if (field === "scope") assert.throws(() => build(mutate(input, value => { value.inventory.coverage[0].scope_id = invalid; })), code("INVENTORY_COVERAGE_INVALID"));
  if (field === "approval") assert.throws(() => approve(mutate(approvalInput(build(input)), value => { value.approval.approval_id = invalid; })), code("APPROVAL_REQUIRED"));
});
for (const invalid of ["C:\\", "C:\\one\\..\\two", "C:\\one\\NUL.json", "C:\\one\\file:stream", "C:\\one\\trailing.",
  "C:/one/two", "\\\\server\\share\\file", "\\\\?\\C:\\one\\file", "C:\\one\\*", "C:\\one\\é".normalize("NFD")]) {
  await check(`absolute Windows path rejects alias ${JSON.stringify(invalid)}`, () => assert.throws(() => validate(mutate(fixture().manifest,
    value => { value.client.executable = invalid; })), code("MANIFEST_INVALID")));
}
await check("JSON accessors, cyclic values and exotic objects are rejected without evaluating getters", () => {
  let reads = 0; const value = fixture().manifest;
  Object.defineProperty(value, "host_id", { enumerable: true, get() { reads++; return "host"; } });
  assert.throws(() => validate(value), code("JSON_INVALID")); assert.equal(reads, 0);
  const cycle = fixture().manifest; cycle.loop = cycle; assert.throws(() => validate(cycle), code("JSON_INVALID"));
  assert.throws(() => validate(mutate(fixture().manifest, m => { m.extra = new Date(); })), code("JSON_INVALID"));
});
await check("partial coverage blocks preparation and approval without treating unknown hashes as absence", () => {
  const input = fixture(); input.inventory = partial(input.inventory); input.inventory.resources.find(row => row.kind === "wfp_rule").sha256 = null;
  const plan = build(input); assert.equal(plan.status, "PREPARATION_BLOCKED"); assert.deepEqual(plan.incomplete_categories, ["wfp_rule"]);
  assert.throws(() => approve(approvalInput(plan)), code("INVENTORY_INCOMPLETE"));
  assert.equal(compare({ manifest: input.manifest, before: input.inventory, after: input.inventory }).status, "COMPARISON_BLOCKED");
});
for (const [name, edit, expected] of [
  ["missing coverage", i => { i.coverage.pop(); }, "INVENTORY_COVERAGE_INVALID"],
  ["duplicate category", i => { i.coverage[1] = i.coverage[0]; }, "INVENTORY_COVERAGE_INVALID"],
  ["complete without outside hash", i => { i.coverage[0].outside_authority_sha256 = null; }, "INVENTORY_COVERAGE_INVALID"],
  ["partial claiming known outside hash", i => { i.coverage[0].complete = false; i.coverage[0].reason_code = "UNAVAILABLE"; }, "INVENTORY_COVERAGE_INVALID"],
  ["missing resource", i => { i.resources.pop(); }, "INVENTORY_RESOURCE_SET_CHANGED"],
  ["additional resource", i => { i.resources.push({ kind: "service", id: "foreign", sha256: H }); }, "INVENTORY_RESOURCE_SET_CHANGED"],
  ["foreign client", i => { i.client_sha256 = H2; }, "INVENTORY_BINDING_INVALID"],
  ["binary bytes changed", i => { i.protected_resources[0].sha256 = H2; }, "EXECUTABLE_CHANGED"],
  ["invalid calendar date", i => { i.observed_at = "2026-02-30T12:00:00.000Z"; }, "INVENTORY_BINDING_INVALID"],
]) await check(`inventory rejects ${name}`, () => assert.throws(() => build(mutate(fixture(), value => edit(value.inventory))), code(expected)));
await check("comparison distinguishes declared creates, updates and unchanged observations without confinement claims", () => {
  const changed = comparison(after => { after.resources[0].sha256 = H2; after.resources[1].sha256 = H2; }, before => { before.resources[0].sha256 = null; });
  assert.equal(changed.status, "DECLARED_EFFECTS_OBSERVED"); assert.deepEqual(changed.changes.map(row => row.operation), ["create", "update"]);
  assert.equal(changed.confinement, "NOT_ASSESSED"); assert.equal(changed.execution_available, false); assert.equal(changed.native, false);
  assert.equal(comparison(() => {}).status, "UNCHANGED");
});
for (const [name, change, before, violation] of [
  ["deletion", a => { a.resources[0].sha256 = null; }, null, "DELETE_FORBIDDEN"],
  ["undeclared create", a => { a.resources[0].sha256 = H2; }, (b, m) => { b.resources[0].sha256 = null; m.resources[0].operations = ["update"]; }, "CREATE_NOT_DECLARED"],
  ["undeclared update", a => { a.resources[0].sha256 = H2; }, (b, m) => { m.resources[0].operations = ["create"]; }, "UPDATE_NOT_DECLARED"],
  ["protected mutation", a => { a.protected_resources[3].sha256 = H2; }, null, "PROTECTED_RESOURCE_CHANGED"],
  ["outside-scope mutation", a => { a.coverage[0].outside_authority_sha256 = H2; }, null, "OUTSIDE_AUTHORITY_CHANGED"],
  ["observer scope change", a => { a.coverage[0].scope_sha256 = H2; }, null, "OBSERVATION_SCOPE_CHANGED"],
  ["reversed observation clock", a => { a.observed_at = "2026-09-27T11:59:00.000Z"; }, null, "INVENTORY_TIME_REVERSED"],
]) await check(`comparison refuses ${name}`, () => { const result = comparison(change, before); assert.equal(result.status, "REFUSED"); assert(result.violations.some(row => row.code === violation)); });
await check("explicit recent approval record remains operationally unavailable", () => {
  const input = approvalInput(build(fixture())), before = structuredClone(input), result = approve(input);
  assert.equal(result.status, "APPROVAL_RECORD_VALID"); assert.equal(result.native, false); assert.equal(result.execution_available, false);
  assert.equal(result.qualification, "NOT_RUN"); assert.deepEqual(input, before);
});
for (const [name, edit, expected] of [
  ["no execute", a => { a.execute = false; }, "EXECUTE_REQUIRED"],
  ["wrong expected plan", a => { a.expectPlan = H2; }, "EXPECT_PLAN_MISMATCH"],
  ["missing explicit clock", a => { delete a.at; }, "APPROVAL_TIME_REQUIRED"],
  ["non-user record", a => { a.approval.approver.kind = "agent"; }, "APPROVAL_REQUIRED"],
  ["expired window", a => { a.at = a.approval.valid_until; }, "APPROVAL_EXPIRED_OR_INVALID"],
  ["not yet valid", a => { a.at = "2026-09-27T12:00:30.000Z"; }, "APPROVAL_EXPIRED_OR_INVALID"],
  ["long approval window", a => { a.approval.valid_until = "2026-09-27T12:06:00.001Z"; }, "APPROVAL_EXPIRED_OR_INVALID"],
  ["old inventory", a => { a.at = "2026-09-27T12:05:00.001Z"; }, "INVENTORY_STALE_OR_FUTURE"],
  ["future inventory", a => { a.at = "2026-09-27T11:59:59.999Z"; }, "INVENTORY_STALE_OR_FUTURE"],
  ["forged status", a => { a.plan.execution_available = true; }, "PLAN_CHANGED"],
]) await check(`approval rejects ${name}`, () => assert.throws(() => approve(mutate(approvalInput(build(fixture())), edit)), code(expected)));
for (const field of ["plan_sha256", "host_id", "client_sha256", "manifest_sha256", "inventory_sha256"]) await check(`approval binds ${field}`, () => {
  assert.throws(() => approve(mutate(approvalInput(build(fixture())), value => { value.approval[field] = field === "host_id" ? "other-host" : H2; })), code("APPROVAL_BINDING_INVALID"));
});
await check("a recent approval cannot authorize an old inventory", () => {
  const input = fixture(); input.inventory.observed_at = "2020-01-01T00:00:00.000Z";
  assert.throws(() => approve(approvalInput(build(input))), code("INVENTORY_STALE_OR_FUTURE"));
});
await check("module evaluation and contract operations perform no filesystem, process or ambient clock access", async () => {
  const saved = [], trap = () => { throw new Error("UNEXPECTED_EFFECT"); };
  const replace = (target, name) => { saved.push([target, name, target[name]]); target[name] = trap; };
  const input = fixture(), plan = build(input);
  // Read source before trapping effects: ESM itself must load source bytes.
  // Evaluate those exact bytes with only the relative dependency URL resolved.
  const moduleUrl = new URL("../../src/core/agents/codex-managed-sandbox-contracts.mjs", import.meta.url);
  const source = fs.readFileSync(moduleUrl, "utf8").replace('"./agent-execution-contracts.mjs"', JSON.stringify(new URL("./agent-execution-contracts.mjs", moduleUrl).href));
  try {
    for (const name of ["readFileSync", "writeFileSync", "openSync", "mkdirSync", "statSync", "readdirSync", "rmSync"]) replace(fs, name);
    for (const name of ["readFile", "writeFile", "open", "mkdir", "stat", "readdir", "rm"]) replace(fs.promises, name);
    for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) replace(childProcess, name);
    replace(process, "cwd"); replace(Date, "now"); syncBuiltinESMExports();
    const fresh = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
    assert.equal(fresh.assertManagedSandboxEffectsManifest(input.manifest), true);
    assert.equal(fresh.fingerprintManagedSandboxEffectsManifest(input.manifest), plan.manifest_sha256);
    assert.equal(fresh.buildManagedSandboxPreparationPlan(input).plan_sha256, plan.plan_sha256);
    assert.equal(fresh.assertManagedSandboxPreparationApproval(approvalInput(plan)).execution_available, false);
    assert.equal(fresh.compareManagedSandboxInventory({ manifest: input.manifest, before: input.inventory, after: input.inventory }).status, "UNCHANGED");
  } finally { for (const [target, name, value] of saved.reverse()) target[name] = value; syncBuiltinESMExports(); }
});

let temporaryRoot = null, cleanup = "NOT_NEEDED";
const owner = randomUUID(), tool = fileURLToPath(new URL("../verify/prepare-codex-managed-sandbox.mjs", import.meta.url));
try {
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-managed-sandbox-fixture-"));
  fs.writeFileSync(path.join(temporaryRoot, "owner"), owner, { flag: "wx" });
  const input = fixture(), manifestPath = path.join(temporaryRoot, "manifest.json"), inventoryPath = path.join(temporaryRoot, "inventory.json"), partialPath = path.join(temporaryRoot, "partial.json");
  for (const [file, value] of [[manifestPath, input.manifest], [inventoryPath, input.inventory], [partialPath, { inventory: partial(input.inventory) }]]) fs.writeFileSync(file, JSON.stringify(value), { flag: "wx" });
  const digest = () => fs.readdirSync(temporaryRoot).sort().map(name => [name, createHash("sha256").update(fs.readFileSync(path.join(temporaryRoot, name))).digest("hex")]);
  const before = digest();
  function cli(args) {
    const result = childProcess.spawnSync(process.execPath, [tool, ...args], { encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
    assert.ifError(result.error); assert.equal(result.signal, null); assert.equal(result.stderr, "");
    return { status: result.status, document: JSON.parse(result.stdout) };
  }
  await check("real Node preview emits one JSON document and --json changes no effects", () => {
    const args = ["--manifest", manifestPath, "--inventory", inventoryPath], plain = cli(args), json = cli([...args, "--json"]);
    assert.equal(plain.status, 0); assert.deepEqual(json, plain); assert.equal(json.document.status, "PREPARED_NOT_AUTHORIZED");
    assert.equal(json.document.written, false); assert.equal(json.document.native_execution, "NOT_EXECUTED");
    assert.equal(json.document.execution_available, false); assert.deepEqual(json.document.errors, []); assert.deepEqual(digest(), before);
  });
  await check("real Node partial preview exits one, is blocked and remains read-only", () => {
    const result = cli(["--manifest", manifestPath, "--inventory", partialPath, "--json"]);
    assert.equal(result.status, 1); assert.equal(result.document.status, "PREPARATION_BLOCKED");
    assert.deepEqual(result.document.plan.incomplete_categories, ["wfp_rule"]); assert.equal(result.document.execution_available, false);
    assert.equal(result.document.written, false); assert.deepEqual(digest(), before);
  });
  await check("real Node execute flag is rejected before any input read", () => {
    const result = cli(["--manifest", path.join(temporaryRoot, "absent-manifest.json"), "--inventory", path.join(temporaryRoot, "absent-inventory.json"), "--execute"]);
    assert.equal(result.status, 1); assert.deepEqual(result.document.errors, [{ code: "MANAGED_PREVIEW_ARGUMENT_INVALID" }]);
    assert.equal(result.document.plan, null); assert.deepEqual(digest(), before);
  });
} catch (error) { checks.push({ name: "owned CLI fixture setup", status: "FAIL", detail: String(error.stack ?? error).slice(0, 2000) }); }
finally {
  if (temporaryRoot) try {
    const resolved = fs.realpathSync(temporaryRoot), temporaryParent = fs.realpathSync(os.tmpdir()), same = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
    assert(same(resolved, path.resolve(temporaryRoot)) && same(path.dirname(resolved), temporaryParent));
    assert(path.basename(resolved).startsWith("aidn-managed-sandbox-fixture-")); assert.equal(fs.readFileSync(path.join(resolved, "owner"), "utf8"), owner);
    assert(fs.readdirSync(resolved).every(name => fs.lstatSync(path.join(resolved, name)).isFile() && !fs.lstatSync(path.join(resolved, name)).isSymbolicLink()));
    fs.rmSync(resolved, { recursive: true }); assert(!fs.existsSync(resolved)); cleanup = "PASS";
  } catch (error) { cleanup = "FAIL"; checks.push({ name: "owned fixture cleanup", status: "FAIL", detail: String(error.stack ?? error).slice(0, 2000) }); }
}
const failed = checks.filter(row => row.status === "FAIL").length;
console.log(JSON.stringify({ ok: failed === 0, checks, summary: { pass: checks.length - failed, fail: failed, skip: 0 }, cleanup,
  evidence_scope: "pure contracts and readonly Node CLI with synthetic inventory", native_execution: "NOT_RUN", system_operations: "NOT_RUN", host_inventory_collection: "NOT_RUN" }, null, 2));
if (failed) process.exitCode = 1;
