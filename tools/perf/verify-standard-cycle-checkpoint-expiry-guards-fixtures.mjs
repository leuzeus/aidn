import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStandardCycleCheckpoint } from "../../src/application/runtime/standard-cycle-checkpoint.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

// Isolate the pre-owner guard. Full three-mode application/continuation proof
// belongs to verify-standard-cycle-expired-prefix-fixtures --expire-checkpoint.
const H = "a".repeat(64), preparedAt = 1000000;
const plan = { contract_version: "standard-cycle-checkpoint-plan.v1", operation_ref: "cycle_checkpoint_finalize",
  input: { session_id: "S001", cycle_id: "C001" }, prepared_at_ms: preparedAt,
  scope: { project: {}, persistence: {}, branch: "S001-C001", head: "a".repeat(40) },
  mode: "COMMITTING", hook_mode: "COMMITTING", dor_ready: true,
  documents: Array.from({ length: 15 }, (_, index) => ({ path: `document-${index}.md`, sha256: H, metadata_sha256: null })),
  event_log: { bytes: 0, sha256: H }, effects: ["checkpoint", "runtime_index", "checkpoint_events"] };
const prepared = { can_apply: true, plan, plan_sha256: shadowHash(plan) };
export async function verifyStandardCycleCheckpointExpiryGuards() {
let checks = 0;
const pass = message => { checks++; console.log("PASS checkpoint expiry guard: " + message); };
const explicit = { write: true, expectPlan: prepared.plan_sha256, assertAuthorized: async () => {}, assertCurrent: async () => {} };
function adapter(age) {
  const state = { owners: 0, callbacks: 0 };
  const unexpected = () => { state.callbacks++; throw Error("FIXTURE_UNEXPECTED_ADMISSION_OR_EFFECT"); };
  const checkpoint = createStandardCycleCheckpoint({ now: () => preparedAt + age, scope: unexpected, session: unexpected, audit: unexpected,
    artifacts: { root: ".", withLocalEffectOwner: async (id, run) => {
      state.owners++; assert.equal(id, prepared.plan_sha256);
      throw Object.assign(Error("FIXTURE_OWNER_BOUNDARY"), { code: "FIXTURE_OWNER_BOUNDARY" });
    } } });
  return { state, checkpoint };
}
async function refuses(name, age, value = prepared, options = explicit, code = "STANDARD_CYCLE_CHECKPOINT_EXPLICIT_EFFECT_REQUIRED") {
  const { state, checkpoint } = adapter(age);
  await assert.rejects(checkpoint.finalizeCycleCheckpoint(value, options), error => error.code === code && error.effect_status === "no_effect");
  assert.deepEqual(state, { owners: 0, callbacks: 0 }); pass(name);
}
await refuses("otherwise valid expired intent is typed no-effect before owner acquisition", 300001, prepared, explicit, "STANDARD_PLAN_EXPIRED");
for (const [name, options] of [
  ["missing write", { ...explicit, write: false }], ["nonboolean write", { ...explicit, write: "true" }],
  ["wrong expected hash", { ...explicit, expectPlan: H }], ["missing expected hash", { ...explicit, expectPlan: undefined }],
  ["missing authorization callback", { ...explicit, assertAuthorized: undefined }], ["missing current callback", { ...explicit, assertCurrent: undefined }],
]) await refuses(name + " remains an explicit-effect refusal even when expired", 300001, prepared, options);
await refuses("negative admission remains an explicit-effect refusal even when expired", 300001, { ...prepared, can_apply: false });
await refuses("mismatched prepared hash is never expiry", 300001, { ...prepared, plan_sha256: H });
await refuses("modified signed plan is never expiry", 300001, { ...prepared, plan: { ...plan, dor_ready: false } });
for (const age of [-1, Number.NaN, Number.POSITIVE_INFINITY, 0.5, Number.MAX_SAFE_INTEGER + 1])
  await refuses("invalid or future clock " + String(age) + " never becomes expiry", age);
await refuses("malformed plan preserves its validation refusal and no-effect status", 300001, { ...prepared, plan: {} }, explicit, "STANDARD_CYCLE_CHECKPOINT_PLAN_INVALID");
for (const age of [0, 300000]) {
  const { state, checkpoint } = adapter(age);
  await assert.rejects(checkpoint.finalizeCycleCheckpoint(prepared, explicit), { code: "FIXTURE_OWNER_BOUNDARY" });
  assert.deepEqual(state, { owners: 1, callbacks: 0 }); pass("valid age " + age + " reaches owner boundary without granting an effect");
}
return checks;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checks = await verifyStandardCycleCheckpointExpiryGuards();
  console.log(JSON.stringify({ status: "PASS", checks, scope: "checkpoint-pre-owner-guards", application: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
}
