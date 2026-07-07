import path from "node:path";
import { createCodexAgentAdapter } from "../../adapters/codex/codex-agent-adapter.mjs";
import { assertAgentAdapter } from "../../core/ports/agent-adapter-port.mjs";
import { runPrOrchestrateAdmitUseCase } from "../runtime/pr-orchestrate-admit-use-case.mjs";

function resultFromPayload(payload, status = 0) {
  return {
    status,
    stdout: `${JSON.stringify(payload, null, 2)}\n`,
    stderr: "",
  };
}

function resultFromError(error) {
  return {
    status: 1,
    stdout: "",
    stderr: String(error?.message ?? error),
    error,
  };
}

function commandMatchesAidnSkillHook(command, commandArgs = []) {
  const normalized = String(command ?? "").toLowerCase();
  const executableLooksLikeNpx = normalized === "npx" || normalized.endsWith("npx.cmd");
  return executableLooksLikeNpx
    && commandArgs[0] === "aidn"
    && commandArgs[1] === "perf"
    && commandArgs[2] === "skill-hook";
}

function parseSkillHookArgs(commandArgs = []) {
  const args = {
    target: ".",
    skill: "",
    mode: "",
    strict: false,
    noAutoSkipGate: false,
    failOnRepairBlock: false,
    json: false,
  };
  const tokens = commandArgs.slice(3);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "--target") {
      args.target = String(tokens[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--skill") {
      args.skill = String(tokens[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--mode") {
      args.mode = String(tokens[i + 1] ?? "").trim().toUpperCase();
      i += 1;
    } else if (token === "--strict") {
      args.strict = true;
    } else if (token === "--no-auto-skip-gate") {
      args.noAutoSkipGate = true;
    } else if (token === "--fail-on-repair-block") {
      args.failOnRepairBlock = true;
    } else if (token === "--json") {
      args.json = true;
    } else {
      return null;
    }
  }
  return args.skill ? args : null;
}

function normalizeStateMode(value) {
  const stateMode = String(value ?? "").trim().toLowerCase() || "files";
  return ["files", "dual", "db-only"].includes(stateMode) ? stateMode : "files";
}

function buildPrOrchestrateSummary(result) {
  return {
    result: result.result,
    reason_code: result.reason_code ?? null,
    action: result.action,
    admitted: result.admission?.ok === true,
    pr_status: result.admission?.pr_status ?? "unknown",
    pr_review_status: result.admission?.pr_review_status ?? "unknown",
    post_merge_sync_status: result.admission?.post_merge_sync_status ?? "unknown",
  };
}

function runPrOrchestrateHook(args, targetRoot, stateMode) {
  const strict = args.strict === true || stateMode === "dual" || stateMode === "db-only";
  const admission = runPrOrchestrateAdmitUseCase({
    targetRoot,
    mode: args.mode || "UNKNOWN",
  });
  const result = {
    ts: new Date().toISOString(),
    ok: admission.ok === true,
    phase: "pr-orchestrate",
    skill: "pr-orchestrate",
    target_root: targetRoot,
    mode: args.mode || "UNKNOWN",
    state_mode: stateMode,
    strict,
    action: admission.action,
    result: admission.result,
    reason_code: admission.reason_code,
    branch: admission.branch,
    branch_kind: admission.branch_kind,
    admission,
    summary: null,
  };
  result.summary = buildPrOrchestrateSummary(result);
  return result;
}

async function runSkillHookInProcess(commandArgs, envOverrides = {}) {
  const args = parseSkillHookArgs(commandArgs);
  if (!args || args.skill !== "pr-orchestrate") {
    return null;
  }
  if (args.noAutoSkipGate === true) {
    return null;
  }
  const targetRoot = path.resolve(process.cwd(), args.target);
  const stateMode = normalizeStateMode(envOverrides.AIDN_STATE_MODE);
  return resultFromPayload(runPrOrchestrateHook(args, targetRoot, stateMode), 0);
}

export function createDaemonRunJsonHookAgentAdapter() {
  const fallback = createCodexAgentAdapter();
  return assertAgentAdapter({
    getProfile() {
      return fallback.getProfile();
    },
    canHandleRole(input) {
      return fallback.canHandleRole(input);
    },
    runCommand({ command, commandArgs = [], commandLine = "", envOverrides = {} }) {
      return fallback.runCommand({
        command,
        commandArgs,
        commandLine,
        envOverrides,
      });
    },
    async runCommandAsync({ command, commandArgs = [], commandLine = "", envOverrides = {} }) {
      try {
        if (commandMatchesAidnSkillHook(command, commandArgs)) {
          const result = await runSkillHookInProcess(commandArgs, envOverrides);
          if (result) {
            return result;
          }
        }
      } catch (error) {
        return resultFromError(error);
      }
      return fallback.runCommand({
        command,
        commandArgs,
        commandLine,
        envOverrides,
      });
    },
  }, "DaemonRunJsonHookAgentAdapter");
}
