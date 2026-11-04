import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
import { createGithubReviewFixture } from './github-review-evidence-fixture-lib.mjs';
import { createStandardWorkflowOperationHost } from '../../src/application/runtime/standard-workflow-operation-host.mjs';
import { createStandardSessionPrReviewContentObservation } from '../../src/application/runtime/standard-session-pr-review-observe.mjs';
import { createStandardPrReviewControlSource } from '../../src/application/runtime/standard-session-pr-review-control-source.mjs';
import { createStandardPrReviewReceiver } from '../../src/application/runtime/standard-session-pr-review-receive.mjs';
import { assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { createProcessControlInboxStore } from '../../src/adapters/runtime/process-control-inbox-store.mjs';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { assertControlInbox, assertControlReviewPayload, controlInboxPath } from '../../src/core/workflow/process-control-inbox.mjs';
import { simulateAgenticProcess } from '../../src/core/workflow/agentic-process-simulation.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
import { getDatabaseSync } from '../../src/lib/sqlite/workflow-db-schema-lib.mjs';
import { resolveRuntimeSqliteFile } from '../../src/application/runtime/runtime-persistence-service.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';

const H = 'a'.repeat(64), updateId = 'op_' + 'a'.repeat(40), here = fileURLToPath(import.meta.url);
const model = { contract_version: 'agentic-process-model.v2', model_id: 'pr-content-control-component', revision: 1,
  participants: [{ id: 'project' }], roles: [], policies: [], operation_pins: {}, entry: 'wait', nodes: [
    { id: 'wait', kind: 'event', participant_ref: 'project', branches: [
      { flow_id: 'review', node_id: 'reviewed', event_key: 'review_snapshot' }, { flow_id: 'checks', node_id: 'checked', event_key: 'checks_snapshot' }] },
    ...['reviewed', 'checked'].map(id => ({ id, kind: 'sequence', participant_ref: 'project', children: [] }))] };
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
const stateFile = root => path.join(root, 'event.json');
function open(root, privateRoot) {
  const initial = JSON.parse(fs.readFileSync(stateFile(privateRoot), 'utf8'));
  const provider = createGithubReviewFixture({ workingDirectory: privateRoot, pullRequest: initial.pull_request });
  let host;
  const observer = createStandardSessionPrReviewContentObservation({ readCurrent: id => host.inspect(id).record, reviewPort: provider.port,
    readConfirmedHead: async () => ({ update_operation_id: updateId, session_id: 'S001', head: initial.pull_request.head_oid,
      material_sha256: H, pull_request: initial.pull_request }) });
  const source = createStandardPrReviewControlSource({ observer,
    now: () => Date.now() + (JSON.parse(fs.readFileSync(stateFile(privateRoot), 'utf8')).clock_offset ?? 0),
    readEvent: async () => JSON.parse(fs.readFileSync(stateFile(privateRoot), 'utf8')).event,
    verifyEvent: async ({ event }) => {
      const current = JSON.parse(fs.readFileSync(stateFile(privateRoot), 'utf8'));
      return { outcome: current.authorized && shadowHash(current.event) === shadowHash(event) ? 'verified' : 'denied',
        current: current.current, authority_id: event.authority_id, event_sha256: shadowHash(event),
        subject_sha256: current.wrong_actor ? H : shadowHash(event.actor) };
    },
    readContext: async ({ request }) => ({ instance: host.inspect(request.instance_id).record,
      request_sha256: shadowHash(host.prepareControl({ instanceId: request.instance_id, expectedSha256: request.instance_sha256, occurrenceId: request.occurrence_id })),
      input: { contract_version: 'standard-session-pr-review-observe-input.v1', update_operation_id: updateId } }),
  });
  host = createStandardWorkflowOperationHost({ targetRoot: root, model, controlSource: source,
    readSigningKey: () => fs.readFileSync(path.join(privateRoot, 'host.key')),
    authorize: async () => ({ authorized: true, authority_id: 'fixture_operator', principal_sha256: H, grant_sha256: H }) });
  return { host, provider, source, observer };
}
if (process.argv[2] === '--deliver') {
  const { host, provider } = open(process.argv[3], process.argv[4]);
  const result = await host.deliverControl(process.argv[5], { write: true });
  console.log(JSON.stringify({ instance_sha256: result.record.instance_sha256, retained: result.retained ?? false, provider_calls: provider.calls.length }));
} else {
  const parent = fs.realpathSync(os.tmpdir()), owned = []; let checks = 0;
  const test = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };
  const selected = process.argv.find(arg => arg.startsWith('--mode='))?.slice(7);
  if (selected && !['files', 'dual', 'db-only'].includes(selected)) throw Error('FIXTURE_MODE_INVALID');
  try {
    await test('explicit v2 inbox, event and payload schemas use only supported contract keywords', () => {
      for (const name of ['process-control-inbox.v2', 'github-pr-review-event.v1', 'process-pr-review-payload.v1']) {
        const schema = JSON.parse(fs.readFileSync(new URL('../../src/core/contracts/workflow-definition/' + name + '.schema.json', import.meta.url)));
        assert.deepEqual(validateJsonSchemaDefinition(schema, '#', { contractKind: 'workflow-definition' }), []);
      }
    });
    for (const mode of selected ? [selected] : ['files', 'dual', 'db-only']) {
      const root = createStandardWorkflowFixture(mode, owned), privateRoot = fs.mkdtempSync(path.join(parent, 'aidn-standard-pr-control-')); owned.push(privateRoot);
      fs.writeFileSync(path.join(privateRoot, 'host.key'), randomBytes(32));
      const p = { repository_id: 'R_fixture', node_id: 'PR_fixture', number: 7, head_oid: git(root, 'rev-parse', 'HEAD'), base_oid: 'b'.repeat(40),
        head_branch: git(root, 'branch', '--show-current'), base_branch: 'main', state: 'OPEN', draft: false };
      const state = { pull_request: p, event: null, authorized: true, current: true };
      const persist = () => fs.writeFileSync(stateFile(privateRoot), JSON.stringify(state)); persist();
      const { host, provider, source, observer } = open(root, privateRoot);
      const initial = host.initialize({ instanceId: 'waiting' }); host.initialize({ instanceId: 'waiting', write: true, expectedResultSha256: initial.record.instance_sha256 });
      const before = host.inspect('waiting'), frame = before.cursor.occurrences.find(row => row.wait_reason === 'event');
      const input = { instanceId: 'waiting', expectedSha256: before.record.instance_sha256, occurrenceId: frame.occurrence_id };
      const request = host.prepareControl(input), capture = () => host.captureControl({ ...input, captureKind: 'pr-review-content', sourceRef: 'fixture:event', write: true });
      const event = { contract_version: 'github-pr-review-event.v1', authority_id: 'fixture_provider', source_event_id: 'fixture-event-1',
        repository_id: p.repository_id, pull_request_id: p.node_id, pull_request_number: p.number, head_oid: p.head_oid, base_oid: p.base_oid,
        head_ref: p.head_branch, base_ref: p.base_branch, event_key: 'review_snapshot', revision: 'provider-revision-1',
        occurred_at: new Date().toISOString(), actor: { node_id: 'U_fixture', login: 'fixture-reviewer', type: 'User' } };
      await test(mode + ': missing event waits with no provider calls or model allocation', async () => {
        assert.equal((await capture()).status, 'waiting_for_control'); assert.equal(provider.calls.length, 0);
        assert.equal(host.inspect('waiting').record.instance_sha256, before.record.instance_sha256);
      });
      state.event = event; persist();
      await test(mode + ': denied actor, non-current revision, stale event and foreign PR/base/repository refuse without delivery', async () => {
        for (const [key, value] of [['authorized', false], ['current', false], ['wrong_actor', true]]) {
          state[key] = value; persist(); await assert.rejects(capture(), { code: 'PROCESS_CONTROL_PR_NOT_AUTHENTICATED' });
          if (key === 'wrong_actor') delete state[key]; else state[key] = true;
        }
        for (const [key, value] of [['occurred_at', new Date(Date.now() - 300001).toISOString()], ['repository_id', 'R_other'],
          ['pull_request_id', 'PR_other'], ['base_oid', 'c'.repeat(40)], ['head_oid', 'c'.repeat(40)], ['head_ref', 'other']]) {
          const old = event[key]; event[key] = value; persist(); await assert.rejects(capture()); event[key] = old;
        }
        persist(); assert.equal(host.inspect('waiting').record.instance_sha256, before.record.instance_sha256);
      });
      let reserved;
      await test(mode + ': complete authenticated event and content are durable before reducer event or acknowledgement', async () => {
        reserved = await capture(); assert.equal(reserved.status, 'reserved');
        const retained = host.readControl(reserved.inbox_id); assertControlInbox(retained);
        assert.equal(retained.contract_version, 'process-control-inbox.v2'); assert.equal(retained.phase, 'reserved');
        assert.deepEqual(retained.payload.event, event); assert.equal(retained.payload.observation.observations.evidence.reviews[0].body_chunks.join(''), 'Complete fixture review evidence.');
        assertControlReviewPayload(retained.payload, retained.source, request);
        assert.equal(host.inspect('waiting').record.events.length, 0);
        const bad = structuredClone(retained); bad.payload.observation.observations.evidence.reviews[0].body_chunks = ['tampered'];
        assert.throws(() => assertControlInbox(bad));
        const old = structuredClone(retained); old.contract_version = 'process-control-inbox.v1'; assert.throws(() => assertControlInbox(old));
      });
      await test(mode + ': same-head content changes and source revision changes cannot deliver a retained payload', async () => {
        provider.state.reviews[0].body = 'Changed at the same provider timestamp.';
        await assert.rejects(host.deliverControl(reserved.inbox_id, { write: true }), { code: 'PROCESS_CONTROL_PR_COLLECTION_CHANGED' });
        provider.state.reviews[0].body = 'Complete fixture review evidence.';
        event.revision = 'provider-revision-2'; persist(); await assert.rejects(host.deliverControl(reserved.inbox_id, { write: true }), { code: 'PROCESS_CONTROL_PR_EVENT_CHANGED' });
        event.revision = 'provider-revision-1'; persist(); assert.equal(host.inspect('waiting').record.events.length, 0);
      });
      await test(mode + ': conflicting duplicates cannot replace the reserved payload or deliver twice', async () => {
        const beforePayload = shadowHash(host.readControl(reserved.inbox_id));
        await assert.rejects(capture(), { code: 'PROCESS_CONTROL_SOURCE_ALREADY_USED' });
        assert.equal(shadowHash(host.readControl(reserved.inbox_id)), beforePayload);
      });
      await test(mode + ': new stale captures refuse while a retained event still requires current identity and fresh content after a simulated long wait', async () => {
        state.clock_offset = 300001; persist();
        await assert.rejects(capture(), { code: 'PROCESS_CONTROL_PR_EVENT_STALE' });
        const retained = host.readControl(reserved.inbox_id);
        const source = createStandardPrReviewControlSource({ observer: { observe: async () => retained.payload.observation },
          now: () => Date.now() + 300001, readEvent: async () => event,
          verifyEvent: async () => ({ outcome: 'verified', current: true, authority_id: event.authority_id,
            event_sha256: shadowHash(event), subject_sha256: shadowHash(event.actor) }),
          readContext: async () => ({ instance: host.inspect('waiting').record, request_sha256: shadowHash(request), input: {} }) });
        assert.equal((await source.verifyReview({ source: retained.source, payload: retained.payload, request, sourceRef: 'fixture:event' })).outcome, 'verified');
        // Actual host delivery below uses a fresh real application observation;
        // this isolated assertion exercises only the retained-event age policy.
      });
      if (mode === 'db-only') {
        await test(mode + ': lost acknowledgement retains the canonical event and full payload for source-free repair', async () => {
          const DatabaseSync = getDatabaseSync(), db = new DatabaseSync(resolveRuntimeSqliteFile({ targetRoot: root }));
          try { db.exec(`CREATE TRIGGER fixture_pr_ack BEFORE INSERT ON artifacts WHEN NEW.path = '${controlInboxPath(reserved.inbox_id)}' AND json_extract(NEW.content, '$.phase') = 'delivered' BEGIN SELECT RAISE(ABORT, 'fixture ack failure'); END`); } finally { db.close(); }
          await assert.rejects(host.deliverControl(reserved.inbox_id, { write: true }));
          assert.equal(host.inspect('waiting').record.events.length, 1); assert.equal(host.readControl(reserved.inbox_id).phase, 'reserved');
          const repair = new DatabaseSync(resolveRuntimeSqliteFile({ targetRoot: root })); try { repair.exec('DROP TRIGGER fixture_pr_ack'); } finally { repair.close(); }
        });
      }
      await test(mode + ': cold-process delivery and exact replay/simulation retain full evidence without repeated accepted events', async () => {
        if (mode === 'db-only') { state.event = null; persist(); }
        const child = JSON.parse(execFileSync(process.execPath, [here, '--deliver', root, privateRoot, reserved.inbox_id],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 180000 }));
        if (mode === 'db-only') assert.equal(child.provider_calls, 0); else assert.ok(child.provider_calls > 0);
        state.event = null; persist();
        const { host: reopened, provider: freshProvider } = open(root, privateRoot), again = await reopened.deliverControl(reserved.inbox_id, { write: true });
        assert.equal(again.retained, true); assert.equal(again.record.instance_sha256, child.instance_sha256); assert.equal(freshProvider.calls.length, 0);
        const saved = reopened.readControl(reserved.inbox_id); assert.equal(saved.phase, 'delivered'); assert.equal(saved.payload.event.revision, 'provider-revision-1');
        const replay = simulateAgenticProcess({ instanceId: again.record.instance_id, model: again.record.model, scopeId: again.record.scope_id,
          policyPins: again.record.policy_pins, events: again.record.events });
        assert.equal(replay.trace.at(-1).instance_sha256, again.record.instance_sha256); assert.equal(again.record.events.length, 1);
        const store = createProcessControlInboxStore({ targetRoot: root, stateMode: mode });
        assert.equal(shadowHash(store.read(saved.inbox_id).record.payload), shadowHash(saved.payload));
        createOperationJournalSigner(() => fs.readFileSync(path.join(privateRoot, 'host.key'))).verify(saved);
        assert.equal(fs.existsSync(path.join(root, 'docs/audit', controlInboxPath(saved.inbox_id))), mode !== 'db-only');
      });
      await test(mode + ': receiver consumes the exact durable payload with fresh event authentication and complete content', async () => {
        state.event = event; persist();
        const receivedInput = { contract_version: 'standard-session-pr-review-receive-input.v1', update_operation_id: updateId };
        const receiver = createStandardPrReviewReceiver({ observer, verifyEvent: source.verifyCapturedEvent,
          readDelivered(_instance, input) {
            const capture = host.readControl(reserved.inbox_id);
            assert.equal(capture.phase, 'delivered');
            assert.equal(input.update_operation_id, capture.payload.observation.observations.update_operation_id);
            return capture;
          } });
        const instance = host.inspect('waiting').record, received = await receiver.observe(instance, receivedInput);
        assert.equal(received.outcome, 'completed', JSON.stringify(received));
        assert.deepEqual(received.observations.payload, host.readControl(reserved.inbox_id).payload);
        assert.deepEqual(received.facts, { session_pr_review_event_received: true, session_pr_triage_required: true });
        assert.equal(received.observations.merge_authorization, 'not-established');
        assert.throws(() => assertStandardOperationOutput({ ...received, outcome: 'blocked' }));
        assert.throws(() => assertStandardOperationOutput({ ...received, facts: {} }));
        provider.state.reviews[0].body = 'A same-head edit must invalidate consumption.';
        const changed = await receiver.observe(instance, receivedInput); assert.equal(changed.outcome, 'blocked'); assert.deepEqual(changed.facts, {});
        provider.state.reviews[0].body = 'Complete fixture review evidence.';
        event.revision = 'changed-after-delivery'; persist();
        const revised = await receiver.observe(instance, receivedInput); assert.equal(revised.outcome, 'blocked'); assert.deepEqual(revised.facts, {});
        event.revision = 'provider-revision-1'; persist();
        const stop = new AbortController(); stop.abort();
        const cancelled = await receiver.observe(instance, receivedInput, { signal: stop.signal });
        assert.equal(cancelled.outcome, 'blocked'); assert.equal(cancelled.observations.reason_code, 'STANDARD_PR_RECEIVE_ABORTED');
        assert.equal(host.inspect('waiting').record.events.length, 1);
      });
    }
    console.log(JSON.stringify({ status: 'PASS', checks, provider_and_event_identity: 'fixture-capabilities', accepted_update_authority: 'fixture',
      storage_and_host: 'actual-files-SQLite-CAS-and-common-service', models: 0, ordinary_standard_route: 'NOT_RUN', triage: 'NOT_RUN', native: 'NOT_RUN', installed_archive: 'NOT_RUN' }));
  } finally {
    for (const root of owned.reverse()) { const actual = fs.realpathSync(root); assert.equal(path.dirname(actual), parent); assert.ok(path.basename(actual).startsWith('aidn-standard-')); fs.rmSync(actual, { recursive: true, force: true }); }
    console.log(JSON.stringify({ cleanup: 'PASS', roots: owned.length }));
  }
}
