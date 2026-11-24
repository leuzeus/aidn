import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createStandardSessionBranchIntegration} from '../../src/application/runtime/standard-session-branch-integration.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {createAgenticProcessService} from '../../src/application/runtime/agentic-process-service.mjs';
import {createStandardSessionClosureReview} from '../../src/application/runtime/standard-session-closure-review.mjs';
import {createAgenticProcessStore} from '../../src/adapters/runtime/agentic-process-store.mjs';
import {createArtifactStore} from '../../src/adapters/runtime/artifact-store.mjs';
import {shadowHash as H} from '../../src/core/workflow/shadow-json.mjs';

const digest='a'.repeat(64),root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'aidn-operation-commit-'));
const binding={contract_version:'process-operation-binding.v1',id:'review',revision:1,executor_kind:'human',effect_class:'read-only',skill_id:'cycle-close',
 input_contract:'fixture-input.v1',output_contract:'fixture-output.v1',rule_refs:['SPEC-R07'],allowed_modes:['COMMITTING'],implementation_sha256:digest};
const model={contract_version:'agentic-process-model.v2',model_id:'commit-guard-fixture',revision:1,participants:[{id:'project'}],roles:[],policies:[],entry:'review',
 nodes:[{id:'review',kind:'operation',participant_ref:'project',binding_ref:'review'}],operation_pins:{review:H(binding)}};
let serial=0,checks=0;
async function fixture(){
 const targetRoot=path.join(root,'case-'+(++serial));fs.mkdirSync(path.join(targetRoot,'.aidn'),{recursive:true});
 fs.writeFileSync(path.join(targetRoot,'.aidn/config.json'),JSON.stringify({runtime:{stateMode:'db-only'}}));
 createArtifactStore({sqliteFile:path.join(targetRoot,'.aidn/runtime/index/workflow-index.sqlite')}).close();
 const store=createAgenticProcessStore({targetRoot,stateMode:'db-only'}),state={authentic:true,scope:'fixture-scope',verify:()=>{}};
 const authority={prepare({instance,occurrence}){state.intent={contract_version:'process-operation-intent.v1',operation_id:'fixture-op',binding_ref:'review',binding_sha256:H(binding),
  input_sha256:digest,preconditions_sha256:digest,authorization_sha256:null,authority_id:'fixture-human',scope_id:instance.scope_id,instance_id:instance.instance_id,
  instance_sha256:instance.instance_sha256,model_sha256:instance.model_sha256,occurrence_id:occurrence.occurrence_id,instance_revision:instance.revision};return{binding,intent:state.intent};},
  verifyIntent({intent}){return{outcome:'verified',authority_id:intent.authority_id,intent_sha256:H(intent),binding_sha256:H(binding)};},
  readReceipt(){return state.receipt;},async verifyReceipt({receipt,intent}){await state.verify();return{outcome:state.authentic?'verified':'refused',authority_id:intent.authority_id,receipt_sha256:H(receipt),intent_sha256:H(intent)};}};
 const open=operationCommitGuard=>createAgenticProcessService({store,readAuthority:()=>({scope_id:state.scope,model_sha256:H(model),policy_pins:{}}),operationAuthority:authority,
  authorityTimeoutMs:50,operationCommitGuard});
 const created=open().initialize({instanceId:'fixture',model,write:true});
 const waiting=await open().prepareOperation({instanceId:'fixture',expectedSha256:created.record.instance_sha256,occurrenceId:'root',eventId:'staged',write:true});
 state.receipt={contract_version:'process-operation-receipt.v1',receipt_id:'fixture-receipt',operation_id:state.intent.operation_id,intent_sha256:H(state.intent),authority_id:state.intent.authority_id,
  outcome:'completed',effect_status:'no_effect',output_sha256:digest,facts:{retained:true},evidence_refs:[{ref:'fixture:human',sha256:digest}]};
 const args={instanceId:'fixture',expectedSha256:waiting.record.instance_sha256,occurrenceId:'root',eventId:'accepted',receiptId:state.receipt.receipt_id,write:true};
 return{targetRoot,state,store,open,args,waiting};
}
async function check(name,fn){await fn();checks++;console.log('PASS '+name);}
try{
 await check('session closure reconstruction may outlast source authentication while stale HEAD and R05 still refuse acceptance',async()=>{
  for(const changed of ['none','head','r05']){
   const f=await fixture(),op=n=>'op_'+n.repeat(40),input={contract_version:'standard-session-closure-review-input.v1',admission_operation_id:op('a'),drift_evaluation_operation_id:op('b'),drift_finalization_operation_id:op('c')};
   const source={admission:{operation_id:op('a'),session_id:'S001',output:{facts:{session_close_admission_satisfied:true}}},
    evaluation:{operation_id:op('b'),output:{facts:{drift_present:false,drift_context_complete:true,drift_recovery_required:false}}},
    finalization:{operation_id:op('c'),output:{facts:{drift_check_completed:true},observations:{evaluation_operation_id:op('b')}}},
    current:{session_id:'S001',session_path:'sessions/S001.md',mode:'COMMITTING',branch:'C001-feature-example',session_branch:'S001-example',head:'a'.repeat(40),
     context_sha256:digest,scope_sha256:digest,documents:['sessions/S001.md','CURRENT-STATE.md','snapshots/context-snapshot.md'].map(p=>({ref:'audit:'+p,sha256:digest,metadata_sha256:digest})),open_cycles:[],session_close_gate_satisfied:false,admission_allowed:true}};
   let slow=false,authenticated=false;
   const review=createStandardSessionClosureReview({readSource:async()=>{if(slow){assert.equal(authenticated,true);await delay(120);}return structuredClone(source);}});
   const prepared=await review.prepare(f.waiting.record,input),receiptBefore=H(f.state.receipt);slow=true;f.state.verify=()=>{authenticated=true;};
   if(changed==='head')source.current.head='b'.repeat(40);
   if(changed==='r05')source.finalization.output.facts.drift_check_completed=false;
   const accept=()=>f.open(({instance})=>review.assertFresh(instance,prepared.plan)).acceptOperation(f.args);
   if(changed==='none'){const result=await accept();assert.equal(result.cursor.status,'COMPLETED');assert.equal(result.record.events.filter(e=>e.kind==='operation_result').length,1);}
   else{await assert.rejects(accept,{code:changed==='head'?'STANDARD_SESSION_CLOSURE_REVIEW_CHANGED':'STANDARD_SESSION_CLOSURE_ACCEPTED_SOURCE_REQUIRED'});assert.equal(f.store.read('fixture').record.instance_sha256,f.waiting.record.instance_sha256);}
   assert.equal(H(f.state.receipt),receiptBefore);
  }
 });
 await check('integration reconstructs real Git after authentication; changed HEAD or canonical subject preserves the pending receipt',async()=>{
  for(const changed of ['none','head','document']){
   const f=await fixture(),git=(...args)=>execFileSync('git',['-C',f.targetRoot,...args],{encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}).trim();
   git('init','-b','S001-example');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');
   fs.writeFileSync(path.join(f.targetRoot,'.gitignore'),'.aidn/\n');fs.writeFileSync(path.join(f.targetRoot,'product.txt'),'one\n');git('add','.');git('commit','-m','session');
   git('switch','-c','C001-feature-example');fs.writeFileSync(path.join(f.targetRoot,'product.txt'),'two\n');git('add','.');git('commit','-m','cycle');
   const head=git('rev-parse','HEAD'),target=git('rev-parse','S001-example'),op=n=>'op_'+n.repeat(40),input={contract_version:'standard-session-branch-integration-review-input.v1',delivery_operation_id:op('a'),closure_operation_id:op('b')};
   const source={session_id:'S001',session_path:'sessions/S001.md',cycle_id:'C001',cycle_path:'cycles/C001-feature-example/status.md',source_branch:'C001-feature-example',target_branch:'S001-example',
    delivery_operation_id:op('a'),delivery_output_sha256:digest,closure_operation_id:op('b'),closure_output_sha256:digest,material_sha256:digest,delivery_head:head,
    documents:['sessions/S001.md','cycles/C001-feature-example/status.md','CURRENT-STATE.md','snapshots/context-snapshot.md'].map(p=>({ref:'audit:'+p,sha256:digest,metadata_sha256:digest}))};
   let slow=false,authenticated=false;
   const review=createStandardSessionBranchIntegration({targetRoot:f.targetRoot,readSource:async()=>{if(slow){assert(authenticated);await delay(120);}return structuredClone(source);},readDecision:async()=>null,readCurrent:()=>f.waiting.record});
   const prepared=await review.prepareDecision(f.waiting.record,input),receiptBefore=H(f.state.receipt);slow=true;
   f.state.verify=()=>{authenticated=true;if(changed==='head')git('commit','--allow-empty','-m','changed');if(changed==='document')source.documents[0].sha256='b'.repeat(64);};
   const accept=()=>f.open(({instance})=>review.assertFresh(instance,prepared.plan)).acceptOperation(f.args);
   if(changed==='none'){const result=await accept();assert.equal(result.cursor.status,'COMPLETED');assert.equal(result.record.events.filter(e=>e.kind==='operation_result').length,1);}
   else{await assert.rejects(accept,{code:changed==='head'?'STANDARD_SESSION_INTEGRATION_REVIEW_INVALID':'STANDARD_SESSION_INTEGRATION_REVIEW_CHANGED'});assert.equal(f.store.read('fixture').record.instance_sha256,f.waiting.record.instance_sha256);}
   assert.equal(H(f.state.receipt),receiptBefore);assert.equal(git('rev-parse','S001-example'),target);assert.equal(git('branch','--show-current'),'C001-feature-example');
  }
 });
 await check('slow local subject reconstruction finishes after bounded authentication and before one durable receipt',async()=>{
  const f=await fixture(),order=[];f.state.verify=()=>{order.push('authenticated');};
  const accepted=await f.open(async({instance,intent,receipt})=>{order.push('guard');assert.equal(instance.instance_sha256,f.waiting.record.instance_sha256);assert.deepEqual(intent,f.state.intent);assert.deepEqual(receipt,f.state.receipt);
   await delay(120);receipt.facts.forged=true;order.push('fresh');}).acceptOperation(f.args);
  assert.deepEqual(order,['authenticated','guard','fresh']);assert.equal(accepted.cursor.status,'COMPLETED');assert.equal(accepted.record.events.at(-1).receipt.facts.forged,undefined);
  const duplicate=await f.open(()=>{throw Error('Guard must not replay accepted decision');}).acceptOperation({...f.args,expectedSha256:accepted.record.instance_sha256});
  assert.equal(duplicate.written,false);assert.equal(f.store.read('fixture').record.events.filter(e=>e.kind==='operation_result').length,1);
 });
 await check('unverified and timed-out authorities never reach the local commit guard',async()=>{
  for(const timeout of [false,true]){const f=await fixture();let guarded=false;
   if(timeout)f.state.verify=()=>new Promise(()=>{});else f.state.authentic=false;
   await assert.rejects(f.open(()=>{guarded=true;}).acceptOperation(f.args),{code:timeout?'PROCESS_OPERATION_AUTHORITY_TIMEOUT':'PROCESS_OPERATION_RESULT_NOT_AUTHENTICATED'});
   assert.equal(guarded,false);assert.equal(f.store.read('fixture').record.instance_sha256,f.waiting.record.instance_sha256);
  }
 });
 await check('stale subject refusal preserves the receipt and waiting instance',async()=>{
  const f=await fixture(),original=H(f.state.receipt);
  await assert.rejects(f.open(async()=>{await delay(60);throw Object.assign(Error('stale'),{code:'STANDARD_CLOSURE_REVIEW_STALE'});}).acceptOperation(f.args),{code:'STANDARD_CLOSURE_REVIEW_STALE'});
  assert.equal(H(f.state.receipt),original);assert.equal(f.store.read('fixture').record.instance_sha256,f.waiting.record.instance_sha256);
 });
 await check('a competing accepted receipt cannot be overwritten after the guard await',async()=>{
  const f=await fixture();
  await assert.rejects(f.open(async()=>{await f.open().acceptOperation(f.args);}).acceptOperation(f.args),{code:'PROCESS_REVISION_CONFLICT'});
  assert.equal(f.store.read('fixture').record.events.filter(e=>e.kind==='operation_result').length,1);
 });
 await check('abort and authority change during domain reconstruction prevent commit',async()=>{
  for(const abort of [false,true]){const f=await fixture(),stop=new AbortController();
   await assert.rejects(f.open(async()=>{await delay(60);if(abort)stop.abort();else f.state.scope='other';}).acceptOperation({...f.args,signal:stop.signal}),
    {code:abort?'PROCESS_OPERATION_COMMIT_ABORTED':'PROCESS_AUTHORITY_CHANGED'});
   assert.equal(f.store.read('fixture').record.instance_sha256,f.waiting.record.instance_sha256);
  }
 });
 await check('the guard is a fixed host capability, not serialized operation data',async()=>{
  const f=await fixture();assert.throws(()=>f.open({verified:true}),{code:'PROCESS_OPERATION_COMMIT_GUARD_INVALID'});
  await assert.rejects(f.open(()=>{throw Error('fixed-host-refusal');}).acceptOperation({...f.args,operationCommitGuard:()=>{}}),/fixed-host-refusal/);
  assert.equal(f.store.read('fixture').record.instance_sha256,f.waiting.record.instance_sha256);
 });
 console.log(JSON.stringify({status:'PASS',checks,backend:'sqlite',state_mode:'db-only',proof:'receipt-authentication-and-local-commit-order',native_calls:0,postgres:'NOT_RUN',installed_archive:'NOT_RUN'}));
}finally{const resolved=fs.realpathSync(root);if(path.dirname(resolved)!==fs.realpathSync(os.tmpdir())||!path.basename(resolved).startsWith('aidn-operation-commit-'))throw Error('CLEANUP_OUT_OF_SCOPE');fs.rmSync(resolved,{recursive:true,force:true});}
