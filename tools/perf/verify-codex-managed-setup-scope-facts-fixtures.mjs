import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { fingerprintAgentExecutionValue } from "../../src/core/agents/agent-execution-contracts.mjs";

// Physical reads cover disposable files and their ancestors only. Full profile
// traversal uses fake providers; no Codex, elevation or principal profile probe.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(root, "tools/verify/codex-managed-setup-scope-facts.ps1");
const source = fs.readFileSync(script, "utf8"), checks = [];
function check(name, action) { try { action(); checks.push({ name, status: "PASS" }); }
  catch (error) { checks.push({ name, status: "FAIL", detail: String(error.message).slice(0, 1500) }); } }
check("only fixed read APIs and System32 DLL resolution", () => {
  assert.match(source, /\[assembly:DefaultDllImportSearchPaths\(DllImportSearchPath\.System32\)\]/u);
  const imports = [...source.matchAll(/\[DllImport\("([^"]+)"[^\n]*\)\]\r?\n\s*static extern \S+ (\w+)/gu)];
  assert.deepEqual(imports.map(row => row[1]), Array(6).fill("kernel32.dll"));
  assert.deepEqual(imports.map(row => row[2]), ["CreateFileW", "GetFileInformationByHandleEx", "GetFileInformationByHandle", "GetFinalPathNameByHandleW", "DeviceIoControl", "GetDriveTypeW"]);
  assert.match(source, /DeviceIoControl\(handle,0x000900A8,IntPtr\.Zero,0,/u);
  assert.match(source, /GetFileInformationByHandleEx\(handle,18,out id,/u);
  assert.match(source, /GetFileInformationByHandle\(handle,out basic\)/u);
  assert.doesNotMatch(source, /\b(?:WriteFile|SetFileInformation|SetNamedSecurityInfo|AdjustTokenPrivileges|Start-Process|RunAs|Invoke-Expression|Set-Content|Remove-Item)\b/u);
});
check("request, output, traversal and shared clock are bounded", () => {
  for (const text of ["memory.Length+$count -gt 65536", "GetByteCount($json)+2 -gt 2097152",
    "visited.Count -gt 4097", "item.depth -gt 32", "junctions.Count -ge 32",
    "firstWitness -cne $secondWitness", "(Scope-Hash $first) -cne (Scope-Hash $second)"]) assert(source.includes(text), text);
  assert.doesNotMatch(source, /\.CopyTo\(/u);
});
const pwsh = process.env.ProgramFiles && path.join(process.env.ProgramFiles, "PowerShell/7/pwsh.exe");
if (process.platform !== "win32" || !pwsh || !fs.existsSync(pwsh)) {
  console.log(JSON.stringify({ status: "UNAVAILABLE", checks, errors: ["WINDOWS_POWERSHELL_7_REQUIRED"], setup: "NOT_RUN" }));
  process.exit(1);
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-scope-facts-fixture-"));
const allowedParent = fs.realpathSync(os.tmpdir()), expectedRoot = path.resolve(temporary);
const harness = String.raw`
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
$tokens=$null; $parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($env:AIDN_SCOPE_FIXTURE_SOURCE,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count) { throw 'SOURCE_PARSE_FAILED' }
$definitions=@($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.FunctionDefinitionAst] })
. ([ScriptBlock]::Create(($definitions.Extent.Text -join [Environment]::NewLine)))
$assignment=$ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text -ceq '$script:ScopeNativeSource' }
$nativeSource=$assignment.Right.Find({param($node) $node -is [Management.Automation.Language.StringConstantExpressionAst]},$true).Value
$script:Utf8=[Text.UTF8Encoding]::new($false,$true)
$script:BudgetMs=60000; $script:Clock=[Diagnostics.Stopwatch]::StartNew(); $script:ScopeRequestParameterSetName='Base64'
$script:checks=[Collections.Generic.List[object]]::new(); $script:measurements=@{}
function Check([string]$Name,[scriptblock]$Body) {
    try { & $Body; $script:checks.Add(@{name=$Name;status='PASS'}) }
    catch { $cause=$_.Exception.GetBaseException(); $script:checks.Add(@{name=$Name;status='FAIL';detail=$cause.Message;win32_error=$cause.Data['win32_error']}) }
}
function Equal($a,$b) { if($a -cne $b) { throw "ASSERT:$a != $b" } }
function Reject([scriptblock]$body,[string]$code) { try { & $body; throw 'EXPECTED_REFUSAL' } catch { Equal $_.Exception.GetBaseException().Message $code } }
function Roots { return @{cwd='C:\work';profile_root='C:\profile';candidate_root='C:\candidate';user_profile='C:\user';local_app_data='C:\user\AppData\Local';startup_directories=@('C:\state')} }
function Request {
    $r=[ordered]@{contract_version='aidn-managed-setup-scope-facts-request.v1';observer_context_sha256=('a'*64);roots=(Roots);max_duration_ms=45000}
    $r.request_sha256=Scope-Hash $r; return $r
}
function Read-RequestFixture($value) {
    $script:RequestBase64=[Convert]::ToBase64String($script:Utf8.GetBytes((ConvertTo-Json -InputObject $value -Depth 10 -Compress)))
    return Read-ScopeRequest
}
Check 'native CSharp compiles' { Add-Type -TypeDefinition $nativeSource -ErrorAction Stop }
Check 'canonical Unicode quoting and integer hash match the Node contract' {
    $value=ConvertFrom-Json -InputObject ($script:Utf8.GetString([Convert]::FromBase64String($env:AIDN_SCOPE_FIXTURE_UNICODE))) -AsHashtable
    Equal (Scope-Hash $value) $env:AIDN_SCOPE_FIXTURE_UNICODE_SHA256
    Equal ([AidnScopeNative]::Quote([string][char]0xd800)) '"\ud800"'
    Equal ([AidnScopeNative]::Quote([string][char]0xdc00)) '"\udc00"'
}
Check 'request canonical hash round trip' { $r=Request; Equal (Read-RequestFixture $r).request_sha256 $r.request_sha256 }
Check 'request rejects foreign hash' { $r=Request; $r.request_sha256='b'*64; Reject { Read-RequestFixture $r } 'SCOPE_REQUEST_HASH_MISMATCH' }
Check 'request rejects extra roots' { $r=Request; $r.roots.extra='C:\other'; Reject { Read-RequestFixture $r } 'SCOPE_REQUEST_INVALID' }
Check 'request rejects duration over 60 seconds' { $r=Request; $r.max_duration_ms=60001; Reject { Read-RequestFixture $r } 'SCOPE_LIMIT_INVALID' }
Check 'request rejects more than 16 startup directories' { $r=Request; $r.roots.startup_directories=@(1..17 | ForEach-Object { 'C:\d'+$_ }); Reject { Read-RequestFixture $r } 'SCOPE_REQUEST_INVALID' }
$scratch=$env:AIDN_SCOPE_FIXTURE_ROOT
Check 'native FileIdInfo and same-handle link count' {
    [AidnScopeNative]::Start(45000); [AidnScopeNative]::BeginPass()
    $row=[AidnScopeNative]::Read(($scratch+'\one.txt'),$false,$false)
    Equal $row.State 'present'; Equal $row.ObjectType 'file'; Equal $row.LinkCount 1
    if($row.VolumeId -cnotmatch '^[a-f0-9]{16}$' -or $row.FileId -cnotmatch '^[a-f0-9]{32}$') { throw 'NATIVE_ID_INVALID' }
    Equal $row.Path $row.PhysicalPath
}
Check 'native missing file and ancestor are explicit absence' {
    [AidnScopeNative]::BeginPass()
    Equal ([AidnScopeNative]::Read(($scratch+'\missing'),$false,$false)).State 'absent'
    Equal ([AidnScopeNative]::Read(($scratch+'\missing\child'),$false,$false)).State 'absent'
}
Check 'native hard links are refused' { [AidnScopeNative]::BeginPass(); Reject { [AidnScopeNative]::Read(($scratch+'\linked.txt'),$false,$false) } 'SCOPE_LINK_COUNT_UNSUPPORTED' }
Check 'native prior-state content is read on the identity handle' {
    [AidnScopeNative]::BeginPass(); $row=[AidnScopeNative]::Read(($scratch+'\prior.json'),$false,$true)
    Equal $row.Content '{"principals":{}}'
    $expected=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($script:Utf8.GetBytes($row.Content))).ToLowerInvariant()
    Equal $row.ContentHash $expected
}
Check 'native listing enforces an exact row ceiling' {
    [AidnScopeNative]::BeginPass(); Equal ([AidnScopeNative]::List(($scratch+'\listed'),2)).Count 2
    Reject { [AidnScopeNative]::List(($scratch+'\listed'),1) } 'SCOPE_LISTING_LIMIT'
}
Check 'native junction identity is distinct from its target' {
    [AidnScopeNative]::BeginPass(); $link=[AidnScopeNative]::Read(($scratch+'\junction'),$true,$false)
    $target=[AidnScopeNative]::Read(($scratch+'\target'),$false,$false)
    Equal $link.Reparse $true; Equal $link.ReparseTag ([uint32]2684354563); Equal $link.Target ($scratch+'\target')
    if($link.FileId -ceq $target.FileId) { throw 'JUNCTION_ID_IS_TARGET_ID' }; Equal $link.LinkCount $null
}
Check 'native junction ancestor is never followed' { [AidnScopeNative]::BeginPass(); Reject { [AidnScopeNative]::Read(($scratch+'\junction\missing'),$false,$false) } 'SCOPE_REPARSE_UNSUPPORTED' }
Check 'native two-pass witness is deterministic' {
    [AidnScopeNative]::BeginPass(); $null=[AidnScopeNative]::Read(($scratch+'\one.txt'),$false,$false); $a=[AidnScopeNative]::WitnessHash()
    [AidnScopeNative]::BeginPass(); $null=[AidnScopeNative]::Read(($scratch+'\one.txt'),$false,$false); Equal ([AidnScopeNative]::WitnessHash()) $a
}
function NativeRow([string]$p,[string]$type='directory') {
    return @{Path=$p;State='present';ObjectType=$type;PhysicalPath=$p;VolumeId='0000000000000001';FileId=('0'*31)+'1';
        LinkCount=$(if($type -ceq 'file'){1}else{$null});Reparse=$false;ContentHash=$null;Content=$null;Target=$null;ReparseTag=$null}
}
function ResetGraph {
    $script:graph=@{}; $script:listing=@{}
    foreach($p in @('C:\work','C:\profile','C:\candidate','C:\user','C:\state','C:\profile\.sandbox-bin','C:\Windows','C:\Program Files','C:\Program Files (x86)','C:\ProgramData',
        'C:\user\AppData','C:\user\AppData\Local\OpenAI\Codex','C:\user\AppData\Local\OpenAI\Codex\runtimes','C:\user\.cache\codex-runtimes','C:\user\.ssh')) { $script:graph[$p]=NativeRow $p }
    $script:graph['C:\user\note.txt']=NativeRow 'C:\user\note.txt' 'file'
    $script:listing['C:\user']=@('C:\user\AppData','C:\user\note.txt','C:\user\.ssh')
    $script:listing['C:\user\AppData\Local\OpenAI\Codex\runtimes']=@()
}
function Read-PhysicalScopeFact([string]$p,[bool]$allow=$false,[bool]$prior=$false) {
    if($script:graph.ContainsKey($p)) { return $script:graph[$p] }
    return @{Path=$p;State='absent';ObjectType=$null;PhysicalPath=$null;VolumeId=$null;FileId=$null;LinkCount=$null;Reparse=$false;ContentHash=$null;Content=$null;Target=$null;ReparseTag=$null}
}
function Read-PhysicalScopeListing([string]$p,[int]$maximum) {
    if(!$script:listing.ContainsKey($p)) { throw 'MOCK_LISTING_MISSING' }
    if($script:listing[$p].Count -gt $maximum) { Stop-Scope 'SCOPE_LISTING_LIMIT' }
    return ,$script:listing[$p]
}
Check 'scope closure omits excluded ordinary entries and retains exact absence' {
    ResetGraph; $r=Observe-PhysicalScope (Roots)
    Equal @($r.paths | Where-Object path -CEQ 'C:\user\.ssh').Count 0
    Equal @($r.paths | Where-Object path -CEQ 'C:\user\.ssh\config').Count 1
    Equal $r.profile_junctions.Count 0; Equal $r.prior_deny_read_content $null
}
Check 'scope rejects existing SSH config' { ResetGraph; $script:graph['C:\user\.ssh\config']=NativeRow 'C:\user\.ssh\config' 'file'; Reject { Observe-PhysicalScope (Roots) } 'SCOPE_SSH_CONFIG_PRESENT' }
Check 'scope rejects existing cwd metadata' { ResetGraph; $script:graph['C:\work\.git']=NativeRow 'C:\work\.git'; Reject { Observe-PhysicalScope (Roots) } 'SCOPE_CWD_METADATA_PRESENT' }
Check 'scope rejects nonempty prior-state without exposing it' {
    ResetGraph; $p='C:\profile\.sandbox\deny_read_acl_state.json'; $script:graph[$p]=NativeRow $p 'file'; $script:graph[$p].Content='{"principals":{"private":[]}}'
    Reject { Observe-PhysicalScope (Roots) } 'SCOPE_PRIOR_STATE_UNSUPPORTED'
}
Check 'scope records an internal junction and deduplicates its target fact' {
    ResetGraph; $p='C:\user\Compatibility'; $r=NativeRow $p; $r.Reparse=$true; $r.Target='C:\user\AppData'; $r.ReparseTag=[uint32]2684354563; $script:graph[$p]=$r; $script:listing['C:\user']+=,$p
    $out=Observe-PhysicalScope (Roots); Equal $out.profile_junctions.Count 1; Equal @($out.paths | Where-Object path -CEQ 'C:\user\AppData').Count 1
}
Check 'scope rejects an external profile junction' {
    ResetGraph; $p='C:\user\Compatibility'; $r=NativeRow $p; $r.Reparse=$true; $r.Target='C:\foreign'; $script:graph[$p]=$r; $script:listing['C:\user']+=,$p
    Reject { Observe-PhysicalScope (Roots) } 'SCOPE_JUNCTION_OUTSIDE_PROFILE'
}
Check 'scope accepts 4096 runtime descendants with two hashed passes under 40 seconds' {
    ResetGraph; $parent='C:\user\AppData\Local\OpenAI\Codex\runtimes'
    $script:listing[$parent]=@(0..4095 | ForEach-Object { $p=$parent+'\f'+$_; $script:graph[$p]=NativeRow $p 'file'; $p })
    $clock=[Diagnostics.Stopwatch]::StartNew(); $a=Observe-PhysicalScope (Roots); $aHash=Scope-Hash $a
    $b=Observe-PhysicalScope (Roots); Equal (Scope-Hash $b) $aHash
    Equal @($a.paths | Where-Object path -Like ($parent+'\*')).Count 4096
    $script:measurements.mock_4096_two_pass_ms=$clock.ElapsedMilliseconds
    if($clock.ElapsedMilliseconds -ge 40000) { throw 'FIXTURE_40_SECOND_LIMIT' }
    $p=$parent+'\overflow'; $script:graph[$p]=NativeRow $p 'file'; $script:listing[$parent]+=,$p
    Reject { Observe-PhysicalScope (Roots) } 'SCOPE_LISTING_LIMIT'
}
Check 'scope catches an entry disappearing during enumeration' {
    ResetGraph; $script:listing['C:\user\AppData\Local\OpenAI\Codex\runtimes']=@('C:\user\AppData\Local\OpenAI\Codex\runtimes\gone')
    Reject { Observe-PhysicalScope (Roots) } 'SCOPE_LISTING_CHANGED'
}
Check 'scope bounds discovered children before accumulating pending work' {
    ResetGraph; $parent='C:\user\AppData\Local\OpenAI\Codex\runtimes'
    $script:listing[$parent]=@(0..4095 | ForEach-Object { $p=$parent+'\d'+$_; $script:graph[$p]=NativeRow $p; $p })
    $last=$parent+'\d4095'; $script:listing[$last]=@($last+'\one')
    Reject { Observe-PhysicalScope (Roots) } 'SCOPE_RUNTIME_LIMIT'
}
Check 'shared clock refuses late work' { $script:BudgetMs=1; Reject { Check-ScopeTime } 'SCOPE_TIME_LIMIT'; $script:BudgetMs=60000 }
Check 'serialization never reports late facts as observed' {
    $r=@{status='OBSERVED';facts=@{test='value'};facts_sha256=('a'*64);duration_ms=0;errors=@()}
    $script:BudgetMs=1; $json=Convert-ScopeReport $r; $script:BudgetMs=60000
    Equal $r.status 'REFUSED'; Equal $r.facts $null; Equal $r.errors[0].code 'SCOPE_TIME_LIMIT'
}
Check 'output byte ceiling refuses large Unicode facts and discards the content' {
    $r=@{status='OBSERVED';facts=@{test=('é'*1100000)};facts_sha256=('a'*64);duration_ms=0;errors=@()}
    $json=Convert-ScopeReport $r
    Equal $r.status 'REFUSED'; Equal $r.facts $null; Equal $r.errors[0].code 'SCOPE_OUTPUT_LIMIT'
    if($script:Utf8.GetByteCount($json) -gt 4096) { throw 'REFUSAL_RETAINED_OVERSIZE_CONTENT' }
}
[Console]::Out.WriteLine((ConvertTo-Json -InputObject @{checks=@($script:checks);measurements=$script:measurements} -Depth 8 -Compress))
`;
let cleaned = false, measurements = null;
try {
  fs.writeFileSync(path.join(temporary, "one.txt"), "fixture");
  fs.writeFileSync(path.join(temporary, "prior.json"), '{"principals":{}}');
  fs.writeFileSync(path.join(temporary, "linked.txt"), "fixture");
  fs.linkSync(path.join(temporary, "linked.txt"), path.join(temporary, "second-link.txt"));
  fs.mkdirSync(path.join(temporary, "listed"));
  for (const name of ["a", "b"]) fs.writeFileSync(path.join(temporary, "listed", name), "");
  fs.mkdirSync(path.join(temporary, "target"));
  fs.symlinkSync(path.join(temporary, "target"), path.join(temporary, "junction"), "junction");
  const env = Object.fromEntries(["SystemRoot", "WINDIR", "ProgramFiles", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMDATA", "TEMP", "TMP"]
    .filter(name => process.env[name]).map(name => [name, process.env[name]]));
  Object.assign(env, { AIDN_SCOPE_FIXTURE_SOURCE: script, AIDN_SCOPE_FIXTURE_ROOT: temporary,
    PSModuleAnalysisCachePath: path.join(temporary, "powershell-analysis.cache"), POWERSHELL_UPDATECHECK: "Off", POWERSHELL_TELEMETRY_OPTOUT: "1" });
  const unicode = { z: 2684354563, a: ["été", "a/b", 'quote"', "apostrophe'", "a\u2028b", "a\u0085b", "\b\f\r\n\t", "\u0001", "😀"] };
  env.AIDN_SCOPE_FIXTURE_UNICODE = Buffer.from(JSON.stringify(unicode)).toString("base64");
  env.AIDN_SCOPE_FIXTURE_UNICODE_SHA256 = fingerprintAgentExecutionValue(unicode);
  const harnessPath = path.join(temporary, "harness.ps1"); fs.writeFileSync(harnessPath, harness);
  const run = spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", harnessPath], {
    encoding: "utf8", env, timeout: 60000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  check("PowerShell harness returns a JSON document", () => {
    if (run.error) throw run.error;
    assert.equal(run.status, 0, String(run.stderr).slice(0, 1500));
    const report = JSON.parse(run.stdout.trim()); assert(Array.isArray(report.checks));
    checks.push(...report.checks); measurements = report.measurements;
  });
} finally {
  check("temporary corpus cleanup preserves the containing directory", () => {
    assert.equal(path.dirname(expectedRoot).toLowerCase(), allowedParent.toLowerCase());
    assert.equal(fs.realpathSync(temporary).toLowerCase(), expectedRoot.toLowerCase());
    assert(path.basename(temporary).startsWith("aidn-scope-facts-fixture-"));
    const junction = path.join(temporary, "junction");
    if (fs.existsSync(junction)) { assert(fs.lstatSync(junction).isSymbolicLink()); fs.unlinkSync(junction); }
    fs.rmSync(temporary, { recursive: true, force: false });
    assert(!fs.existsSync(temporary)); cleaned = true;
  });
}
const failed = checks.filter(row => row.status === "FAIL");
console.log(JSON.stringify({ ok: failed.length === 0 && cleaned, pass: checks.length - failed.length, fail: failed.length, skip: 0, checks, measurements,
  native_evidence: "disposable-file-primitives-only", scope_traversal: "mocked", principal_profile: "NOT_RUN", setup: "NOT_RUN", cleanup: cleaned ? "PASS" : "FAIL" }, null, 2));
process.exitCode = failed.length || !cleaned ? 1 : 0;
