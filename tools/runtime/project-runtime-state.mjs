#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeUtf8IfChanged } from "../../src/lib/index/io-lib.mjs";
import { evaluateCurrentStateConsistency } from "../perf/verify-current-state-consistency.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    hydratedFile: ".aidn/runtime/context/hydrated-context.json",
    contextFile: ".aidn/runtime/context/codex-context.json",
    out: "docs/audit/RUNTIME-STATE.md",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--hydrated-file") {
      args.hydratedFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--context-file") {
      args.contextFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--out") {
      args.out = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.target || !args.out) {
    throw new Error("Missing required arguments");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/project-runtime-state.mjs --target .");
  console.log("  node tools/runtime/project-runtime-state.mjs --target tests/fixtures/repo-installed-core --json");
}

function resolveTargetPath(targetRoot, candidate) {
  if (!candidate) {
    return "";
  }
  if (path.isAbsolute(candidate)) {
    return path.resolve(candidate);
  }
  return path.resolve(targetRoot, candidate);
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function canonicalNone(value) {
  const normalized = normalizeScalar(value).toLowerCase();
  return normalized === "none" || normalized === "(none)";
}

function canonicalUnknown(value) {
  return normalizeScalar(value).toLowerCase() === "unknown";
}

function collectDecisionEntries(payload) {
  const entries = payload && typeof payload.decisions === "object"
    ? Object.entries(payload.decisions)
    : [];
  return entries
    .filter(([, entry]) => entry && typeof entry === "object")
    .map(([skill, entry]) => ({ skill, ...entry }));
}

function latestDecision(entries) {
  return entries
    .slice()
    .sort((left, right) => {
      const leftTs = Date.parse(String(left?.ts ?? left?.updated_at ?? left?.ts ?? ""));
      const rightTs = Date.parse(String(right?.ts ?? right?.updated_at ?? right?.ts ?? ""));
      return (Number.isNaN(rightTs) ? 0 : rightTs) - (Number.isNaN(leftTs) ? 0 : leftTs);
    })[0] ?? null;
}

function deriveRepairSummary(hydrated, fallbackContext) {
  const repairLayer = hydrated?.repair_layer && typeof hydrated.repair_layer === "object"
    ? hydrated.repair_layer
    : null;
  const history = Array.isArray(hydrated?.recent_history) ? hydrated.recent_history : [];
  const decisions = collectDecisionEntries(hydrated);
  const decisionCandidates = [
    ...history.filter((entry) => entry && typeof entry === "object"),
    ...decisions,
  ];
  const latest = latestDecision(decisionCandidates);
  const fallbackLatest = fallbackContext?.latest && typeof fallbackContext.latest === "object"
    ? Object.values(fallbackContext.latest).find((entry) => entry && typeof entry === "object") ?? null
    : null;
  const source = latest ?? fallbackLatest;

  const status = String(
    repairLayer?.status
      ?? source?.repair_layer_status
      ?? "unknown",
  ).trim() || "unknown";
  const advice = String(
    repairLayer?.advice
      ?? source?.repair_layer_advice
      ?? "unknown",
  ).trim() || "unknown";

  const findings = Array.isArray(repairLayer?.top_findings) && repairLayer.top_findings.length > 0
    ? repairLayer.top_findings
    : (Array.isArray(source?.repair_layer_top_findings) ? source.repair_layer_top_findings : []);

  return {
    status,
    advice,
    findings,
    blocking: repairLayer?.blocking === true || source?.repair_layer_blocking === true,
  };
}

function deriveFreshness(consistency) {
  const activeCycle = normalizeScalar(consistency?.current_state?.active_cycle ?? "");
  if (!activeCycle || canonicalNone(activeCycle) || canonicalUnknown(activeCycle)) {
    return {
      freshness: "unknown",
      basis: "no active cycle declared in CURRENT-STATE.md",
    };
  }
  const staleKeys = [
    "updated_at_not_older_than_status",
    "updated_at_not_older_than_dor_check",
  ];
  for (const key of staleKeys) {
    const check = consistency?.checks?.[key];
    if (check?.pass === false) {
      return {
        freshness: "stale",
        basis: check.details || key,
      };
    }
  }
  const parseable = consistency?.checks?.updated_at_parseable?.pass === true;
  const statusKnown = consistency?.checks?.active_cycle_status_exists?.pass === true;
  if (parseable && statusKnown) {
    return {
      freshness: "ok",
      basis: "CURRENT-STATE.md.updated_at is aligned with active cycle status timestamps",
    };
  }
  return {
    freshness: "unknown",
    basis: "freshness prerequisites missing or not evaluable",
  };
}

function uniqueItems(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function formatFinding(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const severity = String(item.severity ?? "").trim().toLowerCase();
  const type = String(item.finding_type ?? item.type ?? "").trim();
  const entity = String(item.entity_id ?? "").trim();
  const message = String(item.message ?? "").trim();
  const parts = [];
  if (severity) {
    parts.push(severity);
  }
  if (type) {
    parts.push(type);
  }
  if (entity) {
    parts.push(entity);
  }
  if (message) {
    parts.push(message);
  }
  return parts.join(": ");
}

function deriveRepairPrimaryReason({ status, advice, findings }) {
  const topFinding = Array.isArray(findings) ? findings[0] : null;
  const topFormatted = formatFinding(topFinding);
  if (topFormatted) {
    return topFormatted;
  }
  const normalizedAdvice = normalizeScalar(advice);
  if (normalizedAdvice && !canonicalUnknown(normalizedAdvice)) {
    return normalizedAdvice;
  }
  const normalizedStatus = normalizeScalar(status).toLowerCase();
  if (normalizedStatus === "clean" || normalizedStatus === "ok") {
    return "repair layer reports no blocking findings for the current relay";
  }
  return "repair-layer reason is unknown";
}

function derivePrioritizedArtifacts(consistency, hydrated, args) {
  const values = [
    "docs/audit/HANDOFF-PACKET.md",
    "docs/audit/CURRENT-STATE.md",
    "docs/audit/snapshots/context-snapshot.md",
  ];
  const activeCycle = normalizeScalar(consistency?.current_state?.active_cycle ?? "");
  const activeSession = normalizeScalar(consistency?.current_state?.active_session ?? "");
  if (activeCycle && !canonicalNone(activeCycle) && !canonicalUnknown(activeCycle)) {
    values.push(`docs/audit/cycles/${activeCycle}-*/status.md`);
  }
  if (activeSession && !canonicalNone(activeSession) && !canonicalUnknown(activeSession)) {
    values.push(`docs/audit/sessions/${activeSession}*.md`);
  }
  if (args.hydratedFile) {
    values.push(args.hydratedFile.replace(/\\/g, "/"));
  }
  if (args.contextFile) {
    values.push(args.contextFile.replace(/\\/g, "/"));
  }
  const artifactPaths = Array.isArray(hydrated?.artifacts)
    ? hydrated.artifacts.map((artifact) => String(artifact?.path ?? "").trim()).filter(Boolean)
    : [];
  return uniqueItems([...values, ...artifactPaths.slice(0, 6)]);
}

function deriveRepairRouting({ status, advice, blocking }) {
  const normalizedStatus = String(status ?? "").trim().toLowerCase();
  if (normalizedStatus === "block" || blocking === true) {
    return {
      hint: "repair",
      reason: "blocking repair findings require repair-first routing before any implementation handoff",
    };
  }
  if (normalizedStatus === "warn") {
    return {
      hint: "audit-first",
      reason: advice && advice !== "unknown"
        ? advice
        : "repair warnings require an audit-first relay before implementation",
    };
  }
  if (normalizedStatus === "ok") {
    return {
      hint: "execution-or-audit",
      reason: "repair layer reports no blocking findings for the current relay",
    };
  }
  return {
    hint: "reanchor",
    reason: "repair routing is unknown, so the next agent should reanchor before acting",
  };
}

function buildMarkdown(digest) {
  const lines = [];
  lines.push("# Runtime State Digest");
  lines.push("");
  lines.push("Purpose:");
  lines.push("");
  lines.push("- keep runtime-specific operational signals short and easy to reload");
  lines.push("- avoid scattering `dual` / `db-only` runtime facts across multiple hidden files");
  lines.push("- surface whether `CURRENT-STATE.md` still looks trustworthy");
  lines.push("");
  lines.push("Rule/State boundary:");
  lines.push("");
  lines.push("- this file is a state digest, not a canonical workflow rules file");
  lines.push("- keep canonical workflow rules in `docs/audit/SPEC.md`");
  lines.push("- keep local policy extensions in `docs/audit/WORKFLOW.md`");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`updated_at: ${digest.updated_at}`);
  lines.push(`runtime_state_mode: ${digest.runtime_state_mode}`);
  lines.push(`repair_layer_status: ${digest.repair_layer_status}`);
  lines.push(`repair_layer_advice: ${digest.repair_layer_advice}`);
  lines.push(`repair_primary_reason: ${digest.repair_primary_reason}`);
  lines.push(`repair_routing_hint: ${digest.repair_routing_hint}`);
  lines.push(`repair_routing_reason: ${digest.repair_routing_reason}`);
  lines.push("");
  lines.push("## Current State Freshness");
  lines.push("");
  lines.push(`current_state_freshness: ${digest.current_state_freshness}`);
  lines.push(`current_state_freshness_basis: ${digest.current_state_freshness_basis}`);
  lines.push("");
  lines.push("Meaning:");
  lines.push("");
  lines.push("- `ok`: `CURRENT-STATE.md` is not older than the active cycle timestamps currently checked");
  lines.push("- `stale`: `CURRENT-STATE.md` is older than the active cycle timestamps currently checked");
  lines.push("- `unknown`: no active cycle, missing timestamps, or freshness not evaluated yet");
  lines.push("");
  lines.push("## Blocking Findings");
  lines.push("");
  lines.push("blocking_findings:");
  if (digest.blocking_findings.length === 0) {
    lines.push("- none");
  } else {
    for (const finding of digest.blocking_findings) {
      lines.push(`- ${finding}`);
    }
  }
  lines.push("");
  lines.push("## Prioritized Reads");
  lines.push("");
  lines.push("prioritized_artifacts:");
  for (const item of digest.prioritized_artifacts) {
    lines.push(`- \`${item}\``);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push(`- Source context file: \`${digest.context_source}\``);
  if (digest.consistency_status === "fail") {
    lines.push("- `CURRENT-STATE.md` consistency check did not fully pass; read the detailed checks before relying on this digest.");
  } else {
    lines.push("- `CURRENT-STATE.md` consistency check passed for the currently evaluated signals.");
  }
  lines.push("- In `files` mode, this digest may remain minimal.");
  lines.push("- In `dual` / `db-only`, refresh this digest whenever runtime hydration or repair-layer triage reveals new blocking facts.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function projectRuntimeState({
  targetRoot,
  hydratedFile = ".aidn/runtime/context/hydrated-context.json",
  contextFile = ".aidn/runtime/context/codex-context.json",
  out = "docs/audit/RUNTIME-STATE.md",
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const hydratedPath = resolveTargetPath(absoluteTargetRoot, hydratedFile);
  const contextPath = resolveTargetPath(absoluteTargetRoot, contextFile);
  const hydrated = readJsonIfExists(hydratedPath);
  const fallbackContext = hydrated ? null : readJsonIfExists(contextPath);
  const consistency = evaluateCurrentStateConsistency({ targetRoot: absoluteTargetRoot });
  const repairSummary = deriveRepairSummary(hydrated, fallbackContext);
  const freshness = deriveFreshness(consistency);
  const repairRouting = deriveRepairRouting(repairSummary);
  const blockingFindings = uniqueItems(
    repairSummary.findings
      .map((item) => formatFinding(item))
      .filter(Boolean)
      .slice(0, 5),
  );
  if (repairSummary.blocking && blockingFindings.length === 0) {
    blockingFindings.push("repair layer marked blocking without detailed findings");
  }
  const digest = {
    updated_at: new Date().toISOString(),
    runtime_state_mode: String(hydrated?.state_mode ?? "files"),
    repair_layer_status: repairSummary.status,
    repair_layer_advice: repairSummary.advice,
    repair_primary_reason: deriveRepairPrimaryReason(repairSummary),
    repair_routing_hint: repairRouting.hint,
    repair_routing_reason: repairRouting.reason,
    current_state_freshness: freshness.freshness,
    current_state_freshness_basis: freshness.basis,
    blocking_findings: blockingFindings,
    prioritized_artifacts: derivePrioritizedArtifacts(consistency, hydrated, { hydratedFile, contextFile }),
    context_source: hydrated
      ? path.relative(absoluteTargetRoot, hydratedPath).replace(/\\/g, "/")
      : (fallbackContext ? path.relative(absoluteTargetRoot, contextPath).replace(/\\/g, "/") : "none"),
    consistency_status: consistency.pass ? "pass" : "fail",
  };
  const markdown = buildMarkdown(digest);
  const outWrite = writeUtf8IfChanged(resolveTargetPath(absoluteTargetRoot, out), markdown);
  return {
    target_root: absoluteTargetRoot,
    output_file: outWrite.path,
    written: outWrite.written,
    digest,
    consistency,
  };
}

function printFreshnessHint(digest) {
  if (String(digest?.current_state_freshness ?? "").trim().toLowerCase() !== "stale") {
    return;
  }
  console.log("Current state stale: docs/audit/CURRENT-STATE.md");
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const output = projectRuntimeState({
      targetRoot: args.target,
      hydratedFile: args.hydratedFile,
      contextFile: args.contextFile,
      out: args.out,
    });

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Runtime state digest: ${output.output_file} (${output.written ? "written" : "unchanged"})`);
      console.log(`- runtime_state_mode=${output.digest.runtime_state_mode}`);
      console.log(`- repair_layer_status=${output.digest.repair_layer_status}`);
      console.log(`- repair_routing_hint=${output.digest.repair_routing_hint}`);
      console.log(`- current_state_freshness=${output.digest.current_state_freshness}`);
      console.log(`- consistency=${output.digest.consistency_status}`);
      printFreshnessHint(output.digest);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
