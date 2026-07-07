#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRuntimeArtifactStore } from "../../src/application/runtime/runtime-persistence-service.mjs";
import { stateReanchor } from "../runtime/state-reanchor.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function staleCurrentStateText() {
  return [
    "# Current State",
    "",
    "contract_version: critical-markdown-v1",
    "updated_at: 2026-06-01T00:00:00.000Z",
    "source_of_truth: runtime-backend",
    "source_mode: stale-fixture",
    "lifecycle_status: stale",
    "runtime_state_mode: db-only",
    "mode: THINKING",
    "active_session: none",
    "active_cycle: none",
    "current_state_freshness: stale",
    "",
  ].join("\n");
}

async function seedRuntimePayload(targetRoot) {
  const current = staleCurrentStateText();
  const payload = {
    schema_version: 2,
    generated_at: "2026-06-01T00:00:00.000Z",
    target_root: targetRoot,
    audit_root: path.join(targetRoot, "docs", "audit"),
    cycles: [
      {
        cycle_id: "C101",
        session_id: "S101",
        state: "COMMITTING",
        outcome: null,
        branch_name: "feature/reanchor",
        dor_state: "ready",
        updated_at: "2026-06-01T12:00:00.000Z",
      },
    ],
    sessions: [
      {
        session_id: "S101",
        branch_name: "feature/reanchor",
        state: "ACTIVE",
        owner: "codex",
        started_at: "2026-06-01T11:00:00.000Z",
        ended_at: null,
        source_artifact_path: "sessions/S101-runtime-reanchor.md",
        source_confidence: 1,
        source_mode: "explicit",
        updated_at: "2026-06-01T12:01:00.000Z",
      },
    ],
    artifacts: [
      {
        path: "CURRENT-STATE.md",
        kind: "other",
        family: "normative",
        subtype: "current_state",
        content_format: "utf8",
        content: current,
        canonical_format: null,
        canonical: null,
        sha256: sha256Text(current),
        size_bytes: Buffer.byteLength(current, "utf8"),
        mtime_ns: "0",
        session_id: null,
        cycle_id: null,
        source_mode: "explicit",
        entity_confidence: 1,
        legacy_origin: null,
        updated_at: "2026-06-01T00:00:00.000Z",
      },
    ],
    file_map: [],
    tags: [],
    artifact_tags: [],
    run_metrics: [],
    artifact_links: [],
    cycle_links: [],
    session_cycle_links: [
      {
        session_id: "S101",
        cycle_id: "C101",
        relation_type: "owns",
        confidence: 1,
        inference_source: "fixture",
        source_mode: "explicit",
        relation_status: "explicit",
        ambiguity_status: "none",
        updated_at: "2026-06-01T12:01:00.000Z",
      },
    ],
    session_links: [],
    migration_runs: [],
    migration_findings: [],
    repair_decisions: [],
    summary: {
      cycles_count: 1,
      sessions_count: 1,
      artifacts_count: 1,
      file_map_count: 0,
      tags_count: 0,
      run_metrics_count: 0,
      artifact_links_count: 0,
      cycle_links_count: 0,
      session_cycle_links_count: 1,
      session_links_count: 0,
      migration_runs_count: 0,
      migration_findings_count: 0,
      repair_decisions_count: 0,
      structure_kind: "fixture",
      artifacts_with_content_count: 1,
      artifacts_with_canonical_count: 0,
    },
  };
  const store = createRuntimeArtifactStore({
    targetRoot,
    backend: "sqlite",
  });
  await store.writeIndexProjection({
    payload,
  });
}

async function main() {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-state-reanchor-"));
  try {
    writeJson(path.join(targetRoot, ".aidn", "config.json"), {
      version: 1,
      profile: "db-only",
      runtime: {
        stateMode: "db-only",
        persistence: {
          backend: "sqlite",
        },
      },
    });
    await seedRuntimePayload(targetRoot);

    const preview = await stateReanchor({
      target: targetRoot,
      backend: "sqlite",
    });
    assert(preview.status === "ready", "preview should be ready when runtime cycle/session evidence exists");
    assert(preview.write === false, "preview must not write");
    assert(!fs.existsSync(path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md")), "preview must not materialize CURRENT-STATE");

    const written = await stateReanchor({
      target: targetRoot,
      backend: "sqlite",
      write: true,
      reason: "fixture runtime recovery",
    });
    assert(written.status === "reanchored", "write should reanchor");
    assert(written.write === true, "write flag should be effective");
    assert(written.canonical_write.written === true, "canonical projection should be refreshed");
    for (const relativePath of [
      "docs/audit/CURRENT-STATE.md",
      "docs/audit/RUNTIME-STATE.md",
      "docs/audit/HANDOFF-PACKET.md",
    ]) {
      assert(fs.existsSync(path.join(targetRoot, relativePath)), `${relativePath} should be materialized as a recovery anchor`);
    }

    const currentText = fs.readFileSync(path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md"), "utf8");
    assert(currentText.includes("active_session: S101"), "CURRENT-STATE should be reanchored to active session");
    assert(currentText.includes("active_cycle: C101"), "CURRENT-STATE should be reanchored to active cycle");
    assert(currentText.includes("reanchor_status: reanchored"), "CURRENT-STATE should expose reanchor status");

    const store = createRuntimeArtifactStore({
      targetRoot,
      backend: "sqlite",
    });
    const snapshot = await store.loadSnapshot({
      includePayload: true,
      includeRuntimeHeads: true,
    });
    assert((snapshot.runtimeHeads.current_state?.artifact_path ?? snapshot.runtimeHeads.current_state?.path) === "CURRENT-STATE.md", "runtime head should expose reanchored CURRENT-STATE");
    assert((snapshot.runtimeHeads.runtime_state?.artifact_path ?? snapshot.runtimeHeads.runtime_state?.path) === "RUNTIME-STATE.md", "runtime head should expose reanchored RUNTIME-STATE");
    assert((snapshot.runtimeHeads.handoff_packet?.artifact_path ?? snapshot.runtimeHeads.handoff_packet?.path) === "HANDOFF-PACKET.md", "runtime head should expose reanchored HANDOFF-PACKET");
    const dbCurrent = snapshot.payload.artifacts.find((artifact) => artifact.path === "CURRENT-STATE.md");
    assert(dbCurrent?.content?.includes("active_cycle: C101"), "canonical payload should store corrected CURRENT-STATE content");

    console.log("PASS");
  } finally {
    fs.rmSync(targetRoot, { recursive: true, force: true });
  }
}

await main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
