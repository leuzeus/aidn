import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { createHmac, randomBytes } from "node:crypto";
import { createDelegatedAgentAdmissionService } from "../../src/application/runtime/delegated-agent-admission-service.mjs";
import { startAgentAdmissionTransport, requestAgentAdmission } from "../../src/adapters/runtime/agent-admission-transport.mjs";
import { fingerprintAgentExecutionValue, fingerprintTaskContract, normalizeAgentExecutionPlan } from "../../src/core/agents/agent-execution-contracts.mjs";

const original=JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agent-execution/contracts/complete-chain.json",import.meta.url),"utf8"));
const root=fs.mkdtempSync(path.join(os.tmpdir(),"aidn-delegated-admission-"));
const prefix=fs.realpathSync(os.tmpdir());
const checks=[];
let current="configuration",transport;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function check(name,callback){current=name;await callback();checks.push(name);process.stdout.write(`PASS ${name}\n`);}
function contextFor(scope=null) {
  const context=Object.fromEntries(["plan","run","task","attempt","delegation","request"].map(key=>[key,structuredClone(original[key])]));
  delete context.plan.plan_sha256;
  if(scope){context.plan.canonical.scope.push(...scope);context.plan.tasks[0].scope.push(...scope);}
  if(scope?.some(entry=>entry.operations.includes("move-destination"))){context.plan.canonical.scope[0].operations.push("move");context.plan.tasks[0].scope[0].operations.push("move");}
  context.plan=normalizeAgentExecutionPlan(context.plan);
  context.run.canonical=context.plan.canonical;
  const task=context.plan.tasks[0],taskHash=fingerprintTaskContract(task);
  Object.assign(context.task,task,{task_contract_sha256:taskHash});
  for(const value of Object.values(context)){if(value!==context.plan)value.plan_sha256=context.plan.plan_sha256;}
  for(const kind of ["attempt","delegation","request"])context[kind].task_contract_sha256=taskHash;
  context.attempt.lifecycle_status="running";
  context.attempt.worktree.cwd=root;context.delegation.worktree.cwd=root;context.request.cwd=root;
  context.delegation.scope=context.task.scope;
  context.request.delegation_sha256=fingerprintAgentExecutionValue(context.delegation);
  return context;
}
function setup({context=contextFor(),inspect,storeError}={}) {
  const binding={attemptId:context.attempt.attempt_id,ownership:context.attempt.ownership,
    requestSha256:fingerprintAgentExecutionValue(context.request),delegationSha256:fingerprintAgentExecutionValue(context.delegation)};
  const observation={physical_root:root,worktree_id:context.attempt.worktree.worktree_id,branch:context.attempt.worktree.branch,
    head:context.attempt.input_sha,active:true,activation:context.attempt.activation,engine:context.request.execution.engine,receipt_valid:true,persistence_policy:"verify-only"};
  const store={admitDelegatedRequest:async args=>{assert.equal(args.attemptId,binding.attemptId);if(storeError)throw Object.assign(new Error(storeError),{code:storeError});return args.evaluate(structuredClone(context));}};
  return {binding,observation,service:createDelegatedAgentAdmissionService({store,binding,inspectWorktree:inspect??(()=>structuredClone(observation))})};
}
const update="*** Begin Patch\n*** Update File: src/alpha.mjs\n@@\n-before\n+after\n*** End Patch";
function packet(binding,command=update,tool="apply_patch") {return {protocol_version:1,attempt_id:binding.attemptId,request_sha256:binding.requestSha256,native_request:{cwd:root,tool_name:tool,tool_input:{command}}};}
function rawCall(endpoint,token,body,{nonce=randomBytes(16).toString("hex"),method="POST",url="/v1/admit",headers={}}={}) {
  const port=Number(new URL(endpoint).port),text=JSON.stringify(body);
  const auth=createHmac("sha256",token).update(`request\n${nonce}\n${text}`).digest("hex");
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:"127.0.0.1",port,path:url,method,agent:false,headers:{"content-type":"application/json","content-length":Buffer.byteLength(text),"x-aidn-nonce":nonce,"x-aidn-auth":auth,...headers}},res=>{
      let out="";res.on("data",data=>{out+=data;});res.on("end",()=>resolve({status:res.statusCode,body:JSON.parse(out)}));
    });req.on("error",reject);req.end(text);
  });
}
function incompleteRequest(endpoint,phase) {
  return new Promise((resolve,reject)=>{
    const address=new URL(endpoint),began=performance.now();
    const socket=net.createConnection({host:"127.0.0.1",port:Number(address.port)});
    let drip,forced=false;
    const limit=setTimeout(()=>{forced=true;socket.destroy();},13000);
    socket.on("connect",()=>{
      const headers=`POST /v1/admit HTTP/1.1\r\nHost: ${address.host}\r\n`;
      if(phase==="headers")socket.write(headers+"X-Incomplete: ");
      else socket.write(headers+`Content-Type: application/json\r\nContent-Length: 2048\r\nX-Aidn-Nonce: ${"b".repeat(32)}\r\nX-Aidn-Auth: ${"c".repeat(64)}\r\n\r\n{`);
      // Active drips prevent an idle timeout; the absolute header/body bounds
      // must still reject this incomplete request without invoking admission.
      drip=setInterval(()=>socket.write(" "),100);
    });
    socket.on("data",()=>{});socket.on("error",()=>{});
    socket.on("close",()=>{
      clearTimeout(limit);clearInterval(drip);
      if(forced)reject(new Error(`incomplete ${phase} exceeded the transport deadline`));
      else resolve(performance.now()-began);
    });
  });
}
try {
  fs.mkdirSync(path.join(root,"src"));fs.writeFileSync(path.join(root,"src","alpha.mjs"),"before\n");
  await check("configuration, preflight and admitted patch require explicit supervisor dependencies",async()=>{
    assert.throws(()=>createDelegatedAgentAdmissionService(),/CONFIGURATION_REQUIRED/);
    const {binding,service}=setup();
    assert.equal((await service.preflight()).outcome,"allow");
    const result=await service.admit(packet(binding));assert.equal(result.outcome,"allow");
    assert.deepEqual(result.operations,[{path:"src/alpha.mjs",operation:"update"}]);
    assert.equal(fs.readFileSync(path.join(root,"src","alpha.mjs"),"utf8"),"before\n");
  });
  await check("foreign attempt, request and native operations fail closed",async()=>{
    const {binding,service}=setup();
    assert.equal((await service.admit({...packet(binding),attempt_id:"foreign"})).outcome,"deny");
    assert.equal((await service.admit({...packet(binding),request_sha256:"f".repeat(64)})).outcome,"deny");
    for(const tool of ["shell","exec_command","write_stdin","mcp__anything"]){assert.equal((await service.admit(packet(binding,update,tool))).outcome,"deny");}
    assert.equal((await service.admit(packet(binding,"node -e 'write()'"))).outcome,"deny");
  });
  await check("mixed patches and every unscoped note or parking-lot edit are refused",async()=>{
    const {binding,service}=setup();
    for(const file of ["src/outside.mjs","docs/audit/notes/note.md","docs/audit/parking-lot.md"]){
      const command=update.replace("*** End Patch",`*** Add File: ${file}\n+outside\n*** End Patch`);
      const result=await service.admit(packet(binding,command));assert.equal(result.outcome,"deny");assert.equal(result.reason_code,"DELEGATED_SCOPE_REFUSED");
    }
  });
  await check("explicit note scope follows the same exact path and operation rules",async()=>{
    const {binding,service}=setup({context:contextFor([{path:"docs/audit/notes/explicit.md",operations:["add"]}])});
    const command="*** Begin Patch\n*** Add File: docs/audit/notes/explicit.md\n+note\n*** End Patch";
    assert.equal((await service.admit(packet(binding,command))).outcome,"allow");
    assert.equal((await service.admit(packet(binding,command.replace("explicit.md","other.md")))).outcome,"deny");
  });
  await check("session, cycle, planning, installation and authorization paths are always refused",async()=>{
    const {binding,service}=setup();
    for(const file of ["docs/audit/sessions/S001.md","docs/audit/cycles/C001/status.md","docs/audit/BACKLOG.md",".aidn/install/receipt.json",".git/aidn/authorization.json","AGENTS.md"]){
      assert.equal((await service.admit(packet(binding,`*** Begin Patch\n*** Add File: ${file}\n+control\n*** End Patch`))).outcome,"deny");
    }
  });
  await check("move authorization covers both endpoints and operation kinds",async()=>{
    const context=contextFor([{path:"src/destination.mjs",operations:["move-destination"]}]);
    const plan=structuredClone(context.plan);delete plan.plan_sha256;
    // Build a complete consistent bundle after extending the source permission.
    context.plan=normalizeAgentExecutionPlan(plan);context.run.canonical=context.plan.canonical;
    const taskHash=fingerprintTaskContract(context.plan.tasks[0]);Object.assign(context.task,context.plan.tasks[0],{task_contract_sha256:taskHash});
    context.delegation.scope=context.task.scope;
    for(const kind of ["run","task","attempt","delegation","request"]){context[kind].plan_sha256=context.plan.plan_sha256;if(kind!=="run")context[kind].task_contract_sha256=taskHash;}
    context.request.delegation_sha256=fingerprintAgentExecutionValue(context.delegation);
    const {binding,service}=setup({context});
    const command=update.replace("*** Update File: src/alpha.mjs","*** Update File: src/alpha.mjs\n*** Move to: src/destination.mjs");
    assert.equal((await service.admit(packet(binding,command))).outcome,"allow");
    assert.equal((await service.admit(packet(binding,command.replace("destination.mjs","foreign.mjs")))).outcome,"deny");
  });
  await check("physical aliases, hardlinks and paths outside the worktree are refused",async()=>{
    const {binding,service}=setup();
    for(const file of ["../outside.mjs","src/NUL.txt","src/file:stream","src/alpha.mjs."]){
      assert.equal((await service.admit(packet(binding,update.replace("src/alpha.mjs",file)))).outcome,"deny");
    }
    fs.linkSync(path.join(root,"src","alpha.mjs"),path.join(root,"hardlink"));
    try{assert.equal((await service.admit(packet(binding))).reason_code,"LINK_PATH_UNSUPPORTED");}finally{fs.unlinkSync(path.join(root,"hardlink"));}
  });
  await check("copied receipt, revocation, changed engine and wrong worktree observation refuse admission",async()=>{
    for(const field of ["receipt_valid","active","physical_root","worktree_id","branch","head","engine","activation","persistence_policy"]){
      const initial=setup(),observation=structuredClone(initial.observation);
      observation[field]=["receipt_valid","active"].includes(field)?false:["engine","activation"].includes(field)?{}:"different";
      const {binding,service}=setup({inspect:()=>observation});assert.equal((await service.admit(packet(binding))).outcome,"deny",field);
    }
  });
  await check("ownership and lease failures from PostgreSQL cannot be overridden by local observations",async()=>{
    for(const code of ["AGENT_EXECUTION_OWNERSHIP_LOST","AGENT_EXECUTION_LEASE_EXPIRED","AGENT_EXECUTION_PLANNING_CHANGED"]){
      const {binding,service}=setup({storeError:code});const result=await service.admit(packet(binding));assert.equal(result.outcome,"deny");assert.equal(result.reason_code,code);
    }
    const base=setup();let calls=0;
    const {binding,service}=setup({inspect:()=>({...base.observation,active:++calls===1})});assert.equal((await service.admit(packet(binding))).outcome,"deny");
    const aborted=new AbortController();aborted.abort();assert.equal((await base.service.admit(packet(base.binding),{signal:aborted.signal})).outcome,"deny");
  });
  const base=setup();let active=0,maximum=0,calls=0;
  transport=await startAgentAdmissionTransport({attemptId:base.binding.attemptId,requestSha256:base.binding.requestSha256,admit:async(...args)=>{active++;calls++;maximum=Math.max(maximum,active);try{await wait(10);return await base.service.admit(...args);}finally{active--;}}});
  await check("authenticated loopback requests are serialized and return bound decisions",async()=>{
    const results=await Promise.all([1,2,3].map(()=>requestAgentAdmission({...transport,request:packet(base.binding)})));
    assert.ok(results.every(value=>value.outcome==="allow"));assert.equal(maximum,1);
  });
  await check("completed request bodies retain valid admission responses beyond the ingestion idle limit",async()=>{
    let completed=0;
    const delayed=await startAgentAdmissionTransport({attemptId:base.binding.attemptId,requestSha256:base.binding.requestSha256,admit:async(...args)=>{
      await wait(5400);const decision=await base.service.admit(...args);completed++;return decision;
    }});
    const began=performance.now();
    try {
      const decision=await requestAgentAdmission({...delayed,request:packet(base.binding),timeoutMs:6500});
      assert.equal(decision.outcome,"allow");assert.equal(completed,1);
      assert.ok(performance.now()-began>=5000);
    } finally {await delayed.close();await delayed.close();}
  });
  await check("incomplete headers and dripping bodies expire without invoking admission",async()=>{
    const before=calls;
    const [headers,body]=await Promise.all([incompleteRequest(transport.endpoint,"headers"),incompleteRequest(transport.endpoint,"body")]);
    assert.ok(headers>=4500 && headers<12000,`header deadline: ${headers}`);
    assert.ok(body>=9500 && body<12000,`body deadline: ${body}`);
    assert.equal(calls,before);
  });
  await check("transport rejects foreign binding, replay, origin, wrong host, routes and methods",async()=>{
    const before=calls;
    for(const options of [{method:"GET"},{url:"/v1/query"},{headers:{origin:"https://example.invalid"}},{headers:{host:"localhost"}}]){
      assert.equal((await rawCall(transport.endpoint,transport.token,packet(base.binding),options)).body.outcome,"deny");
    }
    assert.equal((await rawCall(transport.endpoint,transport.token,{...packet(base.binding),attempt_id:"other"})).body.reason_code,"ADMISSION_BINDING_REFUSED");
    assert.equal((await rawCall(transport.endpoint,transport.token,packet(base.binding),{headers:{"content-length":String(2*1024*1024+1)}})).body.reason_code,"ADMISSION_REQUEST_LIMIT");
    assert.equal(calls,before);
    const nonce=randomBytes(16).toString("hex");
    assert.equal((await rawCall(transport.endpoint,transport.token,packet(base.binding),{nonce})).body.outcome,"allow");
    assert.equal((await rawCall(transport.endpoint,transport.token,packet(base.binding),{nonce})).body.reason_code,"ADMISSION_NONCE_REFUSED");
    await assert.rejects(requestAgentAdmission({...transport,token:"f".repeat(64),request:packet(base.binding)}),/AUTHENTICATION_REFUSED/);
  });
  await check("client never resolves DNS, follows redirects or trusts unsigned responses",async()=>{
    for(const endpoint of ["http://localhost:123/v1/admit","https://127.0.0.1:123/v1/admit","http://127.0.0.1:123/v1/admit?query=sql"]){
      await assert.rejects(requestAgentAdmission({...transport,endpoint,request:packet(base.binding)}),/CONFIGURATION_REQUIRED/);
    }
    const fake=http.createServer((_req,res)=>{res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({protocol_version:1,outcome:"allow",reason_code:"FAKE",attempt_id:base.binding.attemptId,request_sha256:base.binding.requestSha256}));});
    await new Promise(resolve=>fake.listen(0,"127.0.0.1",resolve));
    try{await assert.rejects(requestAgentAdmission({...transport,endpoint:`http://127.0.0.1:${fake.address().port}/v1/admit`,request:packet(base.binding)}),/AUTHENTICATION_REFUSED/);}finally{await new Promise(resolve=>fake.close(resolve));}
  });
  await check("closed transport refuses later requests and oversized inputs fail before send",async()=>{
    await assert.rejects(requestAgentAdmission({...transport,request:{...packet(base.binding),extra:"x".repeat(2*1024*1024)}}),/REQUEST_LIMIT/);
    await transport.close();await transport.close();
    await assert.rejects(requestAgentAdmission({...transport,request:packet(base.binding),timeoutMs:1000}),/TRANSPORT_UNAVAILABLE/);
  });
  await check("bounded outstanding requests drain on closure without further admission",async()=>{
    let started,invocations=0;
    const entered=new Promise(resolve=>{started=resolve;});
    const busy=await startAgentAdmissionTransport({attemptId:base.binding.attemptId,requestSha256:base.binding.requestSha256,admit:async(_packet,{signal})=>{
      invocations++;started();await new Promise(resolve=>signal.addEventListener("abort",resolve,{once:true}));
      return {protocol_version:1,ok:false,outcome:"deny",reason_code:"CANCELLED",attempt_id:base.binding.attemptId,request_sha256:base.binding.requestSha256};
    }});
    const pending=Array.from({length:8},()=>requestAgentAdmission({...busy,request:packet(base.binding),timeoutMs:1000}).then(value=>({value}),error=>({error})));
    try {
      await entered;await wait(25);
      await assert.rejects(requestAgentAdmission({...busy,request:packet(base.binding),timeoutMs:100}),/TRANSPORT_/);
      await busy.close();await Promise.all(pending);assert.equal(invocations,1);
    }finally{await busy.close();await Promise.all(pending);}
  });
  await check("client deadline bounds a peer that continuously sends partial data",async()=>{
    const fake=http.createServer((_req,res)=>{
      res.writeHead(200,{"content-type":"application/json"});res.write(" ");
      const timer=setInterval(()=>res.write(" "),10);res.on("close",()=>clearInterval(timer));
    });
    await new Promise(resolve=>fake.listen(0,"127.0.0.1",resolve));
    try {await assert.rejects(requestAgentAdmission({...transport,endpoint:`http://127.0.0.1:${fake.address().port}/v1/admit`,request:packet(base.binding),timeoutMs:100}),/TRANSPORT_TIMEOUT/);}
    finally{fake.closeAllConnections();await new Promise(resolve=>fake.close(resolve));}
  });
  process.stdout.write(JSON.stringify({ok:true,checks:checks.length,postgres:"SKIP",native_codex:"SKIP",evidence:"supervisor doubles and actual loopback transport"})+"\n");
}catch(error){process.stderr.write(JSON.stringify({ok:false,check:current,error:String(error.message).slice(0,1200)})+"\n");process.exitCode=1;}
finally{
  await transport?.close();
  const real=fs.realpathSync(root);assert.equal(path.dirname(real),prefix);assert.ok(path.basename(real).startsWith("aidn-delegated-admission-"));fs.rmSync(real,{recursive:true});
}
