const text = (value) => typeof value === "string" && value.trim().length > 0;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const statuses = new Set(["proposed", "accepted", "deprecated", "superseded", "revoked"]);
const dispositions = new Set(["adopted", "adapted", "deferred", "omitted"]);
const authorityStatuses = new Set(["effective", "proposed", "superseded", "historical", "projection"]);

function date(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

// This validates a declaration, not its human acceptance or runtime permission.
// No reference is fetched, interpreted, installed or promoted by this module.
export function validateGovernanceAdoption(value, { expectedScope } = {}) {
  const issues = [];
  const require = (condition, path) => { if (!condition) issues.push(path); };
  if (!object(value)) return { ok: false, issues: ["governanceAdoption must be an object"] };
  const fields = new Set(["schemaVersion", "adoptionId", "revision", "status", "scope", "owner", "recordedAt",
    "method", "acceptance", "precedence", "authorities", "sections", "omissions", "reviewTriggers", "history", "replacement", "changeDecision", "extensions"]);
  require(Object.keys(value).every((key) => fields.has(key)), "unsupported fields; preserve extensions under extensions");
  require(value.schemaVersion === 1, "schemaVersion must be 1");
  require(text(value.adoptionId), "adoptionId required");
  require(Number.isSafeInteger(value.revision) && value.revision > 0, "revision must be positive");
  require(statuses.has(value.status), "status must be explicit");
  require(["package-source", "installed-project"].includes(value.scope), "scope invalid");
  if (expectedScope) require(value.scope === expectedScope, "scope differs from consumer");
  require(text(value.owner), "owner required");
  require(date(value.recordedAt), "recordedAt must be a calendar date");
  require(text(value.precedence), "precedence required");
  const method = value.method;
  require(object(method) && ["name", "version", "repository", "path"].every((key) => text(method[key]))
    && /^[a-f0-9]{40}$/.test(method.commit ?? "") && /^[a-f0-9]{64}$/.test(method.sha256 ?? ""), "method must pin version, commit, path and SHA-256");
  const acceptance = value.acceptance;
  if (["accepted", "deprecated", "superseded", "revoked"].includes(value.status)) {
    require(object(acceptance) && text(acceptance.authority) && text(acceptance.decisionRef)
      && date(acceptance.acceptedAt) && date(acceptance.effectiveFrom)
      && acceptance.acceptedAt <= acceptance.effectiveFrom
      && acceptance.acceptedAt <= value.recordedAt, "acceptance must identify authority, decision and dates");
  } else {
    require(acceptance === null, "proposed declaration must not assert acceptance");
  }
  const authorities = Array.isArray(value.authorities) ? value.authorities : [];
  require(authorities.length > 0, "authorities required");
  const byId = new Map();
  for (const [index, authority] of authorities.entries()) {
    require(object(authority) && ["id", "reference", "role", "scope", "owner"].every((key) => text(authority[key]))
      && authorityStatuses.has(authority.status), `authorities[${index}] identity, status, scope and owner required`);
    if (!object(authority)) continue;
    require(!byId.has(authority.id), `authorities[${index}] duplicate id`);
    if (authority.status === "effective") require(date(authority.effectiveFrom), `authorities[${index}] effectiveFrom required`);
    if (authority.status === "superseded") require(text(authority.supersededBy), `authorities[${index}] supersededBy required`);
    byId.set(authority.id, authority);
  }
  const sections = Array.isArray(value.sections) ? value.sections : [];
  require(sections.length > 0, "sections required");
  const sectionIds = new Set();
  for (const [index, section] of sections.entries()) {
    require(object(section) && text(section.id) && dispositions.has(section.disposition)
      && text(section.rationale) && text(section.responsibility), `sections[${index}] disposition, rationale and responsibility required`);
    if (!object(section)) continue;
    require(!sectionIds.has(section.id), `sections[${index}] duplicate id`);
    sectionIds.add(section.id);
    const references = Array.isArray(section.authorities) ? section.authorities : [];
    require(Array.isArray(section.authorities) && references.every((id) => byId.has(id)), `sections[${index}] authority references invalid`);
    require(Array.isArray(section.controls) && section.controls.every(text), `sections[${index}] controls must be explicit references`);
    if (["adopted", "adapted"].includes(section.disposition)) {
      require(references.length > 0, `sections[${index}] binding requires an authority`);
      if (value.status === "accepted") require(references.every((id) => byId.get(id)?.status === "effective"),
        `sections[${index}] proposed or historical authority cannot become effective by detection`);
    }
  }
  for (const key of ["omissions", "reviewTriggers"]) require(Array.isArray(value[key]) && value[key].length > 0 && value[key].every(text), `${key} required`);
  require(Array.isArray(value.history), "history references required, including an empty initial history");
  for (const [index, record] of (Array.isArray(value.history) ? value.history : []).entries()) {
    require(object(record) && text(record.adoptionId) && Number.isSafeInteger(record.revision) && record.revision > 0
      && text(record.reference) && /^[a-f0-9]{64}$/.test(record.sha256 ?? ""), `history[${index}] immutable reference and hash required`);
  }
  if (value.revision > 1) require(value.history?.length > 0, "later revisions require preserved history references");
  if (["deprecated", "superseded", "revoked"].includes(value.status)) require(value.revision > 1
    && object(value.changeDecision) && text(value.changeDecision.authority) && text(value.changeDecision.reference)
    && date(value.changeDecision.recordedAt), "withdrawal requires a new revision and explicit change decision");
  if (value.status === "superseded") require(object(value.replacement) && text(value.replacement.adoptionId)
    && text(value.replacement.decisionRef), "superseded declaration requires replacement");
  if (value.extensions !== undefined) require(object(value.extensions), "extensions must be an object");
  // Reject non-JSON values instead of silently deleting them during a write.
  const seen = new Set();
  function json(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (!object(value) && !Array.isArray(value)) return false;
    if (seen.has(value) || (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) return false;
    seen.add(value);
    const valid = Object.values(value).every(json);
    seen.delete(value);
    return valid;
  }
  require(json(value), "declaration must contain only JSON values");
  return { ok: issues.length === 0, issues };
}

export function preserveGovernanceAdoption(value, options = {}) {
  const validation = validateGovernanceAdoption(value, options);
  if (!validation.ok) throw new Error(`Invalid governanceAdoption: ${validation.issues.join("; ")}`);
  return JSON.parse(JSON.stringify(value));
}

export function isGovernanceAdoptionEffective(value, { asOf, expectedScope } = {}) {
  return date(asOf) && validateGovernanceAdoption(value, { expectedScope }).ok
    && value.status === "accepted" && value.acceptance.effectiveFrom <= asOf
    && value.sections.filter((section) => ["adopted", "adapted"].includes(section.disposition))
      .every((section) => section.authorities.every((id) => value.authorities.find((authority) => authority.id === id).effectiveFrom <= asOf));
}
