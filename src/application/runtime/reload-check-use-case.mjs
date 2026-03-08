import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { detectStructureProfile } from "../../lib/workflow/structure-profile-lib.mjs";
import { readIndexFromSqlite } from "../../lib/sqlite/index-sqlite-lib.mjs";
import { readAidnProjectConfig, resolveConfigStateMode } from "../../lib/config/aidn-config-lib.mjs";
import { resolveRuntimeTargetPath, writeRuntimeJsonFile } from "./runtime-path-service.mjs";
import { createLocalGitAdapter } from "../../adapters/runtime/local-git-adapter.mjs";
import { decideReloadOutcome } from "../../core/workflow/reload-policy.mjs";

const ACTIVE_STATES = new Set(["OPEN", "IMPLEMENTING", "VERIFYING"]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function statFingerprint(stats) {
  const mtimeNs = Math.round(Number(stats.mtimeMs ?? 0) * 1_000_000);
  const size = Number(stats.size ?? 0);
  return `stat:${size}:${mtimeNs}`;
}

function sha256File(filePath) {
  const stats = fs.statSync(filePath);
  return statFingerprint(stats);
}

function readTextSafe(filePath) {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function decodeArtifactContent(artifact) {
  if (typeof artifact?.content !== "string") {
    return null;
  }
  const format = String(artifact?.content_format ?? "utf8").toLowerCase();
  if (format === "utf8") {
    return artifact.content;
  }
  if (format === "base64") {
    return Buffer.from(artifact.content, "base64").toString("utf8");
  }
  return null;
}

function detectBackend(indexFile, backend) {
  if (backend === "json" || backend === "sqlite") {
    return backend;
  }
  return String(indexFile).toLowerCase().endsWith(".sqlite") ? "sqlite" : "json";
}

function readJsonIndex(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Index JSON not found: ${absolute}`);
  }
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON index file ${absolute}: ${error.message}`);
  }
  return { absolute, payload };
}

function readIndexPayload(indexFile, indexBackend) {
  const backend = detectBackend(indexFile, indexBackend);
  if (backend === "sqlite") {
    const out = readIndexFromSqlite(indexFile);
    return {
      backend,
      absolute: out.absolute,
      payload: out.payload,
    };
  }
  const out = readJsonIndex(indexFile);
  return {
    backend,
    absolute: out.absolute,
    payload: out.payload,
  };
}

function parseFrontMatterLike(content) {
  const result = {};
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_ ]*):\s*(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1].trim().toLowerCase().replace(/\s+/g, "_");
    result[key] = match[2].trim();
  }
  return result;
}

function walkCycleStatusFiles(auditRoot) {
  const cyclesRoot = path.join(auditRoot, "cycles");
  if (!fs.existsSync(cyclesRoot)) {
    return [];
  }

  const out = [];
  const cycleDirs = fs.readdirSync(cyclesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  for (const cycleDir of cycleDirs) {
    const statusPath = path.join(cyclesRoot, cycleDir, "status.md");
    if (!fs.existsSync(statusPath)) {
      continue;
    }
    const text = readTextSafe(statusPath);
    const meta = parseFrontMatterLike(text);
    const state = String(meta.state ?? "UNKNOWN").toUpperCase();
    const cycleIdMatch = cycleDir.match(/(C\d+)/);
    const cycleId = cycleIdMatch ? cycleIdMatch[1] : cycleDir;
    out.push({
      cycle_id: cycleId,
      cycle_dir: cycleDir,
      status_path: statusPath,
      status_rel: path.relative(auditRoot, statusPath).replace(/\\/g, "/"),
      state,
      branch_name: meta.branch_name ?? null,
      session_owner: meta.session_owner ?? null,
      status_hash: sha256File(statusPath),
    });
  }
  return out;
}

function detectLatestSessionArtifact(auditRoot) {
  const sessionsRoot = path.join(auditRoot, "sessions");
  if (!fs.existsSync(sessionsRoot)) {
    return null;
  }
  const candidates = fs.readdirSync(sessionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^S\d+.*\.md$/i.test(entry.name))
    .map((entry) => path.join(sessionsRoot, entry.name));
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const latest = candidates[0];
  const text = readTextSafe(latest);
  const meta = parseFrontMatterLike(text);
  return {
    path: latest,
    rel: path.relative(auditRoot, latest).replace(/\\/g, "/"),
    hash: sha256File(latest),
    session_branch: meta.session_branch ?? null,
  };
}

function classifyBranch(branch) {
  if (!branch || branch === "unknown") {
    return "unknown";
  }
  if (/^S[0-9]+-/.test(branch)) {
    return "session";
  }
  if (/^(feature|hotfix|spike|refactor|structural|migration|security|perf|integration|compat|corrective)\/C[0-9]+-I[0-9]+-/.test(branch)) {
    return "intermediate";
  }
  if (/^(feature|hotfix|spike|refactor|structural|migration|security|perf|integration|compat|corrective)\/C[0-9]+-/.test(branch)) {
    return "cycle";
  }
  return "other";
}

function evaluateMapping(branch, activeCycles, latestSessionArtifact, auditRoot, sessionBranchHint = null) {
  const kind = classifyBranch(branch);
  if (kind === "unknown" || kind === "other") {
    return {
      kind,
      status: "unknown",
      reason_code: "MAPPING_SKIPPED_BRANCH_KIND",
    };
  }

  if (kind === "cycle") {
    const matches = activeCycles.filter((cycle) => cycle.branch_name === branch);
    if (matches.length === 1) {
      return { kind, status: "ok", reason_code: null };
    }
    if (matches.length === 0) {
      return { kind, status: "missing", reason_code: "MAPPING_MISSING" };
    }
    return { kind, status: "ambiguous", reason_code: "MAPPING_AMBIGUOUS" };
  }

  if (kind === "intermediate") {
    const cycleIdMatch = branch.match(/\/(C[0-9]+)-I[0-9]+-/);
    if (!cycleIdMatch) {
      return { kind, status: "ambiguous", reason_code: "MAPPING_AMBIGUOUS" };
    }
    const cycleId = cycleIdMatch[1];
    const matches = activeCycles.filter((cycle) => cycle.cycle_id === cycleId);
    if (matches.length === 1) {
      return { kind, status: "ok", reason_code: null };
    }
    if (matches.length === 0) {
      return { kind, status: "missing", reason_code: "MAPPING_MISSING" };
    }
    return { kind, status: "ambiguous", reason_code: "MAPPING_AMBIGUOUS" };
  }

  if (kind === "session") {
    if (!latestSessionArtifact) {
      return { kind, status: "unknown", reason_code: "MAPPING_SESSION_FILE_MISSING" };
    }
    const sessionBranch = sessionBranchHint ?? (() => {
      const fullPath = path.join(auditRoot, latestSessionArtifact.rel);
      const text = readTextSafe(fullPath);
      const meta = parseFrontMatterLike(text);
      return meta.session_branch ?? null;
    })();
    if (!sessionBranch) {
      return { kind, status: "unknown", reason_code: "MAPPING_SESSION_BRANCH_UNSET" };
    }
    if (sessionBranch === branch) {
      return { kind, status: "ok", reason_code: null };
    }
    return { kind, status: "missing", reason_code: "MAPPING_MISSING" };
  }

  return { kind, status: "unknown", reason_code: "MAPPING_SKIPPED" };
}

function canonicalStateForDigest(state) {
  return JSON.stringify(state);
}

function collectCurrentStateFromFiles(targetRoot, gitAdapter) {
  const auditRoot = path.join(targetRoot, "docs", "audit");
  if (!fs.existsSync(auditRoot)) {
    throw new Error(`Missing audit root: ${auditRoot}`);
  }
  const structureProfile = detectStructureProfile(auditRoot);
  const requiredArtifactPaths = Array.isArray(structureProfile.recommended_required_artifacts)
    ? structureProfile.recommended_required_artifacts
    : [];
  const optionalTrackedPaths = Array.isArray(structureProfile.optional_tracked_artifacts)
    ? structureProfile.optional_tracked_artifacts
    : [];

  const branch = gitAdapter.getCurrentBranch(targetRoot);
  const headCommit = gitAdapter.getHeadCommit(targetRoot);
  const cycleStatuses = walkCycleStatusFiles(auditRoot);
  const activeCycles = cycleStatuses.filter((cycle) => ACTIVE_STATES.has(cycle.state));
  const latestSession = detectLatestSessionArtifact(auditRoot);

  const requiredArtifacts = [];
  const missingRequiredArtifacts = [];
  for (const relative of requiredArtifactPaths) {
    const absolute = path.join(auditRoot, relative);
    if (!fs.existsSync(absolute)) {
      missingRequiredArtifacts.push(relative);
      continue;
    }
    const stats = fs.statSync(absolute);
    requiredArtifacts.push({
      rel: relative,
      path: absolute,
      hash: sha256File(absolute),
      size_bytes: stats.size,
      mtime_ns: Math.round(stats.mtimeMs * 1_000_000),
    });
  }

  const trackedArtifacts = [...requiredArtifacts];
  const trackedRel = new Set(trackedArtifacts.map((item) => item.rel));
  for (const relative of optionalTrackedPaths) {
    if (trackedRel.has(relative)) {
      continue;
    }
    const absolute = path.join(auditRoot, relative);
    if (!fs.existsSync(absolute)) {
      continue;
    }
    const stats = fs.statSync(absolute);
    trackedArtifacts.push({
      rel: relative,
      path: absolute,
      hash: sha256File(absolute),
      size_bytes: stats.size,
      mtime_ns: Math.round(stats.mtimeMs * 1_000_000),
    });
    trackedRel.add(relative);
  }
  for (const cycle of activeCycles) {
    const stats = fs.statSync(cycle.status_path);
    trackedArtifacts.push({
      rel: cycle.status_rel,
      path: cycle.status_path,
      hash: cycle.status_hash,
      size_bytes: stats.size,
      mtime_ns: Math.round(stats.mtimeMs * 1_000_000),
    });
  }
  if (latestSession) {
    const fullPath = path.join(auditRoot, latestSession.rel);
    const stats = fs.statSync(fullPath);
    trackedArtifacts.push({
      rel: latestSession.rel,
      path: fullPath,
      hash: latestSession.hash,
      size_bytes: stats.size,
      mtime_ns: Math.round(stats.mtimeMs * 1_000_000),
    });
  }
  trackedArtifacts.sort((a, b) => a.rel.localeCompare(b.rel));

  const digestInput = {
    branch,
    head_commit: headCommit,
    structure_profile: {
      kind: structureProfile.kind,
      declared_workflow_version: structureProfile.declared_workflow_version,
      observed_version_hint: structureProfile.observed_version_hint,
    },
    required_artifacts: requiredArtifacts.map((item) => ({ rel: item.rel, hash: item.hash })),
    session_artifact: latestSession ? { rel: latestSession.rel, hash: latestSession.hash } : null,
    active_cycles: activeCycles
      .map((cycle) => ({
        cycle_id: cycle.cycle_id,
        state: cycle.state,
        branch_name: cycle.branch_name ?? "",
        status_hash: cycle.status_hash,
      }))
      .sort((a, b) => a.cycle_id.localeCompare(b.cycle_id)),
  };

  const reloadDigest = sha256(canonicalStateForDigest(digestInput));
  const mapping = evaluateMapping(
    branch,
    activeCycles,
    latestSession,
    auditRoot,
    latestSession?.session_branch ?? null,
  );

  return {
    collected_at: new Date().toISOString(),
    target_root: targetRoot,
    audit_root: auditRoot,
    branch,
    head_commit: headCommit,
    mapping,
    required_artifacts: requiredArtifacts.map((item) => ({
      rel: item.rel,
      hash: item.hash,
      size_bytes: item.size_bytes,
      mtime_ns: item.mtime_ns,
    })),
    tracked_artifacts: trackedArtifacts.map((item) => ({
      rel: item.rel,
      hash: item.hash,
      size_bytes: item.size_bytes,
      mtime_ns: item.mtime_ns,
    })),
    active_cycles: activeCycles.map((cycle) => ({
      cycle_id: cycle.cycle_id,
      cycle_dir: cycle.cycle_dir,
      state: cycle.state,
      branch_name: cycle.branch_name,
      session_owner: cycle.session_owner,
      status_rel: cycle.status_rel,
      status_hash: cycle.status_hash,
    })),
    session_artifact: latestSession
      ? { rel: latestSession.rel, hash: latestSession.hash }
      : null,
    missing_required_artifacts: missingRequiredArtifacts,
    required_artifacts_policy: requiredArtifactPaths,
    structure_profile: structureProfile,
    reload_digest: reloadDigest,
    state_source: "files",
  };
}

function toIsoTimestamp(value) {
  const ms = Date.parse(String(value ?? ""));
  if (Number.isNaN(ms)) {
    return 0;
  }
  return ms;
}

function readSessionBranchFromArtifact(artifact) {
  const text = decodeArtifactContent(artifact);
  if (!text) {
    return null;
  }
  const meta = parseFrontMatterLike(text);
  return meta.session_branch ?? null;
}

function collectCurrentStateFromIndex(targetRoot, args, gitAdapter) {
  const indexFilePath = resolveRuntimeTargetPath(targetRoot, args.indexFile);
  const index = readIndexPayload(indexFilePath, args.indexBackend);
  const payload = index.payload ?? {};
  const auditRoot = String(payload.audit_root ?? path.join(targetRoot, "docs", "audit"));
  const structureProfile = payload.structure_profile ?? {
    kind: String(payload?.summary?.structure_kind ?? "unknown"),
    declared_workflow_version: null,
    observed_version_hint: null,
    recommended_required_artifacts: [],
    optional_tracked_artifacts: [],
    reason_codes: [],
    notes: [],
    confidence: 0,
  };
  const requiredArtifactPaths = Array.isArray(structureProfile.recommended_required_artifacts)
    ? structureProfile.recommended_required_artifacts
    : [];

  const branch = gitAdapter.getCurrentBranch(targetRoot);
  const headCommit = gitAdapter.getHeadCommit(targetRoot);
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
  const cycles = Array.isArray(payload.cycles) ? payload.cycles : [];

  const artifactMap = new Map();
  for (const artifact of artifacts) {
    const rel = String(artifact?.path ?? "");
    if (!rel) {
      continue;
    }
    artifactMap.set(rel, artifact);
  }

  const requiredArtifacts = [];
  const missingRequiredArtifacts = [];
  for (const relative of requiredArtifactPaths) {
    const artifact = artifactMap.get(relative);
    if (!artifact) {
      missingRequiredArtifacts.push(relative);
      continue;
    }
    requiredArtifacts.push({
      rel: relative,
      path: path.join(auditRoot, relative),
      hash: String(artifact.sha256 ?? ""),
      size_bytes: Number(artifact.size_bytes ?? 0),
      mtime_ns: Number(artifact.mtime_ns ?? 0),
    });
  }

  const trackedArtifacts = artifacts
    .map((artifact) => ({
      rel: String(artifact?.path ?? ""),
      path: path.join(auditRoot, String(artifact?.path ?? "")),
      hash: String(artifact?.sha256 ?? ""),
      size_bytes: Number(artifact?.size_bytes ?? 0),
      mtime_ns: Number(artifact?.mtime_ns ?? 0),
    }))
    .filter((artifact) => artifact.rel.length > 0)
    .sort((a, b) => a.rel.localeCompare(b.rel));

  const statusHashByCycle = new Map();
  const statusRelByCycle = new Map();
  for (const artifact of artifacts) {
    if (String(artifact?.subtype ?? "") !== "status") {
      continue;
    }
    const cycleId = String(artifact?.cycle_id ?? "");
    if (!cycleId) {
      continue;
    }
    statusHashByCycle.set(cycleId, String(artifact?.sha256 ?? ""));
    statusRelByCycle.set(cycleId, String(artifact?.path ?? ""));
  }

  const activeCycles = cycles
    .filter((cycle) => ACTIVE_STATES.has(String(cycle?.state ?? "").toUpperCase()))
    .map((cycle) => ({
      cycle_id: String(cycle?.cycle_id ?? ""),
      cycle_dir: String(cycle?.cycle_dir ?? cycle?.cycle_id ?? ""),
      state: String(cycle?.state ?? "UNKNOWN").toUpperCase(),
      branch_name: cycle?.branch_name ?? null,
      session_owner: cycle?.session_id ?? null,
      status_rel: statusRelByCycle.get(String(cycle?.cycle_id ?? "")) ?? null,
      status_hash: statusHashByCycle.get(String(cycle?.cycle_id ?? "")) ?? "",
    }))
    .filter((cycle) => cycle.cycle_id.length > 0);

  const sessionArtifacts = artifacts
    .filter((artifact) => {
      const rel = String(artifact?.path ?? "");
      return String(artifact?.kind ?? "") === "session" || /^sessions\/S\d+.*\.md$/i.test(rel);
    })
    .sort((a, b) => toIsoTimestamp(b?.updated_at) - toIsoTimestamp(a?.updated_at));
  const latestSessionRaw = sessionArtifacts[0] ?? null;
  const latestSession = latestSessionRaw
    ? {
      rel: String(latestSessionRaw.path ?? ""),
      hash: String(latestSessionRaw.sha256 ?? ""),
    }
    : null;
  const sessionBranch = latestSessionRaw ? readSessionBranchFromArtifact(latestSessionRaw) : null;

  const digestInput = {
    branch,
    head_commit: headCommit,
    structure_profile: {
      kind: structureProfile.kind,
      declared_workflow_version: structureProfile.declared_workflow_version,
      observed_version_hint: structureProfile.observed_version_hint,
    },
    required_artifacts: requiredArtifacts.map((item) => ({ rel: item.rel, hash: item.hash })),
    session_artifact: latestSession ? { rel: latestSession.rel, hash: latestSession.hash } : null,
    active_cycles: activeCycles
      .map((cycle) => ({
        cycle_id: cycle.cycle_id,
        state: cycle.state,
        branch_name: cycle.branch_name ?? "",
        status_hash: cycle.status_hash,
      }))
      .sort((a, b) => a.cycle_id.localeCompare(b.cycle_id)),
  };
  const reloadDigest = sha256(canonicalStateForDigest(digestInput));
  const mapping = evaluateMapping(
    branch,
    activeCycles,
    latestSession,
    auditRoot,
    sessionBranch,
  );

  return {
    collected_at: new Date().toISOString(),
    target_root: targetRoot,
    audit_root: auditRoot,
    branch,
    head_commit: headCommit,
    mapping,
    required_artifacts: requiredArtifacts.map((item) => ({
      rel: item.rel,
      hash: item.hash,
      size_bytes: item.size_bytes,
      mtime_ns: item.mtime_ns,
    })),
    tracked_artifacts: trackedArtifacts.map((item) => ({
      rel: item.rel,
      hash: item.hash,
      size_bytes: item.size_bytes,
      mtime_ns: item.mtime_ns,
    })),
    active_cycles: activeCycles,
    session_artifact: latestSession
      ? { rel: latestSession.rel, hash: latestSession.hash }
      : null,
    missing_required_artifacts: missingRequiredArtifacts,
    required_artifacts_policy: requiredArtifactPaths,
    structure_profile: structureProfile,
    reload_digest: reloadDigest,
    state_source: "index",
    index_backend: index.backend,
    index_file: index.absolute,
  };
}

function collectCurrentState(targetRoot, args, gitAdapter) {
  if (args.stateMode === "files") {
    return collectCurrentStateFromFiles(targetRoot, gitAdapter);
  }
  try {
    return collectCurrentStateFromIndex(targetRoot, args, gitAdapter);
  } catch (error) {
    if (args.stateMode === "dual") {
      const fallback = collectCurrentStateFromFiles(targetRoot, gitAdapter);
      fallback.state_source = "files";
      fallback.state_mode_fallback = "index_unavailable";
      fallback.state_mode_fallback_reason = String(error.message ?? error);
      return fallback;
    }
    throw error;
  }
}

function readCache(cachePath) {
  const absolute = path.resolve(process.cwd(), cachePath);
  if (!fs.existsSync(absolute)) {
    return { exists: false, absolute, data: null };
  }
  try {
    const text = fs.readFileSync(absolute, "utf8");
    const parsed = JSON.parse(text);
    return { exists: true, absolute, data: parsed };
  } catch {
    return { exists: true, absolute, data: null, corrupt: true };
  }
}

function toArtifactMap(artifacts) {
  const map = new Map();
  for (const artifact of artifacts ?? []) {
    const rel = String(artifact.rel ?? "");
    if (!rel) {
      continue;
    }
    map.set(rel, String(artifact.hash ?? ""));
  }
  return map;
}

function diffState(current, cacheData, cacheStatus) {
  const reasonCodes = [];
  const changedArtifacts = [];

  if (!cacheStatus.exists) {
    reasonCodes.push("MISSING_CACHE");
  } else if (cacheStatus.corrupt || !cacheData || typeof cacheData !== "object") {
    reasonCodes.push("CORRUPT_CACHE");
  }

  if (current.missing_required_artifacts.length > 0) {
    reasonCodes.push("REQUIRED_ARTIFACT_MISSING");
  }
  if (current.structure_profile?.kind === "mixed") {
    reasonCodes.push("STRUCTURE_MIXED_PROFILE");
  } else if (current.structure_profile?.kind === "unknown") {
    reasonCodes.push("STRUCTURE_PROFILE_UNKNOWN");
  }
  if (Array.isArray(current.structure_profile?.notes)
    && current.structure_profile.notes.some((note) => /Declared workflow_version looks older/i.test(note))) {
    reasonCodes.push("DECLARED_VERSION_STALE");
  }

  if (current.mapping.status === "ambiguous") {
    reasonCodes.push("MAPPING_AMBIGUOUS");
  } else if (current.mapping.status === "missing") {
    reasonCodes.push("MAPPING_MISSING");
  }
  if (current.state_mode_fallback) {
    reasonCodes.push("STATE_MODE_FALLBACK");
  }

  if (!cacheData || typeof cacheData !== "object") {
    return { reasonCodes, changedArtifacts };
  }

  if (String(cacheData.branch ?? "") !== current.branch) {
    reasonCodes.push("BRANCH_CHANGED");
  }
  if (String(cacheData.head_commit ?? "") !== current.head_commit) {
    reasonCodes.push("HEAD_CHANGED");
  }

  const currentArtifacts = toArtifactMap(current.tracked_artifacts);
  const cachedArtifacts = toArtifactMap(cacheData.tracked_artifacts);

  for (const [rel, hash] of currentArtifacts.entries()) {
    const previous = cachedArtifacts.get(rel);
    if (previous == null || previous !== hash) {
      changedArtifacts.push(rel);
    }
  }
  for (const rel of cachedArtifacts.keys()) {
    if (!currentArtifacts.has(rel)) {
      changedArtifacts.push(rel);
    }
  }

  if (changedArtifacts.length > 0) {
    reasonCodes.push("ARTIFACTS_CHANGED");
  }

  const cachedCycleSet = new Set((cacheData.active_cycles ?? []).map((cycle) => String(cycle.cycle_id)));
  const currentCycleSet = new Set((current.active_cycles ?? []).map((cycle) => String(cycle.cycle_id)));
  if (cachedCycleSet.size !== currentCycleSet.size) {
    reasonCodes.push("ACTIVE_CYCLES_CHANGED");
  } else {
    for (const cycleId of currentCycleSet.values()) {
      if (!cachedCycleSet.has(cycleId)) {
        reasonCodes.push("ACTIVE_CYCLES_CHANGED");
        break;
      }
    }
  }

  if (String(cacheData.reload_digest ?? "") !== current.reload_digest) {
    reasonCodes.push("DIGEST_MISS");
  }
  if (String(cacheData?.structure_profile?.kind ?? "") !== String(current?.structure_profile?.kind ?? "")) {
    reasonCodes.push("STRUCTURE_PROFILE_CHANGED");
  }

  return {
    reasonCodes: Array.from(new Set(reasonCodes)),
    changedArtifacts: Array.from(new Set(changedArtifacts)).sort((a, b) => a.localeCompare(b)),
  };
}

export function printHumanReloadResult(result, cacheFile) {
  console.log(`Decision: ${result.decision}`);
  console.log(`Fallback: ${result.fallback ? "yes" : "no"}`);
  console.log(`Reason codes: ${result.reason_codes.length ? result.reason_codes.join(", ") : "none"}`);
  console.log(`State mode/source: ${result.state_mode}/${result.state_source ?? "unknown"}`);
  console.log(`Branch: ${result.branch}`);
  console.log(`Mapping: ${result.mapping.kind}/${result.mapping.status}`);
  console.log(`Digest: ${result.reload_digest}`);
  console.log(`Changed artifacts: ${result.changed_artifacts.length}`);
  if (result.changed_artifacts.length > 0) {
    for (const rel of result.changed_artifacts) {
      console.log(`- ${rel}`);
    }
  }
  console.log(`Cache file: ${cacheFile}`);
}

export function runReloadCheckUseCase({ args, targetRoot }) {
  const gitAdapter = createLocalGitAdapter();
  if (!args.stateModeExplicit && !String(process.env.AIDN_STATE_MODE ?? "").trim()) {
    const config = readAidnProjectConfig(targetRoot);
    const configStateMode = resolveConfigStateMode(config.data);
    if (configStateMode) {
      args.stateMode = configStateMode;
    }
  }
  if (!["files", "dual", "db-only"].includes(args.stateMode)) {
    throw new Error("Invalid effective state mode. Expected files|dual|db-only");
  }
  args.cache = resolveRuntimeTargetPath(targetRoot, args.cache);
  if (args.stateMode !== "files") {
    args.indexFile = resolveRuntimeTargetPath(targetRoot, args.indexFile);
  }
  const currentState = collectCurrentState(targetRoot, args, gitAdapter);
  const cacheStatus = readCache(args.cache);
  const diff = diffState(currentState, cacheStatus.data, cacheStatus);
  const outcome = decideReloadOutcome(diff.reasonCodes);

  const result = {
    ts: new Date().toISOString(),
    target_root: targetRoot,
    cache_file: cacheStatus.absolute,
    state_mode: args.stateMode,
    state_source: currentState.state_source ?? "unknown",
    state_mode_fallback: currentState.state_mode_fallback ?? null,
    state_mode_fallback_reason: currentState.state_mode_fallback_reason ?? null,
    index_backend: currentState.index_backend ?? null,
    index_file: currentState.index_file ?? null,
    branch: currentState.branch,
    head_commit: currentState.head_commit,
    mapping: currentState.mapping,
    decision: outcome.decision,
    fallback: outcome.fallback,
    reason_codes: diff.reasonCodes,
    changed_artifacts: diff.changedArtifacts,
    active_cycles_count: currentState.active_cycles.length,
    missing_required_artifacts: currentState.missing_required_artifacts,
    required_artifacts_policy: currentState.required_artifacts_policy,
    structure_profile: currentState.structure_profile,
    reload_digest: currentState.reload_digest,
  };

  if (args.writeCache && outcome.decision !== "stop") {
    writeRuntimeJsonFile(args.cache, currentState);
    result.cache_written = true;
  } else {
    result.cache_written = false;
  }

  return result;
}
