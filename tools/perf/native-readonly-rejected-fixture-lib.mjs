import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readStandardHostInstance } from '../../src/adapters/runtime/standard-host-authority.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';
import { createHash } from 'node:crypto';

// Real canonical/owner ports, controlled RPC and supervisor doubles, no model.
export async function createReadOnlyRejectedAnswerFixture({ operatorHome, mixedFixture, bootstrapMixed }) {
  const f = mixedFixture('db-only', { signingKey: Buffer.alloc(32, 73), drift: true,
    answer: () => ({ outcome: 'completed', summary: 'Malformed R05 fixture.', report: { contract_version: 'standard-drift-report.v1' } }) });
  f.configuration.native.protected_roots = [operatorHome];
  f.sessionMode = 'COMMITTING';
  const authorization = await bootstrapMixed(f);
  const result = await f.open().step({ write: true, authorization });
  assert.equal(result.journal_phase, 'failed');
  assert.equal(result.first_failure, 'PROCESS_SESSION_ANSWER_INVALID');
  const instance = f.open().inspectDiagnostic().record;
  assert.equal(instance.events.at(-1).kind, 'assign');
  const journal = f.open().inspectAllocations();
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: f.configuration.target_root });
  const dispatches = artifacts.observeInventory().rows.filter(row => row.path.startsWith('workflows/native-dispatches/'))
    .map(row => JSON.parse(row.content)).filter(row => row.kind === 'allocation' && row.native_journal_after_sha256 === H(journal));
  assert.equal(dispatches.length, 1);
  const environment = { ...process.env, AIDN_STANDARD_HOST_HOME: operatorHome };
  const identity = readStandardHostInstance({ targetRoot: f.configuration.target_root, instanceId: instance.instance_id, environment }).identity;
  fs.writeFileSync(path.join(operatorHome, identity + '.key'), Buffer.alloc(32, 73), { flag: 'wx' });
  const configurationFile = path.join(operatorHome, 'original-configuration.json');
  fs.writeFileSync(configurationFile, JSON.stringify(f.configuration), { flag: 'wx' });
  const request = { contract_version: 'standard-native-owner-recovery.v1', target_root: f.configuration.target_root,
    instance_id: instance.instance_id, instance_sha256: instance.instance_sha256, dispatch_id: dispatches[0].dispatch_id, generation: 1,
    original_configuration: { path: configurationFile, sha256: createHash('sha256').update(fs.readFileSync(configurationFile)).digest('hex') } };
  return { root: f.configuration.target_root, private_root: f.base, operator_home: operatorHome, configuration: f.configuration,
    journal_id: journal.journal_id, request, proof_class: 'controlled-rejected-R05-with-real-SQL-owner-ports', model_calls: 0 };
}
