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
check("Cloud metadata adds no read API or permissive reparse call site", () => {
  assert.equal([...source.matchAll(/Read-PhysicalScopeFact \$path \$true/gu)].length, 1);
  assert.match(source, /if\(reparse && !allowProfileReparse\) ReparseFail/u);
  assert.match(source, /Remember\(path,before\+\(fact\.ContentHash\?\?""\)\+\(fact\.Target\?\?""\)\+":"\+fact\.ReparseTag\)/u);
  assert(source.includes("contract_version='aidn-managed-setup-legacy-facts.v3'"));
  assert(source.includes("$cloudDirectories.Count -ge 32"));
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
$script:ScopePass=0; $script:ScopeRole=$null
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
function ReparseBuffer([uint32]$tag,[byte[]]$payload) {
    $buffer=[byte[]]::new(8+$payload.Length)
    [Array]::Copy([BitConverter]::GetBytes($tag),0,$buffer,0,4)
    [Array]::Copy([BitConverter]::GetBytes([uint16]$payload.Length),0,$buffer,4,2)
    [Array]::Copy($payload,0,$buffer,8,$payload.Length)
    return ,$buffer
}
function Decode-ReparseFixture([byte[]]$buffer,[uint32]$returned) {
    $method=[AidnScopeNative].GetMethod('DecodeProfileReparse',[Reflection.BindingFlags]'Static,NonPublic')
    return $method.Invoke($null,@($buffer,$returned,'C:\fixture\cloud','target'))
}
Check 'pure Cloud codec accepts exact CLOUD_7 and never interprets opaque payload as a target' {
    $payload=[Text.Encoding]::Unicode.GetBytes('\??\D:\not-a-target')
    $buffer=ReparseBuffer ([uint32]2415947802) $payload
    $row=Decode-ReparseFixture $buffer $buffer.Length
    Equal $row.Tag ([uint32]2415947802); Equal $row.Target $null
    $empty=ReparseBuffer ([uint32]2415947802) ([byte[]]@())
    Equal (Decode-ReparseFixture $empty $empty.Length).Target $null
}
Check 'pure Cloud codec rejects other Cloud tags symlinks and unknown tags' {
    foreach($tag in @([uint32]2415919130,[uint32]2415943706,[uint32]2415951898,[uint32]2684354572,[uint32]2415947803)) {
        $buffer=ReparseBuffer $tag ([byte[]]@())
        Reject { Decode-ReparseFixture $buffer $buffer.Length } 'SCOPE_REPARSE_UNSUPPORTED'
    }
}
Check 'pure Cloud codec rejects truncated or inconsistent buffers' {
    Reject { Decode-ReparseFixture ([byte[]]::new(7)) 7 } 'SCOPE_REPARSE_UNSUPPORTED'
    Reject { Decode-ReparseFixture ([byte[]]::new(7)) 8 } 'SCOPE_REPARSE_INVALID'
    $buffer=ReparseBuffer ([uint32]2415947802) ([byte[]]@())
    Reject { Decode-ReparseFixture $buffer 9 } 'SCOPE_REPARSE_INVALID'
    $buffer[4]=100; Reject { Decode-ReparseFixture $buffer 8 } 'SCOPE_REPARSE_INVALID'
}
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
Check 'native forbidden junction target keeps its refusal and emits only exact diagnostic fields' {
    [AidnScopeNative]::BeginPass(); $script:ScopePass=1; $script:ScopeRole='required_root'
    $cause=$null
    try { $null=[AidnScopeNative]::Read(($scratch+'\junction'),$false,$false) } catch { $cause=$_.Exception.GetBaseException() }
    if($null -eq $cause) { throw 'EXPECTED_REFUSAL' }; Equal $cause.Message 'SCOPE_REPARSE_UNSUPPORTED'
    $d=Convert-ScopeReparseDiagnostic $cause
    Equal $d.pass 1; Equal $d.role 'required_root'; Equal $d.native_phase 'target'; Equal $d.reparse_variant 'reparse_not_allowed'
    $expected=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($script:Utf8.GetBytes($scratch+'\junction'))).ToLowerInvariant()
    Equal $d.path_sha256 $expected; Equal $d.Count 5
    if((ConvertTo-Json -InputObject $d -Compress).Contains($scratch)) { throw 'DIAGNOSTIC_PATH_EXPOSED' }
}
Check 'native junction ancestor is never followed and reports the ancestor hash' {
    [AidnScopeNative]::BeginPass(); $script:ScopePass=2; $script:ScopeRole='runtime_entry'
    $cause=$null
    try { $null=[AidnScopeNative]::Read(($scratch+'\junction\missing'),$false,$false) } catch { $cause=$_.Exception.GetBaseException() }
    if($null -eq $cause) { throw 'EXPECTED_REFUSAL' }; Equal $cause.Message 'SCOPE_REPARSE_UNSUPPORTED'
    $d=Convert-ScopeReparseDiagnostic $cause
    Equal $d.pass 2; Equal $d.role 'runtime_entry'; Equal $d.native_phase 'ancestor_before'; Equal $d.reparse_variant 'reparse_not_allowed'
    Equal $d.path_sha256 ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($script:Utf8.GetBytes($scratch+'\junction'))).ToLowerInvariant())
}
Check 'diagnostic projection rejects unknown metadata and omits unrelated native data' {
    $script:ScopePass=1; $script:ScopeRole='profile_child'
    $cause=[InvalidOperationException]::new('SCOPE_REPARSE_UNSUPPORTED')
    $cause.Data['native_phase']='target'; $cause.Data['reparse_variant']='tag_not_supported'; $cause.Data['path_sha256']='a'*64
    $cause.Data['private_path']='C:\private'; $cause.Data['private_content']='must-not-escape'
    $d=Convert-ScopeReparseDiagnostic $cause; Equal $d.Count 5
    $json=ConvertTo-Json -InputObject $d -Compress
    if($json.Contains('private') -or $json.Contains('must-not-escape')) { throw 'DIAGNOSTIC_PRIVATE_DATA_EXPOSED' }
    foreach($field in @('native_phase','reparse_variant','path_sha256')) {
        $previous=$cause.Data[$field]; $cause.Data[$field]='unrecognized'; Equal (Convert-ScopeReparseDiagnostic $cause) $null; $cause.Data[$field]=$previous
    }
    $script:ScopePass=0; Equal (Convert-ScopeReparseDiagnostic $cause) $null
    $script:ScopePass=1; $script:ScopeRole='unrecognized'; Equal (Convert-ScopeReparseDiagnostic $cause) $null
    $script:ScopeRole='profile_child'; Equal (Convert-ScopeReparseDiagnostic ([InvalidOperationException]::new('C:\private'))) $null
}
Check 'native two-pass witness is deterministic' {
    [AidnScopeNative]::BeginPass(); $null=[AidnScopeNative]::Read(($scratch+'\one.txt'),$false,$false); $a=[AidnScopeNative]::WitnessHash()
    [AidnScopeNative]::BeginPass(); $null=[AidnScopeNative]::Read(($scratch+'\one.txt'),$false,$false); Equal ([AidnScopeNative]::WitnessHash()) $a
}
function NativeRow([string]$p,[string]$type='directory') {
    return @{Path=$p;State='present';ObjectType=$type;PhysicalPath=$p;VolumeId='0000000000000001';FileId=('0'*31)+'1';
        LinkCount=$(if($type -ceq 'file'){1}else{$null});Reparse=$false;ContentHash=$null;Content=$null;Target=$null;ReparseTag=$null}
}
function ResetGraph {
    $script:graph=@{}; $script:listing=@{}; $script:failure=$null; $script:reads=[Collections.Generic.List[string]]::new()
    foreach($p in @('C:\work','C:\profile','C:\candidate','C:\user','C:\state','C:\profile\.sandbox-bin','C:\Windows','C:\Program Files','C:\Program Files (x86)','C:\ProgramData',
        'C:\user\AppData','C:\user\AppData\Local\OpenAI\Codex','C:\user\AppData\Local\OpenAI\Codex\runtimes','C:\user\.cache\codex-runtimes','C:\user\.ssh')) { $script:graph[$p]=NativeRow $p }
    $script:graph['C:\user\note.txt']=NativeRow 'C:\user\note.txt' 'file'
    $script:listing['C:\user']=@('C:\user\AppData','C:\user\note.txt','C:\user\.ssh')
    $script:listing['C:\user\AppData\Local\OpenAI\Codex\runtimes']=@()
}
function Throw-MockReparse([string]$p) {
    if($null -ne $script:failure -and $script:failure.path -ceq $p -and $script:failure.role -ceq $script:ScopeRole) {
        $e=[InvalidOperationException]::new('SCOPE_REPARSE_UNSUPPORTED')
        $e.Data['native_phase']='target'; $e.Data['reparse_variant']='reparse_not_allowed'
        $e.Data['path_sha256']=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($script:Utf8.GetBytes($p))).ToLowerInvariant()
        throw $e
    }
}
function Read-PhysicalScopeFact([string]$p,[bool]$allow=$false,[bool]$prior=$false) {
    Throw-MockReparse $p
    $script:reads.Add($p)
    $ancestor=[IO.Path]::GetDirectoryName($p)
    while($ancestor) {
        if($script:graph.ContainsKey($ancestor) -and $script:graph[$ancestor].Reparse) { Stop-Scope 'SCOPE_REPARSE_UNSUPPORTED' }
        $ancestor=[IO.Path]::GetDirectoryName($ancestor)
    }
    if($script:graph.ContainsKey($p)) {
        $row=$script:graph[$p]
        if($row.Reparse -and (!$allow -or $row.ObjectType -cne 'directory')) { Stop-Scope 'SCOPE_REPARSE_UNSUPPORTED' }
        return $row
    }
    return @{Path=$p;State='absent';ObjectType=$null;PhysicalPath=$null;VolumeId=$null;FileId=$null;LinkCount=$null;Reparse=$false;ContentHash=$null;Content=$null;Target=$null;ReparseTag=$null}
}
function Read-PhysicalScopeListing([string]$p,[int]$maximum) {
    Throw-MockReparse $p
    if(!$script:listing.ContainsKey($p)) { throw 'MOCK_LISTING_MISSING' }
    if($script:listing[$p].Count -gt $maximum) { Stop-Scope 'SCOPE_LISTING_LIMIT' }
    return ,$script:listing[$p]
}
Check 'scope diagnostic role follows the exact failing operation in both passes' {
    $cases=@(
        @{role='required_root';path='C:\work'},@{role='cwd_metadata';path='C:\work\.git'},
        @{role='ssh_config';path='C:\user\.ssh\config'},@{role='prior_deny_read';path='C:\profile\.sandbox\deny_read_acl_state.json'},
        @{role='sandbox_bin';path='C:\profile\.sandbox-bin'},@{role='platform_root';path='C:\Windows'},
        @{role='profile_listing';path='C:\user'},@{role='profile_child';path='C:\user\note.txt'},
        @{role='profile_junction_target';path='C:\user\AppData'},@{role='runtime_root';path='C:\user\.cache\codex-runtimes'},
        @{role='runtime_entry';path='C:\user\AppData\Local\OpenAI\Codex\runtimes'},
        @{role='runtime_listing';path='C:\user\AppData\Local\OpenAI\Codex\runtimes'})
    foreach($pass in @(1,2)) { foreach($case in $cases) {
        ResetGraph; $script:ScopePass=$pass; $script:failure=$case
        $p='C:\user\Compatibility'; $r=NativeRow $p; $r.Reparse=$true; $r.Target='C:\user\AppData'; $r.ReparseTag=[uint32]2684354563
        $script:graph[$p]=$r; $script:listing['C:\user']+=,$p
        $cause=$null
        try { $null=Observe-PhysicalScope (Roots) } catch { $cause=$_.Exception.GetBaseException() }
        if($null -eq $cause) { throw 'EXPECTED_REFUSAL' }; Equal $cause.Message 'SCOPE_REPARSE_UNSUPPORTED'
        $d=Convert-ScopeReparseDiagnostic $cause; Equal $d.pass $pass; Equal $d.role $case.role
        Equal $d.path_sha256 ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($script:Utf8.GetBytes($case.path))).ToLowerInvariant())
    } }
    ResetGraph
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
    ResetGraph; $p='C:\user\Compatibility'; $r=NativeRow $p; $r.Reparse=$true; $r.Target='C:\foreign'; $r.ReparseTag=[uint32]2684354563; $script:graph[$p]=$r; $script:listing['C:\user']+=,$p
    Reject { Observe-PhysicalScope (Roots) } 'SCOPE_JUNCTION_OUTSIDE_PROFILE'
}
function Add-CloudDirectory([string]$p) {
    $r=NativeRow $p; $r.Reparse=$true; $r.ReparseTag=[uint32]2415947802; $script:graph[$p]=$r
    return $r
}
Check 'scope retains Cloud directory metadata without following listing or reading its contents' {
    ResetGraph; $p='C:\user\Cloud'; $null=Add-CloudDirectory $p; $script:listing['C:\user']+=,$p
    $script:graph[$p+'\private.txt']=NativeRow ($p+'\private.txt') 'file'
    $out=Observe-PhysicalScope (Roots)
    Equal $out.profile_cloud_directories.Count 1; Equal $out.profile_cloud_directories[0].path $p
    Equal $out.profile_cloud_directories[0].reparse_tag ([long]2415947802); Equal $out.profile_junctions.Count 0
    Equal @($out.paths | Where-Object path -CEQ $p).Count 1; Equal @($out.listings | Where-Object path -CEQ $p).Count 0
    Equal @($script:reads | Where-Object { $_.StartsWith($p+'\') }).Count 0
    Equal @($script:reads | Where-Object { $_ -ceq $p }).Count 1
    $before=Scope-Hash $out; $out.profile_cloud_directories[0].reparse_tag=[long]2415943706
    if((Scope-Hash $out) -ceq $before) { throw 'CLOUD_TAG_MISSING_FROM_FACT_HASH' }
}
Check 'scope enforces exactly 32 Cloud directories' {
    ResetGraph
    foreach($number in 1..32) { $p='C:\user\Cloud'+$number; $null=Add-CloudDirectory $p; $script:listing['C:\user']+=,$p }
    Equal (Observe-PhysicalScope (Roots)).profile_cloud_directories.Count 32
    $p='C:\user\Cloud33'; $null=Add-CloudDirectory $p; $script:listing['C:\user']+=,$p
    Reject { Observe-PhysicalScope (Roots) } 'SCOPE_CLOUD_DIRECTORY_LIMIT'
}
Check 'scope refuses Cloud files targets other tags roots ancestors and runtime entries' {
    foreach($bad in @('file','target','tag')) {
        ResetGraph; $p='C:\user\Cloud'; $r=Add-CloudDirectory $p; $script:listing['C:\user']+=,$p
        if($bad -ceq 'file') { $r.ObjectType='file'; $r.LinkCount=1 }
        elseif($bad -ceq 'target') { $r.Target='C:\outside' } else { $r.ReparseTag=[uint32]2415943706 }
        Reject { Observe-PhysicalScope (Roots) } 'SCOPE_REPARSE_UNSUPPORTED'
    }
    ResetGraph; $null=Add-CloudDirectory 'C:\profile'
    Reject { Observe-PhysicalScope (Roots) } 'SCOPE_REPARSE_UNSUPPORTED'
    ResetGraph; $null=Add-CloudDirectory 'C:\user\Cloud'; $roots=Roots; $roots.cwd='C:\user\Cloud\work'
    Reject { Observe-PhysicalScope $roots } 'SCOPE_REPARSE_UNSUPPORTED'
    ResetGraph; $null=Add-CloudDirectory 'C:\user\AppData\Local\OpenAI\Codex'
    Reject { Observe-PhysicalScope (Roots) } 'SCOPE_REPARSE_UNSUPPORTED'
    ResetGraph; $p='C:\user\AppData\Local\OpenAI\Codex\runtimes\cloud'; $null=Add-CloudDirectory $p
    $script:listing['C:\user\AppData\Local\OpenAI\Codex\runtimes']=@($p)
    Reject { Observe-PhysicalScope (Roots) } 'SCOPE_REPARSE_UNSUPPORTED'
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
