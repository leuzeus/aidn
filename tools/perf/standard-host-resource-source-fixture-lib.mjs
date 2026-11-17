import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync,spawn} from 'node:child_process';
import {createStandardHostAuthority} from '../../src/adapters/runtime/standard-host-authority.mjs';
import {createStandardHandoffResources} from '../../src/application/runtime/standard-handoff-resources.mjs';
import {createStandardWorkflowArtifacts} from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import {createOperationJournalSigner} from '../../src/core/workflow/process-operation-journal.mjs';
import {RECONCILIATION_DISCOVERY_DOMAINS} from '../../src/core/workflow/process-reconciliation-inventory.mjs';
import {agenticProcessImplementationPins} from '../../src/application/runtime/agentic-process-implementation-pins.mjs';
import {verificationWindowsController} from '../verify/owned-verification-process-lib.mjs';
import {shadowHash as H} from '../../src/core/workflow/shadow-json.mjs';
import {removePathWithRetry} from './test-git-fixture-lib.mjs';
import {randomUUID,createHash} from 'node:crypto';

export async function verifyStandardHostResourceSourceFixtures(){
const checks=[],check=(name,condition)=>{assert(condition,name);checks.push(name);console.log('PASS '+name);};
if(process.platform!=='win32')return {status:'SKIP',reason:'actual Windows resource-source proof',checks};
const flags={snapshot_only:true,complete_resource_closure:false,permits_effects:false,permits_handoff:false,written:false};
const nativeActivity={protocol:'standard-native-resource-activity.v1',active_runs:0,human_verification_ports:0,...flags};
const operationActivity={protocol:'standard-operation-resource-activity.v1',current_dispatch_id:null,active_dispatches:[],...flags};
const activityReaders={observeNativeActivity:()=>({...nativeActivity}),observeOperationActivity:()=>structuredClone(operationActivity)};
const owned=fs.mkdtempSync(path.join(os.tmpdir(),'aidn-default-resource-source-')),dirs={};
for(const name of ['project','control','review','native-home','authority']){dirs[name]=path.join(owned,name);fs.mkdirSync(dirs[name]);}
const git=fs.realpathSync.native(execFileSync(path.join(process.env.SystemRoot,'System32/where.exe'),['git.exe'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/)[0]);
execFileSync(git,['-C',dirs.project,'-c','init.templateDir=','init','--initial-branch=work'],{windowsHide:true,stdio:'pipe'});
fs.mkdirSync(path.join(dirs.project,'.aidn'));fs.writeFileSync(path.join(dirs.project,'.aidn','config.json'),JSON.stringify({runtime:{stateMode:'files',persistence:{backend:'sqlite'}}}));
const {manifest}=verificationWindowsController(owned),config={target_root:dirs.project,control_root:dirs.control,review_root:dirs.review,instance_id:'resource-source-case',
implementation_sha256:agenticProcessImplementationPins().sha256,native:{executable:process.execPath,home:dirs['native-home'],tool_roots:[],protected_roots:[dirs.authority]},
controller:{helper_path:manifest.helper_path,helper_sha256:manifest.helper_sha256,helper_source_sha256:manifest.source_sha256}};
const authority=createStandardHostAuthority({configuration:config,environment:{AIDN_STANDARD_HOST_HOME:dirs.authority}});
const previewSource=authority.createHandoffResourceSource({readInventory:()=>{throw Error('preview must not invoke inventory')},readNativeHistory:()=>{throw Error('preview must not invoke Native')},...activityReaders});
check('default resource-source construction allocates no host key or observation',authority.keyId()===null&&previewSource.inspectLastObservation()===null);
authority.ensureKey();
const signer=createOperationJournalSigner(authority.readKey),artifacts=createStandardWorkflowArtifacts({targetRoot:dirs.project});
let inventory={contract_version:'process-reconciliation-inventory.v1',instance_id:config.instance_id,instance_sha256:H('current process'),instance_revision:1,scope_id:'fixture-scope',model_sha256:H('model'),policy_sha256:H('policy'),model_source_sha256:H('source'),configuration_sha256:H(config),physical_root_sha256:H(dirs.project),authority_sha256:H('authority'),context_sha256:H('context'),runtime_binding_sha256:H('runtime binding'),observed_at_ms:Date.now(),resources:[],operations:[{operation_id:'op_'+'1'.repeat(40),record_sha256:H('retained unknown'),revision:1,phase:'dispatching',intent_sha256:H('intent'),prefix_sha256:H('prefix'),binding_sha256:H('binding'),grant_sha256:H('grant'),owner:{generation:randomUUID(),pid:process.pid},effect_status:'unknown',results:[]}],accounting:{native_known:true,responses_observed_minimum:0,storage_debit_bytes_minimum:0,unresolved_native_allocations:0,operation_attempts:1,unknown_operations:1},discovery:RECONCILIATION_DISCOVERY_DOMAINS.map(domain=>({domain,status:'independent_observation_required'})),complete_resource_closure:false,permits_effects:false,written:false};
const native={instance_id:config.instance_id,scope_id:null,model_sha256:null,journal_id:null,journal_sha256:null,retained_history_status:'not_allocated',entries:[],permits_effects:false,complete_resource_closure:false};
const source=authority.createHandoffResourceSource({readInventory:()=>signer.seal(inventory),readNativeHistory:()=>structuredClone(native),...activityReaders});
let rawObservation=null;const tappedSource={...source,async read(input){rawObservation=await source.read(input);return rawObservation;}};
const resources=createStandardHandoffResources({configuration:config,signer,source:tappedSource,readInventory:()=>signer.seal(inventory),readNativeHistory:()=>structuredClone(native),readOwnership:()=>({pending:artifacts.ownerPending(),fence:artifacts.resourceFence().read()})});
const projectTree=()=>{const rows={};const walk=at=>{for(const item of fs.readdirSync(at,{withFileTypes:true})){const file=path.join(at,item.name);if(item.isDirectory())walk(file);else rows[path.relative(dirs.project,file)]=H(fs.readFileSync(file).toString('base64'));}};walk(dirs.project);return rows;};
const beforeRead=projectTree(),request=resources.prepare();let passed=false,worker=null,workerClosed=null;
try{
 const observed=await resources.observeForPublication(request,{sourceRef:'standard-handoff'});
 console.log(JSON.stringify({status:observed.status??'OBSERVED',diagnostics:source.inspectLastObservation(),Native:0}));
 assert.equal(observed.result?.complete_resource_closure,true);assert.equal(observed.result.permits_handoff,false);assert.equal(observed.result.permits_effects,false);
 check('actual OS source closes all seven configured domains with retained business UNKNOWN',observed.result.unknown_business_operations.join(',')==='op_'+'1'.repeat(40)&&Object.keys(source.inspectLastObservation()).join(',')===RECONCILIATION_DISCOVERY_DOMAINS.join(','));
 assert.deepEqual(projectTree(),beforeRead);check('resource observation leaves the checkout unchanged',true);
 await assert.rejects(source.verify({request,sourceRef:'standard-handoff',observation:{...rawObservation,authority_id:'forged'}}),{code:'STANDARD_RESOURCE_SOURCE_CAPTURE_REQUIRED'});
 await assert.rejects(source.verify({request,sourceRef:'standard-handoff',observation:signer.seal(rawObservation)}),{code:'STANDARD_RESOURCE_SOURCE_CAPTURE_REQUIRED'});
 const cold=authority.createHandoffResourceSource({readInventory:()=>signer.seal(inventory),readNativeHistory:()=>structuredClone(native),...activityReaders});
 await assert.rejects(cold.verify({request,sourceRef:'standard-handoff',observation:rawObservation}),{code:'STANDARD_RESOURCE_SOURCE_CAPTURE_REQUIRED'});
 check('JSON or a journal MAC never replaces a private current resource capture',true);
 const postReleaseSource=authority.createHandoffResourceSource({readInventory:()=>signer.seal(inventory),readNativeHistory:()=>structuredClone(native),...activityReaders});
 for(const sourceRef of ['standard-handoff-foreign','standard-handoff-post-release-foreign']){
  await assert.rejects(postReleaseSource.read({request,sourceRef}),{code:'STANDARD_RESOURCE_SOURCE_REQUEST_SCOPE_CHANGED'});
 }
 for(const [field,value]of [['instance_id','foreign-instance'],['configuration_sha256',H('foreign configuration')],['physical_root_sha256',H('foreign physical root')]]){
  const {key_id,authentication,...body}=request,foreign=signer.seal({...body,[field]:value});
  await assert.rejects(postReleaseSource.read({request:foreign,sourceRef:'standard-handoff-post-release'}),{code:'STANDARD_RESOURCE_SOURCE_REQUEST_SCOPE_CHANGED'});
 }
 check('post-release source refuses unknown consumers and foreign instance, configuration or physical root',true);
 const postDispatch={dispatch_id:randomUUID(),operation_id:'op_'+'6'.repeat(40),instance_id:config.instance_id,scope_id:'fixture-scope',binding_ref:'handoff_resources_observe',executor_kind:'deterministic'};
 let postRaw;
 const postTapped={...postReleaseSource,async read(input){postRaw=await postReleaseSource.read(input);return postRaw;}};
 const postResources=createStandardHandoffResources({configuration:config,signer,source:postTapped,readInventory:()=>signer.seal(inventory),readNativeHistory:()=>structuredClone(native),readOwnership:()=>({pending:artifacts.ownerPending(),fence:artifacts.resourceFence().read()})});
 operationActivity.current_dispatch_id=postDispatch.dispatch_id;
 operationActivity.active_dispatches=[postDispatch,{...postDispatch,dispatch_id:randomUUID(),operation_id:'op_'+'7'.repeat(40)}];
 try{
  assert.equal(await postReleaseSource.read({request,sourceRef:'standard-handoff-post-release'}),null);
  assert(postReleaseSource.inspectLastObservation().deterministic.active_resources>0);
  check('a concurrent post-release observer remains an active resource',true);
  operationActivity.active_dispatches=[postDispatch];
  const postObserved=await postResources.observeForPublication(request,{sourceRef:'standard-handoff-post-release'});
  assert.equal(postObserved.result?.complete_resource_closure,true);
  assert.equal(postObserved.result.permits_handoff,false);assert.equal(postObserved.result.permits_effects,false);
  assert.deepEqual(postObserved.result.unknown_business_operations,['op_'+'1'.repeat(40)]);
  assert.deepEqual(Object.keys(postReleaseSource.inspectLastObservation()),RECONCILIATION_DISCOVERY_DOMAINS);
  await assert.rejects(postReleaseSource.verify({request,sourceRef:'standard-handoff',observation:postRaw}),{code:'STANDARD_RESOURCE_SOURCE_CAPTURE_REQUIRED'});
  postObserved.assertSourceCurrent();assert.deepEqual(projectTree(),beforeRead);
  check('actual post-release consumer closes seven domains, retains UNKNOWN and refuses a publication capture substitution',true);
 }finally{operationActivity.active_dispatches=[];operationActivity.current_dispatch_id=null;}
 await artifacts.withLocalEffectOwner(H('actual publisher owner'),()=>{artifacts.assertLocalEffectOwner(H('actual publisher owner'));observed.assertSourceCurrent();assert.throws(()=>observed.assertCurrent(),{code:'STANDARD_HANDOFF_RESOURCE_OWNER_UNRESOLVED'});return {effect_status:'no_effect'};});
 assert.equal(artifacts.ownerPending(),false);check('current source stays valid inside the actual publication owner and the known no-effect owner releases',true);
 const indexLock=path.join(dirs.project,'.git','index.lock');fs.writeFileSync(indexLock,'held');
 try{assert.throws(()=>observed.assertSourceCurrent(),{code:'STANDARD_RESOURCE_SOURCE_NOT_CURRENT'});}finally{fs.unlinkSync(indexLock);}
 observed.assertSourceCurrent();check('an actual Git index lock revokes closure until its exact absence is observed again',true);
 authority.humanSource.read({sourceRef:'missing',question:{fixture:'closed synchronous history read'}});observed.assertSourceCurrent();
 check('completed signed-file reads do not masquerade as an open resource',true);
 const keyName=fs.readdirSync(dirs.authority).find(name=>name.endsWith('.key')),keyFile=path.join(dirs.authority,keyName),keyBefore=fs.readFileSync(keyFile);
 try{fs.writeFileSync(keyFile,Buffer.alloc(32,19));assert.throws(()=>observed.assertSourceCurrent(),{code:'STANDARD_RESOURCE_SOURCE_PERMISSION_CHANGED'});}finally{fs.writeFileSync(keyFile,keyBefore);}
 observed.assertSourceCurrent();check('current protected host-key permission is checked again',true);
 const currentRequest=resources.prepare();
 for(const field of ['active_runs','human_verification_ports']){nativeActivity[field]=1;try{assert.equal(await source.read({request:currentRequest,sourceRef:'standard-handoff'}),null);assert(source.inspectLastObservation().native.active_resources>0);}finally{nativeActivity[field]=0;}}
 check('live Native runs and parent human-verification ports prevent closure independently of closed history',true);
 operationActivity.active_dispatches=[{dispatch_id:randomUUID(),operation_id:'op_'+'2'.repeat(40),instance_id:config.instance_id,scope_id:'fixture-scope',binding_ref:'fixture_unfinished_operation',executor_kind:'deterministic'}];
 assert.equal(await source.read({request:currentRequest,sourceRef:'standard-handoff'}),null);assert(source.inspectLastObservation().deterministic.active_resources>0);operationActivity.active_dispatches=[];
 check('a pending in-process deterministic operation prevents closure',true);
 operationActivity.active_dispatches=[{dispatch_id:randomUUID(),operation_id:'op_'+'3'.repeat(40),instance_id:config.instance_id,scope_id:'foreign-scope',binding_ref:'handoff_packet_publish',executor_kind:'deterministic'}];
 assert.equal(await source.read({request:currentRequest,sourceRef:'standard-handoff'}),null);operationActivity.active_dispatches=[];
 check('a foreign observer scope cannot borrow the publication exclusion',true);
 const ownDispatch={dispatch_id:randomUUID(),operation_id:'op_'+'4'.repeat(40),instance_id:config.instance_id,scope_id:'fixture-scope',binding_ref:'handoff_packet_publish',executor_kind:'deterministic'};
 operationActivity.current_dispatch_id=ownDispatch.dispatch_id;
 operationActivity.active_dispatches=[ownDispatch,{...ownDispatch,dispatch_id:randomUUID(),operation_id:'op_'+'5'.repeat(40)}];
 try{
  assert.equal(await source.read({request:currentRequest,sourceRef:'standard-handoff'}),null);assert(source.inspectLastObservation().deterministic.active_resources>0);
  check('a concurrent handoff in the same instance and scope remains an active resource',true);
  operationActivity.active_dispatches=[ownDispatch];
  assert(await source.read({request:currentRequest,sourceRef:'standard-handoff'}));
  check('only the exact current observer dispatch is excluded from its own count',source.inspectLastObservation().deterministic.active_resources===0);
 }finally{operationActivity.active_dispatches=[];operationActivity.current_dispatch_id=null;}

 const workerFile=path.join(owned,'live-work.mjs');fs.writeFileSync(workerFile,"process.stdin.resume();process.stdin.once('data',()=>process.exit(0));console.log('ready');\n");
 worker=spawn(process.execPath,[workerFile],{windowsHide:true,stdio:['pipe','pipe','pipe']});workerClosed=new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('exit',code=>resolve(code));});
 await new Promise((resolve,reject)=>{worker.stdout.once('data',resolve);worker.once('error',reject);worker.once('exit',()=>reject(Error('WORK_EXITED_BEFORE_READY')));});
 const busy=await resources.observeForPublication(resources.prepare(),{sourceRef:'standard-handoff'});assert.equal(busy.status,'WAITING');assert(source.inspectLastObservation().process.active_resources>0);
 worker.stdin.end('stop\n');assert.equal(await workerClosed,0);worker=null;
 check('kernel-bound observer console exclusion preserves a real unmarked live work child',true);
 const previousStatus=native.retained_history_status;native.retained_history_status='reconciliation_required';
 try{await assert.rejects(source.read({request:currentRequest,sourceRef:'standard-handoff'}),{code:'STANDARD_RESOURCE_SOURCE_NATIVE_HISTORY_UNRESOLVED'});}finally{native.retained_history_status=previousStatus;}
 check('unresolved Native history stays unresolved',true);
 const aborted=new AbortController();aborted.abort();await assert.rejects(source.read({request:currentRequest,sourceRef:'standard-handoff',signal:aborted.signal}),{code:'STANDARD_RESOURCE_SOURCE_ABORTED'});
 check('already cancelled observation refuses before discovery',true);
 const final=await resources.observeForPublication(resources.prepare(),{sourceRef:'standard-handoff'});assert.equal(final.result.complete_resource_closure,true);assert.deepEqual(final.result.unknown_business_operations,['op_'+'1'.repeat(40)]);
 check('fresh resource closure after work termination retains UNKNOWN without business replay',true);

 const compiler=path.join(process.env.WINDIR??'C:\\Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
 const fakeSource=path.join(owned,'fake-github.cs'),fakeGh=path.join(owned,'fake-github.exe');
 fs.writeFileSync(fakeSource,[
  'using System;class FakeGithub{static int Main(string[] args){',
  'if(args.Length>0&&args[0]=="auth"){Console.Write("fixture-token-0123456789");return 0;}',
  'string endpoint=args.Length>0?args[args.Length-1]:"";',
  'if(endpoint=="user"){Console.Write(@"{""node_id"":""USER_fixture"",""login"":""fixture-actor""}");return 0;}',
  'if(endpoint=="repos/fixture/neutral"){Console.Write(@"{""node_id"":""REPO_fixture"",""full_name"":""fixture/neutral""}");return 0;}',
  'return 2;}}'
 ].join('\n'));
 execFileSync(compiler,['/nologo','/target:exe','/platform:x64','/out:'+fakeGh,fakeSource],{cwd:owned,windowsHide:true});
 const rawSha=bytes=>createHash('sha256').update(bytes).digest('hex'),identity=keyName.slice(0,-4);
 execFileSync(git,['-C',dirs.project,'remote','add','origin','https://github.com/fixture/neutral.git'],{windowsHide:true,stdio:'pipe'});
 fs.writeFileSync(path.join(dirs.authority,identity+'.github.json'),JSON.stringify({contract_version:'standard-host-github.v1',
  target_root:dirs.project,instance_id:config.instance_id,repository:{host:'github.com',owner:'fixture',name:'neutral',node_id:'REPO_fixture'},
  actor:{login:'fixture-actor',node_id:'USER_fixture'},git:{path:git,sha256:rawSha(fs.readFileSync(git))},gh:{path:fakeGh,sha256:rawSha(fs.readFileSync(fakeGh))}}),{flag:'wx'});
 fs.mkdirSync(path.join(dirs.authority,identity+'.github'));
 const providerAuthority=createStandardHostAuthority({configuration:config,environment:{...process.env,AIDN_STANDARD_HOST_HOME:dirs.authority}});
 const providerSource=providerAuthority.createHandoffResourceSource({readInventory:()=>signer.seal(inventory),readNativeHistory:()=>structuredClone(native),...activityReaders});
 const providerResources=createStandardHandoffResources({configuration:config,signer,source:providerSource,readInventory:()=>signer.seal(inventory),
  readNativeHistory:()=>structuredClone(native),readOwnership:()=>({pending:artifacts.ownerPending(),fence:artifacts.resourceFence().read()})});
 const providerObservation=await providerResources.observeForPublication(providerResources.prepare(),{sourceRef:'standard-handoff'});
 assert.equal(providerObservation.result?.complete_resource_closure,true,JSON.stringify(providerSource.inspectLastObservation()));
 check('configured default GH and Git observers both participate in actual seven-domain closure',providerAuthority.githubProvider.observeAsyncTransportResources().coverage.default_async_ports.join(',')==='read,reply,resolution,merge,open,push,post_merge_git');
 await providerAuthority.githubProvider.verifyIdentity();
 const providerProof=providerAuthority.githubProvider.observeAsyncTransportResources();providerProof.assertCurrent();
 assert.equal(providerProof.snapshot.confirmed_closed_commands,3);assert.equal(providerProof.git_snapshot.confirmed_closed_commands,0);
 assert.equal(providerProof.snapshot.active_commands.length,0);assert.equal(providerProof.snapshot.unconfirmed_commands,0);
 assert(providerProof.snapshot.recent_closures.every(row=>row.termination_proof.active_processes===0));
 assert.throws(()=>providerObservation.assertSourceCurrent(),{code:'GITHUB_OBSERVATION_TREE_SNAPSHOT_CHANGED'});
 check('three actual confined provider fixture commands invalidate the previous private capture after their Jobs close',true);
 const providerFresh=await providerResources.observeForPublication(providerResources.prepare(),{sourceRef:'standard-handoff'});
 assert.equal(providerFresh.result?.complete_resource_closure,true,JSON.stringify(providerSource.inspectLastObservation()));
 check('a fresh provider capture closes after confirmed command termination without replaying UNKNOWN',providerFresh.result.unknown_business_operations.join(',')==='op_'+'1'.repeat(40));
 passed=true;console.log(JSON.stringify({status:'PASS_ACTUAL_DEFAULT_SEVEN_DOMAIN_SOURCE_AND_OWN_PUBLICATION_OWNER',Native:0,actual_provider_requests:0,canonical_inventory:'CONTROLLED_FIXTURE',complete_standard:false}));
}finally{if(worker&&worker.exitCode===null){worker.stdin.end('stop\n');await workerClosed;}if(passed){const real=fs.realpathSync(owned);assert.equal(path.dirname(real),fs.realpathSync(os.tmpdir()));assert(path.basename(real).startsWith('aidn-default-resource-source-'));assert.equal(removePathWithRetry(real).ok,true);console.log(JSON.stringify({owned_root:real,removed:true}));}}

return {status:'PASS',checks,actual_OS:'Windows',canonical_inventory:'CONTROLLED_FIXTURE',Native_clients:0,actual_provider_requests:0,complete_standard:false};

}
