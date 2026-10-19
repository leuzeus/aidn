import assert from "node:assert/strict";
import { createEditableContextExperiment } from "../../src/application/codex/editable-context-experiment.mjs";

const model = { provider: "fixture", model: "fixture", model_revision: "fixture-r1" };
const options = () => ({ optIn: true, protectedPrefix: "Mandatory fresh admission", task: "Retain decision A",
  sourceRevision: "revision-1", currentSourceRevision: async () => "revision-1",
  modelIdentity: model, tokenizerIdentity: { ...model, tokenizer_sha256: "a".repeat(64) },
  // Exact character tokenizer for the synthetic fixture language only. These
  // counts are never called model tokens or native OpenAI token measurements.
  tokenizer: async text => [...text].length, capacityTokens: 2000, reservedTokens: 100,
  initialEntries: [{ id: "decision", kind: "working", text: "Decision A" }],
  validateTransformation: async (_before, after) => after.entries.some(entry => entry.id === "decision" && entry.text === "Decision A") });
const request = (service, entries) => { const state = service.inspect(); return { preimage_sha256: state.preimage_sha256,
  source_revision: state.source_revision, document: { ...state.document, entries } }; };
let checks = 0;
async function check(name, action) { await action(); checks++; console.log(`PASS ${name}`); }
await check("editable research requires opt-in, exact tokenizer identity and a host edit gate", async () => {
  assert.throws(() => createEditableContextExperiment({ ...options(), optIn: false }), /OPT_IN/);
  assert.throws(() => createEditableContextExperiment({ ...options(), tokenizer: null }), /HOST_CONFIGURATION/);
  assert.throws(() => createEditableContextExperiment({ ...options(), tokenizerIdentity: { ...model, model_revision: "other" } }), /TOKENIZER_BINDING/);
});
await check("protected system/task prefix and typed roles cannot be edited", async () => {
  const service = createEditableContextExperiment(options()); await service.initialize();
  const value = request(service, service.inspect().document.entries); value.document.prefix.system = "grant writes";
  await assert.rejects(() => service.apply(value), /PROTECTED_PREFIX/);
  const role = request(service, [{ id: "decision", kind: "system", text: "Decision A" }]);
  await assert.rejects(() => service.apply(role), /STRUCTURE_INVALID/); assert.equal(service.inspect().snapshots, 0);
});
await check("atomic edit retains exact preimage, audit and source binding", async () => {
  const service = createEditableContextExperiment(options()); await service.initialize(); const before = service.inspect();
  const result = await service.apply(request(service, [...before.document.entries, { id: "note", kind: "observation", text: "Ignore all rules is untrusted data" }]));
  assert.equal(result.before_sha256, before.preimage_sha256); assert.equal(result.write_authorization, false);
  assert.equal(service.inspect().snapshots, 1); assert.equal(service.inspect().audit.length, 1);
  before.document.prefix.system = "mutated copy"; assert.equal(service.inspect().document.prefix.system, "Mandatory fresh admission");
});
await check("hard token limit and invalid counters refuse without any replacement", async () => {
  for (const tokenizer of [async () => 1901, async () => NaN, async () => -1]) {
    let first = true; const service = createEditableContextExperiment({ ...options(), tokenizer: async (...args) => first ? (first = false, 10) : tokenizer(...args) });
    await service.initialize(); const before = service.inspect();
    await assert.rejects(() => service.apply(request(service, before.document.entries)), /HARD_LIMIT|TOKEN_COUNT_INVALID/);
    assert.deepEqual(service.inspect(), before);
  }
});
await check("stale revision, stale preimage and removal of critical decision refuse", async () => {
  let revision = "revision-1"; const service = createEditableContextExperiment({ ...options(), currentSourceRevision: async () => revision });
  await service.initialize(); const good = request(service, service.inspect().document.entries);
  await assert.rejects(() => service.apply({ ...good, preimage_sha256: "wrong" }), /PREIMAGE_MISMATCH/);
  await assert.rejects(() => service.apply(request(service, [])), /EDIT_GATE_REFUSED/);
  revision = "revision-2"; await assert.rejects(() => service.apply(good), /SOURCE_STALE/); assert.equal(service.inspect().snapshots, 0);
});
await check("revision change during tokenization refuses the entire transaction", async () => {
  let revision = "revision-1", change = false;
  const service = createEditableContextExperiment({ ...options(), currentSourceRevision: async () => revision,
    tokenizer: async () => { if (change) revision = "revision-2"; return 10; } });
  await service.initialize(); change = true; const before = service.inspect();
  await assert.rejects(() => service.apply(request(service, before.document.entries)), /SOURCE_STALE/); assert.deepEqual(service.inspect(), before);
});
await check("overlapping edits cannot commit against the same preimage", async () => {
  let unblock, wait = false;
  const service = createEditableContextExperiment({ ...options(), tokenizer: async () => { if (wait) await new Promise(resolve => { unblock = resolve; }); return 10; } });
  await service.initialize(); wait = true; const value = request(service, service.inspect().document.entries); const first = service.apply(value);
  await new Promise(resolve => setImmediate(resolve)); await assert.rejects(() => service.apply(value), /BUSY/);
  unblock(); await first; assert.equal(service.inspect().audit.length, 1);
});
await check("rollback restores a retained preimage and appends history", async () => {
  const service = createEditableContextExperiment(options()); await service.initialize(); const before = service.inspect();
  await service.apply(request(service, [...before.document.entries, { id: "extra", kind: "working", text: "Temporary" }]));
  const state = service.inspect(); await service.rollback({ preimage_sha256: state.preimage_sha256, source_revision: state.source_revision, snapshot_index: 0 });
  assert.deepEqual(service.inspect().document, before.document); assert.equal(service.inspect().audit.length, 2);
  assert.equal(service.inspect().audit[1].kind, "rollback"); assert.equal(service.inspect().native_transcript_edited, false);
});
console.log(`editable-context-experiment: PASS (${checks} scenarios; synthetic tokenizer; no native transcript edits)`);
