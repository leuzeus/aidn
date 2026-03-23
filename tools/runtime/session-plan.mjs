#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeJsonIfChanged, writeUtf8IfChanged } from "../../src/lib/index/io-lib.mjs";
import { runDbFirstArtifactUseCase } from "../../src/application/runtime/db-first-artifact-use-case.mjs";
import { resolveStateMode } from "../../src/application/runtime/db-first-artifact-lib.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    currentStateFile: "docs/audit/CURRENT-STATE.md",
    draftFile: ".aidn/runtime/context/session-plan-draft.json",
    backlogFile: "",
    sessionId: "",
    title: "session-planning",
    nextStep: "",
    selectedExecutionScope: "",
    dispatchScope: "",
    dispatchAction: "",
    planningArbitrationStatus: "",
    planningStatus: "",
    sourceAgent: "coordinator",
    rationale: "",
    affectedItem: "",
    affectedQuestion: "",
    addendumNote: "",
    stateMode: "",
    sqliteFile: ".aidn/runtime/index/workflow-index.sqlite",
    dbFirst: "",
    promote: false,
    json: false,
    items: [],
    questions: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--current-state-file") {
      args.currentStateFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--draft-file") {
      args.draftFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--backlog-file") {
      args.backlogFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--session-id") {
      args.sessionId = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--title") {
      args.title = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--next-step") {
      args.nextStep = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--selected-execution-scope") {
      args.selectedExecutionScope = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--dispatch-scope") {
      args.dispatchScope = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--dispatch-action") {
      args.dispatchAction = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--planning-arbitration-status") {
      args.planningArbitrationStatus = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--planning-status") {
      args.planningStatus = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--source-agent") {
      args.sourceAgent = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--rationale") {
      args.rationale = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--affected-item") {
      args.affectedItem = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--affected-question") {
      args.affectedQuestion = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--addendum-note") {
      args.addendumNote = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--state-mode") {
      args.stateMode = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--sqlite-file") {
      args.sqliteFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--item") {
      args.items.push(String(argv[i + 1] ?? "").trim());
      i += 1;
    } else if (token === "--question") {
      args.questions.push(String(argv[i + 1] ?? "").trim());
      i += 1;
    } else if (token === "--promote") {
      args.promote = true;
    } else if (token === "--db-first") {
      args.dbFirst = "true";
    } else if (token === "--no-db-first") {
      args.dbFirst = "false";
    } else if (token === "--json") {
      args.json = true;
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
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn runtime session-plan --target . --item \"define backlog\" --question \"which cycle first?\" --json");
  console.log("  npx aidn runtime session-plan --target . --item \"define backlog\" --next-step \"pick cycle to create\" --promote --state-mode dual --json");
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

function readTextIfExists(filePath) {
  return filePath && fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function normalizeScalar(value) {
  const normalized = String(value ?? "").trim();
  if (normalized.startsWith("`") && normalized.endsWith("`") && normalized.length >= 2) {
    return normalized.slice(1, -1).trim();
  }
  return normalized;
}

function canonicalNone(value) {
  const normalized = normalizeScalar(value).toLowerCase();
  return normalized === "none" || normalized === "(none)";
}

function canonicalUnknown(value) {
  return normalizeScalar(value).toLowerCase() === "unknown";
}

function parseSimpleMap(text) {
  const map = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z0-9_]+):\s*(.+)$/);
    if (!match) {
      continue;
    }
    map.set(match[1], normalizeScalar(match[2]));
  }
  return map;
}

function uniqueItems(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeScalar(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function splitList(value) {
  if (!value) {
    return [];
  }
  return uniqueItems(String(value).split(",").map((item) => item.trim()));
}

function isMeaningfulScalar(value, { allowNone = false, allowUnknown = false } = {}) {
  const normalized = normalizeScalar(value);
  if (!normalized) {
    return false;
  }
  if (!allowNone && canonicalNone(normalized)) {
    return false;
  }
  if (!allowUnknown && canonicalUnknown(normalized)) {
    return false;
  }
  return true;
}

function pickScalar(values, options = {}) {
  for (const value of values) {
    if (isMeaningfulScalar(value, options)) {
      return normalizeScalar(value);
    }
  }
  return "";
}

function parseLabeledBulletList(text, label) {
  const lines = String(text).split(/\r?\n/);
  const items = [];
  let active = false;
  for (const line of lines) {
    if (!active && line.trim() === label) {
      active = true;
      continue;
    }
    if (!active) {
      continue;
    }
    if (/^##\s+/.test(line) || (/^[a-zA-Z0-9_]+:\s*/.test(line) && line.trim() !== label)) {
      break;
    }
    const match = line.match(/^\s*-\s+(.+)$/);
    if (match) {
      const item = normalizeScalar(match[1]);
      if (item && !canonicalNone(item)) {
        items.push(item);
      }
    }
  }
  return uniqueItems(items);
}

function parseSectionBulletList(text, heading) {
  const lines = String(text).split(/\r?\n/);
  const items = [];
  let active = false;
  for (const line of lines) {
    if (!active && line.trim() === heading) {
      active = true;
      continue;
    }
    if (!active) {
      continue;
    }
    if (/^##\s+/.test(line)) {
      break;
    }
    const match = line.match(/^\s*-\s+(.+)$/);
    if (match) {
      const item = normalizeScalar(match[1]);
      if (item) {
        items.push(item);
      }
    }
  }
  return uniqueItems(items);
}

function parseSectionBulletEntries(text, heading) {
  const lines = String(text).split(/\r?\n/);
  const items = [];
  let active = false;
  for (const line of lines) {
    if (!active && line.trim() === heading) {
      active = true;
      continue;
    }
    if (!active) {
      continue;
    }
    if (/^##\s+/.test(line)) {
      break;
    }
    const match = line.match(/^\s*-\s+(.+)$/);
    if (match) {
      const item = normalizeScalar(match[1]);
      if (item) {
        items.push(item);
      }
    }
  }
  return items;
}

function parseAddendumLine(line) {
  const tokens = String(line).split("|").map((item) => normalizeScalar(item)).filter(Boolean);
  const addendum = {
    timestamp: "",
    agent_role: "unknown",
    rationale: "planning update",
    affected_item: "none",
    affected_question: "none",
    note: "",
    raw: normalizeScalar(line),
  };
  if (tokens.length === 0) {
    return addendum;
  }
  const first = tokens[0];
  if (!first.includes(":")) {
    addendum.timestamp = first;
  }
  for (const token of tokens) {
    const match = token.match(/^([a-z_]+):\s*(.+)$/i);
    if (!match) {
      continue;
    }
    const key = String(match[1]).toLowerCase();
    const value = normalizeScalar(match[2]);
    if (key === "ts" || key === "timestamp") {
      addendum.timestamp = value;
    } else if (key === "agent_role") {
      addendum.agent_role = value || "unknown";
    } else if (key === "rationale") {
      addendum.rationale = value || "planning update";
    } else if (key === "affected_item") {
      addendum.affected_item = value || "none";
    } else if (key === "affected_question") {
      addendum.affected_question = value || "none";
    } else if (key === "note") {
      addendum.note = value;
    }
  }
  if (!addendum.timestamp && tokens[0]) {
    addendum.timestamp = tokens[0];
  }
  return addendum;
}

function parseAddendaSection(text) {
  return parseSectionBulletEntries(text, "## Addenda").map(parseAddendumLine);
}

function buildAddendum({
  timestamp,
  agentRole,
  rationale,
  affectedItem,
  affectedQuestion,
  note,
} = {}) {
  return {
    timestamp: normalizeScalar(timestamp) || new Date().toISOString(),
    agent_role: normalizeScalar(agentRole) || "coordinator",
    rationale: normalizeScalar(rationale) || "planning update",
    affected_item: normalizeScalar(affectedItem) || "none",
    affected_question: normalizeScalar(affectedQuestion) || "none",
    note: normalizeScalar(note) || "planning update recorded",
  };
}

function formatAddendum(addendum) {
  return [
    `ts: ${normalizeScalar(addendum.timestamp) || "unknown"}`,
    `agent_role: ${normalizeScalar(addendum.agent_role) || "unknown"}`,
    `rationale: ${normalizeScalar(addendum.rationale) || "planning update"}`,
    `affected_item: ${normalizeScalar(addendum.affected_item) || "none"}`,
    `affected_question: ${normalizeScalar(addendum.affected_question) || "none"}`,
    `note: ${normalizeScalar(addendum.note) || "planning update recorded"}`,
  ].join(" | ");
}

function parseBacklogMarkdown(text) {
  const map = parseSimpleMap(text);
  return {
    session_id: normalizeScalar(map.get("session_id") ?? "none") || "none",
    session_branch: normalizeScalar(map.get("session_branch") ?? "none") || "none",
    mode: normalizeScalar(map.get("mode") ?? "unknown") || "unknown",
    planning_status: normalizeScalar(map.get("planning_status") ?? "unknown") || "unknown",
    linked_cycles: splitList(map.get("linked_cycles") ?? ""),
    planning_arbitration_status: normalizeScalar(map.get("planning_arbitration_status") ?? "none") || "none",
    next_dispatch_scope: normalizeScalar(map.get("next_dispatch_scope") ?? "none") || "none",
    next_dispatch_action: normalizeScalar(map.get("next_dispatch_action") ?? "none") || "none",
    backlog_next_step: normalizeScalar(map.get("backlog_next_step") ?? "unknown") || "unknown",
    selected_execution_scope: normalizeScalar(map.get("selected_execution_scope") ?? "none") || "none",
    backlog_items: parseLabeledBulletList(text, "backlog_items:"),
    open_questions: parseLabeledBulletList(text, "open_questions:"),
    addenda: parseAddendaSection(text),
  };
}

function slugify(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "session-planning";
}

function relPath(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function resolveBacklogRelativePath({ sessionId, title, backlogFile }) {
  if (backlogFile) {
    return backlogFile.replace(/\\/g, "/");
  }
  return `docs/audit/backlog/BL-${sessionId}-${slugify(title)}.md`;
}

function setOrInsertScalar(text, key, value, afterKey = "") {
  const lines = String(text).split(/\r?\n/);
  const rendered = `${key}: ${value}`;
  const existingIndex = lines.findIndex((line) => new RegExp(`^${key}:\\s*`, "i").test(line));
  if (existingIndex >= 0) {
    lines[existingIndex] = rendered;
    return `${lines.join("\n").replace(/\n+$/u, "")}\n`;
  }
  if (afterKey) {
    const afterIndex = lines.findIndex((line) => new RegExp(`^${afterKey}:\\s*`, "i").test(line));
    if (afterIndex >= 0) {
      lines.splice(afterIndex + 1, 0, rendered);
      return `${lines.join("\n").replace(/\n+$/u, "")}\n`;
    }
  }
  lines.push(rendered);
  return `${lines.join("\n").replace(/\n+$/u, "")}\n`;
}

function computeDispatchReady(scope, action) {
  return !canonicalNone(scope) && !canonicalUnknown(scope) && !canonicalNone(action) && !canonicalUnknown(action)
    ? "yes"
    : "no";
}

function mergeBacklogPayload(existingPayload, draftPayload) {
  const nextDispatchScope = pickScalar(
    [draftPayload.next_dispatch_scope, existingPayload.next_dispatch_scope],
    { allowNone: false, allowUnknown: false },
  ) || "none";
  const nextDispatchAction = pickScalar(
    [draftPayload.next_dispatch_action, existingPayload.next_dispatch_action],
    { allowNone: false, allowUnknown: false },
  ) || "none";
  return {
    updated_at: draftPayload.updated_at,
    session_id: pickScalar([draftPayload.session_id, existingPayload.session_id], { allowNone: false, allowUnknown: false }) || "none",
    session_branch: pickScalar([draftPayload.session_branch, existingPayload.session_branch], { allowNone: false, allowUnknown: false }) || "none",
    mode: pickScalar([draftPayload.mode, existingPayload.mode], { allowNone: false, allowUnknown: false }) || "unknown",
    planning_status: pickScalar([draftPayload.planning_status, existingPayload.planning_status], { allowNone: false, allowUnknown: false }) || "promoted",
    linked_cycles: uniqueItems([...(existingPayload.linked_cycles ?? []), ...(draftPayload.linked_cycles ?? [])]),
    dispatch_ready: computeDispatchReady(nextDispatchScope, nextDispatchAction),
    planning_arbitration_status: pickScalar(
      [draftPayload.planning_arbitration_status, existingPayload.planning_arbitration_status],
      { allowNone: false, allowUnknown: false },
    ) || "none",
    next_dispatch_scope: nextDispatchScope,
    next_dispatch_action: nextDispatchAction,
    backlog_next_step: pickScalar(
      [draftPayload.backlog_next_step, existingPayload.backlog_next_step],
      { allowNone: false, allowUnknown: false },
    ) || "unknown",
    selected_execution_scope: pickScalar(
      [draftPayload.selected_execution_scope, existingPayload.selected_execution_scope],
      { allowNone: false, allowUnknown: false },
    ) || "none",
    backlog_items: uniqueItems([...(existingPayload.backlog_items ?? []), ...(draftPayload.backlog_items ?? [])]),
    open_questions: uniqueItems([...(existingPayload.open_questions ?? []), ...(draftPayload.open_questions ?? [])]),
    source_agent: draftPayload.source_agent,
    addenda: [
      ...(existingPayload.addenda ?? []),
      buildAddendum({
        timestamp: draftPayload.updated_at,
        agentRole: draftPayload.source_agent,
        rationale: draftPayload.addendum_rationale,
        affectedItem: draftPayload.affected_item,
        affectedQuestion: draftPayload.affected_question,
        note: draftPayload.addendum_note || "merged update from runtime draft",
      }),
    ],
  };
}

function buildBacklogMarkdown(payload) {
  const lines = [];
  lines.push(`# Session Backlog - ${payload.session_id}`);
  lines.push("");
  lines.push("Purpose:");
  lines.push("");
  lines.push("- keep a session-scoped shared planning layer before or across cycle execution");
  lines.push("- allow several agents to add planning addenda without overloading `CURRENT-STATE.md`");
  lines.push("- make handoff and dispatch consume explicit planning state when needed");
  lines.push("");
  lines.push("Rule/State boundary:");
  lines.push("");
  lines.push("- this file is a state/planning artifact");
  lines.push("- keep canonical workflow rules in `docs/audit/SPEC.md`");
  lines.push("- keep local policy extensions in `docs/audit/WORKFLOW.md`");
  lines.push("- keep implementation-ready task details in cycle `plan.md`, not here");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`updated_at: ${payload.updated_at}`);
  lines.push(`session_id: ${payload.session_id}`);
  lines.push(`session_branch: ${payload.session_branch}`);
  lines.push(`mode: ${payload.mode}`);
  lines.push(`planning_status: ${payload.planning_status}`);
  lines.push(`linked_cycles: ${payload.linked_cycles.length > 0 ? payload.linked_cycles.join(", ") : "none"}`);
  lines.push(`dispatch_ready: ${payload.dispatch_ready}`);
  lines.push(`planning_arbitration_status: ${payload.planning_arbitration_status}`);
  lines.push(`next_dispatch_scope: ${payload.next_dispatch_scope}`);
  lines.push(`next_dispatch_action: ${payload.next_dispatch_action}`);
  lines.push(`backlog_next_step: ${payload.backlog_next_step}`);
  lines.push(`selected_execution_scope: ${payload.selected_execution_scope}`);
  lines.push("");
  lines.push("## Backlog Items");
  lines.push("");
  lines.push("backlog_items:");
  if (payload.backlog_items.length === 0) {
    lines.push("- none");
  } else {
    for (const item of payload.backlog_items) {
      lines.push(`- ${item}`);
    }
  }
  lines.push("");
  lines.push("## Open Questions");
  lines.push("");
  lines.push("open_questions:");
  if (payload.open_questions.length === 0) {
    lines.push("- none");
  } else {
    for (const item of payload.open_questions) {
      lines.push(`- ${item}`);
    }
  }
  lines.push("");
  lines.push("## Addenda");
  lines.push("");
  if (Array.isArray(payload.addenda) && payload.addenda.length > 0) {
    for (const addendum of payload.addenda) {
      lines.push(`- ${formatAddendum(addendum)}`);
    }
  } else {
    lines.push(`- ${formatAddendum(buildAddendum({
      timestamp: payload.updated_at,
      agentRole: payload.source_agent,
      rationale: payload.addendum_rationale,
      affectedItem: payload.affected_item,
      affectedQuestion: payload.affected_question,
      note: payload.addendum_note || "promoted from runtime draft",
    }))}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function shouldPersistDbFirst(stateMode, dbFirstFlag) {
  if (dbFirstFlag === "true") {
    return true;
  }
  if (dbFirstFlag === "false") {
    return false;
  }
  return stateMode === "dual" || stateMode === "db-only";
}

export function runSessionPlan({
  targetRoot,
  currentStateFile = "docs/audit/CURRENT-STATE.md",
  draftFile = ".aidn/runtime/context/session-plan-draft.json",
  backlogFile = "",
  title = "session-planning",
  nextStep = "",
  selectedExecutionScope = "",
  dispatchScope = "",
  dispatchAction = "",
  planningArbitrationStatus = "",
  planningStatus = "",
  sourceAgent = "coordinator",
  rationale = "",
  affectedItem = "",
  affectedQuestion = "",
  addendumNote = "",
  stateMode = "",
  sqliteFile = ".aidn/runtime/index/workflow-index.sqlite",
  dbFirst = "",
  sessionId = "",
  items = [],
  questions = [],
  promote = false,
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const effectiveStateMode = resolveStateMode(absoluteTargetRoot, stateMode);
  const currentStatePath = resolveTargetPath(absoluteTargetRoot, currentStateFile);
  const currentStateText = readTextIfExists(currentStatePath);
  const currentMap = parseSimpleMap(currentStateText);
  const resolvedSessionId = normalizeScalar(sessionId || currentMap.get("active_session") || "none") || "none";
  if (canonicalNone(resolvedSessionId) || canonicalUnknown(resolvedSessionId)) {
    throw new Error("No active session found; pass --session-id or update CURRENT-STATE.md first");
  }

  const resolvedPlanningStatus = normalizeScalar(planningStatus) || (promote ? "promoted" : "draft");
  const resolvedNextStep = normalizeScalar(nextStep || currentMap.get("backlog_next_step") || currentMap.get("first_plan_step") || "unknown") || "unknown";
  const resolvedSelectedExecutionScope = normalizeScalar(selectedExecutionScope || currentMap.get("backlog_selected_execution_scope") || "none") || "none";
  const resolvedDispatchScope = normalizeScalar(dispatchScope) || "none";
  const resolvedDispatchAction = normalizeScalar(dispatchAction) || "none";
  const resolvedQuestions = uniqueItems(questions);
  const resolvedItems = uniqueItems(items);
  const linkedCycles = uniqueItems(
    [currentMap.get("active_cycle") ?? ""].filter((value) => !canonicalNone(value) && !canonicalUnknown(value)),
  );

  const draftPayload = {
    updated_at: new Date().toISOString(),
    session_id: resolvedSessionId,
    session_branch: normalizeScalar(currentMap.get("session_branch") ?? "none") || "none",
    mode: normalizeScalar(currentMap.get("mode") ?? "unknown") || "unknown",
    planning_status: resolvedPlanningStatus,
    linked_cycles: linkedCycles,
    backlog_items: resolvedItems,
    open_questions: resolvedQuestions,
    backlog_next_step: resolvedNextStep,
    selected_execution_scope: resolvedSelectedExecutionScope,
    next_dispatch_scope: resolvedDispatchScope,
    next_dispatch_action: resolvedDispatchAction,
    planning_arbitration_status: normalizeScalar(planningArbitrationStatus || currentMap.get("planning_arbitration_status") || "none") || "none",
    source_agent: normalizeScalar(sourceAgent) || "coordinator",
    addendum_rationale: normalizeScalar(rationale) || "planning update",
    affected_item: normalizeScalar(affectedItem) || "none",
    affected_question: normalizeScalar(affectedQuestion) || "none",
    addendum_note: normalizeScalar(addendumNote) || "",
    promoted: promote,
  };

  const draftWrite = writeJsonIfChanged(resolveTargetPath(absoluteTargetRoot, draftFile), draftPayload, {
    isEquivalent(previousContent) {
      try {
        const previous = JSON.parse(previousContent);
        const left = { ...previous };
        const right = { ...draftPayload };
        delete left.updated_at;
        delete right.updated_at;
        return JSON.stringify(left) === JSON.stringify(right);
      } catch {
        return false;
      }
    },
  });

  let backlogWrite = null;
  let backlogRelative = "none";
  let backlogOperation = "none";
  let backlogPayload = null;
  let currentStateWrite = null;
  let dbFirstWrites = [];
  if (promote) {
    backlogRelative = resolveBacklogRelativePath({
      sessionId: resolvedSessionId,
      title,
      backlogFile,
    });
    const backlogAbsolute = resolveTargetPath(absoluteTargetRoot, backlogRelative);
    const existingBacklog = fs.existsSync(backlogAbsolute) ? parseBacklogMarkdown(readTextIfExists(backlogAbsolute)) : null;
    if (existingBacklog && isMeaningfulScalar(existingBacklog.session_id, { allowNone: false, allowUnknown: false }) && existingBacklog.session_id !== resolvedSessionId) {
      throw new Error(`Shared session backlog session mismatch: ${backlogRelative} belongs to ${existingBacklog.session_id}`);
    }
    backlogPayload = existingBacklog
      ? mergeBacklogPayload(existingBacklog, draftPayload)
      : {
        ...draftPayload,
        dispatch_ready: computeDispatchReady(resolvedDispatchScope, resolvedDispatchAction),
        addenda: [buildAddendum({
          timestamp: draftPayload.updated_at,
          agentRole: draftPayload.source_agent,
          rationale: draftPayload.addendum_rationale,
          affectedItem: draftPayload.affected_item,
          affectedQuestion: draftPayload.affected_question,
          note: draftPayload.addendum_note || "promoted from runtime draft",
        })],
      };
    backlogOperation = existingBacklog ? "updated" : "created";
    backlogWrite = writeUtf8IfChanged(backlogAbsolute, buildBacklogMarkdown(backlogPayload));

    if (currentStateText) {
      let nextCurrentState = currentStateText;
      nextCurrentState = setOrInsertScalar(nextCurrentState, "active_backlog", backlogRelative.replace(/^docs\/audit\//, ""), "first_plan_step");
      nextCurrentState = setOrInsertScalar(nextCurrentState, "backlog_status", backlogPayload.planning_status, "active_backlog");
      nextCurrentState = setOrInsertScalar(nextCurrentState, "backlog_next_step", backlogPayload.backlog_next_step, "backlog_status");
      nextCurrentState = setOrInsertScalar(
        nextCurrentState,
        "backlog_selected_execution_scope",
        backlogPayload.selected_execution_scope,
        "backlog_next_step",
      );
      nextCurrentState = setOrInsertScalar(
        nextCurrentState,
        "planning_arbitration_status",
        backlogPayload.planning_arbitration_status,
        "backlog_selected_execution_scope",
      );
      currentStateWrite = writeUtf8IfChanged(currentStatePath, nextCurrentState);
    }

    if (shouldPersistDbFirst(effectiveStateMode, dbFirst)) {
      dbFirstWrites.push(runDbFirstArtifactUseCase({
        target: absoluteTargetRoot,
        auditRoot: "docs/audit",
        path: backlogRelative.replace(/^docs\/audit\//, ""),
        sourceFile: resolveTargetPath(absoluteTargetRoot, backlogRelative),
        kind: "other",
        family: "support",
        subtype: "session_backlog",
        sessionId: resolvedSessionId,
        stateMode: effectiveStateMode,
        sqliteFile,
      }));
      if (currentStateText) {
        dbFirstWrites.push(runDbFirstArtifactUseCase({
          target: absoluteTargetRoot,
          auditRoot: "docs/audit",
          path: "CURRENT-STATE.md",
          sourceFile: currentStatePath,
          kind: "other",
          family: "normative",
          subtype: "current_state",
          sessionId: resolvedSessionId,
          stateMode: effectiveStateMode,
          sqliteFile,
        }));
      }
    }
  }

  return {
    target_root: absoluteTargetRoot,
    state_mode: effectiveStateMode,
    current_state_file: fs.existsSync(currentStatePath) ? relPath(absoluteTargetRoot, currentStatePath) : "none",
    draft_file: relPath(absoluteTargetRoot, resolveTargetPath(absoluteTargetRoot, draftFile)),
    draft_written: draftWrite.written,
    promoted: promote,
    backlog_file: backlogRelative,
    backlog_written: Boolean(backlogWrite?.written),
    backlog_operation: backlogOperation,
    current_state_written: Boolean(currentStateWrite?.written),
    db_first_applied: dbFirstWrites.length > 0,
    db_first_writes: dbFirstWrites.map((item) => ({
      path: item?.artifact?.path ?? "unknown",
      state_mode: item?.state_mode ?? effectiveStateMode,
      materialized: item?.materialized === true,
    })),
    payload: backlogPayload ?? draftPayload,
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const output = runSessionPlan({
      targetRoot: args.target,
      currentStateFile: args.currentStateFile,
      draftFile: args.draftFile,
      backlogFile: args.backlogFile,
      title: args.title,
      nextStep: args.nextStep,
      selectedExecutionScope: args.selectedExecutionScope,
      dispatchScope: args.dispatchScope,
      dispatchAction: args.dispatchAction,
      planningArbitrationStatus: args.planningArbitrationStatus,
      planningStatus: args.planningStatus,
      sourceAgent: args.sourceAgent,
      rationale: args.rationale,
      affectedItem: args.affectedItem,
      affectedQuestion: args.affectedQuestion,
      addendumNote: args.addendumNote,
      stateMode: args.stateMode,
      sqliteFile: args.sqliteFile,
      dbFirst: args.dbFirst,
      sessionId: args.sessionId,
      items: args.items,
      questions: args.questions,
      promote: args.promote,
    });

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Session plan draft: ${output.draft_file} (${output.draft_written ? "written" : "unchanged"})`);
      if (output.promoted) {
        console.log(`- backlog_file=${output.backlog_file}`);
      }
      console.log(`- session_id=${output.payload.session_id}`);
      console.log(`- planning_status=${output.payload.planning_status}`);
      console.log(`- backlog_next_step=${output.payload.backlog_next_step}`);
      console.log(`- selected_execution_scope=${output.payload.selected_execution_scope}`);
      console.log(`- planning_arbitration_status=${output.payload.planning_arbitration_status}`);
      console.log(`- db_first_applied=${output.db_first_applied ? "yes" : "no"}`);
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
