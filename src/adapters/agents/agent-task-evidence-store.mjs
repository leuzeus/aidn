import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertAgentExecutionContract } from "../../core/agents/agent-execution-contracts.mjs";

function physicalDirectory(directory) {
  if (!path.isAbsolute(directory)) throw new Error("CODEX_EVIDENCE_ROOT_INVALID");
  let cursor = path.parse(directory).root;
  for (const part of directory.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const stat = fs.lstatSync(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("CODEX_EVIDENCE_ROOT_UNSAFE");
  }
  return fs.realpathSync.native(directory);
}

// Explicit construction is inert. open() writes exclusively into an existing
// supervisor-owned root outside the worker. Failed attempts are retained.
export function createAgentTaskEvidenceStore({ root, maxBytes = 20 * 1024 * 1024 } = {}) {
  if (typeof root !== "string" || !path.isAbsolute(root) || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError("CODEX_EVIDENCE_CONFIGURATION_INVALID");
  return Object.freeze({
    async open(request) {
      assertAgentExecutionContract("request", request);
      const actualRoot = physicalDirectory(root), cwd = physicalDirectory(request.cwd);
      const relative = path.relative(cwd, actualRoot);
      if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) throw new Error("CODEX_EVIDENCE_INSIDE_WORKER");
      // IDs allow ':' for logical identity; filenames deliberately use a hash.
      const id = createHash("sha256").update(request.attempt_id).digest("hex");
      const file = path.join(actualRoot, `${id}.jsonl`);
      const descriptor = fs.openSync(file, "wx", 0o600);
      const digest = createHash("sha256");
      let bytes = 0, finished = false;
      function write(record) {
        if (finished) throw new Error("CODEX_EVIDENCE_CLOSED");
        const data = Buffer.from(`${JSON.stringify(record)}\n`);
        if (bytes + data.length > maxBytes) throw new Error("CODEX_EVIDENCE_LIMIT");
        let offset = 0;
        while (offset < data.length) offset += fs.writeSync(descriptor, data, offset, data.length - offset);
        digest.update(data); bytes += data.length;
      }
      try { write({ type: "request", run_id: request.run_id, task_id: request.task_id, attempt_id: request.attempt_id }); }
      catch (error) { fs.closeSync(descriptor); throw error; }
      return Object.freeze({
        async append(stream, chunk) {
          if (!["stdout", "stderr"].includes(stream) || !Buffer.isBuffer(chunk) || chunk.length > 1024 * 1024) throw new Error("CODEX_EVIDENCE_CHUNK_INVALID");
          write({ type: stream, base64: chunk.toString("base64") });
        },
        async finish(observation) {
          if (finished) throw new Error("CODEX_EVIDENCE_CLOSED");
          try { write({ type: "termination", observation }); fs.fsyncSync(descriptor); }
          finally { finished = true; fs.closeSync(descriptor); }
          return [{ ref: `${id}.jsonl`, bytes, sha256: digest.digest("hex") }];
        },
      });
    },
  });
}
