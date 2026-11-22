import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createLocalHandoffProcessDiscovery } from '../../src/adapters/runtime/local-handoff-process-discovery.mjs';
import { observeLocalProcess, observeLocalProcessOwner } from '../../src/adapters/runtime/local-process-identity.mjs';
import { assertHandoffProcessObservation } from '../../src/core/workflow/handoff-process-observation.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';
import { removePathWithRetry } from './test-git-fixture-lib.mjs';

const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-handoff-process-'));
const targetRoot = path.join(owned, 'target'), controlRoot = path.join(owned, 'control'), outside = path.join(owned, 'outside');
for (const root of [targetRoot, controlRoot, outside]) fs.mkdirSync(root);
const options = { targetRoot, controlRoot, nativeExecutable: process.execPath }, checks = [];
const check = (name, condition) => { assert(condition, name); checks.push(name); };
const projection = () => [targetRoot, controlRoot].map(root => fs.readdirSync(root));
const ready = child => new Promise((resolve, reject) => {
  let text = '', settled = false;
  child.stdout.on('data', bytes => {
    text += bytes.toString('utf8');
    if (!settled && text.includes('\n')) { settled = true; try { resolve(JSON.parse(text.split('\n')[0])); } catch (cause) { reject(cause); } }
  });
  child.once('error', reject);
  child.once('exit', code => { if (!settled) { settled = true; reject(Error('SCOPE_HOLDER_EXITED_BEFORE_READY_' + code)); } });
});
const closed = child => new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
let parent, parentExit, foreign, foreignExit, passed = false;
try {
  const observer = createLocalHandoffProcessDiscovery(options), initialTree = projection();
  const first = observer.observe();
  check('actual backend samples the process table twice', first.samples.length === 2 && first.samples.every(sample => sample.scanned_processes > 0));
  check('fresh private markers have no matching process', first.samples.every(sample => sample.processes.length === 0));
  check('coverage explicitly remains path markers and descendants', first.coverage_basis === 'configured_path_markers_and_descendants');
  check('OS observation has no handoff or effect permission', first.snapshot_only === true && first.complete_resource_closure === false
    && first.permits_handoff === false && first.permits_effects === false && first.written === false);
  const cancelled = new AbortController(); cancelled.abort();
  assert.throws(() => observer.observe({ signal: cancelled.signal }), { code: 'HANDOFF_PROCESS_OBSERVATION_ABORTED' });
  checks.push('an already cancelled observation refuses');
  const foreignFile = path.join(outside, 'foreign.mjs');
  fs.writeFileSync(foreignFile, "process.stdin.resume();process.stdin.once('data',()=>process.exit(0));process.stdout.write(JSON.stringify({pid:process.pid})+'\\n');\n");
  foreign = spawn(process.execPath, [foreignFile, targetRoot + '-unrelated'], { cwd: outside, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  foreignExit = closed(foreign); const foreignId = (await ready(foreign)).pid;
  const boundary = observer.observe();
  check('does not adopt a sibling path sharing only the root prefix', boundary.samples.every(sample => sample.processes.every(row => row.pid !== foreignId)));
  foreign.stdin.end('stop\n'); assert.equal((await foreignExit).code, 0); foreign = null;
  const leaf = path.join(outside, 'leaf.mjs'), holder = path.join(outside, 'holder.mjs');
  fs.writeFileSync(leaf, "process.stdin.resume();process.stdin.once('data',()=>process.exit(0));process.stdout.write('ready\\n');\n");
  fs.writeFileSync(holder, "import {spawn} from 'node:child_process';const child=spawn(process.execPath,[process.argv[2]],{stdio:['pipe','pipe','inherit'],windowsHide:true});child.once('error',()=>process.exit(1));child.stdout.once('data',()=>process.stdout.write(JSON.stringify({pid:process.pid,child:child.pid})+'\\n'));process.stdin.once('data',()=>child.stdin.end('stop\\n'));child.once('exit',code=>process.exit(code??1));\n");
  const selfIdentity = observeLocalProcess(process.pid);
  const writableCopy = observeLocalProcess(process.pid);
  writableCopy.creation = 'caller-modified';
  assert.deepEqual(observeLocalProcess(process.pid), selfIdentity);
  check('kernel self identity survives caller mutation and distinguishes a reused PID', observeLocalProcessOwner(selfIdentity) === 'active'
    && observeLocalProcessOwner(writableCopy) === 'terminated');
  for (const invalid of [null, 1, [null], [{ ...selfIdentity, extra: true }], [{ ...selfIdentity, pid: 0 }],
    [{ ...selfIdentity, host: 'foreign-host' }], [{ ...selfIdentity, platform: 'foreign' }], [{ ...selfIdentity, creation: 'invalid' }],
    Array(10001).fill(selfIdentity)]) {
    assert.throws(() => createLocalHandoffProcessDiscovery({ ...options, ownerIdentities: invalid }), { code: 'HANDOFF_PROCESS_OWNER_SCOPE_INVALID' });
  }
  checks.push('trusted owner scope rejects foreign, malformed and over-inventory-limit identities');
  parent = spawn(process.execPath, [holder, leaf], { cwd: outside, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  parentExit = closed(parent);
  const unmarkedIds = await ready(parent), retained = observeLocalProcess(unmarkedIds.pid), retainedChild = observeLocalProcess(unmarkedIds.child);
  assert(retained && retainedChild);
  const pathOnly = observer.observe();
  check('v1 path-only coverage retains its explicit omission of an unmarked owner and child', pathOnly.contract_version === 'handoff-process-observation.v1'
    && pathOnly.samples.every(sample => sample.processes.every(row => row.pid !== unmarkedIds.pid && row.pid !== unmarkedIds.child)));
  const ownerInput = [{ ...retained }], seededReader = createLocalHandoffProcessDiscovery({ ...options, ownerIdentities: ownerInput });
  ownerInput[0].creation = 'invalid after construction';
  const seeded = seededReader.observe(); assertHandoffProcessObservation(seeded);
  check('v2 observes the exact retained owner with no path marker', seeded.contract_version === 'handoff-process-observation.v2'
    && seeded.samples.every(sample => sample.processes.some(row => row.pid === unmarkedIds.pid && row.creation === retained.creation && row.scope_match === 'retained_owner')));
  check('v2 discovers the unmarked descendant by its actual current parent identity', seeded.samples.every(sample => sample.processes.some(row => row.pid === unmarkedIds.child
    && row.creation === retainedChild.creation && row.parent_pid === retained.pid && row.scope_match === 'descendant')));
  check('copied constructor owner identities are bound by digest and retain redacted output', seeded.owner_identities_sha256 === H([retained])
    && !JSON.stringify(seeded).includes(targetRoot) && !JSON.stringify(seeded).includes(controlRoot));
  const duplicates = createLocalHandoffProcessDiscovery({ ...options, ownerIdentities: [retained, { ...retained }] }).observe();
  check('duplicate retained owners have the same canonical scope', duplicates.scope_sha256 === seeded.scope_sha256 && duplicates.owner_identities_sha256 === seeded.owner_identities_sha256);
  const differentCreation = retained.platform === 'win32' ? (BigInt(retained.creation) + 10n).toString()
    : retained.creation.split(':')[0] + ':' + (BigInt(retained.creation.split(':')[1]) + 1n).toString();
  const reused = createLocalHandoffProcessDiscovery({ ...options, ownerIdentities: [{ ...retained, creation: differentCreation }] }).observe();
  check('a retained PID with another creation identity adopts neither the process nor its descendant', reused.samples.every(sample => sample.processes.every(row => row.pid !== unmarkedIds.pid && row.pid !== unmarkedIds.child)));
  const ownSeed = createLocalHandoffProcessDiscovery({ ...options, ownerIdentities: [selfIdentity] }).observe();
  check('retained observer exclusion keeps its actual unmarked work descendants visible', ownSeed.samples.every(sample => sample.processes.every(row => row.pid !== selfIdentity.pid)
    && sample.processes.some(row => row.pid === unmarkedIds.pid && row.scope_match === 'descendant') && sample.processes.some(row => row.pid === unmarkedIds.child && row.scope_match === 'descendant')));
  for (const mutate of [v => { delete v.owner_identities_sha256; }, v => { v.owner_identities_sha256 = 'bad'; },
    v => { v.coverage_basis = 'configured_path_markers_and_descendants'; }, v => { v.complete_resource_closure = true; }]) {
    const forged = structuredClone(seeded); mutate(forged); assert.throws(() => assertHandoffProcessObservation(forged), { code: 'HANDOFF_PROCESS_OBSERVATION_INVALID' });
  }
  checks.push('v2 refuses missing owner scope, mismatched coverage and forged closure without reinterpreting v1');
  parent.stdin.end('stop\n'); assert.equal((await parentExit).code, 0); parent = null;
  const retired = seededReader.observe();
  check('fresh v2 OS samples see both retained original identities retired', observeLocalProcessOwner(retained) === 'terminated' && observeLocalProcessOwner(retainedChild) === 'terminated'
    && retired.samples.every(sample => sample.processes.every(row => row.pid !== unmarkedIds.pid && row.pid !== unmarkedIds.child)));
  check('owner-seeded discovery still grants no closure, handoff, effect or mutation', !seeded.complete_resource_closure && !seeded.permits_handoff && !seeded.permits_effects && !seeded.written);
  parent = spawn(process.execPath, [holder, leaf, targetRoot, 'PRIVATE_SCOPE_TOKEN_7c293'], {
    cwd: outside, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
  });
  parentExit = closed(parent);
  const ids = await ready(parent), parentIdentity = observeLocalProcess(ids.pid), childIdentity = observeLocalProcess(ids.child);
  assert(parentIdentity && childIdentity);
  const current = observer.observe(), rows = current.samples.at(-1).processes;
  const direct = rows.find(row => row.pid === ids.pid), descendant = rows.find(row => row.pid === ids.child);
  check('discovers a live marker process without a workflow journal', direct?.scope_match === 'marker' && direct.creation === parentIdentity.creation);
  check('discovers its markerless descendant from the OS parent relation', descendant?.scope_match === 'descendant'
    && descendant.parent_pid === ids.pid && descendant.creation === childIdentity.creation);
  check('holds two stable current observations of that tree', current.stable === true
    && current.samples.every(sample => sample.processes.some(row => row.pid === ids.pid) && sample.processes.some(row => row.pid === ids.child)));
  const serialized = JSON.stringify(current);
  check('returns hashes instead of command lines and private path markers', !serialized.includes(targetRoot)
    && !serialized.includes(controlRoot) && !serialized.includes('PRIVATE_SCOPE_TOKEN_7c293'));
  for (const flag of ['complete_resource_closure', 'permits_handoff', 'permits_effects', 'written']) {
    const forged = structuredClone(current); forged[flag] = true;
    assert.throws(() => assertHandoffProcessObservation(forged), { code: 'HANDOFF_PROCESS_OBSERVATION_INVALID' });
  }
  checks.push('contract rejects four forged permission or closure flags');
  const unstable = structuredClone(current); unstable.stable = !unstable.stable;
  assert.throws(() => assertHandoffProcessObservation(unstable), { code: 'HANDOFF_PROCESS_OBSERVATION_INVALID' });
  checks.push('stability is derived from the two captured materials');
  const duplicatedRoots = structuredClone(current); duplicatedRoots.scope_root_sha256 = [current.scope_root_sha256[0], current.scope_root_sha256[0]];
  assert.throws(() => assertHandoffProcessObservation(duplicatedRoots), { code: 'HANDOFF_PROCESS_OBSERVATION_INVALID' });
  checks.push('core still rejects duplicated roots without unsupported schema keywords');
  parent.stdin.end('stop\n');
  const exit = await parentExit; parent = null;
  check('owned holder and child finish normally', exit.code === 0 && exit.signal === null);
  check('both original process identities are terminated', observeLocalProcessOwner(parentIdentity) === 'terminated'
    && observeLocalProcessOwner(childIdentity) === 'terminated');
  const after = observer.observe();
  check('fresh OS observation sees neither terminated identity', after.samples.every(sample =>
    sample.processes.every(row => row.pid !== ids.pid && row.pid !== ids.child)));
  const readerFile = path.join(outside, 'observer.mjs');
  const adapterUrl = new URL('../../src/adapters/runtime/local-handoff-process-discovery.mjs', import.meta.url).href;
  fs.writeFileSync(readerFile, "import {createLocalHandoffProcessDiscovery} from __ADAPTER_URL__;\nimport {spawn} from \"node:child_process\";\nlet child=null,exited=null;\ntry {\nif(process.argv[3]===\"with-child\"){child=spawn(process.execPath,[process.argv[4]],{windowsHide:true,stdio:[\"pipe\",\"pipe\",\"pipe\"]});exited=new Promise((resolve,reject)=>{child.once(\"error\",reject);child.once(\"exit\",resolve);});await new Promise((resolve,reject)=>{child.once(\"error\",reject);child.stdout.once(\"data\",resolve);child.once(\"exit\",()=>reject(Error(\"WORK_CHILD_EXITED\")));});}\nconst observation=createLocalHandoffProcessDiscovery(JSON.parse(process.argv[2])).observe();\nconsole.log(JSON.stringify(child?{observation,work_child_pid:child.pid}:observation));\n} finally {if(child&&child.exitCode===null)child.stdin.end(\"stop\\n\");if(exited)await exited;}\n".replace("__ADAPTER_URL__", JSON.stringify(adapterUrl)));
  const childObservation = JSON.parse(execFileSync(process.execPath, [readerFile, JSON.stringify(options)], {
    cwd: outside, windowsHide: true, shell: false, encoding: 'utf8', maxBuffer: 2097152,
  }));
  check('excludes only its own observer even when its arguments carry scope markers', childObservation.observer_identity.pid !== process.pid
    && childObservation.samples.every(sample => [...sample.processes, ...sample.unavailable].every(row => row.pid !== childObservation.observer_identity.pid)));
  check('observing the same roots from another process has distinct observer provenance', childObservation.scope_sha256 !== after.scope_sha256);
  const observerWork = JSON.parse(execFileSync(process.execPath, [readerFile, JSON.stringify(options), 'with-child', leaf], { cwd: outside, windowsHide: true, shell: false, encoding: 'utf8', maxBuffer: 2097152 }));
  check('observer exclusion preserves its own markerless work child', observerWork.observation.samples.every(sample => sample.processes.some(row => row.pid === observerWork.work_child_pid
    && row.parent_pid === observerWork.observation.observer_identity.pid && row.scope_match === 'descendant')));
  check('process discovery leaves both project namespaces unchanged', JSON.stringify(projection()) === JSON.stringify(initialTree));
  passed = true;
  console.log(JSON.stringify({ handoff_process_discovery: 'PASS', platform: process.platform, checks,
    source: 'current OS process table and creation identities', known_live_tree_discovered: true,
    workflow_journal_required: false, full_resource_closure: 'NOT_PROVEN', remaining_domains: ['deterministic', 'native', 'human', 'control', 'git', 'provider'],
    actual_native_clients: 0, complete_standard_workflow: false }));
} catch (cause) {
  console.error(JSON.stringify({ handoff_process_discovery_failure: true, retained_root: owned }));
  throw cause;
} finally {
  if (parent && parent.exitCode === null) { parent.stdin.end('stop\n'); await parentExit; }
  if (foreign && foreign.exitCode === null) { foreign.stdin.end('stop\n'); await foreignExit; }
  if (passed) {
    const resolved = fs.realpathSync(owned);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert(path.basename(resolved).startsWith('aidn-handoff-process-'));
    assert.equal(removePathWithRetry(resolved).ok, true);
    assert.equal(fs.existsSync(resolved), false);
    console.log(JSON.stringify({ cleanup: { owned_root: resolved, removed: true } }));
  }
}
