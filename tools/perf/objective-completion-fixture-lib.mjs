import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStandardObjectiveCompletion } from "../../src/application/runtime/standard-drift-objective-completion.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

// Accepted-operation/evaluation/source capabilities are synthetic. The report
// and exact-offset event line are actual temporary bytes, never a live client.
export async function verifyObjectiveCompletion(pass) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aidn-objective-completion-")));
  let completed = false, sequence = 0;
  const H = "a".repeat(64), id = "op_" + "a".repeat(40), evaluation = "op_" + "b".repeat(40);
  try {
    function fixture() {
      const folder = path.join(root, String(++sequence)); fs.mkdirSync(folder);
      const reportFile = path.join(folder, "report.md"), eventFile = path.join(folder, "events.ndjson");
      const alignment = { contract_version: "standard-drift-objective-disposition.v1", decision_operation_id: "op_" + "c".repeat(40),
        evaluation_operation_id: evaluation, evaluation_sha256: H, context_sha256: H, review_sha256: H, question_sha256: H,
        source_sha256: H, receipt_sha256: H, inbox_id: "decision_" + "d".repeat(40), authority_id: "fixture_user", source_event_id: "fixture_event",
        session_objective: "Learn through an explicitly admitted bounded SPIKE", cycle_objective: "Determine whether a bounded prototype is useful",
        rationale: "Fixture exact accepted completion", prepared_at_ms: 100 };
      const plan = { contract_version: "standard-drift-finalize-plan.v3", operation_id: id, input: { evaluation_operation_id: evaluation },
        prepared_at_ms: 100, context_sha256: H, evaluation_sha256: H, branch: "fixture", head: "a".repeat(40), mode: "COMMITTING",
        report: { path: `workflows/drift-reports/${id}.md`, before_sha256: null, after: "# Exact retained fixture report\n", after_sha256: artifactContentHash("# Exact retained fixture report\n") },
        gate_constraints: { level1: { decision: "incremental" }, level3: { required: false }, other_signals: ["objective_delta"] }, objective_alignment: alignment };
      const event = { run_id: "process_drift_" + id, ts: "1970-01-01T00:00:00.000Z", event: "drift_check_completed", skill: "drift-check",
        result: "ok", branch: "fixture", mode: "COMMITTING", objective_alignment_sha256: shadowHash(alignment) };
      const prefix = Buffer.from('{"event":"preserved"}\n');
      fs.writeFileSync(reportFile, plan.report.after); fs.writeFileSync(eventFile, Buffer.concat([prefix, Buffer.from(JSON.stringify(event) + "\n")]));
      const output = { contract_version: "standard-drift-output.v1", operation_ref: "drift_check_finalize", outcome: "completed", effect_status: "confirmed",
        facts: { drift_check_completed: true }, observations: { evaluation_operation_id: evaluation, report_path: plan.report.path, report_sha256: plan.report.after_sha256,
          event_file: ".aidn/runtime/perf/workflow-events.ndjson", event_offset: prefix.length, observed_event: event,
          hook: { payload: { ok: true, ts: event.ts, objective_alignment: alignment } } },
        evidence_refs: [{ ref: "aidn:drift-event/" + id, sha256: shadowHash(event) }] };
      const receipt = { operation_id: id, outcome: "completed", output_sha256: shadowHash(output) };
      const record = { operation_id: id, intent: { binding_ref: "drift_check_finalize", instance_id: "fixture", scope_id: "fixture" },
        phase: "receipted", preview: { input: plan.input, prepared: { plan } }, results: [{ output, receipt }] };
      const instance = { instance_id: "fixture", scope_id: "fixture", instance_sha256: H, events: [
        { kind: "operation_intent", intent: record.intent = { ...record.intent, operation_id: id } }, { kind: "operation_result", receipt }] };
      const current = { context_sha256: H, evaluation_sha256: H, context: { branch: plan.branch, head: plan.head } };
      let time = 100, live = true, journal = H, renewal = null, onHistory = () => {}, onRenewal = () => {};
      const reader = createStandardObjectiveCompletion({ readOperation: () => structuredClone(record), readEvaluation: async () => structuredClone(current),
        readDisposition: async () => { await new Promise(resolve => setImmediate(resolve)); assert.equal(live, true, "fixture retained source revoked"); return structuredClone(alignment); },
        readHistoricalDisposition: async (_instance, _input, _current, selected) => { assert.equal(selected, alignment.decision_operation_id); await new Promise(resolve => setImmediate(resolve)); onHistory(); return structuredClone(alignment); },
        readRenewedDisposition: async (_instance, _input, _current, anchor) => { await new Promise(resolve => setImmediate(resolve)); onRenewal(); assert.equal(live, true, "fixture current source revoked"); assert.deepEqual(anchor, renewal.anchor); return structuredClone(renewal.disposition); },
        readCurrent: () => ({ instance_sha256: journal }), now: () => time,
        readReport: selected => { assert.equal(selected, plan.report.path); const content = fs.readFileSync(reportFile, "utf8"); return { content, sha256: artifactContentHash(content) }; },
        readEvent: ({ file, offset }) => { assert.equal(file, output.observations.event_file); const bytes = fs.readFileSync(eventFile); return bytes.subarray(offset, bytes.indexOf(10, offset) + 1); } });
      return { plan, alignment, record, instance, output, receipt, current, reportFile, eventFile, prefix, reader,
        renew(value, history = () => {}, current = () => {}) { renewal = value; onHistory = history; onRenewal = current;
          instance.events.push({ kind: "operation_intent", intent: { binding_ref: "drift_completion_decision", operation_id: "op_" + "f".repeat(40) } }); },
        seal() { receipt.output_sha256 = shadowHash(output); }, time: value => { time = value; }, revoke: () => { live = false; }, move: () => { journal = "e".repeat(64); } };
    }
    {
      const f = fixture(), beforeReport = fs.readFileSync(f.reportFile), beforeEvent = fs.readFileSync(f.eventFile);
      assert.deepEqual(await f.reader.read(f.instance), f.alignment);
      assert.deepEqual(fs.readFileSync(f.reportFile), beforeReport); assert.deepEqual(fs.readFileSync(f.eventFile), beforeEvent);
      assert.equal(await f.reader.read({ ...f.instance, events: [] }), null);
      f.plan.contract_version = "standard-drift-finalize-plan.v2"; assert.equal(await f.reader.read(f.instance), null);
      pass("completed objective reader observes exact report/event bytes without writes; absent and historical finalizers grant no alignment");
    }
    {
      const f = fixture(), at = 45 * 60000, originalEvent = fs.readFileSync(f.eventFile);
      f.time(at);
      const { anchor, alignment_allowed } = await f.reader.renewalSubject(f.instance);
      assert.equal(alignment_allowed, true);
      const disposition = { ...f.alignment, prepared_at_ms: at };
      let expireDuringAuthentication = false;
      f.renew({ anchor, disposition }, undefined, () => { if (expireDuringAuthentication) f.time(at + 1); });
      assert.deepEqual(await f.reader.read(f.instance), disposition);
      expireDuringAuthentication = true;
      await assert.rejects(f.reader.read(f.instance), /COMPLETION_EXPIRED/);
      assert.deepEqual(await f.reader.renewalSubject(f.instance), { anchor, alignment_allowed: false });
      await assert.rejects(f.reader.read(f.instance), /COMPLETION_EXPIRED/);
      assert.deepEqual(await f.reader.review(f.instance), anchor);
      f.revoke();
      await assert.rejects(f.reader.read(f.instance), /current source revoked/);
      assert.deepEqual(fs.readFileSync(f.eventFile), originalEvent);
      pass("fresh human alignment cannot renew an expired physical R05 completion");
    }
    for (const [name, mutate, reason] of [
      ["unaccepted completion", f => f.instance.events.pop(), /NOT_ACCEPTED/],
      ["wrong instance", f => f.record.intent.instance_id = "other", /NOT_ACCEPTED/],
      ["unknown effects", f => { f.output.effect_status = "unknown"; f.output.outcome = "reconciliation_required"; f.output.facts = {}; f.seal(); }, /NOT_ACCEPTED/],
      ["incomplete drift", f => { f.output.effect_status = "no_effect"; f.output.outcome = "blocked"; f.output.facts = {}; f.seal(); }, /NOT_ACCEPTED/],
      ["replaced evaluation", f => f.current.evaluation_sha256 = "e".repeat(64), /CONTEXT_CHANGED/],
      ["new canonical context", f => f.current.context_sha256 = "e".repeat(64), /CONTEXT_CHANGED/],
      ["changed HEAD", f => f.current.context.head = "e".repeat(40), /CONTEXT_CHANGED/],
      ["changed disposition", f => f.plan.objective_alignment = { ...f.alignment, rationale: "replaced" }, /DISPOSITION_CHANGED/],
      ["revoked source", f => f.revoke(), /source revoked/],
      ["changed canonical report", f => fs.appendFileSync(f.reportFile, "changed"), /REPORT_CHANGED/],
      ["changed physical event", f => fs.writeFileSync(f.eventFile, Buffer.concat([f.prefix, Buffer.from('{"event":"forged"}\n')])), /EVENT_CHANGED/],
      ["wrong event offset", f => { f.output.observations.event_offset = 0; f.seal(); }, /EVENT_CHANGED/],
      ["changed event receipt", f => { f.output.observations.observed_event = {}; f.seal(); }, /EVENT_CHANGED/],
      ["expired opinion", f => f.time(300101), /EXPIRED/],
      ["clock regression", f => f.time(99), /EXPIRED/],
      ["changed process CAS", f => f.move(), /PROCESS_CHANGED/],
    ]) {
      const f = fixture(); mutate(f); const beforeReport = fs.readFileSync(f.reportFile), beforeEvent = fs.readFileSync(f.eventFile);
      await assert.rejects(f.reader.read(f.instance), reason);
      assert.deepEqual(fs.readFileSync(f.reportFile), beforeReport); assert.deepEqual(fs.readFileSync(f.eventFile), beforeEvent);
      pass(`completed objective reader refuses ${name} without effects`);
    }
    for (const fault of ["none", "history-revocation", "history-expiry", "report-after-auth", "event-after-auth", "receipt-after-auth", "CAS-after-auth", "wrong-link"]) {
      const f = fixture(); f.time(300101);
      await assert.rejects(f.reader.read(f.instance), /EXPIRED/);
      const anchor = await f.reader.review(f.instance), report = fs.readFileSync(f.reportFile), event = fs.readFileSync(f.eventFile);
      const disposition = { ...f.alignment, decision_operation_id: "op_" + "f".repeat(40), prepared_at_ms: 300100 };
      const renewal = { anchor: fault === "wrong-link" ? { ...anchor, event_offset: anchor.event_offset + 1 } : anchor, disposition };
      f.renew(renewal, () => { if (fault === "history-revocation") f.revoke(); if (fault === "history-expiry") f.time(600101); }, () => {
        if (fault === "report-after-auth") fs.appendFileSync(f.reportFile, "changed");
        if (fault === "event-after-auth") fs.appendFileSync(f.eventFile, "changed");
        if (fault === "receipt-after-auth") f.record.results[0].receipt.outcome = "failed";
        if (fault === "CAS-after-auth") f.move();
      });
      if (fault === "none" || fault === "event-after-auth") {
        // Appending unrelated bytes cannot replace the original exact line.
        assert.deepEqual(await f.reader.read(f.instance), disposition);
      } else await assert.rejects(f.reader.read(f.instance), fault === "history-revocation" ? /current source revoked/ : fault === "history-expiry" ? /EXPIRED/ : fault === "report-after-auth" ? /REPORT_CHANGED/ : fault === "receipt-after-auth" ? /LINK_CHANGED/ : fault === "CAS-after-auth" ? /PROCESS_CHANGED/ : /deep-equal/);
      if (!["report-after-auth", "event-after-auth"].includes(fault)) { assert.deepEqual(fs.readFileSync(f.reportFile), report); assert.deepEqual(fs.readFileSync(f.eventFile), event); }
      pass(`completion renewal ${fault}: expired historical fact and current permission remain distinct, exact witnesses retained`);
    }
    completed = true;
  } finally {
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(root).startsWith("aidn-objective-completion-"));
    if (completed) fs.rmSync(root, { recursive: true, force: true }); else console.error(JSON.stringify({ retained_failed_component_root: root }));
  }
}
