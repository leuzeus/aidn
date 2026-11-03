import { assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createStandardHumanDecisions } from "../../src/application/runtime/standard-workflow-human-decisions.mjs";
import { createProcessDecisionInboxStore } from "../../src/adapters/runtime/process-decision-inbox-store.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { assertDecisionInbox, decisionInboxPath, decisionInboxId } from "../../src/core/workflow/process-decision-inbox.mjs";
import { validateJsonSchema, validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import outputSchema from "../../src/core/contracts/workflow-definition/standard-cycle-closure-decision-output.v1.schema.json" with { type: "json" };
import inboxSchema from "../../src/core/contracts/workflow-definition/process-decision-inbox.v3.schema.json" with { type: "json" };
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createProjectArtifactStore } from "../../src/application/runtime/project-artifact-store-service.mjs";
const H = "a".repeat(64), op = char => "op_" + char.repeat(40), temp = fs.realpathSync(os.tmpdir());
const mode = process.argv.find(arg => arg.startsWith("--mode="))?.slice(7) ?? "files", owned = [];
if (!["files", "dual", "db-only"].includes(mode)) throw Error("CLOSURE_INBOX_FIXTURE_MODE_INVALID");
const root = mode === "files" ? fs.mkdtempSync(path.join(temp, "aidn-closure-inbox-")) : createFreshStandardWorkflowFixture(mode, owned);
if (mode === "files") owned.push(root);
const readBytes = id => {
  if (mode === "files") return fs.readFileSync(path.join(root, "docs/audit", decisionInboxPath(id)));
  const store = createProjectArtifactStore({ targetRoot: root, existingOnly: true, readOnly: true });
  try { return Buffer.from(store.getArtifact(decisionInboxPath(id)).content); } finally { store.close(); }
};
const replaceBytes = (id, content) => {
  if (mode === "files") return fs.writeFileSync(path.join(root, "docs/audit", decisionInboxPath(id)), content);
  const store = createProjectArtifactStore({ targetRoot: root, existingOnly: true });
  try { store.upsertArtifact({ path: decisionInboxPath(id), family: "runtime", kind: "process_decision_inbox", content_format: "utf8", content }); } finally { store.close(); }
};
let checks = 0; const pass = name => { checks++; console.log("PASS " + name); };
try {
  const key = Buffer.alloc(32, 31), signer = createOperationJournalSigner(() => key), claims = new Map();
  const source = { read: ({ sourceRef }) => claims.get(sourceRef) ?? null,
    verify: ({ source: claim, sourceRef }) => sourceRef !== "unverified" && claims.has(sourceRef) && shadowHash(claims.get(sourceRef)) === shadowHash(claim)
      ? { outcome: "verified", authority_id: claim.authority_id, source_sha256: shadowHash(claim) } : { outcome: "unverified" } };
  const open = () => createStandardHumanDecisions({ inbox: createProcessDecisionInboxStore({ targetRoot: root, stateMode: mode }), signer, source, projectionRequired: mode === "dual" });
  const review = { session_id: "S001", cycle_id: "C001", audit_operation_id: op("b"), audit_output_sha256: H, report_sha256: H, context_sha256: H,
    product_sha256: H, scope_sha256: H, work_complete: true, findings: [],
    pending: { requirements: [], usages: [], documents: [], tests: [], blocking_findings: [], risk_findings_requiring_human_decision: [] } };
  const record = char => ({ operation_id: op(char), intent: { binding_ref: "cycle_closure_decision", instance_id: "fixture", scope_id: "fixture", occurrence_id: "root/closure" },
    preview: { prepared: { plan: { review, choices: ["retain", "no_go", "drop", "refused", "deferred", "cancelled"] } } }, results: [] });
  const claim = (question, choice, event = choice) => ({ contract_version: "human-cycle-closure-decision.v1", source_kind: "human", authority_id: "fixture_operator",
    source_event_id: "event:" + event, question_sha256: shadowHash(question), subject_sha256: shadowHash(question.review), choice,
    rationale: "Explicit fixture human decision", risk_acceptances: [], evidence_refs: [{ ref: "fixture:operator", sha256: H }] });
  assert.deepEqual(validateJsonSchemaDefinition(outputSchema, "#", { contractKind: "workflow-definition" }), []);
  assert.deepEqual(validateJsonSchemaDefinition(inboxSchema, "#", { contractKind: "workflow-definition" }), []);
  let index = 0;
  for (const choice of ["retain", "no_go", "drop", "refused", "deferred", "cancelled"]) {
    const current = record("abcdef"[index++]), human = open(), question = human.question(current);
    assert.equal(await human.reserve(current, "missing"), null);
    claims.set(choice, claim(question, choice)); const capture = await human.reserve(current, choice), output = human.output(current, capture);
    assert.equal(capture.contract_version, "process-decision-inbox.v3"); assertDecisionInbox(capture);
    assertStandardOperationOutput(output); const falseSuccess = structuredClone(output); falseSuccess.facts.cycle_closed = true; assert.throws(() => assertStandardOperationOutput(falseSuccess));
    assert.deepEqual(validateJsonSchema(output, outputSchema, "$", { contractKind: "workflow-definition" }), []);
    assert.equal(output.outcome, ["retain", "no_go", "drop"].includes(choice) ? "completed" : choice === "refused" ? "rejected" : choice);
    assert.equal(output.observations.lifecycle_transition, "none"); assert.equal(output.observations.skill_completion, "pending");
    if (["refused", "deferred", "cancelled"].includes(choice)) assert.deepEqual(output.facts, {});
    const receipt = { operation_id: current.operation_id, output_sha256: shadowHash(output) }; current.results.push({ output, receipt });
    human.acknowledge(capture.inbox_id, receipt); const restarted = open();
    assert.equal(restarted.captured(current).phase, "receipted"); await restarted.verifyCaptured(current);
    if (choice === "retain") {
      const childScript = `import fs from "node:fs";
        import { createStandardHumanDecisions } from ${JSON.stringify(new URL("../../src/application/runtime/standard-workflow-human-decisions.mjs", import.meta.url).href)};
        import { createProcessDecisionInboxStore } from ${JSON.stringify(new URL("../../src/adapters/runtime/process-decision-inbox-store.mjs", import.meta.url).href)};
        import { createOperationJournalSigner } from ${JSON.stringify(new URL("../../src/core/workflow/process-operation-journal.mjs", import.meta.url).href)};
        import { shadowHash } from ${JSON.stringify(new URL("../../src/core/workflow/shadow-json.mjs", import.meta.url).href)};
        const input=JSON.parse(fs.readFileSync(0,"utf8"));
        const human=createStandardHumanDecisions({inbox:createProcessDecisionInboxStore({targetRoot:input.root,stateMode:input.mode}),
          signer:createOperationJournalSigner(()=>Buffer.from(input.key,"hex")),projectionRequired:input.mode==="dual",
          source:{verify:({source,question})=>shadowHash(source)===shadowHash(input.claim)&&source.question_sha256===shadowHash(question)
            ?{outcome:"verified",authority_id:source.authority_id,source_sha256:shadowHash(source)}:{outcome:"unverified"}}});
        await human.verifyCaptured(input.record);process.stdout.write(JSON.stringify({phase:human.captured(input.record).phase,choice:human.readSource(input.ref).choice}));`;
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", childScript], { encoding: "utf8", shell: false, windowsHide: true, timeout: 30000,
        input: JSON.stringify({ root, mode, key: key.toString("hex"), claim: claims.get(choice), record: current, ref: output.evidence_refs[0].ref }) });
      assert.equal(child.status, 0, child.stderr); assert.deepEqual(JSON.parse(child.stdout), { phase: "receipted", choice });
    }
    const before = readBytes(capture.inbox_id);
    if (mode === "db-only") assert.equal(fs.existsSync(path.join(root, "docs/audit", decisionInboxPath(capture.inbox_id))), false);
    await restarted.reserve(current, choice); restarted.acknowledge(capture.inbox_id, receipt); assert.deepEqual(readBytes(capture.inbox_id), before);
    claims.delete(choice); await assert.rejects(restarted.verifyCaptured(current), { code: "PROCESS_HUMAN_NOT_AUTHENTICATED" });
    pass(`${choice}: real ${mode} inbox reopens and deduplicates; retained MAC is distinct from live human authentication`);
  }
  const current = record("a"), question = open().question(current), unverified = claim(question, "retain", "unverified");
  claims.set("unverified", unverified); await assert.rejects(open().reserve(current, "unverified"), { code: "PROCESS_HUMAN_NOT_AUTHENTICATED" });
  const changed = structuredClone(current); changed.intent.scope_id = "other"; claims.set("old", claim(question, "retain", "old"));
  await assert.rejects(open().reserve(changed, "old"), { code: "PROCESS_HUMAN_QUESTION_CHANGED" });
  pass("unverified identities and questions changed after preparation refuse before capture");
  const original = claim(question, "retain", "single-use"); claims.set("single-use", original); const retained = await open().reserve(current, "single-use");
  const other = record("b"); claims.set("reuse", claim(open().question(other), "retain", "single-use"));
  await assert.rejects(open().reserve(other, "reuse"), { code: "PROCESS_HUMAN_SOURCE_ALREADY_USED" });
  const body = JSON.parse(readBytes(retained.inbox_id));
  body.source.rationale += " changed"; replaceBytes(retained.inbox_id, JSON.stringify(body));
  assert.throws(() => open().readSource("aidn:decision-source/" + retained.inbox_id), { code: "PROCESS_JOURNAL_NOT_AUTHENTICATED" });
  const unknown = record("c"); unknown.intent.binding_ref = "unknown_human";
  assert.throws(() => open().question(unknown), { code: "PROCESS_HUMAN_OPERATION_REQUIRED" });
  pass("single-use identity, MAC tamper refusal and closed purpose dispatch preserve authority");
  for (const version of [1, 2]) {
    const source = { contract_version: version === 1 ? "human-mode-decision.v1" : "human-drift-recovery-decision.v1", source_kind: "human",
      authority_id: "historical_operator", source_event_id: `historical:${version}`, subject_sha256: H, question_sha256: H,
      choice: version === 1 ? "COMMITTING" : "new_cycle", evidence_refs: [{ ref: "fixture:historical-decision", sha256: H }] };
    const id = decisionInboxId(source), historical = signer.seal({ contract_version: `process-decision-inbox.v${version}`, inbox_id: id,
      operation_id: op("a"), source_ref: `historical:${version}`, source, phase: "reserved", receipt_sha256: null });
    const store = createProcessDecisionInboxStore({ targetRoot: root, stateMode: mode }); store.compareAndSwap(historical, null);
    const before = readBytes(id), read = createProcessDecisionInboxStore({ targetRoot: root, stateMode: mode }).read(id).record;
    signer.verify(read); assert.equal(read.contract_version, historical.contract_version); assert.deepEqual(read, historical); assert.deepEqual(readBytes(id), before);
  }
  pass("historical v1 mode and v2 recovery readers retain their exact version and bytes without conversion");
  console.log(JSON.stringify({ status: "PASS", checks, proof: "inbox-component", mode, human_source: "fixture", full_workflow: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
} finally {
  for (const folder of owned) {
    const resolved = fs.realpathSync(folder); assert.equal(path.dirname(resolved), temp);
    assert.ok(["aidn-closure-inbox-", "aidn-standard-fresh-"].some(prefix => path.basename(resolved).startsWith(prefix)));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
