#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { isActivationFixtureSource, prepareActivationFixture } from "./test-activation-fixture-lib.mjs";
import { createTrackedFixtureFilter, removePathWithRetry } from "./test-git-fixture-lib.mjs";
import { persistAgentViewReceipt, projectWorkflowAgentView, validateAgentViewOptions } from "../../src/application/codex/agent-view-projection.mjs";
import { validateJsonSchema } from "../../src/core/contracts/json-schema-validator.mjs";
import { resolveCliEffectClass } from "../../src/core/cli/effect-policy.mjs";
import workflowSchema from "../../src/core/contracts/cli-output/codex-workflow-step-agent.v1.schema.json" with { type: "json" };
import hookSchema from "../../src/core/contracts/context/codex-hook-agent.v1.schema.json" with { type: "json" };
import compactSchema from "../../src/core/contracts/cli-output/codex-workflow-step-agent-compact.v1.schema.json" with { type: "json" };
import admissionSchema from "../../src/core/contracts/cli-output/runtime-pre-write-admit-agent.v1.schema.json" with { type: "json" };
import nextActionSchema from "../../src/core/contracts/cli-output/runtime-coordinator-next-action-agent.v1.schema.json" with { type: "json" };
import { projectAdmissionAgentView, projectNextActionAgentView, projectAgentDecisionError } from "../../src/application/runtime/agent-decision-projection.mjs";

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
  const tracked = createTrackedFixtureFilter(source, repo);
  fs.cpSync(source, target, { recursive: true, filter: file => tracked(file) && isActivationFixtureSource(source, file, { freshContext: true }) });
  prepareActivationFixture(target, repo);
  // Index only this fresh tracked corpus. A previous local fixture's ignored
  // SQLite store is not input evidence for either CLI observation.
  const indexed = command(["perf", "index", "--store", "sqlite", "--with-content", "--json"]);
  assert.equal(indexed.status, 0, indexed.stderr);
  const visible = ["RUNTIME-STATE.md", "HANDOFF-PACKET.md"].map(name => path.join(target, "docs/audit", name));
  const before = visible.map(file => fs.existsSync(file) ? hash(fs.readFileSync(file)) : null);
  const full = workflow([]), agent = workflow(["--view", "agent"]);
  const compact = workflow(["--view", "agent", "--projection-profile", "compact.v1"]);
  check("compact workflow is opt-in and preserves decisions and complete context units", () => {
    assert.equal(compact.status, 0, compact.stderr);
    assert.deepEqual(validateJsonSchema(compact.payload, compactSchema, "$"), []);
    assert.equal(agent.payload.contract_version, "codex-workflow-step-agent.v1");
    assert.equal(compact.payload.contract_version, "codex-workflow-step-agent-compact.v1");
    assert.deepEqual(compact.payload.next_action.recommendation, agent.payload.next_action.recommendation);
    assert.deepEqual(compact.payload.next_action.scope, agent.payload.next_action.scope);
    assert.equal(compact.payload.next_action.handoff?.packet, undefined);
    assert.equal(compact.payload.receipt, null);
    for (const context of compact.payload.contexts) {
      const original = full.payload.hydrations[context.skill];
      context.artifact_refs.forEach((id, index) => assert.deepEqual(compact.payload.artifacts.find(row => row.id === id).artifact, original.artifacts[index]));
    }
  });
  const treeDigest = directory => {
    const entries = [];
    const walk = current => { for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) walk(file); else if (entry.isFile()) entries.push([path.relative(directory, file), hash(fs.readFileSync(file))]);
    } };
    walk(directory); return hash(JSON.stringify(entries.sort()));
  };
  check("standalone compact admissions preserve strict refusal, checks, source binding and read-only behavior", () => {
    const before = treeDigest(target);
    const args = ["runtime", "pre-write-admit", "--skill", "requirements-delta", "--strict", "--json"];
    const normal = command(args), selected = command([...args, "--view", "agent"]);
    assert.equal(selected.status, normal.status);
    assert.deepEqual(validateJsonSchema(selected.payload, admissionSchema, "$"), []);
    for (const key of ["ok", "admission_status", "admission_kind", "context", "checks", "blocking_reasons", "blocking_findings", "warnings", "activation"])
      assert.deepEqual(selected.payload[key], normal.payload[key]);
    assert.deepEqual(selected.payload.source_of_truth.observed_sources, normal.payload.source_of_truth.observed_sources);
    assert.equal(selected.payload.source_of_truth.concepts, undefined);
    assert.equal(selected.payload.full_output.retained, false);
    assert.equal(treeDigest(target), before);
  });
  check("standalone compact coordinator preserves stops, repair diagnostics and scope without writes", () => {
    const before = treeDigest(target), args = ["runtime", "coordinator-next-action", "--json"];
    const normal = command(args), selected = command([...args, "--view", "agent"]);
    assert.equal(selected.status, normal.status);
    assert.deepEqual(validateJsonSchema(selected.payload, nextActionSchema, "$"), []);
    for (const key of ["recommendation", "scope", "next_action_diagnostic", "packet_resolution"])
      assert.deepEqual(selected.payload[key], normal.payload[key]);
    for (const key of ["admitted", "admission_status", "issues", "warnings", "transition_policy"])
      assert.deepEqual(selected.payload.handoff?.[key], normal.payload.handoff?.[key]);
    const { ts: normalTime, ...normalConsistency } = normal.payload.handoff?.consistency ?? {};
    const { ts: selectedTime, ...selectedConsistency } = selected.payload.handoff?.consistency ?? {};
    assert.deepEqual(selectedConsistency, normalConsistency);
    if (normalTime !== undefined) assert(Date.parse(selectedTime) >= Date.parse(normalTime), "fresh observation timestamps remain present");
    assert.equal(treeDigest(target), before);
  });
  check("specific native patch decisions are preserved exactly, including denial and immutable bindings", () => {
    for (const outcome of ["allow", "deny"]) {
      const payload = { target_root: target, skill: "native-write", admission_kind: "specific", ok: outcome === "allow",
        admission_status: outcome === "allow" ? "admitted" : "blocked", context: { effective_state_mode: "db-only" }, checks: { fresh: false },
        blocking_reasons: ["retained reason"], warnings: ["retained warning"], blocking_findings: [{ severity: "block", id: "fixture" }],
        source_of_truth: { concepts: { bulky: "static policy".repeat(200) }, observed_sources: { current_state: "postgres" }, issues: [{ reason_code: "fixture" }], repair_actions: ["repair"] },
        write_decision: { outcome, observation: { canonical_sha256: "a".repeat(64), payload_sha256: "b".repeat(64) }, operations: [{ path: "subject.txt", operation: "update" }], reasons: [{ code: "fixture" }] } };
      const before = JSON.stringify(payload), selected = projectAdmissionAgentView(payload);
      assert.deepEqual(selected.write_decision, payload.write_decision);
      assert.equal(selected.reusable_write_authorization, false);
      assert.equal(selected.full_output.retained, false); assert.equal(selected.receipt, undefined);
      selected.write_decision.observation.canonical_sha256 = "changed";
      assert.equal(JSON.stringify(payload), before);
    }
  });
  check("compact next action keeps different source observations and every global stop", () => {
    const payload = { recommendation: { stop_required: true }, scope: { scope_id: "foreign-scope" },
      packet_resolution: { source_revision: "first" }, context: { packet_resolution: { source_revision: "first" } },
      handoff: { packet: { body: "derived packet body" }, packet_resolution: { source_revision: "second" },
        admitted: false, issues: ["keep refusal"], transition_policy: { status: "blocked" } } };
    const before = JSON.stringify(payload), selected = projectNextActionAgentView(payload);
    assert.equal(selected.recommendation.stop_required, true);
    assert.deepEqual(selected.scope, payload.scope);
    assert.deepEqual(selected.handoff.packet_resolution, payload.handoff.packet_resolution);
    assert.deepEqual(selected.handoff.transition_policy, payload.handoff.transition_policy);
    assert.equal(selected.context.packet_resolution, undefined);
    assert.equal(JSON.stringify(payload), before);
    for (const [kind, schema] of [["pre-write-admit", admissionSchema], ["coordinator-next-action", nextActionSchema]]) {
      const refusal = projectAgentDecisionError(kind, { code: "ECONNREFUSED", message: "must not expose connection details" });
      assert.deepEqual(validateJsonSchema(refusal, schema, "$"), []);
      assert.equal(refusal.stop_required, true); assert.equal(refusal.source_revision, undefined);
      assert(!JSON.stringify(refusal).includes("must not expose"));
      const invalid = command(["runtime", kind, "--view", "agent", "--json", "--unknown-option"]);
      assert.equal(invalid.status, 1); assert.deepEqual(validateJsonSchema(invalid.payload, schema, "$"), []);
    }
  });
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
      assert.deepEqual(selected.activation, observation.activation);
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
    assert(agent.payload.artifacts.some(row => typeof row.artifact.content_excerpt === "string"));
    for (const context of agent.payload.contexts) {
      const original = full.payload.hydrations[context.skill];
      assert.equal(context.artifact_refs.length, original.artifacts.length);
      context.artifact_refs.forEach((id, i) => assert.deepEqual(agent.payload.artifacts.find(row => row.id === id).artifact, original.artifacts[i]));
    }
  });
  const withReceipt = workflow(["--view", "agent", "--write"]), secondReceipt = workflow(["--view", "agent", "--write"]);
  check("explicit retained receipts bind complete observations and never overwrite a previous receipt", () => {
    assert.equal(withReceipt.status, 0); assert.equal(secondReceipt.status, 0);
    assert.equal(withReceipt.payload.effect_class, "mutating");
    assert.deepEqual(validateJsonSchema(withReceipt.payload, workflowSchema, "$"), []);
    assert.equal(resolveCliEffectClass("aidn codex workflow-step", ["--view", "agent", "--json"]), "projector");
    assert.equal(resolveCliEffectClass("aidn codex workflow-step", ["--view", "agent", "--write", "--json"]), "mutating");
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
    payload.hydrations.a.target_root = "/client-a"; payload.hydrations.b.target_root = "/client-b";
    assert.equal(projectWorkflowAgentView(payload).artifacts.length, 2, "missing IDs never merge different target roots");
  });
  check("activation guards retain actual state and never infer activation from an admission boolean", () => {
    const activation = { active: false, state: "inactive", error: { code: "fixture-inactive" } };
    const payload = { admissions: { a: { ok: false, activation }, b: { ok: true }, c: { ok: true, activation: {} } }, hydrations: {} };
    const projected = projectWorkflowAgentView(payload);
    assert.deepEqual(projected.admissions[0].activation, activation);
    assert.equal(projected.admissions[1].activation.active, null);
    assert.equal(projected.admissions[2].activation.active, null);
    projected.admissions[0].activation.error.code = "changed projection";
    assert.equal(activation.error.code, "fixture-inactive");
  });
  check("scoped units share compact source identity without reinjecting unselected document bodies", () => {
    const canonical = { schema_version: 1, format: "markdown", title: "Source rule", stats: { sections: 2 },
      structured_sections: { rule: "Unselected derived source text. ".repeat(400) }, derived_runtime_context: { must_not_be_current_authority: true } };
    const units = ["first", "second"].map(unit_id => ({ unit_id, path: "SPEC.md", sha256: "a".repeat(64),
      content_excerpt: `## ${unit_id}\nComplete rule.\n`, canonical, selection_reasons: ["task_obligation"] }));
    const payload = { selection_policy: { mode: "scoped" }, admissions: {}, hydrations: { a: { target_root: "/client", source_revision: "r1", artifacts: units } } };
    const before = JSON.stringify(payload), projected = projectWorkflowAgentView(payload);
    const compactProjection = projectWorkflowAgentView(payload, null, "compact.v1");
    assert.deepEqual(compactProjection.artifacts, projected.artifacts, "same observation keeps exact context/provenance graph");
    assert.deepEqual(compactProjection.contexts, projected.contexts);
    assert.equal(projected.artifact_metadata.length, 1);
    for (const row of projected.artifacts) {
      const metadata = projected.artifact_metadata.find(entry => entry.id === row.artifact.canonical_ref);
      assert(metadata); assert.equal(metadata.path, row.artifact.path); assert.equal(metadata.sha256, row.artifact.sha256);
      const { canonical_ref, ...unit } = row.artifact;
      const { canonical: originalCanonical, ...originalUnit } = units.find(entry => entry.unit_id === unit.unit_id);
      assert.deepEqual(unit, originalUnit);
      assert.deepEqual(metadata.canonical, { schema_version: 1, format: "markdown", title: "Source rule", stats: { sections: 2 } });
      assert.equal(row.id, hash(JSON.stringify({ source: row.source, artifact: row.artifact })));
    }
    assert(Buffer.byteLength(JSON.stringify(projected)) < Buffer.byteLength(before));
    projected.artifact_metadata[0].canonical.stats.sections = 999;
    assert.equal(JSON.stringify(payload), before, "projection must not mutate retained evidence");
    payload.hydrations.b = { ...payload.hydrations.a, source_revision: "r2" };
    assert.equal(projectWorkflowAgentView(payload).artifact_metadata.length, 2);
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
  console.log(JSON.stringify({ status: "PASS", proof_class: "fixture-and-real-cli", fixture_source: "tracked-only-with-explicit-fresh-index", assertions: checks.length, checks,
    observations: { legacy_compact_json_bytes: Buffer.byteLength(JSON.stringify(full.payload)), agent_compact_json_bytes: Buffer.byteLength(JSON.stringify(agent.payload)), compact_profile_json_bytes: Buffer.byteLength(JSON.stringify(compact.payload)), native_token_savings: "UNAVAILABLE" } }));
} catch (error) { console.error(error.stack); process.exitCode = 1; }
finally { removePathWithRetry(root); }
