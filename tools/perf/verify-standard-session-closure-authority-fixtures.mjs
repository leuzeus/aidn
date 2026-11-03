import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { readStandardSessionClosureContext } from "../../src/application/runtime/standard-session-closure-context.mjs";
import { createStandardSessionClosureAuthority } from "../../src/application/runtime/standard-session-closure-authority.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
const owned = [], temporary = fs.realpathSync(os.tmpdir()), id = n => "op_" + String(n).repeat(40), H = "a".repeat(64);
let checks = 0, completed = false;
const pass = name => { checks++; console.log("PASS " + name); };
try {
  const root = createFreshStandardWorkflowFixture("files", owned), ops = createStandardWorkflowOperations({ targetRoot: root }), artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
  let plan = await ops.prepareSession({ session_id: "S001", session_branch: "S001-close-proof", objective: "Verify physical R05 closure proofs" });
  assert.equal((await ops.initializeSession(plan, { write: true, expectPlan: plan.plan_sha256 })).outcome, "completed");
  plan = await ops.prepareMode({ session_id: "S001", mode: "COMMITTING" });
  assert.equal((await ops.applyMode(plan, { write: true, expectPlan: plan.plan_sha256 })).outcome, "completed");
  const current = await readStandardSessionClosureContext({ targetRoot: root, sessionId: "S001" });
  const admission = { record: { operation_id: id(1), preview: { input: { session_id: "S001" } } }, output: await ops.admitSessionClose({ session_id: "S001" }) };
  const evaluation = { record: { operation_id: id(2) }, output: { facts: { drift_present: false, drift_context_complete: true, drift_recovery_required: false } } };
  const reportPath = `workflows/drift-reports/${id(3)}.md`;
  await artifacts.withLocalEffectOwner(H, async () => { artifacts.compareAndSwap({ path: reportPath, before_sha256: null, after: "Fixture R05 physical report.\n" }); return { effect_status: "confirmed" }; });
  const reportHash = artifacts.read(reportPath).sha256, event = { event: "drift_check_completed", run_id: "process_drift_" + id(3), skill: "drift-check", result: "ok", mode: "COMMITTING", branch: current.branch, ts: new Date().toISOString() };
  const eventFile = path.join(root, ".aidn/runtime/perf/workflow-events.ndjson"), prefix = fs.existsSync(eventFile) ? fs.readFileSync(eventFile) : Buffer.alloc(0);
  fs.mkdirSync(path.dirname(eventFile), { recursive: true });
  const bytes = Buffer.concat([prefix, Buffer.from(JSON.stringify(event) + "\n")]); fs.writeFileSync(eventFile, bytes);
  const finalization = { record: { operation_id: id(3), preview: { prepared: { plan: { input: { evaluation_operation_id: id(2) }, evaluation_sha256: shadowHash(evaluation.output),
    context_sha256: H, branch: current.branch, head: current.head, report: { path: reportPath, after_sha256: reportHash } } } } }, output: { effect_status: "confirmed", facts: { drift_check_completed: true }, observations: {
      evaluation_operation_id: id(2), report_path: reportPath, report_sha256: reportHash, observed_event: event, event_file: ".aidn/runtime/perf/workflow-events.ndjson", event_offset: prefix.length,
      hook: { ok: true, payload: { ok: true, ts: event.ts } } } } };
  const originals = structuredClone({ admission, evaluation, finalization }), inputs = { admission_operation_id: id(1), drift_evaluation_operation_id: id(2), drift_finalization_operation_id: id(3) };
  let records;
  const reset = () => { records = structuredClone(originals); fs.writeFileSync(eventFile, bytes); }; reset();
  const authority = createStandardSessionClosureAuthority({ targetRoot: root, readAcceptedOperation: (_instance, key, binding) => {
    const record = { session_close_admit: records.admission, drift_report_evaluate: records.evaluation, drift_check_finalize: records.finalization }[binding];
    assert.equal(record.record.operation_id, key); return record;
  }, readEvaluation: () => ({ output: originals.evaluation.output, context_sha256: H }) });
  assert.equal((await authority.readSource({}, inputs)).current.session_id, "S001"); assert.deepEqual(fs.readFileSync(eventFile), bytes);
  pass("physical report and exact event offset accepted with injected source authorities; no real authenticated chain claimed");
  for (const [name, mutate] of [
    ["unknown final effect", () => { records.finalization.output.effect_status = "unknown"; }],
    ["changed evaluation", () => { records.evaluation.output.facts.drift_present = true; }],
    ["different evaluation correlation", () => { records.finalization.record.preview.prepared.plan.input.evaluation_operation_id = id(4); }],
    ["offset within event", () => { records.finalization.output.observations.event_offset++; }],
    ["missing physical event", () => { fs.writeFileSync(eventFile, prefix); }],
    ["forged physical event", () => { fs.writeFileSync(eventFile, Buffer.concat([prefix, Buffer.from(JSON.stringify({ ...event, result: "warn" }) + "\n")])); }],
    ["foreign event path", () => { records.finalization.output.observations.event_file = "foreign.ndjson"; }],
    ["changed branch", () => { records.finalization.record.preview.prepared.plan.branch = "foreign"; }],
  ]) { reset(); mutate(); await assert.rejects(() => authority.readSource({}, inputs)); pass(name + " refused"); }
  reset();
  await artifacts.withLocalEffectOwner(H, async () => { artifacts.compareAndSwap({ path: reportPath, before_sha256: reportHash, after: "Changed physical report.\n" }); return { effect_status: "confirmed" }; });
  await assert.rejects(() => authority.readSource({}, inputs)); pass("changed canonical report refused");
  completed = true; console.log(JSON.stringify({ status: "PASS", checks, source_authorities: "injected-fixture", physical_proofs: "actual-files", composed_authenticated_chain: "NOT_RUN_HERE", native: "NOT_RUN", session_closed: false }));
} finally { for (const root of owned.reverse()) { const resolved = fs.realpathSync(root); assert.equal(path.dirname(resolved), temporary);
  if (!completed && process.argv.includes("--retain-on-failure")) console.error(JSON.stringify({ retained_fixture: resolved })); else fs.rmSync(resolved, { recursive: true, force: true }); } }
