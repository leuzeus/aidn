#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHookContextStoreAdapter } from "../../src/adapters/codex/hook-context-store-adapter.mjs";
import { runHydrateContextUseCase } from "../../src/application/codex/hydrate-context-use-case.mjs";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";
import { preWriteAdmit } from "../runtime/pre-write-admit.mjs";
import { computeCoordinatorNextAction } from "../runtime/coordinator-next-action.mjs";
import { persistAgentViewReceipt, projectWorkflowAgentView, validateAgentViewOptions } from "../../src/application/codex/agent-view-projection.mjs";
import { withWorkflowObservation } from "../../src/application/runtime/workflow-observation-service.mjs";
import { readWorkflowAdapterConfig } from "../../src/lib/config/workflow-adapter-config-lib.mjs";
import { resolveRuntimeProjectContext } from "../../src/application/runtime/runtime-project-context-service.mjs";
import { TOKEN_CONTEXT_PROFILE, buildTaskContextRequest, finalizeWorkflowContextBudget } from "../../src/application/codex/task-context-profile.mjs";
import { projectHistoryTransitions } from "../../src/application/codex/context-history-transitions.mjs";
import { sha256 } from "../../src/core/context/working-memory-policy.mjs";
import { resolveCliEffectClass } from "../../src/core/cli/effect-policy.mjs";
import {artifactQueryManifest} from '../../src/application/runtime/artifact-query-catalog.mjs';
import {artifactQueryEnvelope, readArtifactQueryParams, queryProjectArtifacts, finalizeArtifactQueryBudget} from '../../src/application/runtime/artifact-query-service.mjs';

const DEFAULT_DAEMON_ENDPOINT_FILE = ".aidn/runtime/daemon/endpoint.json";

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

export function parseArgs(argv) {
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
    useDaemon: false,
    daemonHost: "127.0.0.1",
    daemonPort: 0,
    daemonEndpointFile: DEFAULT_DAEMON_ENDPOINT_FILE,
    daemonTimeoutMs: 30000,
    json: false,
    view: "full",
    projectionProfile: null,
    write: false,
    grouped: false,
    contextProfile: "",
    contextTaskFile: "",
    contextBaselineFile: "",
    historyView: "full",
    artifactQueryProfile: "",
    artifactQueryParamsFile: "",
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
    } else if (token === "--use-daemon") {
      args.useDaemon = true;
    } else if (token === "--daemon-host") {
      args.daemonHost = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--daemon-port") {
      args.daemonPort = Number(argv[i + 1] ?? 0);
      i += 1;
    } else if (token === "--daemon-endpoint-file") {
      args.daemonEndpointFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--daemon-timeout-ms") {
      args.daemonTimeoutMs = Number(argv[i + 1] ?? 1500);
      i += 1;
    } else if (token === "--view") {
      args.view = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--projection-profile") {
      args.projectionProfile = String(argv[++i] ?? "").trim();
      if (args.projectionProfile !== "compact.v1") throw new Error("Unknown agent projection profile");
    } else if (token === "--write") {
      args.write = true;
    } else if (token === "--grouped") {
      args.grouped = true;
    } else if (token === "--context-profile") {
      args.contextProfile = String(argv[++i] ?? "").trim();
      if (args.contextProfile !== TOKEN_CONTEXT_PROFILE.id) throw new Error("Unknown context profile");
    } else if (token === '--artifact-query-profile') {
      args.artifactQueryProfile=String(argv[++i]??'').trim();
      if(!artifactQueryManifest().profiles.some(p=>p.id===args.artifactQueryProfile))throw new Error('Unknown artifact query profile');
    } else if (token === '--artifact-query-params-file') {
      args.artifactQueryParamsFile=String(argv[++i]??'').trim();
      if(!args.artifactQueryParamsFile||args.artifactQueryParamsFile.startsWith('--'))throw new Error('Missing artifact query parameters file');
    } else if (token === "--context-task-file") {
      args.contextTaskFile = String(argv[++i] ?? "").trim();
      if (!args.contextTaskFile || args.contextTaskFile.startsWith("--")) throw new Error("Missing task query file");
    } else if (token === "--context-baseline-file") {
      args.contextBaselineFile = String(argv[++i] ?? "").trim();
      if (!args.contextBaselineFile || args.contextBaselineFile.startsWith("--")) throw new Error("Missing context baseline file");
    } else if (token === "--history-view") {
      args.historyView = String(argv[++i] ?? "").trim();
      if (!["full", "transitions"].includes(args.historyView)) throw new Error("Unknown history view");
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
  if (args.contextProfile || args.artifactQueryProfile) {
    if (!argv.includes("--bundle-target-bytes")) args.bundleTargetBytes = TOKEN_CONTEXT_PROFILE.target_bytes;
    if (!argv.includes("--bundle-hard-limit-bytes")) args.bundleHardLimitBytes = TOKEN_CONTEXT_PROFILE.hard_limit_bytes;
  }
  if (!["full", "agent"].includes(args.view)) throw new Error("Invalid --view. Expected full|agent");
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
  if (args.useDaemon && !args.daemonEndpointFile && (!args.daemonHost || !Number.isInteger(args.daemonPort) || args.daemonPort < 1)) {
    throw new Error("Invalid daemon endpoint. Expected --daemon-endpoint-file or --daemon-host plus --daemon-port when --use-daemon is supplied.");
  }
  if (!Number.isFinite(args.daemonTimeoutMs) || args.daemonTimeoutMs < 100) {
    throw new Error("Invalid --daemon-timeout-ms. Expected at least 100.");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn codex workflow-step --target . --skills close-session,pr-orchestrate --mode COMMITTING --json");
  console.log("  npx aidn codex workflow-step --target . --skill requirements-delta --mode COMMITTING --json");
  console.log("  npx aidn codex workflow-step --target . --skills context-reload --json --use-daemon");
  console.log("  npx aidn codex workflow-step --target . --skills context-reload --view agent --json [--write]  (explicit complete diagnostic receipt)");
  console.log("  npx aidn codex workflow-step --target . --skills context-reload --view agent --projection-profile compact.v1 --json");
  console.log("  npx aidn codex workflow-step --target . --skills context-reload,requirements-delta --view agent --grouped --json");
  console.log("  npx aidn codex workflow-step --target . --skills context-reload --view agent --grouped --context-profile token-efficiency.v1 --json");
  console.log('  npx aidn codex workflow-step --skills close-session --view agent --grouped --artifact-query-profile verification-closure.v1 --json');
  console.log("  Add --context-baseline-file <complete-prior-agent-or-workflow-receipt.json> for optional-unit delta; --history-view transitions preserves distinct execution references.");
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

async function computeWorkflowStep({ args, targetRoot, grouped = false }) {
  const hookContextStore = createHookContextStoreAdapter();
  const workspace = resolveWorkspaceContext({ targetRoot });
  const steps = [];
  const admissions = {};
  const hydrations = {};
  let selectionPolicy = null, commonSelection = null, commonDelta = null, artifactConsultation = null, artifactQueryParams = null, artifactSelectionRequest = null;

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

    if (!grouped) {
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

  const admittedSkills = args.skills.filter(skill => admissions[skill]?.ok === true);
  if(args.artifactQueryProfile) {
    if(nextAction?.recommendation?.stop_required===true) {
      artifactConsultation=artifactQueryEnvelope(args.artifactQueryProfile);
      artifactConsultation.errors.push({code:'ARTIFACT_QUERY_GLOBAL_STOP',ref:null});
    }else {
      const params=args.artifactQueryParamsFile?readArtifactQueryParams(targetRoot,args.artifactQueryParamsFile):{schema_version:1};
      artifactQueryParams=params;
      if(params.skills)throw new Error('Workflow supplies its own artifact-query skills');
      artifactConsultation=await queryProjectArtifacts({targetRoot,profile:args.artifactQueryProfile,existingAdmissions:admissions,
        onSelection:request=>{artifactSelectionRequest=request;},
        params:{...params,...(args.artifactQueryProfile==='active-state.v1'?{}:{skills:args.skills}),target_bytes:args.bundleTargetBytes}});
    }
  }
  if (grouped && admittedSkills.length && nextAction?.recommendation?.stop_required !== true
      && (!artifactConsultation||artifactConsultation.status==='ok')) {
    if (args.contextProfile || args.artifactQueryProfile) {
      const task = args.contextTaskFile ? readTaskQuery(targetRoot, args.contextTaskFile) : artifactQueryParams?.task ?? {};
      const context = admissions[admittedSkills[0]].context, resolved = resolveRuntimeProjectContext({ targetRoot });
      const scope = Object.fromEntries(["project_id", "workspace_id", "worktree_id", "runtime_scope_id"].map(key => [key, resolved[key]]));
      for (const [key, value] of [["session_id", context.active_session], ["cycle_id", context.active_cycle]])
        if (value && !["none", "unknown"].includes(value)) scope[key] = value;
      selectionPolicy = buildTaskContextRequest({ adoption: readWorkflowAdapterConfig(targetRoot).data.governanceAdoption,
        scope, admissions, skills: admittedSkills, task, asOf: new Date().toISOString().slice(0, 10) });
      if(artifactSelectionRequest&&selectionPolicy.mode==='scoped')selectionPolicy.request=artifactSelectionRequest;
    }
    if (selectionPolicy?.mode !== "blocked") {
    const hydrated = await runHydrateContextUseCase({
      scopedBudgetOwner: selectionPolicy?.request ? "workflow-agent-json" : "hydrate-json",
      args: { ...buildHydrateArgs(args, ""), out: "", historySkills: admittedSkills,
        ...(args.contextProfile && selectionPolicy?.mode === "legacy-full-fallback"
          ? { bundleTargetBytes: 262144, bundleHardLimitBytes: 1048576 } : {}),
        ...(selectionPolicy?.request ? { contextRequest: selectionPolicy.request,
          ...(args.contextBaselineFile ? { contextBaseline: readWorkflowBaseline(targetRoot, args.contextBaselineFile) } : {}) } : {}) },
      hookContextStore, targetRoot,
    });
    commonSelection = hydrated.context_selection ?? null;
    commonDelta = hydrated.context_delta ?? null;
    for (const skill of admittedSkills) hydrations[skill] = { ...hydrated, requested_skill: skill,
      recent_history: args.historyView === "transitions" ? projectHistoryTransitions(hydrated.recent_history.filter(entry => entry.skill === skill))
        : hydrated.recent_history.filter(entry => entry.skill === skill) };
    steps.push({ id: "hydrate-context:common", kind: "hydrate-context", skills: admittedSkills,
      skill: null, ok: commonSelection?.status !== "blocked", status: commonSelection?.status === "blocked" ? "blocked" : "completed", summary: summarizeHydration(hydrated) });
    }
  }

  const blockedSkills = Object.entries(admissions)
    .filter(([, payload]) => payload?.ok !== true)
    .map(([skill]) => skill);
  const output = {
    ts: new Date().toISOString(),
    ok: blockedSkills.length === 0 && (!grouped || nextAction?.recommendation?.stop_required !== true),
    contract_version: "codex-workflow-step.v1",
    command: "aidn codex workflow-step --json",
    effect_class: args.write === true ? "mutating" : grouped ? "read-only" : "projector",
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
      hydrate_count: steps.filter(step => step.kind === "hydrate-context").length,
      next_action_status: nextAction?.recommendation?.stop_required === true ? "stop_required" : "recommended",
      ...(args.artifactQueryProfile?{artifact_query_count:nextAction?.recommendation?.stop_required===true?0:1}:{}),
    },
    steps,
    admissions,
    hydrations,
    next_action: nextAction,
    ...(artifactConsultation?{artifact_consultation:artifactConsultation}:{}),
    ...(args.contextProfile || args.artifactQueryProfile ? { context_budget_request: { profile: TOKEN_CONTEXT_PROFILE.id,
      target_bytes: args.bundleTargetBytes, hard_limit_bytes: args.bundleHardLimitBytes },
      selection_policy: selectionPolicy ? Object.fromEntries(Object.entries(selectionPolicy).filter(([key]) => key !== "request"))
        : { mode: "not-attempted", reason: "no_admitted_continuation", write_authorization: false },
      ...(commonSelection ? { context_selection: commonSelection } : {}) } : {}),
    ...(args.contextBaselineFile ? { context_delta: commonDelta ?? { contract_version: "context-delta.v1", mode: "full",
      reason: selectionPolicy?.mode === "legacy-full-fallback" ? "task_policy_full_fallback" : "no_admitted_continuation",
      baseline_revision: null, source_revision: null, unchanged_optional_refs: [], removed_unit_ids: [], write_authorization: false } } : {}),
    ...(args.historyView === "transitions" ? { history_view: "transitions" } : {}),
  };
  if(artifactConsultation&&artifactConsultation.status!=='ok')output.ok=false;
  return output;
}

export async function runWorkflowStep({ args, targetRoot }) {
  validateAgentViewOptions(args);
  if (args.projectionProfile != null && (args.projectionProfile !== "compact.v1" || args.view !== "agent"))
    throw new Error("Compact projection requires agent view");
  if (args.grouped !== undefined && typeof args.grouped !== "boolean") throw new Error("Grouped workflow selector must be boolean");
  if (args.contextProfile && (args.contextProfile !== TOKEN_CONTEXT_PROFILE.id || !args.grouped
      || !Number.isSafeInteger(args.bundleTargetBytes) || !Number.isSafeInteger(args.bundleHardLimitBytes)
      || args.bundleTargetBytes < 1 || args.bundleTargetBytes > args.bundleHardLimitBytes
      || args.bundleHardLimitBytes > TOKEN_CONTEXT_PROFILE.hard_limit_bytes)) throw new Error("Invalid grouped context profile or budget");
  if(args.artifactQueryProfile&&(!args.grouped||!artifactQueryManifest().profiles.some(p=>p.id===args.artifactQueryProfile)
    ||!Number.isSafeInteger(args.bundleTargetBytes)||!Number.isSafeInteger(args.bundleHardLimitBytes)||args.bundleTargetBytes<256
    ||args.bundleTargetBytes>args.bundleHardLimitBytes||args.bundleHardLimitBytes>65536))throw new Error('Artifact consultation requires grouped agent view and bounded total JSON');
  if(args.artifactQueryParamsFile&&!args.artifactQueryProfile)throw new Error('Artifact query parameters require a profile');
  if(args.artifactQueryParamsFile&&args.contextTaskFile)throw new Error('Use one task query file for the common consultation');
  if (args.contextTaskFile && !args.contextProfile) throw new Error("Task query requires a context profile");
  if (args.contextBaselineFile && !args.contextProfile) throw new Error("Context baseline requires a context profile");
  if (args.historyView !== undefined && !["full", "transitions"].includes(args.historyView)
      || args.historyView === "transitions" && !args.grouped) throw new Error("History transitions require a grouped workflow");
  if (args.grouped && (args.view !== "agent" || !["auto", "sqlite", "postgres"].includes(args.backend)
      || args.indexFile !== ".aidn/runtime/index/workflow-index.sqlite"
      || args.currentStateFile !== "docs/audit/CURRENT-STATE.md" || args.runtimeStateFile !== "docs/audit/RUNTIME-STATE.md"
      || args.packetFile !== "docs/audit/HANDOFF-PACKET.md" || args.contextFile !== ".aidn/runtime/context/codex-context.json"))
    throw new Error("Grouped workflow requires agent view and canonical runtime paths/backend");
  let output;
  if (args.grouped) {
    const observed = await withWorkflowObservation({ targetRoot, contextFile: args.contextFile },
      () => computeWorkflowStep({ args, targetRoot, grouped: true }));
    output = { ...observed.value, observation: observed.observation };
  } else output = await computeWorkflowStep({ args, targetRoot });
  const receipt = persistAgentViewReceipt({ write: args.write, targetRoot, kind: "workflow-step", payload: output });
  if (args.view === "agent") {
    const projected = projectWorkflowAgentView(output, receipt, args.projectionProfile ?? null);
    if(projected.artifact_consultation?.authorities) {
      for(const unit of projected.artifact_consultation.authorities) {
        const match=projected.artifacts.find(row=>row.artifact.unit_id===unit.unit_id&&row.artifact.sha256===unit.sha256
          &&row.artifact.content_excerpt===unit.content_excerpt);
        if(match){delete unit.content_excerpt;unit.workflow_artifact_ref=match.id;}
      }
      finalizeArtifactQueryBudget(projected.artifact_consultation,args.bundleTargetBytes);
    }
    return args.contextProfile || args.artifactQueryProfile ? finalizeWorkflowContextBudget(projected,
      { targetBytes: args.bundleTargetBytes, hardLimitBytes: args.bundleHardLimitBytes }) : projected;
  }
  if (receipt) output.receipt = receipt;
  return output;
}

function readTaskQuery(targetRoot, ref) {
  const file = fs.realpathSync(path.resolve(targetRoot, ref)), relative = path.relative(fs.realpathSync(targetRoot), file);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.statSync(file).isFile() || fs.statSync(file).size > 65536)
    throw new Error("Task query must be a bounded local JSON file");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(file)));
}

function readWorkflowBaseline(targetRoot, ref) {
  try {
    const file = fs.realpathSync(path.resolve(targetRoot, ref)), relative = path.relative(fs.realpathSync(targetRoot), file);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.statSync(file).isFile() || fs.statSync(file).size > 4 * 1024 * 1024) return null;
    let value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(file)));
    if (value?.contract_version === "agent-view-receipt.v1") {
      if (value.kind !== "workflow-step" || value.scope !== "worktree-local" || value.write_authorization !== false
          || !value.observation || typeof value.observation !== "object" || Array.isArray(value.observation)) return null;
      // A retained observation is caller-held data, not an attestation or an
      // admission. Apply the ordinary projection, then all existing scope,
      // metadata, graph and body-integrity checks before optional reuse.
      value = projectWorkflowAgentView(value.observation);
    }
    if (!["codex-workflow-step-agent.v1", "codex-workflow-step-agent-compact.v1"].includes(value.contract_version) || value.bundle_budget?.status === "blocked"
        || !Array.isArray(value.contexts) || !value.contexts.length || !Array.isArray(value.artifacts) || value.artifacts.length > 128) return null;
    const revision = value.contexts[0].source_revision;
    if (!value.contexts.every(context => context.source_revision === revision && Array.isArray(context.artifact_refs))) return null;
    const artifacts = new Map(), metadata = new Map();
    if (value.artifact_metadata !== undefined && (!Array.isArray(value.artifact_metadata) || value.artifact_metadata.length > 128)) return null;
    for (const row of value.artifact_metadata ?? []) {
      if (!row || typeof row !== "object" || Array.isArray(row) || metadata.has(row.id)
          || Object.keys(row).length !== 5 || !["id", "source", "path", "sha256", "canonical"].every(key => Object.hasOwn(row, key))
          || !row.source || typeof row.source !== "object" || Array.isArray(row.source)
          || typeof row.path !== "string" || !/^[a-f0-9]{64}$/.test(row.sha256)
          || !row.canonical || typeof row.canonical !== "object" || Array.isArray(row.canonical)) return null;
      const { id, ...binding } = row;
      if (id !== sha256(JSON.stringify(binding))) return null;
      metadata.set(id, row);
    }
    const metadataRefs = new Set();
    for (const row of value.artifacts) {
      if (!row || artifacts.has(row.id) || row.id !== sha256(JSON.stringify({ source: row.source, artifact: row.artifact }))) return null;
      if (row.artifact?.canonical_ref !== undefined) {
        const bound = metadata.get(row.artifact.canonical_ref);
        if (!bound || bound.path !== row.artifact.path || bound.sha256 !== row.artifact.sha256
            || JSON.stringify(bound.source) !== JSON.stringify(row.source)) return null;
        metadataRefs.add(bound.id);
      }
      artifacts.set(row.id, row.artifact);
    }
    if (metadataRefs.size !== metadata.size) return null;
    const refs = new Set(value.contexts.flatMap(context => context.artifact_refs));
    if (refs.size !== artifacts.size || [...refs].some(id => !artifacts.has(id))) return null;
    return { source_revision: revision, context_selection: value.context_selection,
      context_delta: value.context_delta, artifacts: [...artifacts.values()] };
  } catch { return null; }
}

function resolveDaemonEndpointFile(targetRoot, endpointFile) {
  if (!endpointFile) {
    return "";
  }
  if (path.isAbsolute(endpointFile)) {
    return path.resolve(endpointFile);
  }
  return path.resolve(targetRoot, endpointFile);
}

function readDaemonEndpoint(targetRoot, endpointFile) {
  const filePath = resolveDaemonEndpointFile(targetRoot, endpointFile);
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const host = String(payload?.daemon?.host ?? payload?.host ?? "").trim();
  const port = Number(payload?.daemon?.port ?? payload?.port ?? 0);
  if (!host || !Number.isInteger(port) || port < 1) {
    throw new Error(`Invalid daemon endpoint file: ${filePath}`);
  }
  return {
    host,
    port,
    endpoint_file: filePath,
  };
}

function resolveDaemonEndpoint(args, targetRoot) {
  if (Number.isInteger(args.daemonPort) && args.daemonPort > 0) {
    return {
      host: args.daemonHost,
      port: args.daemonPort,
      endpoint_file: null,
    };
  }
  const endpoint = readDaemonEndpoint(targetRoot, args.daemonEndpointFile);
  if (!endpoint) {
    throw new Error(`daemon endpoint file not found: ${resolveDaemonEndpointFile(targetRoot, args.daemonEndpointFile)}`);
  }
  return endpoint;
}

function requestDaemonWorkflowStep({ args, targetRoot }) {
  return new Promise((resolve, reject) => {
    let endpoint;
    try {
      endpoint = resolveDaemonEndpoint(args, targetRoot);
    } catch (error) {
      reject(error);
      return;
    }
    const body = JSON.stringify({
      operation: "codex.workflow-step",
      targetRoot,
      args: {
        ...args,
        useDaemon: false,
      },
    });
    const request = http.request({
      host: endpoint.host,
      port: endpoint.port,
      method: "POST",
      path: "/v1/execute",
      timeout: args.daemonTimeoutMs,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
    }, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        responseBody += chunk;
      });
      response.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(responseBody || "{}");
        } catch (error) {
          reject(new Error(`daemon returned invalid JSON: ${error.message}`));
          return;
        }
        if ((response.statusCode ?? 500) >= 400 || parsed.ok === false) {
          reject(new Error(parsed.message || `daemon request failed with status ${response.statusCode}`));
          return;
        }
        const payload = parsed.payload ?? parsed;
        payload.__daemon_endpoint = endpoint;
        resolve(payload);
      });
    });
    request.on("timeout", () => {
      request.destroy(new Error("daemon request timed out"));
    });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

async function main() {
  const originalArgv = process.argv.slice(2);
  let outputJson = originalArgv.includes("--json"), parsedArgs = null;
  try {
    const args = parseArgs(originalArgv);
    parsedArgs = args;
    outputJson = args.json;
    const targetRoot = path.resolve(process.cwd(), args.target);
    let output;
    if (args.useDaemon) {
      try {
        output = await requestDaemonWorkflowStep({ args, targetRoot });
        const endpoint = output.__daemon_endpoint ?? null;
        delete output.__daemon_endpoint;
        output.daemon = {
          used: true,
          endpoint: endpoint ? `${endpoint.host}:${endpoint.port}` : `${args.daemonHost}:${args.daemonPort}`,
          endpoint_file: endpoint?.endpoint_file ?? null,
          fallback: false,
        };
      } catch (error) {
        output = await runWorkflowStep({ args, targetRoot });
        output.daemon = {
          used: false,
          endpoint: args.daemonPort > 0 ? `${args.daemonHost}:${args.daemonPort}` : null,
          endpoint_file: resolveDaemonEndpointFile(targetRoot, args.daemonEndpointFile),
          fallback: true,
          reason: String(error.message ?? error),
        };
      }
    } else {
      output = await runWorkflowStep({ args, targetRoot });
      output.daemon = {
        used: false,
        fallback: false,
        reason: "not_requested",
      };
    }
    // Transport metadata is part of the final command JSON too. Reconcile the
    // same budget without restoring an omitted unit or clearing a refusal.
    if (args.contextProfile || args.artifactQueryProfile) finalizeWorkflowContextBudget(output,
      { targetBytes: args.bundleTargetBytes, hardLimitBytes: args.bundleHardLimitBytes });
    if (args.json) {
      console.log(args.view === "agent" ? JSON.stringify(output) : JSON.stringify(output, null, 2));
    } else {
      console.log(`Workflow step ${output.ok ? "OK" : "WARN"}: skills=${output.skills.join(",")} next=${output.next_action?.recommendation?.action ?? "unknown"}`);
    }
    if (args.strict && !output.ok) {
      process.exit(1);
    }
  } catch (error) {
    let out = {
      ts: new Date().toISOString(),
      ok: false,
      message: String(error.message ?? error),
    };
    const viewIndex = originalArgv.lastIndexOf("--view");
    if ((parsedArgs?.view ?? (viewIndex >= 0 ? originalArgv[viewIndex + 1] : "full")) === "agent") {
      const targetIndex = originalArgv.lastIndexOf("--target"), candidate = targetIndex < 0 ? "." : originalArgv[targetIndex + 1];
      const target = parsedArgs?.target ?? (candidate && !candidate.startsWith("--") ? candidate : ".");
      const code = String(error.code ?? "").startsWith("WORKFLOW_") ? error.code
        : parsedArgs ? "WORKFLOW_STEP_FAILED" : "WORKFLOW_ARGUMENT_INVALID";
      out = { ...out, contract_version: "codex-workflow-step-agent-error.v1",
        command: "aidn codex workflow-step --view agent --json", effect_class: resolveCliEffectClass("aidn codex workflow-step", originalArgv),
        view: "agent", target_root: path.resolve(process.cwd(), target), status: "refused", code,
        diagnostic_scope: "invocation-refused", source_revision: null, write_authorization: false,
        repair_actions: [code === "WORKFLOW_CONTEXT_SOURCE_MISMATCH"
          ? "Refresh the owned index/projection from its canonical authority through an explicitly authorized write, then run a fresh consultation."
          : code === "WORKFLOW_ARGUMENT_INVALID" ? "Correct the workflow arguments and submit a fresh consultation."
            : "Reanchor the reported context and retry a complete fresh consultation; prior observations grant no admission."], receipt: null };
    }
    if (outputJson) {
      console.log(out.view === "agent" ? JSON.stringify(out) : JSON.stringify(out, null, 2));
    } else {
      console.error(`ERROR: ${out.message}`);
      printUsage();
    }
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
