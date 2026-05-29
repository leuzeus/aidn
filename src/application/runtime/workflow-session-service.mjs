import fs from "node:fs";
import path from "node:path";
import { removePathWithRetry } from "../../lib/fs/remove-path-with-retry.mjs";

export function toRunId(prefix) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  return `${prefix}-${stamp}`;
}

export function readRunIdFile(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    return null;
  }
  const text = fs.readFileSync(absolute, "utf8").trim();
  return text || null;
}

export function writeRunIdFile(filePath, runId) {
  const absolute = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${runId}\n`, "utf8");
  return absolute;
}

export function removeRunIdFile(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  removePathWithRetry(absolute);
  return absolute;
}

export function resolveWorkflowRunId({ phase, runIdFilePath }) {
  const phaseEvent = phase.replace("-", "_");
  const existingRunId = readRunIdFile(runIdFilePath);
  if (phase === "session-close") {
    return existingRunId || toRunId("session");
  }
  return toRunId(`session-${phaseEvent}`);
}

export function persistWorkflowRunId({ phase, runIdFilePath, runId }) {
  if (phase === "session-start") {
    return writeRunIdFile(runIdFilePath, runId);
  }
  if (phase === "session-close") {
    return removeRunIdFile(runIdFilePath);
  }
  return null;
}

export function computeWorkflowHookDurationMs({ startedAtMs, checkpointTotalDurationMs }) {
  const elapsed = Date.now() - startedAtMs;
  const nested = Number(checkpointTotalDurationMs ?? 0);
  if (Number.isFinite(nested) && nested > 0) {
    return Math.max(1, elapsed - nested);
  }
  return Math.max(1, elapsed);
}
