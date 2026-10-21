#!/usr/bin/env node
import fs from "node:fs";
import readline from "node:readline";
import { createHash } from "node:crypto";
import { createResponseUsageObserver } from "../../src/core/context/response-usage-policy.mjs";

// Internal, read-only evidence utility; not a public aidn command or qualifier.
async function main() {
  const argv = process.argv.slice(2), inputs = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--events" && argv[i + 1] && !argv[i + 1].startsWith("--")) inputs.push(argv[++i]);
    else if (argv[i] === "--help") {
      console.log("Read-only: node tools/perf/summarize-response-usage.mjs --events <native-events.jsonl> [--events <next.jsonl>]");
      return;
    } else throw new Error("Expected --events <file>; no write or execution options are supported");
  }
  if (!inputs.length) throw new Error("At least one explicit native event file is required");
  const observer = createResponseUsageObserver(), sources = [];
  for (const file of inputs) {
    const hash = createHash("sha256");
    let bytes = 0, lines = 0;
    const stream = fs.createReadStream(file);
    stream.on("data", chunk => { hash.update(chunk); bytes += chunk.length; });
    const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of reader) {
        lines += 1;
        if (line.trim()) {
          let event;
          try { event = JSON.parse(line); } catch { throw new Error(`Malformed event JSON at input ${sources.length + 1}, line ${lines}`); }
          observer.observe(event);
        }
      }
    } finally { reader.close(); stream.destroy(); }
    sources.push({ input_index: sources.length + 1, sha256: hash.digest("hex"), bytes, lines });
  }
  console.log(JSON.stringify({ ok: true, ...observer.summary(), sources }));
}

try { await main(); }
catch (error) { console.error(String(error.message)); process.exitCode = 1; }
