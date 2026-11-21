import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createFreshStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
import { createStandardWorkflowOperations } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createStandardPrCorrectionReopen } from '../../src/application/runtime/standard-pr-correction-reopen.mjs';
import { prCorrectionReopenPaths } from '../../src/core/workflow/standard-pr-correction-reopen.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
const H = 'a'.repeat(64), op = 'op_' + '1'.repeat(40);
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
const set = (text, key, value) => {
  const re = new RegExp('^([ \\t]*-?[ \\t]*)' + key + ':[^\\r\\n]*$', 'gm');
  return re.test(text) ? text.replace(re, (_all, prefix) => prefix + key + ': ' + value) : text.replace(/^(# [^\n]*\n)/, '$1\n' + key + ': ' + value + '\n');
};
export async function createPrCorrectionReopenFixture(selectedMode, owned) {
  const root = createFreshStandardWorkflowFixture(selectedMode, owned), artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
  const ops = createStandardWorkflowOperations({ targetRoot: root });
  let prepared = await ops.prepareSession({ session_id: 'S001', session_branch: 'S001-correction', objective: 'Scoped review correction fixture' });
  assert.equal((await ops.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, 'completed');
  prepared = await ops.prepareMode({ session_id: 'S001', mode: 'COMMITTING' });
  assert.equal((await ops.applyMode(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, 'completed');
  const names = prCorrectionReopenPaths('S001');
  await artifacts.withLocalEffectOwner(H, async () => {
    for (const name of names) {
      const row = artifacts.read(name, { required: true }); let after = row.content;
      if (name === names[0]) {
        for (const [key, value] of Object.entries({ state: 'CLOSED', lifecycle_status: 'closed', session_closure_status: 'completed', pr_status: 'open', pr_review_status: 'pending' })) after = set(after, key, value);
        after += '\n## Process session closure\n\n```json\n{"prior":"closure report retained verbatim"}\n```\n\n## Process session closure completion\n\n```json\n{"prior":"completion retained verbatim"}\n```\n';
      } else if (name === names[1]) {
        for (const [key, value] of Object.entries({ session_closure_status: 'completed', session_pr_status: 'open', session_pr_review_status: 'pending' })) after = set(after, key, value);
      } else after = set(after, 'updated_at', new Date().toISOString());
      artifacts.compareAndSwapPreservingMetadata({ path: name, before_sha256: row.sha256, before_metadata_sha256: artifacts.metadataHash(name), after });
    }
    artifacts.project(names); return { effect_status: 'confirmed' };
  });
  git(root, 'add', '.'); if (git(root, 'status', '--porcelain')) git(root, '-c', 'core.hooksPath=NUL', 'commit', '-m', 'test: arrange closed correction owner');
  const head = git(root, 'rev-parse', 'HEAD'), instance = { instance_id: 'correction-component', instance_sha256: H };
  const source = { triage_operation_id: op, triage_output_sha256: H, session_id: 'S001', selection_operation_id: op, received_operation_id: op, update_operation_id: op,
    payload_sha256: H, product_sha256: H, source_material_sha256: H,
    pull_request: { contract_version: 'github-pr-link.v1', repository_id: 'R_fixture', node_id: 'PR_fixture', number: 1, head_branch: 'S001-correction', base_branch: 'dev',
      head_oid: head, base_oid: git(root, 'rev-parse', 'HEAD^'), state: 'OPEN', draft: false, url: 'https://github.com/fixture/repository/pull/1', title_sha256: H, body_sha256: H },
    corrections: [{ kind: 'review', node_id: 'REVIEW_fixture', thread_id: null, correction: 'Correct the selected product boundary and validate the new HEAD.' }] };
  const input = { contract_version: 'standard-pr-correction-reopen-input.v1', triage_operation_id: op }, state = { externalChanged: false };
  const authority = { readSource: async () => structuredClone(source), verifySource: async () => {
    if (state.externalChanged) throw Object.assign(Error('provider changed'), { code: 'STANDARD_PR_CORRECTION_PROVIDER_CHANGED' });
    return { origin_source_sha256: shadowHash(source), proof_class: 'fixture-source-double' };
  } };
  const port = createStandardPrCorrectionReopen({ targetRoot: root, authority, readCurrent: () => instance });
  return { root, artifacts, source, instance, input, port, head, names, state, ops, authority };
}
