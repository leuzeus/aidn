import assert from "node:assert/strict";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { assertCanonicalResumeInput } from "../../src/core/workflow/standard-canonical-cycle-resume.mjs";
import { assertOwnedCanonicalResumeInput, ownedCanonicalResumeIntent, ownedCanonicalResumeSource } from "../../src/core/workflow/standard-owned-cycle-resume.mjs";

const id = "op_" + "1".repeat(40), session_id = "S001", cycle_id = "C001", cycle = "cycles/C001-feature-owned", branch = "cycle/C001";
const statusFor = phase => `cycle_id: ${cycle_id}\nsession_owner: ${session_id}\nbranch_name: ${branch}\nstate: ${phase}\n`;
const choice = (action, extra = {}) => ({ decision_operation_id: "op_" + "2".repeat(40), decision_source_sha256: "3".repeat(64),
  choice_record_operation_id: id, selected_cycle_id: "C999", branch_activation: "pending", implementation_authorized: false,
  action, rationale: "Controlled canonical data; not an H capture.", previous_session_owner: "S000", session_owner: session_id,
  previous_state: "IMPLEMENTING", state: "IMPLEMENTING", cycle_close_completed: "NOT_CLAIMED", integration_completed: false, ...extra });
const section = row => `\n## Process cycle choice ${row.choice_record_operation_id}\n\n\`\`\`json\n${JSON.stringify(row, null, 2)}\n\`\`\`\n`;

export function ownedResumeSourceContractFixture(phase = "IMPLEMENTING", history = "") {
  const status = statusFor(phase) + history, scope = { branch, head: "4".repeat(40), project_root: "neutral-owned-fixture" },
    focus = ["CURRENT-STATE.md", `sessions/${session_id}.md`, "snapshots/context-snapshot.md"],
    names = [...focus.slice(0, 2), ...["status", "brief", "plan", "audit-spec", "traceability"].map(name => `${cycle}/${name}.md`)],
    canonical = names.map(path => ({ path, sha256: artifactContentHash(path === `${cycle}/status.md` ? status : `fixture ${path}\n`), metadata_sha256: null })),
    output = { contract_version: "standard-cycle-entry-output.v1", operation_ref: "cycle_entry_admit", outcome: "completed", effect_status: "no_effect",
      facts: { cycle_entry_creation_allowed: false, cycle_entry_resume_allowed: true, cycle_entry_choice_required: false },
      observations: { action: "resume_cycle", reason_code: null, scope_sha256: shadowHash(scope), inventory_sha256: "5".repeat(64),
        implementation_authorized: false, selected_cycle: { cycle_id, cycle_path: cycle, branch, state: phase,
          dor_state: phase === "OPEN" ? "NOT_READY" : "READY", scope_frozen: phase === "OPEN" ? "false" : "true" }, canonical },
      evidence_refs: canonical.map(row => ({ ref: "docs/audit/" + row.path, sha256: row.sha256 })) };
  return { source: { entry_operation_id: id, entry_sha256: "6".repeat(64), input: { contract_version: "standard-cycle-entry-input.v1", session_id, cycle_id: null }, output },
    input: { entry_operation_id: id }, current: { scope, backend: { state_mode: "files" }, status_content: status,
      git: { branch, head: scope.head, diff: "", diff_scope: "configured-product-files-only", diff_sha256: artifactContentHash(""),
        global_diff_sha256: artifactContentHash(""), status_sha256: artifactContentHash(""), other_changes: { count: 0, sha256: shadowHash([]) } },
      physical_focus: focus.map(name => ({ path: "docs/audit/" + name, sha256: artifactContentHash(`fixture ${name}\n`) })) } };
}

export async function verifyOwnedResumeContracts(check) {
  await check("owned resume input accepts only an existing entry operation identity", () => {
    assertOwnedCanonicalResumeInput({ entry_operation_id: id });
    for (const extra of [{ path: "docs/audit/CURRENT-STATE.md" }, { authorized: true }, { phase: "VERIFYING" },
      { observer: "caller" }, { focus_checkpoint_operation_id: id }])
      assert.throws(() => assertOwnedCanonicalResumeInput({ entry_operation_id: id, ...extra }), /OWNED_RESUME_INPUT_INVALID/);
    assert.throws(() => assertOwnedCanonicalResumeInput({ entry_operation_id: "../foreign" }), /OWNED_RESUME_INPUT_INVALID/);
    assertCanonicalResumeInput({ focus_checkpoint_operation_id: id });
    assert.throws(() => assertCanonicalResumeInput({ entry_operation_id: id }), /CANONICAL_RESUME_INPUT_INVALID/);
  });
  await check("owned canonical intent preserves integration-only data for a nonfocused reported cycle", () => {
    assert.deepEqual(ownedCanonicalResumeIntent(statusFor("OPEN"), { session_id, cycle_id }),
      { continuity_action: "current_owned", work_intent: "continue_implementation" });
    assert.deepEqual(ownedCanonicalResumeIntent(statusFor("IMPLEMENTING") + section(choice("integrate_now")), { session_id, cycle_id }),
      { continuity_action: "integrate_now", work_intent: "integration_only" });
    assert.equal(ownedCanonicalResumeIntent(statusFor("IMPLEMENTING") + section(choice("import_now")), { session_id, cycle_id }).work_intent, "continue_implementation");
    assert.equal(ownedCanonicalResumeIntent(statusFor("OPEN") + section(choice("integrate_now", { session_owner: "S000" })), { session_id, cycle_id }).continuity_action, "current_owned");
  });
  await check("owned canonical intent rejects ambiguous or invented approval material", () => {
    for (const row of [choice("integrate_now", { implementation_authorized: true }), choice("integrate_now", { granted: true }),
      choice("integrate_now", { integration_completed: true }), choice("defer"), choice("integrate_now", { decision_source_sha256: "wrong" })])
      assert.throws(() => ownedCanonicalResumeIntent(statusFor("OPEN") + section(row), { session_id, cycle_id }), /OWNED_RESUME_INTENT_INVALID/);
    const history = section(choice("integrate_now"));
    assert.throws(() => ownedCanonicalResumeIntent(statusFor("OPEN") + history + history, { session_id, cycle_id }), /OWNED_RESUME_INTENT_INVALID/);
    assert.throws(() => ownedCanonicalResumeIntent(statusFor("OPEN") + history.replace("```json", "```text"), { session_id, cycle_id }), /OWNED_RESUME_INTENT_INVALID/);
    assert.throws(() => ownedCanonicalResumeIntent(statusFor("OPEN") + section(choice("drop", { state: "DROPPED" })), { session_id, cycle_id }), /OWNED_RESUME_INTENT_REQUIRED/);
  });
  for (const phase of ["OPEN", "IMPLEMENTING", "VERIFYING"]) await check(`owned ${phase} source binds accepted entry and fresh canonical/Git data without a checkpoint`, () => {
    const fixture = ownedResumeSourceContractFixture(phase, section(choice("integrate_now"))), before = shadowHash(fixture),
      descriptor = ownedCanonicalResumeSource(fixture.source, fixture.input, fixture.current);
    assert.equal(descriptor.phase, phase); assert.equal(descriptor.cycle_id, cycle_id); assert.equal(descriptor.session_id, session_id);
    assert.equal(descriptor.entry_operation_id, id); assert.equal(descriptor.source_sha256, shadowHash(fixture.source));
    assert.equal(descriptor.work_intent, "integration_only"); assert.equal(descriptor.checkpoint_created, false);
    assert.equal(descriptor.canonical.length, 7);
    assert.equal(descriptor.canonical.some(row => row.path === "snapshots/context-snapshot.md"), false);
    assert.equal(descriptor.physical_focus.length, 3);
    assert.equal(Object.hasOwn(descriptor, "checkpoint_operation_id"), false); assert.equal(shadowHash(fixture), before);
  });
  await check("owned source fences current working progress without requiring a new Git checkpoint", () => {
    const fixture = ownedResumeSourceContractFixture(), clean = ownedCanonicalResumeSource(fixture.source, fixture.input, fixture.current);
    fixture.current.git.diff = "diff --git a/product/app.mjs b/product/app.mjs\n+approved working progress\n";
    fixture.current.git.diff_sha256 = artifactContentHash(fixture.current.git.diff);
    fixture.current.git.global_diff_sha256 = fixture.current.git.diff_sha256;
    fixture.current.git.status_sha256 = artifactContentHash(" M product/app.mjs\0");
    const before = shadowHash(fixture), working = ownedCanonicalResumeSource(fixture.source, fixture.input, fixture.current);
    assert.notEqual(working.git_sha256, clean.git_sha256); assert.equal(working.git_sha256, shadowHash(fixture.current.git));
    assert.equal(working.checkpoint_created, false); assert.equal(shadowHash(fixture), before);
  });
  await check("owned source refuses foreign identity, unresolved choice, scope changes and unbound canonical bytes", () => {
    const changes = [f => { f.source.entry_operation_id = "op_" + "8".repeat(40); },
      f => { f.source.output.facts.cycle_entry_choice_required = true; }, f => { f.source.output.observations.action = "choose_cycle"; },
      f => { f.source.input.cycle_id = "C002"; }, f => { f.current.scope.head = "9".repeat(40); },
      f => { f.current.git.head = "9".repeat(40); }, f => { f.current.git.diff += "unbound diff"; },
      f => { f.current.git.status_sha256 = "wrong"; }, f => { f.current.status_content += "foreign canonical bytes\n"; },
      f => { f.source.output.evidence_refs.pop(); },
      f => { f.source.output.observations.canonical.pop(); f.source.output.evidence_refs.pop(); },
      f => { f.current.physical_focus.pop(); }];
    for (const change of changes) {
      const fixture = ownedResumeSourceContractFixture(); change(fixture);
      assert.throws(() => ownedCanonicalResumeSource(fixture.source, fixture.input, fixture.current), /OWNED_RESUME_(ENTRY_REQUIRED|CONTEXT_CHANGED)/);
    }
  });
}
