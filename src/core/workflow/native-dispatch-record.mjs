import schema from '../contracts/workflow-definition/native-dispatch-record.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash } from './shadow-json.mjs';
import { nativeJournalId } from './native-allocation-journal.mjs';

const fail = () => { throw Object.assign(Error('NATIVE_DISPATCH_RECORD_INVALID'), { code: 'NATIVE_DISPATCH_RECORD_INVALID' }); };
export const nativeDispatchId = ({ journal_id, kind, nonce, owner_plan_sha256 }) =>
  'native_dispatch_' + shadowHash({ journal_id, kind, nonce, owner_plan_sha256 }).slice(0, 40);
export function nativeDispatchPath(id) {
  if (!/^native_dispatch_[a-f0-9]{40}$/.test(id)) fail();
  return 'workflows/native-dispatches/' + id + '.json';
}
export const nativeDispatchContextHash = value => shadowHash({ native_intent: value.intent,
  instance_sha256: value.instance_sha256, native_journal_sha256: value.native_journal_before_sha256 });

// This is retained provenance, not a grant, a recovery verdict or a statement
// that Native resources and business effects have been reconciled.
export function assertNativeDispatchRecord(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length) fail();
  if (value.dispatch_id !== nativeDispatchId(value) || value.journal_id !== nativeJournalId(value)
    || value.intent.instance_id !== value.instance_id || value.authority.scope_id !== value.scope_id
    || value.authority.model_sha256 !== value.model_sha256
    || value.owner_plan_sha256 !== shadowHash({ authority: value.authority, ...value.intent })
    || (value.kind === 'allocation') !== Object.hasOwn(value.intent, 'authorization_sha256')
    || (value.instance_sha256 === null) !== (value.instance_revision === null)) fail();
  if ((value.phase === 'returned') !== (value.result_sha256 !== null)
    || (value.phase === 'threw') !== (value.error_code !== null)
    || ['reserved', 'running'].includes(value.phase) && value.native_journal_after_sha256 !== null) fail();
  const tokens = new Set(), fences = new Set(), context = nativeDispatchContextHash(value);
  for (const intention of value.local_owner_intentions) {
    const { owner, resource_fence } = intention, proposed = resource_fence.record;
    if (tokens.has(owner.token) || fences.has(proposed.token)
      || owner.pid !== value.process_identity.pid || owner.scope_sha256 !== value.local_owner_scope_sha256
      || owner.plan_sha256 !== value.owner_plan_sha256 || intention.context_sha256 !== context
      || proposed.state !== 'held' || proposed.physical_root_sha256 !== value.physical_root_sha256
      || shadowHash(proposed.process_identity) !== shadowHash(value.process_identity)) fail();
    tokens.add(owner.token); fences.add(proposed.token);
  }
  const leased = new Set();
  for (const lease of value.leases) {
    const intention = value.local_owner_intentions.find(row => shadowHash(row.owner) === shadowHash(lease.owner));
    if (!intention || leased.has(lease.owner.token)
      || shadowHash(intention.resource_fence.record) !== shadowHash(lease.resource_fence)) fail();
    leased.add(lease.owner.token);
  }
  if (value.phase === 'running' && !value.leases.length) fail();
  return value;
}
