#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";
import { validateJsonSchema } from "../../src/core/contracts/json-schema-validator.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-bootstrap-lifecycle-"));
const target = path.join(temp, "client espace");
const timings = [];
const checks = [];
function check(name, fn) { fn(); checks.push({ name, status: "PASS" }); }
function digestTree(dir) {
  const entries = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name))) {
      const absolute = path.join(current,entry.name);
      if(entry.isDirectory()) { entries.push([path.relative(dir,absolute)+"/","directory"]); visit(absolute); }
      else entries.push([path.relative(dir,absolute),crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex")]);
    }
  }
  visit(dir);
  return JSON.stringify(entries);
}
function managedDigest() { return JSON.stringify([".agents", ".codex", ".aidn/install"].map(relative => digestTree(path.join(target,relative))).concat(fs.readFileSync(path.join(target,"AGENTS.md"),"utf8"))); }
function run(args, { success = true, cwd = root, defaultTarget = true, appendJson = true } = {}) {
  const start=performance.now();
  const child=spawnSync(process.execPath,[path.join(root,"bin/aidn.mjs"),"bootstrap",...(defaultTarget ? ["--target",target] : []),...args,...(appendJson ? ["--json"] : [])],{
    cwd,encoding:"utf8",timeout:60000,maxBuffer:10*1024*1024,windowsHide:true,
    env:{...process.env,PATH:path.dirname(process.execPath),USERPROFILE:temp,HOME:temp,LOCALAPPDATA:path.join(temp,"local")},
  });
  assert.equal(child.error,undefined);
  const data=JSON.parse(child.stdout);
  if(success) assert.equal(child.status,0,JSON.stringify(data.errors));
  else assert.notEqual(child.status,0);
  const schemaName=data.contract_version === "bootstrap.v1"
    ? (data.effect_class === "preview" ? "bootstrap-preview.v1" : "bootstrap.v1")
    : data.contract_version;
  const schema=JSON.parse(fs.readFileSync(path.join(root,"src/core/contracts/cli-output",schemaName+".schema.json"),"utf8"));
  assert.deepEqual(validateJsonSchema(data,schema),[]);
  timings.push({operation:args.join(" "),duration_ms:Math.round(performance.now()-start),stdout_bytes:Buffer.byteLength(child.stdout)});
  return data;
}
function verifyScalarParsing() {
  const before = digestTree(temp);
  const scalars = ["--scope", "--target", "--expect-plan", "--mode", "--profile", "--project-name", "--source-branch", "--runtime-persistence-connection-ref"];
  for (const flag of scalars) {
    for (const tail of [[], ["--dry-run"], ["-h"]]) {
      const result = run(["--json", flag, ...tail], { success: false, cwd: temp, defaultTarget: false, appendJson: false });
      assert.equal(result.ok, false);
      assert.ok(result.errors.includes("Missing value for " + flag));
      assert.deepEqual(result.operations, []);
      assert.equal(digestTree(temp), before, flag + " must not consume a following option or create directories");
    }
  }
  for (const { args, contract, effect } of [
    { args: ["--target", "--repair"], contract: "bootstrap-lifecycle.v1", effect: "preview" },
    { args: ["--source-branch", "--dry-run", "--profile", "minimal"], contract: "bootstrap.v1", effect: "preview" },
    { args: ["--project-name", "--diagnose"], contract: "bootstrap-diagnostics.v1", effect: "read-only" },
  ]) {
    const result = run(args, { success: false, cwd: temp, defaultTarget: false });
    assert.equal(result.contract_version, contract);
    assert.equal(result.effect_class, effect);
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes("Missing value for " + args[0]));
    assert.deepEqual(result.operations, []);
    if (result.contract_version !== "bootstrap.v1") {
      assert.equal(result.written, false);
      assert.deepEqual(result.write_targets, []);
    }
    assert.equal(digestTree(temp), before, "malformed preview must not turn into installation");
  }
  checks.push({ name: "all scalar flags reject missing values and following options with JSON errors and zero writes", status: "PASS" });
}
function apply(action) {
  const before=digestTree(target);
  const preview=run(["--"+action]);
  assert.equal(digestTree(target),before);
  assert.equal(preview.written,false);
  return run(["--"+action,"--write","--expect-plan",preview.plan_id]);
}
try {
  verifyScalarParsing();
  fs.mkdirSync(path.join(target,".codex"),{recursive:true});
  const instructions="# Client instructions\nPreserve this exact text.\n";
  const hooks={hooks:{Stop:[{matcher:"",custom_field:42,hooks:[{type:"command",command:"echo third-party"}]}]},description:"third-party hooks"};
  fs.writeFileSync(path.join(target,"AGENTS.md"),instructions);
  fs.writeFileSync(path.join(target,".codex/hooks.json"),JSON.stringify(hooks));
  fs.writeFileSync(path.join(target,".codex/config.toml"),'[mcp_servers.example]\ncommand = "third-party"\n');
  const before=digestTree(target);
  const installPreview=run(["--profile","minimal","--source-branch","main","--dry-run"]);
  check("install preview lists owned objects without writing",()=>{
    assert.equal(digestTree(target),before); assert.ok(installPreview.asset_plan.operations.length>0);
    assert.equal(installPreview.installation_plan.scope,"installation");
    assert.ok(installPreview.installation_plan.operations.some(item=>item.path===".aidn/config.json"));
    assert.ok(installPreview.installation_plan.operations.some(item=>item.path==="docs/audit/WORKFLOW.md"));
    assert.ok(Array.isArray(installPreview.installation_plan.external_effects));
  });
  run(["--profile","minimal","--source-branch","main"]);
  check("nominal install requires neither Codex CLI nor LLM",()=>{
    assert.ok(fs.existsSync(path.join(target,".aidn/install/receipt.json")));
    assert.equal(JSON.parse(fs.readFileSync(path.join(target,".codex/hooks.json"),"utf8")).hooks.Stop[0].custom_field,42);
    assert.ok(fs.readFileSync(path.join(target,"AGENTS.md"),"utf8").startsWith(instructions));
  });
  const installed=managedDigest();
  run(["--profile","minimal","--source-branch","main"]);
  check("reinstall creates no duplicate hook or transaction",()=>assert.ok(managedDigest()===installed,"managed assets or recovery history changed during reinstall"));
  const beforeDiagnostic=digestTree(target);
  const diagnostic=run(["--diagnose"]);
  check("diagnostic is read-only and does not invent approval",()=>{
    assert.equal(digestTree(target),beforeDiagnostic); assert.equal(diagnostic.capabilities.states.approved,"unknown");
    assert.equal(diagnostic.capabilities.states.operational,"unverified");
    assert.equal(diagnostic.assets.version_info.recorded_version,fs.readFileSync(path.join(root,"VERSION"),"utf8").trim());
    assert.equal(diagnostic.assets.version_info.status,"current");
    assert.equal(diagnostic.assets.version_info.receipt_drift,false);
  });
  const completeDiagnostic=run(["--diagnose","--scope","installation"]);
  check("installation diagnostic selects the complete scope without granting trust or writing",()=>{
    assert.equal(completeDiagnostic.scope,"installation");
    assert.equal(completeDiagnostic.written,false);
    assert.equal(digestTree(target),beforeDiagnostic);
    assert.equal(completeDiagnostic.capabilities.states.approved,"unknown");
  });
  const completePreview=run(["--repair","--scope","installation"]);
  check("installation lifecycle preview is nonmutating and enforces explicit intent",()=>{
    assert.equal(completePreview.scope,"installation");
    assert.equal(completePreview.written,false);
    assert.equal(digestTree(target),beforeDiagnostic);
    run(["--repair","--scope","installation","--write"],{success:false});
    run(["--repair","--scope","installation","--write","--expect-plan","stale"],{success:false});
    assert.equal(digestTree(target),beforeDiagnostic);
  });
  const skill=path.join(target,".agents/skills/aidn-context-reload/SKILL.md");
  const expected=fs.readFileSync(skill,"utf8");
  fs.unlinkSync(skill);
  apply("repair");
  check("repair restores a missing owned asset",()=>assert.equal(fs.readFileSync(skill,"utf8"),expected));
  apply("rollback");
  check("rollback restores the pre-image of the last transaction",()=>assert.equal(fs.existsSync(skill),false));
  apply("repair");
  const reviewed=run(["--uninstall"]);
  fs.appendFileSync(skill,"\nUser customization after preview\n");
  const diverged=digestTree(target);
  run(["--uninstall","--write","--expect-plan",reviewed.plan_id],{success:false});
  run(["--profile","minimal","--source-branch","main"],{success:false});
  check("stale plan and customized owned asset refuse before writes",()=>assert.equal(digestTree(target),diverged));
  for(const args of [["--repair","--write"],["--repair","--write","--dry-run"],["--diagnose","--write"],["--repair","--uninstall"],["--repair","--scope","unknown"],["--scope","installation"]]) {
    run(args,{success:false});
    assert.equal(digestTree(target),diverged);
  }
  checks.push({name:"contradictory write flags and missing reviewed plan refuse without mutation",status:"PASS"});
  fs.writeFileSync(skill,expected);
  const runtimeFile=path.join(target,"docs/audit/parking-lot.md");
  fs.appendFileSync(runtimeFile,"\nRetained project history\n");
  const history=fs.readFileSync(runtimeFile,"utf8");
  apply("uninstall");
  check("uninstall retains client instructions hooks config and runtime history",()=>{
    assert.equal(fs.readFileSync(path.join(target,"AGENTS.md"),"utf8"),instructions);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target,".codex/hooks.json"),"utf8")),hooks);
    assert.equal(fs.readFileSync(runtimeFile,"utf8"),history);
    assert.equal(fs.readFileSync(path.join(target,".codex/config.toml"),"utf8"),'[mcp_servers.example]\ncommand = "third-party"\n');
    assert.equal(fs.existsSync(skill),false);
    assert.ok(fs.readdirSync(path.join(target,".aidn/install/transactions")).length>0);
  });
  console.log(JSON.stringify({status:"PASS",proof_class:"fixture",platform:process.platform,checks,timings,
    native_trust:"SKIP",unix:process.platform==="win32"?"UNAVAILABLE":"PASS",measurement_unit:"wall-clock milliseconds and stdout bytes; not tokens"},null,2));
} finally {
  const cleanup=removePathWithRetry(temp);
  if(!cleanup.ok) throw cleanup.error;
}
