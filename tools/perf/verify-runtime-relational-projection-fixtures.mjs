#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { projectRuntimePayloadToRelationalRows } from "../../src/application/runtime/runtime-relational-projection-service.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  try {
    const fixtureFile = path.resolve(process.cwd(), "tests", "fixtures", "repo-installed-core", ".aidn", "runtime", "index", "workflow-index.json");
    const payload = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
    const rows = projectRuntimePayloadToRelationalRows(payload);

    assert(rows.artifacts.length === payload.artifacts.length, "expected artifact projection count parity");
    assert(rows.artifact_blobs.length === payload.artifacts.length, "expected artifact_blobs projection count parity");
    assert(rows.tags.length === payload.tags.length, "expected tag projection count parity");
    assert(rows.artifact_tags.length === payload.artifact_tags.length, "expected artifact_tags projection count parity");
    assert(rows.migration_runs.length === payload.migration_runs.length, "expected migration_runs projection count parity");
    assert(rows.runtime_heads.some((row) => row.head_key === "current_state"), "expected current_state runtime head");
    assert(rows.runtime_heads.some((row) => row.head_key === "runtime_state"), "expected runtime_state runtime head");
    assert(rows.runtime_heads.some((row) => row.head_key === "handoff_packet"), "expected handoff_packet runtime head");
    assert(rows.index_meta.some((row) => row.key === "schema_version"), "expected schema_version meta row");
    assert(rows.index_meta.some((row) => row.key === "payload_schema_version"), "expected payload_schema_version meta row");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
