#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { artifactContentHash as hash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { applyArtifactReplacements } from "../../src/core/workflow/artifact-replacements.mjs";
import { createProjectArtifactStore } from "../../src/application/runtime/project-artifact-store-service.mjs";
import { distributedTemplates } from "../../src/application/runtime/template-inventory-service.mjs";
import { prepareArtifactIntentBatch, artifactIntentObservationRevision, runPreparedOrderedClosure } from "../../src/application/codex/artifact-intent-preparation.mjs";
import { createOrderedClosureSequence } from "../../src/application/codex/ordered-closure-sequence.mjs";

const scope = { project_id: "fixture-project", workspace_id: "fixture-workspace", runtime_scope_id: "fixture-runtime", worktree_id: "fixture-worktree" };
const row = (path, content, extra = {}) => ({ path, content, content_format: "utf8", sha256: hash(content), ...extra });
const status = "cycles/C001-feature/status.md", current = "CURRENT-STATE.md";
function fixture() {
  const observation = { target_root: process.cwd(), backend: "sqlite", state_mode: "db-only", scope: { ...scope },
    artifacts: [row(status, "# Cycle\nstate: VERIFYING\nnext_action: Report actual result\n\n## Evidence\nKeep existing evidence.\n"),
      row(current, "# Current\nactive_session: S001\nactive_cycle: C001\nfirst_plan_step: Review actual result\n"),
      row("cycles/TEMPLATE_brief.md", "# Brief CXXX\n\n## Objective\nDescribe the objective.\n\n## Constraints\nKeep all constraints.\n")],
    absent_paths: ["cycles/C001-feature/brief.md"], template_paths: ["cycles/TEMPLATE_brief.md"] };
  const request = { scope: { ...scope }, observation_sha256: artifactIntentObservationRevision(observation), session_id: "S001", cycle_id: "C001",
    items: [{ path: status, source_path: status, edits: [{ kind: "field", key: "state", value: "DONE" }] },
      { path: current, source_path: current, edits: [{ kind: "field", key: "active_cycle", value: "none" }, { kind: "field", key: "first_plan_step", value: "none" }] }] };
  return { observation, request };
}
const bind = f => { f.request.observation_sha256 = artifactIntentObservationRevision(f.observation); return f; };
const prepare = f => prepareArtifactIntentBatch(f.request, f.observation);

export async function verifyArtifactIntentPreparation() {
  const checks = [], test = async (name, action) => { await action(); checks.push(name); };
  await test("one pure batch binds complete canonical preimages and exact generated hashes", () => {
    const f = fixture(), before = structuredClone(f), result = prepare(f);
    assert.deepEqual(f, before); assert.equal(result.status, "READY"); assert.equal(result.written, false);
    assert.equal(result.write_authorization, false); assert.equal(result.freshness_proven, false);
    assert.equal(result.items.length, 2); assert.equal(result.sources.length, 2);
    for (const item of result.items) {
      const source = f.observation.artifacts.find(row => row.path === item.path);
      assert.equal(item.cas_request.expectedSha256, source.sha256);
      assert.equal(hash(applyArtifactReplacements(source, item.cas_request.replacements, source.sha256)), item.proposed_sha256);
    }
    assert.deepEqual(prepare(f), result);
  });
  await test("section preparation preserves nested exceptions and all unselected text", () => {
    const f = fixture(); f.request.items = [{ path: status, source_path: status,
      edits: [{ kind: "section", heading: "## Evidence", body: "Actual evidence supplied by the caller.\n### Exception\nKeep this exception.\n" }] }];
    const result = prepare(f), item = result.items[0], original = f.observation.artifacts[0];
    assert.equal(result.status, "READY");
    assert.equal(applyArtifactReplacements(original, item.cas_request.replacements, original.sha256),
      "# Cycle\nstate: VERIFYING\nnext_action: Report actual result\n\n## Evidence\nActual evidence supplied by the caller.\n### Exception\nKeep this exception.\n");
  });
  await test("heading-scoped fields address the real row while leaving fenced examples unchanged", () => {
    const f = fixture(); f.observation.artifacts[0] = row(status, "# Cycle\r\n## Actual\r\n```yaml\r\nstate: VERIFYING\r\n```\r\nstate: VERIFYING\r\n## History\r\nstate: VERIFYING\r\n"); bind(f);
    f.request.items = [{ path: status, source_path: status, edits: [{ kind: "field", key: "state", value: "$& DONE", heading: "## Actual" }] }];
    const result = prepare(f); assert.equal(result.status, "READY");
    const changed = applyArtifactReplacements(f.observation.artifacts[0], result.items[0].cas_request.replacements, f.observation.artifacts[0].sha256);
    assert.equal(changed, "# Cycle\r\n## Actual\r\n```yaml\r\nstate: VERIFYING\r\n```\r\nstate: $& DONE\r\n## History\r\nstate: VERIFYING\r\n");
  });
  await test("explicit row replacements retain existing uniqueness and overlap refusal", () => {
    const f = fixture(); f.request.items[0].edits = [{ kind: "replace", old: "state: VERIFYING", new: "state: DONE" }];
    assert.equal(prepare(f).status, "READY");
    f.request.items[0].edits[0].old = "e"; assert.equal(prepare(f).status, "REFUSED");
  });
  await test("template preparation retains every unedited byte and emits create-only CAS", () => {
    const f = fixture(); f.request.items = [{ path: f.observation.absent_paths[0], source_path: f.observation.template_paths[0], edits: [
      { kind: "replace", old: "CXXX", new: "C001" }, { kind: "section", heading: "## Objective", body: "Explicit requested objective.\n\n" }] }];
    const result = prepare(f); assert.equal(result.status, "READY");
    assert.equal(result.items[0].cas_request.expectedSha256, null);
    assert.equal(result.items[0].cas_request.artifact.content, "# Brief C001\n\n## Objective\nExplicit requested objective.\n\n## Constraints\nKeep all constraints.\n");
    assert.equal(result.items[0].cas_request.artifact.cycle_id, "C001");
  });
  await test("compact fields, sections and literal rows compile in explicit documented order", () => {
    const f = fixture(); f.request.items = [{ path: status, fields: { state: "DONE" },
      sections: { "## Evidence": "Caller-supplied verified evidence.\n" }, replacements: [{ old: "Report actual result", new: "Keep actual receipts" }] }];
    const result = prepare(f); assert.equal(result.status, "READY");
    const content = applyArtifactReplacements(f.observation.artifacts[0], result.items[0].cas_request.replacements, f.observation.artifacts[0].sha256);
    assert.equal(content, "# Cycle\nstate: DONE\nnext_action: Keep actual receipts\n\n## Evidence\nCaller-supplied verified evidence.\n");
    f.request.items[0].edits = []; assert.deepEqual(prepare(f).errors, ["ARTIFACT_INTENT_EDIT_FORMS_CONFLICT"]);
  });
  for (const [name, change] of [
    ["unknown fields", f => f.request.write = true],
    ["foreign scope", f => f.request.scope.worktree_id = "foreign"],
    ["stale observation", f => f.observation.artifacts[0] = row(status, "# Changed\nstate: VERIFYING\n")],
    ["corrupt source hash", f => f.observation.artifacts[0].sha256 = "0".repeat(64)],
    ["partial text", f => delete f.observation.artifacts[0].content],
    ["foreign session", f => { f.observation.artifacts[0].session_id = "S002"; bind(f); }],
    ["foreign artifact project", f => f.observation.artifacts[0].project_id = "foreign"],
    ["files index is not canonical", f => f.observation.state_mode = "files"],
    ["unavailable PostgreSQL", f => f.observation.backend = "unavailable"],
    ["duplicate source alias", f => f.observation.artifacts.push({ ...f.observation.artifacts[0], path: status.toUpperCase() })],
    ["foreign cycle", f => f.request.items[0].path = "cycles/C002-feature/status.md"],
    ["path traversal", f => f.request.items[0].path = "../CURRENT-STATE.md"],
    ["authority mutation", f => f.request.items[0].path = "SPEC.md"],
    ["generated digest mutation", f => f.request.items[0].path = "RUNTIME-STATE.md"],
    ["duplicate target", f => f.request.items.push(structuredClone(f.request.items[0]))],
    ["unknown edit", f => f.request.items[0].edits[0].kind = "evaluate"],
    ["multiline field", f => f.request.items[0].edits[0].value = "DONE\nowner: other"],
    ["missing field", f => f.request.items[0].edits[0].key = "missing"],
    ["duplicate field", f => { f.observation.artifacts[0] = row(status, "state: VERIFYING\nstate: OPEN\n"); bind(f); }],
    ["field only in fenced example", f => { f.observation.artifacts[0] = row(status, "```\nstate: VERIFYING\n```\n"); bind(f); }],
    ["duplicate section", f => { f.observation.artifacts[0] = row(status, "## Evidence\nA\n## Evidence\nB\n"); bind(f); f.request.items[0].edits = [{ kind: "section", heading: "## Evidence", body: "changed" }]; }],
    ["section boundary escape", f => f.request.items[0].edits = [{ kind: "section", heading: "## Evidence", body: "## New authority\n" }]],
    ["unclosed section fence", f => f.request.items[0].edits = [{ kind: "section", heading: "## Evidence", body: "```\nhidden next heading\n" }]],
    ["unobserved template", f => f.request.items[0].source_path = "cycles/TEMPLATE_unknown.md"],
    ["create without observed absence", f => f.request.items[0].source_path = "cycles/TEMPLATE_brief.md"],
    ["oversized input", f => f.request.items[0].edits[0].value = "x".repeat(131072)],
    ["empty batch", f => f.request.items = []],
    ["excess batch", f => f.request.items = Array(33).fill(f.request.items[0])],
    ["later invalid item", f => f.request.items[1].edits[0].key = "missing"],
  ]) await test(`${name} refuses atomically without a partial plan`, () => {
    const f = fixture(); change(f); const result = prepare(f);
    assert.equal(result.status, "REFUSED"); assert.deepEqual(result.items, []); assert.deepEqual(result.sources, []);
    assert.equal(result.written, false); assert.equal(result.write_authorization, false);
  });
  await test("entire serialized plan budget refuses instead of truncating a source or draft", () => {
    const f = fixture(), result = prepare(f), bytes = Buffer.byteLength(JSON.stringify(result));
    assert.equal(prepareArtifactIntentBatch(f.request, f.observation, { maxOutputBytes: bytes }).status, "READY");
    const short = prepareArtifactIntentBatch(f.request, f.observation, { maxOutputBytes: bytes - 1 });
    assert.equal(short.status, "REFUSED"); assert.deepEqual(short.items, []);
    assert.deepEqual(short.errors, ["ARTIFACT_INTENT_OUTPUT_BUDGET_INSUFFICIENT"]);
    assert.deepEqual(short.expansion, { required_bytes: bytes, requested_bytes: bytes - 1 });
  });
  await test("the complete generated replacement list keeps the real writer's byte bound", () => {
    const f = fixture(); f.observation.artifacts[0] = row(status, "# Cycle\n## First\nstate: VERIFYING\n" + "a".repeat(70000)
      + "\n## Second\nstate: VERIFYING\n" + "b".repeat(70000) + "\n"); bind(f);
    f.request.items = [{ path: status, source_path: status, edits: ["## First", "## Second"].map(heading => ({ kind: "field", key: "state", value: "DONE", heading })) }];
    const result = prepare(f); assert.equal(result.status, "REFUSED"); assert.deepEqual(result.errors, ["ARTIFACT_REPLACEMENTS_INVALID"]);
  });
  await test("all distributed session and cycle templates are accepted as complete sources", () => {
    for (const asset of distributedTemplates().filter(asset => /^(sessions|cycles)\//.test(asset.path))) {
      const source = row(asset.path, fs.readFileSync(path.resolve(import.meta.dirname, "../../scaffold/docs_audit", asset.path), "utf8"));
      const f = fixture(); f.observation.artifacts = [source]; f.observation.template_paths = [source.path];
      f.observation.absent_paths = [source.path.startsWith("sessions/") ? "sessions/S001.md" : "cycles/C001-feature/brief.md"]; bind(f);
      f.request.items = [{ path: f.observation.absent_paths[0], source_path: source.path, edits: [{ kind: "replace", old: source.content, new: source.content + "\nExplicit fixture note.\n" }] }];
      assert.equal(prepare(f).status, "READY", source.path);
    }
  });
  await test("real SQLite CAS consumes prepared requests, preserves metadata and rejects stale bytes or metadata", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-intent-cas-"));
    let store;
    try {
      fs.mkdirSync(path.join(temp, ".aidn"));
      fs.writeFileSync(path.join(temp, ".aidn/config.json"), JSON.stringify({ runtime: { stateMode: "db-only", persistence: { backend: "sqlite" } } }));
      store = createProjectArtifactStore({ targetRoot: temp });
      const f = fixture(); f.observation.target_root = temp;
      f.observation.artifacts = f.observation.artifacts.map(source => store.upsertArtifact({ ...source, kind: "other", family: "normative", classification_reason: "retain-fixture-ownership" })); bind(f);
      const database = path.join(temp, ".aidn/runtime/index/workflow-index.sqlite"), before = fs.readFileSync(database);
      const prepared = prepare(f); assert.equal(prepared.status, "READY"); assert(fs.readFileSync(database).equals(before));
      const first = store.replaceArtifact(prepared.items[0].cas_request);
      assert.equal(first.sha256, prepared.items[0].proposed_sha256); assert.equal(first.classification_reason, "retain-fixture-ownership");
      assert.throws(() => store.replaceArtifact(prepared.items[0].cas_request), /REVISION_CONFLICT/);
      const unchangedBytes = store.getArtifact(current);
      store.upsertArtifact({ ...unchangedBytes, classification_reason: "concurrent-owner" });
      assert.throws(() => store.replaceArtifact(prepared.items[1].cas_request), /REVISION_CONFLICT/);
      assert.equal(store.getArtifact(current).classification_reason, "concurrent-owner");
      f.request.items = [{ path: f.observation.absent_paths[0], source_path: "cycles/TEMPLATE_brief.md", edits: [{ kind: "replace", old: "CXXX", new: "C001" }] }];
      const creation = prepare(f).items[0];
      const created = store.compareAndSwapArtifact(creation.cas_request);
      assert.equal(created.sha256, creation.proposed_sha256);
      assert.throws(() => store.compareAndSwapArtifact(creation.cas_request), /REVISION_CONFLICT/);
      assert(!fs.existsSync(path.join(temp, "docs/audit")));
    } finally { store?.close(); fs.rmSync(temp, { recursive: true, force: true }); }
  });
  await test("prepared closure uses the original engine, fresh admission, CAS and verified strict final hook", async () => {
    const f = fixture(), calls = [];
    const sequence = createOrderedClosureSequence({ targetRoot: process.cwd(), deadline: Date.now() + 60000,
      readBinding: async () => ({ target_root: process.cwd(), state_mode: "db-only", backend: "sqlite", stop_required: false, revision: "a".repeat(64) }),
      execute: async argv => {
        calls.push(argv); const data = { target_root: process.cwd(), ok: true };
        if (argv[1] === "pre-write-admit") Object.assign(data, { admission_status: "admitted", context: { active_session: "S001", active_cycle: "C001" } });
        else if (argv[1] === "db-first-artifact") {
          const ref = argv[argv.indexOf("--path") + 1], source = f.observation.artifacts.find(row => row.path === ref);
          const replacing = argv.includes("--replace"), sha = replacing ? argv[argv.indexOf("--expect-sha256") + 1] : null;
          const content = replacing ? applyArtifactReplacements(source, JSON.parse(argv[argv.indexOf("--replace") + 1]), sha) : "generated runtime";
          Object.assign(data, { backend: "sqlite", materialized: false, artifact: row(ref, content), mutation: { kind: "compare-and-swap-replacements", expected_sha256: sha } });
        } else if (argv[1] === "project-runtime-state") Object.assign(data, { written: true, consistency: { pass: true } });
        else Object.assign(data, { result: "ok", command_status: 0, skill: "cycle-close", strict: true, repair_layer_blocking: false });
        return { target_root: process.cwd(), executed: true, exit_code: 0, data, hook_evidence: { status: "PASS" } };
      } });
    const request = { ...f.request, stage: "cycle", outcome: "DONE" };
    const preview = await runPreparedOrderedClosure(sequence, request, f.observation);
    assert.equal(preview.execution.status, "PREVIEW"); assert.equal(calls.length, 0);
    const actual = await runPreparedOrderedClosure(sequence, request, f.observation, { write: true });
    assert.equal(actual.execution.status, "PASS"); assert.equal(calls.length, 6);
    assert.deepEqual(calls[0], ["runtime", "pre-write-admit", "--skill", "cycle-close", "--strict", "--json"]);
    assert(calls.at(-1).includes("--fail-on-repair-block")); assert(calls.at(-1).includes("--no-auto-skip-gate"));
  });
  await test("failed preparation never enters an executor; explicit outcomes are still required", async () => {
    const f = fixture(); f.request.items[0].edits[0].key = "missing";
    const result = await runPreparedOrderedClosure({ run: () => { throw Error("must not execute"); } }, { ...f.request, stage: "cycle", outcome: "DONE" }, f.observation, { write: true });
    assert.equal(result.execution.status, "REFUSED"); assert.equal(result.execution.written, false);
    const valid = fixture(); let count = 0;
    const request = { ...valid.request, stage: "cycle" };
    const missing = await runPreparedOrderedClosure({ run: () => { count++; } }, request, valid.observation, { write: true });
    assert.equal(missing.execution.status, "REFUSED"); assert.equal(count, 0);
  });
  await test("an executor exception preserves unknown effects instead of promising no write", async () => {
    const f = fixture();
    const result = await runPreparedOrderedClosure({ run: async () => { throw Error("lost response"); } },
      { ...f.request, stage: "cycle", outcome: "DONE" }, f.observation, { write: true });
    assert.equal(result.execution.status, "UNAVAILABLE"); assert.equal(result.execution.written, null);
    assert.equal(result.execution.retry_allowed, false); assert.equal(result.execution.stop_required, true);
  });
  await test("a foreign executor target refuses before execution even with identical source bytes", async () => {
    const f = fixture(); let writes = 0;
    const result = await runPreparedOrderedClosure({ run: async (request, options = {}) => {
      if (options.write) writes++;
      return { status: "PREVIEW", target_root: path.join(process.cwd(), "foreign") };
    } }, { ...f.request, stage: "cycle", outcome: "DONE" }, f.observation, { write: true });
    assert.equal(result.execution.status, "REFUSED"); assert.equal(writes, 0);
  });
  await test("actual partial execution and stop diagnostics propagate unchanged", async () => {
    const f = fixture(), partial = { status: "PARTIAL", written: true, stop_required: true, retry_allowed: false,
      errors: ["actual-canonical-refusal"], steps: [{ status: "FAIL", executed: true }] };
    const result = await runPreparedOrderedClosure({ run: async (request, options = {}) => options.write ? partial
      : { status: "PREVIEW", target_root: process.cwd() } }, { ...f.request, stage: "cycle", outcome: "DONE" }, f.observation, { write: true });
    assert.deepEqual(result.execution, partial);
  });
  return { status: "PASS", proof_class: "pure-preparation-and-SQLite-CAS-fixtures", assertions: checks.length, checks,
    closure_controls: "injected-host-fixtures", live_postgres: "UNAVAILABLE", native_qualification: "NOT_EXECUTED" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await verifyArtifactIntentPreparation())); }
  catch (error) { console.error(error.stack); process.exitCode = 1; }
}
