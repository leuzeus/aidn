// Raw Codex output is local evidence, never the public AIDN stdout protocol.
export function createCodexJsonlProtocol({ maxLineBytes = 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 1 || maxLineBytes > 4 * 1024 * 1024) throw new TypeError("INVALID_CODEX_LINE_LIMIT");
  let pending = Buffer.alloc(0), thread = false, turn = false, terminal = null, records = 0, closed = false, failure = null;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const retainFailure = error => {
    failure ??= error instanceof Error ? error : new Error("CODEX_RECORD_CALLBACK_FAILED");
    closed = true; pending = Buffer.alloc(0);
    return failure;
  };
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
        if (!event.item || typeof event.item !== "object" || Array.isArray(event.item)) throw new Error("CODEX_ITEM_INVALID");
        if (!turn) {
          // A completed error item can report a startup diagnostic after the
          // thread exists. It starts no turn and is never a terminal success.
          const item = event.item;
          if (!thread || event.type !== "item.completed" || Object.keys(event).length !== 2
              || item.type !== "error" || Object.keys(item).length !== 3
              || typeof item.id !== "string" || !item.id.length || item.id.length > 128 || /[\x00-\x1f\x7f]/.test(item.id)
              || typeof item.message !== "string" || !item.message.trim()) throw new Error("CODEX_ITEM_INVALID");
        }
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
      if (failure) throw failure;
      try {
        if (closed || !Buffer.isBuffer(bytes)) throw new Error("CODEX_STREAM_INVALID");
        if (bytes.length > maxLineBytes) throw new Error("CODEX_JSONL_CHUNK_LIMIT");
        let offset = 0;
        for (;;) {
          if (failure) throw failure;
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
      } catch (error) { throw retainFailure(error); }
    },
    finish() {
      if (failure) throw failure;
      closed = true;
      try {
        if (pending.length) throw new Error("CODEX_JSONL_TRUNCATED");
        if (!terminal) throw new Error("CODEX_PROTOCOL_INCOMPLETE");
        return { terminal, records };
      } catch (error) { throw retainFailure(error); }
    },
  });
}
