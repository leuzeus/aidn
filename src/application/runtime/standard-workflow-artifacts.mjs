import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readAidnProjectConfig, resolveConfigStateMode, validateAidnProjectConfig } from "../../lib/config/aidn-config-lib.mjs";
import { resolveEffectiveRuntimePersistence, resolveRuntimeSqliteFile } from "./runtime-persistence-service.mjs";
import { createProjectArtifactStore } from "./project-artifact-store-service.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { artifactContentHash, artifactMetadataHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { buildCanonicalFromMarkdown } from "../../lib/workflow/markdown-render-lib.mjs";
import { writeFileAtomicSync } from "../../lib/fs/atomic-write-lib.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import ownerSchema from "../../core/contracts/workflow-definition/process-local-effect-owner.v1.schema.json" with { type: "json" };

export const standardFail = code => { throw Object.assign(new Error(code), { code }); };
const fail = standardFail;

// Business artifacts keep their existing authority. This port never imports a
// visible projection to compensate for a missing/unavailable canonical backend.
export function createStandardWorkflowArtifacts({ targetRoot, env = process.env }) {
  const root = agentRunPhysicalPath(path.resolve(targetRoot), { directory: true });
  function describe() {
    const config = readAidnProjectConfig(root).data; validateAidnProjectConfig(config);
    const stateMode = resolveConfigStateMode(config) ?? "files";
    if (env.AIDN_STATE_MODE && env.AIDN_STATE_MODE.trim().toLowerCase() !== stateMode) fail("STANDARD_STATE_MODE_CONFLICT");
    const persistence = resolveEffectiveRuntimePersistence({ targetRoot: root, env });
    if (config.runtime?.persistence?.backend === "postgres" && persistence.backend !== "postgres") fail("STANDARD_CANONICAL_BACKEND_CONFLICT");
    return { state_mode: stateMode, backend: persistence.backend, source: persistence.source,
      connection_ref: persistence.connectionRef, database: stateMode !== "files" || persistence.backend === "postgres" };
  }
  function relative(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,191}$/.test(value)
      || value.split("/").some(part => [".", "..", ".git", ".aidn", ".codex"].includes(part))) fail("STANDARD_ARTIFACT_PATH_INVALID");
    return value;
  }
  const location = value => agentRunPhysicalPath(path.join(root, "docs/audit", relative(value)), { missing: true });
  function open(readOnly) {
    const current = describe();
    if (current.backend === "sqlite" && !fs.existsSync(resolveRuntimeSqliteFile({ targetRoot: root }))) fail("STANDARD_CANONICAL_STORE_UNAVAILABLE");
    return createProjectArtifactStore({ targetRoot: root, readOnly, existingOnly: true, env });
  }
  function read(name, { required = false } = {}) {
    relative(name); const selected = describe(); let row = null;
    if (selected.database) {
      const store = open(true);
      try { row = store.getArtifact(name); } finally { store.close(); }
      if (row && (row.content_format !== "utf8" || typeof row.content !== "string" || artifactContentHash(row.content) !== row.sha256)) fail("STANDARD_ARTIFACT_INTEGRITY_INVALID");
    } else {
      const file = location(name);
      if (fs.existsSync(file)) { const observed = readAgentRunFile(file, { json: false, maxBytes: 1048576 }); row = { content: observed.value.toString("utf8"), sha256: observed.sha256 }; }
    }
    if (!row && required) fail("STANDARD_REQUIRED_ARTIFACT_MISSING");
    return { path: name, content: row?.content ?? null, sha256: row?.sha256 ?? null, source: selected.database ? selected.backend : "files" };
  }
  function compareAndSwap(change) {
    if (!activeOwner) fail("STANDARD_EFFECT_OWNER_REQUIRED");
    relative(change.path); const selected = describe();
    if (selected.database) {
      const store = open(false);
      try {
        if (typeof store.compareAndSwapArtifact !== "function") fail("STANDARD_CANONICAL_CAS_REQUIRED");
        const isSession = /^sessions\/S\d+\.md$/.test(change.path);
        const cycle = /^cycles\/(C\d+)[^/]*\/status\.md$/.exec(change.path), kind = isSession ? "session" : cycle ? "cycle_status" : change.path === "RUNTIME-STATE.md" ? "runtime_state" : "other";
        const family = kind === "runtime_state" ? "derived" : "normative";
        store.compareAndSwapArtifact({ expectedSha256: change.before_sha256, artifact: { path: change.path, kind, family,
          content_format: "utf8", content: change.after, canonical_format: "markdown-canonical-v1",
          canonical: buildCanonicalFromMarkdown(change.after, { relativePath: change.path, classification: { kind, family, ...(cycle ? { subtype: "status" } : {}) } }),
          ...(cycle ? { cycle_id: cycle[1], subtype: "status" } : {}), ...(isSession ? { session_id: path.basename(change.path, ".md") } : {}) } });
      } finally { store.close(); }
      return { committed: true, projection: selected.state_mode === "dual" || selected.state_mode === "files" ? "pending" : "not_requested" };
    }
    if (read(change.path).sha256 !== change.before_sha256) fail("STANDARD_ARTIFACT_REVISION_CONFLICT");
    writeFileAtomicSync(location(change.path), change.after);
    return { committed: true, projection: "canonical" };
  }
  function project(names) {
    const selected = describe();
    if (!selected.database || selected.state_mode === "db-only") return { requested: false };
    const store = open(false);
    try { return store.materializeArtifacts({ targetRoot: root, auditRoot: "docs/audit", onlyPaths: names, dryRun: false }); }
    finally { store.close(); }
  }
  function metadataHash(name) {
    relative(name); if (!describe().database) return null;
    const store = open(true);
    try { const row = store.getArtifact(name); return row ? artifactMetadataHash(row) : null; } finally { store.close(); }
  }
  function compareAndSwapPreservingMetadata(change) {
    if (!activeOwner) fail("STANDARD_EFFECT_OWNER_REQUIRED");
    relative(change.path);
    if (!Object.hasOwn(change, "before_metadata_sha256") || change.before_metadata_sha256 !== null && !/^[a-f0-9]{64}$/.test(change.before_metadata_sha256)) fail("STANDARD_METADATA_PREIMAGE_REQUIRED");
    const selected = describe();
    if (!selected.database) return { ...compareAndSwap(change), metadata_sha256: null };
    const store = open(false);
    try {
      const previous = store.getArtifact(change.path);
      if ((previous ? artifactMetadataHash(previous) : null) !== change.before_metadata_sha256) fail("STANDARD_ARTIFACT_METADATA_CONFLICT");
      const session = /^sessions\/(S\d+)(?:[-_.][^/]*)?\.md$/.exec(change.path), cycle = /^cycles\/(C\d+)[^/]*\/status\.md$/.exec(change.path);
      const kind = session ? "session" : cycle ? "cycle_status" : "other";
      const artifact = { ...(previous ?? { path: change.path, kind, family: "normative", subtype: cycle ? "status" : null,
        session_id: session?.[1] ?? null, cycle_id: cycle?.[1] ?? null, gate_relevance: 0, classification_reason: "standard_workflow_creation",
        source_mode: "explicit", entity_confidence: 1, legacy_origin: null }),
        content_format: "utf8", content: change.after, sha256: undefined, size_bytes: undefined, mtime_ns: undefined,
        updated_at: new Date().toISOString(), canonical_format: "markdown-canonical-v1", canonical_json: undefined };
      artifact.canonical = buildCanonicalFromMarkdown(change.after, { relativePath: change.path,
        classification: { kind: artifact.kind, family: artifact.family, ...(artifact.subtype ? { subtype: artifact.subtype } : {}) } });
      const metadata_sha256 = artifactMetadataHash(artifact);
      store.compareAndSwapArtifact({ artifact, expectedSha256: change.before_sha256,
        ...(change.before_metadata_sha256 === null ? {} : { expectedMetadataSha256: change.before_metadata_sha256 }) });
      return { committed: true, projection: selected.state_mode === "db-only" ? "not_requested" : "pending", metadata_sha256 };
    } finally { store.close(); }
  }
  // Local serialization is not distributed ownership. Canonical CAS still
  // protects each DB row; crash/concurrent-owner recovery remains explicit.
  const lock = () => agentRunPhysicalPath(path.join(root, ".aidn/runtime/standard-workflow/effects.lock"), { missing: true });
  let activeOwner = false;
  function withLocalEffectOwner(planSha, operation) {
    if (!/^[a-f0-9]{64}$/.test(planSha)) fail("STANDARD_EFFECT_OWNER_PLAN_INVALID");
    const file = lock(); fs.mkdirSync(path.dirname(file), { recursive: true }); let descriptor;
    try { descriptor = fs.openSync(file, "wx"); } catch (cause) { if (cause.code === "EEXIST") fail("STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED"); throw cause; }
    const token = randomUUID(), owner = { contract_version: "process-local-effect-owner.v1", token, pid: process.pid,
      scope_sha256: shadowHash({ physical_root: root }), plan_sha256: planSha, created_at: new Date().toISOString() };
    try {
      if (validateJsonSchema(owner, ownerSchema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_EFFECT_OWNER_INVALID");
      fs.writeFileSync(descriptor, JSON.stringify(owner)); fs.fsyncSync(descriptor);
    }
    catch (cause) { fs.closeSync(descriptor); throw cause; }
    activeOwner = true;
    let uncertain = true;
    return Promise.resolve().then(operation).then(result => { uncertain = !["confirmed", "no_effect"].includes(result?.effect_status); return result; })
    .catch(cause => { uncertain = cause?.effect_status !== "no_effect"; throw cause; }).finally(() => {
      activeOwner = false;
      fs.closeSync(descriptor);
      const retained = readAgentRunFile(file).value;
      if (retained.token !== token) fail("STANDARD_EFFECT_OWNER_CHANGED");
      if (!uncertain) fs.unlinkSync(file);
    });
  }
  function sessions() {
    let names;
    if (describe().database) {
      const store = open(true); try { const rows = store.listArtifacts(10000); if (rows.length >= 10000) fail("STANDARD_ARTIFACT_INVENTORY_TRUNCATED"); names = rows.map(row => row.path); } finally { store.close(); }
    } else {
      const folder = agentRunPhysicalPath(path.join(root, "docs/audit/sessions"), { missing: true });
      names = fs.existsSync(folder) ? fs.readdirSync(folder).map(name => "sessions/" + name) : [];
    }
    const result = names.map(name => [name, /^sessions\/(S\d+)(?:[-_.][^/]*)?\.md$/.exec(name)]).filter(([, match]) => match)
      .map(([name, match]) => ({ ...read(name, { required: true }), session_id: match[1] })).sort((a, b) => a.session_id.localeCompare(b.session_id, "en", { numeric: true }));
    if (new Set(result.map(row => BigInt(row.session_id.slice(1)).toString())).size !== result.length) fail("STANDARD_SESSION_ID_AMBIGUOUS");
    return result;
  }
  function cycles() {
    let names;
    if (describe().database) {
      const store = open(true); try { const rows = store.listArtifacts(10000); if (rows.length >= 10000) fail("STANDARD_ARTIFACT_INVENTORY_TRUNCATED"); names = rows.map(row => row.path); } finally { store.close(); }
    } else {
      const directory = agentRunPhysicalPath(path.join(root, "docs/audit/cycles"), { missing: true });
      names = fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => /^C\d+[^/]*$/.test(name)).map(name => `cycles/${name}/status.md`) : [];
    }
    const result = names.map(name => [name, /^cycles\/(C\d+)[^/]*\/status\.md$/.exec(name)]).filter(([, match]) => match)
      .map(([name, match]) => ({ ...read(name, { required: true }), cycle_id: match[1] })).sort((a, b) => a.cycle_id.localeCompare(b.cycle_id, "en", { numeric: true }));
    if (new Set(result.map(row => BigInt(row.cycle_id.slice(1)).toString())).size !== result.length) fail("STANDARD_CYCLE_ID_AMBIGUOUS");
    return result;
  }
  return Object.freeze({ root, describe, read, sessions, cycles, metadataHash, compareAndSwapPreservingMetadata, compareAndSwap, project, withLocalEffectOwner, ownerPending: () => fs.existsSync(lock()) });
}
