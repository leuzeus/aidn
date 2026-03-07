#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { runIndexSyncUseCase } from "../../src/application/runtime/index-sync-use-case.mjs";
import { detectStructureProfile } from "./structure-profile-lib.mjs";
import { buildCanonicalFromMarkdown } from "./markdown-render-lib.mjs";
import {
  normalizeIndexStoreMode,
} from "../aidn-config-lib.mjs";

const PERF_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const envStore = String(process.env.AIDN_INDEX_STORE_MODE ?? "").trim().toLowerCase();
  const envStateMode = String(process.env.AIDN_STATE_MODE ?? "").trim().toLowerCase();
  const envEmbedContent = String(process.env.AIDN_EMBED_ARTIFACT_CONTENT ?? "").trim().toLowerCase();
  const args = {
    target: ".",
    output: ".aidn/runtime/index/workflow-index.json",
    store: envStore || "",
    stateMode: envStateMode || "files",
    storeExplicit: false,
    sqlOutput: ".aidn/runtime/index/workflow-index.sql",
    sqliteOutput: ".aidn/runtime/index/workflow-index.sqlite",
    schemaFile: path.join(PERF_DIR, "sql", "schema.sql"),
    includeSchema: true,
    embedContent: envEmbedContent === "1" || envEmbedContent === "true" || envEmbedContent === "yes",
    embedContentExplicit: false,
    kpiFile: "",
    includePayload: false,
    json: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--output") {
      args.output = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--store") {
      args.store = argv[i + 1] ?? "";
      args.storeExplicit = true;
      i += 1;
    } else if (token === "--sql-output") {
      args.sqlOutput = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--sqlite-output") {
      args.sqliteOutput = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--schema-file") {
      args.schemaFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--no-schema") {
      args.includeSchema = false;
    } else if (token === "--with-content") {
      args.embedContent = true;
      args.embedContentExplicit = true;
    } else if (token === "--no-content") {
      args.embedContent = false;
      args.embedContentExplicit = true;
    } else if (token === "--kpi-file") {
      args.kpiFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--include-payload") {
      args.includePayload = true;
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

  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  if (!args.output) {
    throw new Error("Missing value for --output");
  }
  args.stateMode = String(args.stateMode ?? "").trim().toLowerCase() || "files";
  if (!["files", "dual", "db-only"].includes(args.stateMode)) {
    throw new Error("Invalid AIDN_STATE_MODE. Expected files|dual|db-only");
  }
  if (!args.store) {
    if (args.stateMode === "dual") {
      args.store = "dual-sqlite";
    } else if (args.stateMode === "db-only") {
      args.store = "sqlite";
    } else {
      args.store = "file";
    }
  }
  if (!args.embedContentExplicit) {
    args.embedContent = args.stateMode === "dual" || args.stateMode === "db-only";
  }
  args.store = String(args.store).toLowerCase();
  if (!["file", "sql", "dual", "sqlite", "dual-sqlite", "all"].includes(args.store)) {
    throw new Error(`Invalid --store mode: ${args.store}. Expected file|sql|dual|sqlite|dual-sqlite|all.`);
  }
  if ((args.store === "sql" || args.store === "dual" || args.store === "all") && !args.sqlOutput) {
    throw new Error("Missing value for --sql-output");
  }
  if ((args.store === "sqlite" || args.store === "dual-sqlite" || args.store === "all") && !args.sqliteOutput) {
    throw new Error("Missing value for --sqlite-output");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/index-sync.mjs --target ../client");
  console.log("  AIDN_INDEX_STORE_MODE=sqlite node tools/perf/index-sync.mjs --target ../client");
  console.log("  AIDN_STATE_MODE=dual node tools/perf/index-sync.mjs --target ../client");
  console.log("  AIDN_STATE_MODE=db-only node tools/perf/index-sync.mjs --target ../client");
  console.log("  node tools/perf/index-sync.mjs --target . --output .aidn/runtime/index/workflow-index.json");
  console.log("  node tools/perf/index-sync.mjs --target . --store dual --output .aidn/runtime/index/workflow-index.json --sql-output .aidn/runtime/index/workflow-index.sql");
  console.log("  node tools/perf/index-sync.mjs --target . --store sqlite --sqlite-output .aidn/runtime/index/workflow-index.sqlite");
  console.log("  node tools/perf/index-sync.mjs --target . --store all --output .aidn/runtime/index/workflow-index.json --sql-output .aidn/runtime/index/workflow-index.sql --sqlite-output .aidn/runtime/index/workflow-index.sqlite");
  console.log("  node tools/perf/index-sync.mjs --target . --store dual --kpi-file .aidn/runtime/perf/kpi-report.json");
  console.log("  node tools/perf/index-sync.mjs --target . --with-content");
  console.log("  node tools/perf/index-sync.mjs --target . --no-content");
  console.log("  node tools/perf/index-sync.mjs --target . --json --include-payload");
  console.log("  node tools/perf/index-sync.mjs --target . --json");
  console.log("  node tools/perf/index-sync.mjs --target . --json --dry-run");
}

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
    artifactTagPairs.push({
      path: artifact.path,
      tag,
    });
    artifactTagPairs.push({
      path: artifact.path,
      tag: familyTag,
    });
    artifactTagPairs.push({
      path: artifact.path,
      tag: subtypeTag,
    });
    artifactTagPairs.push({
      path: artifact.path,
      tag: gateTag,
    });
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

function stablePayloadProjection(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  const clone = JSON.parse(JSON.stringify(payload));
  delete clone.generated_at;
  return clone;
}

function payloadDigest(payload) {
  const stable = stablePayloadProjection(payload);
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const result = runIndexSyncUseCase({
      args,
      targetRoot,
      buildPayload({ targetRoot: resolvedTargetRoot, auditRoot, embedContent, kpiFile }) {
        const artifacts = buildArtifactRows(auditRoot, { embedContent });
        const { cycles, fileMap, cycleTagPairs } = buildCycleTables(auditRoot);
        const { tags, artifactTagPairs } = buildTags(cycleTagPairs, artifacts);
        const runMetrics = buildRunMetrics(kpiFile);
        const structureProfile = detectStructureProfile(auditRoot);

        return {
          structureProfile,
          payload: {
            schema_version: 1,
            generated_at: new Date().toISOString(),
            target_root: resolvedTargetRoot,
            audit_root: auditRoot,
            structure_profile: structureProfile,
            cycles,
            artifacts,
            file_map: fileMap,
            tags,
            artifact_tags: artifactTagPairs,
            run_metrics: runMetrics,
            summary: {
              cycles_count: cycles.length,
              artifacts_count: artifacts.length,
              file_map_count: fileMap.length,
              tags_count: tags.length,
              run_metrics_count: runMetrics.length,
              structure_kind: structureProfile.kind,
              artifacts_normative_count: artifacts.filter((item) => item.family === "normative").length,
              artifacts_support_count: artifacts.filter((item) => item.family === "support").length,
              artifacts_with_content_count: artifacts.filter((item) => typeof item.content === "string").length,
              artifacts_with_canonical_count: artifacts.filter((item) => item.canonical && typeof item.canonical === "object").length,
            },
          },
        };
      },
      payloadDigest,
    });

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`Index synced.`);
    console.log(`Target: ${result.target_root}`);
    console.log(`State mode: ${result.state_mode}`);
    console.log(`Embed content: ${result.embed_content ? "yes" : "no"}`);
    console.log(`Payload digest: ${result.payload_digest}`);
    if (result.dry_run) {
      console.log("Dry-run mode: no files written.");
    }
    for (const out of result.outputs) {
      const state = out.written ? "updated" : "unchanged";
      console.log(`Output (${out.kind}, ${state}): ${out.path}`);
    }
    console.log(
      `Summary: cycles=${result.summary.cycles_count}, artifacts=${result.summary.artifacts_count}, file_map=${result.summary.file_map_count}, tags=${result.summary.tags_count}, run_metrics=${result.summary.run_metrics_count}`,
    );
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
