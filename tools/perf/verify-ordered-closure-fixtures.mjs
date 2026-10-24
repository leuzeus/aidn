#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createOrderedClosureSequence } from "../../src/application/codex/ordered-closure-sequence.mjs";

const root = process.cwd(), sha = value => createHash("sha256").update(value).digest("hex");
const checks = [];
const request = stage => ({ stage, cycle_id: "C001", session_id: "S001", outcome: stage === "cycle" ? "DONE" : "CLOSED",
  mutations: (stage === "cycle" ? ["cycles/C001-feature/status.md", "CURRENT-STATE.md"] : ["sessions/S001.md"]).map(path => ({
    path, expected_sha256: "a".repeat(64), replacements: [{ old: "before", new: "after" }] })) });
const clone = value => structuredClone(value);
function fixture(options = {}) {
  let clock = 100, calls = [], bindings = 0;
  const binding = { target_root: root, state_mode: "db-only", backend: "postgres", stop_required: false, revision: "b".repeat(64) };
  const runner = createOrderedClosureSequence({ targetRoot: root, deadline: 1000, now: () => clock,
    readBinding: async () => { bindings++; return options.binding?.(bindings, clone(binding)) ?? binding; },
    execute: async argv => {
      calls.push(argv); await options.onExecute?.(calls.length, argv);
      if (options.exception === calls.length) throw new Error("fixture-executor-failure");
      const data = { ok: true, target_root: root };
      if (argv[1] === "pre-write-admit") Object.assign(data, { admission_status: "admitted", context: { active_session: "S001", active_cycle: argv.includes("cycle-close") ? "C001" : "none" } });
      else if (argv[1] === "db-first-artifact") {
        const path = argv[argv.indexOf("--path") + 1];
        const content = path === "CURRENT-STATE.md" ? "active_cycle: none\nactive_session: S001\nfirst_plan_step: none\n"
          : path.startsWith("cycles/") ? "state: DONE\n" : path.startsWith("sessions/") ? "state: CLOSED\n" : "runtime";
        Object.assign(data, { materialized: false, backend: "postgres", artifact: { path, content, sha256: sha(content) },
          ...(argv.includes("--replace") ? { mutation: { kind: "compare-and-swap-replacements", expected_sha256: argv[argv.indexOf("--expect-sha256") + 1] } } : {}) });
      } else if (argv[1] === "project-runtime-state") Object.assign(data, { written: true, consistency: { pass: true } });
      else Object.assign(data, { result: "ok", command_status: 0, skill: argv[argv.indexOf("--skill") + 1], strict: true, repair_layer_blocking: false });
      const result = { target_root: root, executed: true, exit_code: 0, data, hook_evidence: { status: "PASS" } };
      if (options.failAt === calls.length) result.exit_code = 9;
      options.result?.(calls.length, result, argv);
      return result;
    } });
  return { runner, calls, setClock: value => clock = value };
}
const test = async (name, action) => { await action(); checks.push(name); };
try {
  await test("preview performs no scope reads or commands and grants no authorization", async () => {
    const f = fixture({ binding: () => { throw Error("preview read"); } }); const r = await f.runner.run(request("cycle"));
    assert.equal(r.status, "PREVIEW"); assert.equal(r.write_authorization, false); assert.equal(r.written, false); assert.equal(f.calls.length, 0);
  });
  await test("explicit cycle then session run actual admissions, CAS writes, generated runtime and strict final hooks in order", async () => {
    const f = fixture(); const cycle = await f.runner.run(request("cycle"), { write: true });
    assert.equal(cycle.status, "PASS"); assert.equal(cycle.steps.length, 6);
    assert.equal((await f.runner.run(request("session"), { write: true })).status, "PASS");
    assert.equal(f.calls.length, 9);
    assert(f.calls.filter(a => a[1] === "run-json-hook").every(a => ["--strict", "--fail-on-repair-block", "--no-auto-skip-gate"].every(f => a.includes(f))));
    assert(f.calls.filter(a => a[1] === "db-first-artifact").every(a => a.includes("--no-materialize")));
    const generated = f.calls.find(a => a[1] === "project-runtime-state");
    const persisted = f.calls.find(a => a.includes("RUNTIME-STATE.md"));
    assert.equal(generated[generated.indexOf("--out") + 1], persisted[persisted.indexOf("--source-file") + 1]);
    assert.equal((await f.runner.run(request("session"), { write: true })).status, "REFUSED");
  });
  await test("session cannot start before an actual successful cycle hook", async () => {
    const f = fixture(); assert.equal((await f.runner.run(request("session"), { write: true })).status, "REFUSED"); assert.equal(f.calls.length, 0);
  });
  for (let failAt = 1; failAt <= 6; failAt++) await test(`actual refusal ${failAt} stops dependent work and poisons replay`, async () => {
    const f = fixture({ failAt }); const result = await f.runner.run(request("cycle"), { write: true });
    assert.equal(result.stop_required, true); assert.equal(result.retry_allowed, false); assert.equal(f.calls.length, failAt);
    assert.equal(result.status, failAt > 2 ? "PARTIAL" : failAt === 2 ? "PARTIAL" : "REFUSED");
    await f.runner.run(request("cycle"), { write: true }); await f.runner.run(request("session"), { write: true }); assert.equal(f.calls.length, failAt);
  });
  for (const [name, modify] of [
    ["unknown fields", r => r.skip_gate = true], ["foreign cycle", r => r.mutations[0].path = "cycles/C002-feature/status.md"],
    ["foreign session", r => r.session_id = "../../S001"], ["scope traversal", r => r.mutations[1].path = "../CURRENT-STATE.md"],
    ["missing CAS", r => r.mutations[0].expected_sha256 = ""], ["implicit outcome", r => delete r.outcome],
    ["unsupported outcome", r => r.outcome = "CANCELLED"], ["duplicate path", r => r.mutations.push(clone(r.mutations[1]))],
    ["arbitrary command", r => r.command = "git merge dev"], ["oversized request", r => r.mutations[0].replacements[0].new = "x".repeat(100000)],
  ]) await test(`${name} refuses before any actual command`, async () => {
    const f = fixture(), r = request("cycle"); modify(r); const result = await f.runner.run(r, { write: true });
    assert.equal(result.status, "REFUSED"); assert.equal(f.calls.length, 0);
  });
  for (const [name, binding] of [
    ["files mode retains legacy path", () => ({ target_root: root, backend: "sqlite", state_mode: "files", stop_required: false, revision: "b".repeat(64) })],
    ["foreign target", (n, b) => ({ ...b, target_root: root + "/foreign" })],
    ["canonical unavailable", (n, b) => ({ ...b, backend: "unavailable" })],
    ["global stop", (n, b) => ({ ...b, stop_required: true })],
    ["changed scope", (n, b) => ({ ...b, revision: n > 1 ? "c".repeat(64) : b.revision })],
  ]) await test(`${name} stops without fallback`, async () => {
    const f = fixture({ binding }); const result = await f.runner.run(request("cycle"), { write: true });
    assert.equal(result.stop_required, true); assert.equal(f.calls.length, name === "changed scope" ? 1 : 0);
  });
  for (const [name, mutate] of [
    ["admission entity mismatch", (n, r) => { if (n === 1) r.data.context.active_cycle = "C002"; }],
    ["preparation did not execute", (n, r) => { if (n === 2) r.executed = false; }],
    ["wrong receipt target", (n, r) => { if (n === 2) r.target_root = root + "/foreign"; }],
    ["CAS receipt mismatch", (n, r) => { if (n === 2) r.data.mutation.expected_sha256 = "c".repeat(64); }],
    ["incorrect content hash", (n, r) => { if (n === 2) r.data.artifact.sha256 = "c".repeat(64); }],
    ["missing terminal state", (n, r) => { if (n === 2) { r.data.artifact.content = "state: IMPLEMENTING\n"; r.data.artifact.sha256 = sha(r.data.artifact.content); } }],
    ["selected session cleared", (n, r) => { if (n === 3) { r.data.artifact.content = "active_cycle: none\nactive_session: none\nfirst_plan_step: none\n"; r.data.artifact.sha256 = sha(r.data.artifact.content); } }],
    ["generated runtime inconsistent", (n, r) => { if (n === 4) r.data.consistency.pass = false; }],
    ["nested hook failure", (n, r) => { if (n === 6) r.hook_evidence.status = "FAIL"; }],
    ["strict hook downgraded", (n, r) => { if (n === 6) r.data.strict = false; }],
    ["repair blocked", (n, r) => { if (n === 6) r.data.repair_layer_blocking = true; }],
  ]) await test(`${name} never qualifies the segment`, async () => {
    const f = fixture({ result: mutate }); const result = await f.runner.run(request("cycle"), { write: true }); assert.equal(result.stop_required, true); assert.notEqual(result.status, "PASS");
  });
  await test("source request mutation during execution cannot change later writes", async () => {
    const input = request("cycle"); const f = fixture({ onExecute: n => { if (n === 1) input.mutations[1].path = "AGENTS.md"; } });
    assert.equal((await f.runner.run(input, { write: true })).status, "PASS"); assert.equal(f.calls[2][f.calls[2].indexOf("--path") + 1], "CURRENT-STATE.md");
  });
  await test("executor exception stops the whole invocation", async () => {
    const f = fixture({ exception: 2 }); const outcome = await f.runner.run(request("cycle"), { write: true });
    assert.equal(outcome.status, "PARTIAL"); assert.equal(outcome.written, null); assert.equal(outcome.steps.at(-1).executed, null);
    await f.runner.run(request("cycle"), { write: true }); assert.equal(f.calls.length, 2);
  });
  await test("concurrent segment refuses and interrupts further dependent commands", async () => {
    let release, started;
    const began = new Promise(resolve => { started = resolve; });
    const blocked = new Promise(resolve => { release = resolve; });
    const f = fixture({ onExecute: async n => { if (n === 1) { started(); await blocked; } } });
    const first = f.runner.run(request("cycle"), { write: true }); await began;
    assert.equal((await f.runner.run(request("cycle"), { write: true })).status, "REFUSED");
    release(); assert.notEqual((await first).status, "PASS"); assert.equal(f.calls.length, 1);
  });
  await test("expired original deadline starts no command", async () => {
    const f = fixture(); f.setClock(1000); assert.equal((await f.runner.run(request("cycle"), { write: true })).status, "REFUSED"); assert.equal(f.calls.length, 0);
  });
  await test("write intent is an actual boolean", async () => {
    const f = fixture(); assert.equal((await f.runner.run(request("cycle"), { write: "false" })).status, "REFUSED"); assert.equal(f.calls.length, 0);
  });
  console.log(JSON.stringify({ status: "PASS", proof_class: "injected-host-fixtures", assertions: checks.length, checks,
    native_qualification: "UNAVAILABLE", live_postgres: "UNAVAILABLE", files_mode: "REFUSED_WITH_LEGACY_PATH_UNCHANGED" }));
} catch (error) { console.error(error.stack); process.exitCode = 1; }
