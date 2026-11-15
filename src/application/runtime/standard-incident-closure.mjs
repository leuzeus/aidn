import fs from 'node:fs';
import path from 'node:path';
import { createStandardWorkflowArtifacts, STANDARD_ARTIFACT_MAX_BYTES } from './standard-workflow-artifacts.mjs';
import { createProjectArtifactStore } from './project-artifact-store-service.mjs';
import { agentRunPhysicalPath, readAgentRunFile } from './agent-run-configuration-service.mjs';
import { artifactContentHash, artifactMetadataHash } from '../../core/workflow/artifact-compare-swap.mjs';
import { shadowHash, checkShadowJson, freezeShadow } from '../../core/workflow/shadow-json.mjs';
import { exactFileIdentity } from '../../lib/fs/exact-file-identity.mjs';
import { writeFileAtomicSync } from '../../lib/fs/atomic-write-lib.mjs';
import { buildCanonicalFromMarkdown } from '../../lib/workflow/markdown-render-lib.mjs';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import evidenceSchema from '../../core/contracts/workflow-definition/standard-incident-close-evidence.v1.schema.json' with { type: 'json' };
import planSchema from '../../core/contracts/workflow-definition/standard-incident-close-plan.v1.schema.json' with { type: 'json' };
import resultSchema from '../../core/contracts/workflow-definition/standard-incident-close-result.v1.schema.json' with { type: 'json' };

const fail = code => { throw Object.assign(new Error(code), { code }); };
const metadataKeys = ['kind', 'family', 'subtype', 'gate_relevance', 'classification_reason', 'session_id', 'cycle_id',
  'source_mode', 'entity_confidence', 'legacy_origin', 'updated_at'];
const validate = (value, schema, code) => {
  if (checkShadowJson(value, { maxStringLength: STANDARD_ARTIFACT_MAX_BYTES }) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length) fail(code);
  return value;
};
function field(content, name) {
  const rows = content.split(/\r?\n/).filter(line => line.startsWith(name + ':'));
  if (rows.length !== 1) fail('STANDARD_INCIDENT_TRACKER_INVALID');
  return rows[0].slice(name.length + 1).split('#')[0].trim();
}
function decodeMetadata(metadata) {
  if (metadata === null) return null;
  const confidence = Number(metadata.entity_confidence);
  if (!Number.isFinite(confidence) || String(confidence) !== metadata.entity_confidence) fail('STANDARD_INCIDENT_METADATA_INVALID');
  return { ...metadata, entity_confidence: confidence };
}
const marker = plan => `<!-- aidn:incident-closure:${plan.incident_id}:${shadowHash(plan.evidence)} -->`;

// Private business port. Evidence and boundary readers are trusted capabilities
// supplied by a fixed host, never an action-file field. The host must authenticate
// resolution, the recorded checkpoint, accepted resume and rule authorization.
// This factory does not implement that production reader or the incident triage.
export function createStandardIncidentClosure({ targetRoot, readEvidence, observeBoundary, readCurrent,
  now = Date.now, environment = process.env }, { boundary = () => {} } = {}) {
  if (![readEvidence, observeBoundary, readCurrent].every(value => typeof value === 'function')) fail('STANDARD_INCIDENT_CAPABILITY_REQUIRED');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot, env: environment });
  const location = name => agentRunPhysicalPath(path.join(artifacts.root, 'docs/audit', name), { missing: true });
  const open = readOnly => createProjectArtifactStore({ targetRoot: artifacts.root, readOnly, existingOnly: true, env: environment });
  const selection = () => shadowHash(artifacts.describe());
  function row(name) {
    const observed = artifacts.read(name);
    if (!artifacts.describe().database) return { ...observed, metadata_sha256: null, metadata: null };
    const store = open(true);
    try {
      const record = store.getArtifact(name);
      if ((record?.sha256 ?? null) !== observed.sha256) fail('STANDARD_INCIDENT_CANONICAL_CHANGED');
      return { ...observed, metadata_sha256: record ? artifactMetadataHash(record) : null,
        metadata: record ? Object.fromEntries(metadataKeys.map(key => [key, key === 'entity_confidence' ? String(record[key]) : record[key] ?? null])) : null };
    } finally { store.close(); }
  }
  function current(instance) {
    const actual = readCurrent(instance.instance_id);
    if (!actual || actual.instance_sha256 !== instance.instance_sha256 || actual.scope_id !== instance.scope_id) fail('STANDARD_INCIDENT_INSTANCE_CHANGED');
  }
  async function evidence(instance, incidentId, incidentSha) {
    const result = validate(await readEvidence({ instance_id: instance.instance_id, incident_id: incidentId,
      incident_sha256: incidentSha }), evidenceSchema, 'STANDARD_INCIDENT_EVIDENCE_INVALID');
    if (result.incident_id !== incidentId || result.incident_sha256 !== incidentSha || result.instance_id !== instance.instance_id || result.scope_id !== instance.scope_id
      || result.instance_sha256 !== instance.instance_sha256) fail('STANDARD_INCIDENT_EVIDENCE_UNBOUND');
    return freezeShadow(structuredClone(result));
  }
  function assertPlan(prepared, instance) {
    if (checkShadowJson(prepared, { maxStringLength: STANDARD_ARTIFACT_MAX_BYTES })
      || Object.keys(prepared).sort().join(',') !== 'can_apply,plan,plan_sha256') fail('STANDARD_INCIDENT_PLAN_INVALID');
    const plan = validate(prepared.plan, planSchema, 'STANDARD_INCIDENT_PLAN_INVALID');
    if (plan.instance_id !== instance.instance_id || plan.scope_id !== instance.scope_id || plan.instance_sha256 !== instance.instance_sha256
      || plan.incident_path !== `incidents/${plan.incident_id}.md`
      || plan.evidence.incident_id !== plan.incident_id || plan.evidence.incident_sha256 !== plan.incident_sha256
      || plan.evidence.instance_id !== plan.instance_id || plan.evidence.scope_id !== plan.scope_id || plan.evidence.instance_sha256 !== plan.instance_sha256
      || !/^sessions\/S[0-9]{3,6}(?:[-_.][A-Za-z0-9._-]+)?\.md$/.test(plan.session_path)
      || plan.traces[0].path !== plan.session_path || plan.traces[1].path !== 'snapshots/context-snapshot.md'
      || plan.traces.some(change => artifactContentHash(change.after) !== change.after_sha256
        || !change.after.includes(marker(plan)) || (change.metadata ? artifactMetadataHash(decodeMetadata(change.metadata)) : null) !== change.after_metadata_sha256)
      || prepared.plan_sha256 !== shadowHash(plan)) fail('STANDARD_INCIDENT_PLAN_INVALID');
    return freezeShadow(structuredClone(plan));
  }
  async function prepare(instance, { incident_id: incidentId } = {}) {
    if (!evidenceSchema.properties.incident_id.pattern || !new RegExp(evidenceSchema.properties.incident_id.pattern).test(incidentId ?? '')) fail('STANDARD_INCIDENT_ID_INVALID');
    instance = Object.freeze({ instance_id: instance.instance_id, scope_id: instance.scope_id, instance_sha256: instance.instance_sha256 });
    current(instance);
    const selected = selection(), incidentPath = `incidents/${incidentId}.md`, incident = row(incidentPath);
    if (!incident.content) fail('STANDARD_INCIDENT_TRACKER_REQUIRED');
    if (field(incident.content, 'incident_id') !== incidentId || field(incident.content, 'status') !== 'RESOLVED'
      || field(incident.content, 'lifecycle_status') !== 'closed') fail('STANDARD_INCIDENT_NOT_RESOLVED');
    const severity = field(incident.content, 'severity'), sessionId = field(incident.content, 'session');
    if (!['L1_LOW', 'L2_MEDIUM', 'L3_HIGH', 'L4_CRITICAL'].includes(severity) || !/^S[0-9]{3,6}$/.test(sessionId)) fail('STANDARD_INCIDENT_TRACKER_INVALID');
    const supplied = await evidence(instance, incidentId, incident.sha256);
    if (['L3_HIGH', 'L4_CRITICAL'].includes(severity) && !supplied.stop_observed) fail('STANDARD_INCIDENT_STOP_REQUIRED');
    if (supplied.workflow_rules_changed && (!['L3_HIGH', 'L4_CRITICAL'].includes(severity) || !supplied.rule_authorization)) fail('STANDARD_INCIDENT_RULE_AUTHORIZATION_REQUIRED');
    const sessions = artifacts.sessions().filter(session => session.session_id === sessionId);
    if (sessions.length !== 1) fail('STANDARD_INCIDENT_SESSION_AMBIGUOUS');
    const sessionPath = sessions[0].path;
    const owned = [incidentPath, sessionPath, 'snapshots/context-snapshot.md'];
    const boundarySha = await observeBoundary(owned), at = now();
    const plan = { contract_version: 'standard-incident-close-plan.v1', instance_id: instance.instance_id, scope_id: instance.scope_id,
      instance_sha256: instance.instance_sha256, incident_id: incidentId, incident_path: incidentPath, incident_sha256: incident.sha256,
      incident_metadata_sha256: incident.metadata_sha256, session_path: sessionPath, evidence: supplied,
      boundary_sha256: boundarySha, selection_sha256: selected, prepared_at_ms: at, traces: [] };
    const trace = `\n${marker(plan)}\n- Incident ${incidentId}: resolved; resume ${supplied.resume_ref.ref} (${supplied.resume_ref.sha256}); checkpoint ${supplied.checkpoint_sha256}.\n- Resolution ${supplied.resolution_ref.ref} (${supplied.resolution_ref.sha256}).\n`;
    for (const name of owned.slice(1)) {
      const before = row(name);
      if (!before.content || before.content.includes(`<!-- aidn:incident-closure:${incidentId}:`)) fail('STANDARD_INCIDENT_TRACE_CONFLICT');
      const after = before.content + trace;
      if (Buffer.byteLength(after) > STANDARD_ARTIFACT_MAX_BYTES) fail('STANDARD_INCIDENT_TRACE_LIMIT');
      const metadata = before.metadata ? { ...before.metadata,
        updated_at: new Date(Math.max(at, Date.parse(before.metadata.updated_at))).toISOString() } : null;
      plan.traces.push({ path: name, before_sha256: before.sha256, before_metadata_sha256: before.metadata_sha256,
        after, after_sha256: artifactContentHash(after), metadata, after_metadata_sha256: metadata ? artifactMetadataHash(decodeMetadata(metadata)) : null });
    }
    current(instance);
    if (selection() !== selected || (await observeBoundary(owned)) !== boundarySha || row(incidentPath).sha256 !== incident.sha256
      || row(incidentPath).metadata_sha256 !== incident.metadata_sha256) fail('STANDARD_INCIDENT_PREVIEW_CHANGED');
    const prepared = { can_apply: true, plan, plan_sha256: shadowHash(plan) };
    assertPlan(prepared, instance); return freezeShadow(structuredClone(prepared));
  }
  function state(change) {
    const actual = row(change.path);
    if (actual.sha256 === change.after_sha256 && actual.metadata_sha256 === change.after_metadata_sha256) return 'after';
    if (actual.sha256 === change.before_sha256 && actual.metadata_sha256 === change.before_metadata_sha256) return 'before';
    return 'conflict';
  }
  function removeFile(name, expectedSha) {
    const file = location(name);
    if (!fs.existsSync(file)) return false;
    const identity = exactFileIdentity(fs.lstatSync(file, { bigint: true }));
    readAgentRunFile(file, { json: false, sha256: expectedSha, maxBytes: STANDARD_ARTIFACT_MAX_BYTES });
    if (shadowHash(exactFileIdentity(fs.lstatSync(file, { bigint: true }))) !== shadowHash(identity)) fail('STANDARD_INCIDENT_FILE_CHANGED');
    fs.unlinkSync(file); return true;
  }
  return Object.freeze({ prepare,
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      let plan;
      try {
        plan = assertPlan(prepared, instance);
        instance = Object.freeze({ instance_id: plan.instance_id, scope_id: plan.scope_id, instance_sha256: plan.instance_sha256 });
        if (write !== true || prepared.can_apply !== true || expectPlan !== prepared.plan_sha256 || typeof assertAuthorized !== 'function') fail('STANDARD_INCIDENT_EXPLICIT_EFFECT_REQUIRED');
        current(instance);
      } catch (cause) { cause.effect_status = 'no_effect'; throw cause; }
      const owned = [plan.incident_path, ...plan.traces.map(change => change.path)], committed = [];
      let attemptedEffect = false;
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        async function admit() {
          await assertAuthorized();
          const fresh = await evidence(instance, plan.incident_id, plan.incident_sha256);
          current(instance); artifacts.assertLocalEffectOwner(expectPlan);
          if (shadowHash(fresh) !== shadowHash(plan.evidence) || selection() !== plan.selection_sha256
            || (await observeBoundary(owned)) !== plan.boundary_sha256) fail('STANDARD_INCIDENT_PREVIEW_CHANGED');
        }
        const result = (outcome, effectStatus, reason = null) => {
          const references = [];
          for (const change of plan.traces) {
            try { if (state(change) === 'after') references.push({ ref: 'docs/audit/' + change.path, sha256: change.after_sha256 }); } catch {}
          }
          return validate({ contract_version: 'standard-incident-close-result.v1',
          outcome, effect_status: effectStatus, incident_id: plan.incident_id, plan_sha256: expectPlan,
          facts: outcome === 'completed' ? { incident_tracking_removed: true, incident_resume_confirmed: true } : {},
          committed, reason_code: reason === null || /^[A-Z][A-Z0-9_]{0,127}$/.test(reason) ? reason : 'STANDARD_INCIDENT_INCOMPLETE',
          evidence_refs: references }, resultSchema, 'STANDARD_INCIDENT_RESULT_INVALID');
        };
        try {
          await admit();
          const initial = plan.traces.map(state), tracker = row(plan.incident_path);
          if (initial.includes('conflict') || tracker.sha256 !== null && (tracker.sha256 !== plan.incident_sha256
            || tracker.metadata_sha256 !== plan.incident_metadata_sha256) || tracker.sha256 === null && initial.some(value => value !== 'after')) fail('STANDARD_INCIDENT_PREIMAGE_CONFLICT');
          for (const [index, change] of plan.traces.entries()) {
            await admit();
            if (state(change) === 'before') {
              attemptedEffect = true;
              if (artifacts.describe().database) {
                const store = open(false);
                try { store.compareAndSwapArtifact({ expectedSha256: change.before_sha256, expectedMetadataSha256: change.before_metadata_sha256,
                  artifact: { ...decodeMetadata(change.metadata), path: change.path, content_format: 'utf8', content: change.after,
                    canonical_format: 'markdown-canonical-v1', canonical: buildCanonicalFromMarkdown(change.after, {
                      relativePath: change.path, classification: { kind: change.metadata.kind, family: change.metadata.family, subtype: change.metadata.subtype } }) } }); }
                finally { store.close(); }
              } else writeFileAtomicSync(location(change.path), change.after);
              committed.push(change.path);
            }
            if (state(change) !== 'after') fail('STANDARD_INCIDENT_TRACE_UNCONFIRMED');
            if (artifacts.describe().database && artifacts.describe().state_mode !== 'db-only' && fs.existsSync(location(change.path))) {
              const visibleSha = readAgentRunFile(location(change.path), { json: false, maxBytes: STANDARD_ARTIFACT_MAX_BYTES }).sha256;
              if (![change.before_sha256, change.after_sha256].includes(visibleSha)) fail('STANDARD_INCIDENT_PROJECTION_CONFLICT');
            }
            const projection = artifacts.project([change.path]);
            if (Number(projection.exported ?? 0) > 0) { attemptedEffect = true; committed.push('projection:' + change.path); }
            if (artifacts.describe().state_mode !== 'db-only') readAgentRunFile(location(change.path), { json: false, sha256: change.after_sha256, maxBytes: STANDARD_ARTIFACT_MAX_BYTES });
            await boundary('after_trace_' + index);
          }
          await admit();
          if (row(plan.incident_path).sha256 !== null) {
            attemptedEffect = true;
            if (artifacts.describe().database) {
              const store = open(false);
              try { store.compareAndDeleteArtifact({ write: true, path: plan.incident_path, expectedSha256: plan.incident_sha256,
                expectedMetadataSha256: plan.incident_metadata_sha256 }); } finally { store.close(); }
            } else removeFile(plan.incident_path, plan.incident_sha256);
            committed.push(plan.incident_path);
          }
          await boundary('after_canonical_delete');
          if (artifacts.describe().database && fs.existsSync(location(plan.incident_path))) {
            attemptedEffect = true;
            if (removeFile(plan.incident_path, plan.incident_sha256)) committed.push('projection:' + plan.incident_path);
          }
          await admit();
          if (row(plan.incident_path).sha256 !== null || plan.traces.some(change => state(change) !== 'after')) fail('STANDARD_INCIDENT_CLOSURE_UNCONFIRMED');
          return result('completed', committed.length ? 'confirmed' : 'no_effect');
        } catch (cause) {
          if (!attemptedEffect) return result('incomplete', 'no_effect', cause.code ?? 'STANDARD_INCIDENT_REFUSED');
          // A known partial is not completion. Only exact observable before/after
          // states allow ordinary owner release; unknown writes retain the owner.
          try {
            const states = plan.traces.map(state), tracker = row(plan.incident_path);
            const knownTracker = tracker.sha256 === plan.incident_sha256 && tracker.metadata_sha256 === plan.incident_metadata_sha256
              || tracker.sha256 === null && states.every(value => value === 'after');
            if (!states.includes('conflict') && knownTracker) return result('incomplete', states.includes('after') || tracker.sha256 === null ? 'confirmed' : 'no_effect', cause.code ?? 'STANDARD_INCIDENT_INCOMPLETE');
          } catch {}
          return result('reconciliation_required', 'unknown', cause.code ?? 'STANDARD_INCIDENT_UNKNOWN');
        }
      });
    },
  });
}
