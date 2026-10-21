#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createTrackedFixtureFilter, removePathWithRetry } from "./test-git-fixture-lib.mjs";
import { isActivationFixtureSource, prepareActivationFixture } from "./test-activation-fixture-lib.mjs";
import { withWorkflowObservation, observeWorkflowRead, workflowObservationActive } from "../../src/application/runtime/workflow-observation-service.mjs";
import { validateJsonSchema } from "../../src/core/contracts/json-schema-validator.mjs";
import { resolveCliEffectClass } from "../../src/core/cli/effect-policy.mjs";
import schema from "../../src/core/contracts/cli-output/codex-workflow-step-agent.v1.schema.json" with { type: "json" };
import errorSchema from "../../src/core/contracts/cli-output/codex-workflow-step-agent-error.v1.schema.json" with { type: "json" };
import { loadSharedStateSnapshotAsync } from "../../src/application/runtime/shared-state-backend-service.mjs";
import { createRuntimeArtifactStore } from "../../src/application/runtime/runtime-persistence-service.mjs";
import { createHash } from "node:crypto";

const repo = path.resolve(import.meta.dirname, "../.."), root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-grouped-"));
const target = path.join(root, "client"), source = path.join(repo, "tests/fixtures/repo-installed-core");
const checks = [];
const run = (exe, args, cwd = target) => {
  const result = spawnSync(exe, args, { cwd, encoding: "utf8", windowsHide: true, timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
  assert(!result.error, result.error?.message); return result;
};
const cli = args => { const r = run(process.execPath, [path.join(repo, "bin/aidn.mjs"), ...args.slice(0, 2), "--target", target, ...args.slice(2)], repo);
  return { ...r, payload: JSON.parse(r.stdout) }; };
const workflow = extra => cli(["codex", "workflow-step", "--skills", "context-reload,branch-cycle-audit,requirements-delta", "--view", "agent", "--json", ...extra]);
const configFile = path.join(target, ".aidn/config.json"), packetFile = path.join(target, "docs/audit/HANDOFF-PACKET.md");
const contextFile = ".aidn/runtime/context/codex-context.json";
try {
  const tracked = createTrackedFixtureFilter(source, repo);
  fs.cpSync(source, target, { recursive: true, filter: file => tracked(file) && isActivationFixtureSource(source, file, { freshContext: true }) });
  for (const args of [["init", "-b", "test/grouped"], ["config", "user.name", "AIDN fixture"], ["config", "user.email", "fixture@example.invalid"],
    ["add", "docs", ".aidn/config.json"], ["commit", "-m", "fixture"]]) assert.equal(run("git", args).status, 0);
  prepareActivationFixture(target, repo);
  const packet = fs.readFileSync(packetFile); fs.unlinkSync(packetFile);
  for (const mode of ["files", "dual", "db-only"]) {
    fs.writeFileSync(configFile, JSON.stringify({ version: 1, runtime: { stateMode: mode, indexStoreMode: "dual-sqlite" }, workflow: { sourceBranch: "dev" } }));
    for (const name of ["CURRENT-STATE.md", "RUNTIME-STATE.md"]) {
      const file = path.join(target, "docs/audit", name);
      fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^runtime_state_mode:.*$/m, `runtime_state_mode: ${mode}`));
    }
    const indexed = cli(["perf", "index", "--store", "sqlite", "--with-content", "--json"]); assert.equal(indexed.status, 0, indexed.stderr);
    const full = workflow([]);
    const hydrationFile = path.join(target, ".aidn/runtime/context/hydrated-context.json"), cached = fs.readFileSync(hydrationFile, "utf8");
    const grouped = workflow(["--grouped"]);
    assert.equal(grouped.status, 0, grouped.stderr || JSON.stringify(grouped.payload));
    assert.deepEqual(validateJsonSchema(grouped.payload, schema, "$"), []);
    assert.equal(grouped.payload.observation_scope, "invocation-common");
    assert.equal(grouped.payload.observation.fence_status, "unchanged");
    assert.equal(grouped.payload.write_authorization, false);
    assert.equal(grouped.payload.effect_class, "read-only");
    assert.equal(fs.readFileSync(hydrationFile, "utf8"), cached);
    assert.equal(resolveCliEffectClass("aidn codex workflow-step", ["--grouped", "--view", "agent", "--json"]), "read-only");
    assert.equal(resolveCliEffectClass("aidn codex workflow-step", ["--grouped", "--view", "agent", "--write", "--json"]), "mutating");
    for (const admission of grouped.payload.admissions) {
      const before = full.payload.admissions.find(row => row.skill === admission.skill);
      assert.equal(admission.ok, before.ok); assert.deepEqual(admission.blocking_reasons, before.blocking_reasons);
    }
    assert.equal(full.payload.summary.hydrate_count, 3);
    assert.equal(grouped.payload.summary.hydrate_count, 1, JSON.stringify({ mode, admissions: grouped.payload.admissions,
      next_action: grouped.payload.next_action.recommendation, packet: grouped.payload.next_action.packet_file }));
    assert.deepEqual(grouped.payload.contexts.map(row => row.skill), ["context-reload", "branch-cycle-audit"]);
    assert(grouped.payload.admissions.find(row => row.skill === "requirements-delta").blocking_reasons.length);
    assert.equal(new Set(grouped.payload.artifacts.map(row => row.id)).size, grouped.payload.artifacts.length);
    checks.push(`${mode}: equivalent admissions, one hydration, blocked skill has no context`);
  }
  for (const mode of ["files", "dual"]) {
    fs.writeFileSync(configFile, JSON.stringify({ version: 1, runtime: { stateMode: mode, indexStoreMode: "dual-sqlite" } }));
    for (const name of ["CURRENT-STATE.md", "RUNTIME-STATE.md"]) {
      const file = path.join(target, "docs/audit", name);
      fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^runtime_state_mode:.*$/m, `runtime_state_mode: ${mode}`).replace(/^mode:.*$/m, "mode: THINKING"));
    }
    assert.equal(cli(["perf", "index", "--store", "sqlite", "--with-content", "--json"]).status, 0);
    const current = path.join(target, "docs/audit/CURRENT-STATE.md");
    fs.writeFileSync(current, fs.readFileSync(current, "utf8").replace(/^mode: THINKING$/m, "mode: EXPLORING"));
    const shadow = workflow(["--grouped"]);
    if (mode === "files") {
      assert.notEqual(shadow.status, 0); assert.equal(shadow.payload.code, "WORKFLOW_CONTEXT_SOURCE_MISMATCH");
      assert.deepEqual(validateJsonSchema(shadow.payload, errorSchema, "$"), []);
      fs.writeFileSync(current, fs.readFileSync(current, "utf8").replace(/^mode: EXPLORING$/m, "mode: THINKING"));
    } else {
      assert.equal(shadow.status, 0); assert.equal(shadow.payload.admissions[0].context.mode, "THINKING");
      assert.equal(shadow.payload.admissions[0].source_of_truth.observed_sources.current_state, "sqlite");
    }
    const spec = path.join(target, "docs/audit/SPEC.md"), original = fs.readFileSync(spec);
    fs.writeFileSync(spec, "# Current checkout rule marker\n" + original.toString());
    const staleRule = workflow(["--grouped", "--write"]);
    assert.notEqual(staleRule.status, 0); assert.equal(staleRule.payload.code, "WORKFLOW_CONTEXT_SOURCE_MISMATCH");
    assert.equal(staleRule.payload.effect_class, "mutating"); assert.equal(staleRule.payload.receipt, null);
    assert.deepEqual(validateJsonSchema(staleRule.payload, errorSchema, "$"), []);
    assert(!fs.existsSync(path.join(target, ".aidn/runtime/context/agent-view-receipts")));
    fs.writeFileSync(spec, original);
    checks.push(`${mode}: stale rule projection refuses without publishing context or retaining a stale receipt`);
  }
  fs.writeFileSync(configFile, JSON.stringify({ version: 1, runtime: { stateMode: "db-only", indexStoreMode: "dual-sqlite" } }));
  for (const name of ["CURRENT-STATE.md", "RUNTIME-STATE.md"]) {
    const file = path.join(target, "docs/audit", name);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^runtime_state_mode:.*$/m, "runtime_state_mode: db-only"));
  }
  assert.equal(cli(["perf", "index", "--store", "sqlite", "--with-content", "--json"]).status, 0);
  fs.writeFileSync(packetFile, packet);
  const staleLocal = workflow(["--grouped"]);
  assert.equal(staleLocal.payload.next_action.recommendation.stop_required, false);
  assert.equal(staleLocal.payload.summary.hydrate_count, 1);
  checks.push("db-only ignores a local packet absent from canonical state");
  fs.unlinkSync(packetFile);
  const runtimeFile = path.join(target, "docs/audit/RUNTIME-STATE.md");
  fs.writeFileSync(runtimeFile, fs.readFileSync(runtimeFile, "utf8").replace(/^repair_routing_hint:.*$/m, "repair_routing_hint: block"));
  assert.equal(cli(["perf", "index", "--store", "sqlite", "--with-content", "--json"]).status, 0);
  // An explicit canonical repair route asks the coordinator to stop. No rich
  // hydration is allowed even for a separately admitted read skill.
  const stopped = workflow(["--grouped"]);
  assert.equal(stopped.status, 0); assert.equal(stopped.payload.next_action.recommendation.stop_required, true,
    JSON.stringify(stopped.payload.next_action.recommendation));
  assert.equal(stopped.payload.summary.hydrate_count, 0); assert.deepEqual(stopped.payload.contexts, []);
  checks.push("global coordinator stop prevents every hydration");

  let loads = 0, retained;
  const observed = await withWorkflowObservation({ targetRoot: target, contextFile }, async () => {
    const load = async () => { loads++; return { authority: "original", revision: 1 }; };
    const a = await observeWorkflowRead({ targetRoot: target, key: "fixture", load });
    a.authority = "consumer mutation";
    retained = await observeWorkflowRead({ targetRoot: target, key: "fixture", load });
    return true;
  });
  assert.equal(loads, 2); assert.equal(retained.authority, "original"); assert.equal(observed.observation.distinct_reads, 1);
  assert.equal(workflowObservationActive(target), false);
  checks.push("private observation is cloned, shared once, freshly fenced and discarded");
  await assert.rejects(withWorkflowObservation({ targetRoot: target, contextFile }, async () => {
    let revision = 1;
    await observeWorkflowRead({ targetRoot: target, key: "changing", load: async () => ({ revision: revision++ }) });
  }), /INVALIDATED/);
  checks.push("concurrent canonical change refuses publication");
  const originalSnapshot = await loadSharedStateSnapshotAsync({ targetRoot: target });
  const sqlite = createRuntimeArtifactStore({ targetRoot: target, backend: "sqlite" });
  try {
    await assert.rejects(withWorkflowObservation({ targetRoot: target, contextFile }, async () => {
      const first = await loadSharedStateSnapshotAsync({ targetRoot: target }), changed = structuredClone(first.payload);
      const artifact = changed.artifacts.find(row => row.path === "SPEC.md");
      artifact.content += "\nConcurrent canonical fixture change\n";
      artifact.sha256 = createHash("sha256").update(artifact.content).digest("hex");
      await sqlite.writeIndexProjection({ payload: changed });
      const second = await loadSharedStateSnapshotAsync({ targetRoot: target });
      assert.deepEqual(second.payload.artifacts, first.payload.artifacts);
    }), /INVALIDATED/);
  } finally { await sqlite.writeIndexProjection({ payload: originalSnapshot.payload }); }
  checks.push("real SQLite consumers share the first snapshot and a concurrent canonical write invalidates publication");
  await assert.rejects(withWorkflowObservation({ targetRoot: target, contextFile }, async () => {
    fs.appendFileSync(path.join(target, "docs/audit/CURRENT-STATE.md"), "\nmaterial change\n");
  }), /INVALIDATED/);
  checks.push("concurrent local authority change refuses publication");
  const ignored = path.join(target, "docs/audit/ignored-local.md");
  fs.appendFileSync(path.join(target, ".gitignore"), "\ndocs/audit/ignored-local.md\n");
  fs.writeFileSync(ignored, "original ignored authority");
  await assert.rejects(withWorkflowObservation({ targetRoot: target, contextFile }, async () => {
    fs.appendFileSync(ignored, " changed");
  }), /INVALIDATED/);
  checks.push("ignored local workflow bytes remain part of the revision fence");
  await assert.rejects(withWorkflowObservation({ targetRoot: target, contextFile }, async () => {
    try { await observeWorkflowRead({ targetRoot: path.join(root, "foreign"), key: "foreign", load: async () => ({}) }); } catch { /* Consumer cannot suppress a scope failure. */ }
  }), /INVALIDATED/);
  checks.push("foreign scope remains fatal even when a consumer catches its error");
  assert.notEqual(workflow(["--grouped", "--view", "full"]).status, 0);
  checks.push("unsupported grouped selectors refuse before execution");
  fs.writeFileSync(configFile, JSON.stringify({ version: 1, runtime: { stateMode: "db-only",
    persistence: { backend: "postgres", connectionRef: "env:AIDN_GROUPED_FIXTURE_UNSET_20261020" } } }));
  const unavailable = workflow(["--grouped"]);
  assert.equal(unavailable.status, 0, unavailable.stderr || JSON.stringify(unavailable.payload));
  assert.equal(unavailable.payload.ok, false); assert.equal(unavailable.payload.summary.hydrate_count, 0);
  assert(unavailable.payload.admissions.every(row => !row.ok));
  assert(unavailable.payload.admissions.some(row => row.blocking_reasons.some(reason => reason.includes("canonical runtime backend is unavailable"))));
  checks.push("configured PostgreSQL unavailable refuses without file or SQLite fallback");
  console.log(JSON.stringify({ status: "PASS", proof_class: "fixtures-and-real-source-cli", assertions: checks.length, checks,
    installed_package: "SKIP", native_tokens: "UNAVAILABLE", postgres_integration: "SKIP" }));
} catch (error) { console.error(error.stack); process.exitCode = 1; }
finally { removePathWithRetry(root); }
