#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";

const ACTIVE_STATES = new Set(["OPEN", "IMPLEMENTING", "VERIFYING"]);
const REQUIRED_ARTIFACTS = [
  "baseline/current.md",
  "snapshots/context-snapshot.md",
  "WORKFLOW.md",
  "SPEC.md",
];

function parseArgs(argv) {
  const args = {
    target: ".",
    cache: ".aidn/runtime/cache/reload-state.json",
    json: false,
    writeCache: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--cache") {
      args.cache = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--write-cache") {
      args.writeCache = true;
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
  if (!args.cache) {
    throw new Error("Missing value for --cache");
  }

  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/reload-check.mjs --target ../client");
  console.log("  node tools/perf/reload-check.mjs --target . --write-cache");
  console.log("  node tools/perf/reload-check.mjs --json");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

function readTextSafe(filePath) {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function getGitValue(targetRoot, command) {
  try {
    const output = execSync(`git -C "${targetRoot}" ${command}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output || "unknown";
  } catch {
    return "unknown";
  }
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
      status_hash: sha256(text),
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
  return {
    path: latest,
    rel: path.relative(auditRoot, latest).replace(/\\/g, "/"),
    hash: sha256(text),
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

function evaluateMapping(branch, activeCycles, latestSessionArtifact, auditRoot) {
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
    const fullPath = path.join(auditRoot, latestSessionArtifact.rel);
    const text = readTextSafe(fullPath);
    const meta = parseFrontMatterLike(text);
    const sessionBranch = meta.session_branch ?? null;
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

function collectCurrentState(targetRoot) {
  const auditRoot = path.join(targetRoot, "docs", "audit");
  if (!fs.existsSync(auditRoot)) {
    throw new Error(`Missing audit root: ${auditRoot}`);
  }

  const branch = getGitValue(targetRoot, "branch --show-current");
  const headCommit = getGitValue(targetRoot, "rev-parse HEAD");
  const cycleStatuses = walkCycleStatusFiles(auditRoot);
  const activeCycles = cycleStatuses.filter((cycle) => ACTIVE_STATES.has(cycle.state));
  const latestSession = detectLatestSessionArtifact(auditRoot);

  const requiredArtifacts = [];
  const missingRequiredArtifacts = [];
  for (const relative of REQUIRED_ARTIFACTS) {
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
  const mapping = evaluateMapping(branch, activeCycles, latestSession, auditRoot);

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
    reload_digest: reloadDigest,
  };
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

  if (current.mapping.status === "ambiguous") {
    reasonCodes.push("MAPPING_AMBIGUOUS");
  } else if (current.mapping.status === "missing") {
    reasonCodes.push("MAPPING_MISSING");
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
    if (previous == null) {
      changedArtifacts.push(rel);
      continue;
    }
    if (previous !== hash) {
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

  return {
    reasonCodes: Array.from(new Set(reasonCodes)),
    changedArtifacts: Array.from(new Set(changedArtifacts)).sort((a, b) => a.localeCompare(b)),
  };
}

function decideOutcome(reasonCodes) {
  const blocking = new Set([
    "REQUIRED_ARTIFACT_MISSING",
    "MAPPING_AMBIGUOUS",
    "MAPPING_MISSING",
  ]);
  if (reasonCodes.some((code) => blocking.has(code))) {
    return {
      decision: "stop",
      fallback: false,
    };
  }
  if (reasonCodes.length === 0) {
    return {
      decision: "incremental",
      fallback: false,
    };
  }
  return {
    decision: "full",
    fallback: true,
  };
}

function writeCache(cachePath, state) {
  const absolute = path.resolve(process.cwd(), cachePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return absolute;
}

function printHuman(result, cacheFile) {
  console.log(`Decision: ${result.decision}`);
  console.log(`Fallback: ${result.fallback ? "yes" : "no"}`);
  console.log(`Reason codes: ${result.reason_codes.length ? result.reason_codes.join(", ") : "none"}`);
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

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const currentState = collectCurrentState(targetRoot);
    const cacheStatus = readCache(args.cache);
    const diff = diffState(currentState, cacheStatus.data, cacheStatus);
    const outcome = decideOutcome(diff.reasonCodes);

    const result = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      cache_file: cacheStatus.absolute,
      branch: currentState.branch,
      head_commit: currentState.head_commit,
      mapping: currentState.mapping,
      decision: outcome.decision,
      fallback: outcome.fallback,
      reason_codes: diff.reasonCodes,
      changed_artifacts: diff.changedArtifacts,
      active_cycles_count: currentState.active_cycles.length,
      missing_required_artifacts: currentState.missing_required_artifacts,
      reload_digest: currentState.reload_digest,
    };

    if (args.writeCache && outcome.decision !== "stop") {
      writeCache(args.cache, currentState);
      result.cache_written = true;
    } else {
      result.cache_written = false;
    }

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    printHuman(result, cacheStatus.absolute);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
