#!/usr/bin/env node
import path from "node:path";
import { createHookContextStoreAdapter } from "../../src/adapters/codex/hook-context-store-adapter.mjs";
import { runHydrateContextUseCase } from "../../src/application/codex/hydrate-context-use-case.mjs";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";
import { preWriteAdmit } from "../runtime/pre-write-admit.mjs";
import { computeCoordinatorNextAction } from "../runtime/coordinator-next-action.mjs";

function parseSkillList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}

function parseArgs(argv) {
  const args = {
    target: ".",
    skills: [],
    mode: "",
    currentStateFile: "docs/audit/CURRENT-STATE.md",
    runtimeStateFile: "docs/audit/RUNTIME-STATE.md",
    packetFile: "docs/audit/HANDOFF-PACKET.md",
    contextFile: ".aidn/runtime/context/codex-context.json",
    out: ".aidn/runtime/context/hydrated-context.json",
    historyLimit: 20,
    includeArtifacts: true,
    indexFile: ".aidn/runtime/index/workflow-index.sqlite",
    backend: "auto",
    maxArtifactBytes: 4096,
    maxArtifacts: 24,
    bundleTargetBytes: 262144,
    bundleHardLimitBytes: 1048576,
    minRelationConfidence: 0.65,
    relationThresholds: {},
    allowAmbiguousLinks: false,
    includeCompatLocalIndex: false,
    strict: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--skill") {
      args.skills.push(String(argv[i + 1] ?? "").trim());
      i += 1;
    } else if (token === "--skills") {
      args.skills.push(...parseSkillList(argv[i + 1]));
      i += 1;
    } else if (token === "--mode") {
      args.mode = String(argv[i + 1] ?? "").trim().toUpperCase();
      i += 1;
    } else if (token === "--current-state-file") {
      args.currentStateFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--runtime-state-file") {
      args.runtimeStateFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--packet-file") {
      args.packetFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--context-file") {
      args.contextFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--out") {
      args.out = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--history-limit") {
      args.historyLimit = Number(argv[i + 1] ?? 20);
      i += 1;
    } else if (token === "--index-file") {
      args.indexFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--backend") {
      args.backend = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--max-artifact-bytes") {
      args.maxArtifactBytes = Number(argv[i + 1] ?? 4096);
      i += 1;
    } else if (token === "--max-artifacts") {
      args.maxArtifacts = Number(argv[i + 1] ?? 24);
      i += 1;
    } else if (token === "--bundle-target-bytes") {
      args.bundleTargetBytes = Number(argv[i + 1] ?? 262144);
      i += 1;
    } else if (token === "--bundle-hard-limit-bytes") {
      args.bundleHardLimitBytes = Number(argv[i + 1] ?? 1048576);
      i += 1;
    } else if (token === "--min-relation-confidence") {
      args.minRelationConfidence = Number(argv[i + 1] ?? 0.65);
      i += 1;
    } else if (token === "--relation-threshold") {
      const raw = String(argv[i + 1] ?? "").trim();
      i += 1;
      const [relationType, value] = raw.split("=", 2);
      const key = String(relationType ?? "").trim();
      const n = Number(value);
      if (!key || !Number.isFinite(n) || n < 0 || n > 1) {
        throw new Error("Invalid --relation-threshold. Expected relation=value with value between 0 and 1.");
      }
      args.relationThresholds[key] = n;
    } else if (token === "--allow-ambiguous-links") {
      args.allowAmbiguousLinks = true;
    } else if (token === "--include-compat-local-index") {
      args.includeCompatLocalIndex = true;
    } else if (token === "--no-artifacts") {
      args.includeArtifacts = false;
    } else if (token === "--strict") {
      args.strict = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  args.skills = unique(args.skills);
  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  if (args.skills.length === 0) {
    throw new Error("Missing value for --skills or --skill");
  }
  if (!Number.isFinite(args.historyLimit) || args.historyLimit < 1) {
    throw new Error("Invalid --history-limit. Expected a positive integer.");
  }
  if (!["auto", "json", "sqlite", "postgres"].includes(args.backend)) {
    throw new Error("Invalid --backend. Expected auto|json|sqlite|postgres");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn codex workflow-step --target . --skills close-session,pr-orchestrate --mode COMMITTING --json");
  console.log("  npx aidn codex workflow-step --target . --skill requirements-delta --mode COMMITTING --json");
}

function summarizeAdmission(payload) {
  return {
    ok: payload?.ok === true,
    admission_status: payload?.admission_status ?? "unknown",
    blocking_count: Array.isArray(payload?.blocking_reasons) ? payload.blocking_reasons.length : 0,
    warning_count: Array.isArray(payload?.warnings) ? payload.warnings.length : 0,
    repair_layer_status: payload?.context?.repair_layer_status ?? null,
    source_of_truth_status: payload?.context?.source_of_truth_status ?? null,
  };
}

function summarizeHydration(payload) {
  return {
    state_mode: payload?.state_mode ?? "unknown",
    source_backend: payload?.source_backend ?? null,
    output_file: payload?.output_file ?? null,
    recent_history_count: Array.isArray(payload?.recent_history) ? payload.recent_history.length : 0,
    artifact_count: Array.isArray(payload?.artifacts) ? payload.artifacts.length : 0,
    repair_finding_count: Number(payload?.repair_layer?.finding_count ?? 0),
  };
}

function summarizeNextAction(payload) {
  return {
    role: payload?.recommendation?.role ?? "unknown",
    action: payload?.recommendation?.action ?? "unknown",
    source: payload?.recommendation?.source ?? "unknown",
    stop_required: payload?.recommendation?.stop_required === true,
    scope_type: payload?.scope?.scope_type ?? "none",
    scope_id: payload?.scope?.scope_id ?? "none",
  };
}

function buildHydrateArgs(args, skill) {
  return {
    target: args.target,
    contextFile: args.contextFile,
    out: args.out,
    skill,
    historyLimit: args.historyLimit,
    includeArtifacts: args.includeArtifacts,
    indexFile: args.indexFile,
    backend: args.backend,
    maxArtifactBytes: args.maxArtifactBytes,
    maxArtifacts: args.maxArtifacts,
    bundleTargetBytes: args.bundleTargetBytes,
    bundleHardLimitBytes: args.bundleHardLimitBytes,
    minRelationConfidence: args.minRelationConfidence,
    relationThresholds: args.relationThresholds,
    allowAmbiguousLinks: args.allowAmbiguousLinks,
    includeCompatLocalIndex: args.includeCompatLocalIndex,
    materializeVisibleArtifacts: false,
    projectRuntimeState: false,
    projectHandoffPacket: false,
    projectAgentSelectionSummary: false,
    projectAgentHealthSummary: false,
    projectMultiAgentStatus: false,
  };
}

export async function runWorkflowStep({ args, targetRoot }) {
  const hookContextStore = createHookContextStoreAdapter();
  const workspace = resolveWorkspaceContext({ targetRoot });
  const steps = [];
  const admissions = {};
  const hydrations = {};

  for (const skill of args.skills) {
    const admission = await preWriteAdmit({
      targetRoot,
      skill,
      currentStateFile: args.currentStateFile,
      runtimeStateFile: args.runtimeStateFile,
      workspace,
    });
    admissions[skill] = admission;
    steps.push({
      id: `pre-write-admit:${skill}`,
      kind: "admission",
      skill,
      ok: admission.ok === true,
      status: admission.admission_status ?? "unknown",
      summary: summarizeAdmission(admission),
    });

    const hydrated = await runHydrateContextUseCase({
      args: buildHydrateArgs(args, skill),
      hookContextStore,
      targetRoot,
    });
    hydrations[skill] = hydrated;
    steps.push({
      id: `hydrate-context:${skill}`,
      kind: "hydrate-context",
      skill,
      ok: true,
      status: "completed",
      summary: summarizeHydration(hydrated),
    });
  }

  const nextAction = await computeCoordinatorNextAction({
    targetRoot,
    currentStateFile: args.currentStateFile,
    runtimeStateFile: args.runtimeStateFile,
    packetFile: args.packetFile,
    workspace,
  });
  steps.push({
    id: "coordinator-next-action",
    kind: "coordinator-next-action",
    skill: null,
    ok: true,
    status: nextAction?.recommendation?.stop_required === true ? "stop_required" : "recommended",
    summary: summarizeNextAction(nextAction),
  });

  const blockedSkills = Object.entries(admissions)
    .filter(([, payload]) => payload?.ok !== true)
    .map(([skill]) => skill);
  return {
    ts: new Date().toISOString(),
    ok: blockedSkills.length === 0,
    contract_version: "codex-workflow-step.v1",
    command: "aidn codex workflow-step --json",
    effect_class: "projector",
    target_root: targetRoot,
    mode: args.mode || null,
    skills: args.skills,
    workspace: {
      workspace_id: workspace.workspace_id,
      workspace_id_source: workspace.workspace_id_source,
      worktree_id: workspace.worktree_id,
      shared_runtime_mode: workspace.shared_runtime_mode,
      shared_backend_kind: workspace.shared_backend_kind,
    },
    summary: {
      skill_count: args.skills.length,
      step_count: steps.length,
      admission_count: Object.keys(admissions).length,
      blocked_skill_count: blockedSkills.length,
      hydrate_count: Object.keys(hydrations).length,
      next_action_status: steps[steps.length - 1]?.status ?? "unknown",
    },
    steps,
    admissions,
    hydrations,
    next_action: nextAction,
  };
}

async function main() {
  let outputJson = false;
  try {
    const args = parseArgs(process.argv.slice(2));
    outputJson = args.json;
    const targetRoot = path.resolve(process.cwd(), args.target);
    const output = await runWorkflowStep({ args, targetRoot });
    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Workflow step ${output.ok ? "OK" : "WARN"}: skills=${output.skills.join(",")} next=${output.steps.at(-1)?.summary?.action ?? "unknown"}`);
    }
    if (args.strict && !output.ok) {
      process.exit(1);
    }
  } catch (error) {
    const out = {
      ts: new Date().toISOString(),
      ok: false,
      message: String(error.message ?? error),
    };
    if (outputJson) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.error(`ERROR: ${out.message}`);
      printUsage();
    }
    process.exit(1);
  }
}

await main();
