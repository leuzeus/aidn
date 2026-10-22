import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";

const hash = value => createHash("sha256").update(value).digest("hex");
const digest = value => hash(JSON.stringify(value));
const code = error => /^CLOSURE_[A-Z0-9_]+$/.test(error?.message ?? "") ? error.message : "CLOSURE_HOST_PORT_UNAVAILABLE";
const sameRoot = (a, b) => {
  const normalize = value => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(a) === normalize(b);
};
const check = (condition, code) => assert(condition, code);
function keys(value, allowed, required = allowed) {
  check(value && typeof value === "object" && !Array.isArray(value), "CLOSURE_OBJECT_REQUIRED");
  check(Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key)), "CLOSURE_FIELDS_INVALID");
}
function validate(input) {
  keys(input, ["stage", "cycle_id", "session_id", "outcome", "mutations"]);
  check(["cycle", "session"].includes(input.stage), "CLOSURE_STAGE_INVALID");
  check(/^C[0-9]+$/.test(input.cycle_id) && /^S[0-9]+$/.test(input.session_id), "CLOSURE_ENTITY_ID_INVALID");
  check(input.outcome === (input.stage === "cycle" ? "DONE" : "CLOSED"), "CLOSURE_EXPLICIT_OUTCOME_REQUIRED");
  check(Array.isArray(input.mutations) && input.mutations.length >= (input.stage === "cycle" ? 2 : 1)
    && input.mutations.length <= 3, "CLOSURE_MUTATIONS_INVALID");
  const seen = new Set();
  for (const [index, mutation] of input.mutations.entries()) {
    keys(mutation, ["path", "expected_sha256", "replacements"]);
    const ref = mutation.path;
    check(typeof ref === "string" && !ref.includes("\\") && !ref.split("/").some(p => !p || p === "." || p === "..")
      && !seen.has(ref), "CLOSURE_PATH_INVALID");
    seen.add(ref);
    const primary = input.stage === "cycle" ? new RegExp(`^cycles/${input.cycle_id}(?:-[A-Za-z0-9_-]+)?/status\\.md$`)
      : new RegExp(`^sessions/${input.session_id}(?:[-_.][A-Za-z0-9_-]+)?\\.md$`);
    check(index === 0 ? primary.test(ref) : input.stage === "cycle" && index === 1 ? ref === "CURRENT-STATE.md"
      : ["CURRENT-STATE.md", "snapshots/context-snapshot.md"].includes(ref), "CLOSURE_PATH_SCOPE_MISMATCH");
    check(/^[a-f0-9]{64}$/.test(mutation.expected_sha256), "CLOSURE_CAS_REQUIRED");
    check(Array.isArray(mutation.replacements) && mutation.replacements.length >= 1 && mutation.replacements.length <= 32, "CLOSURE_REPLACEMENTS_INVALID");
    for (const replacement of mutation.replacements) {
      keys(replacement, ["old", "new"]);
      check(typeof replacement.old === "string" && replacement.old.length > 0 && typeof replacement.new === "string", "CLOSURE_REPLACEMENTS_INVALID");
    }
  }
  check(Buffer.byteLength(JSON.stringify(input)) <= 96 * 1024, "CLOSURE_INPUT_TOO_LARGE");
  return structuredClone(input);
}

/** Internal opt-in composition. The host must bind actual CLI execution,
 * complete canonical receipts, fresh local scope checks and retained nested hook
 * verification. No serialized observation or preview is a write authorization.
 * The existing writers retain their own CAS/reservation checks. */
export function createOrderedClosureSequence({ targetRoot, execute, readBinding, deadline, now = Date.now }) {
  check(typeof targetRoot === "string" && path.isAbsolute(targetRoot), "CLOSURE_ABSOLUTE_TARGET_REQUIRED");
  check(typeof execute === "function" && typeof readBinding === "function" && Number.isFinite(deadline), "CLOSURE_HOST_PORT_REQUIRED");
  let busy = false, poisoned = false, cyclePassed = false, sessionPassed = false, entity = null;
  return {
    async run(request, { write = false } = {}) {
      let input;
      try { check(typeof write === "boolean", "CLOSURE_WRITE_INTENT_INVALID"); input = validate(request); }
      catch (error) { return { status: "REFUSED", written: false, stop_required: true, retry_allowed: false, errors: [code(error)], steps: [] }; }
      const plan = { target_root: path.resolve(targetRoot), ...input }, planSha = digest(plan);
      const out = { contract_version: "ordered-closure-observation.v1", status: "PREVIEW", stage: input.stage,
        plan_sha256: planSha, target_root: targetRoot, written: false, stop_required: false,
        retry_allowed: false, steps: [], errors: [], write_authorization: false };
      if (!write) return { ...out, effect_class: "preview", planned_mutations: input.mutations.map(m => m.path) };
      if (busy) poisoned = true;
      if (busy || poisoned || sessionPassed || (input.stage === "cycle" ? cyclePassed : !cyclePassed)
        || entity && (entity.cycle_id !== input.cycle_id || entity.session_id !== input.session_id)) {
        return { ...out, status: "REFUSED", stop_required: true, errors: ["CLOSURE_SEQUENCE_NOT_AVAILABLE"] };
      }
      busy = true; entity ??= { cycle_id: input.cycle_id, session_id: input.session_id };
      out.effect_class = "mutating";
      let binding;
      const step = async (id, argv, assess) => {
        check(now() < deadline, "CLOSURE_ORIGINAL_DEADLINE_EXHAUSTED");
        const current = await readBinding();
        check(sameRoot(current.target_root, targetRoot) && ["sqlite", "postgres"].includes(current.backend)
          && ["dual", "db-only"].includes(current.state_mode), "CLOSURE_CANONICAL_DATABASE_REQUIRED");
        check(current.stop_required === false && /^[a-f0-9]{64}$/.test(current.revision), "CLOSURE_SCOPE_UNAVAILABLE_OR_STOPPED");
        const nextBinding = digest(current);
        if (binding === undefined) binding = nextBinding;
        check(binding === nextBinding, "CLOSURE_SCOPE_CHANGED");
        check(!poisoned, "CLOSURE_SEQUENCE_INTERRUPTED");
        check(now() < deadline, "CLOSURE_ORIGINAL_DEADLINE_EXHAUSTED");
        const record = { id, command: argv.slice(0, 2).join(" "), input_sha256: digest(argv), status: "STARTED",
          ...(argv.includes("--path") ? { artifact_path: argv[argv.indexOf("--path") + 1] } : {}) }; out.steps.push(record);
        const writeAttempt = argv[1] === "db-first-artifact";
        if (writeAttempt) out.write_attempted = true;
        let result;
        try { result = await execute([...argv]); }
        catch (error) {
          record.status = "UNAVAILABLE"; record.executed = null; record.exit_code = null;
          if (writeAttempt && out.written !== true) out.written = null;
          throw error;
        }
        // A failed/unknown write may already have taken effect. Never promise
        // rollback, resume, or safe replay, including after malformed output.
        record.executed = result?.executed === true;
        record.exit_code = result?.exit_code ?? null;
        record.status = "FAIL";
        if (result?.data?.blocking_reasons?.length || result?.data?.errors?.length) record.diagnostic = {
          blocking_reasons: structuredClone(result.data.blocking_reasons ?? []), errors: structuredClone(result.data.errors ?? []),
          reason_codes: structuredClone(result.data.reason_codes ?? []), recommended_next_action: result.data.recommended_next_action ?? null };
        if (writeAttempt && result?.executed !== false) {
          if (result?.executed === true && result.exit_code === 0 && result.data?.ok === true) out.written = true;
          else if (out.written !== true) out.written = null;
        }
        check(result?.executed === true && result.exit_code === 0 && !result.signal && !result.timed_out, "CLOSURE_COMMAND_REFUSED_OR_UNAVAILABLE");
        check(result.data && typeof result.data === "object" && typeof result.target_root === "string"
          && sameRoot(result.target_root, targetRoot)
          && (!result.data.target_root || sameRoot(result.data.target_root, targetRoot)), "CLOSURE_RECEIPT_SCOPE_MISMATCH");
        assess(result);
        record.status = "PASS";
        record.output_sha256 = digest(result.data);
        return result;
      };
      const skill = input.stage === "cycle" ? "cycle-close" : "close-session";
      try {
        await step("admission", ["runtime", "pre-write-admit", "--skill", skill, "--strict", "--json"], ({ data }) => {
          check(data.ok === true && data.admission_status === "admitted", "CLOSURE_ADMISSION_REFUSED");
          check(data.context?.active_session === input.session_id
            && data.context?.active_cycle === (input.stage === "cycle" ? input.cycle_id : "none"), "CLOSURE_ADMISSION_ENTITY_MISMATCH");
        });
        for (const [index, mutation] of input.mutations.entries()) {
          await step(`mutation-${index + 1}`, ["runtime", "db-first-artifact", "--path", mutation.path,
            "--replace", JSON.stringify(mutation.replacements), "--expect-sha256", mutation.expected_sha256, "--no-materialize", "--json"], ({ data }) => {
            const artifact = data.artifact;
            check(data.ok === true && data.materialized === false && ["sqlite", "postgres"].includes(data.backend), "CLOSURE_WRITE_REFUSED");
            check(artifact?.path === mutation.path && typeof artifact.content === "string" && hash(artifact.content) === artifact.sha256
              && data.mutation?.kind === "compare-and-swap-replacements" && data.mutation.expected_sha256 === mutation.expected_sha256, "CLOSURE_CAS_RECEIPT_INVALID");
            if (index === 0) check(new RegExp(`^state:[ \\t]*${input.outcome}[ \\t]*$`, "m").test(artifact.content), "CLOSURE_TERMINAL_STATE_MISSING");
            if (mutation.path === "CURRENT-STATE.md") {
              check(/^active_cycle:[ \t]*none[ \t]*$/m.test(artifact.content)
                && new RegExp(`^active_session:[ \\t]*${input.session_id}[ \\t]*$`, "m").test(artifact.content)
                && /^first_plan_step:[ \t]*none[ \t]*$/m.test(artifact.content), "CLOSURE_FOCUS_OR_SELECTION_INVALID");
            }
          });
        }
        if (input.stage === "cycle") {
          const file = `.aidn/runtime/context/ordered-closure-${planSha}.md`;
          await step("runtime-projection", ["runtime", "project-runtime-state", "--out", file, "--write", "--json"], ({ data }) => {
            check(data.written === true && data.consistency?.pass === true, "CLOSURE_RUNTIME_PROJECTION_REFUSED");
          });
          await step("runtime-persistence", ["runtime", "db-first-artifact", "--path", "RUNTIME-STATE.md",
            "--source-file", file, "--family", "normative", "--no-materialize", "--json"], ({ data }) => {
            check(data.ok === true && data.materialized === false && data.artifact?.path === "RUNTIME-STATE.md", "CLOSURE_RUNTIME_PERSISTENCE_REFUSED");
          });
        }
        await step("final-hook", ["codex", "run-json-hook", "--skill", skill, "--mode", "COMMITTING", "--strict",
          "--fail-on-repair-block", "--no-auto-skip-gate", "--json"], result => {
          const data = result.data;
          check(data.ok === true && data.result === "ok" && data.command_status === 0 && data.skill === skill && data.strict === true
            && data.repair_layer_blocking !== true && result.hook_evidence?.status === "PASS", "CLOSURE_NESTED_FINAL_HOOK_REQUIRED");
        });
        check(!poisoned, "CLOSURE_SEQUENCE_INTERRUPTED");
        if (input.stage === "cycle") cyclePassed = true; else sessionPassed = true;
        out.status = "PASS";
      } catch (error) {
        poisoned = true; out.status = out.written !== false || out.steps.some(s => s.executed && s.command === "runtime db-first-artifact") ? "PARTIAL" : "REFUSED";
        out.stop_required = true; out.errors.push(code(error));
      } finally { busy = false; }
      return out;
    },
  };
}
