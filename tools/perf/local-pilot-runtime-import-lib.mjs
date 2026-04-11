#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function normalizeCandidateRoot(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }
  return path.isAbsolute(normalized)
    ? normalized
    : path.resolve(process.cwd(), normalized);
}

function isPilotRuntimeImportCandidate(candidate) {
  const auditRoot = path.join(candidate, "docs", "audit");
  const currentStateFile = path.join(auditRoot, "CURRENT-STATE.md");
  const runtimeStateFile = path.join(auditRoot, "RUNTIME-STATE.md");
  const handoffFile = path.join(auditRoot, "HANDOFF-PACKET.md");
  const sessionsDir = path.join(auditRoot, "sessions");
  if (![currentStateFile, runtimeStateFile, handoffFile, sessionsDir].every((file) => fs.existsSync(file))) {
    return false;
  }
  const sessionFiles = fs.readdirSync(sessionsDir)
    .filter((name) => /^S\d+.*\.md$/i.test(name))
    .map((name) => path.join(sessionsDir, name));
  if (sessionFiles.length < 2) {
    return false;
  }
  return sessionFiles.some((file) => String(fs.readFileSync(file, "utf8")).includes("## WORK MODE - COMMITTING"));
}

export function resolveLocalPilotRuntimeImportTarget(options = {}) {
  const explicitRoot = normalizeCandidateRoot(options.explicitRoot);
  if (explicitRoot) {
    if (!fs.existsSync(explicitRoot)) {
      return {
        status: "invalid",
        target: null,
        candidates: [],
        reason: `Configured pilot runtime-import root does not exist: ${explicitRoot}`,
      };
    }
    if (!isPilotRuntimeImportCandidate(explicitRoot)) {
      return {
        status: "invalid",
        target: null,
        candidates: [],
        reason: `Configured pilot runtime-import root does not match the expected runtime-import corpus shape: ${explicitRoot}`,
      };
    }
    return {
      status: "configured",
      target: explicitRoot,
      candidates: [explicitRoot],
      reason: null,
    };
  }

  const root = normalizeCandidateRoot(options.searchRoot ?? "tests/fixtures/perf-structure");
  if (!root || !fs.existsSync(root)) {
    return {
      status: "missing",
      target: null,
      candidates: [],
      reason: "No local perf-structure fixture root is available for pilot runtime-import validation",
    };
  }

  const candidates = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }))
    .filter((candidate) => isPilotRuntimeImportCandidate(candidate));

  if (candidates.length === 0) {
    return {
      status: "missing",
      target: null,
      candidates,
      reason: "No local-only pilot runtime-import corpus was discovered",
    };
  }

  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      target: null,
      candidates,
      reason: "Multiple local-only pilot runtime-import corpora were discovered; set AIDN_PILOT_RUNTIME_IMPORT_ROOT to choose one explicitly",
    };
  }

  return {
    status: "discovered",
    target: candidates[0],
    candidates,
    reason: null,
  };
}
