#!/usr/bin/env node
// Explicit, disposable measurement campaign; never invoked by a hook.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { initGitRepo, removePathWithRetry } from "./test-git-fixture-lib.mjs";

const baseline = process.argv[2];
if (!baseline) throw new Error("Pass the read-only baseline source directory");
const candidate = path.resolve(import.meta.dirname,"../..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(),"aidn-admission-measure-"));
const results = [];
const preload = path.join(temp,"count.cjs");
fs.writeFileSync(preload, `const fs=require('node:fs'),cp=require('node:child_process');
for(const name of ['spawnSync','spawn','execFileSync','execSync']){const original=cp[name];cp[name]=function(...args){fs.appendFileSync(process.env.AIDN_MEASURE_FILE,JSON.stringify({api:name})+'\\n');return original.apply(this,args)}}
require('node:module').syncBuiltinESMExports();`);
try {
  for (const [label, source] of [["before",path.resolve(baseline)],["after",candidate]]) {
    const root = path.join(temp,label); fs.mkdirSync(root);
    const write = (file,text) => {const abs=path.join(root,file);fs.mkdirSync(path.dirname(abs),{recursive:true});fs.writeFileSync(abs,text);};
    write("README.md","# Measurement fixture\n");
    initGitRepo(root,{sourceBranch:"main",workingBranch:"feature/C101-alpha"});
    const {executeCodexAssets} = await import(pathToFileURL(path.join(source,"src/application/install/codex-assets-service.mjs")));
    const installed = executeCodexAssets({targetRoot:root,repoRoot:source,dryRun:false});
    if (!installed.ok) throw new Error("measurement fixture installation failed");
    write("docs/audit/snapshots/context-snapshot.md","# Snapshot\n");
    write("docs/audit/sessions/S101-alpha.md","# Session\n");
    write("docs/audit/cycles/C101-feature-alpha/status.md","state: IMPLEMENTING\nbranch_name: feature/C101-alpha\nsession_owner: S101\ndor_state: READY\n");
    write("docs/audit/cycles/C101-feature-alpha/plan.md",'# Plan\n## Tasks\n1. implement alpha\n\n## Native write scope\n```json\n'+JSON.stringify({version:1,tasks:[{task:"implement alpha",intent:"implementation",paths:[{path:"src/marker.mjs",operations:["add"]}]}]})+'\n```\n');
    for (const [scenario,mode,file] of [["thinking-product","THINKING","src/marker.mjs"],["thinking-note","THINKING","docs/audit/notes/marker.md"],["implementation-scoped","COMMITTING","src/marker.mjs"]]) {
      write("docs/audit/CURRENT-STATE.md",`updated_at: 2026-09-24T00:00:00Z\nmode: ${mode}\nbranch_kind: cycle\nactive_session: S101\nactive_cycle: C101\ncycle_branch: feature/C101-alpha\nsession_branch: S101-alpha\ndor_state: READY\nfirst_plan_step: implement alpha\n`);
      for (let sample=0;sample<3;sample++) {
        const counts = path.join(temp,"counts.ndjson"); fs.writeFileSync(counts,"");
        const input=JSON.stringify({cwd:root,tool_name:"apply_patch",tool_input:{command:`*** Begin Patch\n*** Add File: ${file}\n+marker\n*** End Patch`}});
        const started=performance.now();
        const child=spawnSync(process.execPath,[path.join(root,".codex/hooks/aidn-pre-tool-use.mjs")],{cwd:root,input,encoding:"utf8",timeout:15000,windowsHide:true,
          env:{...process.env,NODE_OPTIONS:`--require="${preload.replaceAll("\\", "/")}"`,AIDN_MEASURE_FILE:counts}});
        if(child.status!==0) throw new Error(`wrapper measurement failed: ${child.status} ${child.stderr?.slice(-1200)}`);
        const output=JSON.parse(child.stdout.trim());
        results.push({label,scenario,sample:sample+1,duration_ms:Math.round(performance.now()-started),
          root_processes:1,child_process_api_calls:fs.readFileSync(counts,"utf8").trim().split(/\r?\n/).filter(Boolean).length,
          stdin_bytes:Buffer.byteLength(input),stdout_bytes:Buffer.byteLength(child.stdout),
          context_bytes:Buffer.byteLength(output.hookSpecificOutput?.additionalContext ?? ""),
          decision:output.hookSpecificOutput?.permissionDecision === "deny" ? "deny" : "continue",llm_calls:0});
        if(fs.existsSync(path.join(root,file))) throw new Error("read-only measurement mutated a marker");
      }
    }
  }
  console.log(JSON.stringify({proof_class:"fixture-wrapper-measurement",instrumentation:"same temporary Node child-process API counter in both sources; calls include shells, not unique OS descendants",cache:"none",units:"milliseconds and UTF-8 bytes; no token conversion",results},null,2));
} finally {removePathWithRetry(temp);}
