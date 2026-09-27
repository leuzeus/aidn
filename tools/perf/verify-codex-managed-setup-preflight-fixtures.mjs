import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// These fixtures parse the real script, load its function definitions only,
// compile its native declarations, and inject in-memory observations. The
// script entry point and all P/Invoke methods remain unexecuted.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'src/adapters/agents/process-tree/codex-managed-setup-preflight.ps1');
const checks = [];
const check = (name, action) => { try { action(); checks.push({ name, status: 'PASS' }); } catch (error) { checks.push({ name, status: 'FAIL', detail: String(error.message).slice(0, 400) }); } };
const source = fs.readFileSync(script, 'utf8');
check('no-mutating-native-api-or-shell-elevation', () => {
  assert.doesNotMatch(source, /\b(?:CreateProcess\w*|ShellExecute\w*|AdjustToken\w*|TerminateProcess|TerminateJobObject|SetTokenInformation|Start-Process|RunAs|SeDebugPrivilege)\b/u);
  assert.doesNotMatch(source, /\b(?:WindowsIdentity|CheckTokenMembership|GetCurrentProcess|Get-CimInstance|Get-WmiObject)\b/u);
});
check('all-native-imports-use-system32-search', () => {
  const imports = source.match(/\[DllImport\([^\n]+/gu) ?? [];
  assert.equal(imports.length, 12);
  for (const entry of imports) assert.match(entry, /DefaultDllImportSearchPaths\(DllImportSearchPath\.System32\)/u);
  assert.ok(imports.every(entry => /"(?:kernel32|advapi32)\.dll"/u.test(entry)));
});
check('bounded-identity-job-and-helper-native-operations', () => {
  assert.match(source, /OpenProcess\(Query\|Synchronize,false,pid\)/u);
  assert.match(source, /OpenProcessToken\(process,8,out token\)/u);
  assert.match(source, /OpenJobObjectW\(4,false,jobName\)/u);
  assert.match(source, /IsProcessInJob\(process,job,out member\)/u);
  assert.match(source, /CreateToolhelp32Snapshot\(2,0\)/u);
  assert.match(source, /if\(\+\+count>32768\)/u);
  assert.match(source, /if\(rows\.Count>=32\)/u);
  assert.match(source, /String\.Equals\(entry\.name,"codex-windows-sandbox-setup\.exe",StringComparison\.OrdinalIgnoreCase\)/u);
  assert.match(source, /DateTime\.FromFileTimeUtc\([^\n]+ToString\("o",CultureInfo\.InvariantCulture\)/u);
  assert.equal((source.match(/UtcNow\.ToString\("yyyy-MM-dd'T'HH:mm:ss\.fff'Z'"/gu) ?? []).length, 2);
});

if (process.platform !== 'win32') {
  console.log(JSON.stringify({ status: 'UNAVAILABLE', native_providers: 'NOT_RUN', checks, errors: ['WINDOWS_POWERSHELL_7_REQUIRED'] }, null, 2));
  process.exit(1);
}
const programFiles = process.env.ProgramFiles;
const pwsh = programFiles && path.join(programFiles, 'PowerShell', '7', 'pwsh.exe');
if (!pwsh || !fs.existsSync(pwsh)) {
  console.log(JSON.stringify({ status: 'UNAVAILABLE', native_providers: 'NOT_RUN', checks, errors: ['POWERSHELL_7_UNAVAILABLE'] }, null, 2));
  process.exit(1);
}
const harness = String.raw`
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
$tokens=$null; $parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($env:AIDN_PREFLIGHT_FIXTURE_SOURCE,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count) { throw 'FIXTURE_SOURCE_PARSE_FAILED' }
$definitions=$ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$false)
. ([ScriptBlock]::Create(($definitions.Extent.Text -join [Environment]::NewLine)))
$script:checks=[Collections.Generic.List[object]]::new()
function Check([string]$name,[scriptblock]$body) {
  try { & $body; $script:checks.Add(@{name=$name;status='PASS'}) }
  catch { $script:checks.Add(@{name=$name;status='FAIL';detail=$_.Exception.GetBaseException().Message.Substring(0,[Math]::Min(300,$_.Exception.GetBaseException().Message.Length))}) }
}
function Equal($a,$b) { if($a -cne $b) { throw 'FIXTURE_ASSERTION' } }
function Reject([scriptblock]$action,[string]$code) {
  try { & $action; throw 'FIXTURE_EXPECTED_REFUSAL' }
  catch { Equal $_.Exception.GetBaseException().Message ('PREFLIGHT_'+$code) }
}
function Request([string]$phase='before_resume') {
  $r=@{contract_version='aidn-managed-setup-preflight-request.v1';request_sha256=('a'*64);phase=$phase;
    launcher=@{pid=[long]41;started_at='2026-09-27T10:00:00.1234567Z'};
    target=@{pid=[long]42;started_at='2026-09-27T10:00:01.7654321Z';job_name=('Local\aidn-execution-'+('b'*32))};max_duration_ms=[long]5000}
  if($phase -ceq 'before_create') { $r.target=$null }
  if($phase -ceq 'inside_bridge') { $r.launcher.pid=[long]42; $r.launcher.started_at=$null; $r.target.started_at=$null }
  return $r
}
function Json($r) { ConvertTo-Json -InputObject $r -Depth 8 -Compress }
function Observe($identity,$job) {
  $started=$identity.started_at; if($null -eq $started) { $started='2026-09-27T10:00:01.7654321Z' }
  return @{pid=[uint32]$identity.pid;started_at=$started;elevated=$true;admin_enabled=$true;integrity_sid='S-1-16-12288';
    elevation_type=2;token_type=1;has_restrictions=$false;restricted_sid_count=0;is_app_container=$false;
    job_name=$job;job_member=$(if($null -eq $job){$null}else{$true})}
}
function Run($request,$observe={param($i,$j,$remaining) Observe $i $j},$helpers={param($remaining) return ,@()}) {
  $script:ticks=[long]0; $script:calls=0
  $clock=@{elapsed={$script:ticks};utc={'2026-09-27T10:00:03.000Z'}}
  return Invoke-SetupPreflight $request @{observe=$observe;helpers=$helpers} $clock 0
}
function Refused($result,[string]$code) { Equal $result.status 'REFUSED'; if($result.errors -cnotcontains ('PREFLIGHT_'+$code)) { throw 'FIXTURE_EXPECTED_CODE' } }
Check 'native-csharp-compiles-without-invoking-any-provider' { $null=Add-Type -TypeDefinition (Get-SetupPreflightNativeSource) -ErrorAction Stop }
foreach($phase in @('before_create','before_resume','inside_bridge')) {
  Check ('valid-request-'+$phase) { $r=ConvertFrom-SetupPreflightJson (Json (Request $phase)); Equal $r.phase $phase }
  Check ('observed-'+$phase+'-with-fake-provider-only') { $r=Run (Request $phase); Equal $r.status 'OBSERVED'; Equal $r.helpers.complete $true; Equal $r.helpers.rows.Count 0; Equal $r.errors.Count 0; Equal $r.phase $phase }
}
Check 'base64-is-input-only-no-request-file-created' { $text=Json (Request); $r=Read-SetupPreflightRequest '' ([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text))); Equal $r.phase 'before_resume' }
Check 'base64-input-mutual-exclusion' { Reject { Read-SetupPreflightRequest 'C:\fixture\r.json' 'e30=' } 'REQUEST_INVALID' }
Check 'base64-input-required' { Reject { Read-SetupPreflightRequest '' '' } 'REQUEST_INVALID' }
Check 'base64-noncanonical-whitespace-refused' { Reject { Read-SetupPreflightRequest '' ' e30=' } 'REQUEST_INVALID' }
Check 'base64-invalid-refused' { Reject { Read-SetupPreflightRequest '' '%' } 'REQUEST_INVALID' }
Check 'base64-byte-cap' { Reject { Read-SetupPreflightRequest '' ('A'*87385) } 'REQUEST_LIMIT' }
Check 'invalid-utf8-refused' { Reject { Read-SetupPreflightRequest '' ([Convert]::ToBase64String([byte[]]@(255))) } 'REQUEST_INVALID' }
Check 'request-limit-counts-utf8-bytes' { Reject { ConvertFrom-SetupPreflightJson ('é'*32769) } 'REQUEST_LIMIT' }
foreach($text in @('{}{}','[]','{','{"a":1,"a":2}','{"a":1,"A":2}','{"a":1,"\u0061":2}')) {
  Check ('invalid-json-'+$text) { Reject { ConvertFrom-SetupPreflightJson $text } 'REQUEST_INVALID' }
}
$mutations=@{
  'unknown-root'={param($r) $r.extra=1}; 'wrong-contract'={param($r) $r.contract_version='v0'};
  'wrong-hash'={param($r) $r.request_sha256='A'*64}; 'wrong-phase'={param($r) $r.phase='setup'};
  'unknown-launcher'={param($r) $r.launcher.extra=1}; 'unknown-target'={param($r) $r.target.extra=1};
  'pid-zero'={param($r) $r.launcher.pid=0}; 'pid-negative'={param($r) $r.launcher.pid=-1};
  'pid-overflow'={param($r) $r.launcher.pid=[long]4294967296}; 'pid-string'={param($r) $r.launcher.pid='41'};
  'pid-fraction'={param($r) $r.launcher.pid=41.5}; 'unknown-limit'={param($r) $r.max_duration_ms=5001};
  'string-limit'={param($r) $r.max_duration_ms='5000'}; 'rounded-launcher-date'={param($r) $r.launcher.started_at='2026-09-27T10:00:00.123Z'};
  'impossible-date'={param($r) $r.launcher.started_at='2026-02-30T10:00:00.1234567Z'};
  'null-before-resume-date'={param($r) $r.target.started_at=$null}; 'unscoped-job'={param($r) $r.target.job_name='other'};
  'uppercase-job'={param($r) $r.target.job_name='Local\aidn-execution-'+('B'*32)}
}
foreach($entry in $mutations.GetEnumerator()) { Check ('request-refuses-'+$entry.Key) { $r=Request; & $entry.Value $r; Reject { ConvertFrom-SetupPreflightJson (Json $r) } 'REQUEST_INVALID' } }
Check 'before-create-target-not-allowed' { $r=Request; $r.phase='before_create'; Reject { ConvertFrom-SetupPreflightJson (Json $r) } 'REQUEST_INVALID' }
Check 'before-create-null-launcher-date-refused' { $r=Request 'before_create'; $r.launcher.started_at=$null; Reject { ConvertFrom-SetupPreflightJson (Json $r) } 'REQUEST_INVALID' }
Check 'inside-bridge-different-pid-refused' { $r=Request 'inside_bridge'; $r.launcher.pid=[long]41; Reject { ConvertFrom-SetupPreflightJson (Json $r) } 'REQUEST_INVALID' }
Check 'inside-bridge-preknown-date-refused' { $r=Request 'inside_bridge'; $r.launcher.started_at='2026-09-27T10:00:00.1234567Z'; Reject { ConvertFrom-SetupPreflightJson (Json $r) } 'REQUEST_INVALID' }
Check 'full-filetime-difference-refused-not-rounded-to-ms' { $r=Run (Request) {param($i,$j,$remaining) $r=Observe $i $j; $r.started_at='2026-09-27T10:00:00.1234568Z'; $r }; Refused $r 'OBSERVATION_INVALID' }
Check 'inside-bridge-observed-creations-must-match' { $r=Run (Request 'inside_bridge') {param($i,$j,$remaining) $r=Observe $i $j; if($null -ne $j){$r.started_at='2026-09-27T10:00:01.7654322Z'}; $r }; Refused $r 'PROCESS_IDENTITY_MISMATCH' }
foreach($code in @('ACCESS_DENIED','PROCESS_NOT_ALIVE','PROCESS_IDENTITY_MISMATCH','TOKEN_QUERY_INVALID','NATIVE_QUERY_FAILED')) {
  Check ('provider-error-'+$code) { $script:providerCode=$code; $r=Run (Request) {param($i,$j,$remaining) Stop-SetupPreflight $script:providerCode}; Refused $r $code; Equal $r.helpers.complete $false }
}
Check 'provider-private-error-redacted' { $r=Run (Request) {param($i,$j,$remaining) throw 'private-path-user-secret'}; Refused $r 'NATIVE_PROVIDER_UNAVAILABLE'; if((Json $r).Contains('private')){throw 'FIXTURE_LEAK'} }
$tokenChanges=@{
  'not-elevated'={param($r) $r.elevated=$false}; 'admin-deny-only'={param($r) $r.admin_enabled=$false};
  'medium-integrity'={param($r) $r.integrity_sid='S-1-16-8192'}; 'system-integrity'={param($r) $r.integrity_sid='S-1-16-16384'};
  'filtered'={param($r) $r.has_restrictions=$true}; 'restricted-sids'={param($r) $r.restricted_sid_count=1};
  'app-container'={param($r) $r.is_app_container=$true}; 'impersonation-token'={param($r) $r.token_type=2}
}
foreach($entry in $tokenChanges.GetEnumerator()) {
  Check ('launcher-refuses-'+$entry.Key) { $script:change=$entry.Value; $r=Run (Request) {param($i,$j,$remaining) $r=Observe $i $j; if($null -eq $j){& $script:change $r}; $r }; Refused $r 'LAUNCHER_TOKEN_REFUSED' }
  Check ('target-refuses-'+$entry.Key) { $script:change=$entry.Value; $r=Run (Request) {param($i,$j,$remaining) $r=Observe $i $j; if($null -ne $j){& $script:change $r}; $r }; Refused $r 'TARGET_TOKEN_REFUSED' }
}
Check 'default-elevation-type-with-real-high-admin-flags-accepted' { $r=Run (Request) {param($i,$j,$remaining) $r=Observe $i $j; $r.elevation_type=1; $r }; Equal $r.status 'OBSERVED' }
Check 'target-outside-exact-job-refused' { $r=Run (Request) {param($i,$j,$remaining) $r=Observe $i $j; if($null -ne $j){$r.job_member=$false}; $r }; Refused $r 'TARGET_JOB_REFUSED' }
Check 'unknown-observation-field-refused' { $r=Run (Request) {param($i,$j,$remaining) $r=Observe $i $j; $r.extra=1; $r }; Refused $r 'OBSERVATION_INVALID' }
Check 'malformed-observation-boolean-refused' { $r=Run (Request) {param($i,$j,$remaining) $r=Observe $i $j; $r.elevated='true'; $r }; Refused $r 'OBSERVATION_INVALID' }
Check 'string-enum-refused' { $r=Run (Request) {param($i,$j,$remaining) $r=Observe $i $j; $r.token_type='1'; $r }; Refused $r 'OBSERVATION_INVALID' }
foreach($phase in @('before_create','before_resume','inside_bridge')) {
  Check ('existing-helper-refused-'+$phase) { $r=Run (Request $phase) -helpers {param($remaining) return ,@(@{pid=[uint32]43;started_at='2026-09-27T10:00:00.1234567Z'})}; Refused $r 'HELPER_PRESENT'; Equal $r.helpers.complete $true; Equal $r.helpers.rows.Count 1 }
}
Check 'helper-access-denied-never-absent' { $r=Run (Request) -helpers {param($remaining) Stop-SetupPreflight 'ACCESS_DENIED'}; Refused $r 'ACCESS_DENIED'; Equal $r.helpers.complete $false }
Check 'helper-enumeration-incomplete-never-absent' { $r=Run (Request) -helpers {param($remaining) Stop-SetupPreflight 'PROCESS_ENUMERATION_INCOMPLETE'}; Refused $r 'PROCESS_ENUMERATION_INCOMPLETE'; Equal $r.helpers.complete $false }
Check 'helper-limit-never-success' { $r=Run (Request) -helpers {param($remaining) Stop-SetupPreflight 'HELPER_LIMIT'}; Refused $r 'HELPER_LIMIT'; Equal $r.helpers.complete $false }
Check 'malformed-helper-array-refused' { $r=Run (Request) -helpers {param($remaining) @{pid=43;started_at='2026-09-27T10:00:00.1234567Z'}}; Refused $r 'OBSERVATION_INVALID' }
Check 'duplicate-helper-identity-refused' { $r=Run (Request) -helpers {param($remaining) return ,@(@{pid=43;started_at='2026-09-27T10:00:00.1234567Z'},@{pid=43;started_at='2026-09-27T10:00:00.1234567Z'})}; Refused $r 'OBSERVATION_INVALID' }
Check 'deadline-after-observe-stops-next-provider' { $r=Run (Request) {param($i,$j,$remaining) $script:calls++; $script:ticks=5000; Observe $i $j}; Refused $r 'DEADLINE_EXCEEDED'; Equal $script:calls 1; Equal $r.helpers.complete $false }
Check 'late-helper-result-refused' { $r=Run (Request) -helpers {param($remaining) $script:ticks=5001; return ,@()}; Refused $r 'DEADLINE_EXCEEDED'; Equal $r.helpers.complete $false }
Check 'expired-before-first-provider-no-query' { $script:ticks=5000; $script:calls=0; $r=Invoke-SetupPreflight (Request) @{observe={$script:calls++;throw 'not-called'};helpers={throw 'not-called'}} @{elapsed={$script:ticks};utc={'2026-09-27T10:00:03.000Z'}} 0; Refused $r 'DEADLINE_EXCEEDED'; Equal $script:calls 0 }
Check 'clock-going-backwards-refused' { $script:ticks=-1; $r=Invoke-SetupPreflight (Request) @{observe={throw 'not-called'};helpers={throw 'not-called'}} @{elapsed={$script:ticks};utc={'2026-09-27T10:00:03.000Z'}} 0; Refused $r 'DEADLINE_EXCEEDED' }
Check 'output-is-one-closed-json-document-with-no-native-qualification' {
  $r=Run (Request); $s=Json $r; $round=ConvertFrom-Json $s -AsHashtable
  if(!(Test-SetupPreflightFields $round @('contract_version','request_sha256','phase','observed_at','status','launcher','target','helpers','errors'))){throw 'FIXTURE_OUTPUT_FIELDS'}
  Equal $round.request_sha256 ('a'*64); Equal $round.contract_version 'aidn-managed-setup-preflight.v1'
}
[Console]::Out.WriteLine((ConvertTo-Json -InputObject @($script:checks.ToArray()) -Depth 8 -Compress))
if(@($script:checks | Where-Object status -ceq 'FAIL').Count){exit 1}
exit 0
`;
const run = spawnSync(pwsh, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '& ([scriptblock]::Create([Console]::In.ReadToEnd()))'], {
  input: harness, cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true,
  env: { ...process.env, AIDN_PREFLIGHT_FIXTURE_SOURCE: script, POWERSHELL_UPDATECHECK: 'Off', POWERSHELL_TELEMETRY_OPTOUT: '1', TERM: 'dumb' },
});
check('powershell-harness-produced-one-json-document', () => {
  assert.equal(run.error, undefined, run.error?.code);
  assert.equal(run.stderr.trim(), '', run.stderr.slice(0, 500));
  const rows = JSON.parse(run.stdout.trim());
  assert.ok(Array.isArray(rows) && rows.length >= 70);
  checks.push(...rows);
  assert.equal(run.status, 0, 'PowerShell fixture assertions failed');
});
const failed = checks.filter(row => row.status !== 'PASS');
console.log(JSON.stringify({ status: failed.length ? 'FAIL' : 'PASS', checks, native_providers: 'NOT_RUN', setup: 'NOT_RUN', uac: 'NOT_RUN' }, null, 2));
if (failed.length) process.exitCode = 1;
