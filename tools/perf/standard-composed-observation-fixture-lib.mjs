import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';

// Fixture observations only. The real host still owns routing, authentication,
// admission and effects. No output body, key or authority is supplied by a trace.
export function observeComposedHost(host, file) {
  let sequence = 0; const hostId = randomUUID();
  const emit = row => {
    if (++sequence > 4096) throw Error('FIXTURE_HOST_OBSERVATION_LIMIT');
    fs.appendFileSync(file, JSON.stringify({ host_id: hostId, sequence, pid: process.pid, utc: new Date().toISOString(), ...row }) + '\n');
  };
  return Object.freeze(Object.fromEntries(Object.entries(host).map(([name, value]) => [name, typeof value !== 'function' ? value : (...args) => {
    const start = performance.now(); emit({ method: name, boundary: 'start' });
    const finish = (result, error) => {
      emit({ method: name, boundary: error ? 'throw' : 'return', elapsed_ms: Math.round((performance.now() - start) * 1000) / 1000,
        ...(error ? { reason_code: error.code ?? 'FIXTURE_HOST_CALL_FAILED' } : { status: result?.status ?? result?.cursor?.status ?? null,
          kind: result?.kind ?? null, operation_id: result?.operation_id ?? null, revision: result?.record?.revision ?? null }) });
      if (error) throw error;
      return result;
    };
    let result;
    try { result = value(...args); } catch (error) { return finish(null, error); }
    return result && typeof result.then === 'function' ? result.then(out => finish(out), error => finish(null, error)) : finish(result);
  }])));
}

// Interrupt only the atomic rename of a *completed* correction checkpoint's
// receipt. This leaves its actual signed dispatch and completed Git effect;
// unlike authoring a stopped journal, no historical record is rewritten.
export async function loseCheckpointReceipt({ targetRoot }, action) {
  const directory = path.resolve(targetRoot, 'docs/audit/workflows/operation-records');
  const rename = fs.renameSync; let lost = null;
  fs.renameSync = function(from, to, ...args) {
    if (path.dirname(path.resolve(to)) === directory && /^op_[a-f0-9]{40}\.json$/.test(path.basename(to))) {
      const record = JSON.parse(fs.readFileSync(from, 'utf8'));
      if (record.intent.binding_ref === 'session_pr_correction_checkpoint' && record.phase === 'receipted') {
        assert.equal(lost, null); assert.equal(record.results.length, 1);
        assert.equal(record.results[0].output.outcome, 'completed'); assert.equal(record.results[0].output.effect_status, 'confirmed');
        lost = { operation_id: record.operation_id, attempted_receipt: record.results[0].receipt, output: record.results[0].output };
        throw Object.assign(Error('fixture receipt rename interrupted'), { code: 'FIXTURE_CHECKPOINT_RECEIPT_INTERRUPTED' });
      }
    }
    return rename.call(this, from, to, ...args);
  };
  try { await assert.rejects(action, { code: 'FIXTURE_CHECKPOINT_RECEIPT_INTERRUPTED' }); }
  finally { fs.renameSync = rename; }
  assert.ok(lost, 'The actual completed checkpoint receipt must reach its atomic persistence boundary');
  return lost;
}
