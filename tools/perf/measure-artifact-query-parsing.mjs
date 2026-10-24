#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { artifactQueryFixturePayload } from './verify-artifact-query-fixtures.mjs';
import { selectArtifactQuery } from '../../src/application/runtime/artifact-query-service.mjs';
const scope = { project_id: 'fixture', workspace_id: 'fixture', worktree_id: 'fixture', runtime_scope_id: 'fixture' };
const payload = artifactQueryFixturePayload(scope);
const select = () => selectArtifactQuery({ payload, backend: 'files', scope, profile: 'active-state.v2' });
const expected = select(); assert.equal(expected.status, 'ok');
for (let i = 0; i < 10; i++) select();
const samples = [];
for (let batch = 0; batch < 5; batch++) {
  const start = performance.now();
  for (let i = 0; i < 40; i++) assert.deepEqual(select(), expected);
  samples.push((performance.now() - start) / 40);
}
const sorted = [...samples].sort((a, b) => a - b);
const result = { evidence: 'source-fixture-cpu-microbenchmark', operation: 'complete active-state.v2 selection with exact output parity',
  trials: 5, selections_per_trial: 40, elapsed_per_selection_ms: samples, p50_ms: sorted[2], p95_ms: sorted[4],
  input_bytes: Buffer.byteLength(JSON.stringify(payload)), output_bytes: Buffer.byteLength(JSON.stringify(expected)),
  native_tokens: null, db_round_trips: null, end_to_end_gain: 'not_established' };
const index = process.argv.indexOf('--out');
if (index >= 0) fs.writeFileSync(process.argv[index + 1], JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
