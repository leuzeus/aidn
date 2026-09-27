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
$skip=@('Read-File','Local-Path','Query','Netsh-State','Path-Metadata')
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
function Path-Metadata([string]$Path) { return @{directory=$false;attributes=32;bytes=1} }
function Query([string]$Kind,[string]$Argument='') {
  switch ($Kind) {
    'accounts' { return ,@(@{Name='CodexSandboxOffline';SID='S-1-5-21-1-2-3-1001';Enabled='True'}) }
    'groups' { return ,@(@{Name='CodexSandboxUsers';SID='S-1-5-21-1-2-3-1002'}) }
    'members' { return ,@(@{Name='CodexSandboxOffline';SID='S-1-5-21-1-2-3-1001'}) }
    'firewall' { return ,@(@{Name='codex_sandbox_offline_block_outbound';Action='Block'}) }
    'acl' { return ,@(@{Sddl='O:SYG:SYD:(A;;FA;;;SY)'}) }
  }; throw 'MOCK_QUERY_UNEXPECTED'
}
$script:FixtureXml='<wfpstate><providers><item><providerKey>{2e31d31c-3948-4753-9117-e5d1a6496f41}</providerKey><displayData><name>fixture</name></displayData></item></providers><subLayers><item><subLayerKey>{e65054fd-4d32-4c7c-95ef-621f0cf6431a}</subLayerKey></item></subLayers><filters><item><filterKey>{9f5f3812-79f0-4fe9-9615-4c2c92d2f0ff}</filterKey><providerKey>{2e31d31c-3948-4753-9117-e5d1a6496f41}</providerKey></item></filters></wfpstate>'
function Netsh-State($Pin) { return $script:FixtureXml }
function Assert([bool]$Condition,[string]$Name) { if (!$Condition) { throw $Name }; $script:Pass++ }
$script:Pass=0
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
 resources=@(@{kind='local_account';id='CodexSandboxOffline'})
 protected_resources=@($pins | ForEach-Object { @{kind='filesystem';id=$_} })
 paths=@($pins | ForEach-Object { @{id=$_;path=$_;hash_content=$true} })
 netsh=@{path='C:\Windows\System32\netsh.exe';sha256=$hash}
 limits=@{max_duration_ms=60000;query_timeout_ms=8000;max_rows=1000;max_file_bytes=1048576;max_output_bytes=1048576}
}
$main=@($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.TryStatementAst] })
if ($main.Count -ne 1) { throw 'MAIN_SHAPE_CHANGED' }
$mainBlock=[ScriptBlock]::Create($main[0].Extent.Text)
$RequestPath='C:\fixture\request.json'
. $mainBlock
if ($report.errors.Count) { throw ($report.errors | ConvertTo-Json -Compress) }
Assert ($null -ne $report.inventory) 'INVENTORY_PRESENT'
Assert ($report.inventory.coverage.Count -eq 11) 'ALL_CATEGORIES'
Assert (@($report.inventory.coverage | Where-Object { $_.complete -or $null -ne $_.outside_authority_sha256 }).Count -eq 0) 'NO_FALSE_COMPLETENESS'
Assert ($report.inventory.observed_at -match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$') 'TIMESTAMP_CONTRACT'
Assert (@($report.inventory.coverage | Where-Object { $_.scope_id -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' }).Count -eq 0) 'SCOPE_ID_CONTRACT'
Assert (@($script:ReadCalls | Where-Object { $_.path -eq $pins[0] -and $_.limit -eq 536870912 }).Count -eq 2) 'CLIENT_ONLY_512MIB'
Assert (@($report.inventory.protected_resources | Where-Object { $_.sha256 -cne $hash }).Count -eq 0) 'PROTECTED_EXECUTABLE_RAW_SHA'
Assert (@($script:ReadCalls | Where-Object { $_.path -ne $pins[0] -and $_.limit -gt 1048576 }).Count -eq 0) 'OTHER_FILES_KEEP_NORMAL_LIMIT'
$bounded=Report-Json $report 1024
Assert ($script:Utf8.GetByteCount($bounded) -lt 1024 -and ($bounded | ConvertFrom-Json).errors[0].code -ceq 'INVENTORY_FINAL_OUTPUT_LIMIT') 'FINAL_JSON_BOUNDED'
$good=$report.inventory
$report.errors=@(); $script:DeniedPath=$pins[1]
. $mainBlock
Assert ($report.errors.Count -eq 0 -and $null -eq $report.inventory.protected_resources[1].sha256 -and $report.inventory.protected_resources[0].sha256 -ceq $hash -and $report.inventory.protected_resources[2].sha256 -ceq $hash) 'INACCESSIBLE_PATH_PRESERVES_OTHER_OBSERVATIONS'
$deniedDiagnostics=@($report.diagnostics | Where-Object { $_.kind -ceq 'filesystem' })[0].paths
Assert ($deniedDiagnostics[0].state -ceq 'unobserved' -and $deniedDiagnostics[0].failure.code -ceq 'INVENTORY_PATH_ACCESS_DENIED') 'INACCESSIBLE_PATH_DIAGNOSTIC'
$script:DeniedPath=$null
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
[IO.File]::WriteAllText($Output,(@{checks=$script:Pass;inventory=$good;host_queries='MOCKED';native_execution='NOT_EXECUTED'} | ConvertTo-Json -Depth 20 -Compress),(New-Object Text.UTF8Encoding($false)))
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
  record("actual-powershell-parser-and-30-mocked-inventory-assertions", () => {
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout.trim()); assert.equal(summary.status, "PASS");
    assert.equal(summary.utf8_probe, "été 😀"); assert.equal(summary.checks, 30); assert.equal(summary.host_queries, "MOCKED");
    fixtureResult = JSON.parse(fs.readFileSync(output, "utf8"));
    assert.equal(fixtureResult.native_execution, "NOT_EXECUTED");
  });
  if (fixtureResult) {
    const inventory = fixtureResult.inventory, sha256 = "a".repeat(64);
    const manifest = { contract_version: "codex-managed-sandbox-effects.v1", mode: "managed-elevated", platform: "win32", host_id: inventory.host_id,
      client: { executable: "C:\\fixture\\codex.exe", sha256 }, setup: { executable: "C:\\fixture\\setup.exe", sha256 }, command_runner: { executable: "C:\\fixture\\runner.exe", sha256 },
      profile_root: "C:\\fixture\\profile", roots: [{ role: "profile", path: "C:\\fixture\\profile" }, { role: "snapshots", path: "C:\\fixture\\snapshots" },
        { role: "scratch", path: "C:\\fixture\\scratch" }, { role: "supervisor", path: "C:\\fixture\\supervisor" }],
      resources: [{ kind: "local_account", id: "CodexSandboxOffline", operations: ["update"] }],
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
process.stdout.write(`${JSON.stringify({ status: failed ? "FAIL" : unavailable ? "UNAVAILABLE" : "PASS", checks, assertions: fixtureResult ? 35 : 0, cleanup,
  host_inventory: "NOT_EXECUTED", host_providers: "MOCKED", native_execution: "NOT_EXECUTED" }, null, 2)}\n`);
if (failed || unavailable) process.exitCode = 1;
