import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { CODEX_STARTUP_ENVIRONMENT_PROFILES } from "../../src/core/agents/codex-startup-arguments.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { loadStandardWorkflowAssets } from "../../src/application/runtime/standard-workflow-composition.mjs";

// Production CLI and composition, separate fixture principals and activated
// project. No runner/controller/authorization doubles are passed to production.
// Native configuration is deliberately unusable for launch: these tests must
// complete D/H without starting a model, not claim genuine human/native proof.
const mode = process.argv.find(arg => arg.startsWith("--mode="))?.slice(7) ?? "files";
const owned = [], target = createFreshStandardWorkflowFixture(mode, owned);
const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "aidn-ordinary-entry-"));
console.log(JSON.stringify({ proof_class: "offline-public-cli-fixture-principals", target, base, mode }));
const directories = Object.fromEntries(["control", "review", "home", "authority"].map(name => { const p = path.join(base, name); fs.mkdirSync(p); return [name, p]; }));
const product = path.join(target, "product"); fs.mkdirSync(product); fs.writeFileSync(path.join(product, "app.mjs"), "export const value = 1;\n");
fs.mkdirSync(path.join(directories.authority, "inbox"));
const criteria = path.join(base, "criteria.md"); fs.writeFileSync(criteria, "Qualify deterministic STANDARD entry and authenticated fixture decisions.\n");
const pin = file => ({ path: file, sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex") });
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
fs.writeFileSync(path.join(directories.authority, "principals.json"), JSON.stringify({ contract_version: "standard-host-principals.v1",
  principals: [{ authority_id: "fixture_human", kinds: ["human"], public_key: publicKey.export({ format: "pem", type: "spki" }) }] }));
const request = { contract_version: "standard-workflow-execution.v1", execution: { instance_id: "ordinary-standard", target_root: target,
  product_root: product, control_root: directories.control, review_root: directories.review, product_files: ["app.mjs"], criteria: pin(criteria),
  authorities: { project: pin(path.join(target, "AGENTS.md")) }, instructions: {}, controller: {},
  native: { executable: process.execPath, sha256: pin(process.execPath).sha256, home: directories.home, tool_roots: [], protected_roots: [directories.authority],
    hook_hashes: { work: ["sha256:" + "a".repeat(64), "sha256:" + "b".repeat(64)], review: [] }, model: "fixture-no-native", effort: "medium",
    startup: { mcp_server_ids: [], plugin_ids: [], app_ids: [], environment_override_names: [], environment_names: [...CODEX_STARTUP_ENVIRONMENT_PROFILES.worker],
      log_dir: directories.control, sqlite_home: directories.control } } },
  parameters: { session: { session_id: "S001", session_branch: "S001-ordinary", objective: "Ordinary STANDARD entry qualification" },
    cycle: { cycle_id: "C001", cycle_type: "FEATURE", title: "Unused cycle", objective: "No cycle in prefix" } } };
const config = path.join(base, "configuration.json"), actionFile = path.join(base, "action.json"); fs.writeFileSync(config, JSON.stringify(request));
const cli = fileURLToPath(new URL("../../bin/aidn.mjs", import.meta.url));
const environment = { ...process.env, AIDN_STANDARD_HOST_HOME: directories.authority };
let calls = 0;
function run(extra = [], env = environment) {
  let bytes; const started = Date.now();
  try { bytes = execFileSync(process.execPath, [cli, "runtime", "workflow-run", "--target", target, "--configuration", config, "--json", ...extra],
    { env, windowsHide: true, timeout: 180000, maxBuffer: 8388608, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (cause) { if (!cause.stdout?.length) throw cause; bytes = cause.stdout; }
  const result = JSON.parse(bytes); fs.writeFileSync(path.join(base, `call-${++calls}.json`), bytes);
  console.log(JSON.stringify({ call: calls, selectors: extra.filter(value => value.startsWith("--")), elapsed_ms: Date.now() - started, errors: result.errors }));
  return result;
}
function apply(preview, selectors = []) {
  assert.deepEqual(preview.errors, [], JSON.stringify(preview)); fs.writeFileSync(actionFile, JSON.stringify(preview.preview));
  const result = run([...selectors, "--action-file", actionFile, "--execute", "--expect-plan", preview.action_sha256]);
  assert.deepEqual(result.errors, [], JSON.stringify(result)); return result;
}
function inventory(root) {
  const entries = [];
  function walk(dir) { for (const name of fs.readdirSync(dir).sort()) { const file = path.join(dir, name), relative = path.relative(root, file); const st = fs.lstatSync(file);
    if (st.isDirectory()) { entries.push([relative, "directory"]); walk(file); } else entries.push([relative, pin(file).sha256]); } }
  walk(root); return shadowHash(entries);
}
const before = inventory(target), privateBefore = inventory(directories.authority), preview = run();
assert.deepEqual(preview.errors, [], JSON.stringify(preview)); assert.equal(preview.preview.kind, "prepare_host");
assert.equal(inventory(target), before); assert.equal(inventory(directories.authority), privateBefore);
assert.equal(preview.preview.context.native.native_started, false);
assert.equal(run([], { ...environment, AIDN_STANDARD_HOST_HOME: "" }).errors[0], "STANDARD_HOST_HOME_REQUIRED");
const bad = run(["--execute", "--expect-plan", preview.action_sha256]); assert.equal(bad.errors[0], "STANDARD_ENTRY_EXACT_ACTION_REQUIRED");
assert.equal(inventory(target), before); assert.equal(inventory(directories.authority), privateBefore);
apply(preview);
assert.equal(run(["--action-file", actionFile, "--execute", "--expect-plan", preview.action_sha256]).errors[0], "STANDARD_ENTRY_PRECONDITIONS_CHANGED");
const initialize = run(); assert.equal(initialize.preview.kind, "initialize"); apply(initialize);
console.log("PASS ordinary CLI: preview immutability, missing authority, separate exact host-key preparation and initialization");
let waiting, callTransitions = 0;
for (let i = 0; i < 8; i++) {
  const next = run(); assert.deepEqual(next.errors, [], JSON.stringify(next));
  assert.equal(next.preview.context.native.model_sha256, loadStandardWorkflowAssets().source.model_sha256);
  if (next.preview.kind === "dispatch" && next.preview.payload.question) { waiting = next; break; }
  if (next.preview.kind === "call") {
    assert.equal(next.preview.payload.transition, "call_entry");
    assert.equal(apply(next).result.workflow_completed, false); callTransitions++; continue;
  }
  assert.equal(next.preview.kind, "operation"); const binding = next.preview.payload.preview.binding.id;
  const result = apply(next); console.log(`PASS ordinary CLI: ${binding} ${result.result.operation_outcome}`);
}
assert.ok(waiting, "published model must reach its actual durable H wait before Native");
const question = waiting.preview.payload.question;
const claim = { contract_version: "human-mode-decision.v1", source_kind: "human", authority_id: "fixture_human", source_event_id: "ordinary-defer",
  subject_sha256: "a".repeat(64), question_sha256: shadowHash(question), choice: "deferred", evidence_refs: [{ ref: "fixture:ordinary/mode", sha256: "a".repeat(64) }] };
function signed(choice, ref, q = question) {
  const source = { ...claim, source_event_id: `ordinary-${ref}`, choice, question_sha256: shadowHash(q) };
  const body = { contract_version: "standard-host-source.v1", kind: "human", authority_id: "fixture_human", source_ref: ref, subject_sha256: shadowHash(q),
    // This NEW fixture envelope must survive two independently bounded public
    // invocations (2 * 180s). Expiry has its own isolated adapter test; never
    // extend an existing authority to repair an already failed case.
    payload: source, issued_at_ms: Date.now() - 1, expires_at_ms: Date.now() + 600000 };
  return { ...body, signature: sign(null, Buffer.from(shadowHash(body)), privateKey).toString("base64") };
}
const ref = "mode-defer", sourceFile = path.join(directories.authority, "inbox", ref + ".json");
const forgedEnvelope = { ...signed("deferred", ref), signature: Buffer.alloc(64).toString("base64") };
fs.writeFileSync(sourceFile, JSON.stringify(forgedEnvelope));
let decision = run(["--decision-source", ref]);
fs.writeFileSync(actionFile, JSON.stringify(decision.preview));
const forged = run(["--decision-source", ref, "--action-file", actionFile, "--execute", "--expect-plan", decision.action_sha256]);
assert.ok(Date.now() < forgedEnvelope.expires_at_ms, "signature-only case must remain fresh through rejection");
assert.equal(forged.errors[0], "STANDARD_HOST_SOURCE_NOT_AUTHENTICATED");
fs.writeFileSync(sourceFile, JSON.stringify(signed("deferred", ref)));
decision = run(["--decision-source", ref]); const deferred = apply(decision, ["--decision-source", ref]);
assert.equal(deferred.result.details.receipt.outcome, "deferred"); assert.deepEqual(deferred.result.details.receipt.facts, {});
assert.equal(deferred.result.workflow_completed, false); assert.equal(deferred.result.process_status, "WAITING");
console.log("PASS ordinary CLI: cold durable H wait, forged signature refusal and authenticated deferred decision");
const next = run(); assert.equal(next.preview.kind, "operation"); assert.equal(next.preview.payload.preview.binding.id, "mode_decision"); apply(next);
const fresh = run(); assert.equal(fresh.preview.kind, "dispatch"); assert.notEqual(shadowHash(fresh.preview.payload.question), shadowHash(question));
decision = run(["--decision-source", ref]); fs.writeFileSync(actionFile, JSON.stringify(decision.preview));
assert.equal(run(["--decision-source", ref, "--action-file", actionFile, "--execute", "--expect-plan", decision.action_sha256]).errors[0], "STANDARD_HOST_SOURCE_INVALID");
const freshRef = "mode-thinking"; fs.writeFileSync(path.join(directories.authority, "inbox", freshRef + ".json"), JSON.stringify(signed("THINKING", freshRef, fresh.preview.payload.question)));
const resumed = apply(run(["--decision-source", freshRef]), ["--decision-source", freshRef]); assert.equal(resumed.result.details.receipt.outcome, "completed");
const startupBindings = [];
for (let i = 0; !startupBindings.includes("session_start_finalize"); i++) {
  assert.ok(i < 8, "the deterministic startup suffix must finish before any Native activity");
  const next = run(); assert.deepEqual(next.errors, [], JSON.stringify(next));
  if (next.preview.kind === "call") {
    assert.equal(next.preview.payload.transition, "call_return");
    assert.equal(apply(next).result.workflow_completed, false); callTransitions++; continue;
  }
  assert.equal(next.preview.kind, "operation");
  const binding = next.preview.payload.preview.binding.id;
  assert.ok(["session_mode_apply", "session_entry_admit", "mode_work_preflight", "session_start_finalize"].includes(binding));
  const applied = apply(next); assert.equal(applied.result.operation_outcome, "completed"); startupBindings.push(binding);
}
assert.deepEqual(startupBindings, ["session_mode_apply", "session_entry_admit", "mode_work_preflight", "session_start_finalize"]);
assert.equal(callTransitions, 2);
const replay = run(["--replay"]), simulation = run(["--simulate"]); assert.deepEqual(replay.errors, []); assert.deepEqual(simulation.errors, []);
assert.equal(replay.result.instance_sha256, simulation.result.instance_sha256);
assert.equal(fs.readdirSync(directories.control).length, 0, "D/H must never allocate Native or worker evidence");
console.log(JSON.stringify({ status: "PASS", mode, calls, call_transitions: callTransitions, startup_bindings: startupBindings,
  model_sha256: loadStandardWorkflowAssets().source.model_sha256, same_reducer_replay_simulation: true,
  productive_cold_resume: "authenticated H followed by accepted process event", native: "NOT_RUN", genuine_human: "NOT_RUN", installed: "NOT_RUN", target, base }));
