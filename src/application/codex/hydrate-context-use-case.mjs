import fs from "node:fs";
import path from "node:path";
import { readIndexFromSqlite } from "../../lib/sqlite/index-sqlite-lib.mjs";

function resolveTargetPath(targetRoot, candidate) {
  if (!candidate) {
    return "";
  }
  if (path.isAbsolute(candidate)) {
    return path.resolve(candidate);
  }
  return path.resolve(targetRoot, candidate);
}

function decodeArtifactContent(artifact) {
  if (typeof artifact?.content !== "string") {
    return null;
  }
  const format = String(artifact?.content_format ?? "utf8").toLowerCase();
  if (format === "utf8") {
    return Buffer.from(artifact.content, "utf8");
  }
  if (format === "base64") {
    return Buffer.from(artifact.content, "base64");
  }
  return null;
}

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

function selectArtifacts(payload, maxArtifactBytes) {
  const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
  const artifactLinks = Array.isArray(payload?.artifact_links) ? payload.artifact_links : [];
  const priority = new Set([
    "baseline/current.md",
    "snapshots/context-snapshot.md",
    "WORKFLOW.md",
    "SPEC.md",
  ]);
  const activeCycleIds = new Set(
    (Array.isArray(payload?.cycles) ? payload.cycles : [])
      .filter((cycle) => ["OPEN", "IMPLEMENTING", "VERIFYING"].includes(String(cycle?.state ?? "").toUpperCase()))
      .map((cycle) => String(cycle?.cycle_id ?? "")),
  );
  const cycleStatusTargets = new Set();
  const prioritySources = new Set(["baseline/current.md", "baseline/history.md", "snapshots/context-snapshot.md"]);
  for (const row of artifactLinks) {
    const sourcePath = String(row?.source_path ?? "").replace(/\\/g, "/");
    const targetPath = String(row?.target_path ?? "").replace(/\\/g, "/");
    const relationType = String(row?.relation_type ?? "");
    if (!prioritySources.has(sourcePath)) {
      continue;
    }
    if (!["summarizes_cycle", "supports_cycle"].includes(relationType)) {
      continue;
    }
    if (!/\/status\.md$/i.test(targetPath)) {
      continue;
    }
    cycleStatusTargets.add(targetPath);
  }

  const selected = [];
  const seen = new Set();

  const pick = (artifact) => {
    if (!artifact || typeof artifact !== "object") {
      return;
    }
    const rel = String(artifact.path ?? "").replace(/\\/g, "/");
    if (!rel || seen.has(rel)) {
      return;
    }
    seen.add(rel);
    const content = decodeArtifactContent(artifact);
    let excerpt = null;
    if (content) {
      const bytes = content.length > maxArtifactBytes
        ? content.subarray(0, maxArtifactBytes)
        : content;
      excerpt = bytes.toString("utf8");
    }
    selected.push({
      path: rel,
      kind: artifact.kind ?? "other",
      family: artifact.family ?? "unknown",
      cycle_id: artifact.cycle_id ?? null,
      has_content: content != null,
      content_excerpt: excerpt,
      canonical: artifact.canonical ?? null,
    });
  };

  for (const artifact of artifacts) {
    const rel = String(artifact?.path ?? "").replace(/\\/g, "/");
    if (priority.has(rel)) {
      pick(artifact);
    }
  }
  for (const artifact of artifacts) {
    if (activeCycleIds.has(String(artifact?.cycle_id ?? "")) && /\/status\.md$/i.test(String(artifact?.path ?? ""))) {
      pick(artifact);
    }
  }
  for (const artifact of artifacts) {
    const rel = String(artifact?.path ?? "").replace(/\\/g, "/");
    if (cycleStatusTargets.has(rel)) {
      pick(artifact);
    }
  }
  const sessionCandidates = artifacts
    .filter((artifact) => String(artifact?.kind ?? "") === "session")
    .sort((a, b) => String(b?.updated_at ?? "").localeCompare(String(a?.updated_at ?? "")));
  if (sessionCandidates[0]) {
    pick(sessionCandidates[0]);
  }

  return selected;
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function firstStateMode(latest) {
  for (const key of Object.keys(latest)) {
    const mode = latest[key]?.state_mode;
    if (typeof mode === "string" && mode.length > 0) {
      return mode;
    }
  }
  return null;
}

export function runHydrateContextUseCase({ args, hookContextStore, targetRoot }) {
  const context = hookContextStore.readContext({
    targetRoot,
    contextFile: args.contextFile,
  });
  const store = context.exists ? context.store : { latest: {}, history: [] };
  const latest = store.latest && typeof store.latest === "object" ? store.latest : {};
  const history = Array.isArray(store.history) ? store.history : [];
  const filteredHistory = args.skill
    ? history.filter((entry) => String(entry?.skill ?? "") === args.skill)
    : history;
  const recentHistory = filteredHistory.slice(Math.max(0, filteredHistory.length - args.historyLimit));

  const skills = Object.keys(latest).sort((a, b) => a.localeCompare(b));
  const decisionBySkill = {};
  for (const skill of skills) {
    const entry = latest[skill];
    decisionBySkill[skill] = {
      ok: Boolean(entry?.ok),
      mode: entry?.mode ?? "UNKNOWN",
      state_mode: entry?.state_mode ?? "files",
      decision: entry?.decision ?? null,
      action: entry?.action ?? null,
      result: entry?.result ?? null,
      reason_codes: Array.isArray(entry?.reason_codes) ? entry.reason_codes : [],
    };
  }

  const effectiveStateMode = args.skill && latest[args.skill]
    ? String(latest[args.skill]?.state_mode ?? "files")
    : String(firstStateMode(latest) ?? "files");

  let artifactSource = null;
  let selectedArtifacts = [];
  if (args.includeArtifacts) {
    const indexFile = resolveTargetPath(targetRoot, args.indexFile);
    if (fs.existsSync(indexFile)) {
      const backend = detectBackend(indexFile, args.backend);
      const index = backend === "sqlite"
        ? readIndexFromSqlite(indexFile)
        : readJsonIndex(indexFile);
      artifactSource = {
        backend,
        file: index.absolute,
      };
      selectedArtifacts = selectArtifacts(index.payload, args.maxArtifactBytes);
    }
  }

  const hydrated = {
    ts: new Date().toISOString(),
    target_root: targetRoot,
    state_mode: effectiveStateMode,
    context_file: context.context_file,
    requested_skill: args.skill || null,
    decisions: decisionBySkill,
    recent_history: recentHistory,
    artifact_source: artifactSource,
    artifacts: selectedArtifacts,
  };

  if (args.out) {
    const outFile = resolveTargetPath(targetRoot, args.out);
    writeJson(outFile, hydrated);
    hydrated.output_file = outFile;
  }

  return hydrated;
}
