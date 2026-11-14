param([int]$CallerId, [long]$CallerCreationTicks, [int]$SupervisorId)
$ErrorActionPreference = 'Stop'
# Process.Handle is retained until exit. A reused numeric PID can neither adopt
# this wait nor satisfy admission with a different creation identity.
$callerProcess = [System.Diagnostics.Process]::GetProcessById($CallerId)
if ($callerProcess.StartTime.ToUniversalTime().Ticks -ne $CallerCreationTicks) {
    throw 'VERIFICATION_CALLER_IDENTITY_CHANGED'
}
$supervisorProcess = [System.Diagnostics.Process]::GetProcessById($SupervisorId)
$callerWait = [System.Threading.ManualResetEvent]::new($false)
$supervisorWait = [System.Threading.ManualResetEvent]::new($false)
try {
    $callerWait.SafeWaitHandle = [Microsoft.Win32.SafeHandles.SafeWaitHandle]::new($callerProcess.Handle, $false)
    $supervisorWait.SafeWaitHandle = [Microsoft.Win32.SafeHandles.SafeWaitHandle]::new($supervisorProcess.Handle, $false)
    [Console]::Out.WriteLine('VERIFICATION_CALLER_WATCH_READY')
    [Console]::Out.Flush()
    [void][System.Threading.WaitHandle]::WaitAny(@($callerWait, $supervisorWait))
} finally {
    $callerWait.Dispose()
    $supervisorWait.Dispose()
    $callerProcess.Dispose()
    $supervisorProcess.Dispose()
}
