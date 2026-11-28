import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperations, standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { CODEX_STARTUP_ENVIRONMENT_PROFILES } from "../../src/core/agents/codex-startup-arguments.mjs";
import { createOwnedPreworkNativeFixture } from "./standard-cycle-prework-native-fixture-lib.mjs";
import { readStandardHostInstance } from "../../src/adapters/runtime/standard-host-authority.mjs";
import { runSkillHookUseCase } from "../../src/application/runtime/skill-hook-use-case.mjs";
import { createLocalProcessAdapter } from "../../src/adapters/runtime/local-process-adapter.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { createStandardOwnedEntryContinuation } from "../../src/application/runtime/standard-owned-entry-continuation.mjs";
import { readAgenticProductSnapshot } from "../../src/application/runtime/agentic-process-execution-composition.mjs";
const mode=process.argv.find(arg=>arg.startsWith("--mode="))?.slice(7);
assert(["db-only"].includes(mode),"Expected --mode=files or --mode=db-only");
const root=createFreshStandardWorkflowFixture(mode,[]),base=fs.mkdtempSync(path.join(os.tmpdir(),"aidn-owned-public-"));
const operations=createStandardWorkflowOperations({targetRoot:root}),artifacts=createStandardWorkflowArtifacts({targetRoot:root});
const git=(...args)=>execFileSync("git",["-C",root,"-c",`core.hooksPath=${process.platform==="win32"?"NUL":"/dev/null"}`,...args],{encoding:"utf8",windowsHide:true,stdio:"pipe"}).trim();
const checkpoint=()=>{git("add",".");git("commit","--allow-empty","-m","fixture prerequisite");};
const applySetup=async(method,plan)=>{assert.equal(plan.can_apply,true);assert.equal((await operations[method](plan,{write:true,expectPlan:plan.plan_sha256})).outcome,"completed");};
const objective="Continue the existing session and cycle through the public entry";
await applySetup("initializeSession",await operations.prepareSession({session_id:"S001",session_branch:"S001-owned-public",objective}));
await applySetup("applyMode",await operations.prepareMode({session_id:"S001",mode:"COMMITTING"}));checkpoint();
await applySetup("refreshCycleContext",await operations.prepareCycleContext({session_id:"S001"}));checkpoint();
await applySetup("initializeCycle",await operations.prepareCycle({session_id:"S001",cycle_id:"C001",cycle_type:"feature",title:"planning",objective,continuity_rule:"R2_SESSION_BASE_WITH_IMPORT",base_branch:"S001-owned-public"}));
const product=path.join(root,"product");fs.mkdirSync(product);fs.writeFileSync(path.join(product,"app.mjs"),"export const value = 1;\n");
await applySetup("refreshCycleContext",await operations.prepareCycleContext({session_id:"S001"}));checkpoint();
const dirs=Object.fromEntries(["control","review","home","authority"].map(name=>{const file=path.join(base,name);fs.mkdirSync(file);return[name,file];}));
const env={...process.env,AIDN_STANDARD_HOST_HOME:dirs.authority};
const originBase=path.join(base,"origin");fs.mkdirSync(originBase);
const binding=standardWorkflowOperationBindings().find(row=>row.id==="cycle_checkpoint_finalize");
const originModel={contract_version:"agentic-process-model.v2",model_id:"owned-entry-prerequisite",revision:1,participants:[{id:"project"}],roles:[],policies:[],entry:"checkpoint",
  nodes:[{id:"checkpoint",kind:"operation",participant_ref:"project",binding_ref:binding.id}],operation_pins:{[binding.id]:shadowHash(binding)},
  data_bindings:{contract_version:"process-data-bindings.v4",parameter_keys:[],inputs:[{node_id:"checkpoint",fields:{session_id:{source:"literal",value:"S001"},cycle_id:{source:"literal",value:"C001"}}}]}};
const originKey=randomBytes(32),origin=createOwnedPreworkNativeFixture({targetRoot:root,base:originBase,model:originModel,signingKey:originKey});
origin.configuration.instance_id="owned-public-origin";
const keyIdentity=readStandardHostInstance({targetRoot:root,instanceId:origin.configuration.instance_id,environment:env}).identity;
const keyFile=path.join(dirs.authority,keyIdentity+".key");fs.writeFileSync(keyFile,originKey,{flag:"wx"});
// Actual legacy R05 hook is an explicit fixture prerequisite, not a Native
// qualification or an invented accepted Human decision.
const drift=runSkillHookUseCase({args:{skill:"drift-check",mode:"COMMITTING",strict:true,noAutoSkipGate:true},
  perfDir:fileURLToPath(new URL("./",import.meta.url)),targetRoot:root,processAdapter:createLocalProcessAdapter()});
assert.equal(drift.ok,true,JSON.stringify(drift));
const initial=origin.open().initialize({parameters:{}});origin.open().initialize({parameters:{},write:true,expectedResultSha256:initial.record.instance_sha256});
const checkpointStep=await origin.open().step({write:true}),checkpointRecord=origin.open().readOperation(checkpointStep.operation_id);
assert.equal(checkpointRecord.results.at(-1).output.outcome,"completed",JSON.stringify(checkpointRecord.results.at(-1).output));
const originBefore=origin.open().inspect().record.instance_sha256;
console.log("STEP public continuation: real accepted origin checkpoint prepared");
const pin=file=>({path:file,sha256:createHash("sha256").update(fs.readFileSync(file)).digest("hex")});
const criteria=path.join(base,"criteria.md");fs.writeFileSync(criteria,"Public owned-cycle entry fixture; no model allocation is permitted.\n");
const request={contract_version:"standard-workflow-execution.v1",execution:{instance_id:"owned-public",target_root:root,product_root:product,product_files:["app.mjs"],control_root:dirs.control,review_root:dirs.review,
  criteria:pin(criteria),authorities:{project:pin(path.join(root,"AGENTS.md"))},instructions:{},controller:{},
  native:{executable:process.execPath,sha256:pin(process.execPath).sha256,home:dirs.home,tool_roots:[],protected_roots:[dirs.authority],hook_hashes:{work:["sha256:"+"a".repeat(64),"sha256:"+"b".repeat(64)],review:[]},model:"fixture-no-native",effort:"medium",
    startup:{mcp_server_ids:[],plugin_ids:[],app_ids:[],environment_override_names:[],environment_names:[...CODEX_STARTUP_ENVIRONMENT_PROFILES.worker],log_dir:dirs.control,sqlite_home:dirs.control}}},
  parameters:{entry_point:{kind:"owned_cycle",checkpoint_operation_id:checkpointStep.operation_id},session:{session_id:"S001",session_branch:"S001-owned-public",objective},cycle:{cycle_id:"C001",cycle_type:"feature",title:"planning",objective}}};
const config=path.join(base,"configuration.json"),action=path.join(base,"action.json"),cli=fileURLToPath(new URL("../../bin/aidn.mjs",import.meta.url));
fs.writeFileSync(config,JSON.stringify(request));let calls=0;
const before={session:artifacts.read("sessions/S001.md").sha256,cycle:artifacts.read("cycles/C001-feature-planning/status.md").sha256,head:git("rev-parse","HEAD"),branch:git("branch","--show-current"),product:pin(path.join(product,"app.mjs")).sha256};
function run(extra=[]){let bytes;try{bytes=execFileSync(process.execPath,[cli,"runtime","workflow-run","--target",root,"--configuration",config,"--json",...extra],{env,windowsHide:true,stdio:["ignore","pipe","pipe"],maxBuffer:16777216,timeout:180000});}
  catch(error){if(!error.stdout?.length)throw error;bytes=error.stdout;}const out=JSON.parse(bytes);fs.writeFileSync(path.join(base,`call-${++calls}.json`),bytes);return out;}
function apply(preview){assert.deepEqual(preview.errors,[]);fs.writeFileSync(action,JSON.stringify(preview.preview));const out=run(["--action-file",action,"--execute","--expect-plan",preview.action_sha256]);assert.deepEqual(out.errors,[],JSON.stringify(out));assert(!["blocked","failed","unknown"].includes(out.result?.operation_outcome),JSON.stringify(out));return out;}
const first=run();assert.equal(first.preview.kind,"prepare_host");assert.equal(fs.readdirSync(dirs.authority).length,1);apply(first);apply(run());
const bindings=[];let native;
for(let i=0;i<16;i++){
  const next=run();assert.deepEqual(next.errors,[],JSON.stringify(next));
  if(next.preview.kind==="native"){native=next;break;}
  assert(["operation","call"].includes(next.preview.kind),JSON.stringify(next));
  if(next.preview.kind==="operation")bindings.push(next.preview.payload.preview.binding.id);
  apply(next);console.log("STEP public continuation: "+(bindings.at(-1)??next.preview.kind));
}
assert(native,"The published owned route must reach the planner without a Human or another Native step");
assert.deepEqual(bindings,["workflow_entry_select","cycle_context_refresh","cycle_entry_observe","cycle_entry_admit","cycle_owned_planning_select","cycle_prework_select"]);
assert.equal(native.can_apply,false);assert.equal(fs.readdirSync(dirs.control).length,0);
assert.equal(artifacts.read("sessions/S001.md").sha256,before.session);assert.equal(artifacts.read("cycles/C001-feature-planning/status.md").sha256,before.cycle);
assert.equal(git("rev-parse","HEAD"),before.head);assert.equal(git("branch","--show-current"),before.branch);assert.equal(pin(path.join(product,"app.mjs")).sha256,before.product);
const entry=request.parameters.entry_point;
request.parameters.entry_point="session";fs.writeFileSync(config,JSON.stringify(request));assert(run().errors.includes("STANDARD_ENTRY_PARAMETERS_CHANGED"));
request.parameters.entry_point=entry;fs.writeFileSync(config,JSON.stringify(request));
assert.equal(origin.open().inspect().record.instance_sha256,originBefore);assert.deepEqual(origin.open().readOperation(checkpointStep.operation_id),checkpointRecord);
const subject={instance_id:"negative-fixture",instance_sha256:"a".repeat(64)},admission=await operations.admitCycleEntry({contract_version:"standard-cycle-entry-input.v1",session_id:"S001",cycle_id:null});
const reader=createStandardOwnedEntryContinuation({targetRoot:root,environment:env,readCurrent:()=>subject,observeScope:()=>operations.observeScope(),
  observeProduct:()=>shadowHash(readAgenticProductSnapshot(product,["app.mjs"]))});
await reader(subject,request.parameters,admission);
const refused=[];
await assert.rejects(reader(subject,{...request.parameters,entry_point:{kind:"owned_cycle",checkpoint_operation_id:"op_"+"f".repeat(40)}},admission),/CONTINUATION_REQUIRED/);refused.push("missing checkpoint");
const later=structuredClone(admission);later.observations.selected_cycle.state="IMPLEMENTING";
await assert.rejects(reader(subject,request.parameters,later),/PHASE_UNSUPPORTED/);refused.push("unsupported phase");
const bytes=fs.readFileSync(path.join(product,"app.mjs"));fs.appendFileSync(path.join(product,"app.mjs"),"// changed\n");
await assert.rejects(reader(subject,request.parameters,admission),/SCOPE_CHANGED/);fs.writeFileSync(path.join(product,"app.mjs"),bytes);refused.push("changed product");
git("checkout","--detach","HEAD~1");await assert.rejects(reader(subject,request.parameters,admission),/SCOPE_CHANGED/);git("checkout",before.branch);refused.push("changed HEAD");
fs.writeFileSync(keyFile,randomBytes(32));await assert.rejects(reader(subject,request.parameters,admission),/NOT_AUTHENTICATED/);fs.writeFileSync(keyFile,originKey);refused.push("changed origin key");
const eventPath=path.join(root,".aidn/runtime/perf/workflow-events.ndjson"),eventBytes=fs.readFileSync(eventPath);fs.writeFileSync(eventPath,"{}\n");
await assert.rejects(reader(subject,request.parameters,admission),/EVENT_CHANGED/);fs.writeFileSync(eventPath,eventBytes);refused.push("missing physical checkpoint");
const document=artifacts.read("SPEC.md");await artifacts.withLocalEffectOwner(shadowHash({fixture:"changed-owned-entry-intent"}),async()=>{
  artifacts.compareAndSwap({path:document.path,before_sha256:document.sha256,after:document.content+"\nChanged fixture intent\n"});
  return { effect_status: "confirmed" };
});
await assert.rejects(reader(subject,request.parameters,admission),/DOCUMENT_CHANGED/);refused.push("changed canonical intent");
const report={status:"PASS",mode,proof_class:"REAL_PUBLIC_CLI_TO_NATIVE_WAIT",bindings,same_session:true,same_cycle:true,same_branch:true,previous_instance_unchanged:true,
  refused,mode_questions:0,manual_signatures:0,native_calls:0,canonical_backend:mode==="db-only"?"sqlite":"files",genuine_native:"NOT_RUN",postgres:"NOT_RUN",installed_archive:"NOT_RUN",p0:false};
fs.writeFileSync(path.join(base,"proof.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));
