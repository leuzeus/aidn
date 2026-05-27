#!/usr/bin/env node
import { normalizeRepairLayerPayload } from "../../src/application/runtime/repair-layer-normalization-lib.mjs";
import { projectRuntimePayloadToRelationalRows } from "../../src/application/runtime/runtime-relational-projection-service.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function makePayload() {
  const ts = "2026-05-27T12:00:00.000Z";
  return {
    schema_version: 2,
    generated_at: ts,
    cycles: [
      {
        cycle_id: "C001",
        session_id: "S001",
        state: "CLOSED",
        outcome: null,
        branch_name: "feature/c001",
        dor_state: "ready",
        continuity_rule: "inherit",
        continuity_base_branch: "main",
        continuity_latest_cycle_branch: "feature/c001",
        continuity_decision_by: "agent",
        updated_at: ts,
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
        integration_target_cycle: "C001",
        carry_over_pending: "false",
        started_at: null,
        ended_at: null,
        source_artifact_path: "sessions/S001.md",
        source_confidence: 1,
        source_mode: "explicit",
        updated_at: ts,
      },
      {
        session_id: "S001",
        branch_name: "feature/c001",
        state: "running",
        owner: "codex",
        parent_session: null,
        branch_kind: "feature",
        cycle_branch: "feature/c001",
        intermediate_branch: null,
        integration_target_cycle: "C001",
        carry_over_pending: "false",
        started_at: null,
        ended_at: null,
        source_artifact_path: "sessions/S001.md",
        source_confidence: 1,
        source_mode: "explicit",
        updated_at: ts,
      },
      {
        session_id: "S002",
        branch_name: null,
        state: null,
        owner: "S002",
        parent_session: null,
        branch_kind: null,
        cycle_branch: null,
        intermediate_branch: null,
        integration_target_cycle: null,
        carry_over_pending: null,
        started_at: null,
        ended_at: null,
        source_artifact_path: "snapshots/context-snapshot.md",
        source_confidence: 0.7,
        source_mode: "inferred",
        updated_at: ts,
      },
    ],
    artifacts: [
      {
        path: "sessions/S001.md",
        kind: "session",
        family: "normative",
        subtype: "session",
        gate_relevance: 1,
        classification_reason: null,
        content_format: "utf8",
        content: "# Session",
        canonical_format: "json",
        canonical: { session_id: "S001" },
        sha256: "sha-1",
        size_bytes: 12,
        mtime_ns: 1,
        session_id: "S001",
        cycle_id: "C001",
        source_mode: "explicit",
        entity_confidence: 1,
        legacy_origin: null,
        updated_at: ts,
      },
      {
        path: "sessions/S001.md",
        kind: "session",
        family: "normative",
        subtype: "session",
        gate_relevance: 1,
        classification_reason: null,
        content_format: "utf8",
        content: "# Session",
        canonical_format: "json",
        canonical: { session_id: "S001" },
        sha256: "sha-1",
        size_bytes: 12,
        mtime_ns: 1,
        session_id: "S001",
        cycle_id: "C001",
        source_mode: "explicit",
        entity_confidence: 1,
        legacy_origin: null,
        updated_at: ts,
      },
    ],
    file_map: [],
    tags: [
      { tag: "kind:session" },
      { tag: "kind:session" },
      { tag: "" },
    ],
    artifact_tags: [
      { path: "sessions/S001.md", tag: "kind:session" },
      { path: "sessions/S001.md", tag: "kind:session" },
    ],
    run_metrics: [],
    artifact_links: [
      {
        source_path: "sessions/S001.md",
        target_path: "cycles/C001/status.md",
        relation_type: "supports_cycle",
        confidence: 0.8,
        inference_source: "explicit",
        source_mode: "explicit",
        relation_status: "explicit",
        updated_at: ts,
      },
      {
        source_path: "sessions/S001.md",
        target_path: "cycles/C001/status.md",
        relation_type: "supports_cycle",
        confidence: 0.9,
        inference_source: "inferred",
        source_mode: "inferred",
        relation_status: "inferred",
        updated_at: ts,
      },
    ],
    cycle_links: [],
    session_cycle_links: [
      {
        session_id: "S001",
        cycle_id: "C001",
        relation_type: "attached_cycle",
        confidence: 1,
        inference_source: "explicit",
        source_mode: "explicit",
        relation_status: "explicit",
        ambiguity_status: null,
        updated_at: ts,
      },
      {
        session_id: "S001",
        cycle_id: "C001",
        relation_type: "attached_cycle",
        confidence: 1,
        inference_source: "explicit",
        source_mode: "explicit",
        relation_status: "explicit",
        ambiguity_status: null,
        updated_at: ts,
      },
    ],
    session_links: [],
    repair_decisions: [],
    migration_runs: [],
    migration_findings: [],
  };
}

function main() {
  try {
    const sourcePayload = {
      schema_version: 2,
      cycles: [
        {
          cycle_id: "C001",
          session_id: "S001",
          state: "OPEN",
          outcome: null,
          branch_name: "feature/c001",
          dor_state: "ready",
          continuity_rule: "inherit",
          continuity_base_branch: "main",
          continuity_latest_cycle_branch: "feature/c001",
          continuity_decision_by: "agent",
          updated_at: "2026-05-27T12:00:00.000Z",
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
          integration_target_cycle: "C001",
          carry_over_pending: "false",
          started_at: null,
          ended_at: null,
          source_artifact_path: "sessions/S001.md",
          source_confidence: 1,
          source_mode: "explicit",
          updated_at: "2026-05-27T12:00:00.000Z",
        },
      ],
      artifacts: [
        {
          path: "sessions/S001.md",
          kind: "session",
          family: "normative",
          subtype: "session",
          gate_relevance: 1,
          classification_reason: null,
          content_format: "utf8",
          content: "# Session",
          canonical_format: "json",
          canonical: { session_id: "S001" },
          sha256: "sha-1",
          size_bytes: 12,
          mtime_ns: 1,
          session_id: "S001",
          cycle_id: "C001",
          source_mode: "explicit",
          entity_confidence: 1,
          legacy_origin: null,
          updated_at: "2026-05-27T12:00:00.000Z",
        },
      ],
      artifact_links: [
        {
          source_path: "sessions/S001.md",
          target_path: "cycles/C001/status.md",
          relation_type: "supports_cycle",
          confidence: 0.8,
          inference_source: "explicit",
          source_mode: "explicit",
          relation_status: "explicit",
          updated_at: "2026-05-27T12:00:00.000Z",
        },
      ],
      session_cycle_links: [
        {
          session_id: "S001",
          cycle_id: "C001",
          relation_type: "attached_cycle",
          confidence: 1,
          inference_source: "explicit",
          source_mode: "explicit",
          relation_status: "explicit",
          ambiguity_status: null,
          updated_at: "2026-05-27T12:00:00.000Z",
        },
      ],
    };

    const payload = makePayload();
    const normalized = normalizeRepairLayerPayload({
      sourcePayload,
      payload,
      dryRun: true,
    });
    const relationalRows = projectRuntimePayloadToRelationalRows(payload, {
      scopeKey: "G:\\projets\\gowire",
    });

    const summary = normalized.report?.summary ?? {};
    const statuses = normalized.report?.items ?? [];
    const byKey = new Map(statuses.map((row) => [`${row.collection}:${row.key}`, row]));

    assert(Array.isArray(normalized.payload.sessions) && normalized.payload.sessions.length === 2, "expected duplicate sessions to collapse and reconstructed session to remain");
    assert(Array.isArray(normalized.payload.cycles) && normalized.payload.cycles.length === 1, "expected duplicate cycles to collapse");
    assert(Array.isArray(normalized.payload.artifacts) && normalized.payload.artifacts.length === 1, "expected duplicate artifacts to collapse");
    assert(Array.isArray(normalized.payload.artifact_links) && normalized.payload.artifact_links.length === 1, "expected duplicate artifact_links to collapse");
    assert(Array.isArray(normalized.payload.session_cycle_links) && normalized.payload.session_cycle_links.length === 1, "expected duplicate session_cycle_links to collapse");
    assert(Array.isArray(normalized.payload.tags) && normalized.payload.tags.length === 1, "expected invalid tag to be removed and duplicate tag to collapse");
    assert(Number(summary.reconstructed ?? 0) >= 1, "expected at least one reconstructed item");
    assert(Number(summary.inferred ?? 0) >= 1, "expected at least one inferred item");
    assert(Number(summary.conflicted ?? 0) >= 1, "expected at least one conflicted item");
    assert(Number(summary.needs_review ?? 0) >= 1, "expected at least one needs_review item");
    assert(byKey.get("sessions:S002")?.status === "reconstructed", "expected reconstructed session status");
    assert(byKey.get("cycles:C001")?.status === "conflicted", "expected conflicting cycle status");
    assert(byKey.get("tags:")?.status === "needs_review" || statuses.some((row) => row.collection === "tags" && row.status === "needs_review"), "expected needs_review tag status");
    assert(relationalRows.sessions.length === 2, "expected relational projection to retain normalized session count");
    assert(relationalRows.cycles.length === 1, "expected relational projection to retain normalized cycle count");
    assert(relationalRows.artifacts.length === 1, "expected relational projection to retain normalized artifact count");
    assert(relationalRows.artifact_links.length === 1, "expected relational projection to retain normalized artifact link count");
    assert(relationalRows.session_cycle_links.length === 1, "expected relational projection to retain normalized session-cycle link count");
    assert(relationalRows.tags.length === 1, "expected relational projection to retain normalized tag count");
    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
