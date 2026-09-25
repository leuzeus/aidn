[CmdletBinding()]
param(
    [string]$ReleaseVersion = 'latest',
    [string]$PackagePath,
    [string]$PackageSha256,
    [switch]$Write,
    [string]$ExpectPlan,
    [switch]$Wizard
)
$ErrorActionPreference = 'Stop'
$nodeCommand = Get-Command node -ErrorAction Stop
$entry = Join-Path $PSScriptRoot '../tools/setup/global-cli.mjs'
$setupHome = if ($env:AIDN_HOME) { $env:AIDN_HOME } else { Join-Path $env:LOCALAPPDATA 'AIDN' }
if (-not [IO.Path]::IsPathRooted($setupHome)) { throw 'Absolute AIDN_HOME required.' }
if ($Wizard) {
    & $nodeCommand.Source $entry setup
    exit $LASTEXITCODE
}
$arguments = @($entry, 'update', '--release', $ReleaseVersion, '--json')
if ($PackagePath) { $arguments += @('--package', $PackagePath, '--sha256', $PackageSha256) }
if ($Write) {
    if (-not $ExpectPlan) { throw 'Preview first and pass -ExpectPlan with -Write.' }
    $arguments += @('--write', '--expect-plan', $ExpectPlan)
}
$raw = & $nodeCommand.Source @arguments
if ($LASTEXITCODE -ne 0) { $raw; exit $LASTEXITCODE }
$result = $raw | ConvertFrom-Json
if ($Write -and $result.ok) {
    # Explicit user-scoped registration; no elevation or machine PATH changes.
    [Environment]::SetEnvironmentVariable('AIDN_HOME', $setupHome, 'User')
    $bin = Join-Path $setupHome 'bin'
    $userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
    $entries = @($userPath -split ';' | Where-Object { $_ })
    if (-not ($entries | Where-Object { $_.TrimEnd('\') -ieq $bin.TrimEnd('\') })) {
        [Environment]::SetEnvironmentVariable('PATH', (($entries + $bin) -join ';'), 'User')
    }
}
$raw
if (-not $Write) { Write-Host 'Apply with -Write -ExpectPlan <plan_id>. This also registers AIDN_HOME and bin in the user PATH; reopen the terminal afterward.' }
