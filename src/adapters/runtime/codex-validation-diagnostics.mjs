import { createHash } from "node:crypto";

const LIMIT = 4096;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function decode(tail, observed) {
  let offset = 0;
  if (observed > tail.length) while (offset < Math.min(4, tail.length) && (tail[offset] & 0xc0) === 0x80) offset++;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(tail.subarray(offset)); } catch { return null; }
}

// Private local evidence only. The controller's counters/hash cover its full
// stream, including bytes not delivered to this bounded callback observer.
export function createCodexValidationStderr() {
  let tail = Buffer.alloc(0), observed = 0;
  return Object.freeze({
    consume(bytes) {
      const chunk = Buffer.from(bytes); observed += chunk.length;
      tail = chunk.length >= LIMIT ? Buffer.from(chunk.subarray(-LIMIT)) : Buffer.concat([tail, chunk]).subarray(-LIMIT);
    },
    snapshot(process) {
      return { total_bytes: process?.bytes?.stderr ?? null, sha256: process?.hashes?.stderr_sha256 ?? null,
        observed_bytes: observed, retained_bytes: tail.length, truncated: (process?.bytes?.stderr ?? observed) > tail.length,
        tail_base64: tail.toString("base64"), tail_utf8: decode(tail, observed) };
    },
  });
}

export function assertCodexValidationDiagnostics(value, controller) {
  const exact = (row, keys) => row && typeof row === "object" && !Array.isArray(row)
    && Object.keys(row).sort().join("|") === keys.sort().join("|");
  const fail = () => { throw Object.assign(Error("SANDBOX_JOURNAL_DIAGNOSTIC_INVALID"), { code: "SANDBOX_JOURNAL_DIAGNOSTIC_INVALID" }); };
  if (!exact(value, ["protocol_failure", "stderr"]) || !(value.protocol_failure === null
    || typeof value.protocol_failure === "string" && /^[A-Z][A-Z0-9_]{0,127}$/u.test(value.protocol_failure))) fail();
  const row = value.stderr;
  if (!exact(row, ["total_bytes", "sha256", "observed_bytes", "retained_bytes", "truncated", "tail_base64", "tail_utf8"])
    || !(row.total_bytes === null || Number.isSafeInteger(row.total_bytes) && row.total_bytes >= 0)
    || !(row.sha256 === null || typeof row.sha256 === "string" && /^[a-f0-9]{64}$/u.test(row.sha256))
    || row.total_bytes !== (controller?.bytes?.stderr ?? null) || row.sha256 !== (controller?.hashes?.stderr_sha256 ?? null)
    || !Number.isSafeInteger(row.observed_bytes) || row.observed_bytes < 0
    || row.total_bytes !== null && row.observed_bytes > row.total_bytes
    || row.retained_bytes !== Math.min(LIMIT, row.observed_bytes)
    || row.truncated !== ((row.total_bytes ?? row.observed_bytes) > row.retained_bytes)
    || typeof row.tail_base64 !== "string" || row.tail_base64.length > 5464) fail();
  const bytes = Buffer.from(row.tail_base64, "base64");
  if (bytes.length !== row.retained_bytes || bytes.toString("base64") !== row.tail_base64
    || row.tail_utf8 !== decode(bytes, row.observed_bytes)
    || row.sha256 !== null && row.total_bytes === bytes.length && hash(bytes) !== row.sha256) fail();
  return value;
}
