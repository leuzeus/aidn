import fs from "node:fs";
import path from "node:path";
import {
  normalizeStateMode,
  readAidnProjectConfig,
  resolveConfigStateMode,
} from "../../lib/config/aidn-config-lib.mjs";
import { shouldPreserveDbFirstArtifactPath } from "../../lib/workflow/db-first-artifact-path-policy.mjs";

export function resolveStateMode(targetRoot, requested) {
  const requestedMode = normalizeStateMode(requested);
  if (requestedMode) {
    return requestedMode;
  }
  const envMode = normalizeStateMode(process.env.AIDN_STATE_MODE);
  if (envMode) {
    return envMode;
  }
  const config = readAidnProjectConfig(targetRoot);
  return resolveConfigStateMode(config.data) ?? "files";
}

export function inferKind(relPath, explicitKind) {
  if (explicitKind && explicitKind !== "other") {
    return explicitKind;
  }
  const rel = String(relPath).replace(/\\/g, "/");
  if (rel === "SPEC.md") return "spec";
  if (rel === "WORKFLOW.md") return "workflow";
  if (rel === "snapshots/context-snapshot.md") return "snapshot";
  if (rel === "baseline/current.md" || rel === "baseline/history.md") return "baseline";
  if (/^sessions\/S[0-9]+.*\.md$/i.test(rel)) return "session";
  if (/^cycles\/C[0-9]+.*\/status\.md$/i.test(rel)) return "cycle_status";
  return "other";
}

export function inferFamily(relPath, explicitFamily) {
  if (explicitFamily && explicitFamily !== "unknown") {
    return explicitFamily;
  }
  const rel = String(relPath).replace(/\\/g, "/");
  const normative = new Set([
    "SPEC.md",
    "WORKFLOW.md",
    "WORKFLOW-KERNEL.md",
    "WORKFLOW_SUMMARY.md",
    "CURRENT-STATE.md",
    "RUNTIME-STATE.md",
    "INTEGRATION-RISK.md",
    "HANDOFF-PACKET.md",
    "AGENT-ROSTER.md",
    "AGENT-HEALTH-SUMMARY.md",
    "AGENT-SELECTION-SUMMARY.md",
    "MULTI-AGENT-STATUS.md",
    "COORDINATION-SUMMARY.md",
    "COORDINATION-LOG.md",
    "USER-ARBITRATION.md",
    "baseline/current.md",
    "baseline/history.md",
    "snapshots/context-snapshot.md",
    "CONTINUITY_GATE.md",
    "RULE_STATE_BOUNDARY.md",
    "CODEX_ONLINE.md",
    "index.md",
    "parking-lot.md",
  ]);
  if (normative.has(rel)) {
    return "normative";
  }
  if (rel.startsWith("cycles/") || rel.startsWith("sessions/")) {
    return "normative";
  }
  return "support";
}

export function shouldMaterialize(stateMode, materializeFlag) {
  if (materializeFlag === "true") {
    return true;
  }
  if (materializeFlag === "false") {
    return false;
  }
  return stateMode === "dual" || stateMode === "files";
}

export function loadContent(targetRoot, sourceFile, inlineContent) {
  if (sourceFile) {
    const absolute = path.isAbsolute(sourceFile) ? sourceFile : path.resolve(targetRoot, sourceFile);
    if (!fs.existsSync(absolute)) {
      throw new Error(`Source file not found: ${absolute}`);
    }
    return fs.readFileSync(absolute, "utf8");
  }
  if (inlineContent.length > 0) {
    return inlineContent;
  }
  throw new Error("Missing content source. Use --source-file or --content");
}
