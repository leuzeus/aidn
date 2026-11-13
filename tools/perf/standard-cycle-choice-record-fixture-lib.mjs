import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createStandardWorkflowOperations, standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowOperationHost } from "../../src/application/runtime/standard-workflow-operation-host.mjs";
import { createStandardCycleEntryChoiceRecord } from "../../src/application/runtime/standard-cycle-entry-choice-record.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { iterateAgenticProcessSimulation } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { analyzeStructuredArtifact } from "../../src/lib/workflow/structured-artifact-parser-lib.mjs";
import { parseSessionMetadata } from "../../src/lib/workflow/session-context-lib.mjs";

const H = "a".repeat(64), names = ["C001", "C003", "C004", "C005", "C006"], fields = text => analyzeStructuredArtifact(text).key_values;
function field(text, key, value) {
  const pattern = new RegExp("^([ \\t]*-?[ \\t]*)" + key + ":[^\\r\\n]*(?:\\r?\\n[ \\t]+-[^\\r\\n]*)*", "gm");
  assert.equal([...text.matchAll(pattern)].length, 1, key);
  return text.replace(pattern, (_all, prefix) => `${prefix}${key}: ${value}`);
}
function section(text, title, body) {
  const pattern = new RegExp("(^## " + title + "[^\\r\\n]*\\r?\\n)([\\s\\S]*?)(?=^## |$(?![\\s\\S]))", "gm");
  assert.equal([...text.matchAll(pattern)].length, 1, title);
  return text.replace(pattern, (_all, heading) => heading + "\n" + body + "\n\n");
}
const list = ids => "\n" + (ids.length ? ids.map(id => "  - " + id).join("\n") : "  - none");
function model({ checkpoint = false, activation = false, selectedCheckpoint = false, selectedFocus = false, focusCheckpoint = false } = {}) {
  const ids = ["cycle_entry_observe", "cycle_entry_choice_decision", "cycle_entry_choice_record", ...(checkpoint ? ["cycle_entry_choice_checkpoint"] : []), ...(activation ? ["cycle_entry_choice_activate"] : []), ...(selectedCheckpoint ? ["cycle_entry_selected_checkpoint"] : []), ...(selectedFocus ? ["cycle_entry_selected_focus"] : []), ...(focusCheckpoint ? ["cycle_entry_focus_checkpoint"] : [])],
    nodes = ["observe", "choose", "record", ...(checkpoint ? ["checkpoint"] : []), ...(activation ? ["activate"] : []), ...(selectedCheckpoint ? ["selected_checkpoint"] : []), ...(selectedFocus ? ["selected_focus"] : []), ...(focusCheckpoint ? ["focus_checkpoint"] : [])];
  return { contract_version: "agentic-process-model.v2", model_id: focusCheckpoint ? "focus-checkpoint-port-fixture" : selectedFocus ? "selected-focus-port-fixture" : selectedCheckpoint ? "selected-context-checkpoint-port-fixture" : activation ? "cycle-choice-activation-port-fixture" : checkpoint ? "cycle-choice-checkpoint-port-fixture" : "cycle-choice-record-port-fixture", revision: 1,
    participants: [{ id: "project" }], roles: [], policies: [], entry: "start",
    nodes: [{ id: "start", kind: "sequence", participant_ref: "project", children: nodes },
      ...nodes.map((id, index) => ({ id, kind: "operation", participant_ref: "project", binding_ref: ids[index] }))],
    operation_pins: Object.fromEntries(standardWorkflowOperationBindings().filter(row => ids.includes(row.id)).map(row => [row.id, shadowHash(row)])),
    data_bindings: { contract_version: "process-data-bindings.v2", parameter_keys: [], inputs: [
      { node_id: "observe", fields: Object.fromEntries(Object.entries({ contract_version: "standard-cycle-entry-input.v1", session_id: "S002", cycle_id: null }).map(([key, value]) => [key, { source: "literal", value }])) },
      { node_id: "choose", fields: { contract_version: { source: "literal", value: "standard-cycle-entry-choice-input.v1" }, entry_operation_id: { source: "operation_id", node_id: "observe" } } },
      { node_id: "record", fields: { contract_version: { source: "literal", value: "standard-cycle-entry-choice-record-input.v1" }, decision_operation_id: { source: "operation_id", node_id: "choose" } } },
      ...(checkpoint ? [{ node_id: "checkpoint", fields: { contract_version: { source: "literal", value: "standard-cycle-entry-choice-checkpoint-input.v1" }, record_operation_id: { source: "operation_id", node_id: "record" } } }] : []),
      ...(activation ? [{ node_id: "activate", fields: { contract_version: { source: "literal", value: "standard-cycle-entry-choice-activation-input.v1" }, checkpoint_operation_id: { source: "operation_id", node_id: "checkpoint" } } }] : []),
      ...(selectedCheckpoint ? [{ node_id: "selected_checkpoint", fields: { contract_version: { source: "literal", value: "standard-cycle-entry-selected-input.v1" }, activation_operation_id: { source: "operation_id", node_id: "activate" } } }] : []),
      ...(selectedFocus ? [{ node_id: "selected_focus", fields: { contract_version: { source: "literal", value: "standard-cycle-entry-selected-focus-input.v1" }, checkpoint_operation_id: { source: "operation_id", node_id: "selected_checkpoint" } } }] : []),
      ...(focusCheckpoint ? [{ node_id: "focus_checkpoint", fields: { contract_version: { source: "literal", value: "standard-cycle-entry-focus-checkpoint-input.v1" }, focus_operation_id: { source: "operation_id", node_id: "selected_focus" } } }] : []),
    ] } };
}
export function openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock, { allowed = true } = {}) {
  const fixtureModel = path.join(path.dirname(keyFile), "fixture-model.json");
  return createStandardWorkflowOperationHost({ targetRoot: root, model: fs.existsSync(fixtureModel) ? JSON.parse(fs.readFileSync(fixtureModel, "utf8")) : model(), now: () => clock, readSigningKey: () => fs.readFileSync(keyFile),
    authorize: async request => {
      assert.equal(request.binding.effect_class, ["cycle_entry_choice_record", "cycle_entry_choice_checkpoint", "cycle_entry_choice_activate", "cycle_entry_selected_checkpoint", "cycle_entry_selected_focus", "cycle_entry_focus_checkpoint"].includes(request.binding.id) ? "mutating" : "read-only");
      return { authorized: typeof allowed === "function" ? allowed(request) : allowed, authority_id: "fixture_operator", principal_sha256: H, grant_sha256: H };
    }, humanSource: { read: ({ sourceRef }) => JSON.parse(fs.readFileSync(sourcesFile, "utf8"))[sourceRef] ?? null,
      verify({ source, sourceRef, question }) {
        const retained = JSON.parse(fs.readFileSync(sourcesFile, "utf8"))[sourceRef];
        return retained && shadowHash(retained) === shadowHash(source) && source.question_sha256 === shadowHash(question)
          ? { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) } : { outcome: "unverified" };
      } } });
}
const open = openCycleChoiceFixtureHost;
export async function acceptRecordedChoice({ root, keyFile, sourcesFile, operationId, clock, inspectOnly = false }) {
  const host = open(root, keyFile, sourcesFile, clock);
  if (inspectOnly) {
    const journal = host.readJournal(operationId), state = host.inspect("choice-record");
    createOperationJournalSigner(() => fs.readFileSync(keyFile)).verify(journal);
    return { journal_sha256: shadowHash(journal), instance_sha256: state.record.instance_sha256,
      status: state.cursor.status, effect_status: journal.results.at(-1).receipt.effect_status,
      facts: journal.results.at(-1).output.facts, owner_pending: createStandardWorkflowArtifacts({ targetRoot: root }).ownerPending() };
  }
  const accepted = await host.accept(operationId, { write: true });
  return { instance_sha256: accepted.record.instance_sha256, status: accepted.cursor.status };
}

// Canonical lifecycle/phase setup below is explicit fixture construction. It is
// not a claim that an earlier session close, imported validation or branch
// activation was executed. Only the choice-record operation is under test.
export async function verifyCanonicalCycleChoiceRecord(mode, { childScript, pass, faultAfterFirstCas = false, checkpoint: withCheckpoint = false, activation: withActivation = false, selectedCheckpoint: withSelectedCheckpoint = false, selectedFocus: withSelectedFocus = false, focusCheckpoint: withFocusCheckpoint = false, selectedPhase = null, afterRecordedChoice = null, selectedCycleId = "C001" }) {
  if (faultAfterFirstCas && mode !== "files") throw Error("CHOICE_RECORD_PARTIAL_EFFECT_FILES_REQUIRED");
  if (withCheckpoint && (faultAfterFirstCas || typeof afterRecordedChoice !== "function")) throw Error("CHOICE_RECORD_CHECKPOINT_CALLBACK_REQUIRED");
  if (withActivation && !withCheckpoint) throw Error("CHOICE_RECORD_ACTIVATION_CHECKPOINT_REQUIRED");
  if (withSelectedCheckpoint && !withActivation) throw Error("SELECTED_CONTEXT_ACTIVATION_REQUIRED");
  if (withFocusCheckpoint && !withSelectedFocus) throw Error("FOCUS_CHECKPOINT_FOCUS_REQUIRED");
  if (withSelectedFocus && !withSelectedCheckpoint || selectedPhase !== null && (!withSelectedFocus || !["OPEN", "IMPLEMENTING", "VERIFYING"].includes(selectedPhase))) throw Error("SELECTED_FOCUS_FIXTURE_SCOPE_INVALID");
  if (!["C001", "C002"].includes(selectedCycleId)) throw Error("CHOICE_RECORD_FIXTURE_SELECTION_INVALID");
  const owned = [], root = createFreshStandardWorkflowFixture(mode, owned), artifacts = createStandardWorkflowArtifacts({ targetRoot: root }),
    operations = createStandardWorkflowOperations({ targetRoot: root }), privateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-choice-record-"));
  owned.push(privateRoot);
  const keyFile = path.join(privateRoot, "host.key"), sourcesFile = path.join(privateRoot, "sources.json");
  fs.writeFileSync(keyFile, randomBytes(32)); fs.writeFileSync(sourcesFile, "{}");
  if (withCheckpoint) fs.writeFileSync(path.join(privateRoot, "fixture-model.json"), JSON.stringify(model({ checkpoint: true, activation: withActivation, selectedCheckpoint: withSelectedCheckpoint, selectedFocus: withSelectedFocus, focusCheckpoint: withFocusCheckpoint })));
  const git = (...args) => execFileSync("git", ["-C", root, "-c", "core.hooksPath=NUL", ...args], { encoding: "utf8", windowsHide: true, stdio: "pipe" }).trim();
  const checkpoint = label => { git("add", "."); git("commit", "--allow-empty", "-m", label); };
  const apply = async (prepared, method) => { assert.equal(prepared.can_apply, true, JSON.stringify(prepared));
    assert.equal((await operations[method](prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed"); };
  const replace = async changes => {
    const rows = changes.map(([name, after]) => { const before = artifacts.read(name); return { path: name, before_sha256: before.sha256,
      before_metadata_sha256: artifacts.metadataHash(name), after, after_sha256: artifactContentHash(after) }; });
    await artifacts.withLocalEffectOwner(shadowHash(rows), () => { for (const row of rows) artifacts.compareAndSwapPreservingMetadata(row);
      artifacts.project(rows.map(row => row.path)); return { effect_status: "confirmed" }; });
  };
  try {
    await apply(await operations.prepareSession({ session_id: "S001", session_branch: "S001-choice",
      objective: "Record explicit carryover without activating a branch or granting implementation" }), "initializeSession");
    await apply(await operations.prepareMode({ session_id: "S001", mode: "COMMITTING" }), "applyMode"); checkpoint("fixture selected mode");
    await apply(await operations.prepareCycleContext({ session_id: "S001" }), "refreshCycleContext"); checkpoint("fixture context");
    await apply(await operations.prepareCycle({ session_id: "S001", cycle_id: "C001", cycle_type: "feature", title: "choice",
      objective: "Record explicit carryover without activating a branch or granting implementation",
      continuity_rule: "R2_SESSION_BASE_WITH_IMPORT", base_branch: "S001-choice" }), "initializeCycle"); checkpoint("fixture initial cycle");
    const initialSession = artifacts.read("sessions/S001.md").content, baseStatus = artifacts.read("cycles/C001-feature-choice/status.md").content;
    let oldSession = field(initialSession, "state", "CLOSED").replace(/(### Session close gate satisfied\?\s*\r?\n-\s*)\[ \](\s*Yes)/, "$1[x]$2");
    assert.equal(parseSessionMetadata(oldSession).close_gate_satisfied, true);
    let session = initialSession.replaceAll("S001", "S002");
    for (const [key, value] of Object.entries({ parent_session: "S001", cycle_branch: "feature/C002-choice", primary_focus_cycle: "C002",
      attached_cycles: list(["C002"]), integration_target_cycles: list(["C002"]), integration_target_cycle: "C002",
      reported_from_previous_session: list(names), carry_over_pending: "yes" })) session = field(session, key, value);
    const otherSession = initialSession.replaceAll("S001", "S009");
    let current = artifacts.read("CURRENT-STATE.md").content.replaceAll("S001", "S002").replaceAll("C001", "C002");
    current = field(current, "cycle_branch", "feature/C002-choice");
    const changes = [["sessions/S001.md", oldSession], ["sessions/S002.md", session], ["sessions/S009.md", otherSession], ["CURRENT-STATE.md", current]];
    for (const id of ["C001", "C002", "C003", "C004", "C005", "C006"]) {
      let status = baseStatus.replaceAll("C001", id);
      status = field(status, "session_owner", id === "C002" ? "S002" : id === "C003" ? "S009" : "S001");
      if (id !== "C002") status = field(status, "reported_to_session", "S002");
      if (id === "C001") for (const [key, value] of Object.entries({ state: selectedPhase ?? "VERIFYING", dor_state: selectedPhase === "OPEN" ? "NOT_READY" : "READY", scope_frozen: selectedPhase === "OPEN" ? "false" : "true" })) status = field(status, key, value);
      changes.push([`cycles/${id}-feature-choice/status.md`, status]);
      if (id === "C001") continue;
      for (const name of ["brief", "plan", "audit-spec", "traceability"]) changes.push([`cycles/${id}-feature-choice/${name}.md`,
        artifacts.read(`cycles/C001-feature-choice/${name}.md`).content.replaceAll("C001", id)]);
    }
    let snapshot = artifacts.read("snapshots/context-snapshot.md").content.replaceAll("S001", "S002");
    snapshot = section(snapshot, "Active cycles", ["C001", "C002", "C003", "C004", "C005", "C006"].map(id => `- ${id}: staged canonical phase precondition`).join("\n"));
    changes.push(["snapshots/context-snapshot.md", snapshot]);
    await replace(changes);
    for (const branch of ["S002-choice", "S009-choice", ...["C002", "C003", "C004", "C005", "C006"].map(id => `feature/${id}-choice`)]) git("branch", branch, "HEAD");
    git("switch", "feature/C002-choice");
    fs.writeFileSync(path.join(root, "fixture-product.txt"), "Preserve this current product; choice recording never switches to the selected branch.\n");
    await apply(await operations.prepareCycleContext({ session_id: "S002" }), "refreshCycleContext"); checkpoint("fixture canonical carryover preconditions");
    const heads = () => git("for-each-ref", "--format=%(refname)%09%(objectname)", "refs/heads");
    const canonical = () => { const view = artifacts.observeInventory(); return view.rows.filter(row => !row.path.startsWith("workflows/")).map(row => ({
      path: row.path, sha256: row.sha256, metadata_sha256: row.metadata_sha256 })); };
    const physical = () => ["sessions/S001.md", "sessions/S002.md", "cycles/C001-feature-choice/status.md", "cycles/C003-feature-choice/status.md"].map(name => {
      const file = path.join(root, "docs/audit", name); return { path: name, sha256: fs.existsSync(file) ? artifactContentHash(fs.readFileSync(file, "utf8")) : null }; });
    console.log(JSON.stringify({ arranged_choice_record_fixture: mode, target: root,
      precondition: withSelectedFocus ? "STAGED_CLOSED_PREDECESSOR_AND_CANONICAL_PHASE_METADATA_NOT_WORK_ACCEPTANCE_PROOF" : "STAGED_CLOSED_PREDECESSOR_AND_VERIFYING_METADATA_NOT_SESSION_CLOSE_OR_WORK_ACCEPTANCE_PROOF", native_calls: 0 }));
    const clock = Date.now(); let host = open(root, keyFile, sourcesFile, clock);
    const initial = host.initialize({ instanceId: "choice-record" }); host.initialize({ instanceId: "choice-record", write: true, expectedResultSha256: initial.record.instance_sha256 });
    const next = async () => { const state = host.inspect("choice-record"); return host.preview({ instanceId: "choice-record", expectedSha256: state.record.instance_sha256, occurrenceId: state.cursor.ready[0] }); };
    const stage = preview => host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
    let preview = await next(), staged = await stage(preview);
    assert.equal((await host.dispatch(staged.operation_id, { write: true })).receipt.outcome, "completed"); await host.accept(staged.operation_id, { write: true });
    preview = await next(); staged = await stage(preview);
    const waiting = await host.dispatch(staged.operation_id, { write: true }); assert.equal(waiting.status, "waiting_for_human");
    const question = waiting.question, decision = { contract_version: "human-cycle-entry-choice.v1", source_kind: "human", authority_id: "fixture_operator",
      source_event_id: "fixture-carryover-record-current", subject_sha256: shadowHash(question.subject), question_sha256: shadowHash(question), choice: "select_cycle",
      selection: { cycle_id: selectedCycleId, carryover_decisions: names.map(id => ({ cycle_id: id, action: id === "C001" ? "import_now" : id === "C003" ? "defer" : id === "C006" ? "integrate_now" : "drop",
        outcome: id === "C004" ? "NO_GO" : id === "C005" ? "DROPPED" : null, rationale: "Explicit controlled per-cycle fixture disposition" })) },
      rationale: "Record current canonical dispositions before separate branch activation and phase admission", evidence_refs: [{ ref: "fixture:carryover-record", sha256: H }] };
    fs.writeFileSync(sourcesFile, JSON.stringify({ choice: decision }));
    await host.receiveDecision(staged.operation_id, { write: true, sourceRef: "choice" }); await host.accept(staged.operation_id, { write: true });
    const originalOwner = artifacts.read("sessions/S001.md").content;
    await replace([["sessions/S001.md", field(originalOwner, "state", "OPEN")]]);
    const openOwnerBefore = canonical(), blocked = await next(); assert.equal(blocked.prepared.can_apply, false);
    assert.equal(blocked.prepared.reason_code, "STANDARD_CYCLE_CHOICE_RECORD_FOREIGN_OWNER_OPEN"); assert.deepEqual(canonical(), openOwnerBefore);
    await replace([["sessions/S001.md", originalOwner]]);
    const before = canonical(), beforePhysical = physical(), beforeRefs = heads(), beforeProduct = artifactContentHash(fs.readFileSync(path.join(root, "fixture-product.txt"))),
      beforeBranch = git("branch", "--show-current"), beforeHead = git("rev-parse", "HEAD");
    preview = await next(); assert.equal(preview.prepared.can_apply, true, JSON.stringify(preview.prepared)); assert.deepEqual(canonical(), before);
    host = open(root, keyFile, sourcesFile, clock, { allowed: false });
    await assert.rejects(stage(preview), { code: "STANDARD_HOST_AUTHORIZATION_REQUIRED" }); assert.deepEqual(canonical(), before);
    host = open(root, keyFile, sourcesFile, clock); staged = await stage(preview);
    const recordId = staged.operation_id, prepared = host.readJournal(recordId).preview.prepared;
    const selectedRef = "refs/heads/feature/C001-choice", oldRef = git("rev-parse", selectedRef), otherRef = git("rev-parse", "HEAD");
    assert.notEqual(oldRef, otherRef, "The candidate branch staleness probe must move a real different tip");
    let moved = false;
    const boundary = createStandardCycleEntryChoiceRecord({ targetRoot: root, scope: operations.observeScope,
      readCurrent: () => host.inspect("choice-record").record,
      readDecision: async () => { if (!moved) { moved = true; git("update-ref", selectedRef, otherRef, oldRef); } return { question, decision }; } });
    await assert.rejects(boundary.apply(host.inspect("choice-record").record, prepared, { write: true,
      expectPlan: prepared.plan_sha256, assertAuthorized: async () => {} }), { code: "STANDARD_CYCLE_CHOICE_RECORD_BRANCH_CHANGED", effect_status: "no_effect" });
    assert.equal(moved, true); assert.equal(artifacts.ownerPending(), false); assert.deepEqual(canonical(), before);
    git("update-ref", selectedRef, oldRef, otherRef); assert.equal(heads(), beforeRefs);
    let sourceReads = 0, grantLive = true, lateResult, lateRefusal;
    const lastSourceBoundary = createStandardCycleEntryChoiceRecord({ targetRoot: root, scope: operations.observeScope,
      readCurrent: () => host.inspect("choice-record").record,
      readDecision: async () => { if (++sourceReads === 3) grantLive = false; return { question, decision }; } });
    try {
      lateResult = await lastSourceBoundary.apply(host.inspect("choice-record").record, prepared, { write: true, expectPlan: prepared.plan_sha256,
        assertAuthorized: async () => { if (!grantLive) throw Object.assign(Error("FIXTURE_CHOICE_RECORD_GRANT_REVOKED_LAST_SOURCE_AWAIT"),
          { code: "FIXTURE_CHOICE_RECORD_GRANT_REVOKED_LAST_SOURCE_AWAIT" }); } });
    } catch (cause) { lateRefusal = { code: cause.code, effect_status: cause.effect_status }; }
    fs.writeFileSync(path.join(privateRoot, "last-source-grant-boundary.json"), JSON.stringify({ source_reads: sourceReads,
      result: lateResult ?? null, refusal: lateRefusal ?? null,
      changed_paths: canonical().filter(row => before.find(old => old.path === row.path)?.sha256 !== row.sha256).map(row => row.path),
      owner_pending: artifacts.ownerPending() }));
    assert.equal(lateResult, undefined);
    assert.deepEqual(lateRefusal, { code: "FIXTURE_CHOICE_RECORD_GRANT_REVOKED_LAST_SOURCE_AWAIT", effect_status: "no_effect" });
    assert.equal(sourceReads, 3); assert.equal(artifacts.ownerPending(), false); assert.deepEqual(canonical(), before);
    // A current source-only action grant has no host preparation-age ceiling.
    // The canonical timestamp remains the original preparation provenance.
    host = open(root, keyFile, sourcesFile, clock + 86400000);
    const first = prepared.plan.changes[0], destination = path.resolve(root, "docs/audit", first.path), originalRename = fs.renameSync;
    let injected = false, dispatched;
    if (faultAfterFirstCas) fs.renameSync = function (from, to) {
      const result = originalRename.apply(this, arguments);
      if (!injected && path.resolve(to) === destination) {
        injected = true;
        throw Object.assign(Error("FIXTURE_CHOICE_RECORD_POST_CAS_ACK_LOSS"), { code: "FIXTURE_CHOICE_RECORD_POST_CAS_ACK_LOSS" });
      }
      return result;
    };
    try { dispatched = await host.dispatch(recordId, { write: true }); } finally { fs.renameSync = originalRename; }
    if (faultAfterFirstCas) {
      assert.equal(injected, true); assert.equal(dispatched.receipt.outcome, "reconciliation_required");
      assert.equal(dispatched.receipt.effect_status, "unknown"); assert.deepEqual(dispatched.receipt.facts, {});
      const journal = host.readJournal(recordId), result = journal.results.at(-1).output;
      createOperationJournalSigner(() => fs.readFileSync(keyFile)).verify(journal);
      assert.deepEqual(result.facts, {}); assert.equal(result.observations.reason_code, "FIXTURE_CHOICE_RECORD_POST_CAS_ACK_LOSS");
      const partial = canonical(), actualChanges = partial.filter(row => before.find(old => old.path === row.path)?.sha256 !== row.sha256);
      assert.deepEqual(actualChanges.map(row => row.path), [first.path]); assert.equal(actualChanges[0].sha256, first.after_sha256);
      assert.equal(artifacts.ownerPending(), true); assert.equal(heads(), beforeRefs);
      assert.equal(git("branch", "--show-current"), beforeBranch); assert.equal(git("rev-parse", "HEAD"), beforeHead);
      assert.equal(artifactContentHash(fs.readFileSync(path.join(root, "fixture-product.txt"))), beforeProduct);
      const state = host.inspect("choice-record"), signed = shadowHash(journal);
      assert.equal(state.cursor.status, "WAITING");
      assert.equal(state.record.events.some(event => event.kind === "operation_result" && event.receipt.facts.cycle_entry_choice_recorded === true), false);
      const reopened = JSON.parse(execFileSync(process.execPath, [childScript, "--inspect-record", root, keyFile, sourcesFile, recordId, String(clock + 86400000)],
        { encoding: "utf8", windowsHide: true, stdio: "pipe" }));
      assert.equal(reopened.journal_sha256, signed); assert.equal(reopened.instance_sha256, state.record.instance_sha256);
      assert.equal(reopened.effect_status, "unknown"); assert.deepEqual(reopened.facts, {}); assert.equal(reopened.owner_pending, true);
      assert.equal((await host.dispatch(recordId, { write: true })).status, "retained_result");
      assert.equal(shadowHash(host.readJournal(recordId)), signed); assert.deepEqual(canonical(), partial);
      assert.equal((await createStandardWorkflowOperations({ targetRoot: root }).prepareSession({ session_id: "S003", session_branch: "S003-pending",
        objective: "Never allocate a new workflow while the previous partial effect is unresolved" })).reason_code, "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
      console.log(JSON.stringify({ persistence: mode, root, private_root: privateRoot, operation_id: recordId,
        journal_sha256: signed, instance_sha256: state.record.instance_sha256, actual_changed_path: first.path,
        effect_status: "unknown", owner_retained: true, cold_read: true, native_calls: 0, replay_or_reconciliation: "NOT_EXECUTED" }));
      pass("files: post-CAS acknowledgement loss retains a signed UNKNOWN and owner across cold read without another effect");
      return;
    }
    assert.equal(dispatched.receipt.outcome, "completed", JSON.stringify(dispatched));
    const cold = JSON.parse(execFileSync(process.execPath, [childScript, "--accept-record", root, keyFile, sourcesFile, recordId, String(clock + 86400000)],
      { encoding: "utf8", windowsHide: true, stdio: "pipe" }));
    const final = host.inspect("choice-record"); assert.equal(final.cursor.status, withCheckpoint ? "RUNNING" : "COMPLETED"); assert.equal(final.record.instance_sha256, cold.instance_sha256);
    if (withCheckpoint) assert.deepEqual(final.cursor.ready.map(id => final.cursor.occurrences.find(row => row.occurrence_id === id).node_id), ["checkpoint"]);
    const journal = host.readJournal(recordId), output = journal.results.at(-1).output;
    createOperationJournalSigner(() => fs.readFileSync(keyFile)).verify(journal);
    assert.deepEqual(output.facts, { cycle_entry_choice_recorded: true, cycle_entry_resume_allowed: false });
    assert.equal(output.observations.branch_activated, false); assert.equal(output.observations.implementation_authorized, false);
    const after = canonical(), changed = new Set(prepared.plan.changes.map(row => row.path));
    for (const row of before.filter(row => !changed.has(row.path))) assert.deepEqual(after.find(value => value.path === row.path), row, row.path);
    for (const change of prepared.plan.changes) assert.equal(artifacts.read(change.path).sha256, change.after_sha256);
    assert.equal(fields(artifacts.read("cycles/C001-feature-choice/status.md").content).state, selectedPhase ?? "VERIFYING");
    assert.equal(fields(artifacts.read("cycles/C001-feature-choice/status.md").content).session_owner, "S002");
    assert.equal(fields(artifacts.read("cycles/C004-feature-choice/status.md").content).state, "NO_GO");
    assert.equal(fields(artifacts.read("cycles/C005-feature-choice/status.md").content).state, "DROPPED");
    const sessionAfter = parseSessionMetadata(artifacts.read("sessions/S002.md").content);
    assert.deepEqual(sessionAfter.reported_from_previous_session, ["C003"]); assert.equal(sessionAfter.carry_over_pending, "yes");
    assert.equal(fields(artifacts.read("CURRENT-STATE.md").content).active_cycle, "none");
    assert.equal(heads(), beforeRefs); assert.equal(git("branch", "--show-current"), beforeBranch); assert.equal(git("rev-parse", "HEAD"), beforeHead);
    assert.equal(artifactContentHash(fs.readFileSync(path.join(root, "fixture-product.txt"))), beforeProduct);
    if (mode === "db-only") assert.deepEqual(physical(), beforePhysical);
    assert.equal(artifacts.ownerPending(), false);
    const finalHash = final.record.instance_sha256;
    assert.equal((await host.dispatch(recordId, { write: true })).status, "retained_result"); await host.accept(recordId, { write: true });
    assert.equal(host.inspect("choice-record").record.instance_sha256, finalHash); assert.deepEqual(canonical(), after);
    let last, count = 0; for (const row of iterateAgenticProcessSimulation({ instanceId: final.record.instance_id, scopeId: final.record.scope_id,
      model: final.record.model, policyPins: final.record.policy_pins, events: final.record.events })) { last = row; count++; }
    assert.equal(last.instance_sha256, finalHash); assert.equal(count, final.record.events.length + 1);
    assert.equal(final.record.events.some(row => ["assign", "result"].includes(row.kind)), false);
    console.log(JSON.stringify({ persistence: mode, root, private_root: privateRoot, operation_id: recordId, instance_sha256: finalHash,
      changed_canonical_documents: changed.size, native_calls: 0, actual_effect: "CANONICAL_CARRYOVER_AND_FOCUS_SUSPENSION",
      selected_phase: selectedPhase ? "STAGED_" + selectedPhase + "_METADATA_PRESERVED_NOT_WORK_ACCEPTANCE" : selectedCycleId === "C001" ? "STAGED_VERIFYING_METADATA_PRESERVED_NOT_WORK_ACCEPTANCE" : "STAGED_OPEN_METADATA_PRESERVED_NOT_WORK_ACCEPTANCE", branch_activation: "NOT_EXECUTED", published_root: "NOT_CONNECTED",
      checkpoint_and_continuity: "NOT_EXECUTED", exact_replay: true, cold_node_acceptance: true, host_preparation_age_ceiling: "NONE",
      human_source: "CONTROLLED_FIXTURE_PORT", genuine_native: "NOT_RUN", installed_archive: "NOT_RUN" }));
    pass(mode + ": actual signed carryover record preserves phase/deferred history, exact grant, metadata and cold idempotent ACK without branch or Native effects");
    if (withCheckpoint) await afterRecordedChoice({ mode, root, privateRoot, keyFile, sourcesFile, clock: clock + 86400000,
      host, artifacts, operations, recordId, beforeProduct, beforeBranch, beforeHead, git, heads, canonical });
  } finally {
    // Keep owned scopes and pending evidence for independent review. Cleanup is
    // a later, explicit operation; it is never inferred from a passing test.
    console.error(JSON.stringify({ retained_choice_record_roots: owned }));
  }
}
