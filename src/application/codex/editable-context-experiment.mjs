import { createHash } from "node:crypto";

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const copy = value => structuredClone(value);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("|") === [...keys].sort().join("|");

// Opt-in research only. The host supplies a tokenizer bound to the exact model
// revision. No native Codex transcript, canonical artifact, policy or permission
// is editable here. State and snapshots have this experiment's lifetime only.
export function createEditableContextExperiment({ optIn = false, protectedPrefix, task, sourceRevision,
  currentSourceRevision, tokenizer, tokenizerIdentity, modelIdentity, capacityTokens, reservedTokens = 0,
  initialEntries = [], validateTransformation } = {}) {
  if (!optIn) fail("EDITABLE_CONTEXT_OPT_IN_REQUIRED");
  if (![protectedPrefix, task, sourceRevision].every(value => typeof value === "string" && value.length)
      || typeof currentSourceRevision !== "function" || typeof tokenizer !== "function"
      || typeof validateTransformation !== "function"
      || !Number.isSafeInteger(capacityTokens) || capacityTokens <= 0
      || !Number.isSafeInteger(reservedTokens) || reservedTokens < 0 || reservedTokens >= capacityTokens)
    fail("EDITABLE_CONTEXT_HOST_CONFIGURATION_REQUIRED");
  const identity = copy(modelIdentity), tokenIdentity = copy(tokenizerIdentity);
  if (!identity || !["provider", "model", "model_revision"].every(key => typeof identity[key] === "string" && identity[key]
      && tokenIdentity?.[key] === identity[key]) || typeof tokenIdentity.tokenizer_sha256 !== "string"
      || !/^[a-f0-9]{64}$/.test(tokenIdentity.tokenizer_sha256)) fail("EDITABLE_CONTEXT_TOKENIZER_BINDING_REQUIRED");
  const prefix = Object.freeze({ system: protectedPrefix, task });
  let document = { prefix: copy(prefix), entries: copy(initialEntries) }, busy = false, initialized = false;
  const audit = [], snapshots = [];
  function structural(candidate) {
    if (!exactKeys(candidate, ["prefix", "entries"]) || !exactKeys(candidate.prefix, ["system", "task"])
        || candidate.prefix.system !== prefix.system || candidate.prefix.task !== prefix.task)
      fail("EDITABLE_CONTEXT_PROTECTED_PREFIX");
    if (!Array.isArray(candidate.entries) || candidate.entries.length > 128
        || new Set(candidate.entries.map(entry => entry?.id)).size !== candidate.entries.length
        || candidate.entries.some(entry => !exactKeys(entry, ["id", "kind", "text"])
          || typeof entry.id !== "string" || !/^[a-zA-Z0-9._-]{1,80}$/.test(entry.id)
          || !["working", "evidence", "observation"].includes(entry.kind)
          || typeof entry.text !== "string" || entry.text.length > 65536)
        || Buffer.byteLength(JSON.stringify(candidate)) > 262144) fail("EDITABLE_CONTEXT_STRUCTURE_INVALID");
  }
  structural(document);
  async function validate(candidate, before) {
    structural(candidate);
    if (await currentSourceRevision() !== sourceRevision) fail("EDITABLE_CONTEXT_SOURCE_STALE");
    if (await validateTransformation(copy(before), copy(candidate)) !== true) fail("EDITABLE_CONTEXT_EDIT_GATE_REFUSED");
    // Count the whole serialized input, including protected material. A missing
    // tokenizer or estimated bytes can never stand in for native model tokens.
    const count = await tokenizer(JSON.stringify(candidate), copy(tokenIdentity));
    if (!Number.isSafeInteger(count) || count < 0) fail("EDITABLE_CONTEXT_TOKEN_COUNT_INVALID");
    if (count + reservedTokens > capacityTokens) fail("EDITABLE_CONTEXT_HARD_LIMIT");
    if (await currentSourceRevision() !== sourceRevision) fail("EDITABLE_CONTEXT_SOURCE_STALE");
    return count;
  }
  async function transaction({ preimageSha256, source_revision: revision, next, kind, snapshotIndex = null }) {
    if (busy) fail("EDITABLE_CONTEXT_BUSY");
    busy = true;
    try {
      if (!initialized) fail("EDITABLE_CONTEXT_INITIALIZATION_REQUIRED");
      if (revision !== sourceRevision || preimageSha256 !== hash(document)) fail("EDITABLE_CONTEXT_PREIMAGE_MISMATCH");
      const before = copy(document), candidate = copy(next);
      const tokens = await validate(candidate, before);
      // No await after validation: snapshot, audit and replacement commit as
      // one in-memory operation. Callers cannot mutate retained preimages.
      const record = { sequence: audit.length + 1, kind, source_revision: sourceRevision,
        before_sha256: hash(before), after_sha256: hash(candidate), tokens,
        tokenizer: copy(tokenIdentity), rollback_snapshot: snapshotIndex };
      snapshots.push(before); audit.push(record); document = candidate;
      return { status: "applied", ...copy(record), write_authorization: false, claims_are: "untrusted-agent-assertions" };
    } finally { busy = false; }
  }
  return {
    async initialize() {
      if (busy || initialized) fail("EDITABLE_CONTEXT_ALREADY_INITIALIZED");
      busy = true;
      try { await validate(copy(document), copy(document)); initialized = true; return this.inspect(); }
      finally { busy = false; }
    },
    inspect() { return { document: copy(document), preimage_sha256: hash(document), source_revision: sourceRevision,
      initialized, snapshots: snapshots.length, audit: copy(audit), native_transcript_edited: false, write_authorization: false }; },
    apply({ preimage_sha256, source_revision, document: next }) { return transaction({ preimageSha256: preimage_sha256, source_revision, next, kind: "edit" }); },
    rollback({ preimage_sha256, source_revision, snapshot_index }) {
      if (!Number.isSafeInteger(snapshot_index) || snapshot_index < 0 || snapshot_index >= snapshots.length) fail("EDITABLE_CONTEXT_SNAPSHOT_UNAVAILABLE");
      return transaction({ preimageSha256: preimage_sha256, source_revision, next: snapshots[snapshot_index], kind: "rollback", snapshotIndex: snapshot_index });
    },
  };
}
