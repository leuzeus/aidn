import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createFreshStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { resolveArtifactImportDefaults } from '../../src/application/install/artifact-import-service.mjs';

const owned = [], base = fs.realpathSync(os.tmpdir());
try {
  assert.equal(resolveArtifactImportDefaults({}, {}).stateMode, 'dual');
  assert.equal(resolveArtifactImportDefaults({}, {}).store, 'dual-sqlite');
  for (const mode of ['dual', 'db-only']) {
    const root = createFreshStandardWorkflowFixture(mode, owned);
    const config = JSON.parse(fs.readFileSync(path.join(root, '.aidn/config.json')));
    assert.equal(config.runtime.stateMode, mode); assert.equal(config.runtime.persistence.backend, 'sqlite');
    const first = createStandardWorkflowArtifacts({ targetRoot: root });
    const retained = first.read('CURRENT-STATE.md', { required: true });
    assert.equal(retained.source, 'sqlite');
    assert.deepEqual(createStandardWorkflowArtifacts({ targetRoot: root }).read('CURRENT-STATE.md', { required: true }), retained);
    const db = path.join(root, '.aidn/runtime/index/workflow-index.sqlite');
    fs.renameSync(db, db + '.retained');
    assert.throws(() => first.read('CURRENT-STATE.md'), { code: 'STANDARD_CANONICAL_STORE_UNAVAILABLE' });
    assert.equal(fs.existsSync(db), false); fs.renameSync(db + '.retained', db);
  }
  console.log(JSON.stringify({ status: 'PASS', source_installer: true, profiles: ['dual', 'db-only'], backend: 'sqlite',
    postgres_required: false, missing_database_fallback: 'REFUSED', native_calls: 0, installed_archive: 'NOT_RUN' }));
} finally {
  for (const root of owned) {
    const resolved = fs.realpathSync(root); assert.equal(path.dirname(resolved), base); assert(path.basename(resolved).startsWith('aidn-standard-fresh-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
