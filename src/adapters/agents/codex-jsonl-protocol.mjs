// Raw Codex output is local evidence, never the public AIDN stdout protocol.
export function createCodexJsonlProtocol({ maxLineBytes = 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 1 || maxLineBytes > 4 * 1024 * 1024) throw new TypeError("INVALID_CODEX_LINE_LIMIT");
  let pending = Buffer.alloc(0), thread = false, turn = false, terminal = null, records = 0, closed = false;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  function parse(bytes) {
    if (!bytes.length || bytes.length > maxLineBytes) throw new Error("CODEX_JSONL_LINE_INVALID");
    let event;
    try { event = JSON.parse(decoder.decode(bytes)); } catch { throw new Error("CODEX_JSONL_INVALID"); }
    if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.type !== "string") throw new Error("CODEX_JSONL_INVALID");
    if (++records > 100000) throw new Error("CODEX_JSONL_RECORD_LIMIT");
    if (terminal) throw new Error("CODEX_EVENT_AFTER_TERMINAL");
    switch (event.type) {
      case "thread.started":
        if (thread || typeof event.thread_id !== "string" || !event.thread_id.length || event.thread_id.length > 128) throw new Error("CODEX_THREAD_INVALID");
        thread = true; break;
      case "turn.started":
        if (!thread || turn) throw new Error("CODEX_TURN_INVALID");
        turn = true; break;
      case "item.started": case "item.updated": case "item.completed":
        if (!turn || !event.item || typeof event.item !== "object" || Array.isArray(event.item)) throw new Error("CODEX_ITEM_INVALID");
        break;
      case "turn.completed":
        if (!turn) throw new Error("CODEX_TURN_INVALID");
        terminal = "completed"; break;
      case "turn.failed": case "error": terminal = "failed"; break;
      default: throw new Error("CODEX_EVENT_UNSUPPORTED");
    }
    return event.type;
  }
  return Object.freeze({
    async push(bytes, onRecord = async () => {}) {
      if (closed || !Buffer.isBuffer(bytes)) throw new Error("CODEX_STREAM_INVALID");
      if (bytes.length > maxLineBytes) throw new Error("CODEX_JSONL_CHUNK_LIMIT");
      let offset = 0;
      for (;;) {
        const end = bytes.indexOf(10, offset);
        const part = bytes.subarray(offset, end < 0 ? bytes.length : end);
        if (pending.length + part.length > maxLineBytes) throw new Error("CODEX_JSONL_LINE_LIMIT");
        pending = Buffer.concat([pending, part]);
        if (end < 0) break;
        if (pending.at(-1) === 13) pending = pending.subarray(0, -1);
        const type = parse(pending); pending = Buffer.alloc(0);
        await onRecord(type);
        offset = end + 1;
      }
    },
    finish() {
      closed = true;
      if (pending.length) throw new Error("CODEX_JSONL_TRUNCATED");
      if (!terminal) throw new Error("CODEX_PROTOCOL_INCOMPLETE");
      return { terminal, records };
    },
  });
}
