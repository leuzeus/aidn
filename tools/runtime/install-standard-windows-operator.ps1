[CmdletBinding(DefaultParameterSetName = 'Enroll')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Enroll')][string]$Plan,
    [Parameter(Mandatory, ParameterSetName = 'Enroll')][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectPlan,
    [Parameter(Mandatory, ParameterSetName = 'Probe')][switch]$Probe,
    [Parameter(ParameterSetName = 'Enroll')][string]$NativeSource
)

$ErrorActionPreference = 'Stop'
if ($NativeSource) { Add-Type -TypeDefinition $NativeSource }
else { Add-Type -Path (Join-Path $PSScriptRoot '..\..\src\adapters\workflow-console\windows-operator-enrollment.cs') }
if ($Probe) {
    [Aidn.StandardOperator.WindowsEnrollment]::Available()
    return
}

$encoding = [Text.UTF8Encoding]::new($false, $true)
function Get-Digest([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return -join ($sha.ComputeHash($Bytes) | ForEach-Object { $_.ToString('x2') }) }
    finally { $sha.Dispose() }
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not [Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'STANDARD_WINDOWS_OPERATOR_INSTALLER_NOT_ELEVATED'
}
$planFile = Get-Item -LiteralPath $Plan
if ($planFile.PSIsContainer -or $planFile.Length -gt 32768) { throw 'STANDARD_WINDOWS_OPERATOR_ENROLLMENT_INVALID' }
$bytes = [IO.File]::ReadAllBytes($planFile.FullName)
if ((Get-Digest $bytes) -cne $ExpectPlan) { throw 'STANDARD_WINDOWS_OPERATOR_ENROLLMENT_CHANGED' }
$intent = $encoding.GetString($bytes) | ConvertFrom-Json
$fields = ($intent.PSObject.Properties.Name | Sort-Object) -join ','
if ($fields -cne 'contract_version,decisions,operator_sid,origin,project_id,runtime_scope_id,thread_id' -or
    $intent.contract_version -cne 'standard-windows-operator-enrollment.v1' -or
    $intent.operator_sid -cne $identity.User.Value -or
    $intent.thread_id -cnotmatch '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' -or
    $intent.origin -cnotmatch '^http://localhost:[1-9][0-9]{3,4}$' -or
    [int]($intent.origin.Split(':')[-1]) -gt 65535 -or
    $intent.project_id -cnotmatch '^[^\p{Cc}]{1,256}$' -or
    $intent.runtime_scope_id -cnotmatch '^[^\p{Cc}]{1,256}$' -or
    $intent.decisions.Count -lt 1 -or $intent.decisions.Count -gt 32) {
    throw 'STANDARD_WINDOWS_OPERATOR_ENROLLMENT_INVALID'
}
foreach ($rule in $intent.decisions) {
    if ((($rule.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'choices,question_contract' -or
        $rule.question_contract -cnotmatch '^standard-[a-z-]+-question\.v[1-9][0-9]*$' -or
        $rule.choices.Count -lt 1 -or $rule.choices.Count -gt 48 -or
        @($rule.choices | Where-Object { $_ -cnotmatch '^[^\p{Cc}]{1,100}$' }).Count -gt 0) {
        throw 'STANDARD_WINDOWS_OPERATOR_ENROLLMENT_INVALID'
    }
}

$administrators = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$authenticated = [Security.Principal.SecurityIdentifier]::new('S-1-5-11')
$acl = [Security.AccessControl.RegistrySecurity]::new()
$acl.SetAccessRuleProtection($true, $false)
$acl.SetOwner($administrators)
foreach ($entry in @(
    @{Sid = $administrators; Rights = 'FullControl'},
    @{Sid = $system; Rights = 'FullControl'},
    @{Sid = $authenticated; Rights = 'ReadKey'}
)) {
    $acl.AddAccessRule([Security.AccessControl.RegistryAccessRule]::new($entry.Sid, $entry.Rights,
        'ContainerInherit', 'None', 'Allow'))
}

function Assert-RegistryProtection([Microsoft.Win32.RegistryKey]$Key) {
    $security = $Key.GetAccessControl()
    if (-not $security.AreAccessRulesProtected -or
        $security.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @($administrators.Value, $system.Value)) {
        throw 'STANDARD_WINDOWS_OPERATOR_REGISTRY_PROTECTION_REQUIRED'
    }
    foreach ($rule in $security.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.IdentityReference.Value -in @($administrators.Value, $system.Value)) { continue }
        if ($rule.AccessControlType -ne 'Allow' -or
            ($rule.RegistryRights -band (-bnot [Security.AccessControl.RegistryRights]::ReadKey)) -ne 0) {
            throw 'STANDARD_WINDOWS_OPERATOR_REGISTRY_PROTECTION_REQUIRED'
        }
    }
}

$slot = Get-Digest ($encoding.GetBytes($intent.project_id + [char]0 + $intent.runtime_scope_id))
$mutex = [Threading.Mutex]::new($false, 'Global\AIDN.StandardOperator.v1.' + $slot)
$held = $false
$machine = $software = $root = $key = $null
try {
    try { $held = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $held = $true }
    if (-not $held) { throw 'STANDARD_WINDOWS_OPERATOR_ENROLLMENT_IN_PROGRESS' }
    $machine = [Microsoft.Win32.RegistryKey]::OpenBaseKey('LocalMachine', 'Registry64')
    $software = $machine.OpenSubKey('SOFTWARE', $true)
    $root = $software.CreateSubKey('AIDN.StandardOperatorAuthority.v1', 'ReadWriteSubTree', 'None', $acl)
    Assert-RegistryProtection $root
    $key = $root.OpenSubKey($slot, $true)
    if ($key) {
        Assert-RegistryProtection $key
        $existing = $key.GetValue('Authority')
        if ($existing) {
            $installed = $existing | ConvertFrom-Json
            foreach ($field in @('project_id', 'runtime_scope_id', 'thread_id', 'origin', 'operator_sid')) {
                if ($installed.$field -cne $intent.$field) { throw 'STANDARD_WINDOWS_OPERATOR_ALREADY_ENROLLED_DIFFERENT_POLICY' }
            }
            if (($installed.decisions | ConvertTo-Json -Depth 8 -Compress) -cne ($intent.decisions | ConvertTo-Json -Depth 8 -Compress)) {
                throw 'STANDARD_WINDOWS_OPERATOR_ALREADY_ENROLLED_DIFFERENT_POLICY'
            }
            Write-Output 'STANDARD_WINDOWS_OPERATOR_ALREADY_ENROLLED'
            return
        }
    }

    $nonce = New-Object 'byte[]' 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($nonce) } finally { $rng.Dispose() }
    $challenge = [Convert]::ToBase64String($nonce).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    $client = [ordered]@{
        type = 'webauthn.create'
        challenge = $challenge
        origin = $intent.origin
        crossOrigin = $false
        aidn_installation_sha256 = $ExpectPlan
    } | ConvertTo-Json -Compress
    $userId = [byte[]]@(for ($i = 0; $i -lt 64; $i += 2) { [Convert]::ToByte($slot.Substring($i, 2), 16) })
    Write-Host ('AIDN | Installation du canal de decision pour le projet ' + $intent.project_id)
    $credential = [Aidn.StandardOperator.WindowsEnrollment]::Create(
        ('AIDN ' + $intent.project_id), $userId, $encoding.GetBytes($client))
    $policy = [ordered]@{
        contract_version = 'standard-windows-operator-authority.v1'
        project_id = $intent.project_id
        runtime_scope_id = $intent.runtime_scope_id
        thread_id = $intent.thread_id
        origin = $intent.origin
        operator_sid = $intent.operator_sid
        decisions = $intent.decisions
        credential_id = $credential.Id
        public_key = $credential.PublicKey
    }
    if (-not $key) { $key = $root.CreateSubKey($slot, 'ReadWriteSubTree', 'None', $acl) }
    Assert-RegistryProtection $key
    $json = $policy | ConvertTo-Json -Compress -Depth 8
    $asciiJson = [regex]::Replace($json, '[^\u0020-\u007e]', { param($letter) '\u{0:x4}' -f ([int][char]$letter.Value) })
    $key.SetValue('Authority', $asciiJson, 'String')
    $key.Flush()
    Write-Output 'STANDARD_WINDOWS_OPERATOR_ENROLLED'
}
finally {
    if ($key) { $key.Dispose() }
    if ($root) { $root.Dispose() }
    if ($software) { $software.Dispose() }
    if ($machine) { $machine.Dispose() }
    if ($held) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
