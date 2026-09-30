import { createHash } from "node:crypto";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = code => { throw Object.assign(new Error(code), { code }); };
const validHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const captures = new WeakSet();
export const DELEGATED_NATIVE_REFUSAL_REASON = "AIDN: delegated operation refused; only the exact active attempt scope is permitted.";
const deniedCodes = new Set(["DELEGATED_SCOPE_REFUSED", "AGENT_EXECUTION_OWNERSHIP_LOST",
  "AGENT_EXECUTION_RUN_NOT_ACTIVE", "AGENT_EXECUTION_LEASE_EXPIRED"]);
const router = " ERROR codex_core::tools::router: error=Command blocked by PreToolUse hook: ";
const header = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z) ERROR codex_core::tools::router: error=Command blocked by PreToolUse hook: (AIDN: [^\r\n]{1,512})\. Command: (\*\*\* Begin Patch)$/;

function instant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) return NaN;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0,19) === value.slice(0,19) ? milliseconds : NaN;
}

// Only the controller's stderr channel enters this collector. Agent messages,
// stdout and admission payloads are not log sources. Byte offsets let the
// supervisor correlate a complete record with one observed admission interval.
export function createAgentNativeRefusalEvidence({ codexSha256, maxBytes = 2 * 1024 * 1024,
  maxRecordBytes = 128 * 1024, maxRecords = 32 } = {}) {
  if (!validHash(codexSha256) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024
      || !Number.isSafeInteger(maxRecordBytes) || maxRecordBytes < 1 || maxRecordBytes > maxBytes
      || !Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 128) fail("NATIVE_REFUSAL_CONFIGURATION_INVALID");
  const digest = createHash("sha256"), decoder = new TextDecoder("utf-8", { fatal: true }), records = [];
  let pending = Buffer.alloc(0), bytes = 0, consumed = 0, current = null, closed = false;
  function line(raw) {
    let text;
    try { text = decoder.decode(raw.at(-1) === 10 ? raw.subarray(0,-1) : raw); }
    catch { fail("NATIVE_REFUSAL_UTF8_INVALID"); }
    if (text.endsWith("\r")) text = text.slice(0,-1);
    const start = consumed; consumed += raw.length;
    if (!current) {
      const match = header.exec(text);
      if (!match) {
        // A malformed record from the exact router cannot be silently ignored.
        if (text.includes(router) && /^\d{4}-/.test(text)) fail("NATIVE_REFUSAL_RECORD_INVALID");
        return;
      }
      if (!Number.isFinite(instant(match[1]))) fail("NATIVE_REFUSAL_TIMESTAMP_INVALID");
      current = { timestamp: match[1], reason: match[2], patch: [match[3]], start_offset: start, raw: [raw], bytes: raw.length };
      return;
    }
    if (text.startsWith("*** Begin Patch") || /^\d{4}-\d{2}-\d{2}T/.test(text)) fail("NATIVE_REFUSAL_RECORD_INCOMPLETE");
    current.bytes += raw.length;
    if (current.bytes > maxRecordBytes) fail("NATIVE_REFUSAL_RECORD_LIMIT");
    current.raw.push(raw); current.patch.push(text);
    if (text === "*** End Patch") {
      if (records.length >= maxRecords) fail("NATIVE_REFUSAL_COUNT_LIMIT");
      records.push(Object.freeze({ timestamp: current.timestamp, reason: current.reason, patch: current.patch.join("\n"),
        start_offset: current.start_offset, end_offset: consumed, raw_sha256: hash(Buffer.concat(current.raw)) }));
      current = null;
    }
  }
  return Object.freeze({
    position() { return bytes; },
    push(chunk) {
      if (closed || !Buffer.isBuffer(chunk)) fail("NATIVE_REFUSAL_STREAM_INVALID");
      if (bytes + chunk.length > maxBytes) fail("NATIVE_REFUSAL_BUFFER_LIMIT");
      digest.update(chunk); bytes += chunk.length;
      let offset = 0;
      while (offset < chunk.length) {
        const end = chunk.indexOf(10, offset), part = chunk.subarray(offset, end < 0 ? chunk.length : end + 1);
        if (pending.length + part.length > maxRecordBytes) fail("NATIVE_REFUSAL_RECORD_LIMIT");
        pending = Buffer.concat([pending, part]);
        if (end < 0) break;
        line(pending); pending = Buffer.alloc(0); offset = end + 1;
      }
    },
    finish() {
      if (closed) fail("NATIVE_REFUSAL_STREAM_INVALID");
      closed = true;
      if (pending.length) line(pending);
      if (current) fail("NATIVE_REFUSAL_RECORD_INCOMPLETE");
      const result = Object.freeze({ codex_sha256: codexSha256, stderr_sha256: digest.digest("hex"),
        stderr_bytes: bytes, records: Object.freeze(records) });
      captures.add(result); return result;
    },
  });
}

// The persisted evidence's decoded stderr digest must independently agree with
// this capture. JSON claiming to be a capture is not accepted as an observation.
export function assertAgentNativeRefusalEvidence({ capture, capturedStderr, codexSha256, expectedPatch, decision, interval } = {}) {
  if (!capture || !captures.has(capture) || !validHash(codexSha256) || capture.codex_sha256 !== codexSha256
      || capturedStderr?.sha256 !== capture.stderr_sha256 || capturedStderr?.bytes !== capture.stderr_bytes) fail("NATIVE_REFUSAL_CAPTURE_BINDING_MISMATCH");
  if (decision?.ok !== false || decision.outcome !== "deny" || !deniedCodes.has(decision.reason_code)) fail("NATIVE_REFUSAL_SERVER_DENY_REQUIRED");
  const start = instant(interval?.start_at), end = instant(interval?.end_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isSafeInteger(interval.start_offset)
      || !Number.isSafeInteger(interval.end_offset) || interval.start_offset < 0 || interval.end_offset < interval.start_offset
      || interval.end_offset > capture.stderr_bytes) fail("NATIVE_REFUSAL_INTERVAL_INVALID");
  if (typeof expectedPatch !== "string" || !expectedPatch.startsWith("*** Begin Patch\n") || !expectedPatch.endsWith("\n*** End Patch")) fail("NATIVE_REFUSAL_PATCH_INVALID");
  const inInterval = capture.records.filter(record => record.start_offset >= interval.start_offset && record.end_offset <= interval.end_offset);
  const matching = capture.records.filter(record => record.patch === expectedPatch);
  if (!inInterval.length && !matching.length) fail("NATIVE_REFUSAL_MISSING");
  if (inInterval.length !== 1 || matching.length > 1) fail("NATIVE_REFUSAL_AMBIGUOUS");
  if (matching.length !== 1 || inInterval[0] !== matching[0]) fail("NATIVE_REFUSAL_PATCH_MISMATCH");
  const record = matching[0], timestamp = instant(record.timestamp);
  if (timestamp < start || timestamp >= end) fail("NATIVE_REFUSAL_TIMESTAMP_OUTSIDE_INTERVAL");
  if (record.reason !== DELEGATED_NATIVE_REFUSAL_REASON) fail("NATIVE_REFUSAL_HOOK_REASON_MISMATCH");
  return Object.freeze({ source: "codex-native-stderr-router", codex_sha256: codexSha256,
    stderr_sha256: capture.stderr_sha256, stderr_bytes: capture.stderr_bytes, record_sha256: record.raw_sha256,
    start_offset: record.start_offset, end_offset: record.end_offset, timestamp: record.timestamp,
    patch_sha256: hash(expectedPatch), hook_reason: record.reason, decision_reason_code: decision.reason_code });
}
