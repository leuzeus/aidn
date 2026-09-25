#requires -Version 5.1
<#
.SYNOPSIS
Preview or apply a complete, project-local AIDN setup on Windows.
.DESCRIPTION
Requires Node.js 22.13+ and npm. Select ReleaseVersion to download a published
GitHub release, or PackagePath and PackageSha256 for a reviewed local tarball.
PostgresMode existing uses ConnectionEnv; install opens the official PostgreSQL
17 installer through WinGet, then creates a dedicated database and login.
Secrets are prompted only with -Write and never passed as command arguments.
Native Codex approval remains a human step. See docs/WINDOWS_PROJECT_SETUP.md.
Run without arguments or with -Wizard for guided setup and explicit confirmation.
#>
[CmdletBinding()]
param(
    [switch]$Wizard,
    [string]$Target,
    [ValidatePattern('^(latest|(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*))$')][string]$ReleaseVersion,
    [string]$PackagePath,
    [ValidatePattern('^[a-fA-F0-9]{64}$')][string]$PackageSha256,
    [switch]$InstallSetup,
    [switch]$CheckUpdate,
    [switch]$Update,
    [string]$ExpectedInstallation,
    [ValidateSet('none', 'existing', 'install')][string]$PostgresMode = 'existing',
    [string]$ConnectionEnv,
    [string]$AdminConnectionEnv = 'AIDN_SETUP_PG_ADMIN',
    [string]$PostgresVersion,
    [string]$ProjectName,
    [string]$SourceBranch,
    [switch]$PersistUserConnection,
    [switch]$Write
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This installer requires Windows.' }
$nodeCommand = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
$nodeVersionText = & $nodeCommand.Source --version
if ($LASTEXITCODE -ne 0 -or [version]$nodeVersionText.Trim().TrimStart('v') -lt [version]'22.13.0') { throw 'Node.js 22.13+ with npm is required.' }
$setupControlPath = Join-Path $PSScriptRoot '../tools/setup/setup-control.mjs'
function Invoke-SetupControl {
    param([string[]]$ControlArguments)
    # Windows PowerShell 5 represents native stderr as ErrorRecords even for
    # successful progress/warnings. Exit status, not stderr presence, is authoritative.
    $savedPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $result = & $nodeCommand.Source $setupControlPath @ControlArguments
        $controlStatus = $LASTEXITCODE
    } finally { $ErrorActionPreference = $savedPreference }
    if ($controlStatus -ne 0) { throw 'Setup operation failed; inspect the diagnostic above. No automatic rollback.' }
    return ($result | ConvertFrom-Json)
}
function Read-ConnectionSecret([string]$Name, [string]$Prompt) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($Name, 'Process'))) {
        $secret = Read-Host $Prompt -AsSecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
        try { [Environment]::SetEnvironmentVariable($Name, [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer), 'Process') }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secret.Dispose() }
    }
}
if ($InstallSetup) {
    if (@($PSBoundParameters.Keys | Where-Object { $_ -notin @('InstallSetup', 'Write') }).Count) { throw '-InstallSetup accepts only -Write.' }
    $setupInfo = Invoke-SetupControl -ControlArguments @('install-setup')
    Write-Host "Setup $($setupInfo.version): $($setupInfo.home); AIDN_HOME and user PATH/bin. Project versions are unchanged."
    if (-not $Write) { return }
    $setupInfo = Invoke-SetupControl -ControlArguments @('install-setup', '--write')
    $bin = Join-Path $setupInfo.home 'bin'
    $userPath = [string][Environment]::GetEnvironmentVariable('Path', 'User')
    if (@($userPath -split ';' | Where-Object { $_.TrimEnd('\') -ieq $bin.TrimEnd('\') }).Count -eq 0) {
        [Environment]::SetEnvironmentVariable('Path', (($userPath.TrimEnd(';') + ';' + $bin).TrimStart(';')), 'User')
    }
    [Environment]::SetEnvironmentVariable('AIDN_HOME', $setupInfo.home, 'User')
    $env:AIDN_HOME = $setupInfo.home
    if (@($env:Path -split ';' | Where-Object { $_.TrimEnd('\') -ieq $bin.TrimEnd('\') }).Count -eq 0) { $env:Path += ';' + $bin }
    Write-Host 'Setup installed. Use aidn-setup; reopen other terminals to refresh their environment.'
    return
}
if ($Wizard -or $PSBoundParameters.Count -eq 0) {
    if (@($PSBoundParameters.Keys | Where-Object { $_ -ne 'Wizard' }).Count -gt 0) {
        throw 'Use -Wizard alone, or supply Target and a package source for scripted setup.'
    }
    . (Join-Path $PSScriptRoot 'setup-wizard.ps1')
    . (Join-Path $PSScriptRoot 'setup-menu.ps1')
    $setupScript = $PSCommandPath
    Invoke-AidnSetupMenu -RunSetup { param($Options) & $setupScript @Options } -Control { param($ControlArguments) Invoke-SetupControl -ControlArguments $ControlArguments }
    return
}
if (-not $Target) { throw 'Target is required.' }
if ([bool]$PackagePath -xor [bool]$PackageSha256) { throw 'PackagePath and PackageSha256 must be supplied together.' }
if ($CheckUpdate -and ($Write -or $Update -or $PackagePath -or $PackageSha256)) { throw '-CheckUpdate is read-only and requires a release selector.' }
if (($PackagePath -or $PackageSha256) -and $ReleaseVersion) { throw 'Select one package source only.' }
if ($CheckUpdate) {
    if (-not $ReleaseVersion) { $ReleaseVersion = 'latest' }
    $check = Invoke-SetupControl -ControlArguments @('check', $Target, $ReleaseVersion)
    Write-Host "Project: $($check.target); state: $($check.state); package: $($check.packageVersion); recorded: $($check.recordedVersion); release: $($check.version); status: $($check.status)"
    return
}
if ($Update) {
    if (@($PSBoundParameters.Keys | Where-Object { $_ -notin @('Target','Update','ReleaseVersion','PackagePath','PackageSha256','Write','ExpectedInstallation') }).Count) { throw 'Update preserves project configuration; installation overrides are not accepted.' }
    $existing = Invoke-SetupControl -ControlArguments @('inspect', $Target)
    if ($existing.state -ne 'installed') { throw "Installation requires diagnosis: $($existing.state)" }
    if ($ExpectedInstallation -and $ExpectedInstallation -ne $existing.fingerprint) { throw 'Installed project changed after confirmation.' }
    if ($PackagePath) {
        if (-not $PackageSha256) { throw 'PackageSha256 is required.' }
        $packageStream = [IO.File]::OpenRead([IO.Path]::GetFullPath($PackagePath))
        $packageHasher = [Security.Cryptography.SHA256]::Create()
        try { $actualHash = [BitConverter]::ToString($packageHasher.ComputeHash($packageStream)).Replace('-', '') }
        finally { $packageStream.Dispose(); $packageHasher.Dispose() }
        if ($actualHash -ine $PackageSha256) { throw 'Local package SHA-256 mismatch.' }
        $selectedVersion = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '../VERSION') -Raw).Trim()
    } else {
        if (-not $ReleaseVersion) { $ReleaseVersion = 'latest' }
        $selectedVersion = $ReleaseVersion
        if ($ReleaseVersion -eq 'latest') { $selectedVersion = (Invoke-SetupControl -ControlArguments @('resolve', 'latest')).version }
    }
    $preview = Invoke-SetupControl -ControlArguments @('update', $Target, $selectedVersion, $existing.fingerprint)
    Write-Host "Project: $($existing.target); package: $($existing.packageVersion); recorded: $($existing.recordedVersion); target: $selectedVersion; status: $($preview.status)"
    if (-not $Write -or $preview.status -ne 'update-available') { return }
    if ($existing.backend -eq 'postgres') {
        if (-not $existing.connectionRef) { throw 'Existing PostgreSQL connection reference requires manual provisioning.' }
        Read-ConnectionSecret $existing.connectionRef.Substring(4) 'Existing project PostgreSQL URL (masked)'
    }
    $updateArguments = @('update', $Target, $selectedVersion, $existing.fingerprint, '--write')
    if ($PackagePath) { $updateArguments += @([IO.Path]::GetFullPath($PackagePath), $PackageSha256) }
    Write-Host 'Preparing the candidate and checking the existing database before updating the project...'
    $updated = Invoke-SetupControl -ControlArguments $updateArguments
    Write-Host "Update: $($updated.status); AIDN $($updated.recordedVersion). Native hook approval remains separate."
    return
}
if ($ExpectedInstallation) { throw '-ExpectedInstallation requires -Update.' }
if ($ReleaseVersion -eq 'latest') { $ReleaseVersion = (Invoke-SetupControl -ControlArguments @('resolve', 'latest')).version }
if (-not $ReleaseVersion -and (-not $PackagePath -or -not $PackageSha256)) { throw 'Choose ReleaseVersion or PackagePath with PackageSha256.' }
$existing = Invoke-SetupControl -ControlArguments @('inspect', $Target)
if ($existing.state -ne 'absent') { throw "Existing installation detected ($($existing.state)); use -Update or installation diagnosis." }
$helper = Join-Path $PSScriptRoot '../tools/setup/windows-project-setup.mjs'
if ([string]::IsNullOrWhiteSpace($ConnectionEnv)) {
    $targetIdentity = [IO.Path]::GetFullPath($Target).TrimEnd('\', '/').ToLowerInvariant()
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $targetHash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($targetIdentity))).Replace('-', '') }
    finally { $hasher.Dispose() }
    $ConnectionEnv = 'AIDN_PG_' + $targetHash.Substring(0, 12)
}
foreach ($name in @($ConnectionEnv, $AdminConnectionEnv)) {
    if ($name -notmatch '^AIDN_[A-Z0-9_]+$') { throw 'Connection variable names must use the AIDN_ prefix and uppercase letters, digits or underscores.' }
}
if ($ConnectionEnv -eq $AdminConnectionEnv) { throw 'Runtime and administrator connection variables must differ.' }
if ($PersistUserConnection -and (-not $Write -or $PostgresMode -eq 'none')) {
    throw '-PersistUserConnection requires -Write and PostgreSQL.'
}
$arguments = @($helper, '--target', $Target, '--postgres-mode', $PostgresMode,
    '--connection-env', $ConnectionEnv, '--admin-connection-env', $AdminConnectionEnv)
if ($ReleaseVersion) { $arguments += @('--release-version', $ReleaseVersion) }
else { $arguments += @('--package-path', $PackagePath, '--package-sha256', $PackageSha256) }
if ($PostgresVersion) { $arguments += @('--postgres-version', $PostgresVersion) }
if ($ProjectName) { $arguments += @('--project-name', $ProjectName) }
if ($SourceBranch) { $arguments += @('--source-branch', $SourceBranch) }
# Validate the complete non-secret plan before prompting or changing any state.
& $nodeCommand.Source @arguments
if ($LASTEXITCODE -ne 0) { throw 'Setup preflight failed; nothing was installed.' }
if (-not $Write) { return }
$null = Invoke-SetupControl -ControlArguments @('list')
$previousAdmin = [Environment]::GetEnvironmentVariable($AdminConnectionEnv, 'Process')
try {
    if ($PostgresMode -ne 'none') {
        Read-ConnectionSecret $ConnectionEnv 'Project PostgreSQL URL (dedicated database/login; URL-encode the password)'
        if ($PersistUserConnection) {
            $saved = [Environment]::GetEnvironmentVariable($ConnectionEnv, 'User')
            if ($saved -and $saved -cne [Environment]::GetEnvironmentVariable($ConnectionEnv, 'Process')) {
                throw 'A different user connection already exists under this name; choose a distinct ConnectionEnv.'
            }
        }
    }
    if ($PostgresMode -eq 'install') {
        Read-ConnectionSecret $AdminConnectionEnv 'Local administrator PostgreSQL URL (postgres database; use the same password in the installer)'
    }
    & $nodeCommand.Source @arguments '--write'
    if ($LASTEXITCODE -ne 0) { throw 'Setup stopped. Earlier stages may remain installed; see the last stage and recovery instructions.' }
    $null = Invoke-SetupControl -ControlArguments @('remember', $Target, '--write')
    if ($PersistUserConnection) {
        [Environment]::SetEnvironmentVariable($ConnectionEnv, [Environment]::GetEnvironmentVariable($ConnectionEnv, 'Process'), 'User')
        Write-Host "Saved $ConnectionEnv in the Windows user environment. Restart the native client to inherit it."
    } elseif ($PostgresMode -ne 'none') {
        Write-Host "$ConnectionEnv is available in this PowerShell process only. Launch the client from this environment or provision the variable for its next session."
    }
} finally {
    [Environment]::SetEnvironmentVariable($AdminConnectionEnv, $previousAdmin, 'Process')
}
