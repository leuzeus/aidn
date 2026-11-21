import fs from 'node:fs';
import path from 'node:path';
import { createStandardWorkflowArtifacts, STANDARD_ARTIFACT_MAX_BYTES } from './standard-workflow-artifacts.mjs';
import { createProjectArtifactStore } from './project-artifact-store-service.mjs';
import { agentRunPhysicalPath, readAgentRunFile } from './agent-run-configuration-service.mjs';
import { writeFileAtomicSync } from '../../lib/fs/atomic-write-lib.mjs';
import { buildCanonicalFromMarkdown } from '../../lib/workflow/markdown-render-lib.mjs';
import { artifactContentHash, artifactMetadataHash } from '../../core/workflow/artifact-compare-swap.mjs';
import { freezeShadow, shadowHash } from '../../core/workflow/shadow-json.mjs';
import { assertPrIncidentTrackingInput, assertPrIncidentTrackingPlan, assertPrIncidentTrackingOutput,
  prIncidentRecordOperation, prIncidentResolveOperation } from '../../core/workflow/standard-pr-incident-tracking.mjs';

const fail = code => { throw Object.assign(Error(code), { code }); };
const metadataKeys = ['kind', 'family', 'subtype', 'gate_relevance', 'classification_reason', 'session_id', 'cycle_id',
  'source_mode', 'entity_confidence', 'legacy_origin', 'updated_at'];
const decoded = metadata => metadata === null ? null : { ...metadata, entity_confidence: Number(metadata.entity_confidence) };
const text = change => change.after_chunks.join('');
function field(content, name) {
  const rows = content.split(/\r?\n/).filter(line => line.startsWith(name + ':'));
  if (rows.length !== 1) fail('STANDARD_PR_INCIDENT_TRACKER_INVALID');
  return rows[0].slice(name.length + 1).split('#')[0].trim();
}
function assertTracker(content, source) {
  for (const [name, expected] of [['incident_id', source.incident_id], ['severity', source.severity], ['owner', source.owner],
    ['session', source.session_id], ['checkpoint_sha256', source.checkpoint_sha256]])
    if (field(content, name) !== expected) fail('STANDARD_PR_INCIDENT_TRACKER_UNBOUND');
  const markers = [...content.matchAll(/<!-- aidn:pr-incident-origin:([^\r\n]*?) -->/g)];
  if (markers.length !== 1 || markers[0][1] !== source.origin_operation_id) fail('STANDARD_PR_INCIDENT_TRACKER_UNBOUND');
}

// Called only through the host's ordinary registered operation grant. Source
// readers and the unowned-state boundary are fixed capabilities, never JSON.
export function createStandardPrIncidentTracking({ targetRoot, operation, readSource, readCurrent, observeBoundary,
  now = Date.now, environment = process.env }, { boundary = () => {} } = {}) {
  if (![prIncidentRecordOperation, prIncidentResolveOperation].includes(operation)
    || ![readSource, readCurrent, observeBoundary].every(value => typeof value === 'function')) fail('STANDARD_PR_INCIDENT_CAPABILITY_REQUIRED');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot, env: environment });
  const selected = () => shadowHash(artifacts.describe());
  const location = name => agentRunPhysicalPath(path.join(artifacts.root, 'docs/audit', name), { missing: true });
  const open = readOnly => createProjectArtifactStore({ targetRoot: artifacts.root, readOnly, existingOnly: true, env: environment });
  function row(name) {
    const value = artifacts.read(name);
    if (!artifacts.describe().database) return { ...value, metadata: null, metadata_sha256: null };
    const store = open(true);
    try {
      const record = store.getArtifact(name);
      if ((record?.sha256 ?? null) !== value.sha256) fail('STANDARD_PR_INCIDENT_CANONICAL_CHANGED');
      const metadata = record ? Object.fromEntries(metadataKeys.map(key => [key, key === 'entity_confidence' ? String(record[key]) : record[key] ?? null])) : null;
      return { ...value, metadata, metadata_sha256: record ? artifactMetadataHash(record) : null };
    } finally { store.close(); }
  }
  function current(instance) {
    const actual = readCurrent(instance.instance_id);
    if (actual.instance_sha256 !== instance.instance_sha256 || actual.scope_id !== instance.scope_id) fail('STANDARD_PR_INCIDENT_CONTEXT_CHANGED');
  }
  function projection(change) {
    if (!artifacts.describe().database || artifacts.describe().state_mode === 'db-only') return;
    const file = location(change.path);
    if (fs.existsSync(file) && ![change.before_sha256, change.after_sha256].includes(readAgentRunFile(file, { json: false, maxBytes: STANDARD_ARTIFACT_MAX_BYTES }).sha256))
      fail('STANDARD_PR_INCIDENT_PROJECTION_CONFLICT');
  }
  function visibleState(change) {
    if (!artifacts.describe().database || artifacts.describe().state_mode === 'db-only') return 'not_required';
    const file = location(change.path);
    if (!fs.existsSync(file)) return 'missing';
    const sha = readAgentRunFile(file, { json: false, maxBytes: STANDARD_ARTIFACT_MAX_BYTES }).sha256;
    return sha === change.after_sha256 ? 'after' : sha === change.before_sha256 ? 'before' : 'conflict';
  }
  function state(change) {
    const value = row(change.path);
    if (value.sha256 === change.after_sha256 && value.metadata_sha256 === change.after_metadata_sha256) return 'after';
    if (value.sha256 === change.before_sha256 && value.metadata_sha256 === change.before_metadata_sha256) return 'before';
    return 'conflict';
  }
  function body(source, at) {
    const incidentPath = `incidents/${source.incident_id}.md`, persistence = artifacts.describe();
    return `# Incident TEMP Tracking — ${source.incident_id}\n\nincident_id: ${source.incident_id}\nstatus: OPEN\nseverity: ${source.severity}\ncreated_at: ${at}\nupdated_at: ${at}\nsource_of_truth: ${persistence.database ? persistence.backend + ':project-artifact/' : 'docs/audit/'}${incidentPath}\nlifecycle_status: triaged\nsession: ${source.session_id}\nowner: ${source.owner}\nrecurrence_count: 1\ncheckpoint_sha256: ${source.checkpoint_sha256}\n<!-- aidn:pr-incident-origin:${source.origin_operation_id} -->\n\n## Context\n- Incident: R08_PREMERGE_CONTROLS_UNESTABLISHED.\n- Accepted disposition: aidn:operation-receipt/${source.origin_operation_id} (${source.origin_receipt_sha256}).\n- Resolution at detection: pending. This tracker grants no R09 or workflow-rule permission.\n`;
  }
  async function prepare(instance, input) {
    input = freezeShadow(structuredClone(assertPrIncidentTrackingInput(input)));
    instance = freezeShadow(structuredClone(instance)); current(instance);
    if (artifacts.ownerPending()) return { can_apply: false, reason_code: 'STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED' };
    const source = freezeShadow(structuredClone(await readSource(instance, input)));
    if (source.severity !== 'L2_MEDIUM') fail('STANDARD_PR_INCIDENT_TRACKING_NOT_REQUIRED');
    const name = `incidents/${source.incident_id}.md`, before = row(name), at = now(), iso = new Date(at).toISOString();
    if (before.metadata && (before.metadata.kind !== 'incident' || before.metadata.session_id !== source.session_id))
      fail('STANDARD_PR_INCIDENT_METADATA_UNBOUND');
    let after;
    if (operation === prIncidentRecordOperation) {
      if (before.content !== null) {
        assertTracker(before.content, source);
        if (field(before.content, 'status') !== 'OPEN' || field(before.content, 'lifecycle_status') !== 'triaged') fail('STANDARD_PR_INCIDENT_TRACKER_STATE_CHANGED');
      }
      after = before.content ?? body(source, iso);
    } else {
      if (!before.content || !source.resolution) fail('STANDARD_PR_INCIDENT_RESOLUTION_REQUIRED');
      assertTracker(before.content, source);
      const status = field(before.content, 'status'), lifecycle = field(before.content, 'lifecycle_status');
      const marker = `<!-- aidn:pr-incident-resolution:${source.resolution.completion_operation_id} -->`;
      if (status === 'RESOLVED' && lifecycle === 'closed' && before.content.includes(marker)) after = before.content;
      else {
        if (status !== 'OPEN' || lifecycle !== 'triaged' || before.content.includes('<!-- aidn:pr-incident-resolution:')) fail('STANDARD_PR_INCIDENT_TRACKER_STATE_CHANGED');
        field(before.content, 'updated_at');
        after = before.content.replace(/^status:.*$/m, 'status: RESOLVED').replace(/^lifecycle_status:.*$/m, 'lifecycle_status: closed')
          .replace(/^updated_at:.*$/m, 'updated_at: ' + iso)
          + `\n${marker}\n## Verified resolution\n- Alignment: aidn:operation-receipt/${source.resolution.alignment_operation_id} (${source.resolution.alignment_receipt_sha256}).\n- Confirmed resume: aidn:operation-receipt/${source.resolution.completion_operation_id} (${source.resolution.completion_receipt_sha256}).\n- Original checkpoint: ${source.checkpoint_sha256}.\n- Concise session/snapshot trace and explicit canonical cleanup remain pending.\n`;
      }
    }
    if (Buffer.byteLength(after) > STANDARD_ARTIFACT_MAX_BYTES) fail('STANDARD_PR_INCIDENT_TRACKER_LIMIT');
    const metadata = !artifacts.describe().database ? null : before.metadata ? { ...before.metadata,
      updated_at: before.content === after ? before.metadata.updated_at : new Date(Math.max(at, Date.parse(before.metadata.updated_at))).toISOString() }
      : { kind: 'incident', family: 'normative', subtype: null, gate_relevance: 0, classification_reason: 'standard_pr_incident_tracking',
        session_id: source.session_id, cycle_id: null, source_mode: 'explicit', entity_confidence: '1', legacy_origin: null, updated_at: iso };
    const change = { path: name, before_sha256: before.sha256, before_metadata_sha256: before.metadata_sha256,
      after_chunks: after.match(/[\s\S]{1,8192}/g), after_sha256: artifactContentHash(after), metadata,
      after_metadata_sha256: metadata ? artifactMetadataHash(decoded(metadata)) : null };
    projection(change);
    const selectionSha = selected(), boundarySha = await observeBoundary([name]); current(instance);
    if (row(name).sha256 !== before.sha256 || row(name).metadata_sha256 !== before.metadata_sha256 || selectionSha !== selected()
      || shadowHash(await readSource(instance, input)) !== shadowHash(source)) fail('STANDARD_PR_INCIDENT_PREVIEW_CHANGED');
    current(instance);
    const plan = assertPrIncidentTrackingPlan({ contract_version: 'standard-pr-incident-tracking-plan.v1', operation_ref: operation,
      input, instance_id: instance.instance_id, scope_id: instance.scope_id, prepared_at_ms: at, selection_sha256: selectionSha,
      boundary_sha256: boundarySha, source, source_sha256: shadowHash(source), change });
    return freezeShadow({ can_apply: true, plan, plan_sha256: shadowHash(plan) });
  }
  return Object.freeze({ prepare,
    async apply(instance, input, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      input = freezeShadow(structuredClone(assertPrIncidentTrackingInput(input)));
      instance = freezeShadow(structuredClone(instance));
      const plan = freezeShadow(structuredClone(assertPrIncidentTrackingPlan(prepared?.plan)));
      if (prepared.can_apply !== true || operation !== plan.operation_ref || write !== true || expectPlan !== prepared.plan_sha256
        || expectPlan !== shadowHash(plan) || shadowHash(input) !== shadowHash(plan.input)
        || plan.instance_id !== instance.instance_id || plan.scope_id !== instance.scope_id || typeof assertAuthorized !== 'function'
        || artifactContentHash(text(plan.change)) !== plan.change.after_sha256
        || (plan.change.metadata ? artifactMetadataHash(decoded(plan.change.metadata)) : null) !== plan.change.after_metadata_sha256)
        throw Object.assign(Error('STANDARD_PR_INCIDENT_EXPLICIT_WRITE_REQUIRED'), { code: 'STANDARD_PR_INCIDENT_EXPLICIT_WRITE_REQUIRED', effect_status: 'no_effect' });
      try { current(instance); } catch (cause) { cause.effect_status = 'no_effect'; throw cause; }
      let attempted = false;
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        const change = plan.change;
        async function admit() {
          await assertAuthorized(); current(instance); artifacts.assertLocalEffectOwner(expectPlan);
          if (selected() !== plan.selection_sha256 || shadowHash(await readSource(instance, input)) !== plan.source_sha256
            || await observeBoundary([change.path]) !== plan.boundary_sha256) fail('STANDARD_PR_INCIDENT_PREVIEW_CHANGED');
          projection(change); current(instance); artifacts.assertLocalEffectOwner(expectPlan);
          if (selected() !== plan.selection_sha256) fail('STANDARD_PR_INCIDENT_PREVIEW_CHANGED');
        }
        const result = (outcome, effect_status, reason = null) => {
          const after = state(change) === 'after', completed = outcome === 'completed';
          return assertPrIncidentTrackingOutput({ contract_version: 'standard-pr-incident-tracking-output.v1', operation_ref: operation,
            outcome, effect_status, facts: completed ? { [operation === prIncidentRecordOperation ? 'session_pr_incident_tracking_recorded' : 'session_pr_incident_resolution_verified']: true } : {},
            observations: completed ? { incident_id: plan.source.incident_id, tracker_sha256: change.after_sha256, tracker_metadata_sha256: change.after_metadata_sha256 }
              : { reason_code: /^[A-Z][A-Z0-9_]{0,127}$/.test(reason ?? '') ? reason : 'STANDARD_PR_INCIDENT_UNCONFIRMED' },
            evidence_refs: after && ['confirmed', 'no_effect'].includes(effect_status) ? [{ ref: 'docs/audit/' + change.path, sha256: change.after_sha256 }] : [] });
        };
        try {
          await admit();
          const initial = state(change);
          if (initial === 'conflict') fail('STANDARD_PR_INCIDENT_PREIMAGE_CONFLICT');
          if (initial === 'before') {
            await admit(); attempted = true;
            if (artifacts.describe().database) {
              const store = open(false);
              try { const metadata = decoded(change.metadata);
                store.compareAndSwapArtifact({ expectedSha256: change.before_sha256,
                  ...(change.before_sha256 === null ? {} : { expectedMetadataSha256: change.before_metadata_sha256 }),
                  artifact: { ...metadata, path: change.path, content_format: 'utf8', content: text(change), canonical_format: 'markdown-canonical-v1',
                    canonical: buildCanonicalFromMarkdown(text(change), { relativePath: change.path, classification: { kind: metadata.kind, family: metadata.family, subtype: metadata.subtype } }) } }); }
              finally { store.close(); }
            } else writeFileAtomicSync(location(change.path), text(change));
            if (state(change) !== 'after') fail('STANDARD_PR_INCIDENT_WRITE_UNCONFIRMED');
          }
          await boundary('after_canonical_write');
          await admit();
          // DUAL projects only this owned tracker. DB-only does not materialize it.
          if (!['after', 'not_required'].includes(visibleState(change))) { attempted = true; artifacts.project([change.path]); }
          projection(change);
          if (artifacts.describe().state_mode !== 'db-only') readAgentRunFile(location(change.path), { json: false, sha256: change.after_sha256, maxBytes: STANDARD_ARTIFACT_MAX_BYTES });
          await admit();
          if (state(change) !== 'after') fail('STANDARD_PR_INCIDENT_POSTCONDITION_CHANGED');
          return result('completed', attempted ? 'confirmed' : 'no_effect');
        } catch (cause) {
          const reason = cause.code ?? cause.message;
          let observed;
          try { observed = state(change); } catch {}
          if (!attempted) return result('blocked', 'no_effect', reason);
          let visible;
          try { visible = visibleState(change); } catch {}
          if (observed === 'after' && ['not_required', 'after', 'before', 'missing'].includes(visible)) return result('blocked', 'confirmed', reason);
          if (observed === 'before') return result('blocked', 'no_effect', reason);
          return result('reconciliation_required', 'unknown', reason);
        }
      });
    },
  });
}
