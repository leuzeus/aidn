import assert from "node:assert/strict";
import fs from "node:fs";
import { standardEntryPoint, selectStandardEntry, assertStandardEntrySelection } from "../../src/core/workflow/standard-workflow-entry-selection.mjs";
import { createStandardOperationProvider } from "../../src/application/runtime/standard-operation-provider.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { ownedResumeSourceContractFixture } from "./standard-owned-cycle-resume-contract-fixture-lib.mjs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
const checks=[];
async function check(name,fn){await fn();checks.push(name);console.log("PASS "+name);}
const checkpoint="op_"+"a".repeat(40), parameters={entry_point:{kind:"owned_cycle",checkpoint_operation_id:checkpoint},session:{session_id:"S001"}};
const continuation={source_instance_id:"prior",source_instance_sha256:"a".repeat(64),checkpoint_operation_id:checkpoint,checkpoint_sha256:"b".repeat(64),
  completion_operation_id:null,completion_sha256:null,alignment_sha256:null,gate_sha256:"c".repeat(64)};
await check("entry selection is closed, read-only and supplies no initialization facts",()=>{
  const normal=selectStandardEntry({});assertStandardEntrySelection(normal);assertStandardOperationOutput(normal);
  assert.deepEqual(normal.facts,{owned_cycle_continuation_requested:false});assert.equal(normal.observations.admission,null);
  assertStandardOperationInput("workflow_entry_select",{});
  assert.throws(()=>assertStandardOperationInput("workflow_entry_select",{owned_cycle_continuation_requested:true}));
  const schema=JSON.parse(fs.readFileSync(new URL("../../src/core/contracts/workflow-definition/standard-workflow-entry-selection-output.v1.schema.json",import.meta.url)));
  assert.deepEqual(validateJsonSchemaDefinition(schema,"#",{contractKind:"workflow-definition"}),[]);
});
await check("only the two named entry points are accepted",()=>{
  for(const value of [null,true,{},"owned_cycle","continue","other",{...parameters.entry_point,approved:true}]){assert.throws(()=>standardEntryPoint({entry_point:value}),{code:"STANDARD_ENTRY_POINT_INVALID"});}
  assert.equal(standardEntryPoint({entry_point:"session"}),"session");assert.equal(standardEntryPoint(parameters),"owned_cycle");
});
await check("owned routing retains an actual entry observation and grants no implementation",()=>{
  for(const phase of ["OPEN","IMPLEMENTING","VERIFYING"]){
    const entry=ownedResumeSourceContractFixture(phase).source.output,output=selectStandardEntry(parameters,entry,continuation);
    assert.deepEqual(output.observations.admission,entry);assert.equal(output.facts.mode_committing,true);
    assert.equal(output.observations.admission.observations.implementation_authorized,false);assert.equal(output.effect_status,"no_effect");
  }
});
await check("creation, missing ownership and unknown output fields cannot select owned routing",()=>{
  const entry=ownedResumeSourceContractFixture().source.output;
  assert.throws(()=>selectStandardEntry({...parameters,session:{session_id:"S999"}},entry,continuation),{code:"STANDARD_ENTRY_SESSION_CHANGED"});
  assert.throws(()=>selectStandardEntry(parameters,entry),{code:"STANDARD_ENTRY_CONTINUATION_REQUIRED"});
  for(const field of ["cycle_entry_creation_allowed","cycle_entry_choice_required"]){const changed=structuredClone(entry);changed.facts[field]=true;assert.throws(()=>selectStandardEntry(parameters,changed,continuation));}
  const missing=structuredClone(entry);missing.facts.cycle_entry_resume_allowed=false;
  assert.equal(selectStandardEntry(parameters,missing).outcome,"blocked");
  const invented=selectStandardEntry(parameters,entry,continuation);invented.approved=true;assert.throws(()=>assertStandardEntrySelection(invented));
});
await check("the fixed provider reads the pinned parameters and rechecks process identity after admission",async()=>{
  let revision="a".repeat(64),calls=0,change=false;
  const record={instance_id:"entry-fixture",instance_sha256:revision,initial_parameters:structuredClone(parameters)};
  const provider=createStandardOperationProvider({entryContinuation:async()=>continuation,reviewEffects:new Map(),current:()=>({record:{...record,instance_sha256:revision}}),
    operations:{async admitCycleEntry(input){calls++;assert.equal(input.session_id,"S001");if(change)revision="b".repeat(64);return ownedResumeSourceContractFixture().source.output;}},
    fail:code=>{throw Object.assign(Error(code),{code});}});
  const operation=provider.operations.find(row=>row.binding.id==="workflow_entry_select");
  assert.equal(operation.binding.effect_class,"read-only");
  assert.equal((await operation.prepare({state:{record},input:{}})).facts.owned_cycle_continuation_requested,true);assert.equal(calls,1);
  change=true;await assert.rejects(operation.dispatch({state:{record}}),{code:"STANDARD_ENTRY_PROCESS_CHANGED"});
  revision=record.instance_sha256;record.initial_parameters={};change=false;
  assert.equal((await operation.prepare({state:{record},input:{}})).facts.owned_cycle_continuation_requested,false);assert.equal(calls,2);
});
await (await import("./standard-validation-layout-fixture-lib.mjs")).verifyStandardValidationLayout({check});
console.log(JSON.stringify({status:"PASS",checks:checks.length,scope:"ENTRY_SELECTION_CONTRACT_AND_CONTROLLED_PROVIDER",native_calls:0,public_cli:"NOT_RUN",p0:false}));
