import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { iterateAgenticProcessSimulation } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { closureHumanSource } from "./cycle-closure-fixture-lib.mjs";
import { modeAnalysisWitness } from "./standard-mode-analysis-execution-fixture-lib.mjs";

// New disposable projects and original grants only. Native/human/resource
// authorities are fixture capabilities; business, Git and SQLite ports are real.
export async function verifyModeWorkContinuationExecution({ storageMode, sessionMode, mixedFixture }) {
  let sourceFile, grant, reads = 0, authorization;
  const newRationale = "Resolve the waiting comparison by confirming that the current product still exports value 1.";
  const humanSource = { read: input => closureHumanSource(sourceFile).read(input), verify: input => input.source.authority_id === "fixture_operator"
    ? closureHumanSource(sourceFile).verify(input) : { outcome: "unverified" } };
  const epochSource = { async read({ request, sourceRef }) {
    reads++; assert.equal(sourceRef, "new-expired-mode-consent");
    assert.ok(Date.now() > authorization.global_deadline_ms);
    assert.ok(f.t.sessions.every(row => row.closed));
    grant = { contract_version: "native-authorization-epoch-grant.v1", authority_id: "fixture_new_mode_consent", source_event_id: "mode-resume-epoch-" + request.epoch,
      request_sha256: shadowHash(request), authorization: { ...authorization, authorized_at_ms: Date.now(),
        global_deadline_ms: Date.now() + 1800000, workflow_deadline_ms: Date.now() + 1800000, max_responses: 2 },
      closure: { contract_version: "native-resource-closure.v1", request_sha256: shadowHash(request), inventory_sha256: shadowHash(request.resources),
        observed_at_ms: Date.now(), complete: true, active_resources: 0, evidence_class: "fixture",
        resources: request.resources.map(row => ({ resource_sha256: shadowHash(row), state: "closed", evidence_refs: [{ ref: "fixture:closed-native-resource", sha256: shadowHash(row) }] })) },
      evidence_refs: [{ ref: "fixture:NEW-expired-mode-consent", sha256: "b".repeat(64) }] };
    return grant;
  }, async verify({ grant: supplied }) { assert.deepEqual(supplied, grant); return { outcome: "verified", authority_id: grant.authority_id, grant_sha256: shadowHash(grant), evidence_class: "fixture" }; } };
  const f = mixedFixture(storageMode, { standardModel: true, humanSource, nativeAuthorizationSource: epochSource, hostTrace: true,
    async answer({ params }) {
      const observed = JSON.parse(params.input[0].text.split("\n").at(-1));
      assert.equal(observed.context.mode, sessionMode);
      const continuation = observed.context.continuation;
      if (continuation) {
        assert.equal(continuation.choice, "continue_analysis"); assert.equal(continuation.information_only, true);
        assert.equal(continuation.decision.rationale, newRationale); assert.equal(continuation.decision.source_event_id, "mode-resume-NEW-decision");
        assert.equal(continuation.source_sha256, shadowHash(continuation.decision));
        assert.equal(continuation.prior_report.disposition, "waiting"); assert.equal(continuation.prior_report.objective, observed.context.objective);
        assert.deepEqual(continuation.prior_report.findings, ["The first analysis needs an explicit new decision before further analysis."]);
        assert.ok(continuation.prior_reference.ref); assert.ok(continuation.prior_producer.occurrence_id);
        for (const field of ["product_effects_authorized", "retention_authorized", "native_authority_renewed"]) assert.equal(continuation[field], false);
      }
      return { outcome: "completed", summary: "Fixture analysis on a distinct authenticated occurrence", report: {
        contract_version: "standard-mode-work-report.v1", context_sha256: observed.context_sha256, mode: sessionMode,
        objective: observed.context.objective, disposition: continuation ? sessionMode === "THINKING" ? "thinking_complete" : "nonretained" : "waiting",
        findings: continuation ? ["Authenticated followup request: " + continuation.decision.rationale, "Previous report: " + continuation.prior_report.findings[0]]
          : ["The first analysis needs an explicit new decision before further analysis."], rationale: "Fixture read-only mode continuation", evidence_refs: observed.evidence_refs } };
    } });
  sourceFile = path.join(f.configuration.control_root, "mode-resume-human-sources.json"); fs.writeFileSync(sourceFile, "{}");
  const publish = (ref, source) => fs.writeFileSync(sourceFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(sourceFile, "utf8")), [ref]: source }));
  const parameters = { session: { session_id: "S001", session_branch: "S001-analysis", objective: "Resume read-only analysis only after a fresh authenticated decision" },
    cycle: { cycle_id: "C001", cycle_type: "spike", title: "unused", objective: "This component does not admit a cycle" } };
  const preview = f.open().initialize({ parameters }); f.open().initialize({ parameters, write: true, expectedResultSha256: preview.record.instance_sha256 });
  authorization = { ...f.authorize(), max_responses: 1, max_turn_ms: 300000 };
  authorization.global_deadline_ms = authorization.workflow_deadline_ms = authorization.authorized_at_ms + 1800000;
  const original = structuredClone(authorization), realNow = Date.now;
  fs.writeFileSync(path.join(f.base, "mode-resume-original-authority.json"), JSON.stringify({ configuration: f.configuration, parameters, authorization,
    proof_class: "offline-fixture-authorities-and-controlled-clock", wall_clock_expiry_qualification: "NOT_RUN" }));
  let waiting, originalReport, originalAllocation, offset = 0;
  try {
    for (let step = 0; step < 32; step++) {
      const beforeCount = f.t.sessions.length, state = f.open().inspect();
      if (state.cursor.status === "COMPLETED") break;
      const result = await f.open().step({ write: true, authorization: grant?.authorization ?? authorization });
      if (result.operation_id) {
        assert.equal(f.t.sessions.length, beforeCount, "D/H cannot allocate Native");
        const record = f.open().readOperation(result.operation_id);
        if (result.status === "waiting_for_human") {
          if (record.intent.binding_ref === "mode_decision") {
            publish("initial", { contract_version: "human-mode-decision.v1", source_kind: "human", authority_id: "fixture_operator", source_event_id: "mode-resume-original",
              subject_sha256: "a".repeat(64), question_sha256: shadowHash(result.question), choice: sessionMode, evidence_refs: [{ ref: "fixture:initial-mode", sha256: "a".repeat(64) }] });
            await f.open().receiveDecision(result.operation_id, { sourceRef: "initial", write: true }); await f.open().acceptOperation(result.operation_id, { write: true });
          } else {
            assert.equal(record.intent.binding_ref, "mode_work_continue_decision"); assert.equal(waiting, undefined);
            waiting = f.open().inspect().record; originalAllocation = f.open().inspectAllocations().allocations[0];
            originalReport = record.preview.prepared.review.report;
            assert.equal(originalReport.disposition, "waiting"); assert.equal(waiting.events.filter(row => row.kind === "result").length, 1);
            const evaluation = f.open().readOperation(record.preview.input.review_operation_id).results.at(-1).output.observations.evaluation;
            assert.equal(evaluation.outcome, "blocked"); assert.deepEqual(evaluation.facts, {});
            const claim = { contract_version: "human-mode-work-decision.v1", source_kind: "human", authority_id: "fixture_operator", source_event_id: "mode-resume-NEW-decision",
              subject_sha256: shadowHash(result.question.review), question_sha256: shadowHash(result.question), choice: "continue_analysis", rationale: newRationale,
              evidence_refs: [{ ref: "fixture:NEW-mode-decision", sha256: "c".repeat(64) }] };
            const witness = modeAnalysisWitness(f.open(), f.configuration);
            for (const [ref, change, code] of [["wrong-question", { question_sha256: "b".repeat(64) }, "PROCESS_HUMAN_QUESTION_CHANGED"],
              ["wrong-subject", { subject_sha256: "b".repeat(64) }, "PROCESS_HUMAN_QUESTION_CHANGED"],
              ["wrong-author", { authority_id: "foreign_actor" }, "PROCESS_HUMAN_NOT_AUTHENTICATED"], ["unverified", {}, "PROCESS_HUMAN_NOT_AUTHENTICATED"]]) {
              publish(ref, { ...claim, ...change }); await assert.rejects(f.open().receiveDecision(result.operation_id, { sourceRef: ref, write: true }), { code });
              assert.equal(modeAnalysisWitness(f.open(), f.configuration), witness);
            }
            publish("new", claim);
            // Actual cold receive/accept of a NEW decision after injected expiry.
            offset = authorization.global_deadline_ms + 1 - realNow(); Date.now = () => realNow() + offset;
            const requestFile = path.join(f.base, "mode-resume-cold-request.json");
            fs.writeFileSync(requestFile, JSON.stringify({ configuration: f.configuration, key_hex: f.key.toString("hex"), human_source_file: sourceFile,
              expected_instance_sha256: waiting.instance_sha256, operation_id: result.operation_id, source_ref: "new", clock_offset_ms: offset, original_deadline_ms: authorization.global_deadline_ms }));
            const child = spawnSync(process.execPath, [fileURLToPath(new URL("./standard-mode-work-continuation-cold-fixture.mjs", import.meta.url)), requestFile],
              { encoding: "utf8", windowsHide: true, timeout: 600000, maxBuffer: 1048576 });
            fs.writeFileSync(path.join(f.base, "mode-resume-cold.stdout.log"), child.stdout ?? ""); fs.writeFileSync(path.join(f.base, "mode-resume-cold.stderr.log"), child.stderr ?? "");
            fs.writeFileSync(path.join(f.base, "mode-resume-cold.exit.json"), JSON.stringify({ pid: child.pid, status: child.status, signal: child.signal, error_code: child.error?.code ?? null }));
            assert.equal(child.status, 0, child.stdout + child.stderr); assert.equal(JSON.parse(child.stdout).original_authority_expired_on_fixture_clock, true);
            f.reopen(); assert.equal(f.t.sessions.length, beforeCount);
            const decision = f.open().readOperation(result.operation_id), count = f.open().inspect().record.events.length;
            assert.equal((await f.open().receiveDecision(result.operation_id, { sourceRef: "new", write: true })).status, "retained_result");
            assert.equal(f.open().inspect().record.events.length, count);
            assert.equal(decision.results[0].output.observations.native_authority_renewed, false);
            const request = f.open().prepareNativeAuthorizationEpoch();
            assert.ok(request.resources.length); assert.equal(request.consumption.known, true); assert.equal(request.consumption.responses, 1);
            fs.writeFileSync(path.join(f.base, "mode-resume-expired-epoch-request.json"), JSON.stringify(request));
            await f.open().activateNativeAuthorizationEpoch(request, { write: true, sourceRef: "new-expired-mode-consent" });
            assert.equal(reads, 1); assert.deepEqual(f.open().inspectAllocations().initial_authorization, original);
          }
        } else assert.equal(record.results.at(-1)?.output.outcome, "completed");
      } else {
        assert.equal(result.kind, "native"); assert.equal(result.journal_phase, "closed", JSON.stringify(result));
        assert.equal(f.t.sessions.length, beforeCount + 1); f.reopen();
      }
    }
    const final = f.open().inspect(), journal = f.open().inspectAllocations();
    assert.ok(waiting); assert.equal(final.cursor.status, "COMPLETED"); assert.equal(f.t.sessions.length, 2); assert.ok(f.t.sessions.every(row => row.closed));
    assert.deepEqual(authorization, original); assert.deepEqual(journal.initial_authorization, original); assert.deepEqual(journal.allocations[0], originalAllocation);
    assert.equal(journal.allocations.length, 2); assert.notEqual(journal.allocations[0].authorization_sha256, journal.allocations[1].authorization_sha256);
    assert.deepEqual(final.record.events.slice(0, waiting.events.length), waiting.events);
    const results = final.record.events.filter(row => row.kind === "result"); assert.equal(results.length, 2); assert.notEqual(results[0].occurrence_id, results[1].occurrence_id);
    const beforeReplay = modeAnalysisWitness(f.open(), f.configuration); let last;
    for (const row of iterateAgenticProcessSimulation({ instanceId: final.record.instance_id, scopeId: final.record.scope_id, model: final.record.model,
      parameters: final.record.initial_parameters, policyPins: final.record.policy_pins, facts: final.record.initial_facts, events: final.record.events })) last = row;
    assert.equal(last.instance_sha256, final.record.instance_sha256); assert.equal(modeAnalysisWitness(f.open(), f.configuration), beforeReplay);
    console.log(JSON.stringify({ mode_resume_proof: true, storage_mode: storageMode, session_mode: sessionMode, project: f.configuration.target_root, control: f.configuration.control_root,
      model_sha256: final.record.model_sha256, instance_sha256: final.record.instance_sha256, workflow_status: final.cursor.status, native_responses: 2,
      new_authenticated_decision_after_expiry_on_fixture_clock: true, clock_class: "injected-fixture-clock", wall_clock_expiry_qualification: "NOT_RUN",
      cold_receive_accept: true, distinct_occurrences_and_allocations: true, original_authority_and_prefix_preserved: true,
      cumulative_responses: requestConsumption(journal), D_H_extra_native_allocations: 0, replay_simulation_exact: true, native_human_resource_authorities: "fixture-capabilities",
      spike_conversion: "NOT_RUN", general_business_unknown_reconciliation: "NOT_RUN", postgres: "NOT_RUN", installed_archive: "NOT_RUN", complete_standard_workflow: false }));
  } finally { Date.now = realNow; }
}
function requestConsumption(journal) { return journal.epochs.at(-1).request.consumption.responses; }
