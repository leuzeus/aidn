import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildManagedSandboxPreparationPlan, fingerprintManagedSandboxEffectsManifest } from "../../src/core/agents/codex-managed-sandbox-contracts.mjs";

// Only the parser and the production pure helpers execute. Every host provider
// is replaced before the production main block runs. No inventory command,
// Codex binary, Windows setup or sandbox is invoked by this fixture.
const checks = [];
const record = (name, action) => { try { action(); checks.push({ name, status: "PASS" }); }
  catch (error) { checks.push({ name, status: "FAIL", detail: String(error.stack ?? error).slice(0, 2000) }); } };
if (process.platform !== "win32") {
  process.stdout.write(`${JSON.stringify({ status: "UNAVAILABLE", checks: [{ name: "powershell-ast-mocked-inventory", status: "UNAVAILABLE", reason: "WINDOWS_POWERSHELL_UNAVAILABLE" }], host_inventory: "NOT_EXECUTED", native_execution: "NOT_EXECUTED" }, null, 2)}\n`);
  process.exit(1);
}
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../verify/codex-managed-sandbox-inventory.ps1");
const fixtureScript = String.raw`param([string]$Source,[string]$Output)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($Source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'SOURCE_PARSE_FAILED' }
$skip=@('Read-File','Local-Path','Query-Raw','Netsh-StateRaw','Path-Metadata','Token-Projection','Registry-Value')
foreach ($s in $ast.EndBlock.Statements) {
  if ($s -is [Management.Automation.Language.FunctionDefinitionAst] -and $skip -notcontains $s.Name) { . ([ScriptBlock]::Create($s.Extent.Text)) }
  elseif ($s -is [Management.Automation.Language.AssignmentStatementAst]) { . ([ScriptBlock]::Create($s.Extent.Text)) }
}
$script:ReadCalls=@()
$script:ReadFailure=$false
$script:DeniedPath=$null
$productionMetadata = @($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -eq 'Path-Metadata' })
. ([ScriptBlock]::Create($productionMetadata[0].Extent.Text))
$realMetadata=(Get-Item Function:Path-Metadata).ScriptBlock
$realAttributes=(Get-Item Function:Path-Attributes).ScriptBlock
function Read-File([string]$Path,[long]$Limit,[bool]$KeepBytes=$false) {
  if ($script:ReadFailure) { throw [IO.IOException]::new('fixture-secret-never-export') }
  $script:ReadCalls+=,@{path=$Path;limit=$Limit}
  if ($KeepBytes) { return @{content=$script:Utf8.GetBytes(($script:FixtureRequest | ConvertTo-Json -Depth 20 -Compress));sha256=('a'*64);bytes=1} }
  return @{sha256=('a'*64);bytes=321953584}
}
function Local-Path([string]$Path) { if ($Path -eq $script:DeniedPath) { throw [UnauthorizedAccessException]::new('fixture-secret-never-export') }; return $Path }
function Path-Metadata([string]$Path) { if ($Path.EndsWith('missing.fixture')) { return $null }; return @{directory=$false;attributes=32;bytes=1} }
$script:QueryCalls=@()
$script:FirewallDenied=$false
$script:NetshExitCode=0
$script:RegistryDenied=$false
$script:RegistryCalls=@()
$script:FixtureToken=@{user_sid='S-1-5-21-1-2-3-1001';groups=@('S-1-5-32-545:7','S-1-1-0:7');restricted_sids=@();privileges=@('0000000000000017:2');integrity_sid='S-1-16-8192';elevation_type=3;elevated=$false;is_app_container=$false;app_container_sid=$null;has_restrictions=$false;mandatory_policy=1;virtualization_allowed=$true;virtualization_enabled=$false;impersonation_level='None'}
function Token-Projection { return $script:FixtureToken }
function Registry-Value([string]$Name) {
  $script:RegistryCalls+=,$Name
  if ($Name -cnotin @('CodexSandboxOffline','CodexSandboxOnline')) { throw 'MOCK_REGISTRY_UNEXPECTED' }
  if ($Name -ceq 'CodexSandboxOffline') {
    if ($script:RegistryDenied) { throw [UnauthorizedAccessException]::new('fixture-secret-never-export') }
    return @{state='observed';value_kind='DWord';value=0}
  }
  return @{state='absent_at_observation';value_kind=$null;value=$null}
}
function Query-Raw([string]$Kind,[string]$Argument='') {
  $script:QueryCalls+=,$Kind
  $module=@{accounts='Microsoft.PowerShell.LocalAccounts';groups='Microsoft.PowerShell.LocalAccounts';members='Microsoft.PowerShell.LocalAccounts';firewall='NetSecurity';acl='Microsoft.PowerShell.Security'}[$Kind]
  $script:CurrentProviderDetail.module=Select-ProviderModule $module ('C:\fixture\'+$module+'.psd1')
  if ($Kind -ceq 'firewall' -and $script:FirewallDenied) { throw [ComponentModel.Win32Exception]::new(5,'fixture-secret-never-export') }
  switch ($Kind) {
    'accounts' { return ,@(@{Name='CodexSandboxOffline';SID='S-1-5-21-1-2-3-1001';Enabled='True';PasswordLastSet='2026-09-27T10:00:00.1234567Z';Password='fixture-secret-never-export'},@{Name='PrivateOtherUser';SID='S-1-5-21-1-2-3-1009';PasswordLastSet='2026-09-27T10:00:00Z'}) }
    'groups' { return ,@(@{Name='CodexSandboxUsers';SID='S-1-5-21-1-2-3-1002'},@{Name='LocalizedBuiltinUsers';SID='S-1-5-32-545'},@{Name='PrivateOtherGroup';SID='S-1-5-21-1-2-3-1008'}) }
    'members' { return ,@(@{Name='private-member-name';SID='S-1-5-21-1-2-3-1001'}) }
    'firewall' { return ,@(@{Name='codex_sandbox_offline_block_outbound';Action='Block'}) }
    'acl' { return ,@(@{Sddl='O:SYG:SYD:(A;;FA;;;SY)'}) }
  }; throw 'MOCK_QUERY_UNEXPECTED'
}
$script:FixtureXml='<wfpstate><providers><item><providerKey>{2e31d31c-3948-4753-9117-e5d1a6496f41}</providerKey><displayData><name>fixture</name></displayData></item></providers><subLayers><item><subLayerKey>{e65054fd-4d32-4c7c-95ef-621f0cf6431a}</subLayerKey></item></subLayers><filters><item><filterKey>{9f5f3812-79f0-4fe9-9615-4c2c92d2f0ff}</filterKey><providerKey>{2e31d31c-3948-4753-9117-e5d1a6496f41}</providerKey></item></filters></wfpstate>'
function Netsh-StateRaw($Pin) {
  $script:CurrentProviderDetail.exit_code=$script:NetshExitCode
  $script:CurrentProviderDetail.stdout_bytes=$script:Utf8.GetByteCount($script:FixtureXml)
  $script:CurrentProviderDetail.stderr_bytes=0
  if ($script:NetshExitCode -ne 0) { Stop-Code 'INVENTORY_NETSH_QUERY_FAILED' }
  return $script:FixtureXml
}
function Assert([bool]$Condition,[string]$Name) { if (!$Condition) { throw $Name }; $script:Pass++ }
$script:Pass=0
$tokenFunction=@($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -ceq 'Token-Projection' })[0]
$addType=@($tokenFunction.FindAll({param($n) $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -ceq 'Add-Type'},$true))[0]
$nativeSource=$addType.CommandElements[2].Value
Add-Type -TypeDefinition $nativeSource -ErrorAction Stop
$imports=@([AidnManagedObserverTokenV1].GetMethods([Reflection.BindingFlags]'Static,NonPublic') | Where-Object { $_.GetCustomAttributes([Runtime.InteropServices.DllImportAttribute],$false).Count -gt 0 } | ForEach-Object { $_.Name })
Assert (($imports | Sort-Object) -join ',' -ceq 'GetTokenInformation,RegQueryValueEx') 'NATIVE_IMPORTS_READ_ONLY_AND_COMPILE'
$decode=[AidnManagedObserverTokenV1].GetMethod('DecodeNumber',[Reflection.BindingFlags]'Static,NonPublic')
$buffer=[Runtime.InteropServices.Marshal]::AllocHGlobal(4)
try {
  [Runtime.InteropServices.Marshal]::WriteInt32($buffer,2130706433)
  Assert ($decode.Invoke($null,@($buffer,21,1)) -eq 1) 'TOKEN_RESTRICTION_BOOLEAN_READS_ONE_BYTE'
  Assert ($decode.Invoke($null,@($buffer,20,4)) -eq 2130706433) 'TOKEN_ELEVATION_DWORD_READS_FOUR_BYTES'
  $badSize=$null; try { $decode.Invoke($null,@($buffer,20,1)) | Out-Null } catch { $badSize=Reason $_ }
  Assert ($badSize -ceq 'INVENTORY_TOKEN_NUMBER_SIZE') 'TOKEN_UNEXPECTED_FIELD_SIZE_REFUSED'
} finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer) }
# Run the actual production netsh read loop against an in-memory process.
# The fixed process factory is intercepted; no executable is started.
function Test-PartialNetsh([string]$Mode) {
  $savedCalls=$script:ReadCalls; $savedLimit=$script:OutputLimit; $script:FakeClockChecks=0
  $script:FakeMode=$Mode; $script:OutputLimit=$(if($Mode -ceq 'output-limit'){2}else{1048576})
  function Check-Time { $script:FakeClockChecks++; if($script:FakeMode -ceq 'timeout' -and $script:FakeClockChecks -ge 3){Stop-Code 'INVENTORY_NETSH_TIMEOUT'} }
  function Remaining { return 10000 }
  $streamFactory={param([string]$Text)
    $stream=[pscustomobject]@{Text=$Text;Reads=0}
    Add-Member -InputObject $stream -MemberType ScriptMethod -Name ReadAsync -Value {
      param([char[]]$Buffer,[int]$Offset,[int]$Count)
      $this.Reads++
      if($this.Reads -eq 1){$characters=$this.Text.ToCharArray();[Array]::Copy($characters,0,$Buffer,$Offset,$characters.Length);return [Threading.Tasks.Task]::FromResult([int]$characters.Length)}
      return [Threading.Tasks.TaskCompletionSource[int]]::new().Task
    }
    return $stream
  }
  $script:FakeNetsh=[pscustomobject]@{StartInfo=$null;StandardOutput=(& $streamFactory 'été');StandardError=(& $streamFactory 'é');HasExited=$false;Disposed=$false;Started=$false;Killed=$false}
  Add-Member -InputObject $script:FakeNetsh -MemberType ScriptMethod -Name Start -Value {$this.Started=$true;return $true}
  Add-Member -InputObject $script:FakeNetsh -MemberType ScriptMethod -Name Kill -Value {$this.Killed=$true;$this.HasExited=$true}
  Add-Member -InputObject $script:FakeNetsh -MemberType ScriptMethod -Name WaitForExit -Value {param([int]$Timeout);return $true}
  Add-Member -InputObject $script:FakeNetsh -MemberType ScriptMethod -Name Dispose -Value {$this.Disposed=$true}
  function New-Object([string]$TypeName,[object[]]$ArgumentList) {
    if($TypeName -ceq 'Diagnostics.Process'){return $script:FakeNetsh}
    return Microsoft.PowerShell.Utility\New-Object -TypeName $TypeName -ArgumentList $ArgumentList
  }
  $production=@($ast.EndBlock.Statements | Where-Object {$_ -is [Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -ceq 'Netsh-StateRaw'})[0]
  . ([ScriptBlock]::Create($production.Extent.Text))
  $script:ProviderDetails=@();$errorCode=$null
  try { Netsh-State @{path=[IO.Path]::Combine([Environment]::SystemDirectory,'netsh.exe');sha256=('a'*64)} | Out-Null }
  catch {$errorCode=Reason $_}
  finally {$script:ReadCalls=$savedCalls;$script:OutputLimit=$savedLimit}
  return @{detail=$script:ProviderDetails[0];error=$errorCode;process=$script:FakeNetsh;stop_unconfirmed=$script:UnstoppedProvider}
}
$partial=Test-PartialNetsh 'timeout'
Assert ($partial.error -ceq 'INVENTORY_NETSH_TIMEOUT' -and $partial.detail.stdout_bytes -eq 5 -and $partial.detail.stderr_bytes -eq 2) 'TIMEOUT_PRESERVES_ACTUAL_PARTIAL_UTF8_BYTES'
Assert ($partial.detail.status -ceq 'timed_out' -and $partial.detail.access -ceq 'unknown' -and $null -eq $partial.detail.exit_code -and $partial.stop_unconfirmed) 'PARTIAL_OUTPUT_DOES_NOT_PROVE_ACCESS_OR_TERMINATION'
Assert ($partial.process.Started -and $partial.process.Killed -and $partial.process.Disposed) 'SIMULATED_TIMEOUT_DISPOSES_PROCESS'
$limited=Test-PartialNetsh 'output-limit'
Assert ($limited.error -ceq 'INVENTORY_NETSH_OUTPUT_LIMIT' -and $limited.detail.stdout_bytes -eq 5 -and $limited.detail.stderr_bytes -eq 0) 'OUTPUT_LIMIT_PRESERVES_REJECTED_READ_BYTE_COUNT'
$script:UnstoppedProvider=$false
$beforeContext=Build-ObserverContext $script:FixtureToken
$reordered=$script:FixtureToken.Clone(); $reordered.groups=@('S-1-1-0:7','S-1-5-32-545:7')
Assert ((Build-ObserverContext $reordered).token_projection_sha256 -ceq $beforeContext.token_projection_sha256) 'TOKEN_SETS_ORDER_INDEPENDENT'
$restricted=$script:FixtureToken.Clone(); $restricted.restricted_sids=@('S-1-1-0:7'); $restricted.has_restrictions=$true
Assert ((Build-ObserverContext $restricted).token_projection_sha256 -cne $beforeContext.token_projection_sha256) 'TOKEN_RESTRICTIONS_INVALIDATE_DIGEST'
Assert ((ConvertTo-Json $beforeContext -Depth 8 -Compress) -notmatch 'S-1-5-21-|S-1-5-32-545|0000000000000017|TokenId|ProcessId') 'RAW_PRINCIPAL_AND_TOKEN_DETAILS_REDACTED'
$missingFixture=Join-Path ([IO.Path]::GetDirectoryName($Output)) 'does-not-exist.fixture'
Assert ($null -eq (& $realMetadata $missingFixture)) 'REAL_MISSING_FILE_METADATA'
function Path-Attributes([string]$Path) { throw [UnauthorizedAccessException]::new('fixture-secret-never-export') }
$deniedCode=$null; try { & $realMetadata $missingFixture | Out-Null } catch { $deniedCode=Reason $_ }
Assert ($deniedCode -ceq 'INVENTORY_PATH_ACCESS_DENIED') 'DENIED_ATTRIBUTES_NOT_ABSENCE'
Set-Item Function:Path-Attributes $realAttributes
$moduleLayout=Join-Path ([IO.Path]::GetDirectoryName($Output)) 'module-layout'
$currentRoot=Join-Path $moduleLayout 'current'
$systemRoot=Join-Path $moduleLayout 'system'
$security='Microsoft.PowerShell.Security'
$accounts='Microsoft.PowerShell.LocalAccounts'
foreach($root in @($currentRoot,$systemRoot)) {
  $folder=Join-Path $root $security
  $null=[IO.Directory]::CreateDirectory($folder)
  [IO.File]::WriteAllText((Join-Path $folder ($security+'.psd1')),'@{}')
}
Assert ((Find-ModuleManifest $security @($currentRoot,$systemRoot)) -ceq (Join-Path (Join-Path $currentRoot $security) ($security+'.psd1'))) 'PSHOME_SECURITY_PREFERRED'
foreach($version in @('1.0.0.0','10.0.0.0','2.0.0.0','non-numeric')) {
  $folder=Join-Path (Join-Path $systemRoot $accounts) $version
  $null=[IO.Directory]::CreateDirectory($folder)
  [IO.File]::WriteAllText((Join-Path $folder ($accounts+'.psd1')),'@{}')
}
Assert ((Find-ModuleManifest $accounts @($currentRoot,$systemRoot)) -ceq (Join-Path (Join-Path (Join-Path $systemRoot $accounts) '10.0.0.0') ($accounts+'.psd1'))) 'VERSIONED_OFFICIAL_MODULE_NUMERIC_ORDER'
$missingCode=$null; try { Find-ModuleManifest 'NetSecurity' @($currentRoot,$systemRoot) | Out-Null } catch { $missingCode=Reason $_ }
Assert ($missingCode -ceq 'INVENTORY_PROVIDER_MODULE_UNAVAILABLE') 'NO_AMBIENT_MODULE_FALLBACK'
$invalidCode=$null; try { Find-ModuleManifest 'Untrusted.Module' @($currentRoot,$systemRoot) | Out-Null } catch { $invalidCode=Reason $_ }
Assert ($invalidCode -ceq 'INVENTORY_PROVIDER_MODULE_INVALID') 'MODULE_ALLOWLIST'
$netRoot=Join-Path $systemRoot 'NetSecurity'
for($i=0;$i -lt 65;$i++) { $null=[IO.Directory]::CreateDirectory((Join-Path $netRoot ($i.ToString()+'.0'))) }
$limitCode=$null; try { Find-ModuleManifest 'NetSecurity' @($systemRoot) | Out-Null } catch { $limitCode=Reason $_ }
Assert ($limitCode -ceq 'INVENTORY_PROVIDER_VERSION_LIMIT') 'MODULE_ENUMERATION_BOUNDED'
Assert ((Digest @{b=2;a=1}) -ceq (Digest @{a=1;b=2})) 'CANONICAL_KEY_ORDER'
Assert ((Digest @(1,2)) -cne (Digest @(2,1))) 'CANONICAL_ARRAY_ORDER'
$wf=Parse-Wfp $script:FixtureXml
Assert ($wf.Count -eq 3) 'WFP_REFERENCE_NOT_RECORD'
Assert (@($wf | Where-Object { $_.sha256 -notmatch '^[a-f0-9]{64}$' }).Count -eq 0) 'WFP_HASHES'
$rejected=$false; try { Parse-Wfp '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///private">]><x>&x;</x>' | Out-Null } catch { $rejected=$true }; Assert $rejected 'DTD_REFUSED'
$rejected=$false; try { Parse-Wfp '<unknown/>' | Out-Null } catch { $rejected=$true }; Assert $rejected 'UNKNOWN_SCHEMA_REFUSED'
$rejected=$false; try { Parse-Wfp ($script:FixtureXml.Replace('</providers>','<item><providerKey>{2e31d31c-3948-4753-9117-e5d1a6496f41}</providerKey></item></providers>')) | Out-Null } catch { $rejected=$true }; Assert $rejected 'DUPLICATE_GUID_REFUSED'
$hash='a'*64
$pins=@('C:\fixture\codex.exe','C:\fixture\setup.exe','C:\fixture\runner.exe')
$script:FixtureRequest=[ordered]@{
 contract_version='codex-managed-sandbox-observation-request.v1';host_id=[Environment]::MachineName
 client=@{path=$pins[0];sha256=$hash};manifest_sha256=$hash
 resources=@(@{kind='local_account';id='CodexSandboxOffline'},@{kind='registry';id='HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList\CodexSandboxOffline'},@{kind='registry';id='HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList\CodexSandboxOnline'})
 protected_resources=@($pins | ForEach-Object { @{kind='filesystem';id=$_} })
 paths=@($pins | ForEach-Object { @{id=$_;path=$_;hash_content=$true} })
 netsh=@{path='C:\Windows\System32\netsh.exe';sha256=$hash}
 limits=@{max_duration_ms=60000;query_timeout_ms=8000;max_rows=1000;max_file_bytes=1048576;max_output_bytes=1048576}
}
$secretPath='C:\fixture\profile\.sandbox-secrets\sandbox_users.json'
$absentPath='C:\fixture\missing.fixture'
$script:FixtureRequest.resources+=,@{kind='local_account';id='CodexSandboxOnline'}
$script:FixtureRequest.resources+=,@{kind='local_account';id='PrivateOtherUser'}
$script:FixtureRequest.resources+=,@{kind='local_group';id='CodexSandboxUsers'}
$script:FixtureRequest.resources+=,@{kind='local_group';id='S-1-5-32-545'}
$script:FixtureRequest.resources+=,@{kind='local_group';id='PrivateOtherGroup'}
$script:FixtureRequest.resources+=,@{kind='filesystem_acl';id=$pins[0]}
foreach($path in @($secretPath,$absentPath)){$script:FixtureRequest.resources+=,@{kind='filesystem';id=$path};$script:FixtureRequest.paths+=,@{id=$path;path=$path;hash_content=$false}}
$main=@($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.TryStatementAst] })
if ($main.Count -ne 1) { throw 'MAIN_SHAPE_CHANGED' }
$mainBlock=[ScriptBlock]::Create($main[0].Extent.Text)
$RequestPath='C:\fixture\request.json'
. $mainBlock
if ($report.errors.Count) { throw ($report.errors | ConvertTo-Json -Compress) }
Assert ($null -ne $report.inventory) 'INVENTORY_PRESENT'
Assert ($null -ne $report.observer_context -and $report.observer_context.token_projection_sha256 -match '^[a-f0-9]{64}$') 'OBSERVER_CONTEXT_BOUND'
Assert ($report.inventory.coverage.Count -eq 11) 'ALL_CATEGORIES'
Assert (@($report.inventory.coverage | Where-Object { $_.complete -or $null -ne $_.outside_authority_sha256 }).Count -eq 0) 'NO_FALSE_COMPLETENESS'
Assert ($report.inventory.observed_at -match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$') 'TIMESTAMP_CONTRACT'
Assert (@($report.inventory.coverage | Where-Object { $_.scope_id -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' }).Count -eq 0) 'SCOPE_ID_CONTRACT'
Assert (@($script:ReadCalls | Where-Object { $_.path -eq $pins[0] -and $_.limit -eq 536870912 }).Count -eq 2) 'CLIENT_ONLY_512MIB'
Assert (@($report.inventory.protected_resources | Where-Object { $_.sha256 -cne $hash }).Count -eq 0) 'PROTECTED_EXECUTABLE_RAW_SHA'
Assert (@($script:ReadCalls | Where-Object { $_.path -ne $pins[0] -and $_.limit -gt 1048576 }).Count -eq 0) 'OTHER_FILES_KEEP_NORMAL_LIMIT'
$bounded=Report-Json $report 1024
Assert ($script:Utf8.GetByteCount($bounded) -lt 1024 -and ($bounded | ConvertFrom-Json).errors[0].code -ceq 'INVENTORY_FINAL_OUTPUT_LIMIT') 'FINAL_JSON_BOUNDED'

$candidates=$report.dimension_candidates
Assert ($candidates.contract_version -ceq 'codex-managed-sandbox-dimension-candidates.v1' -and $candidates.status -ceq 'partial') 'CANDIDATE_VERSION_ALWAYS_PARTIAL'
Assert ($candidates.inventory_sha256 -ceq (Digest $report.inventory) -and $candidates.observer_context_sha256 -ceq (Digest $report.observer_context)) 'CANDIDATES_BOUND_TO_FINAL_CONTEXT_AND_INVENTORY'
Assert ($candidates.observer_context_sha256 -cne (Digest $beforeContext)) 'CANDIDATE_CONTEXT_INCLUDES_FINAL_MODULES'
Assert ($candidates.profiles.Count -eq 5 -and @($candidates.profiles | Where-Object { $_.status -cne 'partial' }).Count -eq 0) 'FIVE_CANDIDATE_PROFILES_NOT_RECEIPTS'
$accounts=@($candidates.profiles | Where-Object {$_.profile_id -ceq 'accounts-public.v1'})[0].rows
Assert ($accounts.Count -eq 2 -and ($accounts.id -join ',') -ceq 'CodexSandboxOffline,CodexSandboxOnline') 'ONLY_TWO_FIXED_ACCOUNT_CANDIDATES'
Assert ($accounts[0].state -ceq 'observed' -and $accounts[0].dimensions.sid -ceq 'S-1-5-21-1-2-3-1001' -and $accounts[0].dimensions.password_last_set -ceq '2026-09-27T10:00:00.123Z') 'PUBLIC_ACCOUNT_DIMENSIONS_TYPED'
Assert ($accounts[0].missing_dimensions.Count -eq 1 -and $accounts[0].missing_dimensions[0] -ceq 'flags' -and !$accounts[0].dimensions.Contains('flags')) 'ACCOUNT_FLAGS_NEVER_SYNTHESIZED'
Assert ($accounts[1].state -ceq 'absent_at_observation' -and !$accounts[1].dimensions.exists -and $accounts[1].dimensions.absence_reason -ceq 'not_found') 'ACCOUNT_ABSENCE_REQUIRES_SUCCESSFUL_ENUMERATION'
$groups=@($candidates.profiles | Where-Object {$_.profile_id -ceq 'groups-membership.v1'})[0].rows
Assert ($groups.Count -eq 2 -and $groups[1].id -ceq 'S-1-5-32-545' -and $groups[0].dimensions.members[0] -ceq 'S-1-5-21-1-2-3-1001') 'GROUP_MEMBERS_SIDS_ONLY_FIXED_GROUPS'
$files=@($candidates.profiles | Where-Object {$_.profile_id -ceq 'filesystem-state.v1'})[0].rows
$clientCandidate=@($files | Where-Object {$_.id -ceq $pins[0]})[0]
Assert ($clientCandidate.dimensions.object_type -ceq 'file' -and $clientCandidate.dimensions.attributes -is [int] -and $clientCandidate.dimensions.content_sha256 -ceq $hash) 'FILE_OBSERVED_DIMENSIONS_RETAINED'
Assert ($clientCandidate.missing_dimensions -contains 'file_id' -and $clientCandidate.missing_dimensions -contains 'physical_path' -and !$clientCandidate.dimensions.Contains('file_id')) 'FILE_ID_AND_PHYSICAL_HANDLE_PATH_NOT_INVENTED'
$secretCandidate=@($files | Where-Object {$_.id -ceq $secretPath})[0]
Assert ($secretCandidate.dimensions.Contains('content_sha256') -and $null -eq $secretCandidate.dimensions.content_sha256 -and $secretCandidate.missing_dimensions -notcontains 'content_sha256') 'SECRET_CONTENT_POLICY_NULL_NOT_A_REQUEST_TO_READ'
$absentCandidate=@($files | Where-Object {$_.id -ceq $absentPath})[0]
Assert ($absentCandidate.state -ceq 'absent_at_observation' -and !$absentCandidate.dimensions.exists -and $absentCandidate.resource_sha256 -eq $null) 'FILE_PROVEN_NOT_FOUND'
$acls=@($candidates.profiles | Where-Object {$_.profile_id -ceq 'filesystem-dacl.v1'})[0].rows
Assert ($acls.Count -eq 1 -and $acls[0].dimensions.owner_sid -ceq 'S-1-5-18' -and $acls[0].dimensions.group_sid -ceq 'S-1-5-18') 'ACL_OWNER_AND_GROUP_DERIVED_FROM_EXISTING_SDDL'
Assert ($acls[0].dimensions.dacl_sha256 -cmatch '^[a-f0-9]{64}$' -and $acls[0].dimensions.control_flags -is [int] -and $acls[0].dimensions.inheritance -ceq 'not_protected' -and $acls[0].missing_dimensions -contains 'descendant_paths') 'ACL_DACL_AND_CONTROL_WITHOUT_DESCENDANT_INVENTION'
$registryCandidates=@($candidates.profiles | Where-Object {$_.profile_id -ceq 'registry-userlist.v1'})[0].rows
Assert ($registryCandidates[0].id.EndsWith('#value=CodexSandboxOffline') -and $registryCandidates[0].inventory_id.EndsWith('\CodexSandboxOffline')) 'REGISTRY_CANONICAL_ID_SEPARATE_FROM_LEGACY_ID'
Assert ($registryCandidates[0].dimensions.registry_view -ceq 'Registry64' -and $registryCandidates[0].dimensions.value_type -ceq 'DWord' -and $registryCandidates[0].dimensions.value_data -is [long] -and $registryCandidates[0].dimensions.value_data -eq 0) 'REGISTRY_TYPED_DWORD_RETAINED'
Assert ($registryCandidates[1].state -ceq 'absent_at_observation' -and !$registryCandidates[1].dimensions.exists) 'REGISTRY_ABSENCE_RETAINED'
$candidateJson=ConvertTo-Json $candidates -Depth 20 -Compress
Assert ($candidateJson -notmatch 'fixture-secret-never-export|PrivateOtherUser|PrivateOtherGroup|private-member-name|O:SYG:SY|PasswordExpires|UserMayChangePassword|Sddl') 'CANDIDATE_REDACTION_EXCLUDES_UNREQUESTED_PII_AND_RAW_CONTENT'
$readCount=$script:ReadCalls.Count; $registryCount=$script:RegistryCalls.Count; $queryCount=$script:QueryCalls.Count
$capturedBefore=Digest $script:DimensionCapture; $inventoryBefore=Digest $report.inventory; $contextBefore=Digest $report.observer_context
$again=Build-DimensionCandidates $script:DimensionCapture $report.inventory $report.observer_context
Assert ((Digest $again) -ceq (Digest $candidates) -and $readCount -eq $script:ReadCalls.Count -and $registryCount -eq $script:RegistryCalls.Count -and $queryCount -eq $script:QueryCalls.Count) 'PURE_BUILDER_NO_PROVIDERS_AND_DETERMINISTIC'
Assert ($capturedBefore -ceq (Digest $script:DimensionCapture) -and $inventoryBefore -ceq (Digest $report.inventory) -and $contextBefore -ceq (Digest $report.observer_context)) 'PURE_BUILDER_NO_INPUT_MUTATION'
function Copy-FixtureJson($Value) {
  if ($Value -is [Collections.IDictionary]) {
    $copy=@{}; foreach($key in $Value.Keys){$copy[$key]=Copy-FixtureJson $Value[$key]}; return ,$copy
  }
  if ($Value -is [Array]) {
    $copy=@(); foreach($item in $Value){$copy+=,(Copy-FixtureJson $item)}; return ,$copy
  }
  return ,$Value
}

$malicious=Copy-FixtureJson $script:DimensionCapture
$malicious.files[$secretPath].record.content_sha256='b'*64
$redacted=Build-DimensionCandidates $malicious $report.inventory $report.observer_context
$redactedSecret=@(@($redacted.profiles | Where-Object {$_.profile_id -ceq 'filesystem-state.v1'})[0].rows | Where-Object {$_.id -ceq $secretPath})[0]
Assert ($null -eq $redactedSecret.dimensions.content_sha256) 'FORGED_SECRET_CONTENT_HASH_NEVER_EXPOSED'
$malicious.accounts.CodexSandboxOffline.record.SID='fixture-secret-never-export'
$malicious.accounts.CodexSandboxOffline.record.PasswordLastSet='fixture-secret-never-export'
$redacted=Build-DimensionCandidates $malicious $report.inventory $report.observer_context
$invalidAccount=@(@($redacted.profiles | Where-Object {$_.profile_id -ceq 'accounts-public.v1'})[0].rows | Where-Object {$_.id -ceq 'CodexSandboxOffline'})[0]
Assert ($invalidAccount.missing_dimensions -contains 'sid' -and $invalidAccount.missing_dimensions -contains 'password_last_set' -and (ConvertTo-Json $redacted -Depth 20 -Compress) -notmatch 'fixture-secret-never-export') 'MALFORMED_PUBLIC_VALUES_ARE_MISSING_NOT_EXPORTED'
$malicious.registry[$registryCandidates[0].inventory_id].record.value='fixture-secret-never-export'
$redacted=Build-DimensionCandidates $malicious $report.inventory $report.observer_context
Assert ((ConvertTo-Json $redacted -Depth 20 -Compress) -notmatch 'fixture-secret-never-export') 'REGISTRY_UNEXPECTED_TYPE_NEVER_EXPORTED'
$malicious.acls[$pins[0]].record.Sddl='fixture-secret-never-export'
$redacted=Build-DimensionCandidates $malicious $report.inventory $report.observer_context
$invalidAcl=@($redacted.profiles | Where-Object {$_.profile_id -ceq 'filesystem-dacl.v1'})[0].rows[0]
Assert ($invalidAcl.reason_code -ceq 'INVENTORY_CANDIDATE_SDDL_INVALID' -and (ConvertTo-Json $redacted -Depth 20 -Compress) -notmatch 'fixture-secret-never-export') 'MALFORMED_SDDL_FIXED_ERROR_WITHOUT_CONTENT'
$malicious.accounts_complete=$false
$redacted=Build-DimensionCandidates $malicious $report.inventory $report.observer_context
$unknownAccount=@(@($redacted.profiles | Where-Object {$_.profile_id -ceq 'accounts-public.v1'})[0].rows | Where-Object {$_.id -ceq 'CodexSandboxOnline'})[0]
Assert ($unknownAccount.state -ceq 'unobserved' -and !$unknownAccount.dimensions.Contains('exists')) 'INCOMPLETE_ENUMERATION_NEVER_ABSENCE'
$malicious.accounts.CodexSandboxOffline.sha256='b'*64
$redacted=Build-DimensionCandidates $malicious $report.inventory $report.observer_context
Assert (@($redacted.profiles | Where-Object {$_.profile_id -ceq 'accounts-public.v1'})[0].rows[0].reason_code -ceq 'INVENTORY_CANDIDATE_HASH_MISMATCH') 'CANDIDATE_RECORD_HASH_BINDING'
$badContext=[pscustomobject]@{host_id='fixture-host'}
$script:GetterCalled=$false
Add-Member -InputObject $badContext -MemberType ScriptProperty -Name secret -Value {$script:GetterCalled=$true;return 'fixture-secret-never-export'}
$getterError=$null; try { Build-DimensionCandidates $script:DimensionCapture $report.inventory $badContext | Out-Null } catch { $getterError=Reason $_ }
Assert ($getterError -ceq 'INVENTORY_CANDIDATE_JSON_INVALID' -and !$script:GetterCalled) 'CLOSED_JSON_REJECTS_ACCESSOR_WITHOUT_CALLING_IT'
$bindingOk=$true
foreach($profile in $candidates.profiles){foreach($row in $profile.rows){
  $kind=@{'accounts-public.v1'='local_account';'groups-membership.v1'='local_group';'filesystem-state.v1'='filesystem';'filesystem-dacl.v1'='filesystem_acl';'registry-userlist.v1'='registry'}[$profile.profile_id]
  $binding=@((@($report.inventory.resources)+@($report.inventory.protected_resources)) | Where-Object {$_.kind -ceq $kind -and $_.id -ceq $row.inventory_id})
  if($binding.Count -ne 1 -or $binding[0].sha256 -cne $row.resource_sha256){$bindingOk=$false}
}}
Assert $bindingOk 'EVERY_CANDIDATE_LINKS_EXACT_INVENTORY_RECORD_HASH'
$goodCandidates=$candidates

$good=$report.inventory
$goodObserver=$report.observer_context
Assert ($goodObserver.host_id -ceq [Environment]::MachineName -and $goodObserver.elevation_type -ceq 'limited' -and !$goodObserver.elevated -and $goodObserver.process_bitness -in @(32,64) -and $goodObserver.os_bitness -in @(32,64)) 'OBSERVER_HOST_ELEVATION_BITNESS'
Assert ($goodObserver.selected_modules.Count -eq 3 -and @($goodObserver.selected_modules | Where-Object { $_.manifest_sha256 -cne $hash -or $_.manifest_path_sha256 -notmatch '^[a-f0-9]{64}$' }).Count -eq 0) 'SELECTED_MODULE_PINS_REPORTED'
$registry=@($report.diagnostics | Where-Object { $_.kind -ceq 'registry' })[0]
Assert ($script:RegistryCalls.Count -eq 2 -and ($script:RegistryCalls -join ',') -ceq 'CodexSandboxOffline,CodexSandboxOnline') 'ONLY_TWO_EXACT_REGISTRY_VALUES'
Assert ($registry.registry_values[0].state -ceq 'observed' -and $registry.registry_values[1].state -ceq 'absent_at_observation' -and $null -ne $good.resources[1].sha256 -and $null -eq $good.resources[2].sha256) 'REGISTRY_OBSERVED_VERSUS_ABSENT'
$wfp=@($report.diagnostics | Where-Object { $_.kind -ceq 'wfp_rule' })[0].providers[0]
Assert ($wfp.exit_code -eq 0 -and $wfp.duration_ms -ge 0 -and $wfp.status -ceq 'succeeded' -and $wfp.access -ceq 'observed' -and $wfp.observer_elevated -eq $false) 'WFP_STRUCTURED_PROCESS_DIAGNOSTIC'
$script:FixtureToken.elevated=$true; $script:FixtureToken.elevation_type=2
. $mainBlock
Assert (@($report.inventory.coverage | Where-Object { $row=$_; @($good.coverage | Where-Object { $_.kind -ceq $row.kind -and $_.scope_sha256 -ceq $row.scope_sha256 }).Count -gt 0 }).Count -eq 0) 'ALL_SCOPES_BOUND_TO_OBSERVER_TOKEN'
$script:FixtureToken.elevated=$false; $script:FixtureToken.elevation_type=3
$script:FirewallDenied=$true; $script:NetshExitCode=5; $script:RegistryDenied=$true
. $mainBlock
$fwDenied=@($report.diagnostics | Where-Object { $_.kind -ceq 'firewall_rule' })[0].providers[0]
$wfpDenied=@($report.diagnostics | Where-Object { $_.kind -ceq 'wfp_rule' })[0].providers[0]
$registryDenied=@($report.diagnostics | Where-Object { $_.kind -ceq 'registry' })[0].registry_values
Assert ($fwDenied.access -ceq 'denied' -and $fwDenied.status -ceq 'failed' -and $null -eq $fwDenied.exit_code -and $fwDenied.duration_ms -ge 0) 'FIREWALL_ACCESS_DENIED_WITHOUT_PROCESS_EXIT_INVENTION'
Assert ($wfpDenied.access -ceq 'denied' -and $wfpDenied.exit_code -eq 5 -and $wfpDenied.status -ceq 'failed') 'WFP_EXIT_CODE_ACCESS_DIAGNOSTIC'
Assert ($registryDenied[0].state -ceq 'unobserved' -and $registryDenied[1].state -ceq 'absent_at_observation' -and $null -eq $report.inventory.resources[1].sha256) 'REGISTRY_DENIED_NOT_ABSENCE'
$deniedRegistryCandidate=@($report.dimension_candidates.profiles | Where-Object {$_.profile_id -ceq 'registry-userlist.v1'})[0].rows[0]
Assert ($deniedRegistryCandidate.state -ceq 'unobserved' -and !$deniedRegistryCandidate.dimensions.Contains('exists')) 'CANDIDATE_REGISTRY_DENIAL_NOT_ABSENCE'
Assert ((ConvertTo-Json $report.diagnostics -Depth 15 -Compress) -notmatch 'fixture-secret-never-export|<wfpstate>|message|stack') 'PROVIDER_FAILURE_NO_RAW_MESSAGE_XML'
Assert (@($report.inventory.coverage | Where-Object { $_.complete }).Count -eq 0) 'PROVIDER_SUCCESS_OR_DENIAL_NEVER_COMPLETE'
$script:QueryCalls=@()
$script:FirewallDenied=$false; $script:NetshExitCode=0; $script:RegistryDenied=$false
$report.errors=@(); $script:DeniedPath=$pins[1]
. $mainBlock
Assert ($report.errors.Count -eq 0 -and $null -eq $report.inventory.protected_resources[1].sha256 -and $report.inventory.protected_resources[0].sha256 -ceq $hash -and $report.inventory.protected_resources[2].sha256 -ceq $hash) 'INACCESSIBLE_PATH_PRESERVES_OTHER_OBSERVATIONS'
$deniedDiagnostics=@($report.diagnostics | Where-Object { $_.kind -ceq 'filesystem' })[0].paths
Assert ($deniedDiagnostics[0].state -ceq 'unobserved' -and $deniedDiagnostics[0].failure.code -ceq 'INVENTORY_PATH_ACCESS_DENIED') 'INACCESSIBLE_PATH_DIAGNOSTIC'
$deniedFileCandidate=@(@($report.dimension_candidates.profiles | Where-Object {$_.profile_id -ceq 'filesystem-state.v1'})[0].rows | Where-Object {$_.id -ceq $pins[1]})[0]
Assert ($deniedFileCandidate.state -ceq 'unobserved' -and !$deniedFileCandidate.dimensions.Contains('exists') -and $deniedFileCandidate.reason_code -ceq 'INVENTORY_PATH_ACCESS_DENIED') 'CANDIDATE_FILE_DENIAL_NOT_ABSENCE'
$script:DeniedPath=$null
$credentialRequest=@($script:FixtureRequest.paths | Where-Object {$_.path -ceq $secretPath})[0]
$credentialRequest.hash_content=$true; $providerCount=$script:QueryCalls.Count; $report.errors=@(); $script:DeniedPath=$null
. $mainBlock
Assert ($report.errors.Count -eq 1 -and $report.errors[0].code -ceq 'INVENTORY_CREDENTIAL_CONTENT_FORBIDDEN' -and $script:QueryCalls.Count -eq $providerCount -and $null -eq $report.dimension_candidates) 'CREDENTIAL_CONTENT_REQUEST_REFUSED_BEFORE_PROVIDERS'
$credentialRequest.hash_content=$false
$report.errors=@(); $report.inventory=$null; $script:FixtureRequest.host_id='mismatched-host'
. $mainBlock
Assert ($report.errors[0].code -ceq 'INVENTORY_HOST_ID_MISMATCH') 'HOST_BINDING'
$report.errors=@(); $script:FixtureRequest.host_id=[Environment]::MachineName; $script:FixtureRequest.paths[0].id='C:\foreign\codex.exe'
. $mainBlock
Assert ($report.errors[0].code -ceq 'INVENTORY_PATH_ID_MISMATCH') 'PATH_BINDING'
$report.errors=@(); $script:ReadFailure=$true
. $mainBlock
Assert ($report.errors[0].phase -ceq 'request.read' -and $report.errors[0].exception_type -match '^[A-Za-z][A-Za-z0-9._+]{0,159}$' -and $report.errors[0].script_line -gt 0) 'FAILURE_STRUCTURED_PHASE_TYPE_LINE'
Assert (($report.errors | ConvertTo-Json -Compress) -notmatch 'fixture-secret-never-export|message|stack') 'FAILURE_NO_RAW_CONTENT'
Assert (((Report-Json @{text='été 😀'} 1024) | ConvertFrom-Json).text -ceq 'été 😀') 'REPORT_UNICODE_PRESERVED'
[IO.File]::WriteAllText($Output,(@{checks=$script:Pass;inventory=$good;dimension_candidates=$goodCandidates;host_queries='MOCKED';native_execution='NOT_EXECUTED'} | ConvertTo-Json -Depth 20 -Compress),(New-Object Text.UTF8Encoding($false)))
[Console]::Out.WriteLine((@{checks=$script:Pass;status='PASS';host_queries='MOCKED';native_execution='NOT_EXECUTED';utf8_probe='été 😀'} | ConvertTo-Json -Compress))
`;
let root, owner, fixtureResult;
let cleanup = "NOT_RUN";
try {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-managed-inventory-fixture-"));
  owner = randomUUID(); fs.writeFileSync(path.join(root, "owner"), owner, { flag: "wx" });
  const script = path.join(root, "mock.ps1"), output = path.join(root, "observed.json");
  fs.writeFileSync(script, fixtureScript, { flag: "wx" });
  const windowsRoot = process.env.SystemRoot;
  assert.ok(windowsRoot && path.isAbsolute(windowsRoot));
  const executable = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "PowerShell", "7", "pwsh.exe");
  if (!fs.existsSync(executable)) throw Object.assign(new Error("WINDOWS_POWERSHELL_7_UNAVAILABLE"), { code: "UNAVAILABLE" });
  const result = spawnSync(executable, ["-NoProfile", "-NonInteractive", "-File", script, "-Source", source, "-Output", output], {
    cwd: root, env: { SystemRoot: windowsRoot, WINDIR: windowsRoot, TEMP: root, TMP: root },
    encoding: "utf8", timeout: 20000, maxBuffer: 1024 * 1024, windowsHide: true,
  });
  record("actual-powershell-parser-and-mocked-inventory-assertions", () => {
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout.trim()); assert.equal(summary.status, "PASS");
    assert.equal(summary.utf8_probe, "été 😀"); assert.equal(summary.checks, 85); assert.equal(summary.host_queries, "MOCKED");
    fixtureResult = JSON.parse(fs.readFileSync(output, "utf8"));
    assert.equal(fixtureResult.native_execution, "NOT_EXECUTED");
  });
  if (fixtureResult) {
    const inventory = fixtureResult.inventory, sha256 = "a".repeat(64);
    const manifest = { contract_version: "codex-managed-sandbox-effects.v1", mode: "managed-elevated", platform: "win32", host_id: inventory.host_id,
      client: { executable: "C:\\fixture\\codex.exe", sha256 }, setup: { executable: "C:\\fixture\\setup.exe", sha256 }, command_runner: { executable: "C:\\fixture\\runner.exe", sha256 },
      profile_root: "C:\\fixture\\profile", roots: [{ role: "profile", path: "C:\\fixture\\profile" }, { role: "snapshots", path: "C:\\fixture\\snapshots" },
        { role: "scratch", path: "C:\\fixture\\scratch" }, { role: "supervisor", path: "C:\\fixture\\supervisor" }, { role: "runtime", path: "C:\\fixture" }],
      resources: inventory.resources.map(({ kind, id }) => ({ kind, id, operations: ["update"] })),
      protected_resources: inventory.protected_resources.map(({ kind, id }) => ({ kind, id })) };
    record("real-core-refuses-foreign-manifest-binding", () => {
      assert.throws(() => buildManagedSandboxPreparationPlan({ manifest, inventory }), { code: "MANAGED_SANDBOX_INVENTORY_BINDING_INVALID" });
    });
    // Bind the fixture manifest explicitly; every other field is the actual
    // production observer's output with only its host providers mocked.
    inventory.manifest_sha256 = fingerprintManagedSandboxEffectsManifest(manifest);
    record("real-core-accepts-observer-protocol-and-keeps-all-partial-categories-blocked", () => {
      const plan = buildManagedSandboxPreparationPlan({ manifest, inventory });
      assert.equal(plan.status, "PREPARATION_BLOCKED"); assert.equal(plan.incomplete_categories.length, 11);
      assert.equal(plan.execution_available, false);
    });
  }
} catch (error) { checks.push({ name: "mocked-inventory-fixture", status: error.code === "UNAVAILABLE" ? "UNAVAILABLE" : "FAIL", detail: String(error.stack ?? error).slice(0, 2000) }); }
finally {
  if (root) {
    try {
      assert.equal(fs.readFileSync(path.join(root, "owner"), "utf8"), owner);
      const resolved = fs.realpathSync(root), parent = fs.realpathSync(os.tmpdir());
      assert.equal(path.dirname(resolved).toLowerCase(), parent.toLowerCase());
      assert.ok(path.basename(resolved).startsWith("aidn-managed-inventory-fixture-"));
      assert.ok(fs.readdirSync(resolved).every(name => ["owner", "mock.ps1", "observed.json", "module-layout"].includes(name)));
      fs.rmSync(resolved, { recursive: true }); cleanup = "PASS";
    } catch (error) { cleanup = "FAIL"; checks.push({ name: "fixture-cleanup", status: "FAIL", detail: String(error.stack ?? error).slice(0, 1000) }); }
  }
}
const failed = checks.some(check => check.status === "FAIL");
const unavailable = checks.some(check => check.status === "UNAVAILABLE");
process.stdout.write(`${JSON.stringify({ status: failed ? "FAIL" : unavailable ? "UNAVAILABLE" : "PASS", checks, assertions: fixtureResult ? fixtureResult.checks : 0, cleanup,
  host_inventory: "NOT_EXECUTED", host_providers: "MOCKED", native_execution: "NOT_EXECUTED" }, null, 2)}\n`);
if (failed || unavailable) process.exitCode = 1;
