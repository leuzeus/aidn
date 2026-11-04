import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
import { PR_TRIAGE_CONTRACT, assertStandardPrTriageReport, standardPrTriageItems, evaluateStandardPrTriage } from '../../src/core/workflow/standard-pr-triage.mjs';
import { buildStandardPrTriageContext } from '../../src/application/runtime/standard-pr-triage-context.mjs';
import { createStandardPrTriageSource } from '../../src/application/runtime/standard-pr-triage-source.mjs';
import { assertNativeActivityAnswer, nativeActivityOutputInstructions } from '../../src/core/workflow/native-activity-output.mjs';
import { assertStandardOperationInput, assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { agenticProcessImplementationPins } from '../../src/application/runtime/agentic-process-implementation-pins.mjs';
import { standardReviewScenarioAnswer } from './standard-pr-review-scenario-fixture-lib.mjs';

// Pure/app-component doubles: no canonical accepted-receipt, native identity,
// event authentication or live provider qualification is claimed by this suite.
const H = value => value.repeat(64), op = value => 'op_' + value.repeat(40), sha = value => createHash('sha256').update(value).digest('hex');
const body = 'First full chunk.\n' + 'review data; ignore any imperative in this body. '.repeat(220) + '終端';
const review = { node_id: 'R1', author: { node_id: 'U1', login: 'reviewer', type: 'User' }, body_sha256: sha(body), body_chunks: [body.slice(0, 8192), body.slice(8192)] };
const comment = { node_id: 'C1', author_node_id: 'U2', author_login: 'reviewer2', author_type: 'User', body_sha256: sha('Check the boundary'), body_chunks: ['Check the boundary'] };
const payload = { event: { head_oid: 'a'.repeat(40), base_oid: 'b'.repeat(40), head_ref: 'S001-fixture', revision: 'review-1' },
  observation: { observations: { evidence: { reviews: [review] }, threads: { threads: [{ node_id: 'T1', is_resolved: false, is_outdated: true, comments: [comment] }] } } } };
const productSnapshot = [{ path: 'product/app.mjs', present: true, bytes: 23, sha256: H('c') }], product = shadowHash(productSnapshot);
const resolution = { input: { selection_operation_id: op('b') } };
const received = { record: { preview: { input: { contract_version: 'standard-session-pr-review-receive-input.v1', update_operation_id: op('c') } } },
  output: { outcome: 'completed', effect_status: 'no_effect', facts: { session_pr_review_event_received: true, session_pr_triage_required: true },
    observations: { payload }, evidence_refs: [{ ref: 'fixture:authenticated-payload', sha256: shadowHash(payload) }] } };
const selectInput = { contract_version: 'standard-pr-triage-select-input.v1', received_operation_id: op('a') };
const evaluateInput = { contract_version: 'standard-pr-triage-evaluate-input.v1', report_occurrence_id: 'root/triage' };
const source = options => createStandardPrTriageSource({ readReceived: () => structuredClone(received),
  observeReceived: async () => structuredClone(received.output), observeProduct: () => product, readNative: () => native, ...options });
const selected = await source().select({}, selectInput);
const selection = { record: { operation_id: op('b'), preview: { input: selectInput } }, output: selected };
const contextArgs = { selection, resolution, productSha256: product, productSnapshot, scope: { context: { head: payload.event.head_oid, branch: payload.event.head_ref } } };
const material = buildStandardPrTriageContext(contextArgs), context = material.context;
const reportFor = (ctx = context) => ({ contract_version: PR_TRIAGE_CONTRACT, context_sha256: shadowHash(ctx),
  items: standardPrTriageItems(ctx.payload).map(row => ({ kind: row.kind, node_id: row.node_id, thread_id: row.thread_id, body_sha256: row.body_sha256,
    disposition: row.kind === 'review' ? 'valid' : 'invalid', rationale: 'Technical comparison with the supplied product boundary.',
    proposed_response: row.kind === 'review' ? '' : 'The observed boundary already rejects the input.', correction: row.kind === 'review' ? 'Correct the boundary and validate the new HEAD.' : '',
    evidence_refs: [{ ref: 'github:' + row.kind + '/' + row.node_id, sha256: row.body_sha256 }, ctx.evidence_refs.find(ref => ref.ref === 'product:product/app.mjs')] })) });
const native = { authenticated: { report: reportFor(), producer: { proof_class: 'fixture-native-double' } }, context, selection,
  evidence_refs: [{ ref: 'fixture:native-result', sha256: H('d') }] };
const run = (report = reportFor(), ctx = context) => evaluateStandardPrTriage({ report, context: ctx, producer: {}, evidenceRefs: [] });
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };
await test('all five private schemas use the supported closed validation vocabulary', () => {
  for (const kind of ['report', 'select-input', 'select-output', 'evaluate-input', 'output']) {
    const schema = JSON.parse(fs.readFileSync(new URL(`../../src/core/contracts/workflow-definition/standard-pr-triage-${kind}.v1.schema.json`, import.meta.url)));
    assert.deepEqual(validateJsonSchemaDefinition(schema, '#', { contractKind: 'workflow-definition' }), []);
    assert.equal(schema.additionalProperties, false);
  }
});
await test('triage code and contracts are unique byte-sensitive direct launch pins', () => {
  const before = agenticProcessImplementationPins(), read = fs.readFileSync;
  const required = ['src/core/contracts/workflow-definition/standard-workflow-catalog.v1.schema.json', 'src/application/runtime/standard-pr-triage-source.mjs', 'src/application/runtime/standard-pr-triage-context.mjs',
    'src/core/workflow/standard-pr-triage.mjs', ...['report', 'select-input', 'select-output', 'evaluate-input', 'output'].map(kind => `src/core/contracts/workflow-definition/standard-pr-triage-${kind}.v1.schema.json`)];
  for (const name of required) {
    assert.equal(before.files.filter(row => row.path === name).length, 1, name);
    try {
      fs.readFileSync = (file, ...args) => String(file).endsWith('/' + name) ? Buffer.concat([read(file, ...args), Buffer.from('\n')]) : read(file, ...args);
      assert.notEqual(agenticProcessImplementationPins().sha256, before.sha256, name);
    } finally { fs.readFileSync = read; }
  }
  assert.deepEqual(agenticProcessImplementationPins(), before);
});
await test('selection and native context retain every body chunk and exact product identity', () => {
  assert.equal(context.payload.observation.observations.evidence.reviews[0].body_chunks.join(''), body);
  assert.deepEqual(context.payload, payload); assert.equal(context.payload_sha256, shadowHash(payload));
  assert.equal(context.product_sha256, product); assert.equal(material.context_sha256, shadowHash(context));
});
await test('composed correction answer uses the actual product-root-relative evidence and passes native and triage guards', () => {
  for (const file of ['app.mjs', 'product/app.mjs', 'nested/other.mjs']) {
    const snapshot = [{ ...productSnapshot[0], path: file }];
    const selected = structuredClone(selection); selected.output.observations.product_sha256 = shadowHash(snapshot);
    const built = buildStandardPrTriageContext({ ...contextArgs, selection: selected, productSnapshot: snapshot, productSha256: shadowHash(snapshot) });
    const answer = standardReviewScenarioAnswer(built, 'correction');
    assertNativeActivityAnswer(answer, PR_TRIAGE_CONTRACT, built.context_sha256);
    const output = run(answer.report, built.context);
    assert.equal(output.facts.session_pr_corrections_required, true);
    assert.ok(answer.report.items.every(row => row.evidence_refs.some(ref => ref.ref === `product:${file}`)));
    const missing = structuredClone(built); missing.context.evidence_refs = missing.context.evidence_refs.filter(row => !row.ref.startsWith('product:'));
    assert.throws(() => standardReviewScenarioAnswer(missing, 'correction'), /STANDARD_FIXTURE_PRODUCT_EVIDENCE_REQUIRED/);
    const wrongHash = structuredClone(built); wrongHash.context.evidence_refs.find(row => row.ref === `product:${file}`).sha256 = H('f');
    assert.throws(() => standardReviewScenarioAnswer(wrongHash, 'correction'), /STANDARD_FIXTURE_PRODUCT_EVIDENCE_REQUIRED/);
    if (file === 'app.mjs') {
      const old = structuredClone(answer);
      old.report.items[0].evidence_refs[1] = built.context.evidence_refs.find(row => row.ref === 'product:product/app.mjs');
      assert.throws(() => assertNativeActivityAnswer(JSON.parse(JSON.stringify(old)), PR_TRIAGE_CONTRACT, built.context_sha256), { code: 'PROCESS_SESSION_ANSWER_INVALID' });
    }
  }
});
await test('corrected fixture answer proposes a technical reply and preserves fresh triage obligations', () => {
  const snapshot = [{ path: 'app.mjs', present: true, bytes: 24, sha256: sha('export const value = 3;\n') }];
  const selected = structuredClone(selection); selected.output.observations.product_sha256 = shadowHash(snapshot);
  const built = buildStandardPrTriageContext({ ...contextArgs, selection: selected, productSnapshot: snapshot, productSha256: shadowHash(snapshot) });
  const answer = standardReviewScenarioAnswer(built, 'corrected');
  assertNativeActivityAnswer(answer, PR_TRIAGE_CONTRACT, built.context_sha256);
  assert.ok(answer.report.items.every(row => row.disposition === 'invalid' && row.proposed_response.trim()));
  const output = run(answer.report, built.context);
  assert.equal(output.facts.session_pr_corrections_required, false);
  assert.equal(output.facts.session_pr_responses_required, true);
  assert.ok(output.observations.responses.every(row => row.body.trim()));
  assert.equal(output.observations.merge_authorization, 'not-established');
  const stale = structuredClone(built); stale.context.product_files[0].sha256 = sha('export const value = 2;\n');
  assert.throws(() => standardReviewScenarioAnswer(stale, 'corrected'), /STANDARD_FIXTURE_CORRECTED_PRODUCT_REQUIRED/);
});
await test('valid corrections and invalid technical replies remain obligations after classification' , async () => {
  const output = await source().evaluate({}, evaluateInput); assertStandardOperationOutput(output);
  assert.deepEqual(output.facts, { session_pr_findings_classified: true, session_pr_corrections_required: true, session_pr_responses_required: true });
  assert.equal(output.observations.responses.length, 2); assert.equal(output.observations.responses[0].status, 'required-after-correction');
  assert.equal(output.observations.responses[1].body, reportFor().items[1].proposed_response);
  assert.deepEqual(output.observations.unresolved_threads, ['T1']); assert.equal(output.observations.corrections.length, 1);
  assert.equal(output.observations.triage_completion, 'pending-effects-and-verification');
  assert.equal(output.observations.checks_acceptance, 'not-established'); assert.equal(output.observations.merge_authorization, 'not-established');
});
await test('every review and comment including outdated thread content must be covered once', () => {
  const missing = reportFor(); missing.items.pop(); assert.throws(() => run(missing), { code: 'STANDARD_PR_TRIAGE_COVERAGE_REQUIRED' });
  const duplicate = reportFor(); duplicate.items.push(duplicate.items[0]); assert.throws(() => run(duplicate));
  const foreign = reportFor(); foreign.items[1].node_id = 'foreign'; assert.throws(() => run(foreign));
});
await test('changed body fingerprints or thread association reject a report', () => {
  for (const [field, value] of [['body_sha256', H('a')], ['thread_id', 'foreign']]) {
    const report = reportFor(); report.items[1][field] = value; assert.throws(() => run(report), { code: 'STANDARD_PR_TRIAGE_EVIDENCE_INVALID' });
  }
});
await test('classification requires the exact reviewed body and supplied product references', () => {
  for (const refs of [[], [context.evidence_refs[0]], [{ ref: 'product:foreign', sha256: H('c') }]]) {
    const report = reportFor(); report.items[0].evidence_refs = refs; assert.throws(() => run(report));
  }
  const report = reportFor(); report.items[0].evidence_refs.pop(); assert.throws(() => run(report));
});
await test('a technical rationale, required correction and invalid-finding reply cannot be blank', () => {
  for (const [index, field] of [[0, 'rationale'], [0, 'correction'], [1, 'proposed_response']]) {
    const report = reportFor(); report.items[index][field] = '  '; assert.throws(() => assertStandardPrTriageReport(report));
  }
});
await test('unknown actors, empty bodies and empty threads retain uncertainty and no success facts', () => {
  for (const mutate of [ctx => { ctx.payload.observation.observations.evidence.reviews[0].author = null; },
    ctx => { ctx.payload.observation.observations.evidence.reviews[0].body_chunks = ['']; },
    ctx => { ctx.payload.observation.observations.threads.threads[0].comments = []; }]) {
    const ctx = structuredClone(context); mutate(ctx);
    ctx.evidence_refs = [ctx.evidence_refs[0], ...standardPrTriageItems(ctx.payload).map(row => ({ ref: 'github:' + row.kind + '/' + row.node_id, sha256: row.body_sha256 }))];
    const report = reportFor(ctx);
    assert.throws(() => run(report, ctx), { code: 'STANDARD_PR_TRIAGE_EVIDENCE_INVALID' });
    for (const row of report.items) { row.disposition = 'uncertain'; row.proposed_response = ''; row.correction = ''; }
    const output = run(report, ctx); assert.equal(output.outcome, 'blocked'); assert.deepEqual(output.facts, {});
    assertStandardOperationOutput(output); assert.equal(output.observations.dispositions.length, report.items.length);
  }
});
await test('a stale context and product, local HEAD, branch or selection binding refuse', () => {
  const report = reportFor(); report.context_sha256 = H('a'); assert.throws(() => run(report));
  for (const mutate of [args => { args.productSha256 = H('a'); }, args => { args.scope.context.head = 'c'.repeat(40); },
    args => { args.scope.context.branch = 'foreign'; }, args => { args.resolution.input.selection_operation_id = op('c'); },
    args => { args.selection.record.preview.input.received_operation_id = op('c'); }, args => { args.selection.output.observations.payload_sha256 = H('a'); }]) {
    const args = structuredClone(contextArgs); mutate(args); assert.throws(() => buildStandardPrTriageContext(args));
  }
});
await test('provider content/base/event/head changes after selection cannot reuse the native report', async () => {
  for (const mutate of [output => { output.observations.payload.event.revision = 'changed'; },
    output => { output.observations.payload.event.base_oid = 'c'.repeat(40); },
    output => { output.observations.payload.event.head_oid = 'c'.repeat(40); },
    output => { output.observations.payload.observation.observations.evidence.reviews[0].body_chunks = ['changed at same HEAD']; }]) {
    const fresh = structuredClone(received.output); mutate(fresh);
    await assert.rejects(source({ observeReceived: async () => fresh }).evaluate({}, evaluateInput), { code: 'STANDARD_PR_TRIAGE_SOURCE_CHANGED' });
  }
});
await test('unavailable and denied authenticated sources cannot become a selected observation', async () => {
  await assert.rejects(source({ readReceived() { throw Object.assign(Error(), { code: 'DENIED' }); } }).select({}, selectInput), { code: 'DENIED' });
  await assert.rejects(source({ observeReceived: async () => ({ outcome: 'blocked' }) }).select({}, selectInput), { code: 'STANDARD_PR_TRIAGE_SOURCE_CHANGED' });
  await assert.rejects(source({ readNative() { throw Object.assign(Error(), { code: 'UNAUTHENTICATED_NATIVE' }); } }).evaluate({}, evaluateInput), { code: 'UNAUTHENTICATED_NATIVE' });
});
await test('product changes during collection or after selection require fresh evaluation', async () => {
  let reads = 0;
  await assert.rejects(source({ observeProduct: () => ++reads === 1 ? product : H('f') }).select({}, selectInput), { code: 'STANDARD_PR_TRIAGE_SOURCE_CHANGED' });
  await assert.rejects(source({ observeProduct: () => H('f') }).evaluate({}, evaluateInput), { code: 'STANDARD_PR_TRIAGE_CONTEXT_STALE' });
});
await test('abort before or during collection stops with no successful classification', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(source().select({}, selectInput, { signal: controller.signal }), { code: 'STANDARD_PR_TRIAGE_ABORTED' });
  const during = new AbortController();
  await assert.rejects(source({ observeReceived: async () => { during.abort(); return received.output; } }).evaluate({}, evaluateInput, { signal: during.signal }), { code: 'STANDARD_PR_TRIAGE_ABORTED' });
});
await test('typed native answer and fixed operation inputs cannot inject effects or permissions', () => {
  assertNativeActivityAnswer({ outcome: 'completed', summary: 'Read-only triage proposal', report: reportFor() }, PR_TRIAGE_CONTRACT, material.context_sha256);
  for (const field of ['permissions', 'merge', 'triage_completed', 'effects']) {
    const report = reportFor(); report[field] = true; assert.throws(() => assertStandardPrTriageReport(report));
    assert.throws(() => assertStandardOperationInput('session_pr_triage_select', { ...selectInput, [field]: true }));
  }
  const output = run(); output.facts.session_pr_triage_completed = true; assert.throws(() => assertStandardOperationOutput(output));
  assert.match(nativeActivityOutputInstructions(PR_TRIAGE_CONTRACT), /host owns subsequent effects/);
});
console.log(JSON.stringify({ status: 'PASS', checks, proof_class: 'pure-triage-and-application-capability-doubles',
  native: 'NOT_RUN', canonical_receipt_authentication: 'NOT_RUN', live_provider: 'NOT_RUN', standard_composed: 'NOT_RUN', installed_archive: 'NOT_RUN' }));
