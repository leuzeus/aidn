import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { detectStructureProfile } from "../../lib/workflow/structure-profile-lib.mjs";
import { buildCanonicalFromMarkdown } from "../../lib/workflow/markdown-render-lib.mjs";
import { assertArtifactProjector } from "../../core/ports/artifact-projector-port.mjs";

function walkFiles(rootDir) {
  const files = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
      }
    }
  }
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function sha256Buffer(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function encodeArtifactContent(content) {
  const utf8Text = content.toString("utf8");
  if (Buffer.from(utf8Text, "utf8").equals(content)) {
    return {
      content_format: "utf8",
      content: utf8Text,
    };
  }
  return {
    content_format: "base64",
    content: content.toString("base64"),
  };
}

function decodeUtf8OrNull(content) {
  const utf8Text = content.toString("utf8");
  return Buffer.from(utf8Text, "utf8").equals(content) ? utf8Text : null;
}

function toIsoFromStat(stats) {
  return new Date(stats.mtimeMs).toISOString();
}

function normalizeKey(raw) {
  return raw.trim().toLowerCase().replace(/\s+/g, "_");
}

function parseStatusMetadata(content) {
  const wanted = new Set([
    "state",
    "outcome",
    "branch_name",
    "session_owner",
    "dor_state",
    "continuity_rule",
    "continuity_base_branch",
    "continuity_latest_cycle_branch",
    "continuity_decision_by",
    "last_updated",
  ]);
  const result = {};
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_ ]*):\s*(.*)$/);
    if (!match) {
      continue;
    }
    const key = normalizeKey(match[1]);
    if (!wanted.has(key)) {
      continue;
    }
    result[key] = match[2].trim();
  }
  return result;
}

function inferArtifactKind(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized === "baseline/current.md" || normalized === "baseline/history.md") {
    return "baseline";
  }
  if (normalized === "snapshots/context-snapshot.md") {
    return "snapshot";
  }
  if (normalized === "WORKFLOW.md") {
    return "workflow";
  }
  if (normalized === "SPEC.md") {
    return "spec";
  }
  if (/^sessions\/S\d+.*\.md$/.test(normalized)) {
    return "session";
  }
  if (/^cycles\/C\d+.*\/status\.md$/.test(normalized)) {
    return "cycle_status";
  }
  return "other";
}

const CYCLE_NORMATIVE_SUBTYPES = new Set([
  "audit_spec",
  "brief",
  "change_requests",
  "decisions",
  "gap_report",
  "hypotheses",
  "plan",
  "scope",
  "status",
  "traceability",
]);

const ROOT_NORMATIVE_NON_BLOCKING = new Set([
  "CONTINUITY_GATE.md",
  "RULE_STATE_BOUNDARY.md",
  "WORKFLOW_SUMMARY.md",
  "CODEX_ONLINE.md",
  "index.md",
  "glossary.md",
]);

function toSubtypeToken(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unknown";
}

function inferArtifactOwnership(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  const sessionMatch = normalized.match(/^sessions\/(S\d+)\b/i);
  const cycleMatch = normalized.match(/^cycles\/([^/]+)\//i);
  return {
    session_id: sessionMatch ? sessionMatch[1].toUpperCase() : null,
    cycle_id: cycleMatch ? extractCycleId(cycleMatch[1]) : null,
  };
}

function inferOwnershipMetadata(relativePath, ownership) {
  const normalized = relativePath.replace(/\\/g, "/");
  const cycleMatch = normalized.match(/^cycles\/([^/]+)\//i);
  if (ownership?.cycle_id && cycleMatch && !cycleMatch[1].startsWith(`${ownership.cycle_id}-`)) {
    return {
      source_mode: "legacy_repaired",
      entity_confidence: 0.7,
      legacy_origin: "legacy_cycle_dir",
    };
  }
  if (ownership?.session_id || ownership?.cycle_id) {
    return {
      source_mode: "inferred",
      entity_confidence: 0.9,
      legacy_origin: null,
    };
  }
  return {
    source_mode: "explicit",
    entity_confidence: 1.0,
    legacy_origin: null,
  };
}

function inferArtifactClassification(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  const kind = inferArtifactKind(normalized);
  const basename = path.basename(normalized);
  let subtype = toSubtypeToken(basename);
  let family = "unknown";
  let gateRelevance = 0;
  let classificationReason = null;

  if (kind === "baseline" || kind === "snapshot" || kind === "workflow" || kind === "spec" || kind === "session" || kind === "cycle_status") {
    family = "normative";
    gateRelevance = 1;
  } else if (normalized === "baseline/history.md") {
    family = "normative";
    gateRelevance = 1;
    subtype = "baseline_history";
  } else if (ROOT_NORMATIVE_NON_BLOCKING.has(basename) || normalized === "WORKFLOW.md" || normalized === "SPEC.md") {
    family = "normative";
    gateRelevance = 0;
  } else if (normalized.startsWith("cycles/")) {
    const remainder = normalized.slice("cycles/".length);
    if (!remainder.includes("/")) {
      if (basename.toLowerCase() === "cycle-status.md") {
        family = "normative";
        gateRelevance = 1;
        subtype = "cycle_status_index";
      } else if (/^template_/i.test(basename)) {
        family = "support";
        gateRelevance = 0;
        subtype = "cycle_template";
        classificationReason = "CYCLE_TEMPLATE_ARTIFACT";
      } else {
        family = "support";
        gateRelevance = 0;
        classificationReason = "CYCLE_ROOT_SUPPORT_ARTIFACT";
      }
    } else {
      const innerPath = remainder.slice(remainder.indexOf("/") + 1);
      const innerName = path.basename(innerPath);
      const cycleSubtype = toSubtypeToken(innerName);
      subtype = cycleSubtype;
      if (CYCLE_NORMATIVE_SUBTYPES.has(cycleSubtype)) {
        family = "normative";
        gateRelevance = 1;
      } else if (/^template_/i.test(innerName)) {
        family = "support";
        gateRelevance = 0;
        classificationReason = "CYCLE_TEMPLATE_ARTIFACT";
      } else {
        family = "support";
        gateRelevance = 0;
        classificationReason = "CYCLE_SUPPORT_ARTIFACT";
      }
    }
  } else if (normalized.startsWith("sessions/")) {
    if (/^sessions\/S\d+.*\.md$/i.test(normalized)) {
      family = "normative";
      gateRelevance = 1;
      subtype = "session";
    } else {
      family = "support";
      gateRelevance = 0;
      classificationReason = "SESSION_SUPPORT_ARTIFACT";
    }
  } else if (normalized.startsWith("snapshots/")) {
    family = normalized === "snapshots/context-snapshot.md" ? "normative" : "support";
    gateRelevance = normalized === "snapshots/context-snapshot.md" ? 1 : 0;
    if (family === "support") {
      classificationReason = "SNAPSHOT_SUPPORT_ARTIFACT";
    }
  } else if (normalized.startsWith("baseline/")) {
    family = (normalized === "baseline/current.md" || normalized === "baseline/history.md") ? "normative" : "support";
    gateRelevance = (normalized === "baseline/current.md" || normalized === "baseline/history.md") ? 1 : 0;
    if (family === "support") {
      classificationReason = "BASELINE_SUPPORT_ARTIFACT";
    }
  } else if (normalized.startsWith("reports/") || normalized.startsWith("migration/") || normalized.startsWith("backlog/") || normalized.startsWith("incidents/")) {
    family = "support";
    gateRelevance = 0;
    classificationReason = "SUPPORT_ARTIFACT";
  } else {
    family = "support";
    gateRelevance = 0;
    classificationReason = "UNCLASSIFIED_SUPPORT_ARTIFACT";
  }

  return {
    kind,
    family,
    subtype,
    gate_relevance: gateRelevance,
    classification_reason: classificationReason,
  };
}

function extractCycleId(cycleDirName) {
  const match = cycleDirName.match(/(C\d+)/);
  return match ? match[1] : cycleDirName;
}

function extractCycleType(cycleDirName) {
  const cycleId = extractCycleId(cycleDirName);
  if (!cycleDirName.startsWith(`${cycleId}-`)) {
    return null;
  }
  const rest = cycleDirName.slice(cycleId.length + 1);
  const type = rest.split("-")[0];
  return type || null;
}

function buildCycleTables(auditRoot) {
  const cyclesDir = path.join(auditRoot, "cycles");
  if (!fs.existsSync(cyclesDir)) {
    return { cycles: [], fileMap: [], cycleTagPairs: [] };
  }

  const cycles = [];
  const fileMap = [];
  const cycleTagPairs = [];
  const cycleDirs = fs.readdirSync(cyclesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  for (const cycleDirName of cycleDirs) {
    const cyclePath = path.join(cyclesDir, cycleDirName);
    const cycleId = extractCycleId(cycleDirName);
    const cycleType = extractCycleType(cycleDirName);
    const statusPath = path.join(cyclePath, "status.md");
    const statusExists = fs.existsSync(statusPath);
    const statusContent = statusExists ? fs.readFileSync(statusPath, "utf8") : "";
    const metadata = statusExists ? parseStatusMetadata(statusContent) : {};
    const statusStats = statusExists ? fs.statSync(statusPath) : null;

    const cycleRow = {
      cycle_id: cycleId,
      cycle_dir: cycleDirName,
      cycle_type: cycleType,
      session_id: metadata.session_owner ?? null,
      state: metadata.state ?? "UNKNOWN",
      outcome: metadata.outcome ?? null,
      branch_name: metadata.branch_name ?? null,
      dor_state: metadata.dor_state ?? null,
      continuity_rule: metadata.continuity_rule ?? null,
      continuity_base_branch: metadata.continuity_base_branch ?? null,
      continuity_latest_cycle_branch: metadata.continuity_latest_cycle_branch ?? null,
      continuity_decision_by: metadata.continuity_decision_by ?? null,
      updated_at: metadata.last_updated ?? (statusStats ? toIsoFromStat(statusStats) : null),
    };
    cycles.push(cycleRow);

    const files = walkFiles(cyclePath);
    for (const absolutePath of files) {
      const relativeToAudit = path.relative(auditRoot, absolutePath).replace(/\\/g, "/");
      const role = path.basename(absolutePath, path.extname(absolutePath));
      const relation = CYCLE_NORMATIVE_SUBTYPES.has(toSubtypeToken(role)) ? "normative" : "support";
      fileMap.push({
        cycle_id: cycleId,
        path: relativeToAudit,
        role,
        relation,
        last_seen_at: toIsoFromStat(fs.statSync(absolutePath)),
      });
    }

    if (cycleRow.state && cycleRow.state !== "UNKNOWN") {
      cycleTagPairs.push({ cycle_id: cycleId, tag: `state:${cycleRow.state}` });
    }
    if (cycleRow.outcome) {
      cycleTagPairs.push({ cycle_id: cycleId, tag: `outcome:${cycleRow.outcome}` });
    }
    if (cycleRow.continuity_rule) {
      cycleTagPairs.push({ cycle_id: cycleId, tag: `continuity:${cycleRow.continuity_rule}` });
    }
    if (cycleType) {
      cycleTagPairs.push({ cycle_id: cycleId, tag: `type:${cycleType}` });
    }
  }

  return { cycles, fileMap, cycleTagPairs };
}

function buildArtifactRows(auditRoot, options = {}) {
  const embedContent = options.embedContent === true;
  const files = walkFiles(auditRoot);
  const artifacts = [];
  for (const absolutePath of files) {
    const stats = fs.statSync(absolutePath);
    const raw = fs.readFileSync(absolutePath);
    const relativePath = path.relative(auditRoot, absolutePath).replace(/\\/g, "/");
    const ownership = inferArtifactOwnership(relativePath);
    const ownershipMetadata = inferOwnershipMetadata(relativePath, ownership);
    const classification = inferArtifactClassification(relativePath);
    const extension = path.extname(relativePath).toLowerCase();
    const textContent = extension === ".md" ? decodeUtf8OrNull(raw) : null;
    const canonical = textContent
      ? buildCanonicalFromMarkdown(textContent, {
        relativePath,
        classification,
      })
      : null;
    const contentPayload = embedContent
      ? encodeArtifactContent(raw)
      : { content_format: null, content: null };
    artifacts.push({
      path: relativePath,
      kind: classification.kind,
      family: classification.family,
      subtype: classification.subtype,
      gate_relevance: classification.gate_relevance,
      classification_reason: classification.classification_reason,
      sha256: sha256Buffer(raw),
      size_bytes: stats.size,
      mtime_ns: Math.round(stats.mtimeMs * 1_000_000),
      session_id: ownership.session_id,
      cycle_id: ownership.cycle_id,
      source_mode: ownershipMetadata.source_mode,
      entity_confidence: ownershipMetadata.entity_confidence,
      legacy_origin: ownershipMetadata.legacy_origin,
      content_format: contentPayload.content_format,
      content: contentPayload.content,
      canonical_format: canonical?.format ?? null,
      canonical,
      updated_at: toIsoFromStat(stats),
    });
  }
  return artifacts;
}

function buildTags(cycleTagPairs, artifacts) {
  const tagSet = new Set();
  const artifactTagPairs = [];

  for (const pair of cycleTagPairs) {
    tagSet.add(pair.tag);
  }
  for (const artifact of artifacts) {
    const tag = `kind:${artifact.kind}`;
    const familyTag = `family:${artifact.family ?? "unknown"}`;
    const subtypeTag = `subtype:${artifact.subtype ?? "unknown"}`;
    const gateTag = `gate_relevance:${Number(artifact.gate_relevance ?? 0) > 0 ? "yes" : "no"}`;
    tagSet.add(tag);
    tagSet.add(familyTag);
    tagSet.add(subtypeTag);
    tagSet.add(gateTag);
    artifactTagPairs.push({ path: artifact.path, tag });
    artifactTagPairs.push({ path: artifact.path, tag: familyTag });
    artifactTagPairs.push({ path: artifact.path, tag: subtypeTag });
    artifactTagPairs.push({ path: artifact.path, tag: gateTag });
  }

  const tags = Array.from(tagSet).sort((a, b) => a.localeCompare(b)).map((tag) => ({ tag }));
  return { tags, artifactTagPairs };
}

function toNumberOrNull(value) {
  if (value == null) {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildRunMetrics(kpiFilePath) {
  if (!kpiFilePath) {
    return [];
  }
  const absolute = path.resolve(process.cwd(), kpiFilePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`KPI file not found: ${absolute}`);
  }
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    throw new Error(`Invalid KPI JSON in ${absolute}: ${error.message}`);
  }

  const runs = Array.isArray(payload.runs) ? payload.runs : [];
  return runs
    .filter((run) => typeof run?.run_id === "string" && run.run_id.trim().length > 0)
    .map((run) => ({
      run_id: String(run.run_id).trim(),
      started_at: run.started_at ?? null,
      ended_at: run.ended_at ?? null,
      overhead_ratio: toNumberOrNull(run.overhead_ratio),
      artifacts_churn: toNumberOrNull(run.artifacts_churn),
      gates_frequency: toNumberOrNull(run.gates_frequency),
    }));
}

function readTextArtifact(auditRoot, relativePath) {
  const absolute = path.join(auditRoot, relativePath);
  if (!fs.existsSync(absolute)) {
    return null;
  }
  try {
    return fs.readFileSync(absolute, "utf8");
  } catch {
    return null;
  }
}

function extractCycleIdsFromText(text) {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }
  const matches = text.match(/\bC\d+\b/gi) ?? [];
  return Array.from(new Set(matches.map((item) => item.toUpperCase()))).sort((a, b) => a.localeCompare(b));
}

function extractSessionField(text, fieldName) {
  if (typeof text !== "string" || text.length === 0) {
    return null;
  }
  const pattern = new RegExp(`^[-*]?\\s*${fieldName}:\\s*` + "`?([^`\\n]+)`?", "im");
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

function buildRepairLayer(auditRoot, artifacts, cycles, options = {}) {
  const now = new Date().toISOString();
  const targetRoot = options.targetRoot ?? null;
  const sessionsMap = new Map();
  const artifactLinks = [];
  const sessionCycleLinks = [];
  const migrationFindings = [];
  const cycleStatusById = new Map();
  const sessionArtifactById = new Map();
  const knownArtifactPaths = new Set(artifacts.map((artifact) => artifact.path));
  const relationKeys = new Set();
  const findingKeys = new Set();

  for (const artifact of artifacts) {
    if (artifact.kind === "cycle_status" && artifact.cycle_id) {
      cycleStatusById.set(artifact.cycle_id, artifact.path);
    }
    if (artifact.kind === "session" && artifact.session_id) {
      sessionArtifactById.set(artifact.session_id, artifact.path);
    }
  }

  function addSession(row) {
    if (!row?.session_id) {
      return;
    }
    const previous = sessionsMap.get(row.session_id);
    if (!previous) {
      sessionsMap.set(row.session_id, row);
      return;
    }
    sessionsMap.set(row.session_id, {
      ...previous,
      branch_name: previous.branch_name ?? row.branch_name ?? null,
      state: previous.state ?? row.state ?? null,
      owner: previous.owner ?? row.owner ?? null,
      started_at: previous.started_at ?? row.started_at ?? null,
      ended_at: previous.ended_at ?? row.ended_at ?? null,
      source_artifact_path: previous.source_artifact_path ?? row.source_artifact_path ?? null,
      source_confidence: Math.max(Number(previous.source_confidence ?? 0), Number(row.source_confidence ?? 0)),
      source_mode: previous.source_mode === "explicit" ? "explicit" : row.source_mode ?? previous.source_mode,
      updated_at: previous.updated_at ?? row.updated_at ?? now,
    });
  }

  function addArtifactLink(row) {
    if (!row?.source_path || !row?.target_path || !row?.relation_type) {
      return;
    }
    if (!knownArtifactPaths.has(row.source_path) || !knownArtifactPaths.has(row.target_path)) {
      return;
    }
    const key = `${row.source_path}::${row.target_path}::${row.relation_type}`;
    if (relationKeys.has(key)) {
      return;
    }
    relationKeys.add(key);
    artifactLinks.push(row);
  }

  function addSessionCycleLink(row) {
    if (!row?.session_id || !row?.cycle_id || !row?.relation_type) {
      return;
    }
    const key = `session::${row.session_id}::${row.cycle_id}::${row.relation_type}`;
    if (relationKeys.has(key)) {
      return;
    }
    relationKeys.add(key);
    sessionCycleLinks.push(row);
  }

  function addFinding(row) {
    if (!row?.finding_type || !row?.message) {
      return;
    }
    const key = [
      row.finding_type,
      row.entity_type ?? "",
      row.entity_id ?? "",
      row.artifact_path ?? "",
      row.message,
    ].join("::");
    if (findingKeys.has(key)) {
      return;
    }
    findingKeys.add(key);
    migrationFindings.push(row);
  }

  for (const cycle of cycles) {
    if (!cycle?.session_id) {
      continue;
    }
    const statusPath = cycleStatusById.get(cycle.cycle_id) ?? null;
    addSession({
      session_id: cycle.session_id,
      branch_name: cycle.branch_name ?? null,
      state: null,
      owner: cycle.session_id,
      started_at: null,
      ended_at: null,
      source_artifact_path: statusPath,
      source_confidence: 0.8,
      source_mode: "inferred",
      updated_at: cycle.updated_at ?? now,
    });
    addSessionCycleLink({
      session_id: cycle.session_id,
      cycle_id: cycle.cycle_id,
      relation_type: "attached_cycle",
      confidence: 0.9,
      inference_source: "cycle_status_session_owner",
      source_mode: "inferred",
      updated_at: cycle.updated_at ?? now,
    });
  }

  for (const artifact of artifacts) {
    if (artifact.kind === "session" && artifact.session_id) {
      const text = readTextArtifact(auditRoot, artifact.path);
      const attachedCycles = extractCycleIdsFromText(extractSessionField(text, "attached_cycles"));
      const sessionBranch = extractSessionField(text, "session_branch") ?? extractSessionField(text, "branch");
      addSession({
        session_id: artifact.session_id,
        branch_name: sessionBranch,
        state: null,
        owner: artifact.session_id,
        started_at: null,
        ended_at: null,
        source_artifact_path: artifact.path,
        source_confidence: 1.0,
        source_mode: "explicit",
        updated_at: artifact.updated_at ?? now,
      });
      for (const cycleId of attachedCycles) {
        addSessionCycleLink({
          session_id: artifact.session_id,
          cycle_id: cycleId,
          relation_type: "attached_cycle",
          confidence: 1.0,
          inference_source: "session_attached_cycles",
          source_mode: "explicit",
          updated_at: artifact.updated_at ?? now,
        });
        const statusPath = cycleStatusById.get(cycleId);
        if (statusPath) {
          addArtifactLink({
            source_path: artifact.path,
            target_path: statusPath,
            relation_type: "supports_cycle",
            confidence: 0.9,
            inference_source: "session_attached_cycles",
            source_mode: "inferred",
            updated_at: artifact.updated_at ?? now,
          });
        }
      }
      if (!sessionBranch || attachedCycles.length === 0) {
        addFinding({
          migration_run_id: "repair-layer-v1",
          severity: "info",
          finding_type: "SESSION_PARTIAL_METADATA",
          entity_type: "session",
          entity_id: artifact.session_id,
          artifact_path: artifact.path,
          message: "Session artifact is missing session_branch or attached_cycles metadata.",
          confidence: 1.0,
          suggested_action: "Complete session metadata to improve inferred session and cycle links.",
          created_at: artifact.updated_at ?? now,
        });
      }
    }

    if (artifact.cycle_id) {
      const statusPath = cycleStatusById.get(artifact.cycle_id);
      if (statusPath && artifact.path !== statusPath) {
        addArtifactLink({
          source_path: artifact.path,
          target_path: statusPath,
          relation_type: "supports_cycle",
          confidence: artifact.family === "support" ? 0.6 : 0.85,
          inference_source: "cycle_directory_membership",
          source_mode: artifact.source_mode === "legacy_repaired" ? "legacy_repaired" : "inferred",
          updated_at: artifact.updated_at ?? now,
        });
      }
    }

    if (artifact.source_mode === "legacy_repaired" && artifact.cycle_id) {
      addFinding({
        migration_run_id: "repair-layer-v1",
        severity: "warning",
        finding_type: "LEGACY_CYCLE_DIR_REPAIRED",
        entity_type: "cycle",
        entity_id: artifact.cycle_id,
        artifact_path: artifact.path,
        message: "Legacy cycle directory naming was repaired from path ownership.",
        confidence: Number(artifact.entity_confidence ?? 0.7),
        suggested_action: "Normalize the cycle directory layout to modern naming.",
        created_at: artifact.updated_at ?? now,
      });
    }

    if (artifact.kind === "snapshot" || artifact.kind === "baseline") {
      const text = readTextArtifact(auditRoot, artifact.path);
      for (const cycleId of extractCycleIdsFromText(text)) {
        const statusPath = cycleStatusById.get(cycleId);
        if (!statusPath) {
          addFinding({
            migration_run_id: "repair-layer-v1",
            severity: "warning",
            finding_type: "UNRESOLVED_CYCLE_REFERENCE",
            entity_type: "artifact",
            entity_id: artifact.path,
            artifact_path: artifact.path,
            message: `Artifact references cycle ${cycleId} but no cycle status artifact was indexed.`,
            confidence: 0.9,
            suggested_action: "Add or restore the referenced cycle status artifact.",
            created_at: artifact.updated_at ?? now,
          });
          continue;
        }
        addArtifactLink({
          source_path: artifact.path,
          target_path: statusPath,
          relation_type: "summarizes_cycle",
          confidence: artifact.kind === "snapshot" ? 0.85 : 0.75,
          inference_source: artifact.kind === "snapshot" ? "snapshot_cycle_reference" : "baseline_cycle_reference",
          source_mode: "inferred",
          updated_at: artifact.updated_at ?? now,
        });
      }
    }

    if (artifact.session_id) {
      const sessionArtifactPath = sessionArtifactById.get(artifact.session_id);
      if (sessionArtifactPath && artifact.path !== sessionArtifactPath && artifact.path.startsWith(`sessions/${artifact.session_id}`)) {
        addArtifactLink({
          source_path: artifact.path,
          target_path: sessionArtifactPath,
          relation_type: "supports_session",
          confidence: 0.8,
          inference_source: "session_directory_membership",
          source_mode: "inferred",
          updated_at: artifact.updated_at ?? now,
        });
      }
    }

    if (artifact.path === "cycles/cycle-status.md") {
      addFinding({
        migration_run_id: "repair-layer-v1",
        severity: "warning",
        finding_type: "LEGACY_INDEX_PARTIAL_RELATIONS",
        entity_type: "artifact",
        entity_id: artifact.path,
        artifact_path: artifact.path,
        message: "Legacy cycle-status index remains only partially relational.",
        confidence: 0.5,
        suggested_action: "Split the legacy cycle index into per-cycle status artifacts when possible.",
        created_at: artifact.updated_at ?? now,
      });
    }
  }

  const latestObservedAt = artifacts
    .map((artifact) => artifact.updated_at)
    .filter((value) => typeof value === "string" && value.length > 0)
    .sort((a, b) => a.localeCompare(b))
    .at(-1) ?? now;

  return {
    sessions: Array.from(sessionsMap.values()).sort((a, b) => String(a.session_id).localeCompare(String(b.session_id))),
    artifact_links: artifactLinks.sort((a, b) => `${a.source_path}:${a.target_path}:${a.relation_type}`.localeCompare(`${b.source_path}:${b.target_path}:${b.relation_type}`)),
    session_cycle_links: sessionCycleLinks.sort((a, b) => `${a.session_id}:${a.cycle_id}:${a.relation_type}`.localeCompare(`${b.session_id}:${b.cycle_id}:${b.relation_type}`)),
    migration_runs: [{
      migration_run_id: "repair-layer-v1",
      engine_version: "repair-layer-v1",
      started_at: latestObservedAt,
      ended_at: latestObservedAt,
      status: "completed",
      target_root: targetRoot,
      notes: "Deterministic projection-time repair layer.",
    }],
    migration_findings: migrationFindings.sort((a, b) => `${a.finding_type}:${a.entity_id ?? ""}:${a.artifact_path ?? ""}`.localeCompare(`${b.finding_type}:${b.entity_id ?? ""}:${b.artifact_path ?? ""}`)),
  };
}

export function stablePayloadProjection(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  const clone = JSON.parse(JSON.stringify(payload));
  delete clone.generated_at;
  return clone;
}

export function payloadDigest(payload) {
  const stable = stablePayloadProjection(payload);
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export function createArtifactProjectorAdapter() {
  return assertArtifactProjector({
    projectArtifacts({ targetRoot, auditRoot, embedContent = false, kpiFile = "" }) {
      const artifacts = buildArtifactRows(auditRoot, { embedContent });
      const { cycles, fileMap, cycleTagPairs } = buildCycleTables(auditRoot);
      const repairLayer = buildRepairLayer(auditRoot, artifacts, cycles, { targetRoot });
      const { tags, artifactTagPairs } = buildTags(cycleTagPairs, artifacts);
      const runMetrics = buildRunMetrics(kpiFile);
      const structureProfile = detectStructureProfile(auditRoot);

      return {
        structureProfile,
        payload: {
          schema_version: 2,
          generated_at: new Date().toISOString(),
          target_root: targetRoot,
          audit_root: auditRoot,
          structure_profile: structureProfile,
          cycles,
          sessions: repairLayer.sessions,
          artifacts,
          file_map: fileMap,
          tags,
          artifact_tags: artifactTagPairs,
          run_metrics: runMetrics,
          artifact_links: repairLayer.artifact_links,
          cycle_links: [],
          session_cycle_links: repairLayer.session_cycle_links,
          migration_runs: repairLayer.migration_runs,
          migration_findings: repairLayer.migration_findings,
          summary: {
            cycles_count: cycles.length,
            sessions_count: repairLayer.sessions.length,
            artifacts_count: artifacts.length,
            file_map_count: fileMap.length,
            tags_count: tags.length,
            run_metrics_count: runMetrics.length,
            artifact_links_count: repairLayer.artifact_links.length,
            cycle_links_count: 0,
            session_cycle_links_count: repairLayer.session_cycle_links.length,
            migration_runs_count: repairLayer.migration_runs.length,
            migration_findings_count: repairLayer.migration_findings.length,
            structure_kind: structureProfile.kind,
            artifacts_normative_count: artifacts.filter((item) => item.family === "normative").length,
            artifacts_support_count: artifacts.filter((item) => item.family === "support").length,
            artifacts_with_content_count: artifacts.filter((item) => typeof item.content === "string").length,
            artifacts_with_canonical_count: artifacts.filter((item) => item.canonical && typeof item.canonical === "object").length,
          },
        },
      };
    },
  }, "ArtifactProjectorAdapter");
}
