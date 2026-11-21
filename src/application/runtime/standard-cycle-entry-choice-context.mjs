import { observeStandardCycleEntryContext } from "./standard-cycle-entry-context.mjs";
import { assertCycleEntryChoiceSubject } from "../../core/workflow/standard-cycle-entry-choice.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "../../core/workflow/shadow-json.mjs";
import inputSchema from "../../core/contracts/workflow-definition/standard-cycle-entry-choice-input.v1.schema.json" with { type: "json" };
import { execFileSync } from "node:child_process";

const active = new Set(["OPEN", "IMPLEMENTING", "VERIFYING"]);
const fail = code => { throw Object.assign(Error(code), { code }); };
const pin = ({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 });
export function readStandardCycleEntryChoiceBranchHeads(root, cycles) {
  if (!cycles.length) return new Map();
  const refs = [...new Set(cycles.map(row => "refs/heads/" + row.fields.branch_name))];
  const text = execFileSync("git", ["-C", root, "-c", "core.fsmonitor=false", "-c", "submodule.recurse=false",
    "for-each-ref", "--format=%(refname)%09%(objectname)", ...refs],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false,
    timeout: 10000, maxBuffer: 1048576, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  const heads = new Map();
  for (const line of text.split(String.fromCharCode(10)).filter(row => row.trim())) {
    const [ref, sha, extra] = line.trimEnd().split(String.fromCharCode(9));
    if (extra !== undefined || !ref || !sha || ![40, 64].includes(sha.length)
      || [...sha].some(character => !"0123456789abcdef".includes(character)))
      fail("STANDARD_CYCLE_ENTRY_CHOICE_BRANCH_OBSERVATION_INVALID");
    if (refs.includes(ref)) heads.set(ref.slice("refs/heads/".length), sha);
  }
  return heads;
}

// readEntry is an owning-host capability for an authenticated accepted journal.
// The request contains its ID, never a caller-supplied observation or verifier.
export function createStandardCycleEntryChoiceContext({ artifacts, operations, readEntry, readCurrent }) {
  if (typeof readEntry !== "function" || typeof readCurrent !== "function")
    fail("STANDARD_CYCLE_ENTRY_CHOICE_AUTHORITY_REQUIRED");
  const current = (instance, signal) => {
    if (signal?.aborted) fail("PROCESS_HUMAN_AUTHORITY_ABORTED");
    if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256)
      fail("STANDARD_CYCLE_ENTRY_CHOICE_PROCESS_CHANGED");
    if (artifacts.ownerPending()) fail("STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
  };
  const observe = sessionId => observeStandardCycleEntryContext({ artifacts, scope: operations.observeScope, sessionId });
  async function prepare(instance, input, signal) {
    if (checkShadowJson(input) || validateJsonSchema(input, inputSchema, "$", { contractKind: "workflow-definition" }).length)
      fail("STANDARD_CYCLE_ENTRY_CHOICE_INPUT_INVALID");
    current(instance, signal);
    const source = readEntry(instance, input.entry_operation_id);
    if (source.operation_id !== input.entry_operation_id || source.output?.operation_ref !== "cycle_entry_observe"
      || source.output.outcome !== "completed" || source.output.effect_status !== "no_effect"
      || source.output.facts.cycle_entry_choice_required !== true)
      fail("STANDARD_CYCLE_ENTRY_CHOICE_OBSERVATION_REQUIRED");
    const fresh = await operations.observeCycleEntry(source.input);
    current(instance, signal);
    if (shadowHash(fresh) !== shadowHash(source.output)) fail("STANDARD_CYCLE_ENTRY_CHOICE_SOURCE_CHANGED");
    const before = observe(source.input.session_id), metadata = before.metadata;
    if (fresh.observations.scope_sha256 !== shadowHash(before.scope)
      || fresh.observations.inventory_sha256 !== before.inventory_sha256
      || shadowHash(fresh.observations.canonical) !== shadowHash(before.canonical))
      fail("STANDARD_CYCLE_ENTRY_CHOICE_SOURCE_CHANGED");
    const reported = [...metadata.reported_from_previous_session].sort();
    const relevant = before.cycles.filter(row => row.fields.session_owner === source.input.session_id && active.has(row.fields.state)
      || reported.includes(row.cycle_id) || row.cycle_id === before.state.active_cycle);
    if (relevant.length > 128 || reported.length > 128) fail("STANDARD_CYCLE_ENTRY_CHOICE_CAPACITY_EXCEEDED");
    const heads = readStandardCycleEntryChoiceBranchHeads(artifacts.root, relevant);
    const candidates = relevant.map(({ row, cycle_id, fields }) => ({ cycle_id, ...pin(row),
      state: fields.state, session_owner: fields.session_owner, branch_name: fields.branch_name,
      branch_head: heads.get(fields.branch_name) ?? null,
      dor_state: fields.dor_state, scope_frozen: fields.scope_frozen }));
    const subject = assertCycleEntryChoiceSubject({ contract_version: "standard-cycle-entry-choice-subject.v1",
      entry_operation_id: source.operation_id, entry_output_sha256: shadowHash(source.output),
      session_id: source.input.session_id, session_path: before.session.path,
      scope_sha256: shadowHash(before.scope), inventory_sha256: before.inventory_sha256,
      current_cycle_id: before.state.active_cycle === "none" ? null : before.state.active_cycle,
      current_branch: before.scope.branch, head: before.scope.head,
      reason_code: fresh.observations.reason_code, canonical: before.canonical,
      candidate_cycles: candidates, reported_cycles: reported,
      missing_reported_cycles: reported.filter(id => !candidates.some(row => row.cycle_id === id)),
      carry_over_pending: metadata.carry_over_pending === true || metadata.carry_over_pending === "yes" });
    const after = observe(source.input.session_id), afterFresh = await operations.observeCycleEntry(source.input);
    const afterHeads = readStandardCycleEntryChoiceBranchHeads(artifacts.root, relevant);
    current(instance, signal);
    if (shadowHash(after.scope) !== shadowHash(before.scope) || after.inventory_sha256 !== before.inventory_sha256
      || shadowHash(after.canonical) !== shadowHash(before.canonical) || shadowHash(afterFresh) !== shadowHash(fresh)
      || shadowHash([...afterHeads]) !== shadowHash([...heads]))
      fail("STANDARD_CYCLE_ENTRY_CHOICE_SOURCE_CHANGED");
    return { can_apply: true, subject };
  }
  return Object.freeze({ prepare,
    async assertFresh(instance, record, signal) {
      const prepared = await prepare(instance, record.preview.input, signal);
      if (shadowHash(prepared.subject) !== shadowHash(record.preview.prepared.subject))
        fail("STANDARD_CYCLE_ENTRY_CHOICE_SOURCE_CHANGED");
    } });
}
