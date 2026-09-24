#requires -Version 5.1
<#
.SYNOPSIS
Preview or apply a complete, project-local AIDN setup on Windows.
.DESCRIPTION
Requires Node.js 22.13+ and npm. PackagePath is a reviewed local tarball.
PostgresMode existing uses ConnectionEnv; install opens the official PostgreSQL
17 installer through WinGet, then creates a dedicated database and login.
Secrets are prompted only with -Write and never passed as command arguments.
Native Codex approval remains a human step. See docs/WINDOWS_PROJECT_SETUP.md.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Target,
    [Parameter(Mandatory = $true)][string]$PackagePath,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$PackageSha256,
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
$arguments = @($helper, '--target', $Target, '--package-path', $PackagePath,
    '--package-sha256', $PackageSha256, '--postgres-mode', $PostgresMode,
    '--connection-env', $ConnectionEnv, '--admin-connection-env', $AdminConnectionEnv)
if ($PostgresVersion) { $arguments += @('--postgres-version', $PostgresVersion) }
if ($ProjectName) { $arguments += @('--project-name', $ProjectName) }
if ($SourceBranch) { $arguments += @('--source-branch', $SourceBranch) }
# Validate the complete non-secret plan before prompting or changing any state.
& $nodeCommand.Source @arguments
if ($LASTEXITCODE -ne 0) { throw 'Setup preflight failed; nothing was installed.' }
if (-not $Write) { return }
function Read-ConnectionSecret([string]$Name, [string]$Prompt) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($Name, 'Process'))) {
        $secret = Read-Host $Prompt -AsSecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
        try { [Environment]::SetEnvironmentVariable($Name, [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer), 'Process') }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secret.Dispose() }
    }
}
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
    if ($PersistUserConnection) {
        [Environment]::SetEnvironmentVariable($ConnectionEnv, [Environment]::GetEnvironmentVariable($ConnectionEnv, 'Process'), 'User')
        Write-Host "Saved $ConnectionEnv in the Windows user environment. Restart the native client to inherit it."
    } elseif ($PostgresMode -ne 'none') {
        Write-Host "$ConnectionEnv is available in this PowerShell process only. Launch the client from this environment or provision the variable for its next session."
    }
} finally {
    [Environment]::SetEnvironmentVariable($AdminConnectionEnv, $previousAdmin, 'Process')
}
