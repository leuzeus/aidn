import fs from "node:fs";
import path from "node:path";
import { createWorkflowStateStoreAdapter } from "../../adapters/runtime/workflow-state-store-adapter.mjs";
import { assertArtifactProjector } from "../../core/ports/artifact-projector-port.mjs";
import { persistWorkflowIndexProjection } from "./index-state-store-service.mjs";
import { resolveEffectiveRuntimeMode } from "./runtime-mode-service.mjs";

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
    args.embedContent = args.stateMode === "dual" || args.stateMode === "db-only";
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

  const built = artifactProjector.projectArtifacts({
    targetRoot,
    auditRoot,
    embedContent: args.embedContent,
    kpiFile: args.kpiFile,
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
