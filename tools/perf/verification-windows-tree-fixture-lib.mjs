import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runOwnedVerificationCommandSync, verificationCallerIdentity } from "../verify/owned-verification-process-lib.mjs";
import { runNodeFixtureCases } from "../verify/node-fixture-runner-lib.mjs";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const powershell = path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
function identities(ids) {
  const result = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-Command",
    `$ids=@(${ids.join(",")}); @(Get-CimInstance Win32_Process | Where-Object { $ids -contains $_.ProcessId } | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath,CommandLine) | ConvertTo-Json -Compress`],
  { encoding: "utf8", windowsHide: true, shell: false, timeout: 10000, maxBuffer: 65536 });
  assert.equal(result.status, 0, result.stderr);
  const rows = JSON.parse(result.stdout || "[]"); return Array.isArray(rows) ? rows : [rows];
}
async function waitFor(file, child) {
  const end = Date.now() + 20000;
  while (!fs.existsSync(file) && Date.now() < end && child?.exitCode == null) await delay(30);
  assert.ok(fs.existsSync(file), "owned tree must be observed before stopping it: " + file);
}

export async function verifyWindowsVerificationTree(base) {
  if (process.platform !== "win32") { console.log("SKIP Windows Job OS fixture on non-Windows"); return; }
  const source = fileURLToPath(new URL("../verify/owned-verification-process-lib.mjs", import.meta.url));
  const library = new URL("../verify/node-fixture-runner-lib.mjs", import.meta.url).href;
  const tree = path.join(base, "owned tree.mjs"), dispatcher = path.join(base, "relative-dispatcher.mjs");
  fs.writeFileSync(tree, `import fs from 'node:fs'; import {spawn,spawnSync} from 'node:child_process';
const [role,log,ready]=process.argv.slice(2); fs.appendFileSync(log,JSON.stringify({pid:process.pid,ppid:process.ppid,role,argv:process.argv})+'\\n');
if(role!=='grandchild')spawn(process.execPath,[process.argv[1],role==='parent'?'child':'grandchild',log,ready],{stdio:'ignore',windowsHide:true,detached:true});
else { const rows=fs.readFileSync(log,'utf8').trim().split('\\n').map(JSON.parse); const ids=rows.map(r=>r.pid).join(',');
const ps=spawnSync(${JSON.stringify(powershell)},['-NoProfile','-NonInteractive','-Command',\
'$all=@(Get-CimInstance Win32_Process); $ids=@('+(process.env.AIDN_VERIFICATION_SUPERVISOR_PID||rows[0].ppid)+'); do { $more=@($all | Where-Object { $ids -contains $_.ParentProcessId -and $ids -notcontains $_.ProcessId }); $ids+=@($more.ProcessId) } while($more.Count); @($all | Where-Object { $ids -contains $_.ProcessId } | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath,CommandLine) | ConvertTo-Json -Compress'],{encoding:'utf8',windowsHide:true});
if(ps.status!==0)throw Error(ps.stderr); fs.writeFileSync(ready,ps.stdout); }
setInterval(()=>{},1000);\n`);
  fs.writeFileSync(dispatcher, `import {runNodeFixtureCases} from ${JSON.stringify(library)};
const result=await runNodeFixtureCases([[${JSON.stringify(tree)},'parent',process.argv[2],process.argv[3]],['-e',${JSON.stringify("require('fs').writeFileSync(process.argv[1],'forbidden')")},process.argv[4]]],{cwd:process.cwd()});
process.exitCode=result.exit_code||1;\n`);
  const foreign = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore", windowsHide: true });
  const foreignClosed = new Promise(resolve => foreign.once("close", resolve));
  try {
    const foreignBefore = identities([foreign.pid]); assert.equal(foreignBefore.length, 1);
    // Both commands use the same production supervisor as the family runner.
    // The second kills its supervisor with the real Windows TerminateProcess
    // behavior, bypassing JS signal handlers and exercising helper pipe EOF.
    for (const mode of ["deadline", "cancellation", "supervisor_death", "synchronous_caller_death"]) {
      const dir = fs.mkdtempSync(path.join(path.dirname(base), "aidn-tree-" + mode + "-"));
      const log = path.join(dir, "roles.jsonl"), ready = path.join(dir, "before.json"), forbidden = path.join(dir, "forbidden");
      let receipt;
      if (mode === "deadline") {
        const result = runOwnedVerificationCommandSync({ command: process.execPath,
          args: ["relative-dispatcher.mjs", log, ready, forbidden], cwd: base,
          env: { ...process.env, AIDN_VERIFICATION_EVIDENCE_ROOT: dir }, timeoutMs: 12000, maxBuffer: 1048576 });
        assert.ok(["ETIMEDOUT", "PROCESS_FAILED"].includes(result.error?.code), JSON.stringify(result));
        const ended = JSON.parse(fs.readFileSync(path.join(result.verification_process.evidence_dir, "result.json"), "utf8"));
        assert.equal(ended.deadline_exceeded, true);
        assert.equal(result.verification_process.cleanup.state, "confirmed");
        assert.equal(result.verification_process.cleanup.proof.active_processes, 0);
        receipt = result.verification_process;
      } else if (mode === "cancellation") {
        const cancellation = new AbortController(), env = { ...process.env };
        delete env.AIDN_VERIFICATION_SUPERVISOR_PID;
        const run = runNodeFixtureCases([[tree, "parent", log, ready], ["-e", "require('fs').writeFileSync(process.argv[1],'forbidden')", forbidden]],
          { cwd: base, env, signal: cancellation.signal, evidenceRoot: dir });
        try { await waitFor(ready); }
        finally { cancellation.abort(); }
        const result = await run; assert.equal(result.signal, "SIGTERM"); assert.equal(result.completed, 0);
        const evidence = path.join(dir, fs.readdirSync(dir).find(name => name.startsWith("aidn-verification-")), "001");
        receipt = JSON.parse(fs.readFileSync(path.join(evidence, "result.json"), "utf8"));
        assert.equal(receipt.cleanup.state, "confirmed"); assert.equal(receipt.cleanup.proof.active_processes, 0);
      } else if (mode === "synchronous_caller_death") {
        const callerFile = path.join(base, "synchronous caller.mjs");
        fs.writeFileSync(callerFile, `import {runOwnedVerificationCommandSync} from ${JSON.stringify(new URL("../verify/owned-verification-process-lib.mjs", import.meta.url).href)};
const result=runOwnedVerificationCommandSync({command:process.execPath,args:['relative-dispatcher.mjs',...process.argv.slice(2,5)],cwd:process.cwd(),env:{...process.env,AIDN_VERIFICATION_EVIDENCE_ROOT:process.argv[5]},timeoutMs:30000,maxBuffer:1048576});
process.exitCode=result.error?1:0;\n`);
        const caller = spawn(process.execPath, [callerFile, log, ready, forbidden, dir], { cwd: base, stdio: "ignore", shell: false, windowsHide: true });
        const closed = new Promise(resolve => caller.once("close", resolve));
        const callerBefore = identities([caller.pid]);
        try { await waitFor(ready, caller); }
        finally { caller.kill(); await closed; }
        receipt = { synchronous_caller_pid: caller.pid, caller_before: callerBefore, caller_after: identities([caller.pid]),
          evidence_dir: dir, caller_death: true, cleanup: "observe_exact_identities_below" };
        assert.deepEqual(receipt.caller_after.filter(row => callerBefore.some(old => old.ProcessId === row.ProcessId && old.CreationDate === row.CreationDate)), []);
      } else {
        const evidenceDir = path.join(dir, "supervisor"); fs.mkdirSync(evidenceDir);
        const supervisor = spawn(process.execPath, [source, "--supervise"], { cwd: base, stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
        const closed = new Promise(resolve => supervisor.once("close", resolve));
        supervisor.stdin.end(JSON.stringify({ command: process.execPath, args: ["relative-dispatcher.mjs", log, ready, forbidden], cwd: base,
          deadlineAt: Date.now() + 30000, maxOutputBytes: 1048576, evidenceDir, caller: verificationCallerIdentity() }));
        try { await waitFor(ready, supervisor); }
        finally { supervisor.kill(); await closed; }
        receipt = { evidence_dir: evidenceDir, supervisor_pid: supervisor.pid, supervisor_death: true, cleanup: "observe_exact_identities_below" };
      }
      assert.ok(fs.existsSync(ready), "real three-generation tree was not observed");
      const before = JSON.parse(fs.readFileSync(ready, "utf8")); assert.ok(before.length >= (mode === "cancellation" ? 5 : 6), "complete helper/dispatcher/three-generation tree");
      const roles = fs.readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
      assert.deepEqual(roles.map(row => row.role), ["parent", "child", "grandchild"]);
      assert.equal(roles[1].ppid, roles[0].pid); assert.equal(roles[2].ppid, roles[1].pid);
      for (const row of before) assert.ok(row.CreationDate && row.CommandLine && row.ExecutablePath);
      let after, same;
      const until = Date.now() + 10000;
      do { after = identities(before.map(row => row.ProcessId));
        same = after.filter(row => before.some(old => old.ProcessId === row.ProcessId && old.CreationDate === row.CreationDate));
        if (same.length) await delay(100);
      } while (same.length && Date.now() < until);
      assert.deepEqual(same, [], "owned process identities survived");
      assert.equal(fs.existsSync(forbidden), false, "dispatcher allocated another case after stop");
      const foreignAfter = identities([foreign.pid]); assert.deepEqual(foreignAfter, foreignBefore);
      fs.writeFileSync(path.join(dir, "os-proof.json"), JSON.stringify({ mode, receipt, roles, before, after,
        same_identities_alive: same, forbidden_allocated: false, foreign_before: foreignBefore, foreign_after: foreignAfter }, null, 2));
      console.log("PASS Windows " + mode + ": exact parent/child/grandchild identities stopped; no next allocation; foreign identity unchanged");
    }
  } finally { foreign.kill(); await foreignClosed; }
}
