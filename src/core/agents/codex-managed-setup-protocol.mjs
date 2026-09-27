/**
 * PREPARATION ONLY. Pure protocol model; no transport, process, filesystem,
 * implicit clock, authorization or native execution exists in this module.
 * Reference: Codex 0.158.0-alpha.2.1 generated schemas already cached locally:
 * v1/InitializeParams, v1/InitializeResponse, v2/WindowsSandboxSetupStartParams,
 * v2/WindowsSandboxSetupStartResponse, v2/WindowsSandboxSetupCompletedNotification.
 * https://learn.chatgpt.com/docs/app-server#initialization
 * The initialization response is checked against the pinned expected home and
 * Windows target. Physical roots and executable pins still require broker proof.
 * Input frame.json is ONE complete JSON document, already bounded/framed by a
 * future broker; the module is not a UTF-8 stream framer. max_frames bounds
 * received documents; max_total_bytes covers both proposed and received JSONL.
 * State/configuration hashes detect accidental substitution, not authorization.
 * Completion has no request/run id in the official schema: this model requires
 * an exclusive fresh channel, one setup only, and buffers at most one early
 * completion AFTER requesting setupStart. It never invents server correlation.
 */
import { createHash } from 'node:crypto';

const VERSION = 'aidn-managed-setup-protocol-state.v1';
const INITIALIZE_ID = 'aidn.managed-setup.initialize.1';
const SETUP_ID = 'aidn.managed-setup.start.1';
const terminal = new Set(['completion_observed', 'refused', 'indeterminate']);
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const ensure = (value, code) => { if (!value) fail(code); };
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, required, optional = []) => plain(value)
  && required.every(key => own(value, key))
  && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
function jsonValue(value, depth = 0, seen = new Set()) {
  ensure(depth <= 12, 'PROTOCOL_JSON_DEPTH_LIMIT');
  if (typeof value === 'string') { ensure(value.isWellFormed(), 'PROTOCOL_UNICODE_INVALID'); return; }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { ensure(Number.isFinite(value), 'PROTOCOL_JSON_VALUE_INVALID'); return; }
  ensure((Array.isArray(value) || plain(value)) && !seen.has(value), 'PROTOCOL_JSON_VALUE_INVALID');
  seen.add(value);
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value)) {
    ensure(keys.length === value.length + 1, 'PROTOCOL_JSON_PROPERTY_INVALID');
  }
  for (const key of keys) {
    ensure(typeof key === 'string' && key.isWellFormed(), 'PROTOCOL_UNICODE_INVALID');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    ensure(own(descriptor, 'value'), 'PROTOCOL_ACCESSOR_FORBIDDEN');
    if (Array.isArray(value) && key === 'length') continue;
    ensure(descriptor.enumerable && (!Array.isArray(value) || /^(0|[1-9][0-9]*)$/.test(key)),
      'PROTOCOL_JSON_PROPERTY_INVALID');
    jsonValue(descriptor.value, depth + 1, seen);
  }
  seen.delete(value);
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const clone = value => JSON.parse(canonical(value));
function frozen(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
const asciiCase = value => value.replace(/[a-z]/g, letter => letter.toUpperCase());
function windowsPath(value) {
  ensure(typeof value === 'string' && value.length <= 1024 && value.isWellFormed()
    && /^[A-Za-z]:\\/.test(value) && value.normalize('NFC') === value, 'PROTOCOL_WINDOWS_PATH_INVALID');
  const parts = value.slice(3).split('\\');
  ensure(parts.length > 0 && parts.every(part => part.length > 0 && part !== '.' && part !== '..'
    && !/[<>:"/|?*\x00-\x1f\x7f]|[. ]$/.test(part)
    && !/~[0-9]/.test(part)
    && !/^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)), 'PROTOCOL_WINDOWS_PATH_INVALID');
  return value;
}
function assertConfig(config) {
  jsonValue(config);
  ensure(exact(config, ['operation_sha256', 'client_sha256', 'cwd', 'expected_codex_home', 'limits']), 'PROTOCOL_CONFIGURATION_INVALID');
  for (const field of ['operation_sha256', 'client_sha256']) ensure(typeof config[field] === 'string' && /^[a-f0-9]{64}$/.test(config[field]), 'PROTOCOL_PIN_INVALID');
  windowsPath(config.cwd); windowsPath(config.expected_codex_home);
  const fields = ['initialize_timeout_ms', 'setup_timeout_ms', 'max_duration_ms', 'max_frame_bytes', 'max_total_bytes', 'max_frames'];
  ensure(exact(config.limits, fields) && fields.every(key => Number.isSafeInteger(config.limits[key]) && config.limits[key] > 0), 'PROTOCOL_LIMIT_INVALID');
  const l = config.limits;
  ensure(l.max_duration_ms <= 600000 && l.initialize_timeout_ms <= l.max_duration_ms && l.setup_timeout_ms <= l.max_duration_ms
    && l.max_frame_bytes >= 256 && l.max_frame_bytes <= 65536 && l.max_total_bytes >= l.max_frame_bytes && l.max_total_bytes <= 1048576
    && l.max_frames >= 3 && l.max_frames <= 128, 'PROTOCOL_LIMIT_INVALID');
}
function clock(at, previous = 0) {
  ensure(Number.isSafeInteger(at) && at >= previous && at <= Number.MAX_SAFE_INTEGER - 600000, 'PROTOCOL_CLOCK_INVALID');
}
function result(state, frames = []) {
  const next = clone(state);
  for (const frame of frames) {
    const bytes = new TextEncoder().encode(JSON.stringify(frame) + '\n').length;
    ensure(bytes <= next.config.limits.max_frame_bytes, 'PROTOCOL_OUTBOUND_FRAME_LIMIT');
    next.requested_frames++;
    next.requested_bytes += bytes;
  }
  if (frames.length) ensure(next.requested_frames <= 3 && next.requested_bytes + next.received_bytes <= next.config.limits.max_total_bytes, 'PROTOCOL_OUTBOUND_LIMIT');
  delete next.state_sha256;
  next.state_sha256 = sha(canonical(next));
  return frozen({
    contract_version: 'aidn-managed-setup-protocol-transition.v1', state: next, requested_frames: clone(frames),
    effect_class: 'model_only', execution_available: false, operation_authorized: false,
    process_tree: 'NOT_OBSERVED', state_stability: 'NOT_OBSERVED', confinement: 'NOT_TESTED',
    executable_pins_verified: false, physical_roots_verified: false,
    transport_action: terminal.has(next.phase) ? 'STOP_OR_RECONCILE_EXTERNALLY' : 'NONE_EXECUTED',
  });
}
function refuse(state, reason, extra = {}) {
  state.phase = state.setup_requested ? 'indeterminate' : 'refused';
  state.reason_code = reason;
  state.reconciliation_required = state.setup_requested;
  Object.assign(state, extra);
  return result(state);
}
function complete(state) {
  state.phase = 'completion_observed'; state.reason_code = null;
  state.reported_setup_result = state.completion.success ? 'succeeded' : 'failed';
  // A reported API completion does not establish descendant stop or effects.
  state.reconciliation_required = true;
  return result(state);
}

/** Reject duplicate JSON keys, excessive nesting and extra documents. */
function parseFrame(text) {
  let cursor = 0;
  const whitespace = () => { while (/[\t\n\r ]/.test(text[cursor] ?? 'x')) cursor++; };
  const string = () => {
    ensure(text[cursor++] === '"', 'PROTOCOL_JSON_INVALID');
    const start = cursor - 1;
    for (; cursor < text.length; cursor++) {
      if (text[cursor] === '\\') { cursor++; continue; }
      if (text[cursor] === '"') { cursor++; return JSON.parse(text.slice(start, cursor)); }
    }
    fail('PROTOCOL_JSON_INVALID');
  };
  const value = depth => {
    ensure(depth <= 12, 'PROTOCOL_JSON_DEPTH_LIMIT'); whitespace();
    if (text[cursor] === '"') { string(); return; }
    if (text[cursor] === '{') {
      cursor++; whitespace(); const keys = new Set();
      if (text[cursor] === '}') { cursor++; return; }
      for (;;) {
        whitespace(); const key = string(); ensure(!keys.has(key), 'PROTOCOL_DUPLICATE_JSON_KEY'); keys.add(key);
        whitespace(); ensure(text[cursor++] === ':', 'PROTOCOL_JSON_INVALID'); value(depth + 1); whitespace();
        const delimiter = text[cursor++]; if (delimiter === '}') return;
        ensure(delimiter === ',', 'PROTOCOL_JSON_INVALID');
      }
    }
    if (text[cursor] === '[') {
      cursor++; whitespace(); if (text[cursor] === ']') { cursor++; return; }
      for (;;) { value(depth + 1); whitespace(); const delimiter = text[cursor++]; if (delimiter === ']') return; ensure(delimiter === ',', 'PROTOCOL_JSON_INVALID'); }
    }
    const literal = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(cursor));
    ensure(literal, 'PROTOCOL_JSON_INVALID'); cursor += literal[0].length;
  };
  try { value(0); whitespace(); ensure(cursor === text.length, 'PROTOCOL_JSON_INVALID'); const frame = JSON.parse(text); jsonValue(frame); return frame; }
  catch (error) { if (error.code?.startsWith('PROTOCOL_')) throw error; fail('PROTOCOL_JSON_INVALID'); }
}
function completionValue(frame) {
  ensure(exact(frame, ['method', 'params']) && frame.method === 'windowsSandbox/setupCompleted', 'PROTOCOL_UNEXPECTED_NOTIFICATION');
  const p = frame.params;
  ensure(exact(p, ['mode', 'success'], ['error']) && p.mode === 'elevated' && typeof p.success === 'boolean'
    && (!own(p, 'error') || p.error === null || (typeof p.error === 'string' && p.error.length <= 8192)), 'PROTOCOL_COMPLETION_INVALID');
  ensure(!p.success || p.error === undefined || p.error === null, 'PROTOCOL_COMPLETION_INCONSISTENT');
  return { success: p.success, error_present: typeof p.error === 'string' && p.error.length > 0 };
}
function expectedResponse(frame, id) {
  ensure(plain(frame) && frame.id === id, 'PROTOCOL_RESPONSE_ID_MISMATCH');
  if (own(frame, 'error')) {
    ensure(exact(frame, ['id', 'error']) && exact(frame.error, ['code', 'message'], ['data'])
      && Number.isSafeInteger(frame.error.code) && typeof frame.error.message === 'string', 'PROTOCOL_ERROR_RESPONSE_INVALID');
    return { error_code: frame.error.code, has_error_data: own(frame.error, 'data') };
  }
  ensure(exact(frame, ['id', 'result']), 'PROTOCOL_RESPONSE_INVALID');
  return null;
}

/** Explicit clock only. Returned frames are proposals, never transmitted here. */
export function createManagedSetupProtocol(config, { at } = {}) {
  assertConfig(config); clock(at);
  const state = {
    contract_version: VERSION, config: clone(config), configuration_sha256: sha(canonical(config)),
    phase: 'await_initialize', started_at: at, last_at: at,
    phase_deadline: at + config.limits.initialize_timeout_ms, global_deadline: at + config.limits.max_duration_ms,
    requested_frames: 0, requested_bytes: 0, received_frames: 0, received_bytes: 0,
    setup_requested: false, setup_started: false, completion: null, reported_setup_result: null,
    reason_code: null, server_error_code: null, server_error_data_present: false,
    reconciliation_required: false, stream_closed: false,
  };
  return result(state, [{ id: INITIALIZE_ID, method: 'initialize', params: { clientInfo: { name: 'aidn_managed_setup_protocol', version: '0.1.0-preparation' } } }]);
}

/** Events: frame {json}, tick, eof, abort; no arbitrary outbound request API. */
export function stepManagedSetupProtocol(previous, event, { at } = {}) {
  jsonValue(previous); jsonValue(event);
  ensure(plain(previous) && previous.contract_version === VERSION, 'PROTOCOL_STATE_INVALID');
  assertConfig(previous.config);
  ensure(previous.configuration_sha256 === sha(canonical(previous.config)), 'PROTOCOL_CONFIGURATION_CHANGED');
  const identity = clone(previous); delete identity.state_sha256;
  ensure(typeof previous.state_sha256 === 'string' && previous.state_sha256 === sha(canonical(identity)), 'PROTOCOL_PARENT_STATE_CHANGED');
  ensure(['await_initialize', 'await_setup_response', 'await_setup_completion', ...terminal].includes(previous.phase), 'PROTOCOL_STATE_INVALID');
  clock(at, previous.last_at);
  ensure(exact(event, ['type'], event.type === 'frame' ? ['json'] : []) && ['frame', 'tick', 'eof', 'abort'].includes(event.type), 'PROTOCOL_EVENT_INVALID');
  const state = clone(previous); state.last_at = at;
  if (event.type === 'frame' && (state.stream_closed || terminal.has(state.phase))) return refuse(state, 'PROTOCOL_TRAILING_FRAME');
  if (terminal.has(state.phase)) {
    if (event.type === 'eof') state.stream_closed = true;
    return result(state);
  }
  if (at >= state.global_deadline || at >= state.phase_deadline) return refuse(state, 'PROTOCOL_DEADLINE_EXCEEDED');
  if (event.type === 'abort') return refuse(state, 'PROTOCOL_ABORTED');
  if (event.type === 'eof') { state.stream_closed = true; return refuse(state, 'PROTOCOL_EOF_BEFORE_COMPLETION'); }
  if (event.type === 'tick') return result(state);
  try {
    ensure(typeof event.json === 'string' && event.json.isWellFormed(), 'PROTOCOL_FRAME_INVALID');
    ensure(event.json.length <= state.config.limits.max_frame_bytes, 'PROTOCOL_FRAME_BYTE_LIMIT');
    const bytes = new TextEncoder().encode(event.json + '\n').length;
    state.received_frames++; state.received_bytes += bytes;
    ensure(bytes <= state.config.limits.max_frame_bytes, 'PROTOCOL_FRAME_BYTE_LIMIT');
    ensure(state.received_bytes + state.requested_bytes <= state.config.limits.max_total_bytes, 'PROTOCOL_TOTAL_BYTE_LIMIT');
    ensure(state.received_frames <= state.config.limits.max_frames, 'PROTOCOL_FRAME_COUNT_LIMIT');
    const frame = parseFrame(event.json);
    ensure(plain(frame), 'PROTOCOL_FRAME_INVALID');
    if (own(frame, 'method')) {
      ensure(!own(frame, 'id'), 'PROTOCOL_SERVER_REQUEST_FORBIDDEN');
      ensure(state.setup_requested, 'PROTOCOL_NOTIFICATION_BEFORE_SETUP');
      ensure(state.completion === null, 'PROTOCOL_DUPLICATE_COMPLETION');
      state.completion = completionValue(frame);
      return state.setup_started ? complete(state) : result(state);
    }
    if (state.phase === 'await_initialize') {
      const error = expectedResponse(frame, INITIALIZE_ID);
      if (error) return refuse(state, 'PROTOCOL_INITIALIZE_REJECTED', { server_error_code: error.error_code, server_error_data_present: error.has_error_data });
      const p = frame.result;
      ensure(exact(p, ['codexHome', 'platformFamily', 'platformOs', 'userAgent']) && p.platformFamily === 'windows' && p.platformOs === 'windows'
        && typeof p.userAgent === 'string' && p.userAgent.length > 0 && p.userAgent.length <= 4096, 'PROTOCOL_INITIALIZE_RESULT_INVALID');
      windowsPath(p.codexHome);
      ensure(asciiCase(p.codexHome) === asciiCase(state.config.expected_codex_home), 'PROTOCOL_CODEX_HOME_MISMATCH');
      const requested = { ...state, phase: 'await_setup_response', setup_requested: true,
        phase_deadline: Math.min(at + state.config.limits.setup_timeout_ms, state.global_deadline) };
      return result(requested, [{ method: 'initialized' }, { id: SETUP_ID, method: 'windowsSandbox/setupStart', params: { mode: 'elevated', cwd: state.config.cwd } }]);
    }
    ensure(state.phase === 'await_setup_response', 'PROTOCOL_DUPLICATE_RESPONSE');
    const error = expectedResponse(frame, SETUP_ID);
    if (error) return refuse(state, 'PROTOCOL_SETUP_REJECTED', { server_error_code: error.error_code, server_error_data_present: error.has_error_data });
    ensure(exact(frame.result, ['started']) && typeof frame.result.started === 'boolean', 'PROTOCOL_SETUP_RESULT_INVALID');
    ensure(frame.result.started === true, 'PROTOCOL_SETUP_NOT_STARTED');
    state.setup_started = true; state.phase = 'await_setup_completion';
    return state.completion === null ? result(state) : complete(state);
  } catch (error) {
    if (!error.code?.startsWith('PROTOCOL_')) throw error;
    return refuse(state, error.code);
  }
}
