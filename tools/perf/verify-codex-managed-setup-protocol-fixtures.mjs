import { runManagedSetupChannel } from '../../src/adapters/agents/codex-managed-setup-channel.mjs';
import assert from 'node:assert/strict';
import { createManagedSetupProtocol as create, stepManagedSetupProtocol as step } from '../../src/core/agents/codex-managed-setup-protocol.mjs';

const checks = [];
const test = (name, action) => { try { action(); checks.push({ name, status: 'PASS' }); } catch (error) { checks.push({ name, status: 'FAIL', detail: String(error.message).slice(0, 400) }); } };
const config = () => ({ operation_sha256: 'a'.repeat(64), client_sha256: 'b'.repeat(64), cwd: 'C:\\fixture\\travail été', expected_codex_home: 'C:\\fixture\\profil',
  limits: { initialize_timeout_ms: 1000, setup_timeout_ms: 8000, max_duration_ms: 10000, max_frame_bytes: 4096, max_total_bytes: 16384, max_frames: 8 } });
const init = overrides => ({ id: 'aidn.managed-setup.initialize.1', result: { codexHome: config().expected_codex_home, platformFamily: 'windows', platformOs: 'windows', userAgent: 'codex/0.158.0-alpha.2.1', ...overrides } });
const started = value => ({ id: 'aidn.managed-setup.start.1', result: { started: value } });
const completed = (success = true, error = null) => ({ method: 'windowsSandbox/setupCompleted', params: { mode: 'elevated', success, error } });
const send = (state, frame, at = 1) => step(state, { type: 'frame', json: JSON.stringify(frame) }, { at });
const open = (c = config()) => create(c, { at: 0 });
const initialized = c => send(open(c).state, init(), 1);
const running = c => send(initialized(c).state, started(true), 2);
const rejected = (result, code) => { assert.equal(result.state.reason_code, code); assert.notEqual(result.state.phase, 'completion_observed'); assert.equal(result.requested_frames.length, 0); assert.equal(result.execution_available, false); };
const throws = (action, code) => assert.throws(action, { code });
function frozen(value) { if (value && typeof value === 'object') { for (const child of Object.values(value)) frozen(child); Object.freeze(value); } return value; }
function noProof(result) {
  assert.equal(result.effect_class, 'model_only'); assert.equal(result.execution_available, false); assert.equal(result.operation_authorized, false);
  assert.equal(result.process_tree, 'NOT_OBSERVED'); assert.equal(result.state_stability, 'NOT_OBSERVED'); assert.equal(result.confinement, 'NOT_TESTED');
  assert.equal(result.executable_pins_verified, false); assert.equal(result.physical_roots_verified, false);
}

test('only-three-fixed-client-frames-and-explicit-cwd', () => {
  const start = open(); assert.deepEqual(start.requested_frames, [{ id: 'aidn.managed-setup.initialize.1', method: 'initialize', params: { clientInfo: { name: 'aidn_managed_setup_protocol', version: '0.1.0-preparation' } } }]);
  const next = send(start.state, init()); assert.deepEqual(next.requested_frames, [{ method: 'initialized' }, { id: 'aidn.managed-setup.start.1', method: 'windowsSandbox/setupStart', params: { mode: 'elevated', cwd: config().cwd } }]);
  assert.equal(next.state.requested_frames, 3); noProof(next);
});
test('normal-handshake-then-reported-success-never-native-proof', () => {
  const done = send(running().state, completed(), 3); assert.equal(done.state.phase, 'completion_observed'); assert.equal(done.state.reported_setup_result, 'succeeded'); assert.equal(done.state.reconciliation_required, true); noProof(done);
  const eof = step(done.state, { type: 'eof' }, { at: 20000 }); assert.equal(eof.state.stream_closed, true); assert.equal(eof.state.phase, 'completion_observed'); noProof(eof);
});
test('reported-setup-failure-and-error-content-redacted', () => {
  const done = send(running().state, completed(false, 'fixture-secret-should-not-appear'), 3);
  assert.equal(done.state.phase, 'completion_observed'); assert.equal(done.state.reported_setup_result, 'failed'); assert.equal(done.state.completion.error_present, true);
  assert.ok(!JSON.stringify(done).includes('fixture-secret')); noProof(done);
});
test('optional-completion-error-absent-is-official-valid-shape', () => {
  const frame = completed(); delete frame.params.error; assert.equal(send(running().state, frame, 3).state.reported_setup_result, 'succeeded');
});
test('one-early-completion-waits-for-started-ack', () => {
  const early = send(initialized().state, completed(), 2); assert.equal(early.state.phase, 'await_setup_response'); assert.equal(early.state.reported_setup_result, null); assert.equal(early.requested_frames.length, 0);
  const final = send(early.state, started(true), 3); assert.equal(final.state.phase, 'completion_observed'); noProof(final);
});
test('completion-before-setup-proposal-refused', () => rejected(send(open().state, completed()), 'PROTOCOL_NOTIFICATION_BEFORE_SETUP'));
test('duplicate-early-completion-refused', () => rejected(send(send(initialized().state, completed(), 2).state, completed(), 3), 'PROTOCOL_DUPLICATE_COMPLETION'));
test('late-duplicate-completion-invalidates-protocol', () => rejected(send(send(running().state, completed(), 3).state, completed(), 4), 'PROTOCOL_TRAILING_FRAME'));
test('early-completion-cannot-mask-started-false', () => { const r = send(send(initialized().state, completed(), 2).state, started(false), 3); rejected(r, 'PROTOCOL_SETUP_NOT_STARTED'); assert.equal(r.state.reported_setup_result, null); });
test('early-completion-cannot-mask-rpc-rejection', () => { const r = send(send(initialized().state, completed(), 2).state, { id: 'aidn.managed-setup.start.1', error: { code: -32600, message: 'private', data: { detail: 'private' } } }, 3); rejected(r, 'PROTOCOL_SETUP_REJECTED'); assert.equal(r.state.reported_setup_result, null); assert.equal(r.state.server_error_code, -32600); assert.ok(!JSON.stringify(r).includes('private')); });
test('initialize-rpc-rejection-never-proposes-setup', () => { const r = send(open().state, { id: 'aidn.managed-setup.initialize.1', error: { code: -1, message: 'private' } }); rejected(r, 'PROTOCOL_INITIALIZE_REJECTED'); assert.equal(r.state.setup_requested, false); });
test('rpc-message-plus-result-ambiguous-refused', () => rejected(send(open().state, { ...init(), error: { code: 1, message: '' } }), 'PROTOCOL_ERROR_RESPONSE_INVALID'));
test('setup-ack-before-initialize-refused', () => rejected(send(open().state, started(true)), 'PROTOCOL_RESPONSE_ID_MISMATCH'));
test('duplicate-started-ack-refused', () => rejected(send(running().state, started(true), 3), 'PROTOCOL_DUPLICATE_RESPONSE'));
test('duplicate-initialize-response-refused', () => rejected(send(initialized().state, init(), 2), 'PROTOCOL_RESPONSE_ID_MISMATCH'));
test('unrelated-server-request-cannot-create-outbound-reply', () => rejected(send(initialized().state, { id: 3, method: 'item/commandExecution/requestApproval', params: {} }, 2), 'PROTOCOL_SERVER_REQUEST_FORBIDDEN'));
test('unknown-notification-refused', () => rejected(send(initialized().state, { method: 'configWarning', params: { summary: 'private' } }, 2), 'PROTOCOL_UNEXPECTED_NOTIFICATION'));
for (const [name, change, reason] of [
  ['different-mode', f => { f.params.mode = 'unelevated'; }, 'PROTOCOL_COMPLETION_INVALID'],
  ['missing-success', f => { delete f.params.success; }, 'PROTOCOL_COMPLETION_INVALID'],
  ['string-success', f => { f.params.success = 'true'; }, 'PROTOCOL_COMPLETION_INVALID'],
  ['unknown-correlation-field', f => { f.params.runId = 'invented'; }, 'PROTOCOL_COMPLETION_INVALID'],
  ['success-with-error', f => { f.params.error = 'private'; }, 'PROTOCOL_COMPLETION_INCONSISTENT'],
]) test(`malformed-completion-${name}`, () => { const f = completed(); change(f); rejected(send(running().state, f, 3), reason); });
for (const [name, fields, reason] of [
  ['wrong-home', { codexHome: 'C:\\fixture\\another-profile' }, 'PROTOCOL_CODEX_HOME_MISMATCH'],
  ['wrong-family', { platformFamily: 'unix' }, 'PROTOCOL_INITIALIZE_RESULT_INVALID'],
  ['wrong-os', { platformOs: 'linux' }, 'PROTOCOL_INITIALIZE_RESULT_INVALID'],
  ['unknown-field', { worker: true }, 'PROTOCOL_INITIALIZE_RESULT_INVALID'],
]) test(`initialize-${name}`, () => rejected(send(open().state, init(fields)), reason));
test('case-only-home-spelling-compatible', () => assert.equal(send(open().state, init({ codexHome: config().expected_codex_home.toUpperCase() })).state.phase, 'await_setup_response'));
test('initialize-required-field-not-invented', () => { const f = init(); delete f.result.codexHome; rejected(send(open().state, f), 'PROTOCOL_INITIALIZE_RESULT_INVALID'); });
test('started-must-be-boolean', () => rejected(send(initialized().state, started('true'), 2), 'PROTOCOL_SETUP_RESULT_INVALID'));
test('eof-in-initialize-refuses-and-never-retries', () => { const r = step(open().state, { type: 'eof' }, { at: 1 }); rejected(r, 'PROTOCOL_EOF_BEFORE_COMPLETION'); assert.equal(r.state.stream_closed, true); rejected(send(r.state, init(), 2), 'PROTOCOL_TRAILING_FRAME'); });
test('eof-after-setup-remains-indeterminate', () => { const r = step(running().state, { type: 'eof' }, { at: 3 }); rejected(r, 'PROTOCOL_EOF_BEFORE_COMPLETION'); assert.equal(r.state.phase, 'indeterminate'); assert.equal(r.state.reconciliation_required, true); });
test('eof-with-early-completion-is-not-success', () => { const r = step(send(initialized().state, completed(), 2).state, { type: 'eof' }, { at: 3 }); rejected(r, 'PROTOCOL_EOF_BEFORE_COMPLETION'); assert.equal(r.state.reported_setup_result, null); });
test('initialize-exact-deadline-refused', () => rejected(send(open().state, init(), 1000), 'PROTOCOL_DEADLINE_EXCEEDED'));
test('setup-ack-does-not-extend-deadline', () => { const pending = send(initialized().state, started(true), 7999); assert.equal(pending.state.phase_deadline, 8001); rejected(send(pending.state, completed(), 8001), 'PROTOCOL_DEADLINE_EXCEEDED'); });
test('early-completion-does-not-extend-deadline', () => rejected(send(send(initialized().state, completed(), 2).state, started(true), 8001), 'PROTOCOL_DEADLINE_EXCEEDED'));
test('global-deadline-caps-setup-phase', () => { const c = config(); c.limits.max_duration_ms = 8000; const r = running(c); assert.equal(r.state.phase_deadline, 8000); rejected(step(r.state, { type: 'tick' }, { at: 8000 }), 'PROTOCOL_DEADLINE_EXCEEDED'); });
test('tick-is-pure-and-no-extra-frames', () => { const r = step(running().state, { type: 'tick' }, { at: 3 }); assert.equal(r.state.phase, 'await_setup_completion'); assert.deepEqual(r.requested_frames, []); });
test('abort-proposes-no-remote-cancel-method', () => rejected(step(running().state, { type: 'abort' }, { at: 3 }), 'PROTOCOL_ABORTED'));
test('implicit-missing-or-backwards-clock-refused', () => { throws(() => create(config()), 'PROTOCOL_CLOCK_INVALID'); throws(() => step(running().state, { type: 'tick' }, { at: 1 }), 'PROTOCOL_CLOCK_INVALID'); });
test('frame-utf8-byte-limit-is-not-js-character-count', () => { const c = config(); c.limits.max_frame_bytes = 512; const r = initialized(c); const f = completed(false, 'é'.repeat(250)); rejected(send(r.state, f, 2), 'PROTOCOL_FRAME_BYTE_LIMIT'); });
test('total-traffic-byte-limit-includes-requested-frames', () => { const c = config(); c.limits.max_frame_bytes = 1024; c.limits.max_total_bytes = 1024; rejected(send(running(c).state, completed(false, 'a'.repeat(700)), 3), 'PROTOCOL_TOTAL_BYTE_LIMIT'); });
test('large-frame-rejected-before-parsing', () => rejected(step(open().state, { type: 'frame', json: ' '.repeat(4097) }, { at: 1 }), 'PROTOCOL_FRAME_BYTE_LIMIT'));
for (const [name, json, reason] of [
  ['not-json', '{', 'PROTOCOL_JSON_INVALID'], ['batch', '[]', 'PROTOCOL_FRAME_INVALID'],
  ['two-documents', '{}{}', 'PROTOCOL_JSON_INVALID'], ['duplicate-key', '{"id":1,"id":2}', 'PROTOCOL_DUPLICATE_JSON_KEY'],
  ['escaped-duplicate-key', '{"id":1,"i\\u0064":2}', 'PROTOCOL_DUPLICATE_JSON_KEY'],
  ['nested-duplicate-key', '{"id":1,"result":{"x":0,"x":1}}', 'PROTOCOL_DUPLICATE_JSON_KEY'],
  ['lone-surrogate-value', '{"id":"\\ud800"}', 'PROTOCOL_UNICODE_INVALID'],
  ['depth', '['.repeat(14) + '0' + ']'.repeat(14), 'PROTOCOL_JSON_DEPTH_LIMIT'],
]) test(`json-${name}`, () => rejected(step(open().state, { type: 'frame', json }, { at: 1 }), reason));
for (const cwd of ['relative', 'C:relative', '\\\\host\\share', '\\\\?\\C:\\x', 'C:\\x\\..\\y', 'C:\\x\\AUX.txt', 'C:\\x\\foo.', 'C:\\x\\foo ', 'C:\\x\\a:stream', 'C:\\PROGRA~1\\x', 'C:/x/y']) {
  test(`cwd-refuses-${cwd}`, () => { const c = config(); c.cwd = cwd; throws(() => open(c), 'PROTOCOL_WINDOWS_PATH_INVALID'); });
}
test('configuration-no-free-method-or-model-or-worker', () => { const c = config(); c.method = 'turn/start'; throws(() => open(c), 'PROTOCOL_CONFIGURATION_INVALID'); });
test('configuration-limits-all-explicit-positive-bounded', () => { const c = config(); delete c.limits.max_frames; throws(() => open(c), 'PROTOCOL_LIMIT_INVALID'); const d = config(); d.limits.setup_timeout_ms = 0; throws(() => open(d), 'PROTOCOL_LIMIT_INVALID'); const e = config(); e.limits.max_frame_bytes = 65537; throws(() => open(e), 'PROTOCOL_LIMIT_INVALID'); });
test('state-configuration-change-detected', () => { const state = structuredClone(open().state); state.config.cwd = 'C:\\fixture\\foreign'; throws(() => send(state, init()), 'PROTOCOL_CONFIGURATION_CHANGED'); });
test('parent-phase-deadline-counter-or-pin-substitution-refused', () => {
  for (const mutation of [state => { state.phase_deadline++; }, state => { state.last_at++; }, state => { state.setup_started = false; }, state => { state.received_frames = 0; }, state => { state.completion = { success: true, error_present: false }; }]) {
    const state = structuredClone(running().state); mutation(state); throws(() => send(state, completed(), 3), 'PROTOCOL_PARENT_STATE_CHANGED');
  }
});
test('missing-parent-fingerprint-refused', () => { const state = structuredClone(open().state); delete state.state_sha256; throws(() => send(state, init()), 'PROTOCOL_PARENT_STATE_CHANGED'); });
test('frame-count-limit-is-explicit-and-not-less-than-success-path', () => { const c = config(); c.limits.max_frames = 2; throws(() => open(c), 'PROTOCOL_LIMIT_INVALID'); const d = config(); d.limits.max_frames = 3; assert.equal(send(running(d).state, completed(), 3).state.received_frames, 3); });
test('terminal-eof-is-idempotent-without-process-proof', () => { const done = send(running().state, completed(), 3); const first = step(done.state, { type: 'eof' }, { at: 4 }); const second = step(first.state, { type: 'eof' }, { at: 4 }); assert.deepEqual(second, first); noProof(second); });
test('unknown-event-cannot-propose-new-request', () => throws(() => step(open().state, { type: 'send', method: 'turn/start' }, { at: 1 }), 'PROTOCOL_EVENT_INVALID'));
test('material-configuration-changes-its-model-fingerprint', () => { const c = config(); c.operation_sha256 = 'c'.repeat(64); assert.notEqual(open(c).state.configuration_sha256, open().state.configuration_sha256); });
test('inputs-untouched-and-output-recursively-frozen', () => { const c = frozen(config()); const before = JSON.stringify(c); const s = open(c); const input = frozen({ type: 'frame', json: JSON.stringify(init()) }); const r = step(s.state, input, { at: 1 }); assert.equal(JSON.stringify(c), before); assert.equal(s.state.setup_requested, false); assert.ok(Object.isFrozen(r) && Object.isFrozen(r.state.config.limits) && Object.isFrozen(r.requested_frames[1].params)); });
test('accessor-input-cannot-cause-implicit-effects', () => { let accessed = false; const c = config(); Object.defineProperty(c, 'cwd', { enumerable: true, get() { accessed = true; throw Error('effect'); } }); throws(() => open(c), 'PROTOCOL_ACCESSOR_FORBIDDEN'); assert.equal(accessed, false); });
test('deterministic-with-clock-and-timer-sentinels', () => { const original = { Date: globalThis.Date, setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval, random: Math.random }; const forbidden = () => { throw Error('IMPLICIT_EFFECT'); }; try { globalThis.Date = class { constructor() { forbidden(); } static now() { forbidden(); } }; globalThis.setTimeout = forbidden; globalThis.setInterval = forbidden; Math.random = forbidden; assert.deepEqual(send(running().state, completed(), 3), send(running().state, completed(), 3)); } finally { globalThis.Date = original.Date; globalThis.setTimeout = original.setTimeout; globalThis.setInterval = original.setInterval; Math.random = original.random; } });


test('nonenumerable-event-accessor-refused-before-access', () => {
  let reads = 0; const event = {};
  Object.defineProperty(event, 'type', { get() { reads++; return 'tick'; } });
  throws(() => step(open().state, event, { at: 1 }), 'PROTOCOL_ACCESSOR_FORBIDDEN');
  assert.equal(reads, 0);
});
test('nonenumerable-toJSON-cannot-substitute-configuration', () => {
  let reads = 0; const c = config();
  Object.defineProperty(c, 'toJSON', { value() { reads++; return { ...c, cwd: 'C:\\fixture\\foreign' }; } });
  throws(() => open(c), 'PROTOCOL_JSON_PROPERTY_INVALID'); assert.equal(reads, 0);
});
test('json-property-names-must-be-well-formed-unicode', () => {
  rejected(step(open().state, { type: 'frame', json: '{"id":"aidn.managed-setup.initialize.1","error":{"code":1,"message":"","data":{"\\ud800":1}}}' }, { at: 1 }), 'PROTOCOL_UNICODE_INVALID');
});
test('unicode-uppercase-expansion-never-collides-home-pin', () => {
  const c = config(); c.expected_codex_home = 'C:\\fixture\\STRASSE';
  rejected(send(open(c).state, init({ codexHome: 'C:\\fixture\\Straße' })), 'PROTOCOL_CODEX_HOME_MISMATCH');
});
test('symbol-and-hidden-data-cannot-enter-model', () => {
  const c = config(); c[Symbol('private')] = 1; throws(() => open(c), 'PROTOCOL_UNICODE_INVALID');
  const event = { type: 'tick' }; Object.defineProperty(event, 'hidden', { value: true });
  throws(() => step(open().state, event, { at: 1 }), 'PROTOCOL_JSON_PROPERTY_INVALID');
});
test('sparse-arrays-in-json-configuration-refused', () => {
  const c = config(); c.extra = new Array(2); throws(() => open(c), 'PROTOCOL_JSON_PROPERTY_INVALID');
});

const wire = frame => new TextEncoder().encode(JSON.stringify(frame) + '\n');
const join = (...chunks) => {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
};
const deferred = () => {
  let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async (count = 120) => { for (let i = 0; i < count; i++) await Promise.resolve(); };
const confirmed = () => ({ termination: 'confirmed', evidence: { kind: 'controller', reference: 'fixture-job.receipt-1' } });
function harness(overrides = {}) {
  let at = 0, ended = false, pending = null;
  const queue = [], timers = new Set(), sent = [], events = [], stops = [];
  const h = {
    sent, events, stops, timers,
    push(bytes) { if (pending) { const next = pending; pending = null; next.resolve({ done: false, value: bytes }); } else queue.push(bytes); },
    close() { ended = true; if (pending) { pending.resolve({ done: true }); pending = null; } },
    advance(value) { at = value; for (const timer of [...timers]) if (timer.deadline <= at) timer.resolve(); },
  };
  const clock = {
    now: () => at,
    waitUntil(deadline, { signal }) {
      return new Promise((resolve, reject) => {
        const timer = { deadline, resolve: () => { cleanup(); resolve(); } };
        const abort = () => { cleanup(); reject(Error('aborted timer')); };
        const cleanup = () => { timers.delete(timer); signal.removeEventListener('abort', abort); };
        timers.add(timer); signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort(); else if (at >= deadline) timer.resolve();
      });
    },
  };
  const transport = {
    stdout: { [Symbol.asyncIterator]() { return { next() {
      if (queue.length) return Promise.resolve({ done: false, value: queue.shift() });
      if (ended) return Promise.resolve({ done: true });
      assert.equal(pending, null, 'iterator.next calls must not overlap');
      pending = deferred(); return pending.promise;
    } }; } },
    async send(bytes, { signal }) {
      assert.equal(signal.aborted, false); const frame = JSON.parse(new TextDecoder().decode(bytes));
      sent.push(frame);
      if (overrides.send) return overrides.send(frame, h, signal);
      if (frame.method === 'initialize') h.push(wire(init()));
      if (frame.method === 'windowsSandbox/setupStart') h.push(join(wire(started(true)), wire(completed())));
    },
    async requestStop(input) {
      assert.equal(input.signal.aborted, false, 'stop uses fresh signal'); stops.push(input);
      if (overrides.stop) return overrides.stop(input, h);
      h.close(); return confirmed();
    },
  };
  h.clock = clock; h.transport = transport;
  h.options = { transport, clock, limits: { max_stdout_bytes: 16384, stop_timeout_ms: 50 },
    onEvent: async event => { events.push(event); } };
  h.run = (c = config(), opts = {}) => runManagedSetupChannel(c, { ...h.options, ...opts });
  return h;
}
async function finish(promise) {
  let ready = false, value, error;
  promise.then(result => { ready = true; value = result; }, caught => { ready = true; error = caught; });
  for (let i = 0; i < 12000 && !ready; i++) await Promise.resolve();
  assert(ready, 'controlled fixture did not settle within its microtask bound');
  if (error) throw error;
  return value;
}
async function channelTest(name, action) {
  try { await action(); checks.push({ name: 'channel-' + name, status: 'PASS' }); }
  catch (error) { checks.push({ name: 'channel-' + name, status: 'FAIL', detail: String(error.stack ?? error).slice(0, 1200) }); }
}
function noNative(result) {
  assert.equal(result.native, false); assert.equal(result.execution_available, false); assert.equal(result.operation_authorized, false);
  assert.equal(result.state_stability, 'NOT_OBSERVED'); assert.equal(result.confinement, 'NOT_TESTED');
  assert(Object.isFrozen(result) && Object.isFrozen(result.protocol.config));
}

await channelTest('complete-duplex-and-controller-receipt-remain-separate', async () => {
  const h = harness(), r = await finish(h.run());
  assert.equal(r.outcome, 'completed'); assert.equal(r.reported_setup_result, 'succeeded');
  assert.equal(r.process_termination, 'confirmed'); assert.equal(r.stdout_eof, true);
  assert.equal(r.stop_evidence.reference, 'fixture-job.receipt-1');
  assert.equal(h.sent.length, 3); assert.equal(h.stops.length, 1); assert.equal(h.timers.size, 0);
  assert.deepEqual(h.events.map(event => event.sequence), [0, 1, 2, 3]);
  noNative(r);
});
await channelTest('utf8-split-at-every-byte-and-multiple-frames', async () => {
  const h = harness({ send(frame, fixture) {
    const data = frame.method === 'initialize' ? wire(init({ userAgent: 'codex-fixture-é-😀' }))
      : frame.method === 'windowsSandbox/setupStart' ? join(wire(started(true)), wire(completed(false, 'erreur-é-😀-fixture'))) : null;
    if (data) for (const byte of data) fixture.push(Uint8Array.of(byte));
  } });
  const r = await finish(h.run()); assert.equal(r.outcome, 'failed'); assert.equal(r.reported_setup_result, 'failed');
  assert.equal(r.protocol.completion.error_present, true); assert(!JSON.stringify(r).includes('erreur-é-😀-fixture')); noNative(r);
});
await channelTest('crlf-accepted-with-raw-byte-accounting', async () => {
  const h = harness({ send(frame, fixture) {
    const frames = frame.method === 'initialize' ? [init()]
      : frame.method === 'windowsSandbox/setupStart' ? [started(true), completed()] : [];
    for (const f of frames) fixture.push(new TextEncoder().encode(JSON.stringify(f) + '\r\n'));
  } });
  const r = await finish(h.run()); assert.equal(r.outcome, 'completed'); assert.equal(r.stdout_bytes, r.protocol.received_bytes);
});
await channelTest('send-backpressure-blocks-reading-and-next-writes', async () => {
  const held = deferred(), h = harness({ async send(frame, fixture) {
    if (frame.method === 'initialize') { fixture.push(wire(init())); await held.promise; }
    if (frame.method === 'windowsSandbox/setupStart') fixture.push(join(wire(started(true)), wire(completed())));
  } });
  const task = h.run(); await flush(); assert.equal(h.sent.length, 1); assert.equal(h.events.length, 1);
  held.resolve(); assert.equal((await finish(task)).outcome, 'completed');
});
await channelTest('callbacks-serialized-awaited-before-first-send', async () => {
  const held = deferred(), h = harness(); let active = 0, maximum = 0, calls = 0;
  const task = h.run(config(), { async onEvent() {
    active++; maximum = Math.max(maximum, active); calls++; if (calls === 1) await held.promise; active--;
  } });
  await flush(); assert.equal(h.sent.length, 0); assert.equal(calls, 1);
  held.resolve(); const r = await finish(task); assert.equal(r.outcome, 'completed'); assert.equal(maximum, 1);
});
await channelTest('callback-error-stops-and-suppresses-all-later-emissions', async () => {
  const h = harness(); let calls = 0;
  const r = await finish(h.run(config(), { onEvent() { if (++calls === 3) throw Error('private callback credential'); } }));
  assert.equal(r.reason_code, 'SETUP_CHANNEL_CALLBACK_FAILED'); assert.equal(h.stops.length, 1);
  assert.equal(calls, 3); await flush(); assert.equal(calls, 3); assert(!JSON.stringify(r).includes('credential'));
});
await channelTest('callback-error-without-tree-proof-remains-indeterminate', async () => {
  const h = harness({ stop(_, fixture) { fixture.close(); return { termination: 'unconfirmed' }; } });
  const r = await finish(h.run(config(), { onEvent() { throw Error('private'); } }));
  assert.equal(r.outcome, 'indeterminate'); assert.equal(r.process_termination, 'unconfirmed'); assert.equal(h.sent.length, 0);
});
await channelTest('caller-cancel-uses-fresh-stop-signal', async () => {
  const h = harness({ send() {} }), abort = new AbortController(), task = h.run(config(), { signal: abort.signal });
  await flush(); abort.abort(); const r = await finish(task);
  assert.equal(r.outcome, 'cancelled'); assert.equal(r.process_termination, 'confirmed');
  assert.notEqual(h.stops[0].signal, abort.signal); assert.equal(r.reason_code, 'SETUP_CHANNEL_CANCELLED');
});
await channelTest('already-cancelled-never-sends', async () => {
  const h = harness(), abort = new AbortController(); abort.abort();
  const r = await finish(h.run(config(), { signal: abort.signal })); assert.equal(r.outcome, 'cancelled');
  assert.equal(h.sent.length, 0); assert.equal(h.events.length, 0); assert.equal(h.stops.length, 1);
});
await channelTest('timeout-in-pending-read-then-confirmed-stop', async () => {
  const h = harness({ send() {} }), task = h.run();
  await flush(); h.advance(1000); const r = await finish(task);
  assert.equal(r.outcome, 'timed_out'); assert.equal(r.reason_code, 'SETUP_CHANNEL_TIMEOUT'); assert.equal(h.timers.size, 0);
});
await channelTest('pending-send-timeout-observes-late-rejection-without-events', async () => {
  const held = deferred(), h = harness({ send() { return held.promise; } }), task = h.run();
  await flush(); h.advance(1000); const r = await finish(task), calls = h.events.length;
  assert.equal(r.outcome, 'timed_out'); held.reject(Error('late private error')); await flush();
  assert.equal(h.events.length, calls); assert.equal(h.sent.length, 1);
});
await channelTest('pending-callback-timeout-never-starts-later-send-or-event', async () => {
  const held = deferred(), h = harness(); let calls = 0;
  const task = h.run(config(), { onEvent() { calls++; return held.promise; } });
  await flush(); h.advance(1000); const r = await finish(task);
  assert.equal(r.outcome, 'timed_out'); assert.equal(calls, 1); assert.equal(h.sent.length, 0);
  held.resolve(); await flush(); assert.equal(calls, 1); assert.equal(h.sent.length, 0);
});
await channelTest('stop-timeout-without-proof-is-indeterminate', async () => {
  const held = deferred(), h = harness({ stop(_, fixture) { fixture.close(); return held.promise; } }), task = h.run();
  await flush(400); assert.equal(h.stops.length, 1); h.advance(50);
  const r = await finish(task); assert.equal(r.outcome, 'indeterminate'); assert.equal(r.process_termination, 'unconfirmed');
  assert.equal(r.stop_reason_code, 'SETUP_CHANNEL_TIMEOUT'); held.resolve(confirmed()); await flush();
  assert.equal(r.process_termination, 'unconfirmed');
});
await channelTest('completion-and-eof-alone-do-not-confirm-tree-stop', async () => {
  const h = harness({ stop(_, fixture) { fixture.close(); return { termination: 'unconfirmed' }; } });
  const r = await finish(h.run()); assert.equal(r.reported_setup_result, 'succeeded');
  assert.equal(r.outcome, 'indeterminate'); assert.equal(r.process_termination, 'unconfirmed');
});
for (const receipt of [true, { termination: 'confirmed' }, { termination: 'confirmed', evidence: { kind: 'controller', reference: '../foreign' } }]) {
  await channelTest('malformed-controller-receipt-' + JSON.stringify(receipt), async () => {
    const h = harness({ stop(_, fixture) { fixture.close(); return receipt; } }), r = await finish(h.run());
    assert.equal(r.process_termination, 'unconfirmed'); assert.equal(r.outcome, 'indeterminate');
    assert.equal(r.stop_reason_code, 'SETUP_CHANNEL_STOP_EVIDENCE_INVALID');
  });
}
await channelTest('eof-before-setup-completion-cannot-be-success', async () => {
  const h = harness({ send(frame, fixture) {
    if (frame.method === 'initialize') fixture.push(wire(init()));
    if (frame.method === 'windowsSandbox/setupStart') { fixture.push(wire(started(true))); fixture.close(); }
  } });
  const r = await finish(h.run()); assert.equal(r.outcome, 'indeterminate'); assert.equal(r.reason_code, 'PROTOCOL_EOF_BEFORE_COMPLETION');
});
for (const [name, bytes, expected] of [
  ['bad-continuation', Uint8Array.of(0xc3, 0x28, 10), 'SETUP_CHANNEL_UTF8_INVALID'],
  ['unfinished-codepoint', Uint8Array.of(0xc3), 'SETUP_CHANNEL_UTF8_INVALID'],
  ['unterminated-jsonl', new TextEncoder().encode('{"id":1}'), 'SETUP_CHANNEL_TRUNCATED_FRAME'],
  ['empty-chunk', new Uint8Array(), 'SETUP_CHANNEL_CHUNK_INVALID'],
  ['non-byte-chunk', 'private text', 'SETUP_CHANNEL_CHUNK_INVALID'],
  ['utf8-bom', join(Uint8Array.of(0xef, 0xbb, 0xbf), wire(init())), 'PROTOCOL_JSON_INVALID'],
]) await channelTest(name, async () => {
  const h = harness({ send(frame, fixture) { if (frame.method === 'initialize') { fixture.push(bytes); fixture.close(); } } });
  const r = await finish(h.run()); assert.equal(r.reason_code, expected); assert.notEqual(r.outcome, 'completed');
});
await channelTest('large-stdout-rejected-before-parsing', async () => {
  const h = harness({ send(frame, fixture) { if (frame.method === 'initialize') fixture.push(new Uint8Array(100)); } });
  const r = await finish(h.run(config(), { limits: { max_stdout_bytes: 99, stop_timeout_ms: 50 } }));
  assert.equal(r.reason_code, 'SETUP_CHANNEL_STDOUT_BYTE_LIMIT'); assert.equal(r.stdout_bytes, 100);
});
await channelTest('cumulative-stdout-includes-partial-frames', async () => {
  const h = harness({ send(frame, fixture) { if (frame.method === 'initialize') { fixture.push(new Uint8Array(60).fill(32)); fixture.push(new Uint8Array(60).fill(32)); } } });
  const r = await finish(h.run(config(), { limits: { max_stdout_bytes: 100, stop_timeout_ms: 50 } }));
  assert.equal(r.reason_code, 'SETUP_CHANNEL_STDOUT_BYTE_LIMIT'); assert.equal(r.stdout_bytes, 120);
});
await channelTest('bounded-line-before-json-parsing', async () => {
  const h = harness({ send(frame, fixture) { if (frame.method === 'initialize') fixture.push(new Uint8Array(4096).fill(32)); } });
  const r = await finish(h.run()); assert.equal(r.reason_code, 'SETUP_CHANNEL_FRAME_BYTE_LIMIT');
});
await channelTest('duplex-total-budget-counts-inbound-and-outbound', async () => {
  const h = harness({ send(frame, fixture) { if (frame.method === 'initialize') fixture.push(wire(init({ userAgent: 'x'.repeat(650) }))); } });
  const c = config(); c.limits.max_total_bytes = 1024; c.limits.max_frame_bytes = 1024;
  const r = await finish(h.run(c, { limits: { max_stdout_bytes: 1024, stop_timeout_ms: 50 } }));
  assert.equal(r.reason_code, 'PROTOCOL_OUTBOUND_LIMIT'); assert.equal(h.sent.length, 1);
});
await channelTest('duplicate-after-completion-in-same-chunk-is-refused', async () => {
  const h = harness({ send(frame, fixture) {
    if (frame.method === 'initialize') fixture.push(wire(init()));
    if (frame.method === 'windowsSandbox/setupStart') fixture.push(join(wire(started(true)), wire(completed()), wire(completed())));
  } });
  const r = await finish(h.run()); assert.equal(r.outcome, 'indeterminate'); assert.equal(r.reason_code, 'PROTOCOL_TRAILING_FRAME');
});
await channelTest('duplicate-after-completion-during-stop-drain-is-refused', async () => {
  const h = harness({ stop(_, fixture) { fixture.push(wire(completed())); fixture.close(); return confirmed(); } });
  const r = await finish(h.run()); assert.equal(r.outcome, 'indeterminate'); assert.equal(r.reason_code, 'PROTOCOL_TRAILING_FRAME');
  assert.equal(h.events.length, 4);
});
await channelTest('unknown-notification-never-creates-a-free-response', async () => {
  const h = harness({ send(frame, fixture) {
    if (frame.method === 'initialize') fixture.push(wire({ method: 'foreign', params: {} }));
  } });
  const r = await finish(h.run()); assert.equal(r.reason_code, 'PROTOCOL_NOTIFICATION_BEFORE_SETUP'); assert.equal(h.sent.length, 1);
});
await channelTest('read-and-send-errors-redacted', async () => {
  const h = harness({ send() { throw Error('private-secret-value'); } });
  const r = await finish(h.run()); assert.equal(r.reason_code, 'SETUP_CHANNEL_SEND_FAILED');
  assert(!JSON.stringify(r).includes('private-secret'));
  const h2 = harness(); h2.transport.stdout = { [Symbol.asyncIterator]() { return { next() { throw Error('private-secret-read'); } }; } };
  const r2 = await finish(h2.run()); assert.equal(r2.reason_code, 'SETUP_CHANNEL_READ_FAILED');
  assert(!JSON.stringify(r2).includes('private-secret'));
});
await channelTest('dependencies-required-before-any-send', async () => {
  const h = harness();
  await assert.rejects(h.run(config(), { clock: undefined }), { code: 'SETUP_CHANNEL_CLOCK_REQUIRED' });
  await assert.rejects(h.run(config(), { limits: undefined }), { code: 'SETUP_CHANNEL_LIMIT_INVALID' });
  await assert.rejects(h.run(config(), { transport: {} }), { code: 'SETUP_CHANNEL_TRANSPORT_INVALID' });
  assert.equal(h.sent.length, 0); assert.equal(h.stops.length, 0);
});
await channelTest('caller-mutation-cannot-replace-pinned-config-after-start', async () => {
  const held = deferred(), c = config(), h = harness();
  const task = h.run(c, { onEvent: () => held.promise }); c.cwd = 'C:\\fixture\\foreign'; held.resolve();
  const r = await finish(task); assert.equal(r.outcome, 'completed');
  assert.equal(h.sent[2].params.cwd, config().cwd);
});
await channelTest('no-ambient-clock-or-timers-with-injected-transport', async () => {
  const old = { Date: globalThis.Date, setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval };
  const forbidden = () => { throw Error('IMPLICIT_CLOCK'); };
  try {
    globalThis.Date = class { constructor() { forbidden(); } static now() { forbidden(); } };
    globalThis.setTimeout = forbidden; globalThis.setInterval = forbidden;
    assert.equal((await finish(harness().run())).outcome, 'completed');
  } finally { Object.assign(globalThis, old); }
});


await channelTest('late-send-rejection-keeps-a-full-fresh-stop-budget', async () => {
  const held = deferred(), h = harness({
    send(_, fixture) { fixture.advance(200); throw Error('late send'); },
    stop(_, fixture) { fixture.close(); return held.promise; },
  });
  const task = h.run(); await flush(); assert.equal(h.stops.length, 1);
  h.advance(249); await flush(); held.resolve(confirmed());
  const r = await finish(task); assert.equal(r.process_termination, 'confirmed');
  assert.equal(r.reason_code, 'SETUP_CHANNEL_SEND_FAILED'); assert.equal(r.stop_reason_code, null);
});
await channelTest('invalid-clock-after-send-cannot-suppress-stop-request', async () => {
  const h = harness({ send() { throw Error('send failed'); } });
  let calls = 0; const now = h.clock.now;
  h.clock.now = () => ++calls >= 4 ? -1 : now();
  const r = await finish(h.run()); assert.equal(h.stops.length, 1);
  assert.equal(r.outcome, 'indeterminate'); assert.equal(r.process_termination, 'unconfirmed');
});
await channelTest('clock-wait-cannot-resolve-before-explicit-deadline', async () => {
  const h = harness(); h.clock.waitUntil = () => Promise.resolve();
  const r = await finish(h.run()); assert.equal(h.stops.length, 1);
  assert.equal(r.reason_code, 'SETUP_CHANNEL_CLOCK_EARLY_TIMEOUT'); assert.notEqual(r.outcome, 'completed');
});
await channelTest('foreign-callback-code-is-not-a-diagnostic-channel', async () => {
  const h = harness(), r = await finish(h.run(config(), {
    onEvent() { throw Object.assign(Error('private'), { code: 'SETUP_CHANNEL_private_secret' }); },
  }));
  assert.equal(r.reason_code, 'SETUP_CHANNEL_CALLBACK_FAILED');
  assert(!JSON.stringify(r).includes('private_secret'));
});
await channelTest('foreign-iterator-error-code-is-redacted', async () => {
  const h = harness();
  h.transport.stdout = { [Symbol.asyncIterator]() { throw { code: 'SETUP_CHANNEL_private_secret' }; } };
  const r = await finish(h.run()); assert.equal(h.stops.length, 1);
  assert.equal(r.reason_code, 'SETUP_CHANNEL_INTERNAL_ERROR'); assert(!JSON.stringify(r).includes('private_secret'));
});
await channelTest('confirmed-tree-with-stalled-stdout-is-still-indeterminate', async () => {
  const h = harness({ stop() { return confirmed(); } }), task = h.run();
  await flush(400); h.advance(50); const r = await finish(task);
  assert.equal(r.process_termination, 'confirmed'); assert.equal(r.stdout_eof, false);
  assert.equal(r.outcome, 'indeterminate'); assert.equal(r.stop_reason_code, 'SETUP_CHANNEL_TIMEOUT');
});
await channelTest('truncated-trailing-data-during-stop-invalidates-result', async () => {
  const h = harness({ stop(_, fixture) { fixture.push(new TextEncoder().encode('{')); fixture.close(); return confirmed(); } });
  const r = await finish(h.run()); assert.equal(r.outcome, 'indeterminate');
  assert.equal(r.reason_code, 'SETUP_CHANNEL_TRUNCATED_FRAME'); assert.equal(r.process_termination, 'confirmed');
});
await channelTest('stop-error-is-redacted-and-never-confirmed', async () => {
  const h = harness({ stop(_, fixture) { fixture.close(); throw Error('private stop message'); } });
  const r = await finish(h.run()); assert.equal(r.outcome, 'indeterminate');
  assert.equal(r.stop_reason_code, 'SETUP_CHANNEL_STOP_FAILED'); assert(!JSON.stringify(r).includes('private stop'));
});
await channelTest('early-completion-in-same-read-waits-for-start-ack', async () => {
  const h = harness({ send(frame, fixture) {
    if (frame.method === 'initialize') fixture.push(wire(init()));
    if (frame.method === 'windowsSandbox/setupStart') fixture.push(join(wire(completed()), wire(started(true))));
  } });
  const r = await finish(h.run()); assert.equal(r.outcome, 'completed');
  assert.equal(h.events[2].phase, 'await_setup_response'); assert.equal(h.events[2].reported_setup_result, null);
});
await channelTest('setup-deadline-is-not-extended-by-ack', async () => {
  const h = harness({ send(frame, fixture) {
    if (frame.method === 'initialize') fixture.push(wire(init()));
    if (frame.method === 'windowsSandbox/setupStart') fixture.push(wire(started(true)));
  } });
  const task = h.run(); await flush(300); h.advance(8000);
  const r = await finish(task); assert.equal(r.outcome, 'timed_out'); assert.equal(r.protocol.phase_deadline, 8000);
});
await channelTest('callback-await-complete-before-result-and-no-late-emission', async () => {
  const held = deferred(), h = harness(); let calls = 0, settled = false;
  const task = h.run(config(), { async onEvent(event) { calls++; if (event.phase === 'completion_observed') await held.promise; } });
  task.then(() => { settled = true; }); await flush(400); assert.equal(settled, false); assert.equal(calls, 4);
  held.resolve(); const r = await finish(task); assert.equal(r.outcome, 'completed');
  await flush(); assert.equal(calls, 4); assert.equal(h.stops.length, 1);
});
await channelTest('import-and-doubles-require-no-write-network-or-process', async () => {
  const fs = (await import('node:fs')).default, cp = (await import('node:child_process')).default;
  const net = (await import('node:net')).default, { syncBuiltinESMExports } = await import('node:module');
  const saved = [], blocked = () => { throw Error('FORBIDDEN_NATIVE_OR_WRITE_EFFECT'); };
  for (const [object, names] of [[fs, ['writeFileSync', 'writeFile', 'appendFileSync', 'appendFile', 'mkdirSync', 'mkdir', 'unlinkSync', 'unlink', 'rmSync', 'rm', 'renameSync', 'rename', 'copyFileSync']],
    [fs.promises, ['writeFile', 'appendFile', 'mkdir', 'unlink', 'rm', 'rename', 'copyFile']],
    [cp, ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']],
    [net, ['connect', 'createConnection', 'createServer']], [globalThis, ['fetch']]]) {
    for (const name of names) { saved.push([object, name, object[name]]); object[name] = blocked; }
  }
  syncBuiltinESMExports();
  try {
    const model = await import('../../src/core/agents/codex-managed-setup-protocol.mjs?fixture-purity');
    const adapter = await import('../../src/adapters/agents/codex-managed-setup-channel.mjs?fixture-purity');
    assert.equal(model.createManagedSetupProtocol(config(), { at: 0 }).execution_available, false);
    const h = harness(); assert.equal((await finish(adapter.runManagedSetupChannel(config(), h.options))).outcome, 'completed');
  } finally { for (const [object, name, original] of saved) object[name] = original; syncBuiltinESMExports(); }
});


await channelTest('stop-rejection-cannot-start-an-iterator-read-after-settlement', async () => {
  const held = deferred(), h = harness({ send() { throw Error('send failure'); }, stop() { return held.promise; } });
  let reads = 0, lateReads = 0, settled = false;
  h.transport.stdout = { [Symbol.asyncIterator]() { return { next() {
    reads++; if (settled) lateReads++;
    return Promise.resolve(reads === 1 ? { done: false, value: new Uint8Array(500).fill(10) } : { done: true });
  } }; } };
  const task = h.run();
  for (let i = 0; i < 500 && reads === 0; i++) await Promise.resolve();
  assert.equal(reads, 1); await flush(20); held.reject(Error('stop failure'));
  const r = await finish(task); settled = true; const readsAtSettlement = reads;
  await flush(1600); assert.equal(lateReads, 0); assert.equal(reads, readsAtSettlement);
  assert.equal(r.stop_reason_code, 'SETUP_CHANNEL_STOP_FAILED'); assert.equal(h.stops.length, 1);
});
await channelTest('deadline-crossed-in-timer-microtask-prevents-action', async () => {
  const h = harness(); let callbacks = 0;
  h.clock.waitUntil = deadline => { h.advance(deadline); return Promise.resolve(); };
  const r = await finish(h.run(config(), { onEvent() { callbacks++; } }));
  assert.equal(h.sent.length, 0); assert.equal(callbacks, 0); assert.equal(h.stops.length, 1);
  assert.equal(r.reason_code, 'SETUP_CHANNEL_TIMEOUT'); assert.equal(r.outcome, 'indeterminate');
});

const failed = checks.filter(check => check.status === 'FAIL');
process.stdout.write(`${JSON.stringify({ status: failed.length ? 'FAIL' : 'PASS', checks, pass: checks.length - failed.length, fail: failed.length, setup_execution: 'NOT_EXECUTED', codex_execution: 'NOT_EXECUTED', filesystem_effects_by_protocol: 'NONE', cleanup: { status: 'PASS', created_resources: 0 }, native_qualification: 'NOT_RUN', authorization: 'NOT_GRANTED' }, null, 2)}\n`);
if (failed.length) process.exitCode = 1;
