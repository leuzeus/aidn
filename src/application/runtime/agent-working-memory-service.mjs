import fs from "node:fs";
import path from "node:path";
import { persistHookContext, readHookContext } from "../../adapters/codex/context-store.mjs";
import { captureContextIdentity } from "../../adapters/codex/context-provenance.mjs";
import { observeContextCanonicalRevision } from "./context-canonical-revision-service.mjs";
import { sha256 as sha, stableContextJson, validateWorkingMemory as validateMemory,
  memoryFailure as fail, canCaptureWorkingMemory } from "../../core/context/working-memory-policy.mjs";
import { buildContextMetrics, validateContextTelemetry, evaluateContextPressure } from "../../core/context/context-metrics-policy.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import executionResultSchema from "../../core/contracts/agent-execution/result.v1.schema.json" with { type: "json" };

const MAX_BYTES = 64 * 1024;

function agentPaths(targetRoot, agentId) {
  if (typeof agentId !== "string" || !/^[a-zA-Z0-9._-]{1,80}$/.test(agentId)) fail("WORKING_MEMORY_AGENT_INVALID");
  const root = path.join(targetRoot, ".aidn/runtime/context/agents", sha(agentId));
  return { contextFile: path.join(root, "context.json"), rawDir: path.join(root, "raw") };
}

function verifyStoreDirectories(targetRoot, directory) {
  let cursor = path.resolve(targetRoot);
  for (const part of path.relative(cursor, directory).split(path.sep)) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor)) {
      const stat = fs.lstatSync(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail("WORKING_MEMORY_STORE_UNSAFE");
    }
  }
}

// Evidence descriptors use the existing ref/bytes/sha256 vocabulary. All reads
// are bounded regular files inside this checkout, including intermediate paths.
function readLocalFile(targetRoot, ref, limit) {
  if (typeof ref !== "string" || !ref || ref.includes("\\") || ref.includes(":")
      || ref.startsWith("/") || ref.split("/").some(part => !part || part === "." || part === "..")) fail("WORKING_MEMORY_REF_INVALID");
  let cursor = path.resolve(targetRoot);
  for (const part of ref.split("/")) {
    cursor = path.join(cursor, part);
    if (fs.lstatSync(cursor).isSymbolicLink()) fail("WORKING_MEMORY_REF_UNSAFE");
  }
  const stat = fs.statSync(cursor);
  if (!stat.isFile() || stat.size > limit) fail("WORKING_MEMORY_REF_LIMIT");
  const bytes = fs.readFileSync(cursor);
  if (bytes.length > limit) fail("WORKING_MEMORY_REF_LIMIT");
  return bytes;
}

function verifyEvidence(targetRoot, memory) {
  for (const evidence of memory.evidence_refs) {
    const bytes = readLocalFile(targetRoot, evidence.ref, 1024 * 1024);
    if (bytes.length !== evidence.bytes || sha(bytes) !== evidence.sha256) fail("WORKING_MEMORY_EVIDENCE_CHANGED");
  }
}

function buildExecutionHandoff(targetRoot, memory) {
  if (!memory.execution_result_ref) return null;
  const bytes = readLocalFile(targetRoot, memory.execution_result_ref, 1024 * 1024);
  const result = JSON.parse(bytes.toString("utf8"));
  if (validateJsonSchema(result, executionResultSchema, "$", { contractKind: "agent-execution" }).length)
    fail("WORKING_MEMORY_EXECUTION_RESULT_INVALID");
  return { contract_version: "agent-context-handoff.v1", agent_label: memory.agent_id,
    result_ref: memory.execution_result_ref, result_sha256: sha(bytes),
    ...Object.fromEntries(["run_id", "task_id", "attempt_id", "delegation_id", "plan_sha256", "task_contract_sha256",
      "request_sha256", "input_sha", "outcome", "termination_state"].map(key => [key, result[key]])),
    execution_authenticated: false, requires_fresh_execution_admission: true };
}

export async function prepareAgentWorkingMemory({ targetRoot, inputFile, stateMode, readerFactory, telemetryFile = "" }) {
  const bytes = readLocalFile(targetRoot, inputFile, MAX_BYTES);
  const memory = JSON.parse(bytes.toString("utf8"));
  validateMemory(memory);
  verifyEvidence(targetRoot, memory);
  buildExecutionHandoff(targetRoot, memory);
  const telemetryBytes = telemetryFile ? readLocalFile(targetRoot, telemetryFile, MAX_BYTES) : null;
  const telemetry = telemetryBytes ? JSON.parse(telemetryBytes.toString("utf8")) : null;
  if (telemetryBytes) validateContextTelemetry(telemetry);
  const before = captureContextIdentity({ targetRoot, stateMode });
  if (before.status !== "captured") fail("WORKING_MEMORY_REVISION_UNAVAILABLE");
  const canonical = await observeContextCanonicalRevision({ targetRoot, stateMode: before.state_mode, readerFactory });
  return { memory, input_ref: inputFile, input_sha256: sha(bytes), before, canonical,
    telemetry, telemetry_ref: telemetryFile, telemetry_sha256: telemetryBytes ? sha(telemetryBytes) : null };
}

export async function checkpointAgentWorkingMemory({ targetRoot, prepared, checkpoint, admission, write, readerFactory }) {
  if (write !== true) fail("WORKING_MEMORY_WRITE_REQUIRED");
  if (!canCaptureWorkingMemory(checkpoint, admission)) fail("WORKING_MEMORY_CHECKPOINT_REFUSED");
  verifyEvidence(targetRoot, prepared.memory);
  if (sha(readLocalFile(targetRoot, prepared.input_ref, MAX_BYTES)) !== prepared.input_sha256) fail("WORKING_MEMORY_INPUT_CHANGED");
  const after = captureContextIdentity({ targetRoot, stateMode: checkpoint.state_mode });
  if (after.status !== "captured" || prepared.before.fingerprint !== after.fingerprint) fail("WORKING_MEMORY_CONTEXT_CHANGED");
  const canonical = await observeContextCanonicalRevision({ targetRoot, stateMode: after.state_mode, readerFactory });
  if (stableContextJson(canonical) !== stableContextJson(prepared.canonical)) fail("WORKING_MEMORY_CANONICAL_CHANGED");
  if (prepared.telemetry_ref && sha(readLocalFile(targetRoot, prepared.telemetry_ref, MAX_BYTES)) !== prepared.telemetry_sha256)
    fail("CONTEXT_TELEMETRY_CHANGED");
  // Database I/O can yield to another checkout writer. Repeat local checks after
  // that observation and before publishing the advisory capsule.
  if (captureContextIdentity({ targetRoot, stateMode: checkpoint.state_mode }).fingerprint !== after.fingerprint)
    fail("WORKING_MEMORY_CONTEXT_CHANGED");
  verifyEvidence(targetRoot, prepared.memory);
  const finalInput = readLocalFile(targetRoot, prepared.input_ref, MAX_BYTES);
  if (sha(finalInput) !== prepared.input_sha256
      || stableContextJson(JSON.parse(finalInput)) !== stableContextJson(prepared.memory)) fail("WORKING_MEMORY_INPUT_CHANGED");
  const capsule = {
    contract_version: "agent-resume-capsule.v1",
    memory: prepared.memory,
    checkpoint: { run_id: checkpoint.run_id, ts: checkpoint.ts },
    input_ref: prepared.input_ref, input_sha256: prepared.input_sha256,
    observed_revision: after,
    canonical_revision: canonical,
    context_metrics: buildContextMetrics({ memory: prepared.memory, checkpoint, canonical, observedRevision: after,
      telemetry: prepared.telemetry }),
    ...(prepared.memory.execution_result_ref ? { execution_handoff: buildExecutionHandoff(targetRoot, prepared.memory) } : {}),
    source_of_truth: "referenced checkout evidence and agent-authored checkpoint input",
    source_mode: "derived", lifecycle_status: "captured",
    claims_are: "untrusted-agent-assertions", write_authorization: false,
    requires_fresh_admission: true,
  };
  const provenance = {
    kind: "hook-command-observation.v1", before: prepared.before, after,
    command_status: 0, command_signal: null, command_error: false,
    capsule_sha256: sha(JSON.stringify(capsule)),
  };
  const paths = agentPaths(targetRoot, prepared.memory.agent_id);
  verifyStoreDirectories(targetRoot, paths.rawDir);
  if (fs.existsSync(paths.contextFile)) readLocalFile(targetRoot, path.relative(targetRoot, paths.contextFile).replaceAll("\\", "/"), MAX_BYTES * 16);
  const retained = persistHookContext({ targetRoot, ...paths,
    skill: "working-memory", maxEntries: 5, rawPayload: capsule,
    normalized: { ok: true, ts: checkpoint.ts, state_mode: after.state_mode },
    sourceMeta: { command: "checkpoint-working-memory", command_status: 0, provenance },
  });
  return { status: "captured", agent_id: prepared.memory.agent_id, context_file: retained.context_file,
    capsule_file: retained.raw_file, context_metrics: capsule.context_metrics, requires_fresh_admission: true };
}

export async function resumeAgentWorkingMemory({ targetRoot, agentId, stateMode, readerFactory }) {
  const result = (status, reasons, capsule = null) => ({ contract_version: "agent-resume-result.v1",
    agent_id: agentId, status, reasons, requires_fresh_admission: true, capsule,
    context_status: evaluateContextPressure(capsule?.context_metrics?.telemetry) });
  try {
    const paths = agentPaths(targetRoot, agentId);
    const contextRef = path.relative(targetRoot, paths.contextFile).replaceAll("\\", "/");
    if (!fs.existsSync(paths.contextFile)) return result("absent", ["no_checkpoint"]);
    readLocalFile(targetRoot, contextRef, MAX_BYTES * 16);
    const entry = readHookContext({ targetRoot, contextFile: paths.contextFile }).store?.latest?.["working-memory"];
    if (!entry) return result("invalid", ["checkpoint_missing"]);
    const rawRef = path.relative(targetRoot, entry.raw_file).replaceAll("\\", "/");
    if (!entry.raw_file.startsWith(`${paths.rawDir}${path.sep}`)) return result("invalid", ["capsule_scope_mismatch"]);
    const capsule = JSON.parse(readLocalFile(targetRoot, rawRef, MAX_BYTES * 2));
    if (sha(JSON.stringify(capsule)) !== entry.provenance?.capsule_sha256
        || capsule.contract_version !== "agent-resume-capsule.v1" || capsule.memory?.agent_id !== agentId
        || capsule.observed_revision?.fingerprint !== entry.provenance?.after?.fingerprint
        || capsule.requires_fresh_admission !== true || capsule.write_authorization === true)
      return result("invalid", ["capsule_integrity_mismatch"]);
    validateMemory(capsule.memory);
    try {
      verifyEvidence(targetRoot, capsule.memory);
      const input = readLocalFile(targetRoot, capsule.input_ref, MAX_BYTES);
      if (sha(input) !== capsule.input_sha256
          || stableContextJson(JSON.parse(input)) !== stableContextJson(capsule.memory)) fail("WORKING_MEMORY_INPUT_CHANGED");
      if (capsule.memory.execution_result_ref && stableContextJson(buildExecutionHandoff(targetRoot, capsule.memory)) !== stableContextJson(capsule.execution_handoff))
        fail("WORKING_MEMORY_EXECUTION_RESULT_INVALID");
    }
    catch (error) { return result("invalid_evidence", [error.code === "ENOENT" ? "evidence_missing" : "evidence_changed_or_unsafe"]); }
    const current = captureContextIdentity({ targetRoot, stateMode });
    if (current.status !== "captured" || current.fingerprint !== capsule.observed_revision.fingerprint
        || entry.provenance?.before?.fingerprint !== current.fingerprint
        || entry.command_status !== 0 || entry.ok !== true
        || entry.provenance?.command_status !== 0 || entry.provenance?.command_signal != null
        || entry.provenance?.command_error === true) return result("stale", ["context_changed_since_checkpoint"]);
    let canonical;
    try { canonical = await observeContextCanonicalRevision({ targetRoot, stateMode: current.state_mode, readerFactory }); }
    catch { return result("stale", ["canonical_runtime_revision_unavailable"]); }
    // Historical files-only capsules remain readable; DB observations never
    // reuse them, and a configured PostgreSQL backend always takes precedence.
    const captured = capsule.canonical_revision ?? { backend: "files", revision: null };
    if (stableContextJson(canonical) !== stableContextJson(captured)) return result("stale", ["canonical_runtime_revision_changed"]);
    // Recheck checkout evidence after asynchronous backend I/O as well.
    if (captureContextIdentity({ targetRoot, stateMode }).fingerprint !== current.fingerprint)
      return result("stale", ["context_changed_during_resume"]);
    try {
      verifyEvidence(targetRoot, capsule.memory);
      if (sha(readLocalFile(targetRoot, capsule.input_ref, MAX_BYTES)) !== capsule.input_sha256)
        return result("invalid_evidence", ["input_changed_during_resume"]);
    } catch { return result("invalid_evidence", ["evidence_changed_during_resume"]); }
    return result("current", [], capsule);
  } catch {
    // Advisory data cannot turn corrupt/missing evidence into a reusable summary.
    return result("invalid", ["checkpoint_unreadable_or_invalid"]);
  }
}
