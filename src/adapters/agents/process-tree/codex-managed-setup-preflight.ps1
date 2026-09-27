[CmdletBinding(DefaultParameterSetName='Path')]
param(
    [Parameter(ParameterSetName='Path')][string]$RequestPath,
    [Parameter(ParameterSetName='Base64')][string]$RequestBase64
)
# Private, read-only candidate preflight. No elevation, privilege adjustment,
# process creation or termination. A pinned caller supplies the outer deadline:
# synchronous Windows API calls cannot be interrupted by this script's clock.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'

function Stop-SetupPreflight([string]$Code) { throw [InvalidOperationException]::new('PREFLIGHT_'+$Code) }
function Test-SetupPreflightFields($Value,[string[]]$Fields) {
    if ($Value -isnot [System.Collections.IDictionary] -or $Value.Count -ne $Fields.Count) { return $false }
    foreach ($key in $Value.Keys) { if ($Fields -cnotcontains $key) { return $false } }
    return $true
}
function Test-SetupPreflightStamp($Value) {
    if ($Value -isnot [string] -or $Value -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$') { return $false }
    $parsed=[DateTime]::MinValue
    return [DateTime]::TryParseExact($Value,'o',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind,[ref]$parsed)
}
function Assert-SetupPreflightJsonNode($Node,[int]$Depth=0) {
    if ($Depth -gt 8) { Stop-SetupPreflight 'REQUEST_INVALID' }
    if ($Node.ValueKind -eq [System.Text.Json.JsonValueKind]::Object) {
        $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($property in $Node.EnumerateObject()) {
            if (!$seen.Add($property.Name)) { Stop-SetupPreflight 'REQUEST_INVALID' }
            Assert-SetupPreflightJsonNode $property.Value ($Depth+1)
        }
    } elseif ($Node.ValueKind -eq [System.Text.Json.JsonValueKind]::Array) {
        foreach ($entry in $Node.EnumerateArray()) { Assert-SetupPreflightJsonNode $entry ($Depth+1) }
    }
}
function Convert-SetupPreflightJsonNode($Node) {
    # Keep timestamps as strings on every supported PowerShell 7 minor version.
    # ConvertFrom-Json may otherwise infer DateTime and lose the exact spelling.
    switch ($Node.ValueKind) {
        ([System.Text.Json.JsonValueKind]::Object) {
            $value=@{}; foreach ($property in $Node.EnumerateObject()) { $value[$property.Name]=Convert-SetupPreflightJsonNode $property.Value }; return $value
        }
        ([System.Text.Json.JsonValueKind]::String) { return $Node.GetString() }
        ([System.Text.Json.JsonValueKind]::Number) {
            $number=[long]0; if (!$Node.TryGetInt64([ref]$number)) { Stop-SetupPreflight 'REQUEST_INVALID' }; return $number
        }
        ([System.Text.Json.JsonValueKind]::True) { return $true }
        ([System.Text.Json.JsonValueKind]::False) { return $false }
        ([System.Text.Json.JsonValueKind]::Null) { return $null }
        default { Stop-SetupPreflight 'REQUEST_INVALID' }
    }
}
function ConvertFrom-SetupPreflightJson([string]$Text) {
    if ([Text.Encoding]::UTF8.GetByteCount($Text) -gt 65536) { Stop-SetupPreflight 'REQUEST_LIMIT' }
    $document=$null
    try {
        $document=[System.Text.Json.JsonDocument]::Parse($Text)
        Assert-SetupPreflightJsonNode $document.RootElement
        $value=Convert-SetupPreflightJsonNode $document.RootElement
    } catch { Stop-SetupPreflight 'REQUEST_INVALID' } finally { if ($null -ne $document) { $document.Dispose() } }
    if (!(Test-SetupPreflightFields $value @('contract_version','request_sha256','phase','launcher','target','max_duration_ms')) -or
        $value.contract_version -cne 'aidn-managed-setup-preflight-request.v1' -or
        $value.request_sha256 -isnot [string] -or $value.request_sha256 -cnotmatch '^[a-f0-9]{64}$' -or
        @('before_create','before_resume','inside_bridge') -cnotcontains $value.phase -or
        $value.max_duration_ms -isnot [long] -or $value.max_duration_ms -ne 5000) { Stop-SetupPreflight 'REQUEST_INVALID' }
    $inside=$value.phase -ceq 'inside_bridge'
    if (!(Test-SetupPreflightFields $value.launcher @('pid','started_at'))) { Stop-SetupPreflight 'REQUEST_INVALID' }
    $identities=@($value.launcher)
    if ($value.phase -ceq 'before_create') {
        if ($null -ne $value.target) { Stop-SetupPreflight 'REQUEST_INVALID' }
    } else {
        if (!(Test-SetupPreflightFields $value.target @('pid','started_at','job_name')) -or
            $value.target.job_name -isnot [string] -or $value.target.job_name -cnotmatch '^Local\\aidn-execution-[a-f0-9]{32}$') { Stop-SetupPreflight 'REQUEST_INVALID' }
        $identities+=@($value.target)
    }
    foreach ($identity in $identities) {
        if ($identity.pid -isnot [long] -or $identity.pid -le 0 -or $identity.pid -gt [uint32]::MaxValue -or
            ($inside -and $null -ne $identity.started_at) -or (!$inside -and !(Test-SetupPreflightStamp $identity.started_at))) { Stop-SetupPreflight 'REQUEST_INVALID' }
    }
    if ($inside -and $value.launcher.pid -ne $value.target.pid) { Stop-SetupPreflight 'REQUEST_INVALID' }
    return $value
}
function Read-SetupPreflightRequest([string]$Path,[string]$Base64) {
    if ([string]::IsNullOrEmpty($Path) -eq [string]::IsNullOrEmpty($Base64)) { Stop-SetupPreflight 'REQUEST_INVALID' }
    $bytes=$null
    if (![string]::IsNullOrEmpty($Base64)) {
        if ($Base64.Length -gt 87384) { Stop-SetupPreflight 'REQUEST_LIMIT' }
        try { $bytes=[Convert]::FromBase64String($Base64) } catch { Stop-SetupPreflight 'REQUEST_INVALID' }
        if ($bytes.Length -gt 65536) { Stop-SetupPreflight 'REQUEST_LIMIT' }
        if ([Convert]::ToBase64String($bytes) -cne $Base64) { Stop-SetupPreflight 'REQUEST_INVALID' }
    } else {
        if (![IO.Path]::IsPathFullyQualified($Path)) { Stop-SetupPreflight 'REQUEST_INVALID' }
        $stream=$null
        try {
            $stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
            if ($stream.Length -gt 65536) { Stop-SetupPreflight 'REQUEST_LIMIT' }
            $buffer=[byte[]]::new(65537); $count=0
            while ($count -lt $buffer.Length) { $n=$stream.Read($buffer,$count,$buffer.Length-$count); if ($n -eq 0) { break }; $count+=$n }
            if ($count -gt 65536) { Stop-SetupPreflight 'REQUEST_LIMIT' }
            $bytes=[byte[]]::new($count); [Array]::Copy($buffer,$bytes,$count)
        } catch {
            if ($_.Exception.GetBaseException().Message -ceq 'PREFLIGHT_REQUEST_LIMIT') { throw }
            Stop-SetupPreflight 'REQUEST_READ_FAILED'
        } finally { if ($null -ne $stream) { $stream.Dispose() } }
    }
    try { $text=[Text.UTF8Encoding]::new($false,$true).GetString($bytes) } catch { Stop-SetupPreflight 'REQUEST_INVALID' }
    return ConvertFrom-SetupPreflightJson $text
}
function Get-SetupPreflightNativeSource {
    return @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
public static class AidnManagedSetupPreflightV1 {
    const uint Query=0x1000, Synchronize=0x100000;
    [StructLayout(LayoutKind.Sequential)] struct FILETIME { public uint low,high; }
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct PROCESSENTRY32 {
        public uint size,usage,pid; public UIntPtr heap; public uint module,threads,parent;
        public int priority; public uint flags;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string name;
    }
    [DllImport("kernel32.dll",SetLastError=true)] [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
    [DllImport("kernel32.dll",SetLastError=true)] [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    static extern bool GetProcessTimes(IntPtr process,out FILETIME creation,out FILETIME exit,out FILETIME kernel,out FILETIME user);
    [DllImport("kernel32.dll",SetLastError=true)] [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
    [DllImport("kernel32.dll",SetLastError=true)] [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode,ExactSpelling=true)] [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    static extern IntPtr OpenJobObjectW(uint access,bool inherit,string name);
    [DllImport("kernel32.dll",SetLastError=true)] [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool member);
    [DllImport("kernel32.dll",SetLastError=true)] [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode,ExactSpelling=true)] [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    static extern bool Process32FirstW(IntPtr snapshot,ref PROCESSENTRY32 entry);
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode,ExactSpelling=true)] [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    static extern bool Process32NextW(IntPtr snapshot,ref PROCESSENTRY32 entry);
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode,ExactSpelling=true)] [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    static extern bool QueryFullProcessImageNameW(IntPtr process,uint flags,StringBuilder path,ref uint size);
    [DllImport("advapi32.dll",SetLastError=true)] [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
    [DllImport("advapi32.dll",SetLastError=true)] [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    static extern bool GetTokenInformation(IntPtr token,int kind,IntPtr buffer,int size,out int needed);
    static Exception Failure(string code) { return new InvalidOperationException("PREFLIGHT_"+code); }
    static void Api(bool ok) { if(!ok) throw Failure(Marshal.GetLastWin32Error()==5 ? "ACCESS_DENIED" : "NATIVE_QUERY_FAILED"); }
    static void Time(Stopwatch clock,int limit) { if(limit<=0 || limit>5000 || clock.ElapsedMilliseconds>=limit) throw Failure("DEADLINE_EXCEEDED"); }
    static void Alive(IntPtr process) { uint value=WaitForSingleObject(process,0); if(value!=0x102) throw Failure(value==0 ? "PROCESS_NOT_ALIVE" : "NATIVE_QUERY_FAILED"); }
    static string Created(IntPtr process) {
        FILETIME a,b,c,d; Api(GetProcessTimes(process,out a,out b,out c,out d));
        return DateTime.FromFileTimeUtc(((long)a.high<<32)|a.low).ToString("o",CultureInfo.InvariantCulture);
    }
    static IntPtr Read(IntPtr token,int kind,out int length) {
        int needed; bool first=GetTokenInformation(token,kind,IntPtr.Zero,0,out needed); int error=Marshal.GetLastWin32Error();
        if(first || error!=122 || needed<4 || needed>1048576) throw Failure(error==5 ? "ACCESS_DENIED" : "TOKEN_QUERY_INVALID");
        IntPtr p=Marshal.AllocHGlobal(needed);
        try { Api(GetTokenInformation(token,kind,p,needed,out length)); if(length<4 || length>needed) throw Failure("TOKEN_QUERY_INVALID"); return p; }
        catch { Marshal.FreeHGlobal(p); throw; }
    }
    static int Number(IntPtr token,int kind) {
        IntPtr p=Marshal.AllocHGlobal(4); try { int n; Api(GetTokenInformation(token,kind,p,4,out n));
            if(n==4) return Marshal.ReadInt32(p); if(kind==21 && n==1) return Marshal.ReadByte(p); throw Failure("TOKEN_QUERY_INVALID");
        } finally { Marshal.FreeHGlobal(p); }
    }
    static string SidAt(IntPtr buffer,int length,IntPtr sid) {
        long delta=sid.ToInt64()-buffer.ToInt64();
        if(delta<0 || delta>length-8) throw Failure("TOKEN_QUERY_INVALID");
        int count=Marshal.ReadByte(sid,1); if(count>15 || delta+8+count*4>length) throw Failure("TOKEN_QUERY_INVALID");
        return new SecurityIdentifier(sid).Value;
    }
    static string Integrity(IntPtr token) {
        int n; IntPtr p=Read(token,25,out n); try { if(n<IntPtr.Size+4) throw Failure("TOKEN_QUERY_INVALID"); return SidAt(p,n,Marshal.ReadIntPtr(p)); }
        finally { Marshal.FreeHGlobal(p); }
    }
    static int Groups(IntPtr token,int kind,out bool admin) {
        admin=false; int n; IntPtr p=Read(token,kind,out n); try {
            int count=Marshal.ReadInt32(p),offset=IntPtr.Size==8 ? 8 : 4,stride=IntPtr.Size==8 ? 16 : 8;
            if(count<0 || count>4096 || (count>0 && offset+(long)count*stride>n)) throw Failure("TOKEN_QUERY_INVALID");
            for(int i=0;i<count;i++) { IntPtr row=IntPtr.Add(p,offset+i*stride); string sid=SidAt(p,n,Marshal.ReadIntPtr(row));
                uint attributes=unchecked((uint)Marshal.ReadInt32(row,IntPtr.Size));
                if(sid=="S-1-5-32-544" && (attributes&4)!=0 && (attributes&16)==0) admin=true;
            } return count;
        } finally { Marshal.FreeHGlobal(p); }
    }
    public static Dictionary<string,object> Observe(uint pid,string expected,string jobName,int limit) {
        var clock=Stopwatch.StartNew(); IntPtr process=IntPtr.Zero,token=IntPtr.Zero,job=IntPtr.Zero;
        if(String.IsNullOrEmpty(jobName)) jobName=null;
        try {
            Time(clock,limit); process=OpenProcess(Query|Synchronize,false,pid); Api(process!=IntPtr.Zero); Alive(process);
            string started=Created(process); if(!String.IsNullOrEmpty(expected) && started!=expected) throw Failure("PROCESS_IDENTITY_MISMATCH");
            Time(clock,limit); Api(OpenProcessToken(process,8,out token));
            bool admin,unused; Groups(token,2,out admin); Time(clock,limit); int restricted=Groups(token,11,out unused);
            var row=new Dictionary<string,object> { {"pid",pid},{"started_at",started},
                {"elevated",Number(token,20)!=0},{"admin_enabled",admin},{"integrity_sid",Integrity(token)},
                {"elevation_type",Number(token,18)},{"token_type",Number(token,8)},
                {"has_restrictions",Number(token,21)!=0},{"restricted_sid_count",restricted},
                {"is_app_container",Number(token,29)!=0},{"job_name",jobName},{"job_member",null} };
            Time(clock,limit);
            if(jobName!=null) { job=OpenJobObjectW(4,false,jobName); Api(job!=IntPtr.Zero); bool member;
                Api(IsProcessInJob(process,job,out member)); row["job_member"]=member; }
            Time(clock,limit); Alive(process); if(Created(process)!=started) throw Failure("PROCESS_IDENTITY_MISMATCH");
            Time(clock,limit); return row;
        } finally { if(job!=IntPtr.Zero) CloseHandle(job); if(token!=IntPtr.Zero) CloseHandle(token); if(process!=IntPtr.Zero) CloseHandle(process); }
    }
    public static object[] Helpers(int limit) {
        var clock=Stopwatch.StartNew(); var rows=new List<object>(); IntPtr snapshot=IntPtr.Zero;
        try {
            Time(clock,limit); snapshot=CreateToolhelp32Snapshot(2,0); Api(snapshot!=new IntPtr(-1) && snapshot!=IntPtr.Zero);
            var entry=new PROCESSENTRY32 { size=(uint)Marshal.SizeOf(typeof(PROCESSENTRY32)) }; int count=0;
            bool next=Process32FirstW(snapshot,ref entry);
            while(next) {
                Time(clock,limit); if(++count>32768) throw Failure("PROCESS_ENUMERATION_LIMIT");
                if(String.Equals(entry.name,"codex-windows-sandbox-setup.exe",StringComparison.OrdinalIgnoreCase)) {
                    if(rows.Count>=32) throw Failure("HELPER_LIMIT");
                    IntPtr process=OpenProcess(Query|Synchronize,false,entry.pid); Api(process!=IntPtr.Zero);
                    try { Alive(process); string started=Created(process); var path=new StringBuilder(32768); uint size=32768;
                        Api(QueryFullProcessImageNameW(process,0,path,ref size)); Time(clock,limit);
                        if(!String.Equals(System.IO.Path.GetFileName(path.ToString()),entry.name,StringComparison.OrdinalIgnoreCase)) throw Failure("PROCESS_IDENTITY_MISMATCH");
                        Alive(process); if(Created(process)!=started) throw Failure("PROCESS_IDENTITY_MISMATCH");
                        rows.Add(new Dictionary<string,object> { {"pid",entry.pid},{"started_at",started} });
                    } finally { CloseHandle(process); }
                }
                next=Process32NextW(snapshot,ref entry);
            }
            if(Marshal.GetLastWin32Error()!=18) throw Failure("PROCESS_ENUMERATION_INCOMPLETE");
            Time(clock,limit); return rows.ToArray();
        } finally { if(snapshot!=IntPtr.Zero && snapshot!=new IntPtr(-1)) CloseHandle(snapshot); }
    }
}
'@
}
function New-SetupPreflightNativeProvider {
    $null=Add-Type -TypeDefinition (Get-SetupPreflightNativeSource) -ErrorAction Stop
    return @{
        observe={ param($identity,$job,$remaining) [AidnManagedSetupPreflightV1]::Observe([uint32]$identity.pid,$identity.started_at,$job,$remaining) }
        helpers={ param($remaining) return ,([AidnManagedSetupPreflightV1]::Helpers($remaining)) }
    }
}
function Get-SetupPreflightRemaining($Clock,[long]$Started) {
    $elapsed=(& $Clock.elapsed)-$Started
    if ($elapsed -lt 0 -or $elapsed -ge 5000) { Stop-SetupPreflight 'DEADLINE_EXCEEDED' }
    return [int](5000-$elapsed)
}
function Assert-SetupPreflightObservation($Row,$Identity,$Job) {
    if (!(Test-SetupPreflightFields $Row @('pid','started_at','elevated','admin_enabled','integrity_sid','elevation_type','token_type','has_restrictions','restricted_sid_count','is_app_container','job_name','job_member')) -or
        ($Row.pid -isnot [uint32] -and $Row.pid -isnot [int] -and $Row.pid -isnot [long]) -or $Row.pid -ne $Identity.pid -or !(Test-SetupPreflightStamp $Row.started_at) -or
        ($null -ne $Identity.started_at -and $Identity.started_at -cne $Row.started_at) -or $Row.job_name -cne $Job) { Stop-SetupPreflight 'OBSERVATION_INVALID' }
    foreach ($name in @('elevated','admin_enabled','has_restrictions','is_app_container')) { if ($Row[$name] -isnot [bool]) { Stop-SetupPreflight 'OBSERVATION_INVALID' } }
    if ($Row.elevation_type -isnot [int] -or $Row.token_type -isnot [int] -or @(1,2,3) -notcontains $Row.elevation_type -or @(1,2) -notcontains $Row.token_type -or
        $Row.restricted_sid_count -isnot [int] -or $Row.restricted_sid_count -lt 0 -or $Row.restricted_sid_count -gt 4096 -or
        ($null -eq $Job -and $null -ne $Row.job_member) -or ($null -ne $Job -and $Row.job_member -isnot [bool]) -or
        $Row.integrity_sid -isnot [string] -or $Row.integrity_sid -cnotmatch '^S-1-16-[0-9]{1,5}$') { Stop-SetupPreflight 'OBSERVATION_INVALID' }
}
function Test-SetupPreflightToken($Row) {
    return $Row.elevated -and $Row.admin_enabled -and $Row.integrity_sid -ceq 'S-1-16-12288' -and $Row.token_type -eq 1 -and
        !$Row.has_restrictions -and $Row.restricted_sid_count -eq 0 -and !$Row.is_app_container
}
function New-SetupPreflightResult($Request,[string]$At) {
    return [ordered]@{contract_version='aidn-managed-setup-preflight.v1';request_sha256=$(if($null -eq $Request){$null}else{$Request.request_sha256});
        phase=$(if($null -eq $Request){$null}else{$Request.phase});observed_at=$At;status='REFUSED';launcher=$null;target=$null;
        helpers=[ordered]@{complete=$false;rows=@()};errors=@()}
}
function Get-SetupPreflightCode($ErrorRecord) {
    $code=$ErrorRecord.Exception.GetBaseException().Message
    $allowed=@('REQUEST_INVALID','REQUEST_LIMIT','REQUEST_READ_FAILED','PLATFORM_UNAVAILABLE','POWERSHELL_UNAVAILABLE',
        'DEADLINE_EXCEEDED','ACCESS_DENIED','NATIVE_QUERY_FAILED','TOKEN_QUERY_INVALID','PROCESS_NOT_ALIVE','PROCESS_IDENTITY_MISMATCH',
        'PROCESS_ENUMERATION_LIMIT','PROCESS_ENUMERATION_INCOMPLETE','HELPER_LIMIT','OBSERVATION_INVALID','NATIVE_PROVIDER_UNAVAILABLE')
    if ($code -cmatch '^PREFLIGHT_(.+)$' -and $allowed -ccontains $Matches[1]) { return $code }
    return 'PREFLIGHT_NATIVE_PROVIDER_UNAVAILABLE'
}
function Invoke-SetupPreflight($Request,$Provider,$Clock,[long]$Started) {
    $result=New-SetupPreflightResult $Request (& $Clock.utc)
    try {
        $remaining=Get-SetupPreflightRemaining $Clock $Started
        $row=& $Provider.observe $Request.launcher $null $remaining
        $null=Get-SetupPreflightRemaining $Clock $Started
        Assert-SetupPreflightObservation $row $Request.launcher $null
        $result.launcher=$row
        if (!(Test-SetupPreflightToken $row)) { $result.errors+=@('PREFLIGHT_LAUNCHER_TOKEN_REFUSED') }
        if ($null -ne $Request.target) {
            $remaining=Get-SetupPreflightRemaining $Clock $Started
            $row=& $Provider.observe $Request.target $Request.target.job_name $remaining
            $null=Get-SetupPreflightRemaining $Clock $Started
            Assert-SetupPreflightObservation $row $Request.target $Request.target.job_name
            $result.target=$row
            if (!(Test-SetupPreflightToken $row)) { $result.errors+=@('PREFLIGHT_TARGET_TOKEN_REFUSED') }
            if (!$row.job_member) { $result.errors+=@('PREFLIGHT_TARGET_JOB_REFUSED') }
            if ($Request.phase -ceq 'inside_bridge' -and $result.launcher.started_at -cne $row.started_at) { Stop-SetupPreflight 'PROCESS_IDENTITY_MISMATCH' }
        }
        $remaining=Get-SetupPreflightRemaining $Clock $Started
        $rows=& $Provider.helpers $remaining
        $null=Get-SetupPreflightRemaining $Clock $Started
        if ($rows -isnot [array] -or $rows.Count -gt 32) { Stop-SetupPreflight 'OBSERVATION_INVALID' }
        $seen=[Collections.Generic.HashSet[long]]::new()
        foreach ($row in $rows) {
            if (!(Test-SetupPreflightFields $row @('pid','started_at')) -or
                ($row.pid -isnot [uint32] -and $row.pid -isnot [int] -and $row.pid -isnot [long]) -or $row.pid -le 0 -or $row.pid -gt [uint32]::MaxValue -or
                !$seen.Add([long]$row.pid) -or !(Test-SetupPreflightStamp $row.started_at)) { Stop-SetupPreflight 'OBSERVATION_INVALID' }
        }
        $result.helpers=[ordered]@{complete=$true;rows=$rows}
        if ($rows.Count -gt 0) { $result.errors+=@('PREFLIGHT_HELPER_PRESENT') }
        if ($result.errors.Count -eq 0) { $result.status='OBSERVED' }
    } catch { $result.errors+=@(Get-SetupPreflightCode $_) }
    $result.observed_at=& $Clock.utc
    return $result
}

$request=$null
$timer=[Diagnostics.Stopwatch]::StartNew()
try {
    if ($PSVersionTable.PSEdition -cne 'Core' -or $PSVersionTable.PSVersion.Major -lt 7) { Stop-SetupPreflight 'POWERSHELL_UNAVAILABLE' }
    if (!$IsWindows) { Stop-SetupPreflight 'PLATFORM_UNAVAILABLE' }
    $request=Read-SetupPreflightRequest $RequestPath $RequestBase64
    $provider=New-SetupPreflightNativeProvider
    $clock=@{elapsed={$timer.ElapsedMilliseconds};utc={[DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",[Globalization.CultureInfo]::InvariantCulture)}}
    $result=Invoke-SetupPreflight $request $provider $clock 0
} catch {
    $result=New-SetupPreflightResult $request ([DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",[Globalization.CultureInfo]::InvariantCulture))
    $result.errors=@(Get-SetupPreflightCode $_)
}
[Console]::Out.WriteLine((ConvertTo-Json -InputObject $result -Depth 12 -Compress))
if ($result.status -cne 'OBSERVED') { exit 1 }
exit 0
