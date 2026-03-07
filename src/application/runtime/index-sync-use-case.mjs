import fs from "node:fs";
import path from "node:path";
import { createWorkflowStateStoreAdapter } from "../../adapters/runtime/workflow-state-store-adapter.mjs";
import { assertArtifactProjector } from "../../core/ports/artifact-projector-port.mjs";
import { shouldEmbedArtifactContentByState } from "../../core/state-mode/runtime-index-policy.mjs";
import { persistWorkflowIndexProjection } from "./index-state-store-service.mjs";
import { resolveEffectiveRuntimeMode } from "./runtime-mode-service.mjs";
import { readIndexFromSqlite } from "../../lib/sqlite/index-sqlite-lib.mjs";

function resolveTargetPath(targetRoot, candidatePath) {
  if (!candidatePath) {
    return candidatePath;
  }
  if (path.isAbsolute(candidatePath)) {
    return candidatePath;
  }
  return path.resolve(targetRoot, candidatePath);
}

function resolveInputPathPreferTarget(targetRoot, candidatePath) {
  if (!candidatePath) {
    return candidatePath;
  }
  if (path.isAbsolute(candidatePath)) {
    return candidatePath;
  }

  const fromTarget = path.resolve(targetRoot, candidatePath);
  if (fs.existsSync(fromTarget)) {
    return fromTarget;
  }

  const fromCwd = path.resolve(process.cwd(), candidatePath);
  if (fs.existsSync(fromCwd)) {
    return fromCwd;
  }

  return fromTarget;
}

function readJsonIndexIfExists(indexFile) {
  if (!indexFile || !fs.existsSync(indexFile)) {
    return null;
  }
  try {
    const payload = JSON.parse(fs.readFileSync(indexFile, "utf8"));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

function readExistingRepairDecisions(args) {
  const sqliteCandidates = [];
  const jsonCandidates = [];
  if (args.store === "sqlite" || args.store === "dual-sqlite" || args.store === "all") {
    sqliteCandidates.push(args.sqliteOutput);
  }
  if (args.store === "file" || args.store === "dual" || args.store === "dual-sqlite" || args.store === "all") {
    jsonCandidates.push(args.output);
  }
  for (const candidate of sqliteCandidates) {
    if (!candidate || !fs.existsSync(candidate)) {
      continue;
    }
    try {
      const payload = readIndexFromSqlite(candidate).payload;
      if (Array.isArray(payload?.repair_decisions)) {
        return payload.repair_decisions;
      }
    } catch {
    }
  }
  for (const candidate of jsonCandidates) {
    const payload = readJsonIndexIfExists(candidate);
    if (Array.isArray(payload?.repair_decisions)) {
      return payload.repair_decisions;
    }
  }
  return [];
}

export function runIndexSyncUseCase({
  args,
  targetRoot,
  artifactProjector,
  payloadDigest,
}) {
  assertArtifactProjector(artifactProjector);
  const envEmbedContentSet = String(process.env.AIDN_EMBED_ARTIFACT_CONTENT ?? "").trim().length > 0;
  const runtimeMode = resolveEffectiveRuntimeMode({
    targetRoot,
    stateMode: args.stateMode,
    indexStore: args.store,
    indexStoreExplicit: args.storeExplicit,
  });
  args.stateMode = runtimeMode.stateMode;
  args.store = runtimeMode.indexStore;
  if (!args.embedContentExplicit && !envEmbedContentSet) {
    args.embedContent = shouldEmbedArtifactContentByState(args.stateMode);
  }
  args.output = resolveTargetPath(targetRoot, args.output);
  args.sqlOutput = resolveTargetPath(targetRoot, args.sqlOutput);
  args.sqliteOutput = resolveTargetPath(targetRoot, args.sqliteOutput);
  if (args.kpiFile) {
    args.kpiFile = resolveInputPathPreferTarget(targetRoot, args.kpiFile);
  }
  const auditRoot = path.join(targetRoot, "docs", "audit");
  if (!fs.existsSync(auditRoot)) {
    throw new Error(`Missing audit root: ${auditRoot}`);
  }
  const repairDecisions = readExistingRepairDecisions(args);

  const built = artifactProjector.projectArtifacts({
    targetRoot,
    auditRoot,
    embedContent: args.embedContent,
    kpiFile: args.kpiFile,
    repairDecisions,
  });
  const payload = built.payload;
  const structureProfile = built.structureProfile;
  const digest = payloadDigest(payload);

  const stateStore = createWorkflowStateStoreAdapter({
    mode: args.store,
    jsonOutput: args.output,
    sqlOutput: args.sqlOutput,
    sqliteOutput: args.sqliteOutput,
    schemaFile: args.schemaFile,
    includeSchema: args.includeSchema,
  });
  const { outputs, writes } = persistWorkflowIndexProjection({
    stateStore,
    payload,
    dryRun: args.dryRun,
  });

  return {
    ts: new Date().toISOString(),
    target_root: targetRoot,
    audit_root: auditRoot,
    store: args.store,
    state_mode: args.stateMode,
    embed_content: args.embedContent,
    dry_run: args.dryRun,
    outputs,
    writes,
    payload_digest: digest,
    structure_profile: structureProfile,
    summary: payload.summary,
    payload: args.includePayload ? payload : undefined,
  };
}
