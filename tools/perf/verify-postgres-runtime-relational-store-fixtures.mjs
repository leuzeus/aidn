#!/usr/bin/env node
import path from "node:path";
import { createPostgresRuntimeArtifactStore } from "../../src/adapters/runtime/postgres-runtime-artifact-store.mjs";
import { createRuntimePersistenceFakePgClientFactory } from "./runtime-persistence-fake-pg-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  try {
    const fake = createRuntimePersistenceFakePgClientFactory();
    const store = createPostgresRuntimeArtifactStore({
      targetRoot: "/tmp/runtime-relational-store",
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: fake.factory,
    });

    const payload = {
      schema_version: 2,
      generated_at: "2026-04-08T14:00:00.000Z",
      cycles: [
        {
          cycle_id: "C001",
          session_id: "S001",
          state: "active",
          outcome: null,
          branch_name: "feature/c001",
          dor_state: "ready",
          continuity_rule: "inherit",
          continuity_base_branch: "main",
          continuity_latest_cycle_branch: "feature/c001",
          updated_at: "2026-04-08T14:00:00.000Z",
        },
      ],
      sessions: [
        {
          session_id: "S001",
          branch_name: "feature/c001",
          state: "running",
          owner: "codex",
          parent_session: null,
          branch_kind: "feature",
          cycle_branch: "feature/c001",
          intermediate_branch: null,
          integration_target_cycle: null,
          carry_over_pending: "false",
          started_at: "2026-04-08T13:55:00.000Z",
          ended_at: null,
          source_artifact_path: "CURRENT-STATE.md",
          source_confidence: 1,
          source_mode: "explicit",
          updated_at: "2026-04-08T14:00:00.000Z",
        },
      ],
      artifacts: [
        {
          path: "CURRENT-STATE.md",
          kind: "other",
          family: "runtime",
          subtype: "current_state",
          gate_relevance: 1,
          classification_reason: "runtime-head",
          content_format: "markdown",
          content: "# Current state",
          canonical_format: "json",
          canonical: { state: "active" },
          sha256: "sha-current",
          size_bytes: 15,
          mtime_ns: 123456,
          session_id: "S001",
          cycle_id: "C001",
          source_mode: "explicit",
          entity_confidence: 1,
          legacy_origin: null,
          updated_at: "2026-04-08T14:00:00.000Z",
        },
        {
          path: "HANDOFF-PACKET.md",
          kind: "other",
          family: "runtime",
          subtype: "handoff_packet",
          gate_relevance: 0,
          classification_reason: "runtime-head",
          content_format: "markdown",
          content: "# Handoff",
          canonical_format: "json",
          canonical: { handoff: true },
          sha256: "sha-handoff",
          size_bytes: 9,
          mtime_ns: 654321,
          session_id: "S001",
          cycle_id: "C001",
          source_mode: "explicit",
          entity_confidence: 1,
          legacy_origin: null,
          updated_at: "2026-04-08T14:05:00.000Z",
        },
      ],
      file_map: [
        {
          cycle_id: "C001",
          path: "CURRENT-STATE.md",
          role: "runtime",
          relation: "primary",
          last_seen_at: "2026-04-08T14:00:00.000Z",
        },
      ],
      tags: [
        { tag: "runtime" },
      ],
      artifact_tags: [
        { path: "CURRENT-STATE.md", tag: "runtime" },
      ],
      run_metrics: [
        {
          run_id: "run-001",
          started_at: "2026-04-08T13:55:00.000Z",
          ended_at: "2026-04-08T14:05:00.000Z",
          overhead_ratio: 0.1,
          artifacts_churn: 2,
          gates_frequency: 0.5,
        },
      ],
      artifact_links: [
        {
          source_path: "CURRENT-STATE.md",
          target_path: "HANDOFF-PACKET.md",
          relation_type: "references",
          confidence: 1,
          inference_source: "explicit",
          source_mode: "explicit",
          relation_status: "explicit",
          updated_at: "2026-04-08T14:05:00.000Z",
        },
      ],
      cycle_links: [
        {
          source_cycle_id: "C001",
          target_cycle_id: "C001",
          relation_type: "self",
          confidence: 1,
          inference_source: "explicit",
          source_mode: "explicit",
          relation_status: "explicit",
          updated_at: "2026-04-08T14:05:00.000Z",
        },
      ],
      session_cycle_links: [
        {
          session_id: "S001",
          cycle_id: "C001",
          relation_type: "active",
          confidence: 1,
          inference_source: "explicit",
          source_mode: "explicit",
          relation_status: "explicit",
          ambiguity_status: null,
          updated_at: "2026-04-08T14:05:00.000Z",
        },
      ],
      session_links: [],
      repair_decisions: [
        {
          relation_scope: "artifact_link",
          source_ref: "CURRENT-STATE.md",
          target_ref: "HANDOFF-PACKET.md",
          relation_type: "references",
          decision: "accepted",
          decided_at: "2026-04-08T14:05:00.000Z",
          decided_by: "codex",
          notes: "fixture",
        },
      ],
      migration_runs: [
        {
          migration_run_id: "mig-001",
          engine_version: "2.0.0",
          started_at: "2026-04-08T13:50:00.000Z",
          ended_at: "2026-04-08T14:05:00.000Z",
          status: "completed",
          target_root: "/tmp/runtime-relational-store",
          notes: "fixture",
        },
      ],
      migration_findings: [
        {
          migration_run_id: "mig-001",
          severity: "info",
          finding_type: "parity",
          entity_type: "artifact",
          entity_id: "CURRENT-STATE.md",
          artifact_path: "CURRENT-STATE.md",
          message: "fixture finding",
          confidence: 1,
          suggested_action: "none",
          created_at: "2026-04-08T14:05:00.000Z",
        },
      ],
    };

    await store.writeIndexProjection({
      payload,
      sourceBackend: "sqlite",
      sourceSqliteFile: "/tmp/runtime-relational-store/.aidn/runtime/index/workflow-index.sqlite",
      adoptionStatus: "transferred",
      adoptionMetadata: { planner_action: "transfer-from-sqlite" },
    });

    assert(fake.state.schemaMigrations.includes(1), "expected snapshot schema migration version 1");
    assert(fake.state.schemaMigrations.includes(2), "expected relational schema migration version 2");
    assert(fake.state.runtimeSnapshots.size === 0, "expected no legacy snapshot row during canonical relational writes");
    assert(fake.state.relationalRows.cycles.length === 1, "expected one relational cycle row");
    assert(fake.state.relationalRows.sessions.length === 1, "expected one relational session row");
    assert(fake.state.relationalRows.artifacts.length === 2, "expected relational artifact parity");
    assert(fake.state.relationalRows.file_map.length === 1, "expected relational file_map row");
    assert(fake.state.relationalRows.tags.length === 1, "expected relational tag row");
    assert(fake.state.relationalRows.artifact_tags.length === 1, "expected relational artifact_tag row");
    assert(fake.state.relationalRows.run_metrics.length === 1, "expected relational run_metrics row");
    assert(fake.state.relationalRows.artifact_links.length === 1, "expected relational artifact_link row");
    assert(fake.state.relationalRows.cycle_links.length === 1, "expected relational cycle_link row");
    assert(fake.state.relationalRows.session_cycle_links.length === 1, "expected relational session_cycle_link row");
    assert(fake.state.relationalRows.repair_decisions.length === 1, "expected relational repair_decision row");
    assert(fake.state.relationalRows.migration_runs.length === 1, "expected relational migration_run row");
    assert(fake.state.relationalRows.migration_findings.length === 1, "expected relational migration_finding row");
    assert(fake.state.relationalRows.artifact_blobs.length === 2, "expected relational artifact_blob parity");
    assert(fake.state.relationalRows.runtime_heads.length === 2, "expected relational runtime head parity");
    assert(fake.state.relationalRows.index_meta.some((row) => row.key === "schema_version"), "expected schema_version meta row");
    assert(fake.state.tablesPresent.has("artifacts"), "expected relational artifacts table to be materialized");
    assert(fake.state.tablesPresent.has("runtime_heads"), "expected relational runtime_heads table to be materialized");

    const currentStateHead = fake.state.relationalRows.runtime_heads.find((row) => row.head_key === "current_state");
    assert(currentStateHead?.artifact_id === 1, "expected runtime_heads to retain artifact_id");
    assert(currentStateHead?.session_id === "S001", "expected runtime_heads to retain session_id");
    assert(currentStateHead?.cycle_id === "C001", "expected runtime_heads to retain cycle_id");
    assert(currentStateHead?.kind === "other", "expected runtime_heads to retain kind");
    assert(currentStateHead?.subtype === "current_state", "expected runtime_heads to retain subtype");

    fake.state.runtimeSnapshots.clear();
    const rehydrated = await store.loadSnapshot({
      includePayload: true,
      includeRuntimeHeads: true,
    });
    assert(rehydrated.exists === true, "expected relational snapshot rehydration without legacy snapshot row");
    assert(rehydrated.payload?.target_root === path.resolve("/tmp/runtime-relational-store"), "expected relational payload target_root");
    assert(rehydrated.payload?.summary?.artifacts_count === 2, "expected relational payload summary parity");
    assert(rehydrated.payload?.repair_layer_meta == null, "expected null repair_layer_meta when absent");
    assert(rehydrated.source_backend === "sqlite", "expected relational metadata source_backend parity");
    assert(rehydrated.adoption_status === "transferred", "expected relational metadata adoption_status parity");
    assert(rehydrated.runtimeHeads.current_state?.artifact_id === 1, "expected relational runtime head artifact_id parity");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

await main();
