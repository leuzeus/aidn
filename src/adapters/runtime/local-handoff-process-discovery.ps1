$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$scopeQuery = [Console]::In.ReadToEnd() | ConvertFrom-Json
if ($scopeQuery.version -ne 1 -or $scopeQuery.query_id -notmatch '^[a-f0-9-]{36}$' -or
    @($scopeQuery.roots).Count -lt 1 -or @($scopeQuery.roots).Count -gt 2 -or
    $scopeQuery.observer_pid -lt 1 -or $scopeQuery.native_name.Length -gt 256) {
    throw 'HANDOFF_PROCESS_QUERY_INVALID'
}
foreach ($scopeRoot in $scopeQuery.roots) {
    if ($scopeRoot.path.Length -gt 4096 -or $scopeRoot.sha256 -notmatch '^[a-f0-9]{64}$') {
        throw 'HANDOFF_PROCESS_QUERY_INVALID'
    }
}
function Hash-Text([string]$value) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($value)))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}
function Path-Marker([string]$command, [string]$root) {
    $commandText = $command -replace '\\+', '/'
    $rootText = ($root -replace '\\+', '/').TrimEnd('/')
    $offset = $commandText.IndexOf($rootText, [StringComparison]::OrdinalIgnoreCase)
    while ($offset -ge 0) {
        $end = $offset + $rootText.Length
        if ($end -eq $commandText.Length) { return $true }
        $next = [int][char]$commandText[$end]
        if ([char]::IsWhiteSpace($commandText[$end]) -or $next -in @(47, 34, 39, 44, 59, 41, 93, 125)) { return $true }
        $offset = $commandText.IndexOf($rootText, $offset + 1, [StringComparison]::OrdinalIgnoreCase)
    }
    return $false
}
function Capture-Sample {
    $processRows = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CreationDate, CommandLine, ExecutablePath, Name)
    $byId = @{}
    $scoped = @{}
    $unavailable = [Collections.Generic.List[object]]::new()
    foreach ($processRow in $processRows) {
        $entryId = [int]$processRow.ProcessId
        $byId[$entryId] = $processRow
        if ($entryId -eq $PID -or $entryId -eq 0) { continue }
        if ($null -ne $processRow.CommandLine) {
            foreach ($scopeRoot in $scopeQuery.roots) {
                if (Path-Marker $processRow.CommandLine $scopeRoot.path) {
                    $scoped[$entryId] = @{ root = $scopeRoot.sha256; basis = 'marker' }
                    break
                }
            }
        }
    }
    do {
        $added = $false
        foreach ($processRow in $processRows) {
            $entryId = [int]$processRow.ProcessId
            $parentId = [int]$processRow.ParentProcessId
            if ($entryId -eq $PID -or $entryId -eq 0 -or $scoped.ContainsKey($entryId)) { continue }
            if ($scoped.ContainsKey($parentId) -and $byId.ContainsKey($parentId) -and
                $null -ne $processRow.CreationDate -and $null -ne $byId[$parentId].CreationDate -and
                $processRow.CreationDate -ge $byId[$parentId].CreationDate) {
                $scoped[$entryId] = @{ root = $scoped[$parentId].root; basis = 'descendant' }
                $added = $true
            }
        }
    } while ($added)
    $found = [Collections.Generic.List[object]]::new()
    foreach ($entryId in @($scoped.Keys | Sort-Object)) {
        if ($entryId -eq $scopeQuery.observer_pid -or $entryId -eq $PID) { continue }
        $processRow = $byId[$entryId]
        try {
            $running = [Diagnostics.Process]::GetProcessById($entryId)
            $actualTicks = [long]$running.StartTime.ToUniversalTime().Ticks
            if ($null -eq $processRow.CreationDate) { throw 'CREATION_UNAVAILABLE' }
            $reportedTicks = [long]$processRow.CreationDate.ToUniversalTime().Ticks
            if (($actualTicks - ($actualTicks % 10L)) -ne ($reportedTicks - ($reportedTicks % 10L))) { throw 'IDENTITY_CHANGED' }
            $found.Add([pscustomobject]@{
                pid = $entryId; creation = $actualTicks.ToString(); parent_pid = [int]$processRow.ParentProcessId
                command_line_sha256 = $(if ($null -eq $processRow.CommandLine) { $null } else { Hash-Text $processRow.CommandLine })
                image_path_sha256 = $(if ($null -eq $processRow.ExecutablePath) { $null } else { Hash-Text $processRow.ExecutablePath })
                scope_root_sha256 = $scoped[$entryId].root; scope_match = $scoped[$entryId].basis
            })
        } catch {
            $unavailable.Add([pscustomobject]@{ pid = $entryId; reason_code = 'SCOPED_PROCESS_IDENTITY_UNAVAILABLE'; scope_root_sha256 = $scoped[$entryId].root })
        }
    }
    foreach ($processRow in $processRows) {
        $entryId = [int]$processRow.ProcessId
        if ($entryId -eq $scopeQuery.observer_pid -or $entryId -eq $PID -or $entryId -eq 0 -or $scoped.ContainsKey($entryId)) { continue }
        if ([string]::Equals($processRow.Name, $scopeQuery.native_name, [StringComparison]::OrdinalIgnoreCase) -and
            [string]::IsNullOrEmpty($processRow.CommandLine)) {
            $unavailable.Add([pscustomobject]@{ pid = $entryId; reason_code = 'NATIVE_COMMAND_LINE_UNAVAILABLE'; scope_root_sha256 = $null })
        }
    }
    return [pscustomobject]@{
        captured_at_ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        scanned_processes = $processRows.Count
        processes = @($found.ToArray())
        unavailable = @($unavailable.ToArray() | Sort-Object pid)
    }
}
$observerProcess = [Diagnostics.Process]::GetProcessById([int]$scopeQuery.observer_pid)
$observerCreation = $observerProcess.StartTime.ToUniversalTime().Ticks.ToString()
$firstSample = Capture-Sample
$secondSample = Capture-Sample
$response = [pscustomobject]@{
    version = 1; query_id = $scopeQuery.query_id; observer_creation = $observerCreation; query_pid = $PID
    samples = @($firstSample, $secondSample)
}
[Console]::WriteLine(($response | ConvertTo-Json -Compress -Depth 12))
