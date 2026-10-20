#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { artifactAgentView, applyArtifactReplacements, parseArtifactPaths } from '../../src/application/runtime/artifact-efficiency-service.mjs';
import { runDbFirstArtifactUseCase } from '../../src/application/runtime/db-first-artifact-use-case.mjs';
import { createProjectArtifactStore } from '../../src/application/runtime/project-artifact-store-service.mjs';
import { artifactContentHash, artifactMetadataHash } from '../../src/core/workflow/artifact-compare-swap.mjs';
import { validateJsonSchema } from '../../src/core/contracts/json-schema-validator.mjs';
import { prepareActivationFixture } from './test-activation-fixture-lib.mjs';
import { distributedTemplates, discoverProjectTemplates } from '../../src/application/runtime/template-inventory-service.mjs';
import { discoverProjectArtifacts } from '../../src/application/runtime/artifact-inventory-service.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const isolatedEnvKeys = ['AIDN_RUNTIME_PERSISTENCE_BACKEND', 'AIDN_RUNTIME_PERSISTENCE_CONNECTION_REF', 'AIDN_STATE_MODE', 'AIDN_EFFICIENCY_UNAVAILABLE'];
const previousEnv = new Map(isolatedEnvKeys.map(key => [key, process.env[key]]));
for (const key of isolatedEnvKeys) delete process.env[key];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-artifact-efficiency-'));
fs.mkdirSync(path.join(temp, '.aidn'));
fs.writeFileSync(path.join(temp, '.aidn/config.json'), JSON.stringify({ runtime: { stateMode: 'db-only', persistence: { backend: 'sqlite' } } }));
let checks = 0;
const measurements = {};
const check = (name, fn) => {
  try { fn(); checks++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
};
const content = '# Context\n\n## Active\nstate: IMPLEMENTING\n### Exception\nKeep the guard.\n\n## History\n' + 'Historical detail.\n'.repeat(500);
const initial = { path: 'cycles/C001-feature/status.md', kind: 'cycle_status', family: 'normative', content_format: 'utf8', content,
  canonical: { duplicate: content } };
const sha256 = artifactContentHash(content);
try {
  check('installed skills use official discovery without parallel model names', () => {
    for (const skill of ['aidn-cycle-create', 'aidn-start-session']) {
      const guide = fs.readFileSync(path.join(root, 'scaffold/codex', skill, 'SKILL.md'), 'utf8');
      assert.match(guide, /artifact-store list --templates/); assert(!guide.includes('TEMPLATE_'));
    }
  });
  check('bounded explicit batch paths reject malformed, empty and duplicate aliases', () => {
    assert.deepEqual(parseArtifactPaths('["notes.md","sessions/S001.md"]'), ['notes.md','sessions/S001.md']);
    for (const value of ['null','{}','[]','[1]','[""]','[" x"]','["x","x"]','["docs/audit/x","x"]','["a\\\\b","a/b"]', JSON.stringify(Array(33).fill('x')), JSON.stringify(['x'.repeat(16384)])]) {
      assert.throws(() => parseArtifactPaths(value), /ARTIFACT_PATHS_/);
    }
  });
  check('view preserves content and provenance without duplicate rendering', () => {
    const view = artifactAgentView({ ...initial, sha256 }, { includeContent: true });
    assert.equal(view.artifact.content, content); assert.equal(view.artifact.sha256, sha256);
    assert(!('canonical' in view.artifact)); assert(Buffer.byteLength(JSON.stringify(view)) < Buffer.byteLength(JSON.stringify(initial)) * 0.6);
  });
  check('complete nested unit and distinct source/excerpt hashes', () => {
    const view = artifactAgentView(initial, { heading: '## Active' });
    assert(view.context_excerpt.content.includes('### Exception\nKeep the guard.'));
    assert(!view.context_excerpt.content.includes('## History'));
    assert.equal(view.context_excerpt.source_sha256, sha256);
    assert.equal(view.context_excerpt.excerpt_sha256, artifactContentHash(view.context_excerpt.content));
    assert.equal(view.context_excerpt.consultative_only, true); assert(!('content' in view.artifact));
  });
  for (const heading of ['## Missing', '## Active']) check('unavailable or duplicate heading refused: ' + heading, () => {
    assert.throws(() => artifactAgentView({ ...initial, content: content + '\n## Active\nDuplicate\n' }, { heading }), /MISSING_OR_AMBIGUOUS/);
  });
  const replacements = [{ old: 'state: IMPLEMENTING', new: 'state: VERIFYING' }];
  check('patch has exact expected result', () => assert.equal(applyArtifactReplacements(initial, replacements, sha256), content.replace('IMPLEMENTING', 'VERIFYING')));
  for (const changes of [[{ old: '', new: 'x' }], [{ old: 'absent', new: 'x' }], [{ old: 'Historical', new: 'x' }], [{ old: 'state:', new: 'x', extra: true }]]) {
    check('malformed or nonunique patch refused', () => assert.throws(() => applyArtifactReplacements(initial, changes, sha256), /ARTIFACT_/));
  }
  check('stale expected bytes refused', () => assert.throws(() => applyArtifactReplacements(initial, replacements, '0'.repeat(64)), /REVISION_CONFLICT/));
  const options = { target: temp, path: initial.path, stateMode: 'db-only', materialize: 'false' };
  const original = runDbFirstArtifactUseCase({ ...options, content, kind: 'cycle_status', family: 'normative' });
  const changed = runDbFirstArtifactUseCase({ ...options, replacements, expectedSha256: sha256 });
  check('real SQLite CAS rebuilds canonical and keeps identity/metadata', () => {
    assert.equal(changed.artifact.content, content.replace('IMPLEMENTING', 'VERIFYING'));
    assert.equal(changed.artifact.cycle_id, 'C001'); assert.equal(changed.artifact.subtype, 'status');
    assert.equal(changed.artifact.family, 'normative'); assert.equal(changed.artifact.sha256, artifactContentHash(changed.artifact.content));
    assert.notDeepEqual(changed.artifact.canonical, original.artifact.canonical);
    assert(!fs.existsSync(path.join(temp, 'docs/audit')));
  });
  check('stale revision refuses and preserves committed winner', () => {
    assert.throws(() => runDbFirstArtifactUseCase({ ...options, replacements, expectedSha256: sha256 }), /REVISION_CONFLICT/);
    const store = createProjectArtifactStore({ targetRoot: temp });
    try { assert.equal(store.getArtifact(initial.path).sha256, changed.artifact.sha256); } finally { store.close(); }
  });
  check('transactional CAS rejects an intervening writer after the patch read', () => {
    const store = createProjectArtifactStore({ targetRoot: temp });
    try {
      const observed = store.getArtifact(initial.path);
      const candidate = applyArtifactReplacements(observed, [{ old: 'VERIFYING', new: 'DONE' }], observed.sha256);
      const winner = runDbFirstArtifactUseCase({ ...options, content: observed.content + '\nConcurrent note\n' });
      assert.throws(() => store.compareAndSwapArtifact({ artifact: { ...initial, content: candidate }, expectedSha256: observed.sha256 }), /REVISION_CONFLICT/);
      assert.equal(store.getArtifact(initial.path).sha256, winner.artifact.sha256);
    } finally { store.close(); }
  });
  check('overlapping occurrences and oversized replacement sets fail closed', () => {
    assert.throws(() => applyArtifactReplacements({ content_format: 'utf8', content: 'aaa' }, [{ old: 'aa', new: 'b' }], artifactContentHash('aaa')), /NOT_UNIQUE/);
    assert.throws(() => applyArtifactReplacements(initial, Array(33).fill({ old: 'state', new: 'mode' }), sha256), /INVALID/);
  });
  check('transactional CAS detects changed metadata with identical content', () => {
    const store = createProjectArtifactStore({ targetRoot: temp });
    try {
      const observed = store.getArtifact(initial.path);
      store.upsertArtifact({ ...observed, family: 'support' });
      assert.throws(() => store.compareAndSwapArtifact({ artifact: { ...observed, content: observed.content + '\nPatch\n', sha256: undefined },
        expectedSha256: observed.sha256, expectedMetadataSha256: artifactMetadataHash(observed) }), /REVISION_CONFLICT/);
      assert.equal(store.getArtifact(initial.path).family, 'support');
    } finally { store.close(); }
  });
  check('ordinary full writes still support explicit files projection', () => {
    runDbFirstArtifactUseCase({ target: temp, path: 'notes.md', content: '# File\n', stateMode: 'files' });
    assert.equal(fs.readFileSync(path.join(temp, 'docs/audit/notes.md'), 'utf8'), '# File\n');
  });
  check('configured files remain authoritative over a stale SQLite index', () => {
    const target = path.join(temp, 'file-primary');fs.mkdirSync(path.join(target, '.aidn'), { recursive: true });
    fs.writeFileSync(path.join(target, '.aidn/config.json'), JSON.stringify({ runtime: { stateMode: 'files', persistence: { backend: 'sqlite' } } }));
    const original = '# Session\nmode: THINKING\n', edited = '# Session\nmode: EXPLORING\n';
    const first = runDbFirstArtifactUseCase({ target, path: 'sessions/S009.md', content: original });
    assert.equal(first.materialized, true);
    prepareActivationFixture(target, root);
    const file = path.join(target, 'docs/audit/sessions/S009.md');fs.writeFileSync(file, edited);
    const index = path.join(target, '.aidn/runtime/index/workflow-index.sqlite'), before = fs.readFileSync(index);
    assert.throws(() => runDbFirstArtifactUseCase({ target, path: 'sessions/S009.md', replacements: [{ old: 'THINKING', new: 'COMMITTING' }], expectedSha256: first.artifact.sha256 }), /CANONICAL_DATABASE_REQUIRED/);
    const rejected = cli('db-first-artifact', ['--path', 'sessions/S009.md', '--replace', JSON.stringify([{ old: 'THINKING', new: 'COMMITTING' }]), '--expect-sha256', first.artifact.sha256, '--state-mode', 'db-only', '--no-materialize'], target);
    assert.notEqual(rejected.status, 0);assert.match(rejected.stderr, /ARTIFACT_REPLACEMENTS_CANONICAL_DATABASE_REQUIRED/);
    assert.equal(fs.readFileSync(file, 'utf8'), edited);assert(fs.readFileSync(index).equals(before));
  });
  check('projection-mode override cannot turn an index into canonical state', () => {
    const target = path.join(temp, 'file-primary');
    assert.throws(() => runDbFirstArtifactUseCase({ target, path: 'sessions/S009.md', stateMode: 'db-only', replacements: [{ old: 'THINKING', new: 'COMMITTING' }], expectedSha256: artifactContentHash('# Session\nmode: THINKING\n') }), /CANONICAL_DATABASE_REQUIRED/);
    assert.equal(fs.readFileSync(path.join(target, 'docs/audit/sessions/S009.md'), 'utf8'), '# Session\nmode: EXPLORING\n');
  });
  check('configured PostgreSQL cannot be replaced by an environment-selected SQLite index', () => {
    const target = path.join(temp, 'canonical-pg');fs.mkdirSync(path.join(target, '.aidn'), { recursive: true });
    fs.writeFileSync(path.join(target, '.aidn/config.json'), JSON.stringify({ runtime: { stateMode: 'db-only', persistence: { backend: 'postgres', connectionRef: 'env:AIDN_EFFICIENCY_UNAVAILABLE' } } }));
    const previous = process.env.AIDN_RUNTIME_PERSISTENCE_BACKEND;
    try { process.env.AIDN_RUNTIME_PERSISTENCE_BACKEND = 'sqlite';
      assert.throws(() => runDbFirstArtifactUseCase({ target, path: 'sessions/S009.md', replacements: [{ old: 'a', new: 'b' }], expectedSha256: '0'.repeat(64) }), /CANONICAL_BACKEND_CONFLICT/);
      assert(!fs.existsSync(path.join(target, '.aidn/runtime/index/workflow-index.sqlite')));
    } finally { if (previous === undefined) delete process.env.AIDN_RUNTIME_PERSISTENCE_BACKEND;else process.env.AIDN_RUNTIME_PERSISTENCE_BACKEND = previous; }
  });
  check('configured dual SQLite replacements preserve canonical and materialized text', () => {
    const target = path.join(temp, 'dual-primary');fs.mkdirSync(path.join(target, '.aidn'), { recursive: true });
    fs.writeFileSync(path.join(target, '.aidn/config.json'), JSON.stringify({ runtime: { stateMode: 'dual', persistence: { backend: 'sqlite' } } }));
    const first = runDbFirstArtifactUseCase({ target, path: 'notes.md', content: '# Canonical\nvalue: before\n' });
    const result = runDbFirstArtifactUseCase({ target, path: 'notes.md', replacements: [{ old: 'value: before', new: 'value: after' }], expectedSha256: first.artifact.sha256 });
    assert.equal(result.backend, 'sqlite');assert.equal(result.materialized, true);
    assert.equal(fs.readFileSync(path.join(target, 'docs/audit/notes.md'), 'utf8'), result.artifact.content);
  });
  check('configured PostgreSQL remains canonical in files presentation mode', () => {
    const target = path.join(temp, 'pg-files');fs.mkdirSync(path.join(target, '.aidn'), { recursive: true });
    fs.writeFileSync(path.join(target, '.aidn/config.json'), JSON.stringify({ runtime: { stateMode: 'files', persistence: { backend: 'postgres', connectionRef: 'env:AIDN_EFFICIENCY_UNAVAILABLE' } } }));
    assert.throws(() => runDbFirstArtifactUseCase({ target, path: 'notes.md', replacements: [{ old: 'a', new: 'b' }], expectedSha256: '0'.repeat(64) }), /ARTIFACT_POSTGRES_/);
    assert(!fs.existsSync(path.join(target, '.aidn/runtime/index/workflow-index.sqlite')));
  });
  prepareActivationFixture(temp, root);
  function cli(tool, args, commandTarget = temp) {
    return spawnSync(process.execPath, [path.join(root, 'bin/aidn.mjs'), 'runtime', tool, '--target', commandTarget, ...args, '--json'], { encoding: 'utf8', windowsHide: true,
      env: { ...process.env, AIDN_EFFICIENCY_UNAVAILABLE: '', AIDN_RUNTIME_PERSISTENCE_BACKEND: '', AIDN_RUNTIME_PERSISTENCE_CONNECTION_REF: '' } });
  }
  check('real CLI compact write/read and contracts', () => {
    const fullWrite = cli('db-first-artifact', ['--path', 'notes.md', '--content', content, '--no-materialize']);
    assert.equal(fullWrite.status, 0, fullWrite.stderr);
    const write = cli('db-first-artifact', ['--path', 'notes.md', '--content', content, '--no-materialize', '--view', 'agent']);
    assert.equal(write.status, 0, write.stderr);
    const output = JSON.parse(write.stdout); assert(!('content' in output.artifact));
    const schema = JSON.parse(fs.readFileSync(path.join(root, 'src/core/contracts/cli-output/runtime-db-first-artifact.v1.schema.json')));
    assert.deepEqual(validateJsonSchema(output, schema), []);
    const indexFile = path.join(temp, '.aidn/runtime/index/workflow-index.sqlite');
    const beforeRead = fs.readFileSync(indexFile);
    const full = cli('artifact-fetch', ['--path', 'notes.md']);
    assert.equal(full.status, 0, full.stderr); assert.equal(JSON.parse(full.stdout).artifact.content, content);
    assert(JSON.parse(full.stdout).artifact.canonical);
    const read = cli('artifact-fetch', ['--path', 'notes.md', '--view', 'agent', '--heading', '## Active']);
    assert.equal(read.status, 0, read.stderr); const result = JSON.parse(read.stdout);
    assert.equal(result.context_excerpt.source_sha256, sha256); assert.equal(result.source_backend, 'sqlite');
    assert.deepEqual(validateJsonSchema(result, JSON.parse(fs.readFileSync(path.join(root, 'src/core/contracts/cli-output/runtime-artifact-fetch.v1.schema.json')))), []);
    assert(Buffer.byteLength(read.stdout) < Buffer.byteLength(content) / 2);
    assert(fs.readFileSync(indexFile).equals(beforeRead), 'consultation must preserve canonical database bytes');
    const invalid = cli('artifact-fetch', ['--path', 'notes.md', '--view', 'agent', '--heading', '## Missing']);
    assert.notEqual(invalid.status, 0); assert(fs.readFileSync(indexFile).equals(beforeRead));
    const delta = cli('db-first-artifact', ['--path', 'notes.md', '--replace', JSON.stringify(replacements), '--expect-sha256', sha256, '--view', 'agent', '--no-materialize']);
    assert.equal(delta.status, 0, delta.stderr); assert.equal(JSON.parse(delta.stdout).mutation.replacements, 1);
    Object.assign(measurements, { full_write_bytes: Buffer.byteLength(fullWrite.stdout), agent_write_bytes: Buffer.byteLength(write.stdout),
      full_fetch_bytes: Buffer.byteLength(full.stdout), section_fetch_bytes: Buffer.byteLength(read.stdout),
      full_content_input_bytes: Buffer.byteLength(content), replacement_input_bytes: Buffer.byteLength(JSON.stringify(replacements)) + 64 });
  });
  check('real CLI batch preserves complete ordered documents, provenance and canonical bytes', () => {
    const paths = ['notes.md', initial.path];
    const before = fs.readFileSync(path.join(temp, '.aidn/runtime/index/workflow-index.sqlite'));
    const batch = cli('artifact-fetch', ['--paths-json', JSON.stringify(paths), '--view', 'agent']);
    assert.equal(batch.status, 0, batch.stderr); const output = JSON.parse(batch.stdout);
    assert.equal(output.found, true); assert.equal(output.artifact, null); assert.equal(output.source_revision, null);
    assert.deepEqual(output.selector.paths, paths); assert.deepEqual(output.artifacts.map(a => a.path), paths);
    const schema = JSON.parse(fs.readFileSync(path.join(root, 'src/core/contracts/cli-output/runtime-artifact-fetch.v1.schema.json')));
    assert.deepEqual(validateJsonSchema(output, schema), []);
    for (const entry of output.artifacts) {
      const single = JSON.parse(cli('artifact-fetch', ['--path', entry.path, '--view', 'agent']).stdout);
      assert.deepEqual(entry.artifact, single.artifact);assert.equal(entry.found, true);assert.match(entry.source_revision, /^[a-f0-9]{64}$/);
    }
    assert(fs.readFileSync(path.join(temp, '.aidn/runtime/index/workflow-index.sqlite')).equals(before));
    const metadata = JSON.parse(cli('artifact-fetch', ['--paths-json', JSON.stringify(paths), '--view', 'agent', '--metadata-only']).stdout);
    assert(metadata.artifacts.every(e => !('content' in e.artifact) && !('canonical' in e.artifact)));
  });
  check('real CLI batch retains missing entries and never claims global completeness', () => {
    const batch = cli('artifact-fetch', ['--paths-json', '["notes.md","absent.md"]', '--view', 'agent']);
    assert.equal(batch.status, 2); const output = JSON.parse(batch.stdout);
    assert.equal(output.found, false); assert.equal(output.artifacts[0].found, true);
    assert.deepEqual(output.artifacts[1], { path:'absent.md', found:false, source_revision:null, artifact:null });
    for (const extra of [['--path','notes.md'], ['--heading','## Active'], ['--session-id','S001']]) {
      assert.notEqual(cli('artifact-fetch', ['--paths-json','["notes.md"]','--view','agent',...extra]).status, 0);
    }
    assert.notEqual(cli('artifact-fetch', ['--paths-json','["notes.md"]']).status, 0);
  });
  check('real CLI batch observes a later revision and does not cache earlier reads', () => {
    const argv = ['--paths-json','["notes.md"]','--view','agent'];
    const before = JSON.parse(cli('artifact-fetch', argv).stdout).artifacts[0].artifact;
    runDbFirstArtifactUseCase({target:temp, path:'notes.md', content: before.content+'\nFresh revision\n', materialize:'false'});
    const after = JSON.parse(cli('artifact-fetch', argv).stdout).artifacts[0].artifact;
    assert.notEqual(after.sha256, before.sha256);assert.equal(after.content, before.content+'\nFresh revision\n');
  });
  const templates = distributedTemplates();
  check('real CLI discovers exact distribution references then reads complete batch', () => {
    const store = createProjectArtifactStore({ targetRoot: temp });
    try { for (const asset of templates) store.upsertArtifact({path:asset.path, content:fs.readFileSync(path.join(root,'scaffold/docs_audit',asset.path),'utf8'), content_format:'utf8', kind:'other', family:'normative'}); } finally { store.close(); }
    const before = fs.readFileSync(path.join(temp,'.aidn/runtime/index/workflow-index.sqlite'));
    const result = cli('artifact-store', ['list','--templates']);
    assert.equal(result.status, 0, result.stderr);
    const inventory = JSON.parse(result.stdout);
    assert.deepEqual(inventory.artifacts.map(a => a.path), templates.map(a => a.path));
    assert(inventory.template_inventory.consultative_only);
    assert.deepEqual(validateJsonSchema(inventory, JSON.parse(fs.readFileSync(path.join(root,'src/core/contracts/cli-output/runtime-artifact-store-list.v1.schema.json')))), []);
    const batch = cli('artifact-fetch', ['--paths-json', JSON.stringify(inventory.artifacts.map(a=>a.path)), '--view','agent']);
    assert.equal(batch.status, 0, batch.stderr);
    const entries = JSON.parse(batch.stdout).artifacts;
    for (let i=0;i<entries.length;i++) { assert(entries[i].found);assert.equal(entries[i].artifact.content, fs.readFileSync(path.join(root,'scaffold/docs_audit',templates[i].path),'utf8')); }
    assert.deepEqual(fs.readFileSync(path.join(temp,'.aidn/runtime/index/workflow-index.sqlite')), before);
  });
  check('actual failed guessed-name sequence retains missing entries and exit 2', () => {
    const wrong = ['STATUS','BRIEF','PLAN','HYPOTHESES','AUDIT_SPEC','TRACEABILITY','DECISIONS','CHANGE_REQUESTS'].map(name=>`cycles/TEMPLATE_CYCLE_${name}.md`);
    const result = cli('artifact-fetch',['--paths-json',JSON.stringify(['sessions/TEMPLATE_SESSION_SXXX.md',...wrong]),'--view','agent']);
    assert.equal(result.status,2); const data=JSON.parse(result.stdout);assert.equal(data.found,false);
    assert(data.artifacts[0].found);assert(data.artifacts.slice(1).every(entry=>!entry.found));
  });
  check('real conditional grouped-read refusal remains hard; official inventory precedes correct read set', () => {
    const prefix='cycles/C001-feature-pilot/';
    const required=['audit-spec.md','brief.md','decisions.md','change-requests.md','hypotheses.md'];
    const store=createProjectArtifactStore({targetRoot:temp});
    try {for(const name of required)store.upsertArtifact({path:prefix+name,content:'# Required cycle artifact\n'+name+'\n',content_format:'utf8',kind:'other',family:'normative'});}finally{store.close();}
    const actual=[prefix+'audit-spec.md',prefix+'brief.md',prefix+'decisions.md',prefix+'change-requests.md',prefix+'gap-report.md',prefix+'hypotheses.md','sessions/TEMPLATE_SESSION_SXXX.md','cycles/TEMPLATE_STATUS.md','cycles/TEMPLATE_traceability.md','cycles/TEMPLATE_decisions.md'];
    const failed=cli('artifact-fetch',['--paths-json',JSON.stringify(actual),'--view','agent']);assert.equal(failed.status,2);assert.equal(JSON.parse(failed.stdout).found,false);
    const listed=cli('artifact-store',['list','--limit','10000']);assert.equal(listed.status,0,listed.stderr);
    const inventory=JSON.parse(listed.stdout);assert.equal(inventory.backend,'sqlite');assert(inventory.artifacts.length<10000);
    const available=new Set(inventory.artifacts.map(a=>a.path));assert(!available.has(prefix+'gap-report.md'));
    assert(required.every(name=>available.has(prefix+name)));
    const selected=actual.filter(p=>p!==prefix+'gap-report.md'||available.has(p));
    const read=cli('artifact-fetch',['--paths-json',JSON.stringify(selected),'--view','agent']);assert.equal(read.status,0,read.stderr);assert(JSON.parse(read.stdout).artifacts.every(a=>a.found&&typeof a.artifact.content==='string'));
  });
  const filesTarget=path.join(temp,'template-files');fs.mkdirSync(filesTarget);
  fs.cpSync(path.join(root,'scaffold/docs_audit'),path.join(filesTarget,'docs/audit'),{recursive:true});
  prepareActivationFixture(filesTarget, root);
  check('files discovery reads project authority without creating SQLite', () => {
    const result=cli('artifact-store',['list','--templates'],filesTarget);assert.equal(result.status,0,result.stderr);
    const data=JSON.parse(result.stdout);assert.equal(data.backend,'files');
    for(const asset of data.artifacts) { assert.equal(asset.read_method,'file'); assert.equal(artifactContentHash(fs.readFileSync(path.join(filesTarget,asset.projection_path),'utf8')),asset.sha256); }
    assert(!fs.existsSync(path.join(filesTarget,'.aidn/runtime/index/workflow-index.sqlite')));
  });
  check('required distributed model absent is a hard failure without replacement', () => {
    fs.unlinkSync(path.join(filesTarget,'docs/audit',templates[0].path));
    const result=cli('artifact-store',['list','--templates'],filesTarget);assert.notEqual(result.status,0);assert.match(result.stderr,/TEMPLATE_REQUIRED_UNAVAILABLE/);assert.equal(result.stdout.trim(),'');
  });
  await assert.rejects(discoverProjectTemplates({targetRoot:temp,snapshotReader:async()=>({backend:'sqlite',payload:{artifacts:[{path:templates[0].path},{path:templates[0].path}]}})}),/TEMPLATE_REFERENCE_AMBIGUOUS/);checks++;
  check('dual mode discovery ignores stale visible projection', () => {
    fs.writeFileSync(path.join(temp,'.aidn/config.json'),JSON.stringify({runtime:{stateMode:'dual',persistence:{backend:'sqlite'}}}));
    const asset=templates[0];fs.mkdirSync(path.dirname(path.join(temp,'docs/audit',asset.path)),{recursive:true});fs.writeFileSync(path.join(temp,'docs/audit',asset.path),'# Stale projection\n');
    const result=cli('artifact-store',['list','--templates']);assert.equal(result.status,0,result.stderr);
    assert.equal(JSON.parse(result.stdout).artifacts[0].sha256,asset.distribution_sha256);
    assert.equal(fs.readFileSync(path.join(temp,'docs/audit',asset.path),'utf8'),'# Stale projection\n');
  });
  check('compact inventory has complete canonical references without bodies and leaves SQLite unchanged', () => {
    const index = path.join(temp,'.aidn/runtime/index/workflow-index.sqlite'), before = fs.readFileSync(index);
    const full = cli('artifact-store',['list','--limit','10000']);
    const result = cli('artifact-store',['list','--view','agent','--limit','10000']);
    assert.equal(result.status,0,result.stderr);const inventory = JSON.parse(result.stdout);
    assert.equal(inventory.backend,'sqlite');assert.equal(inventory.inventory.complete,true);
    assert.equal(inventory.inventory.total_count,inventory.artifacts.length);
    assert(inventory.artifacts.every(a => a.sha256 && !('content' in a) && !('canonical' in a)));
    const schema = JSON.parse(fs.readFileSync(path.join(root,'src/core/contracts/cli-output/runtime-artifact-store-list.v1.schema.json')));
    assert.deepEqual(validateJsonSchema(inventory,schema),[]);
    assert(fs.readFileSync(index).equals(before));
    measurements.full_inventory_bytes=Buffer.byteLength(full.stdout);measurements.compact_inventory_bytes=Buffer.byteLength(result.stdout);
    assert(measurements.compact_inventory_bytes < measurements.full_inventory_bytes / 2);
    const limited=JSON.parse(cli('artifact-store',['list','--view','agent','--limit','1']).stdout);
    assert.equal(limited.inventory.complete,false);assert.equal(limited.artifacts.length,1);
    for(const flags of [['--limit','10001'],['--limit','0'],['--limit','1.5'],['--templates'],['--sqlite-file','other']]) {
      const refused=cli('artifact-store',['list','--view','agent',...flags]);assert.notEqual(refused.status,0);assert.equal(refused.stdout.trim(),'');
    }
  });
  check('compact file inventory ignores stale index and preserves authoritative file', () => {
    const target=path.join(temp,'file-primary'),file=path.join(target,'docs/audit/sessions/S009.md'),before=fs.readFileSync(file);
    const result=cli('artifact-store',['list','--view','agent','--limit','10000'],target);
    assert.equal(result.status,0,result.stderr);const inventory=JSON.parse(result.stdout);
    assert.equal(inventory.backend,'files');assert.equal(inventory.inventory.complete,true);
    assert.equal(inventory.artifacts.find(a=>a.path==='sessions/S009.md').sha256,artifactContentHash(before));
    assert(fs.readFileSync(file).equals(before));
  });
  for (const rows of [[{path:'same.md',sha256}], [{path:'same.md',sha256},{path:'SAME.md',sha256}], [{path:'../escape.md',sha256}]]) {
    if(rows.length===1 && rows[0].path==='same.md') continue;
    await assert.rejects(discoverProjectArtifacts({targetRoot:temp,snapshotReader:async()=>({backend:'sqlite',payload:{artifacts:rows}})}),/AMBIGUOUS/);checks++;
  }
  check('configured unavailable PG cannot fall back to local SQLite or visible files', () => {
    fs.mkdirSync(path.join(temp, '.aidn'), { recursive: true });
    fs.writeFileSync(path.join(temp, '.aidn/config.json'), JSON.stringify({ runtime: { stateMode: 'db-only', persistence: { backend: 'postgres', connectionRef: 'env:AIDN_EFFICIENCY_UNAVAILABLE' } } }));
    const failed = cli('db-first-artifact', ['--path', 'notes.md', '--replace', JSON.stringify(replacements), '--expect-sha256', sha256, '--no-materialize']);
    assert.notEqual(failed.status, 0); assert.match(failed.stderr, /ARTIFACT_POSTGRES_/);
    assert.equal(fs.readFileSync(path.join(temp, 'docs/audit/notes.md'), 'utf8'), '# File\n');
    const batch = cli('artifact-fetch', ['--paths-json','["notes.md"]','--view','agent']);
    assert.notEqual(batch.status, 0); assert.equal(batch.stdout.trim().startsWith('{'), false);
    const discovery=cli('artifact-store',['list','--templates']);assert.notEqual(discovery.status,0);assert.equal(discovery.stdout.trim(),'');
    const inventory=cli('artifact-store',['list','--view','agent']);assert.notEqual(inventory.status,0);assert.equal(inventory.stdout.trim(),'');
  });
  console.log(JSON.stringify({ status: 'PASS', checks, fixtures: true, real_cli: true, native: false, measurements }));
} finally {
  for (const [key, value] of previousEnv) { if (value === undefined) delete process.env[key];else process.env[key] = value; }
  fs.rmSync(temp, { recursive: true, force: true });
}
