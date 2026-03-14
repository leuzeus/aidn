import fs from "node:fs";
import path from "node:path";
import { readIndexFromSqlite } from "../../lib/sqlite/index-sqlite-lib.mjs";
import { resolveRuntimePath } from "./runtime-path-resolution.mjs";
import { collectRepairLayerSafeAutofixPlan } from "./repair-layer-autofix-plan-lib.mjs";

function detectBackend(indexFile, backend) {
  if (backend === "json" || backend === "sqlite") {
    return backend;
  }
  return String(indexFile).toLowerCase().endsWith(".sqlite") ? "sqlite" : "json";
}

function readJsonIndex(indexFile) {
  const absolute = path.resolve(process.cwd(), indexFile);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Index file not found: ${absolute}`);
  }
  const payload = JSON.parse(fs.readFileSync(absolute, "utf8"));
  return { absolute, payload };
}

function collectOpenFindings(payload) {
  const findings = Array.isArray(payload?.migration_findings) ? payload.migration_findings : [];
  return findings
    .filter((row) => {
      const severity = String(row?.severity ?? "").toLowerCase();
      return severity === "warning" || severity === "error";
    })
    .sort((left, right) => {
      const severityRank = (value) => (String(value ?? "").toLowerCase() === "error" ? 2 : 1);
      const severityDelta = severityRank(right?.severity) - severityRank(left?.severity);
      if (severityDelta !== 0) {
        return severityDelta;
      }
      return `${left?.finding_type ?? ""}:${left?.entity_id ?? ""}:${left?.artifact_path ?? ""}`
        .localeCompare(`${right?.finding_type ?? ""}:${right?.entity_id ?? ""}:${right?.artifact_path ?? ""}`);
    });
}

function buildResolveCommands(targetRoot, indexFile, backend, sessionId, candidates) {
  const base = [
    "node",
    "tools/runtime/repair-layer-resolve.mjs",
    "--target",
    targetRoot,
    "--index-file",
    indexFile,
    "--index-backend",
    backend,
    "--session-id",
    sessionId,
    "--relation-type",
    "attached_cycle",
  ];
  return candidates.map((cycleId) => ({
    cycle_id: cycleId,
    accept: [...base, "--cycle-id", cycleId, "--decision", "accepted", "--apply"].join(" "),
    reject: [...base, "--cycle-id", cycleId, "--decision", "rejected", "--apply"].join(" "),
  }));
}

function buildIndexRefreshCommand(targetRoot, indexFile, backend) {
  const base = [
    "node",
    "tools/perf/index-sync.mjs",
    "--target",
    targetRoot,
  ];
  if (backend === "sqlite") {
    return [...base, "--store", "sqlite", "--sqlite-output", indexFile, "--json"].join(" ");
  }
  return [...base, "--store", "file", "--output", indexFile, "--json"].join(" ");
}

function buildTriageItem(finding, payload, targetRoot, indexFile, backend) {
  const autofixSuggestion = String(finding?.entity_type ?? "") === "session"
    ? (collectRepairLayerSafeAutofixPlan(payload, {
      sessionId: String(finding?.entity_id ?? ""),
    })[0] ?? null)
    : null;
  const item = {
    severity: finding?.severity ?? null,
    finding_type: finding?.finding_type ?? null,
    entity_type: finding?.entity_type ?? null,
    entity_id: finding?.entity_id ?? null,
    artifact_path: finding?.artifact_path ?? null,
    referenced_cycle_id: finding?.referenced_cycle_id ?? null,
    reference_resolution_state: finding?.reference_resolution_state ?? null,
    local_artifact_path: finding?.local_artifact_path ?? null,
    git_tracking: finding?.git_tracking ?? null,
    message: finding?.message ?? null,
    confidence: Number(finding?.confidence ?? 0),
    suggested_action: finding?.suggested_action ?? null,
    next_steps: [],
  };

  if (String(finding?.finding_type ?? "") === "AMBIGUOUS_RELATION" && String(finding?.entity_type ?? "") === "session") {
    const sessionId = String(finding?.entity_id ?? "").trim();
    const ambiguousLinks = (Array.isArray(payload?.session_cycle_links) ? payload.session_cycle_links : [])
      .filter((row) =>
        String(row?.session_id ?? "") === sessionId
        && String(row?.relation_type ?? "") === "attached_cycle"
        && String(row?.ambiguity_status ?? "open") === "open"
      )
      .map((row) => String(row?.cycle_id ?? ""))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    item.next_steps.push({
      kind: "query",
      command: [
        "node",
        "tools/runtime/repair-layer-query.mjs",
        "--target",
        targetRoot,
        "--index-file",
        indexFile,
        "--backend",
        backend,
        "--query",
        "relevant-cycles-for-session",
        "--session-id",
        sessionId,
        "--allow-ambiguous-links",
        "--json",
      ].join(" "),
    });
    if (ambiguousLinks.length > 0) {
      item.next_steps.push({
        kind: "resolve",
        session_id: sessionId,
        candidates: ambiguousLinks,
        commands: buildResolveCommands(targetRoot, indexFile, backend, sessionId, ambiguousLinks),
      });
    }
    if (autofixSuggestion && autofixSuggestion.conflicting_cycle_ids.length > 0) {
      item.next_steps.push({
        kind: "autofix_safe_only",
        command: [
          "node",
          "tools/runtime/repair-layer-autofix.mjs",
          "--target",
          targetRoot,
          "--index-file",
          indexFile,
          "--index-backend",
          backend,
          "--session-id",
          sessionId,
          "--apply",
          "--json",
        ].join(" "),
      });
    }
  }

  if (String(finding?.finding_type ?? "") === "UNRESOLVED_SESSION_CYCLE" && String(finding?.entity_type ?? "") === "session") {
    item.next_steps.push({
      kind: "query",
      command: [
        "node",
        "tools/runtime/repair-layer-query.mjs",
        "--target",
        targetRoot,
        "--index-file",
        indexFile,
        "--backend",
        backend,
        "--query",
        "session-continuity",
        "--session-id",
        String(finding?.entity_id ?? ""),
        "--json",
      ].join(" "),
    });
  }

  if (String(finding?.finding_type ?? "") === "UNINDEXED_CYCLE_STATUS_REFERENCE") {
    item.next_steps.push({
      kind: "refresh_index",
      command: buildIndexRefreshCommand(targetRoot, indexFile, backend),
    });
  }

  return item;
}

export function runRepairLayerTriageUseCase({ args, targetRoot }) {
  const indexFile = resolveRuntimePath(targetRoot, args.indexFile);
  const backend = detectBackend(indexFile, args.backend);
  const index = backend === "sqlite"
    ? readIndexFromSqlite(indexFile)
    : readJsonIndex(indexFile);
  const payload = index.payload && typeof index.payload === "object" ? index.payload : {};
  const openFindings = collectOpenFindings(payload);
  const items = openFindings.map((finding) => buildTriageItem(
    finding,
    payload,
    targetRoot,
    index.absolute,
    backend,
  ));
  const severityCounts = {};
  for (const row of openFindings) {
    const severity = String(row?.severity ?? "unknown").toLowerCase();
    severityCounts[severity] = Number(severityCounts[severity] ?? 0) + 1;
  }
  return {
    ts: new Date().toISOString(),
    target_root: targetRoot,
    index_file: index.absolute,
    backend,
    summary: {
      open_findings_count: openFindings.length,
      severity_counts: severityCounts,
      actionable_count: items.filter((row) => Array.isArray(row.next_steps) && row.next_steps.length > 0).length,
    },
    items,
  };
}
