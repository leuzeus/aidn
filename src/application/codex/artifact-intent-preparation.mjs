import path from "node:path";
import { artifactContentHash as hash, artifactMetadataHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { applyArtifactReplacements } from "../../core/workflow/artifact-replacements.mjs";
import { completeMarkdownUnit } from "./scoped-context-selection.mjs";
import { buildCanonicalFromMarkdown } from "../../lib/workflow/markdown-render-lib.mjs";

const scopeKeys = ["project_id", "workspace_id", "runtime_scope_id", "worktree_id"];
const digest = value => hash(JSON.stringify(value));
const check = (condition, code) => { if (!condition) throw new Error(code); };
const object = value => value && typeof value === "object" && !Array.isArray(value);
function keys(value, allowed, required = allowed) {
  check(object(value) && Object.keys(value).every(key => allowed.includes(key))
    && required.every(key => Object.hasOwn(value, key)), "ARTIFACT_INTENT_FIELDS_INVALID");
}
const safePath = value => typeof value === "string" && /^[A-Za-z0-9_./-]+$/.test(value)
  && !value.startsWith("/") && !value.split("/").some(part => ["", ".", ".."].includes(part));
const sourceHash = artifact => {
  check(artifact?.content_format === "utf8" && typeof artifact.content === "string"
    && hash(artifact.content) === artifact.sha256, "ARTIFACT_INTENT_COMPLETE_SOURCE_REQUIRED");
  return artifact.sha256;
};

// The host supplies one complete, retained canonical observation. These checks
// detect incompatible inputs; they do not authenticate a caller's observation.
// No I/O, discovery, source fallback, mutation or admission occurs here.
export function artifactIntentObservationRevision(observation) {
  keys(observation, ["target_root", "backend", "state_mode", "scope", "artifacts", "absent_paths", "template_paths"]);
  keys(observation.scope, scopeKeys);
  check(scopeKeys.every(key => typeof observation.scope[key] === "string" && observation.scope[key].length > 0)
    && typeof observation.target_root === "string" && path.isAbsolute(observation.target_root), "ARTIFACT_INTENT_SCOPE_INVALID");
  check(["sqlite", "postgres"].includes(observation.backend)
    && ["dual", "db-only"].includes(observation.state_mode), "ARTIFACT_INTENT_CANONICAL_DATABASE_REQUIRED");
  check(Array.isArray(observation.artifacts) && observation.artifacts.length <= 64
    && Array.isArray(observation.absent_paths) && Array.isArray(observation.template_paths)
    && observation.absent_paths.length <= 32 && observation.template_paths.length <= 64,
  "ARTIFACT_INTENT_OBSERVATION_INVALID");
  const present = observation.artifacts.map(row => row?.path);
  const absent = observation.absent_paths, templates = observation.template_paths;
  for (const refs of [present, absent, templates]) check(refs.every(safePath)
    && new Set(refs.map(ref => ref.toLowerCase())).size === refs.length, "ARTIFACT_INTENT_REFERENCE_AMBIGUOUS");
  check(absent.every(ref => !present.some(path => path.toLowerCase() === ref.toLowerCase()))
    && templates.every(ref => present.includes(ref) && /^(.+\/)?TEMPLATE_[^/]+\.md$/.test(ref)), "ARTIFACT_INTENT_OBSERVATION_INVALID");
  check(Buffer.byteLength(JSON.stringify(observation)) <= 8 * 1024 * 1024, "ARTIFACT_INTENT_OBSERVATION_TOO_LARGE");
  return digest({ ...observation, artifacts: observation.artifacts.map(row => ({ path: row.path,
    sha256: sourceHash(row), metadata_sha256: artifactMetadataHash(row) })) });
}

function scopedPath(ref, request) {
  check(safePath(ref), "ARTIFACT_INTENT_PATH_INVALID");
  const session = ref.match(/^sessions\/(S\d+)(?:[-_.][A-Za-z0-9_-]+)?\.md$/);
  const cycle = ref.match(/^cycles\/(C\d+)(?:-[A-Za-z0-9_-]+)?\/([A-Za-z0-9_-]+\.md)$/);
  check(session ? session[1] === request.session_id : cycle ? cycle[1] === request.cycle_id
    : ["CURRENT-STATE.md", "snapshots/context-snapshot.md"].includes(ref), "ARTIFACT_INTENT_PATH_SCOPE_MISMATCH");
  return { session: Boolean(session), cycle: Boolean(cycle), status: cycle?.[2] === "status.md" };
}

function linesOutsideFences(content) {
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let fence = null, offset = 0;
  return lines.map(line => {
    const start = offset; offset += line.length;
    const marker = line.replace(/\r?\n$/, "").match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = { char: marker[1][0], size: marker[1].length };
      else if (marker[1][0] === fence.char && marker[1].length >= fence.size && !marker[2].trim()) fence = null;
      return { line, visible: false, start, fence_open: Boolean(fence) };
    }
    return { line, visible: !fence, start, fence_open: Boolean(fence) };
  });
}

function prepareEdit(content, edit) {
  check(object(edit), "ARTIFACT_INTENT_EDIT_INVALID");
  if (edit.kind === "replace") {
    keys(edit, ["kind", "old", "new"]);
    return { old: edit.old, new: edit.new };
  }
  if (edit.kind === "field") {
    keys(edit, ["kind", "key", "value", "heading"], ["kind", "key", "value"]);
    check(typeof edit.key === "string" && /^[a-z][a-z0-9_-]*$/.test(edit.key)
      && typeof edit.value === "string" && !/[\r\n\0]/.test(edit.value)
      && (edit.heading === undefined || typeof edit.heading === "string" && /^#{1,6} .+/.test(edit.heading)), "ARTIFACT_INTENT_FIELD_INVALID");
    const unit = completeMarkdownUnit(content, edit.heading);
    check(unit, "ARTIFACT_INTENT_SECTION_AMBIGUOUS");
    const expression = new RegExp(`^([ \\t]*(?:-[ \\t]+)?${edit.key}:[ \\t]*)([^\\r\\n]*)(\\r?\\n)?$`);
    const matches = linesOutsideFences(unit.content).filter(row => row.visible && expression.test(row.line));
    check(matches.length === 1, "ARTIFACT_INTENT_FIELD_AMBIGUOUS");
    const before = matches[0].line, match = before.match(expression), after = match[1] + edit.value + (match[3] ?? "");
    // With a section selector use the complete section as the unique preimage;
    // repeated identical field rows elsewhere never select an arbitrary row.
    const at = matches[0].start;
    return edit.heading ? { old: unit.content, new: unit.content.slice(0, at) + after + unit.content.slice(at + before.length) }
      : { old: before, new: after };
  }
  check(edit.kind === "section", "ARTIFACT_INTENT_EDIT_INVALID");
  keys(edit, ["kind", "heading", "body"]);
  check(typeof edit.heading === "string" && /^#{1,6} .+/.test(edit.heading)
    && typeof edit.body === "string" && !edit.body.includes("\0"), "ARTIFACT_INTENT_SECTION_INVALID");
  const unit = completeMarkdownUnit(content, edit.heading);
  check(unit, "ARTIFACT_INTENT_SECTION_AMBIGUOUS");
  const level = edit.heading.match(/^#+/)[0].length;
  const bodyLines = linesOutsideFences(edit.body);
  check(!bodyLines.at(-1)?.fence_open, "ARTIFACT_INTENT_SECTION_FENCE_INVALID");
  check(bodyLines.every(row => !row.visible
    || !new RegExp(`^ {0,3}#{1,${level}}[ \\t]+`).test(row.line)), "ARTIFACT_INTENT_SECTION_BOUNDARY_INVALID");
  const eol = unit.content.includes("\r\n") ? "\r\n" : "\n";
  const headingLine = unit.content.match(/^[^\n]*/)[0].replace(/\r$/, "");
  return { old: unit.content, new: headingLine + eol + edit.body + (edit.body.endsWith("\n") ? "" : eol) };
}

function itemEdits(intent) {
  keys(intent, ["path", "source_path", "edits", "fields", "sections", "replacements"], ["path"]);
  const shorthand = ["fields", "sections", "replacements"].some(key => Object.hasOwn(intent, key));
  check(!Object.hasOwn(intent, "edits") || !shorthand, "ARTIFACT_INTENT_EDIT_FORMS_CONFLICT");
  if (Object.hasOwn(intent, "edits")) return intent.edits;
  const edits = [];
  for (const [name, kind] of [["fields", "field"], ["sections", "section"]]) {
    if (!Object.hasOwn(intent, name)) continue;
    check(object(intent[name]), "ARTIFACT_INTENT_EDITS_INVALID");
    for (const [key, value] of Object.entries(intent[name])) edits.push(kind === "field"
      ? { kind, key, value } : { kind, heading: key, body: value });
  }
  if (Object.hasOwn(intent, "replacements")) {
    check(Array.isArray(intent.replacements), "ARTIFACT_INTENT_EDITS_INVALID");
    for (const replacement of intent.replacements) {
      keys(replacement, ["old", "new"]);
      edits.push({ kind: "replace", ...replacement });
    }
  }
  return edits;
}

/** Internal pure compiler. Only explicit model/owner values are supplied; no
 * acceptance, test result, date, ownership, next action or outcome is inferred.
 * Drafts and exact CAS requests remain inputs to the ordinary governed writers. */
export function prepareArtifactIntentBatch(request, observation, { maxOutputBytes = 1024 * 1024 } = {}) {
  const base = { contract_version: "artifact-intent-preparation.v1", status: "REFUSED", effect_class: "preview",
    written: false, write_authorization: false, freshness_proven: false, items: [], sources: [], errors: [] };
  try {
    keys(request, ["scope", "observation_sha256", "session_id", "cycle_id", "items"]);
    keys(request.scope, scopeKeys);
    check(typeof request.session_id === "string" && /^S\d+$/.test(request.session_id)
      && typeof request.cycle_id === "string" && /^C\d+$/.test(request.cycle_id), "ARTIFACT_INTENT_ENTITY_INVALID");
    const revision = artifactIntentObservationRevision(observation);
    check(scopeKeys.every(key => request.scope[key] === observation.scope[key]), "ARTIFACT_INTENT_SCOPE_MISMATCH");
    check(request.observation_sha256 === revision, "ARTIFACT_INTENT_OBSERVATION_CHANGED");
    check(Array.isArray(request.items) && request.items.length >= 1 && request.items.length <= 32
      && Buffer.byteLength(JSON.stringify(request)) <= 128 * 1024, "ARTIFACT_INTENT_INPUT_TOO_LARGE");
    check(Number.isInteger(maxOutputBytes) && maxOutputBytes > 0 && maxOutputBytes <= 1024 * 1024, "ARTIFACT_INTENT_BUDGET_INVALID");
    const seen = new Set(), sources = new Map(), items = [];
    for (const intent of request.items) {
      const edits = itemEdits(intent), sourcePath = Object.hasOwn(intent, "source_path") ? intent.source_path : intent.path;
      const identity = scopedPath(intent.path, request);
      check(!seen.has(intent.path.toLowerCase()), "ARTIFACT_INTENT_DUPLICATE_TARGET"); seen.add(intent.path.toLowerCase());
      check(Array.isArray(edits) && edits.length >= 1 && edits.length <= 32, "ARTIFACT_INTENT_EDITS_INVALID");
      const creating = sourcePath !== intent.path;
      check(safePath(sourcePath) && (!creating || observation.template_paths.includes(sourcePath)), "ARTIFACT_INTENT_TEMPLATE_UNDISCOVERED");
      check(!creating || (identity.session || identity.cycle)
        && sourcePath.split("/")[0] === intent.path.split("/")[0], "ARTIFACT_INTENT_TEMPLATE_FAMILY_MISMATCH");
      check(!creating || observation.absent_paths.includes(intent.path), "ARTIFACT_INTENT_CREATE_ABSENCE_REQUIRED");
      const source = observation.artifacts.find(row => row.path === sourcePath);
      check(source, "ARTIFACT_INTENT_SOURCE_MISSING");
      check(scopeKeys.every(key => (!source[key] || source[key] === request.scope[key])
        && (!source.canonical?.[key] || source.canonical[key] === request.scope[key])), "ARTIFACT_INTENT_SOURCE_SCOPE_MISMATCH");
      check(!source.session_id || source.session_id === request.session_id, "ARTIFACT_INTENT_SOURCE_ENTITY_MISMATCH");
      check(!source.cycle_id || source.cycle_id === request.cycle_id, "ARTIFACT_INTENT_SOURCE_ENTITY_MISMATCH");
      const sha256 = sourceHash(source);
      sources.set(source.path, { path: source.path, sha256, metadata_sha256: artifactMetadataHash(source) });
      let content = source.content;
      const replacements = [];
      for (const edit of edits) {
        const replacement = prepareEdit(content, edit);
        content = applyArtifactReplacements({ content, content_format: "utf8" }, [replacement], hash(content));
        replacements.push(replacement);
      }
      // Check the whole generated list against the ordinary writer's bound,
      // including repeated section preimages, before calling it a ready input.
      check(applyArtifactReplacements(source, replacements, sha256) === content, "ARTIFACT_INTENT_COMPILED_CONTENT_MISMATCH");
      check(hash(content) !== sha256, "ARTIFACT_INTENT_NO_CHANGE");
      const common = { path: intent.path, source_path: source.path, source_sha256: sha256, proposed_sha256: hash(content) };
      if (creating) {
        const kind = identity.session ? "session" : identity.status ? "cycle_status" : identity.cycle ? "cycle"
          : intent.path.startsWith("snapshots/") ? "snapshot" : "other";
        const artifact = { path: intent.path, kind, family: "normative", subtype: identity.status ? "status" : null,
          session_id: request.session_id, cycle_id: identity.cycle ? request.cycle_id : null, content_format: "utf8", content,
          canonical_format: "markdown-canonical-v1", canonical: buildCanonicalFromMarkdown(content, { relativePath: intent.path, kind }) };
        items.push({ ...common, kind: "create", cas_request: { artifact, expectedSha256: null } });
      } else {
        items.push({ ...common, kind: "replace",
          cas_request: { path: intent.path, expectedSha256: sha256, expectedMetadataSha256: artifactMetadataHash(source), replacements } });
      }
    }
    const result = { ...base, status: "READY", target_root: observation.target_root, backend: observation.backend,
      state_mode: observation.state_mode, scope: structuredClone(request.scope), observation_sha256: revision,
      items, sources: [...sources.values()] };
    result.plan_sha256 = digest(result);
    const required = Buffer.byteLength(JSON.stringify(result));
    if (required > maxOutputBytes) throw Object.assign(new Error("ARTIFACT_INTENT_OUTPUT_BUDGET_INSUFFICIENT"),
      { expansion: { required_bytes: required, requested_bytes: maxOutputBytes } });
    return result;
  } catch (error) {
    return { ...base, ...(error?.expansion ? { expansion: error.expansion } : {}), errors: [/^(ARTIFACT_INTENT_|ARTIFACT_REPLACEMENT|ARTIFACT_REVISION_CONFLICT)[A-Z0-9_]*$/.test(error?.message ?? "")
      ? error.message : "ARTIFACT_INTENT_INPUT_INVALID"] };
  }
}

// Concrete consumer for existing terminal controls. Creation drafts are never
// sent through an unchecked upsert; terminal stages accept existing CAS deltas.
export async function runPreparedOrderedClosure(sequence, request, observation, options = {}) {
  let preparation;
  try {
    keys(request, ["stage", "outcome", "scope", "observation_sha256", "session_id", "cycle_id", "items"]);
    const { stage, outcome, ...intent } = request;
    check(["cycle", "session"].includes(stage) && outcome === (stage === "cycle" ? "DONE" : "CLOSED"), "ARTIFACT_INTENT_EXPLICIT_OUTCOME_REQUIRED");
    preparation = prepareArtifactIntentBatch(intent, observation);
    check(preparation.status === "READY", preparation.errors[0] ?? "ARTIFACT_INTENT_PREPARATION_REFUSED");
    check(preparation.items.every(item => item.kind === "replace"), "ARTIFACT_INTENT_CLOSURE_CREATION_REFUSED");
  } catch (error) {
    return { preparation: preparation ?? null, execution: { status: "REFUSED", written: false, stop_required: true,
      retry_allowed: false, steps: [], errors: [error?.message?.startsWith("ARTIFACT_INTENT_") ? error.message : "ARTIFACT_INTENT_CONSUMER_UNAVAILABLE"] } };
  }
  try {
    const compiled = { stage: request.stage, outcome: request.outcome, session_id: request.session_id, cycle_id: request.cycle_id,
      mutations: preparation.items.map(({ cas_request: cas }) => ({ path: cas.path, expected_sha256: cas.expectedSha256, replacements: cas.replacements })) };
    const preview = await sequence.run(compiled);
    const normalizeRoot = value => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
    if (preview.status !== "PREVIEW" || typeof preview.target_root !== "string"
      || normalizeRoot(preview.target_root) !== normalizeRoot(preparation.target_root)) {
      return { preparation, execution: { status: "REFUSED", written: false, stop_required: true, retry_allowed: false,
        steps: [], errors: ["ARTIFACT_INTENT_EXECUTOR_TARGET_MISMATCH"] } };
    }
    const execution = options.write === undefined || options.write === false ? preview : await sequence.run(compiled, options);
    return { preparation, execution };
  } catch {
    // A host exception is not evidence that an attempted write had no effect.
    return { preparation, execution: { status: "UNAVAILABLE", written: null, stop_required: true, retry_allowed: false,
      steps: [], errors: ["ARTIFACT_INTENT_CONSUMER_OUTCOME_UNKNOWN"] } };
  }
}
