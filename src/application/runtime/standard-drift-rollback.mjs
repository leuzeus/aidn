import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { cycleWorkBoundary } from "./standard-drift-recovery.mjs";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../core/workflow/standard-operation-contracts.mjs";
import { assertDiagnosticPathScope, readStandardGitHead } from "./standard-drift-git.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import planSchema from "../../core/contracts/workflow-definition/standard-drift-rollback-plan.v1.schema.json" with { type: "json" };

const binding = "drift_recovery_rollback_apply";
const fail = code => { throw Object.assign(Error(code), { code }); };
const limit = 1048576;
const oid = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const safePath = value => typeof value === "string" && value.length <= 240 && !/[:\\\r\n\0]/.test(value)
  && value.split("/").every(part => part && !part.startsWith(".") && !/[. ]$/.test(part));
const emit = (outcome, effect_status, observations, facts = {}, evidence_refs = []) => assertStandardOperationOutput({
  contract_version: "standard-drift-rollback-output.v1", operation_ref: binding, outcome, effect_status, observations, facts, evidence_refs,
});

// Only the owning host supplies the accepted recovery, canonical context and
// checkpoint. The effect changes the reviewed product files under a fresh grant.
export function createStandardDriftRollback({ targetRoot, readSource, observeContext, readCurrent, now = Date.now, environment = process.env }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot, env: environment }), root = artifacts.root;
  function git(args) {
    if (Object.keys(environment).some(key => /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG(?:_.*)?)$/i.test(key)))
      fail("STANDARD_GIT_ENV_SCOPE_CONFLICT");
    try {
      return execFileSync("git", ["--literal-pathspecs", "-C", root, "-c", "core.fsmonitor=false",
        "-c", "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null"), "-c", "submodule.recurse=false", ...args], {
        shell: false, windowsHide: true, timeout: 10000, maxBuffer: limit,
        env: { ...environment, GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch { fail("STANDARD_DRIFT_ROLLBACK_GIT_REFUSED"); }
  }
  const gitText = args => git(args).toString("utf8");
  function assertUnfilteredPaths(names) {
    const fields = gitText(["check-attr", "-z", "filter", "--", ...names]).split("\0");
    if (fields.pop() !== "" || fields.length !== names.length * 3 || names.some((name, index) =>
      fields[index * 3] !== name || fields[index * 3 + 1] !== "filter" || !["unspecified", "unset"].includes(fields[index * 3 + 2])))
      fail("STANDARD_DRIFT_ROLLBACK_EXTERNAL_FILTER");
  }
  function indexState() {
    const paths = gitText(["rev-parse", "--show-toplevel", "--git-path", "index", "--git-path", "index.lock",
      "--git-path", "MERGE_HEAD", "--git-path", "CHERRY_PICK_HEAD", "--git-path", "REVERT_HEAD", "--git-path", "rebase-apply", "--git-path", "rebase-merge",
      "--git-path", "sequencer"]).trimEnd().split(/\r?\n/);
    if (paths.length !== 9 || agentRunPhysicalPath(paths[0], { directory: true }) !== root) fail("STANDARD_DRIFT_ROLLBACK_REPOSITORY_CHANGED");
    const [index, ...busy] = paths.slice(1).map(value => agentRunPhysicalPath(path.resolve(root, value), { missing: true }));
    if (busy.some(file => fs.existsSync(file))) fail("STANDARD_DRIFT_ROLLBACK_GIT_BUSY");
    return readAgentRunFile(index, { json: false, maxBytes: 4194304 }).sha256;
  }
  function tree(commit, names) {
    const entries = new Map();
    for (const row of gitText(["ls-tree", "-rz", "--full-tree", commit, "--", ...names]).split("\0").filter(Boolean)) {
      const match = /^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})\t(.+)$/.exec(row);
      if (!match || !names.includes(match[3]) || entries.has(match[3])) fail("STANDARD_DRIFT_ROLLBACK_UNSUPPORTED_ENTRY");
      entries.set(match[3], { mode: match[1], oid: match[2] });
    }
    return entries;
  }
  function physical(name, deniedRoots, expected) {
    const file = path.join(root, name);
    assertDiagnosticPathScope(file, deniedRoots);
    agentRunPhysicalPath(path.dirname(file), { directory: true });
    const exact = agentRunPhysicalPath(file, { missing: true });
    if (!fs.existsSync(exact)) return { file: exact, sha256: null, mode: null };
    const bytes = readAgentRunFile(exact, { json: false, maxBytes: limit });
    const mode = process.platform === "win32" ? expected?.mode ?? "100644"
      : fs.lstatSync(exact).mode & 0o111 ? "100755" : "100644";
    return { file: exact, sha256: bytes.sha256, mode };
  }
  function image(entry) {
    if (!entry) return { sha256: null, mode: null, oid: null };
    return { ...entry, sha256: artifactContentHash(git(["cat-file", "blob", entry.oid])) };
  }
  function scopedNames(selected) {
    const names = [...selected.productPaths].sort();
    if (!names.length || names.length > 128 || new Set(names.map(name => process.platform === "win32" ? name.toLowerCase() : name)).size !== names.length
      || names.some(name => !safePath(name) || /^(?:docs\/audit(?:\/|$)|AGENTS\.md$)/i.test(name)))
      fail("STANDARD_DRIFT_ROLLBACK_SCOPE_INVALID");
    return names;
  }
  function planChanges(selected, context) {
    const names = scopedNames(selected);
    const checkpoint = selected.checkpoint, current = context.head;
    if (!oid.test(checkpoint.head) || !oid.test(current) || checkpoint.branch !== context.branch)
      fail("STANDARD_DRIFT_ROLLBACK_CHECKPOINT_REQUIRED");
    git(["merge-base", "--is-ancestor", checkpoint.head, current]);
    // No staged product bytes or partially merged index become rollback input.
    git(["diff", "--cached", "--quiet", "--no-ext-diff", "--no-textconv", current, "--", ...names]);
    const beforeTree = tree(current, names), afterTree = tree(checkpoint.head, names);
    return names.flatMap(name => {
      const before = image(beforeTree.get(name)), after = image(afterTree.get(name));
      const live = physical(name, selected.deniedRoots, before);
      if (live.sha256 !== before.sha256 || live.mode !== before.mode) fail("STANDARD_DRIFT_ROLLBACK_PRODUCT_PREIMAGE_CHANGED");
      if (before.oid === after.oid && before.mode === after.mode) return [];
      if (process.platform === "win32" && before.mode !== after.mode && [before.mode, after.mode].includes("100755"))
        fail("STANDARD_DRIFT_ROLLBACK_MODE_UNSUPPORTED");
      return [{ path: name, before, after }];
    });
  }
  function view(instance, context, selected, paths) {
    assertUnfilteredPaths(scopedNames(selected));
    const actual = readStandardGitHead(gitText);
    if (actual.head !== context.head || actual.branch !== context.branch || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256)
      fail("STANDARD_DRIFT_ROLLBACK_CONTEXT_CHANGED");
    return { branch: actual.branch, head: actual.head, index_sha256: indexState(),
      boundary_sha256: cycleWorkBoundary({ root, context, environment }, paths) };
  }
  async function prepare(instance, input, preparedAt, acquired = false) {
    assertStandardOperationInput(binding, input);
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    const selected = await readSource(instance, input);
    assertUnfilteredPaths(scopedNames(selected));
    const { context, context_sha256 } = await observeContext();
    if (selected.choice !== "rollback" || context_sha256 !== selected.transition.after_context_sha256 || context.mode !== "COMMITTING"
      || context.cycle_id !== selected.review.cycle_id || context.session_id !== selected.review.session_id || context.git.other_changes.count !== 0)
      fail("STANDARD_DRIFT_ROLLBACK_SOURCE_STALE");
    const changes = planChanges(selected, context);
    if (!changes.length || changes.length > 15) return { can_apply: false, reason_code: "STANDARD_DRIFT_ROLLBACK_CHANGE_SET_REQUIRED" };
    const scope = view(instance, context, selected, changes.map(change => change.path));
    const plan = { contract_version: "standard-drift-rollback-plan.v1", operation_ref: binding, input, prepared_at_ms: preparedAt,
      source_sha256: shadowHash(selected), context_sha256, scope, checkpoint: selected.checkpoint, changes };
    if (validateJsonSchema(plan, planSchema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_DRIFT_ROLLBACK_PLAN_INVALID");
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  function replace(change, live) {
    if (!change.after.oid) { fs.unlinkSync(live.file); return; }
    const bytes = git(["cat-file", "blob", change.after.oid]);
    if (artifactContentHash(bytes) !== change.after.sha256) fail("STANDARD_DRIFT_ROLLBACK_BLOB_CHANGED");
    const staged = path.join(path.dirname(live.file), ".aidn-rollback-" + randomUUID() + ".tmp");
    const fd = fs.openSync(staged, "wx", 0o600);
    try {
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      if (process.platform !== "win32") fs.chmodSync(staged, change.after.mode === "100755" ? 0o755 : 0o644);
      if (change.before.oid) fs.renameSync(staged, live.file);
      else fs.linkSync(staged, live.file);
    } finally {
      if (fs.existsSync(staged)) fs.unlinkSync(staged);
    }
  }
  const expired = plan => !Number.isSafeInteger(plan?.prepared_at_ms) || now() < plan.prepared_at_ms || now() - plan.prepared_at_ms > 300000;
  return Object.freeze({
    prepare: (instance, input) => prepare(instance, input, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const plan = prepared?.plan;
      if (!prepared?.can_apply || write !== true || typeof assertAuthorized !== "function" || expired(plan)
        || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan
        || validateJsonSchema(plan, planSchema, "$", { contractKind: "workflow-definition" }).length)
        throw Object.assign(Error("STANDARD_DRIFT_ROLLBACK_EXPLICIT_EFFECT_REQUIRED"), { code: "STANDARD_DRIFT_ROLLBACK_EXPLICIT_EFFECT_REQUIRED", effect_status: "no_effect" });
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        let selected, observed, changed = [], attempted = false;
        try {
          const fresh = await prepare(instance, plan.input, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail("STANDARD_DRIFT_ROLLBACK_PREVIEW_CHANGED");
          selected = await readSource(instance, plan.input);
          observed = await observeContext();
          if (shadowHash(selected) !== plan.source_sha256 || observed.context_sha256 !== plan.context_sha256)
            fail("STANDARD_DRIFT_ROLLBACK_SOURCE_STALE");
          const paths = plan.changes.map(change => change.path);
          for (const change of plan.changes) {
            await assertAuthorized();
            if (expired(plan) || shadowHash(view(instance, observed.context, selected, paths)) !== shadowHash(plan.scope))
              fail("STANDARD_DRIFT_ROLLBACK_CONTEXT_CHANGED");
            const live = physical(change.path, selected.deniedRoots, change.before);
            if (live.sha256 !== change.before.sha256 || live.mode !== change.before.mode) fail("STANDARD_DRIFT_ROLLBACK_PRODUCT_PREIMAGE_CHANGED");
            attempted = true;
            replace(change, live);
            const postimage = physical(change.path, selected.deniedRoots, change.after);
            if (postimage.sha256 !== change.after.sha256 || postimage.mode !== change.after.mode) fail("STANDARD_DRIFT_ROLLBACK_POSTIMAGE_CHANGED");
            changed.push(change.path);
          }
          assertUnfilteredPaths(scopedNames(selected));
          const after = await observeContext();
          await assertAuthorized();
          if (expired(plan) || shadowHash(view(instance, after.context, selected, paths)) !== shadowHash(plan.scope)) fail("STANDARD_DRIFT_ROLLBACK_CONTEXT_CHANGED");
          for (const change of plan.changes) {
            const postimage = physical(change.path, selected.deniedRoots, change.after);
            if (postimage.sha256 !== change.after.sha256 || postimage.mode !== change.after.mode) fail("STANDARD_DRIFT_ROLLBACK_POSTIMAGE_CHANGED");
          }
          return emit("completed", "confirmed", { recovery_record_operation_id: plan.input.recovery_record_operation_id,
            before_context_sha256: plan.context_sha256, after_context_sha256: after.context_sha256, changed_paths: changed },
            { drift_recovery_rollback_applied: true, drift_check_completed: false },
            [{ ref: "aidn:rollback-postimages/" + plan.input.recovery_record_operation_id, sha256: shadowHash(plan.changes) }]);
        } catch (cause) {
          return emit(attempted ? "reconciliation_required" : "blocked", attempted ? "unknown" : "no_effect",
            { reason_code: /^[A-Z][A-Z0-9_]{1,255}$/.test(cause.code ?? "") ? cause.code : "STANDARD_DRIFT_ROLLBACK_UNCONFIRMED", changed_paths: changed });
        }
      });
    },
  });
}
