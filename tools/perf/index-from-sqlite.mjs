#!/usr/bin/env node
import crypto from "node:crypto";
import { readIndexFromSqlite } from "../../src/lib/sqlite/index-sqlite-lib.mjs";
import { isJsonEquivalent, writeJsonIfChanged } from "../../src/lib/index/io-lib.mjs";

function parseArgs(argv) {
  const args = {
    sqliteFile: ".aidn/runtime/index/workflow-index.sqlite",
    out: ".aidn/runtime/index/workflow-index.from-sqlite.json",
    json: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--sqlite-file") {
      args.sqliteFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.sqliteFile) {
    throw new Error("Missing value for --sqlite-file");
  }
  if (!args.out) {
    throw new Error("Missing value for --out");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/index-from-sqlite.mjs");
  console.log("  node tools/perf/index-from-sqlite.mjs --sqlite-file .aidn/runtime/index/workflow-index.sqlite --out .aidn/runtime/index/workflow-index.from-sqlite.json");
  console.log("  node tools/perf/index-from-sqlite.mjs --json");
}

function stableProjection(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  const clone = JSON.parse(JSON.stringify(payload));
  delete clone.generated_at;
  return clone;
}

function payloadDigest(payload) {
  const stable = stableProjection(payload);
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { absolute, payload } = readIndexFromSqlite(args.sqliteFile);
    const digest = payloadDigest(payload);

    let write = {
      path: null,
      written: false,
      bytes_written: 0,
    };
    if (!args.dryRun) {
      write = writeJsonIfChanged(args.out, payload, {
        isEquivalent(previous) {
          return isJsonEquivalent(previous, payload, ["generated_at"]);
        },
      });
    }

    const out = {
      ts: new Date().toISOString(),
      sqlite_file: absolute,
      out: write.path,
      dry_run: args.dryRun,
      payload_digest: digest,
      summary: payload.summary ?? null,
      write,
    };

    if (args.json) {
      console.log(JSON.stringify(out, null, 2));
      return;
    }

    console.log(`SQLite source: ${out.sqlite_file}`);
    console.log(`Payload digest: ${out.payload_digest}`);
    if (args.dryRun) {
      console.log("Dry-run mode: no file written.");
      return;
    }
    const state = out.write.written ? "updated" : "unchanged";
    console.log(`Output (${state}): ${out.write.path}`);
    console.log(`Bytes written: ${out.write.bytes_written}`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
