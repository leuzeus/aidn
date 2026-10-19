import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { isGovernanceAdoptionEffective, validateGovernanceAdoption } from "../../core/governance/adoption-policy.mjs";

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const text = (value) => typeof value === "string" && value.trim().length > 0;
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const safePath = (value) => text(value) && !value.includes("\\") && !value.startsWith("/")
  && !value.split("/").some((part) => ["", ".", ".."].includes(part)) && !/^[a-z]:/i.test(value);
const calendarDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

// ATX sections include all nested headings and exceptions. Code-fenced headings
// do not delimit sections. Duplicate headings are ambiguous, never guessed.
export function completeMarkdownUnit(content, heading = null) {
  if (heading === null || heading === undefined) return { content, start_line: 1, end_line: content.split("\n").length };
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const headings = [];
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\r?\n$/, "");
    const fenced = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fenced) {
      if (!fence) fence = { character: fenced[1][0], length: fenced[1].length };
      else if (fenced[1][0] === fence.character && fenced[1].length >= fence.length && !fenced[2].trim()) fence = null;
      continue;
    }
    if (fence) continue;
    const match = line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/);
    if (match) headings.push({ index, level: match[1].length, heading: `${match[1]} ${match[2]}` });
  }
  const matches = headings.filter((row) => row.heading === heading);
  if (matches.length !== 1) return null;
  const start = matches[0];
  const end = headings.find((row) => row.index > start.index && row.level <= start.level)?.index ?? lines.length;
  return { content: lines.slice(start.index, end).join(""), start_line: start.index + 1, end_line: end };
}

function validRequest(request) {
  return object(request) && request.schemaVersion === 1
    && ["effective", "historical"].includes(request.purpose) && calendarDate(request.asOf)
    && object(request.scope) && ["project_id", "workspace_id", "runtime_scope_id", "worktree_id"].every((key) => text(request.scope[key]))
    && ["session_id", "cycle_id"].every((key) => request.scope[key] === undefined || text(request.scope[key]))
    && Array.isArray(request.roots) && request.roots.length > 0 && request.roots.length <= 64 && request.roots.every(text)
    && new Set(request.roots).size === request.roots.length
    && Array.isArray(request.units) && request.units.length <= 128
    && (request.optional === undefined || (Array.isArray(request.optional) && request.optional.length <= 64 && request.optional.every(text)));
}

export function selectScopedContext({ payload, request, adoption, backend, readCanonicalText }) {
  const result = {
    schema_version: 1, mode: "consultative", status: "blocked", write_authorization: false,
    purpose: typeof request?.purpose === "string" ? request.purpose : null, scope: object(request?.scope) ? request.scope : null,
    authority_basis: "client-owned governanceAdoption; query labels grant no authority",
    errors: [], omissions: [], expansions: [], units: [], mandatory_ids: [],
    source_revision: hash(JSON.stringify({ backend, snapshot: payload ? { ...payload, generated_at: null } : null, adoption, request })),
  };
  const error = (id, reason) => ({ unit_id: id, reason });
  if (!validRequest(request)) { result.errors.push(error(null, "invalid_selection_request")); return result; }
  const context = payload?.project_context;
  if (!context || ["project_id", "workspace_id", "runtime_scope_id", "worktree_id"].some((key) => context[key] !== request.scope[key])) {
    result.errors.push(error(null, payload ? "canonical_scope_mismatch" : "canonical_source_unavailable"));
    return result;
  }
  const effective = isGovernanceAdoptionEffective(adoption, { asOf: request.asOf, expectedScope: "installed-project" });
  const declarationValid = validateGovernanceAdoption(adoption, { expectedScope: "installed-project" }).ok;
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
  const selected = new Map();
  const observedSources = [];
  function resolve(id, destination, visiting, dependency = null) {
    if (visiting.has(id)) return error(id, "dependency_cycle");
    // Recheck scope for each edge, even if a different root already selected it.
    const matches = request.units.filter((unit) => unit?.id === id);
    if (matches.length !== 1) return error(id, matches.length ? "authority_conflict" : "mandatory_unavailable");
    const unit = matches[0];
    if (request.purpose === "effective") {
      const acceptedBindings = adoption?.extensions?.contextUnits;
      const bindings = Array.isArray(acceptedBindings) ? acceptedBindings.filter((row) => row?.id === id) : [];
      if (bindings.length !== 1 || !isDeepStrictEqual(bindings[0], unit)) return error(id, "unaccepted_unit_binding");
    }
    if (!safePath(unit.path) || !/^[a-f0-9]{64}$/.test(unit.sourceSha256 ?? "") || !text(unit.authority)
      || !object(unit.scope) || !["project_id", "workspace_id", "worktree_id"].every((key) => text(unit.scope[key]))
      || !Array.isArray(unit.requires) || unit.requires.length > 64
      || !unit.requires.every((edge) => object(edge) && text(edge.id) && text(edge.reason)
        && ["crossWorkspace", "crossWorktree"].every((key) => edge[key] === undefined || typeof edge[key] === "boolean"))
      || !["effective", "proposed", "hypothesis", "superseded", "historical", "projection", "revoked"].includes(unit.status)) return error(id, "invalid_unit_binding");
    if (unit.scope.project_id !== request.scope.project_id) return error(id, "project_scope_mismatch");
    if (!["*", request.scope.workspace_id].includes(unit.scope.workspace_id) && dependency?.crossWorkspace !== true) return error(id, "workspace_scope_mismatch");
    if (!["*", request.scope.worktree_id].includes(unit.scope.worktree_id) && dependency?.crossWorktree !== true) return error(id, "worktree_scope_mismatch");
    if (!dependency && ["cycle_id", "session_id"].some((key) => unit.scope[key] && unit.scope[key] !== request.scope[key])) return error(id, "task_scope_mismatch");
    const authority = adoption?.authorities?.find((row) => row.id === unit.authority);
    if (!declarationValid || !authority || authority.reference.split("#")[0] !== unit.path) return error(id, "authority_binding_unavailable");
    if (request.purpose === "effective" && (!effective || authority.status !== "effective" || authority.effectiveFrom > request.asOf || unit.status !== "effective")) return error(id, "authority_not_effective");
    const sources = artifacts.filter((row) => row?.path === unit.path);
    if (sources.length !== 1) return error(id, sources.length ? "canonical_artifact_conflict" : "mandatory_unavailable");
    const artifact = sources[0];
    for (const key of ["project_id", "workspace_id", "worktree_id", "cycle_id", "session_id"]) {
      const actual = artifact.canonical?.[key] ?? artifact[key];
      if (actual && unit.scope[key] !== actual) return error(id, "artifact_scope_mismatch");
    }
    const content = readCanonicalText ? readCanonicalText(artifact) : artifact.content;
    if (typeof content !== "string" || ![undefined, "utf8"].includes(artifact.content_format)) return error(id, "complete_text_unavailable");
    const actualHash = hash(content);
    observedSources.push({ path: unit.path, sha256: actualHash });
    if (actualHash !== unit.sourceSha256 || (artifact.sha256 && artifact.sha256 !== actualHash)) return error(id, "source_revision_mismatch");
    const extracted = completeMarkdownUnit(content, unit.heading);
    if (!extracted) return error(id, "complete_unit_unavailable");
    if (destination.has(id)) return null;
    visiting.add(id);
    for (const edge of unit.requires) {
      const issue = resolve(edge.id, destination, visiting, edge);
      if (issue) { visiting.delete(id); return issue; }
    }
    visiting.delete(id);
    destination.set(id, {
      unit_id: id, artifact_id: artifact.artifact_id ?? null, path: unit.path,
      heading: unit.heading ?? null, authority: { id: authority.id, owner: authority.owner, status: authority.status, reference: authority.reference },
      lifecycle_status: unit.status, scope: unit.scope, selection_reasons: [dependency ? "required_dependency" : "task_obligation"],
      dependency_reason: dependency?.reason ?? null, cross_workspace: dependency?.crossWorkspace === true,
      cross_worktree: dependency?.crossWorktree === true,
      selection_tier: "active", content_state: "included", has_content: true,
      sha256: actualHash, unit_sha256: hash(extracted.content), size_bytes: Buffer.byteLength(content),
      excerpt_bytes: Buffer.byteLength(extracted.content), content_excerpt: extracted.content,
      start_line: extracted.start_line, end_line: extracted.end_line, canonical: artifact.canonical ?? null,
    });
    return null;
  }
  for (const id of request.roots) {
    const issue = resolve(id, selected, new Set());
    if (issue) result.errors.push(issue);
  }
  result.mandatory_ids = [...selected.keys()];
  for (const id of request.optional ?? []) {
    const candidate = new Map(selected);
    const issue = resolve(id, candidate, new Set());
    if (issue) result.omissions.push({ ...issue, optional: true });
    else {
      for (const [key, value] of candidate) if (!selected.has(key)) selected.set(key, { ...value, selection_reasons: ["optional_consultation"] });
    }
  }
  result.expansions = [...selected.values()].map((unit) => ({ unit_id: unit.unit_id, path: unit.path, heading: unit.heading, source_sha256: unit.sha256 }));
  for (const issue of result.errors) {
    const unit = request.units.find((row) => row?.id === issue.unit_id);
    if (unit && !result.expansions.some((row) => row.unit_id === unit.id)) result.expansions.push({ unit_id: unit.id, path: unit.path, heading: unit.heading ?? null, source_sha256: unit.sourceSha256, reason: issue.reason });
  }
  result.status = result.errors.length ? "blocked" : "complete";
  result.units = result.errors.length ? [] : [...selected.values()];
  result.source_revision = hash(JSON.stringify({ snapshot_revision: result.source_revision, observed_sources: observedSources }));
  return result;
}

// Measure the complete compact JSON response, including provenance, diagnostics,
// admissions and this counter. Metadata can itself exceed the limit: report that
// explicitly rather than silently deleting an admission or splitting a rule.
export function finalizeScopedContextBudget(hydrated, selection, args) {
  const mandatory = new Set(selection.mandatory_ids);
  hydrated.context_selection = { ...selection };
  delete hydrated.context_selection.units;
  delete hydrated.context_selection.mandatory_ids;
  hydrated.artifacts = selection.units;
  const budget = {
    budget_scope: "complete-json", serialization: "compact-utf8", budget_status: "within-target",
    selected_count: 0, metadata_only_count: 0, truncated_count: 0, omitted_count: selection.omissions.length,
    total_bytes: 0, target_bytes: args.bundleTargetBytes ?? 262144, hard_limit_bytes: args.bundleHardLimitBytes ?? 1048576,
    fits_hard_limit: true,
  };
  hydrated.bundle_budget = budget;
  if (hydrated.artifact_source) hydrated.artifact_source.bundle_budget = budget;
  const measure = () => {
    budget.selected_count = hydrated.artifacts.length;
    for (let pass = 0; pass < 12; pass += 1) {
      const size = Buffer.byteLength(JSON.stringify(hydrated), "utf8");
      if (size === budget.total_bytes) break;
      budget.total_bytes = size;
    }
    return budget.total_bytes;
  };
  while (measure() > budget.hard_limit_bytes && hydrated.artifacts.some((row) => !mandatory.has(row.unit_id))) {
    const omitted = hydrated.artifacts.filter((row) => !mandatory.has(row.unit_id));
    hydrated.artifacts = hydrated.artifacts.filter((row) => mandatory.has(row.unit_id));
    hydrated.context_selection.omissions.push(...omitted.map((row) => ({ unit_id: row.unit_id, reason: "optional_budget_omitted", optional: true })));
    budget.omitted_count += omitted.length;
  }
  if (measure() > budget.hard_limit_bytes && hydrated.context_selection.status === "complete") {
    hydrated.context_selection.status = "blocked";
    hydrated.context_selection.errors.push({ unit_id: null, reason: "mandatory_budget_insufficient", required_bytes: budget.total_bytes });
    hydrated.artifacts = [];
  }
  budget.fits_hard_limit = measure() <= budget.hard_limit_bytes;
  budget.budget_status = hydrated.context_selection.status === "blocked" ? "blocked"
    : budget.total_bytes <= budget.target_bytes ? "within-target" : "over-target";
  measure();
  // The label can change the measured size at a digit boundary.
  budget.fits_hard_limit = budget.total_bytes <= budget.hard_limit_bytes;
  measure();
  if (budget.total_bytes > budget.hard_limit_bytes && hydrated.context_selection.status === "complete") {
    hydrated.context_selection.status = "blocked";
    hydrated.context_selection.errors.push({ unit_id: null, reason: "mandatory_budget_insufficient", required_bytes: budget.total_bytes });
    hydrated.artifacts = [];
    budget.budget_status = "blocked";
    budget.fits_hard_limit = false;
    measure();
    budget.fits_hard_limit = budget.total_bytes <= budget.hard_limit_bytes;
    measure();
  }
  return hydrated;
}
