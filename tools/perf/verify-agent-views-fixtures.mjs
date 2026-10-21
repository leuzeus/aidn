#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { isActivationFixtureSource, prepareActivationFixture } from "./test-activation-fixture-lib.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";
import { persistAgentViewReceipt, projectWorkflowAgentView, validateAgentViewOptions } from "../../src/application/codex/agent-view-projection.mjs";
import { validateJsonSchema } from "../../src/core/contracts/json-schema-validator.mjs";
import workflowSchema from "../../src/core/contracts/cli-output/codex-workflow-step-agent.v1.schema.json" with { type: "json" };
import hookSchema from "../../src/core/contracts/context/codex-hook-agent.v1.schema.json" with { type: "json" };

const repo = path.resolve(import.meta.dirname, "../.."), root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-agent-views-"));
const target = path.join(root, "client"), source = path.join(repo, "tests/fixtures/repo-installed-core");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const checks = [];
const check = (name, action) => { action(); checks.push(name); };
const command = args => {
  const result = spawnSync(process.execPath, [path.join(repo, "bin/aidn.mjs"), ...args.slice(0, 2), "--target", target, ...args.slice(2)],
    { cwd: repo, encoding: "utf8", windowsHide: true, timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
  assert(!result.error, result.error?.message); return { ...result, payload: result.stdout.trim() ? JSON.parse(result.stdout) : null };
};
const workflow = extra => command(["codex", "workflow-step", "--skills", "context-reload,requirements-delta", "--mode", "COMMITTING", "--json", ...extra]);
const assertReceipt = receipt => {
  assert(receipt); const bytes = fs.readFileSync(receipt.path);
  assert.equal(bytes.length, receipt.bytes); assert.equal(hash(bytes), receipt.sha256);
  const record = JSON.parse(bytes); assert.equal(record.write_authorization, false); return record.observation;
};
try {
  fs.cpSync(source, target, { recursive: true, filter: file => isActivationFixtureSource(source, file, { freshContext: true }) });
  prepareActivationFixture(target, repo);
  const visible = ["RUNTIME-STATE.md", "HANDOFF-PACKET.md"].map(name => path.join(target, "docs/audit", name));
  const before = visible.map(file => fs.existsSync(file) ? hash(fs.readFileSync(file)) : null);
  const full = workflow([]), agent = workflow(["--view", "agent"]);
  check("legacy contract and per-skill execution remain the default", () => {
    assert.equal(full.status, 0); assert.equal(full.payload.contract_version, "codex-workflow-step.v1");
    assert.equal(full.payload.summary.hydrate_count, 2); assert.equal(full.payload.receipt, undefined);
  });
  check("real agent CLI returns its distinct versioned contract", () => {
    assert.equal(agent.status, 0); assert.deepEqual(validateJsonSchema(agent.payload, workflowSchema, "$"), []);
    assert.equal(agent.payload.write_authorization, false); assert.equal(agent.payload.normalized, undefined);
  });
  check("projection preserves every admission refusal and coordinator stop decision", () => {
    assert.equal(agent.payload.ok, full.payload.ok);
    for (const [skill, observation] of Object.entries(full.payload.admissions)) {
      const selected = agent.payload.admissions.find(row => row.skill === skill);
      assert.equal(selected.ok, observation.ok); assert.equal(selected.admission_status, observation.admission_status);
      assert.deepEqual(selected.blocking_reasons, observation.blocking_reasons); assert.deepEqual(selected.warnings, observation.warnings);
    }
    assert.equal(agent.payload.next_action.recommendation.stop_required, full.payload.next_action.recommendation.stop_required);
  });
  check("view selection alone does not create diagnostic receipts", () => {
    assert.equal(agent.payload.receipt, null);
    assert(!fs.existsSync(path.join(target, ".aidn/runtime/context/agent-view-receipts")));
    assert.equal(persistAgentViewReceipt({ write: false, targetRoot: path.join(root, "absent") }), null);
  });
  check("shared artifact bodies retain exact text, provenance and truncation markers", () => {
    for (const context of agent.payload.contexts) {
      const original = full.payload.hydrations[context.skill];
      assert.equal(context.artifact_refs.length, original.artifacts.length);
      context.artifact_refs.forEach((id, i) => assert.deepEqual(agent.payload.artifacts.find(row => row.id === id).artifact, original.artifacts[i]));
    }
  });
  const withReceipt = workflow(["--view", "agent", "--write"]), secondReceipt = workflow(["--view", "agent", "--write"]);
  check("explicit retained receipts bind complete observations and never overwrite a previous receipt", () => {
    assert.equal(withReceipt.status, 0); assert.equal(secondReceipt.status, 0);
    const retained = assertReceipt(withReceipt.payload.receipt); assertReceipt(secondReceipt.payload.receipt);
    assert.notEqual(withReceipt.payload.receipt.path, secondReceipt.payload.receipt.path);
    assert.equal(retained.contract_version, "codex-workflow-step.v1");
    assert.equal(retained.summary.hydrate_count, 2); assert(retained.admissions["requirements-delta"].blocking_reasons.length);
  });
  check("agent formatting does not materialize visible runtime or handoff files", () => {
    assert.deepEqual(visible.map(file => fs.existsSync(file) ? hash(fs.readFileSync(file)) : null), before);
  });
  check("invalid view emits one complete failure JSON document", () => {
    const result = workflow(["--view", "unknown"]); assert.notEqual(result.status, 0); assert.equal(result.payload.ok, false);
  });
  check("direct service and daemon options cannot bypass view or write-intent validation", () => {
    assert.throws(() => validateAgentViewOptions({ view: "unknown" }), /Invalid/);
    assert.throws(() => validateAgentViewOptions({ view: "agent", includeRaw: true }, true), /conflicts/);
    assert.throws(() => validateAgentViewOptions({ write: "true" }), /boolean/);
    validateAgentViewOptions({});
  });
  check("exact duplicate bodies collapse without merging different revisions or hiding a global stop", () => {
    const artifact = { path: "SPEC.md", content_excerpt: "exact rule", content_state: "truncated", sha256: "a".repeat(64) };
    const payload = { skills: ["a", "b"], admissions: {}, hydrations: { a: { artifacts: [artifact], source_revision: "r1" }, b: { artifacts: [artifact], source_revision: "r1" } }, next_action: { recommendation: { stop_required: true } } };
    const snapshot = JSON.stringify(payload), projected = projectWorkflowAgentView(payload);
    assert.equal(projected.artifacts.length, 1); assert.equal(projected.next_action.recommendation.stop_required, true);
    payload.hydrations.b.source_revision = "r2"; assert.equal(projectWorkflowAgentView(payload).artifacts.length, 2);
    payload.hydrations.b.source_revision = "r1"; assert.equal(JSON.stringify(payload), snapshot);
  });
  const hook = extra => {
    // The wrapped command is synthetic fixture data, not native execution proof.
    const code = "console.log(JSON.stringify({ok:false,decision:'deny',result:'error',reason_codes:['fixture-refusal'],blocking_reasons:['preserve refusal']}));process.exit(7)";
    return command(["codex", "run-json-hook", "--skill", "context-reload", "--mode", "THINKING", "--state-mode", "files", "--no-db-sync", "--no-force-json", "--fail-on-error", "--json", ...extra,
      "--", process.execPath, "-e", code]);
  };
  const hookFull = hook([]), hookAgent = hook(["--view", "agent"]), hookReceipt = hook(["--view", "agent", "--write"]);
  check("real hook agent view preserves exit status, refusal, repair and sync semantics", () => {
    assert.notEqual(hookFull.status, 0); assert.equal(hookAgent.status, hookFull.status);
    assert.deepEqual(validateJsonSchema(hookAgent.payload, hookSchema, "$", { contractKind: "context" }), []);
    for (const key of ["ok", "strict", "decision", "command_status", "blocking_reasons", "reason_codes", "repair_layer_status"])
      assert.deepEqual(hookAgent.payload[key], hookFull.payload[key]);
    assert.deepEqual(hookAgent.payload.db_sync.error, hookFull.payload.db_sync.error);
    assert.equal(hookAgent.payload.normalized, undefined); assert.equal(hookAgent.payload.summary, undefined);
    assert.equal(hookAgent.payload.evidence.full, null); assertReceipt(hookReceipt.payload.evidence.full);
    assert.equal(hash(fs.readFileSync(hookAgent.payload.evidence.raw.path)), hookAgent.payload.evidence.raw.sha256);
  });
  check("agent/raw conflict refuses before executing a command", () => {
    const context = path.join(target, ".aidn/runtime/context/codex-context.json"), before = hash(fs.readFileSync(context));
    const result = hook(["--view", "agent", "--include-raw"]);
    assert.notEqual(result.status, 0); assert.match(result.payload.message, /conflicts/);
    assert.equal(hash(fs.readFileSync(context)), before);
  });
  check("receipt writes refuse a preexisting directory link outside the worktree", () => {
    const local = path.join(root, "linked-client"), outside = path.join(root, "outside");
    fs.mkdirSync(path.join(local, ".aidn/runtime/context"), { recursive: true }); fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(local, ".aidn/runtime/context/agent-view-receipts"), process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => persistAgentViewReceipt({ write: true, targetRoot: local, kind: "workflow-step", payload: {} }), /escapes/);
    assert.deepEqual(fs.readdirSync(outside), []);
  });
  console.log(JSON.stringify({ status: "PASS", proof_class: "fixture-and-real-cli", assertions: checks.length, checks,
    observations: { legacy_compact_json_bytes: Buffer.byteLength(JSON.stringify(full.payload)), agent_compact_json_bytes: Buffer.byteLength(JSON.stringify(agent.payload)), native_token_savings: "UNAVAILABLE" } }));
} catch (error) { console.error(error.stack); process.exitCode = 1; }
finally { removePathWithRetry(root); }
