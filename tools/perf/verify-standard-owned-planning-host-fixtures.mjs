import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createStandardWorkflowOperations, standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createOwnedPreworkNativeFixture } from "./standard-cycle-prework-native-fixture-lib.mjs";
import { cyclePlanProposal } from "./cycle-planning-fixture-lib.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";

const mode = process.argv.find(arg => arg.startsWith("--mode="))?.slice(7);
assert(["dual", "db-only"].includes(mode), "Expected --mode=files or --mode=db-only");
const owned = [], root = createFreshStandardWorkflowFixture(mode, owned), base = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-owned-planning-"));
const artifacts = createStandardWorkflowArtifacts({targetRoot:root}), operations = createStandardWorkflowOperations({targetRoot:root});
const git = (...args) => execFileSync("git", ["-C",root,"-c","core.hooksPath=NUL",...args], {encoding:"utf8",windowsHide:true,stdio:"pipe"}).trim();
const checkpoint = message => { git("add","."); git("commit","--allow-empty","-m",message); };
const apply = async (method, prepared) => {
  assert.equal(prepared.can_apply,true,JSON.stringify(prepared));
  assert.equal((await operations[method](prepared,{write:true,expectPlan:prepared.plan_sha256})).outcome,"completed");
};
const objective = "Continue an owned cycle before planning was recorded";
await apply("initializeSession",await operations.prepareSession({session_id:"S001",session_branch:"S001-owned",objective}));
await apply("applyMode",await operations.prepareMode({session_id:"S001",mode:"COMMITTING"})); checkpoint("fixture session precondition");
await apply("refreshCycleContext",await operations.prepareCycleContext({session_id:"S001"})); checkpoint("fixture current context");
await apply("initializeCycle",await operations.prepareCycle({session_id:"S001",cycle_id:"C001",cycle_type:"feature",title:"planning",objective,
  continuity_rule:"R2_SESSION_BASE_WITH_IMPORT",base_branch:"S001-owned"}));
fs.mkdirSync(path.join(root,"product")); fs.writeFileSync(path.join(root,"product/app.mjs"),"export const value = 1;\n");
await apply("refreshCycleContext",await operations.prepareCycleContext({session_id:"S001"})); checkpoint("fixture existing unplanned cycle");
const cyclePath="cycles/C001-feature-planning", beforeProduct=fs.readFileSync(path.join(root,"product/app.mjs"));
const retainedSession=artifacts.read("sessions/S001.md").sha256, branches=git("for-each-ref","--format=%(refname)%09%(objectname)","refs/heads");
const bindings=new Map(standardWorkflowOperationBindings().map(row=>[row.id,row]));
const sequence=["entry","owned","select","plan","evaluate","record","ready","enter"];
const operationRows=[["entry","cycle_entry_admit"],["owned","cycle_owned_planning_select"],["select","cycle_prework_select"],
  ["evaluate","cycle_prework_evaluate"],["record","cycle_plan_record"],["ready","cycle_readiness_evaluate"],["enter","cycle_implementation_enter"]];
const reference=(key,node_id,source="operation_id")=>({[key]:{source,node_id}});
const inputs={entry:{contract_version:{source:"literal",value:"standard-cycle-entry-input.v1"},session_id:{source:"literal",value:"S001"},cycle_id:{source:"literal",value:null}},
  owned:reference("entry_operation_id","entry"),select:{},plan:reference("selection_operation_id","select"),
  evaluate:reference("report_occurrence_id","plan","occurrence_id"),record:reference("evaluation_operation_id","evaluate"),
  ready:reference("record_operation_id","record"),enter:reference("evaluation_operation_id","ready")};
const model={contract_version:"agentic-process-model.v2",model_id:"owned-unplanned-fixture",revision:1,participants:[{id:"project"}],roles:[],policies:[],entry:"main",
  nodes:[{id:"main",kind:"sequence",participant_ref:"project",children:sequence},...operationRows.map(([id,binding_ref])=>({id,kind:"operation",participant_ref:"project",binding_ref}))],
  operation_pins:Object.fromEntries(operationRows.map(([,id])=>[id,shadowHash(bindings.get(id))])),
  data_bindings:{contract_version:"process-data-bindings.v4",parameter_keys:[],inputs:sequence.map(node_id=>({node_id,fields:inputs[node_id]}))}};
const f=createOwnedPreworkNativeFixture({targetRoot:root,base,model,signingKey:randomBytes(32),freshProposalFor:cyclePlanProposal});
model.roles.push(f.actor.role);model.policies.push(f.actor.policy);model.nodes.push({...f.actor.activity,id:"plan"});
f.configuration.activity_outputs.plan="standard-cycle-prework-report.v1";
const bytes=JSON.stringify(model);fs.writeFileSync(f.configuration.model.path,bytes);f.configuration.model.sha256=artifactContentHash(bytes);
const initialize=()=>{const preview=f.open().initialize({parameters:{}});f.open().initialize({parameters:{},write:true,expectedResultSha256:preview.record.instance_sha256});};
f.configuration.instance_id="prior-planning-instance";initialize();
const previousEntry=await f.open().step({write:true}), previous=f.open().inspect(), previousJournal=f.open().readOperation(previousEntry.operation_id);
assert.equal(previousJournal.results.at(-1).output.outcome,"completed");
f.configuration.instance_id="continued-planning-instance";initialize();
console.log("STEP owned planning: existing session, cycle and prior accepted entry retained");
const authorization=f.authorize(), outputs=[];
for(const id of sequence){
  const step=await f.open().step({write:true,...(id==="plan"?{authorization}:{})});
  if(id==="plan"){
    assert.equal(step.kind,"native");assert.equal(step.journal_phase,"closed",JSON.stringify(step));assert.equal(step.first_failure??null,null,JSON.stringify(step));
    assert.equal(f.t.sessions.length,1);assert(f.t.sessions.every(row=>row.closed));
  }else{
    const journal=f.open().readOperation(step.operation_id),output=journal.results.at(-1).output;
    assert.equal(journal.intent.binding_ref,operationRows.find(row=>row[0]===id)[1]);assert.equal(output.outcome,"completed",JSON.stringify(output));
    outputs.push({id,operation_id:step.operation_id,outcome:output.outcome,effect_status:output.effect_status});
    if(id==="owned")assert.equal(output.facts.owned_cycle_planning_required,true);
    if(id==="evaluate")assert.equal(output.facts.cycle_plan_record_required,true);
    if(id==="ready")assert.equal(output.facts.cycle_readiness_satisfied,true);
  }
  assert.deepEqual(fs.readFileSync(path.join(root,"product/app.mjs")),beforeProduct);
  console.log("STEP owned planning: "+id+" completed");
}
assert.equal(f.open().inspect().cursor.status,"COMPLETED");
assert.equal(artifacts.read("sessions/S001.md").sha256,retainedSession);
assert.equal(git("for-each-ref","--format=%(refname)%09%(objectname)","refs/heads"),branches);
assert.match(artifacts.read(cyclePath+"/status.md").content,/state: IMPLEMENTING/);
assert.match(artifacts.read(cyclePath+"/plan.md").content,/Native write scope/);
f.configuration.instance_id="prior-planning-instance";
assert.equal(f.open().inspect().record.instance_sha256,previous.record.instance_sha256);
assert.deepEqual(f.open().readOperation(previousEntry.operation_id),previousJournal);
const report={status:"PASS",mode,proof_class:"REAL_HOST_PORTS_WITH_CONTROLLED_NATIVE_WIRE",native_model:"NOT_RUN",native_process_tree:"NOT_RUN",
  same_canonical_session:true,same_canonical_cycle:true,previous_instance_and_receipt_unchanged:true,new_instance:true,product_unchanged:true,
  operations:outputs,readiness_and_phase_transition:"PASS",p0:false};
fs.writeFileSync(path.join(base,"proof.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));
