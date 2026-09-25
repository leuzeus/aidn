import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createActivationGitEnvironment } from "../install/project-activation-service.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const meaningful = (value) => typeof value === "string" && value.trim() && !["none", "unknown", "(none)"].includes(value.trim().toLowerCase());
const fail = (code) => { throw new Error(code); };
const identity = (value) => process.platform === "win32" ? value.toLowerCase() : value;
const inside = (root, file) => { const rel = path.relative(root, file); return rel && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };

// Strict subset of Codex's native V4A envelope. No shell/heredoc extraction:
// unrecognized input is refused, never downgraded to generic admission.
export function parseNativePatch(request) {
  if (!request || !["apply_patch", "Edit", "Write"].includes(request.tool_name)
      || typeof request.cwd !== "string" || !path.isAbsolute(request.cwd)
      || typeof request.tool_input?.command !== "string") fail("INVALID_NATIVE_REQUEST");
  const command = request.tool_input.command;
  if (Buffer.byteLength(command) > 1024 * 1024 || command.includes("\0")) fail("INVALID_PATCH_SIZE");
  const lines = command.trim().split(/\r?\n/);
  if (lines.shift() !== "*** Begin Patch" || lines.pop() !== "*** End Patch") fail("INVALID_PATCH_ENVELOPE");
  const operations = [];
  let i = 0;
  while (i < lines.length) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(lines[i++]);
    if (!header) fail("INVALID_PATCH_HEADER");
    const operation = { operation: header[1].toLowerCase(), path: header[2] };
    if (operation.operation === "update" && lines[i]?.startsWith("*** Move to: ")) {
      operation.destination = lines[i++].slice("*** Move to: ".length);
      operation.operation = "move";
    }
    let body = 0, chunk = false, content = 0;
    while (i < lines.length && !/^\*\*\* (?:Add|Update|Delete) File: /.test(lines[i])) {
      const line = lines[i++];
      if (operation.operation === "delete") fail("INVALID_DELETE_BODY");
      if (operation.operation === "add") {
        if (!line.startsWith("+")) fail("INVALID_ADD_BODY");
      } else if (line === "@@" || line.startsWith("@@ ")) {
        if (chunk && !content) fail("INVALID_UPDATE_CHUNK");
        chunk = true; content = 0;
      } else if (line === "*** End of File") {
        if (!chunk || !content || (i < lines.length && !/^\*\*\* (?:Add|Update|Delete) File: /.test(lines[i]))) fail("INVALID_END_OF_FILE");
      } else {
        if (!chunk || !/^[ +\-]/.test(line)) fail("INVALID_UPDATE_BODY");
        content += 1;
      }
      body += 1;
    }
    if (["update", "move"].includes(operation.operation) && (!body || !content)) fail("EMPTY_UPDATE");
    operations.push(operation);
  }
  if (!operations.length || operations.length > 512) fail("INVALID_PATCH_OPERATIONS");
  return operations;
}

function resolvePath(root, cwd, input, {directory = false} = {}) {
  if (typeof input !== "string" || !input || /[\x00-\x1f]/.test(input)) fail("INVALID_PATH");
  // Windows aliases, ADS, device paths, trailing-dot/space and alternate separators
  // are rejected consistently, including when qualification runs on Unix.
  if (input.includes("\\") && process.platform !== "win32") fail("AMBIGUOUS_PATH");
  if (/^(?:\\\\|\/\/|\\\?)/.test(input)) fail("UNSUPPORTED_PATH_NAMESPACE");
  const absolute = path.resolve(cwd, input);
  if (!inside(root, absolute) && !(directory && identity(root) === identity(absolute))) fail("PATH_OUTSIDE_WORKTREE");
  const rel = path.relative(root, absolute);
  const parts = rel.split(path.sep).filter(Boolean);
  if (parts.some((part) => /[:<>"|?*]/.test(part) || /[. ]$/.test(part)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
      || part.includes("~") || part.toLowerCase() === ".git")) fail("PROTECTED_OR_AMBIGUOUS_PATH");
  let cursor = root;
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    let stat;
    try { stat = fs.lstatSync(cursor); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (stat.isSymbolicLink() || stat.isFile() && stat.nlink > 1) fail("LINK_PATH_UNSUPPORTED");
    if (stat.isDirectory() && fs.existsSync(path.join(cursor, ".git"))) fail("NESTED_REPOSITORY");
    if (index < parts.length - 1 || directory) { if (!stat.isDirectory()) fail("INVALID_PATH_PARENT"); }
    else if (!stat.isFile()) fail("NOT_REGULAR_FILE");
    if (identity(fs.realpathSync.native(cursor)) !== identity(cursor)) fail("PATH_ALIAS_UNSUPPORTED");
  }
  return {path:rel.replaceAll("\\", "/"), absolute};
}

function classify(file, planPath) {
  const lower = file.toLowerCase();
  if (/(^|\/)agents(?:\.override)?\.md$/.test(lower)
      || /^(?:\.aidn|\.codex|\.agents|\.git)(?:\/|$)/.test(lower)
      || /^docs\/audit\/(?:spec|workflow|workflow-kernel|workflow_summary|codex_online)\.md$/.test(lower)) return "installed-authority";
  if (/^docs\/audit\/notes\/[^/]+\.md$/.test(lower) || lower === "docs/audit/parking-lot.md") return "note";
  if (file === planPath) return "planning";
  if (lower.startsWith("docs/audit/")) return "workflow-state";
  if (lower.startsWith("docs/") || /^(?:readme|security|contributing)\.md$/.test(lower)) return "normative-documentation";
  return "product";
}

function planScope(text, task) {
  const sections = [...text.matchAll(/^## Native write scope\r?\n```json\r?\n([\s\S]*?)\r?\n```\s*$/gm)];
  if (sections.length !== 1) fail("TASK_SCOPE_MISSING");
  let scope;
  try { scope = JSON.parse(sections[0][1]); } catch { fail("TASK_SCOPE_INVALID"); }
  if (scope?.version !== 1 || !Array.isArray(scope.tasks)) fail("TASK_SCOPE_INVALID");
  const selected = scope.tasks.filter((entry) => entry?.task === task);
  if (selected.length !== 1 || !["implementation", "exploration"].includes(selected[0].intent)
      || !Array.isArray(selected[0].paths) || !selected[0].paths.length) fail("TASK_SCOPE_INVALID");
  return selected[0];
}

function observeGit(root) {
  const options = {
    env:createActivationGitEnvironment(), encoding:"utf8", windowsHide:true, timeout:1500, maxBuffer:65536,
  };
  const branch = spawnSync("git", ["-C", root, "symbolic-ref", "--short", "HEAD"], options);
  const head = spawnSync("git", ["-C", root, "rev-parse", "--verify", "HEAD"], options);
  return {branch:branch.status === 0 ? branch.stdout.trim() : "unknown",
    head:head.status === 0 && /^[a-f0-9]{40,64}$/.test(head.stdout.trim()) ? head.stdout.trim() : "unknown"};
}

// Consumes only the canonical resolutions already obtained by pre-write-admit.
// This is scope admission, not content review, native trust, or an atomic lock.
export function evaluateNativeWriteAdmission({request, result, observed, resolutions, cycleStatusMap, derivedFirstPlanStep, consistency, backendWarning}) {
  const reasons = [], operations = [], snapshots = [];
  const block = (code, requirement = code.toLowerCase()) => reasons.push({code, requirement});
  const root = fs.realpathSync.native(result.target_root);
  const git = observeGit(root);
  const decision = {
    contract_version:"native-write-admission.v1", outcome:"deny", reasons, missing_requirements:[], operations,
    coverage:{tools:["apply_patch", "Edit", "Write"], format:"codex-tool_input.command-v4a", excluded:["shell", "write_stdin", "MCP", "unexecuted-hook"], semantic_validation:false, atomic:false},
    observation:{project_root:root, worktree_id:result.workspace?.worktree_id ?? null, branch:git.branch, head:git.head,
      authority_id:result.activation.authority_id, activation_revision:result.activation.revision,
      canonical_sha256:hash(JSON.stringify(resolutions.map((item) => [item.source, item.logicalPath, item.text]))),
      payload_sha256:hash(JSON.stringify(request) ?? "null"), paths_sha256:"", policy_version:"native-write-admission.v1"},
    next_action:"Remain read-only; resolve the reported prerequisite or use the reviewed AIDN maintenance operation.",
  };
  try {
    const parsed = parseNativePatch(request);
    const cwd = resolvePath(root, root, request.cwd, {directory:true}).absolute;
    const seen = new Set();
    for (const operation of parsed) {
      for (const [input, effect] of [[operation.path, operation.operation], ...(operation.destination ? [[operation.destination, "move-destination"]] : [])]) {
        const resolved = resolvePath(root, cwd, input);
        if (seen.has(identity(resolved.path))) fail("DUPLICATE_PATCH_PATH");
        seen.add(identity(resolved.path));
        const exists = fs.existsSync(resolved.absolute);
        if (["update", "delete", "move"].includes(effect) && !exists) fail("PATCH_SOURCE_MISSING");
        if (["add", "move-destination"].includes(effect) && exists) fail("PATCH_DESTINATION_EXISTS");
        if (exists && fs.statSync(resolved.absolute).size > 64 * 1024 * 1024) fail("PATH_OBSERVATION_TOO_LARGE");
        snapshots.push([resolved.path, exists ? hash(fs.readFileSync(resolved.absolute)) : null]);
        const planPath = result.plan_file !== "none" ? result.plan_file
          : meaningful(result.cycle_status_file) ? `${path.posix.dirname(result.cycle_status_file)}/plan.md` : "none";
        operations.push({operation:effect, path:resolved.path, classification:classify(resolved.path, planPath)});
      }
    }
    const kinds = new Set(operations.map((op) => op.classification));
    if (kinds.has("installed-authority")) block("OWNED_CONTROL_REQUIRES_MAINTENANCE");
    if (kinds.has("workflow-state")) block("WORKFLOW_STATE_REQUIRES_TRANSITION");
    if (!["THINKING", "EXPLORING", "COMMITTING"].includes(observed.mode)) block("MODE_NOT_ADMITTED");
    if (backendWarning || result.context.source_of_truth_status !== "clear"
        || String(observed.currentStateFreshness).toLowerCase() === "stale"
        || ["dual", "db-only"].includes(observed.runtimeStateMode) && resolutions.some((r) => r.exists && r.source === "file")) block("CANONICAL_STATE_UNAVAILABLE_OR_STALE");
    if (kinds.has("planning") && (cycleStatusMap.get("scope_frozen") === "true" || observed.cycleState === "IMPLEMENTING")) block("FROZEN_PLAN_REQUIRES_SCOPE_TRANSITION");
    const implementation = kinds.has("product") || kinds.has("normative-documentation");
    if (implementation) {
      if (!result.ok) block("WORKFLOW_ADMISSION_BLOCKED");
      if (consistency?.pass !== true) block("CANONICAL_CONTEXT_INCONSISTENT");
      if (!meaningful(observed.activeSession) || !resolutions[2].exists) block("ACTIVE_SESSION_REQUIRED");
      if (resolutions[2].exists && path.posix.basename(resolutions[2].logicalPath) !== `${observed.activeSession}.md`
          && !path.posix.basename(resolutions[2].logicalPath).startsWith(`${observed.activeSession}-`)) block("SESSION_ARTIFACT_IDENTITY_MISMATCH");
      if (!meaningful(observed.activeCycle) || !resolutions[3].exists) block("ACTIVE_CYCLE_REQUIRED");
      if (cycleStatusMap.get("session_owner") !== observed.activeSession) block("CYCLE_SESSION_MISMATCH");
      if (!meaningful(git.head) || !["cycle", "intermediate"].includes(observed.branchKind)
          || observed.mappedCycleBranch !== git.branch || observed.cycleBranch !== git.branch) block("CYCLE_BRANCH_MISMATCH");
      if (observed.cycleState !== "IMPLEMENTING") block("PHASE_EXCLUDES_IMPLEMENTATION");
      if (!meaningful(derivedFirstPlanStep) || derivedFirstPlanStep !== observed.effectiveFirstPlanStep) block("CANONICAL_TASK_REQUIRED");
      const scope = planScope(resolutions[4].text, observed.effectiveFirstPlanStep);
      if (scope.intent === "implementation") {
        if (observed.mode !== "COMMITTING") block("MODE_EXCLUDES_IMPLEMENTATION");
        if ((observed.dorState !== "READY" || cycleStatusMap.get("dor_state") !== "READY") && !meaningful(observed.dorOverrideReason)) block("DOR_REQUIRED");
        if (["shared", "high-risk"].includes(observed.usageMatrixScope)
            && !["DECLARED", "PARTIAL", "VERIFIED"].includes(observed.usageMatrixState)
            && !(observed.usageMatrixState === "WAIVED" && meaningful(observed.usageMatrixRationale))) block("USAGE_MATRIX_REQUIRED");
      } else {
        // SPEC-R02 exploration exemption needs canonical, per-task evidence.
        // It never authorizes a lasting normative document or control change.
        if (observed.mode !== "EXPLORING" || kinds.has("normative-documentation")) block("EXPLORATION_SCOPE_MISMATCH");
      }
      const entries = scope.paths.map((entry) => {
        if (!entry || typeof entry.path !== "string" || path.isAbsolute(entry.path) || entry.path.includes("\\")
            || entry.path.split("/").some((p) => !p || p === "." || p === "..")
            || !Array.isArray(entry.operations) || !entry.operations.length
            || entry.operations.some((op) => !["add", "update", "delete", "move", "move-destination"].includes(op))) fail("TASK_SCOPE_INVALID");
        return {...entry, path:resolvePath(root, root, entry.path).path};
      });
      for (const operation of operations.filter((op) => ["product", "normative-documentation"].includes(op.classification))) {
        if (!entries.some((entry) => identity(entry.path) === identity(operation.path) && entry.operations.includes(operation.operation))) block("PATH_OR_OPERATION_OUTSIDE_TASK", operation.path);
      }
    }
  } catch (error) { block(/^[A-Z_]+$/.test(error.message) ? error.message : "NATIVE_REQUEST_UNCLASSIFIABLE"); }
  decision.observation.paths_sha256 = hash(JSON.stringify(snapshots));
  decision.missing_requirements = [...new Set(reasons.map((reason) => reason.requirement))];
  decision.outcome = reasons.length ? "deny" : "allow";
  if (!reasons.length) decision.next_action = "Apply only this observed patch; re-evaluate the next edit and retain semantic review.";
  return decision;
}
