// Audit-only reproduction: run from the package source root. Windows fixture.
// No client root/global Codex config is modified. No LLM is called.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const repo = process.cwd();
const start = Date.now();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-codex-preserve-spike-'));
let result;
try {
 const target = path.join(temp, 'projet témoin avec espaces');
 const stub = path.join(temp, 'stub');
 fs.mkdirSync(stub);
 fs.writeFileSync(path.join(stub, 'codex.cmd'), '@echo off\r\nif "%1"=="login" if "%2"=="status" echo Logged in\r\nexit /b 0\r\n');
 const fixtures = {
  'AGENTS.md': '# Custom client instructions\nPreserve this policy.\n',
  '.codex/hooks.json': JSON.stringify({version:1,hooks:{SessionStart:[{hooks:[{type:'command',command:'echo THIRD_PARTY_SESSION'}]}],Stop:[{hooks:[{type:'command',command:'echo THIRD_PARTY_STOP'}]}]}}),
  '.codex/config.toml': '# third-party MCP settings sentinel\n',
  '.agents/skills/third-party/SKILL.md': '# THIRD_PARTY_SKILL\n',
  '.codex/agents/third-party.toml': 'name = "third-party"\n',
  '.agents/skills/context-reload/SKILL.md': '# USER_MODIFIED_AIDN_SKILL\n'
 };
 for (const [relative,value] of Object.entries(fixtures)) {
  const file=path.join(target,relative); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,value);
 }
 const env={...process.env,PATH:stub+path.delimiter+process.env.PATH};
 const args=['tools/install.mjs','--target',target,'--pack','core','--init-defaults','--project-name','fixture','--source-branch','dev','--skip-artifact-import','--no-codex-migrate-custom'];
 const run=()=>spawnSync(process.execPath,args,{cwd:repo,env,encoding:'utf8',timeout:60000,windowsHide:true});
 const first=run();
 if(first.status!==0) throw new Error('first install failed: '+String(first.stderr).slice(-1500));
 const bytes=Object.fromEntries(Object.keys(fixtures).map(p=>[p,fs.readFileSync(path.join(target,p),'utf8')]));
 const second=run();
 if(second.status!==0) throw new Error('reinstall failed: '+String(second.stderr).slice(-1500));
 const hooks=JSON.parse(bytes['.codex/hooks.json']);
 result={proof_class:'temporary-client-fixture',platform:process.platform,node:process.version,install_exit:first.status,reinstall_exit:second.status,checks:{custom_agents_preserved:bytes['AGENTS.md']===fixtures['AGENTS.md'],third_party_hooks_preserved:bytes['.codex/hooks.json'].includes('THIRD_PARTY'),config_toml_preserved:bytes['.codex/config.toml']===fixtures['.codex/config.toml'],third_party_skill_preserved:bytes['.agents/skills/third-party/SKILL.md']===fixtures['.agents/skills/third-party/SKILL.md'],third_party_role_preserved:bytes['.codex/agents/third-party.toml']===fixtures['.codex/agents/third-party.toml'],modified_aidn_skill_preserved:bytes['.agents/skills/context-reload/SKILL.md']===fixtures['.agents/skills/context-reload/SKILL.md'],reinstall_files_identical:Object.keys(bytes).every(p=>bytes[p]===fs.readFileSync(path.join(target,p),'utf8')),spaces_accents_install:true},hook_events:Object.keys(hooks.hooks),session_start_count:hooks.hooks.SessionStart.length};
} finally {
 const resolved=path.resolve(temp); const base=path.resolve(os.tmpdir());
 if(!resolved.startsWith(base+path.sep)||!path.basename(resolved).startsWith('aidn-codex-preserve-spike-')) throw new Error('cleanup boundary mismatch');
 fs.rmSync(resolved,{recursive:true,force:true});
 if(result){result.temp_removed=!fs.existsSync(resolved);result.duration_ms=Date.now()-start;}
}
// Observation harness: exit 0 means collection completed, not all checks passed.
console.log(JSON.stringify(result,null,2));
