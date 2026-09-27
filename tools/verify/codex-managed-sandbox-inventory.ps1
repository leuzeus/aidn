# Read-only host observation for the managed-sandbox preparation dossier.
# Requires a caller-owned, bounded process launched with -NoProfile. This script
# never grants approval, provisions Codex, or executes a sandbox. A timed-out
# provider can require the caller to terminate this collector's process tree.
# No category is declared complete by selecting a convenient projection: the
# missing semantic coverage below deliberately keeps preparation blocked.
# Selectors: openai/codex commit 0d9c7cbfa6cf1489f55a8a9542b75ddd2c061807,
# codex-rs/windows-sandbox-rs/src/{setup.rs,winutil.rs,wfp.rs,wfp/filter_specs.rs,
# setup_provisioning/firewall.rs}. No credential or profile content is returned.
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$RequestPath)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$script:Clock = [Diagnostics.Stopwatch]::StartNew()
$script:BudgetMs = 60000
$script:QueryMs = 8000
$script:MaxRows = 12000
$script:FileLimit = 33554432
$script:OutputLimit = 16777216
$script:UnstoppedProvider = $false
$script:Phase = 'entry'
$script:ProviderDetails = @()
$script:SelectedModules = @{}
$script:ObserverContext = $null
$script:CurrentProviderDetail = $null
$script:Utf8 = New-Object Text.UTF8Encoding($false, $true)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$script:Kinds = @('local_account','local_group','filesystem','filesystem_acl','wfp_rule','firewall_rule','desktop','device_acl','local_policy','service','registry')
$script:FirewallNames = @('codex_sandbox_offline_block_outbound','codex_sandbox_offline_block_inbound','codex_sandbox_offline_block_loopback_tcp','codex_sandbox_offline_block_loopback_udp','codex_sandbox_offline_allow_loopback_proxy')
$script:WfpKeys = @('2e31d31c-3948-4753-9117-e5d1a6496f41','e65054fd-4d32-4c7c-95ef-621f0cf6431a','9f5f3812-79f0-4fe9-9615-4c2c92d2f0ff','87498484-45ab-4510-845e-ece8b791b3bc','af4751de-f874-4a7b-a34d-f0d0f22d1d9b','ea10db66-a928-4b2e-a82e-a376a54f93ba','83172805-f6be-4ae1-9dc6-6847aef04e7f','d23b2efb-1efb-46b2-96f3-b0ccda5690c8','420b026f-9dc9-4aea-88f4-0f2b9feab39a','8d917c81-99cc-45e7-84d6-824df860cfb8','e1d6e0af-ce5f-471b-b2d3-15ca00e966f3','c2bceca4-66ef-4a0f-ba80-f4f761b8c6f0','ba10c618-84e7-4b83-8f74-36e22b2fa1ff','fe7f22b8-5cf5-4adb-b2aa-71fc0a8f5d44')

function Stop-Code([string]$Code) { throw [InvalidOperationException]::new($Code) }
function Remaining {
    $left = $script:BudgetMs - [int]$script:Clock.ElapsedMilliseconds
    if ($left -le 0) { Stop-Code 'INVENTORY_TIME_LIMIT' }
    return [Math]::Min($left, $script:QueryMs)
}
function Check-Time { $null = Remaining }
function Exact-Keys($Value, [string[]]$Names) {
    if ($null -eq $Value -or $Value -isnot [pscustomobject]) { Stop-Code 'INVENTORY_INPUT_SHAPE' }
    $actual = @($Value.PSObject.Properties.Name)
    if ($actual.Count -ne $Names.Count) { Stop-Code 'INVENTORY_INPUT_SHAPE' }
    foreach ($name in $actual) { if ($Names -cnotcontains $name) { Stop-Code 'INVENTORY_INPUT_SHAPE' } }
}
function Safe-Id($Value) {
    if ($Value -isnot [string] -or $Value.Length -lt 1 -or $Value.Length -gt 512 -or $Value -match '[\x00-\x1f\x7f]') { Stop-Code 'INVENTORY_ID_INVALID' }
}
function Digest-Bytes([byte[]]$Bytes) {
    $h = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($h.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() } finally { $h.Dispose() }
}
# Canonical JSON uses ordinal object keys and retained
# array order. It avoids locale-dependent ConvertTo-Json property ordering.
function Canonical($Value) {
    if ($null -eq $Value) { return 'null' }
    if ($Value -is [string] -or $Value -is [bool] -or $Value -is [ValueType]) { return (ConvertTo-Json -InputObject $Value -Compress -Depth 3) }
    if ($Value -is [Collections.IDictionary] -or $Value -is [pscustomobject]) {
        if ($Value -is [Collections.IDictionary]) { [string[]]$keys = @($Value.Keys) } else { [string[]]$keys = @($Value.PSObject.Properties.Name) }
        [Array]::Sort($keys, [StringComparer]::Ordinal)
        $parts = @(); foreach ($key in $keys) { $parts += ((Canonical $key) + ':' + (Canonical $Value.$key)) }
        return '{' + ($parts -join ',') + '}'
    }
    if ($Value -is [Collections.IEnumerable]) { $parts = @(); foreach ($v in $Value) { $parts += (Canonical $v) }; return '[' + ($parts -join ',') + ']' }
    Stop-Code 'INVENTORY_CANONICAL_TYPE'
}
function Digest($Value) { return Digest-Bytes ($script:Utf8.GetBytes((Canonical $Value))) }
function Path-Attributes([string]$Path) { return [IO.File]::GetAttributes($Path) }
function Local-Path([string]$Value) {
    if ($Value -notmatch '^[A-Za-z]:\\' -or $Value -match '[\x00-\x1f\x7f]' -or [IO.Path]::GetFullPath($Value) -cne $Value) { Stop-Code 'INVENTORY_PATH_INVALID' }
    foreach ($part in $Value.Substring(3).Split('\')) {
        if (!$part -or $part -match '[:<>"|?*]|[. ]$|^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)') { Stop-Code 'INVENTORY_PATH_INVALID' }
    }
    $drive = New-Object IO.DriveInfo($Value.Substring(0,3))
    if ($drive.DriveType -ne [IO.DriveType]::Fixed) { Stop-Code 'INVENTORY_LOCAL_FIXED_VOLUME_REQUIRED' }
    for ($cursor = $Value; $cursor; $cursor = [IO.Path]::GetDirectoryName($cursor)) {
        Check-Time
        try { $attrs = Path-Attributes $cursor }
        catch { if ((Io-Reason $_) -eq 'INVENTORY_PATH_ABSENT') { continue }; throw }
        if (($attrs -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Stop-Code 'INVENTORY_PATH_REPARSE' }
        if ($cursor -eq [IO.Path]::GetPathRoot($cursor)) { break }
    }
    return $Value
}
function Read-File([string]$Path, [long]$Limit, [bool]$KeepBytes = $false) {
    $null = Local-Path $Path
    $before = New-Object IO.FileInfo($Path)
    if (!$before.Exists -or $before.Length -gt $Limit) { Stop-Code 'INVENTORY_FILE_MISSING_OR_LIMIT' }
    $length = $before.Length; $stamp = $before.LastWriteTimeUtc.Ticks; $created = $before.CreationTimeUtc.Ticks
    $stream = New-Object IO.FileStream($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read, 65536, $true)
    $hash = [Security.Cryptography.SHA256]::Create(); $memory = $null
    if ($KeepBytes) { $memory = New-Object IO.MemoryStream }
    try {
        $buffer = New-Object byte[] 65536; [long]$count = 0
        while ($true) {
            $read = $stream.ReadAsync($buffer, 0, [Math]::Min($buffer.Length, [int]($Limit - $count + 1)))
            if (!$read.Wait((Remaining))) { Stop-Code 'INVENTORY_FILE_READ_TIMEOUT' }
            $n = $read.Result; if ($n -eq 0) { break }; $count += $n
            if ($count -gt $Limit) { Stop-Code 'INVENTORY_FILE_LIMIT' }
            $null = $hash.TransformBlock($buffer, 0, $n, $buffer, 0)
            if ($KeepBytes) { $memory.Write($buffer, 0, $n) }
        }
        $null = $hash.TransformFinalBlock((New-Object byte[] 0), 0, 0)
        $before.Refresh(); $null = Local-Path $Path
        if (!$before.Exists -or $before.Length -ne $length -or $count -ne $length -or $stream.Length -ne $length -or $before.LastWriteTimeUtc.Ticks -ne $stamp -or $before.CreationTimeUtc.Ticks -ne $created) { Stop-Code 'INVENTORY_FILE_CHANGED' }
        $value = @{sha256=([BitConverter]::ToString($hash.Hash)).Replace('-','').ToLowerInvariant(); bytes=$count}
        if ($KeepBytes) { $value.content = $memory.ToArray() }
        return $value
    } finally { $stream.Dispose(); $hash.Dispose(); if ($null -ne $memory) { $memory.Dispose() } }
}
function Io-Reason($ErrorRecord) {
    $base=$ErrorRecord.Exception.GetBaseException()
    if (($base -is [IO.FileNotFoundException] -and $base.HResult -eq -2147024894) -or ($base -is [IO.DirectoryNotFoundException] -and $base.HResult -eq -2147024893)) { return 'INVENTORY_PATH_ABSENT' }
    if ($base -is [UnauthorizedAccessException] -or $base.HResult -eq -2147024891) { return 'INVENTORY_PATH_ACCESS_DENIED' }
    return $null
}
function Reason($ErrorRecord) {
    $message = [string]$ErrorRecord.Exception.Message
    if ($message -cmatch '^INVENTORY_[A-Z0-9_]+$') { return $message }
    $baseMessage=[string]$ErrorRecord.Exception.GetBaseException().Message
    if ($baseMessage -cmatch '^INVENTORY_[A-Z0-9_]+$') { return $baseMessage }
    $io=Io-Reason $ErrorRecord; if ($null -ne $io) { return $io }
    return 'INVENTORY_PROVIDER_UNAVAILABLE'
}
function Failure-Detail($ErrorRecord) {
    $type=$ErrorRecord.Exception.GetType().FullName
    if ($type -cnotmatch '^[A-Za-z][A-Za-z0-9._+`]{0,159}$') { $type='Exception' }
    $line=$null
    if ($null -ne $ErrorRecord.InvocationInfo -and $ErrorRecord.InvocationInfo.ScriptLineNumber -gt 0) { $line=$ErrorRecord.InvocationInfo.ScriptLineNumber }
    $base=$ErrorRecord.Exception.GetBaseException()
    $innerType=$base.GetType().FullName
    if ($innerType -cnotmatch '^[A-Za-z][A-Za-z0-9._+`]{0,159}$') { $innerType='Exception' }
    $nativeCode=$null; if ($base -is [ComponentModel.Win32Exception]) { $nativeCode=$base.NativeErrorCode }
    $tokenClass=$null; if ($base.Data.Contains('token_information_class') -and $base.Data['token_information_class'] -is [int]) { $tokenClass=$base.Data['token_information_class'] }
    return [ordered]@{code=(Reason $ErrorRecord);phase=$script:Phase;exception_type=$type;script_line=$line;inner_exception_type=$innerType;hresult=$base.HResult;native_error_code=$nativeCode;token_information_class=$tokenClass;returned_size=$(if ($base.Data.Contains('returned_size') -and $base.Data['returned_size'] -is [int]) { $base.Data['returned_size'] } else { $null })}
}
function Path-Metadata([string]$Path) {
    Check-Time; $null=Local-Path $Path
    try { $attributes=Path-Attributes $Path }
    catch { if ((Io-Reason $_) -eq 'INVENTORY_PATH_ABSENT') { return $null }; throw }
    $directory=($attributes -band [IO.FileAttributes]::Directory) -ne 0
    $bytes=$null; if (!$directory) { $fi=New-Object IO.FileInfo($Path); $bytes=$fi.Length }
    return @{directory=$directory;attributes=[int]$attributes;bytes=$bytes}
}

# Read only the effective token. No token adjustment, account lookup or privilege
# enablement occurs. The fixed type is compiled in memory by PowerShell 7.
function Token-Projection {
    Check-Time
    if ($PSVersionTable.PSEdition -cne 'Core' -or $PSVersionTable.PSVersion.Major -lt 7) { Stop-Code 'INVENTORY_POWERSHELL_7_REQUIRED' }
    if ($null -eq ('AidnManagedObserverTokenV1' -as [type])) {
        Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class AidnManagedObserverTokenV1 {
    [DllImport("advapi32.dll", SetLastError=true)]
    private static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr buffer, int size, out int needed);
    private static Win32Exception QueryError(int error,int kind) { var value=new Win32Exception(error); value.Data["token_information_class"]=kind; return value; }
    private static IntPtr Read(IntPtr token, int kind) {
        int needed;
        GetTokenInformation(token, kind, IntPtr.Zero, 0, out needed);
        int error = Marshal.GetLastWin32Error();
        if (needed <= 0 || needed > 1048576 || error != 122) throw QueryError(error,kind);
        IntPtr buffer = Marshal.AllocHGlobal(needed);
        if (!GetTokenInformation(token, kind, buffer, needed, out needed)) {
            error=Marshal.GetLastWin32Error(); Marshal.FreeHGlobal(buffer); throw QueryError(error,kind);
        }
        return buffer;
    }
    private static int Number(IntPtr token, int kind) {
        // Fixed DWORD classes (notably TokenElevation) can return BAD_LENGTH
        // instead of INSUFFICIENT_BUFFER for a zero-length sizing call.
        IntPtr p=Marshal.AllocHGlobal(4); try {
            int needed; if(!GetTokenInformation(token,kind,p,4,out needed)) throw QueryError(Marshal.GetLastWin32Error(),kind);
            return DecodeNumber(p,kind,needed);
        } finally { Marshal.FreeHGlobal(p); }
    }
    private static int DecodeNumber(IntPtr p,int kind,int needed) {
        if(needed == 4) return Marshal.ReadInt32(p);
        // Windows reports TokenHasRestrictions as a one-byte BOOLEAN.
        if(kind == 21 && needed == 1) return Marshal.ReadByte(p);
        var error=new InvalidOperationException("INVENTORY_TOKEN_NUMBER_SIZE");
        error.Data["token_information_class"]=kind; error.Data["returned_size"]=needed; throw error;
    }
    private static string Sid(IntPtr token, int kind) {
        IntPtr p=Read(token,kind); try {
            IntPtr sid=Marshal.ReadIntPtr(p); return sid == IntPtr.Zero ? null : new SecurityIdentifier(sid).Value;
        } finally { Marshal.FreeHGlobal(p); }
    }
    private static string[] Groups(IntPtr token, int kind) {
        IntPtr p=Read(token,kind); try {
            int count=Marshal.ReadInt32(p); if (count < 0 || count > 4096) throw new InvalidOperationException("INVENTORY_TOKEN_ROW_LIMIT");
            var rows=new string[count]; int offset=IntPtr.Size == 8 ? 8 : 4, stride=IntPtr.Size == 8 ? 16 : 8;
            for(int i=0;i<count;i++) { IntPtr row=IntPtr.Add(p,offset+i*stride);
                rows[i]=new SecurityIdentifier(Marshal.ReadIntPtr(row)).Value+":"+unchecked((uint)Marshal.ReadInt32(row,IntPtr.Size)).ToString(System.Globalization.CultureInfo.InvariantCulture);
            }
            Array.Sort(rows,StringComparer.Ordinal); return rows;
        } finally { Marshal.FreeHGlobal(p); }
    }
    private static string[] Privileges(IntPtr token) {
        IntPtr p=Read(token,3); try {
            int count=Marshal.ReadInt32(p); if(count < 0 || count > 4096) throw new InvalidOperationException("INVENTORY_TOKEN_ROW_LIMIT");
            var rows=new string[count];
            for(int i=0;i<count;i++) { IntPtr row=IntPtr.Add(p,4+i*12);
                rows[i]=unchecked((uint)Marshal.ReadInt32(row,4)).ToString("x8")+unchecked((uint)Marshal.ReadInt32(row)).ToString("x8")+":"+(unchecked((uint)Marshal.ReadInt32(row,8)) & 7u).ToString(System.Globalization.CultureInfo.InvariantCulture);
            }
            Array.Sort(rows,StringComparer.Ordinal); return rows;
        } finally { Marshal.FreeHGlobal(p); }
    }
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode)]
    private static extern int RegQueryValueEx(IntPtr key, string name, IntPtr reserved, out uint kind, out uint value, ref uint length);
    public static Dictionary<string,object> RegistryDword(IntPtr key, string name) {
        uint kind,value,length=4; int status=RegQueryValueEx(key,name,IntPtr.Zero,out kind,out value,ref length);
        if(status == 2) return new Dictionary<string,object> { {"state","absent_at_observation"}, {"value_kind",null}, {"value",null} };
        if(status == 234 || (status == 0 && (kind != 4 || length != 4))) throw new InvalidOperationException("INVENTORY_REGISTRY_VALUE_TYPE_UNSUPPORTED");
        if(status != 0) throw new Win32Exception(status);
        return new Dictionary<string,object> { {"state","observed"}, {"value_kind","DWord"}, {"value",value} };
    }
    public static Dictionary<string,object> Snapshot() {
        using(var identity=WindowsIdentity.GetCurrent()) {
            IntPtr token=identity.AccessToken.DangerousGetHandle();
            return new Dictionary<string,object> {
                {"user_sid",Sid(token,1)}, {"groups",Groups(token,2)}, {"restricted_sids",Groups(token,11)},
                {"privileges",Privileges(token)}, {"integrity_sid",Sid(token,25)},
                {"elevation_type",Number(token,18)}, {"elevated",Number(token,20)!=0},
                {"is_app_container",Number(token,29)!=0}, {"app_container_sid",Sid(token,31)},
                {"has_restrictions",Number(token,21)!=0}, {"mandatory_policy",Number(token,27)},
                {"virtualization_allowed",Number(token,23)!=0}, {"virtualization_enabled",Number(token,24)!=0},
                {"impersonation_level",identity.ImpersonationLevel.ToString()}
            };
        }
    }
}
"@ -ErrorAction Stop
    }
    $snapshot=[AidnManagedObserverTokenV1]::Snapshot(); Check-Time; return $snapshot
}
function Build-ObserverContext($Snapshot) {
    if ($Snapshot.user_sid -notmatch '^S-1-[0-9-]+$' -or $Snapshot.integrity_sid -notmatch '^S-1-16-[0-9]+$' -or $Snapshot.elevation_type -notin @(1,2,3)) { Stop-Code 'INVENTORY_TOKEN_SHAPE' }
    # Sort sets ordinally; no PID, TokenId or authentication-session identifier
    # enters this semantic projection. Raw principal/group/privilege data stays
    # in memory and is never copied to the observation document.
    $stable=[ordered]@{}
    foreach ($key in @('user_sid','integrity_sid','elevation_type','elevated','is_app_container','app_container_sid','has_restrictions','mandatory_policy','virtualization_allowed','virtualization_enabled','impersonation_level')) { $stable[$key]=$Snapshot[$key] }
    foreach ($key in @('groups','restricted_sids','privileges')) { [string[]]$items=@($Snapshot[$key]); if ($items.Count -gt 4096) { Stop-Code 'INVENTORY_TOKEN_ROW_LIMIT' }; [Array]::Sort($items,[StringComparer]::Ordinal); $stable[$key]=$items }
    return [ordered]@{
        contract_version='codex-managed-sandbox-observer-context.v1';state='observed';host_id=[Environment]::MachineName
        user_sid_sha256=(Digest $stable.user_sid);token_projection_sha256=(Digest $stable)
        integrity_sid=$stable.integrity_sid;elevation_type=@{1='default';2='full';3='limited'}[[int]$stable.elevation_type];elevated=$stable.elevated
        is_app_container=$stable.is_app_container;has_restrictions=$stable.has_restrictions;restricted_sid_count=$stable.restricted_sids.Count
        process_bitness=([IntPtr]::Size*8);os_bitness=$(if ([Environment]::Is64BitOperatingSystem) {64} else {32})
        powershell_version=$PSVersionTable.PSVersion.ToString();selected_modules=@()
    }
}
function Observer-Context { return Build-ObserverContext (Token-Projection) }
function Provider-Detail([string]$Name) {
    $elevated=$null; $token=$null
    if ($null -ne $script:ObserverContext) { $elevated=$script:ObserverContext.elevated; $token=$script:ObserverContext.token_projection_sha256 }
    return [ordered]@{provider=$Name;status='unavailable';duration_ms=0;exit_code=$null;access='unknown';observer_elevated=$elevated;observer_token_sha256=$token;module=$null;stdout_bytes=0;stderr_bytes=0;failure=$null}
}
function Provider-Failure($Detail,$ErrorRecord) {
    $Detail.failure=Failure-Detail $ErrorRecord; $Detail.status='failed'
    if ($Detail.failure.code -match 'TIMEOUT|TIME_LIMIT') { $Detail.status='timed_out' }
    $base=$ErrorRecord.Exception.GetBaseException()
    if ($base -is [UnauthorizedAccessException] -or $base.HResult -eq -2147024891 -or ($base -is [ComponentModel.Win32Exception] -and $base.NativeErrorCode -eq 5) -or $Detail.exit_code -eq 5) { $Detail.access='denied' }
}
function Save-ProviderDetail($Detail,[Diagnostics.Stopwatch]$Watch) {
    $Detail.duration_ms=[long]$Watch.ElapsedMilliseconds
    if ($script:ProviderDetails.Count -ge 512) { Stop-Code 'INVENTORY_PROVIDER_DIAGNOSTIC_LIMIT' }
    $script:ProviderDetails+=,$Detail
}
function Select-ProviderModule([string]$Module,[string]$Manifest) {
    $record=[ordered]@{name=$Module;manifest_path_sha256=(Digest $Manifest.ToUpperInvariant());manifest_sha256=(Read-File $Manifest $script:FileLimit).sha256}
    $script:SelectedModules[$Module]=$record
    return $record
}
# Only these two source-established DWORD values are read. The key is opened
# without write access and names/values are never enumerated. Unsupported value
# types remain unobserved, so arbitrary strings cannot leak through diagnostics.
function Registry-Value([string]$Name) {
    if ($Name -cnotin @('CodexSandboxOffline','CodexSandboxOnline')) { Stop-Code 'INVENTORY_REGISTRY_SELECTOR_INVALID' }
    Check-Time; $base=$null; $key=$null
    try {
        $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryView]::Registry64)
        $key=$base.OpenSubKey('SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList',$false)
        if ($null -eq $key) { return @{state='absent_at_observation';value_kind=$null;value=$null} }
        # Fixed four-byte native buffer: even a concurrent type replacement
        # cannot cause string, binary or oversized registry data to be read.
        $value=[AidnManagedObserverTokenV1]::RegistryDword($key.Handle.DangerousGetHandle(),$Name)
        Check-Time; return $value
    } finally { if ($null -ne $key) { $key.Dispose() }; if ($null -ne $base) { $base.Dispose() } }
}
function Registry-UserList {
    $rows=@()
    foreach ($name in @('CodexSandboxOffline','CodexSandboxOnline')) {
        $id='HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList\'+$name
        $detail=Provider-Detail 'registry-userlist'; $watch=[Diagnostics.Stopwatch]::StartNew()
        try {
            $value=Registry-Value $name; $detail.status='succeeded'; $detail.access='observed'
            $record=@{view='Registry64';state=$value.state;value_kind=$value.value_kind;value=$value.value}
            $script:DimensionCapture.registry[$id]=@{state=$value.state;sha256=$(if ($value.state -ceq 'observed') { Digest $record } else { $null });record=$record;reason=$null}
            $rows+=,@{id=$id;state=$value.state;sha256=$(if ($value.state -ceq 'observed') { Digest $record } else { $null });failure=$null}
        } catch { Provider-Failure $detail $_; $script:DimensionCapture.registry[$id]=@{state='unobserved';sha256=$null;record=$null;reason=$detail.failure.code}; $rows+=,@{id=$id;state='unobserved';sha256=$null;failure=$detail.failure} }
        finally { Save-ProviderDetail $detail $watch }
    }
    return ,$rows
}
function Query([string]$Kind,[string]$Argument='') {
    $detail=Provider-Detail ('powershell-'+$Kind); $watch=[Diagnostics.Stopwatch]::StartNew(); $script:CurrentProviderDetail=$detail
    try { $rows=Query-Raw $Kind $Argument; $detail.status='succeeded'; $detail.access='observed'; return ,$rows }
    catch { Provider-Failure $detail $_; throw }
    finally { Save-ProviderDetail $detail $watch; $script:CurrentProviderDetail=$null }
}
function Netsh-State($Pin) {
    $detail=Provider-Detail 'netsh-wfp'; $watch=[Diagnostics.Stopwatch]::StartNew(); $script:CurrentProviderDetail=$detail
    try { $xml=Netsh-StateRaw $Pin; $detail.status='succeeded'; $detail.access='observed'; return $xml }
    catch { Provider-Failure $detail $_; throw }
    finally { Save-ProviderDetail $detail $watch; $script:CurrentProviderDetail=$null }
}

# Fixed provider commands only; no executable/script/command supplied by input.
# BeginStop is intentionally not a claim that descendants or a provider stopped.
function Find-ModuleManifest([string]$Module, [string[]]$Roots) {
    if ($Module -cnotin @('Microsoft.PowerShell.LocalAccounts','Microsoft.PowerShell.Security','NetSecurity')) { Stop-Code 'INVENTORY_PROVIDER_MODULE_INVALID' }
    foreach ($root in $Roots) {
        Check-Time
        $folder=[IO.Path]::Combine($root,$Module); $null=Local-Path $folder
        try { $attributes=Path-Attributes $folder } catch { if ((Io-Reason $_) -eq 'INVENTORY_PATH_ABSENT') { continue }; throw }
        if (($attributes -band [IO.FileAttributes]::Directory) -eq 0) { Stop-Code 'INVENTORY_PROVIDER_MODULE_INVALID' }
        $direct=[IO.Path]::Combine($folder,($Module+'.psd1'))
        if ([IO.File]::Exists($direct)) { $null=Local-Path $direct; return $direct }
        $versions=@(); $entries=0
        foreach ($directory in [IO.Directory]::EnumerateDirectories($folder)) {
            Check-Time; $entries++; if ($entries -gt 64) { Stop-Code 'INVENTORY_PROVIDER_VERSION_LIMIT' }
            $name=[IO.Path]::GetFileName($directory)
            if ($name -cnotmatch '^[0-9]{1,5}(?:\.[0-9]{1,5}){1,3}$') { continue }
            $version=$null; if (![Version]::TryParse($name,[ref]$version)) { continue }
            $null=Local-Path $directory
            $candidate=[IO.Path]::Combine($directory,($Module+'.psd1'))
            if ([IO.File]::Exists($candidate)) { $null=Local-Path $candidate; $versions+=,@{version=$version;manifest=$candidate} }
        }
        if ($versions.Count -gt 0) { return @($versions | Sort-Object -Property version -Descending)[0].manifest }
    }
    Stop-Code 'INVENTORY_PROVIDER_MODULE_UNAVAILABLE'
}
function Official-ModuleManifest([string]$Module) {
    # Prefer modules shipped with this interpreter. In particular PS7 must not
    # import the Windows PowerShell 5 Security module. Never consult PSModulePath.
    $roots=@([IO.Path]::Combine($PSHOME,'Modules'),[IO.Path]::Combine([Environment]::SystemDirectory,'WindowsPowerShell\v1.0\Modules'))
    return Find-ModuleManifest $Module $roots
}
function Query-Raw([string]$Kind, [string]$Argument = '') {
    Check-Time; $ps = [PowerShell]::Create(); $done = $false
    try {
        switch ($Kind) {
            'accounts' { $module='Microsoft.PowerShell.LocalAccounts'; $command='Get-LocalUser'; $fields=@('Name','SID','Enabled','AccountExpires','PasswordChangeableDate','PasswordExpires','UserMayChangePassword','PasswordRequired','PasswordLastSet','PrincipalSource') }
            'groups' { $module='Microsoft.PowerShell.LocalAccounts'; $command='Get-LocalGroup'; $fields=@('Name','SID','PrincipalSource') }
            'members' { $module='Microsoft.PowerShell.LocalAccounts'; $command='Get-LocalGroupMember'; $fields=@('Name','SID','ObjectClass','PrincipalSource') }
            'firewall' { $module='NetSecurity'; $command='Get-NetFirewallRule'; $fields=@('Name','InstanceID','Enabled','Profile','Direction','Action','EdgeTraversalPolicy','LooseSourceMapping','LocalOnlyMapping','Owner','PrimaryStatus','StatusCode','PolicyStoreSource','PolicyStoreSourceType','EnforcementStatus') }
            'acl' { $module='Microsoft.PowerShell.Security'; $command='Get-Acl'; $fields=@('Sddl') }
            default { Stop-Code 'INVENTORY_QUERY_INVALID' }
        }
        $manifest = Official-ModuleManifest $module
        $script:CurrentProviderDetail.module=Select-ProviderModule $module $manifest
        $null = $ps.AddCommand('Microsoft.PowerShell.Core\Import-Module').AddParameter('Name',$manifest).AddParameter('ErrorAction','Stop').AddStatement()
        $null = $ps.AddCommand(($module + '\' + $command)).AddParameter('ErrorAction','Stop')
        if ($Kind -eq 'members') { $null=$ps.AddParameter('Group',$Argument) }
        if ($Kind -eq 'firewall') { $null=$ps.AddParameter('PolicyStore','ActiveStore') }
        if ($Kind -eq 'acl') { $null=$ps.AddParameter('LiteralPath',$Argument) }
        $null=$ps.AddCommand('Microsoft.PowerShell.Utility\Select-Object').AddParameter('Property',$fields).AddParameter('First',($script:MaxRows+1))
        $pending=$ps.BeginInvoke()
        if (!$pending.AsyncWaitHandle.WaitOne((Remaining))) {
            $null=$ps.BeginStop($null,$null); $script:UnstoppedProvider=$true
            Stop-Code 'INVENTORY_QUERY_TIMEOUT_STOP_UNCONFIRMED'
        }
        $raw=@($ps.EndInvoke($pending)); $done=$true
        if ($ps.HadErrors) { Stop-Code 'INVENTORY_PROVIDER_QUERY_FAILED' }
        if ($raw.Count -gt $script:MaxRows) { Stop-Code 'INVENTORY_ROW_LIMIT' }
        $rows=@(); [long]$projectedBytes=0; foreach ($row in $raw) {
            $projection=[ordered]@{}; foreach ($field in $fields) {
                $v=$row.$field
                if ($null -eq $v) { $projection[$field]=$null }
                elseif ($v -is [DateTime]) { $projection[$field]=$v.ToUniversalTime().ToString('o') }
                else {
                    $string=[string]$v; $projectedBytes += $script:Utf8.GetByteCount($string)
                    if ($string.Length -gt 65536 -or $projectedBytes -gt $script:OutputLimit) { Stop-Code 'INVENTORY_QUERY_OUTPUT_LIMIT' }
                    $projection[$field]=$string
                }
            }; $rows+=,$projection
        }
        Check-Time; return ,$rows
    } finally { if ($done) { $ps.Dispose() } }
}
function Netsh-StateRaw($Pin) {
    $expected=[IO.Path]::Combine([Environment]::SystemDirectory,'netsh.exe')
    if (![string]::Equals($Pin.path,$expected,[StringComparison]::OrdinalIgnoreCase)) { Stop-Code 'INVENTORY_NETSH_PATH_INVALID' }
    if ((Read-File $Pin.path $script:FileLimit).sha256 -cne $Pin.sha256) { Stop-Code 'INVENTORY_NETSH_PIN_CHANGED' }
    $info=New-Object Diagnostics.ProcessStartInfo
    $info.FileName=$expected; $info.Arguments='wfp show state file=-'
    $info.UseShellExecute=$false; $info.CreateNoWindow=$true
    $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
    $process=New-Object Diagnostics.Process; $process.StartInfo=$info
    $closed=$false; $started=$false
    try {
        Check-Time; $started=$process.Start(); if (!$started) { Stop-Code 'INVENTORY_NETSH_START_FAILED' }
        $until=$script:Clock.ElapsedMilliseconds + (Remaining)
        $out=New-Object Text.StringBuilder; $errCount=0; $outCount=0
        $obuf=New-Object char[] 4096; $ebuf=New-Object char[] 4096
        $ot=$process.StandardOutput.ReadAsync($obuf,0,$obuf.Length)
        $et=$process.StandardError.ReadAsync($ebuf,0,$ebuf.Length)
        while ($null -ne $ot -or $null -ne $et -or !$process.HasExited) {
            Check-Time; if ($script:Clock.ElapsedMilliseconds -gt $until) { Stop-Code 'INVENTORY_NETSH_TIMEOUT' }
            if ($null -ne $ot -and $ot.IsCompleted) {
                $n=$ot.GetAwaiter().GetResult(); $ot=$null
                if ($n -gt 0) { $outCount += $script:Utf8.GetByteCount($obuf,0,$n); $script:CurrentProviderDetail.stdout_bytes=$outCount; if ($outCount -gt $script:OutputLimit) { Stop-Code 'INVENTORY_NETSH_OUTPUT_LIMIT' }; $null=$out.Append($obuf,0,$n); $ot=$process.StandardOutput.ReadAsync($obuf,0,$obuf.Length) }
            }
            if ($null -ne $et -and $et.IsCompleted) {
                $n=$et.GetAwaiter().GetResult(); $et=$null
                if ($n -gt 0) { $errCount += $script:Utf8.GetByteCount($ebuf,0,$n); $script:CurrentProviderDetail.stderr_bytes=$errCount; if ($errCount -gt 65536) { Stop-Code 'INVENTORY_NETSH_OUTPUT_LIMIT' }; $et=$process.StandardError.ReadAsync($ebuf,0,$ebuf.Length) }
            }
            [Threading.Thread]::Sleep(5)
        }
        $closed=$true; $script:CurrentProviderDetail.exit_code=$process.ExitCode; $script:CurrentProviderDetail.stdout_bytes=$outCount; $script:CurrentProviderDetail.stderr_bytes=$errCount
        if ($process.ExitCode -ne 0 -or $errCount -gt 0) { Stop-Code 'INVENTORY_NETSH_QUERY_FAILED' }
        return $out.ToString()
    } finally {
        if ($started -and !$closed) { try { if (!$process.HasExited) { $process.Kill(); $null=$process.WaitForExit(250) } } catch {}; $script:UnstoppedProvider=$true }
        $process.Dispose()
    }
}
function Parse-Wfp([string]$Xml) {
    $settings=New-Object Xml.XmlReaderSettings
    $settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit; $settings.XmlResolver=$null
    $settings.MaxCharactersInDocument=$script:OutputLimit; $settings.IgnoreWhitespace=$true
    $text=New-Object IO.StringReader($Xml); $reader=[Xml.XmlReader]::Create($text,$settings)
    try { $doc=New-Object Xml.XmlDocument; $doc.XmlResolver=$null; $doc.Load($reader) } finally { $reader.Dispose(); $text.Dispose() }
    $rows=@(); $found=@{}
    # Only direct key children count: references to a provider on a filter must
    # not be mistaken for the provider record. Unknown layouts are partial.
    foreach ($kind in @('providerKey','subLayerKey','filterKey')) {
        $keys=@($doc.SelectNodes(('//*[local-name()="' + $kind + '"]')))
        if ($keys.Count -gt $script:MaxRows) { Stop-Code 'INVENTORY_WFP_ROW_LIMIT' }
        foreach ($key in $keys) {
            Check-Time; $parent=$key.ParentNode
            $section=$parent.ParentNode.LocalName.ToLowerInvariant()
            if (($kind -eq 'providerKey' -and $section -ne 'providers') -or ($kind -eq 'subLayerKey' -and $section -ne 'sublayers') -or ($kind -eq 'filterKey' -and $section -ne 'filters')) { continue }
            $guid=[Guid]::Empty
            if (![Guid]::TryParse($key.InnerText,[ref]$guid)) { Stop-Code 'INVENTORY_WFP_SCHEMA_UNSUPPORTED' }
            $id=$guid.ToString('D'); if ($found.ContainsKey($id)) { Stop-Code 'INVENTORY_WFP_DUPLICATE_ID' }; $found[$id]=$true
            $rows+=,@{id=$id;sha256=(Digest-Bytes ($script:Utf8.GetBytes($parent.OuterXml)))}
        }
    }
    if ($rows.Count -eq 0) { Stop-Code 'INVENTORY_WFP_SCHEMA_UNSUPPORTED' }
    return ,$rows
}

# These transformations retain only fixed public fields already read above.
# They call no provider, use no clock and never turn candidates into complete receipts.
function Candidate-Field($Object,[string]$Name) {
    if ($Object -is [Collections.IDictionary]) { if ($Object.Contains($Name)) { return ,($Object[$Name]) }; return $null }
    if ($Object -is [pscustomobject]) {
        $property=$Object.PSObject.Properties[$Name]
        if ($null -ne $property -and $property.MemberType -eq [Management.Automation.PSMemberTypes]::NoteProperty) { return ,($property.Value) }
    }
    return $null
}
function Candidate-HasField($Object,[string]$Name) {
    if ($Object -is [Collections.IDictionary]) { return $Object.Contains($Name) }
    if ($Object -is [pscustomobject]) { $p=$Object.PSObject.Properties[$Name]; return $null -ne $p -and $p.MemberType -eq [Management.Automation.PSMemberTypes]::NoteProperty }
    return $false
}
function Candidate-Sid($Value) {
    return $Value -is [string] -and $Value.Length -le 184 -and $Value -cmatch '^S-1-[0-9]+(?:-[0-9]+){1,15}$'
}
function Candidate-Digest($Value) { return $Value -is [string] -and $Value -cmatch '^[a-f0-9]{64}$' }
function Candidate-SecretPath([string]$Path) {
    return $Path -match '(?i)(?:^|[\\/])(?:\.sandbox-secrets|auth\.json|credentials(?:\.json)?|sandbox_users\.json)(?:[\\/]|$)'
}
function Candidate-Date($Value) {
    if ($Value -isnot [string] -or $Value.Length -gt 40 -or $Value -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$') { return $null }
    $parsed=[DateTimeOffset]::MinValue
    if (![DateTimeOffset]::TryParse($Value,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::None,[ref]$parsed)) { return $null }
    return $parsed.UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
}
function New-DimensionCapture {
    return @{accounts=@{};groups=@{};files=@{};acls=@{};registry=@{};accounts_complete=$false;groups_complete=$false}
}
function Assert-CandidateJson($Value,[int]$Depth,$Budget) {
    $Budget.nodes++
    if ($Depth -gt 24 -or $Budget.nodes -gt 100000) { Stop-Code 'INVENTORY_CANDIDATE_JSON_LIMIT' }
    if ($null -eq $Value -or $Value -is [bool]) { return }
    if ($Value -is [string]) {
        $Budget.bytes+=$script:Utf8.GetByteCount($Value)
        if ($Budget.bytes -gt 16777216) { Stop-Code 'INVENTORY_CANDIDATE_JSON_LIMIT' }
        return
    }
    if ($Value -is [int] -or $Value -is [long] -or $Value -is [uint32]) { return }
    if ($Value -is [Array]) { foreach ($item in $Value) { Assert-CandidateJson $item ($Depth+1) $Budget }; return }
    if ($Value -is [hashtable] -or $Value -is [Collections.Specialized.OrderedDictionary]) {
        foreach ($name in $Value.Keys) { if ($name -isnot [string]) { Stop-Code 'INVENTORY_CANDIDATE_JSON_INVALID' }; Assert-CandidateJson $Value[$name] ($Depth+1) $Budget }
        return
    }
    if ($Value -is [pscustomobject]) {
        foreach ($property in $Value.PSObject.Properties) {
            if ($property.MemberType -ne [Management.Automation.PSMemberTypes]::NoteProperty) { Stop-Code 'INVENTORY_CANDIDATE_JSON_INVALID' }
            Assert-CandidateJson $property.Value ($Depth+1) $Budget
        }
        return
    }
    Stop-Code 'INVENTORY_CANDIDATE_JSON_INVALID'
}
function Build-DimensionCandidates($Captured,$Inventory,$ObserverContext) {
    $budget=@{nodes=0;bytes=0}; foreach ($value in @($Captured,$Inventory,$ObserverContext)) { Assert-CandidateJson $value 0 $budget }
    $profiles=@()
    $definitions=@(
        @{id='accounts-public.v1';kind='local_account';source='accounts';required=@('sid','flags','password_last_set')},
        @{id='groups-membership.v1';kind='local_group';source='groups';required=@('sid','members')},
        @{id='filesystem-state.v1';kind='filesystem';source='files';required=@('physical_path','file_id','object_type','attributes','content_sha256')},
        @{id='filesystem-dacl.v1';kind='filesystem_acl';source='acls';required=@('owner_sid','group_sid','dacl_sha256','control_flags','inheritance','descendant_paths')},
        @{id='registry-userlist.v1';kind='registry';source='registry';required=@('registry_view','value_type','value_data')}
    )
    $inventoryRows=@($Inventory.resources)+@($Inventory.protected_resources)
    if ($inventoryRows.Count -gt 1024) { Stop-Code 'INVENTORY_CANDIDATE_LIMIT' }
    foreach ($definition in $definitions) {
        $rows=@(); $selected=@{}
        foreach ($observed in $inventoryRows) {
            if ($observed.kind -cne $definition.kind) { continue }
            if ($observed.id -isnot [string] -or ($null -ne $observed.sha256 -and !(Candidate-Digest $observed.sha256))) { Stop-Code 'INVENTORY_CANDIDATE_BINDING_INVALID' }
            $id=[string]$observed.id; $inventoryId=$id
            $captureMap=Candidate-Field $Captured $definition.source
            $entry=Candidate-Field $captureMap $id
            if ($definition.kind -ceq 'local_account' -and $id -cnotin @('CodexSandboxOffline','CodexSandboxOnline')) { continue }
            if ($definition.kind -ceq 'local_group') {
                $record=Candidate-Field $entry 'record'; $group=Candidate-Field $record 'group'
                $name=Candidate-Field $group 'Name'; $sid=Candidate-Field $group 'SID'
                if ($id -ceq 'CodexSandboxUsers' -or $name -ceq 'CodexSandboxUsers') { $id='CodexSandboxUsers' }
                elseif ($id -ceq 'S-1-5-32-545' -or $sid -ceq 'S-1-5-32-545') { $id='S-1-5-32-545' }
                else { continue }
            }
            if ($definition.kind -ceq 'registry') {
                $registry='HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList'
                $name=$null
                foreach ($allowed in @('CodexSandboxOffline','CodexSandboxOnline')) {
                    if ($id -ceq ($registry+'\'+$allowed) -or $id -ceq ($registry+'#value='+$allowed)) { $name=$allowed }
                }
                if ($null -eq $name) { continue }
                $id=$registry+'#value='+$name
                if ($null -eq $entry) { $entry=Candidate-Field $captureMap ($registry+'\'+$name) }
            }
            if ($definition.kind -in @('filesystem','filesystem_acl')) {
                # Paths must have been selected and checked by the historical main.
                # A synthetic entry cannot introduce an undeclared path.
                if ($null -eq $entry) {
                    $entry=@{state='unobserved';sha256=$null;record=$null;reason='INVENTORY_PATH_NOT_OBSERVED'}
                }
            }
            if ($selected.ContainsKey($id)) { Stop-Code 'INVENTORY_CANDIDATE_ID_AMBIGUOUS' }
            $selected[$id]=$true
            $dimensions=[ordered]@{}; $state='unobserved'; $reason='INVENTORY_CANDIDATE_NOT_OBSERVED'
            if ($null -eq $entry -and (($definition.kind -ceq 'local_account' -and $Captured.accounts_complete -eq $true) -or ($definition.kind -ceq 'local_group' -and $Captured.groups_complete -eq $true))) {
                $entry=@{state='absent_at_observation';sha256=$null;record=$null;reason='INVENTORY_PATH_ABSENT'}
            }
            $entryState=Candidate-Field $entry 'state'; $entryHash=Candidate-Field $entry 'sha256'
            $record=Candidate-Field $entry 'record'
            if ($entryState -ceq 'absent_at_observation' -and $null -eq $observed.sha256 -and $null -eq $entryHash) {
                $state='absent_at_observation'; $reason=$null
                $dimensions.exists=$false; $dimensions.absence_reason='not_found'
            } elseif ($entryState -ceq 'observed' -and (Candidate-Digest $entryHash) -and $entryHash -ceq $observed.sha256) {
                $state='observed'; $reason=$null; $dimensions.exists=$true
                switch ($definition.kind) {
                    'local_account' {
                        $sid=Candidate-Field $record 'SID'; if (Candidate-Sid $sid) { $dimensions.sid=$sid }
                        if (Candidate-HasField $record 'PasswordLastSet') {
                            $date=Candidate-Field $record 'PasswordLastSet'
                            if ($null -eq $date) { $dimensions.password_last_set=$null }
                            else { $normal=Candidate-Date $date; if ($null -ne $normal) { $dimensions.password_last_set=$normal } }
                        }
                    }
                    'local_group' {
                        $group=Candidate-Field $record 'group'; $sid=Candidate-Field $group 'SID'
                        if (Candidate-Sid $sid) { $dimensions.sid=$sid }
                        $members=Candidate-Field $record 'members'
                        if ($members -is [Array] -and $members.Count -le 20000) {
                            $memberSids=@(); $valid=$true
                            foreach ($member in $members) { $memberSid=Candidate-Field $member 'SID'; if (!(Candidate-Sid $memberSid)) { $valid=$false; break }; $memberSids+=,$memberSid }
                            if ($valid) { $dimensions.members=@($memberSids | Sort-Object -Unique) }
                        }
                    }
                    'filesystem' {
                        $directory=Candidate-Field $record 'directory'; $attributes=Candidate-Field $record 'attributes'
                        if ($directory -is [bool]) { $dimensions.object_type=$(if($directory){'directory'}else{'file'}) }
                        if (($attributes -is [int] -or $attributes -is [long]) -and $attributes -ge 0 -and $attributes -le [int]::MaxValue) { $dimensions.attributes=[int]$attributes }
                        if (Candidate-SecretPath $id) {
                            # Policy null means deliberately forbidden content, not missing evidence.
                            $dimensions.content_sha256=$null
                        } else {
                            $contentHash=Candidate-Field $record 'content_sha256'
                            if ((Candidate-Digest $contentHash) -and $directory -eq $false) { $dimensions.content_sha256=$contentHash }
                        }
                    }
                    'filesystem_acl' {
                        $sddl=Candidate-Field $record 'Sddl'
                        if ($sddl -is [string] -and $sddl.Length -le 65536) {
                            try {
                                $descriptor=[Security.AccessControl.RawSecurityDescriptor]::new($sddl)
                                if ($null -ne $descriptor.Owner) { $dimensions.owner_sid=$descriptor.Owner.Value }
                                if ($null -ne $descriptor.Group) { $dimensions.group_sid=$descriptor.Group.Value }
                                $dimensions.control_flags=[int]$descriptor.ControlFlags
                                $dimensions.inheritance=$(if (($descriptor.ControlFlags -band [Security.AccessControl.ControlFlags]::DiscretionaryAclProtected) -ne 0) {'protected'} else {'not_protected'})
                                if ($null -ne $descriptor.DiscretionaryAcl) {
                                    $bytes=[byte[]]::new($descriptor.DiscretionaryAcl.BinaryLength)
                                    $descriptor.DiscretionaryAcl.GetBinaryForm($bytes,0)
                                    $dimensions.dacl_sha256=Digest-Bytes $bytes
                                }
                            } catch { $reason='INVENTORY_CANDIDATE_SDDL_INVALID'; $dimensions=[ordered]@{exists=$true} }
                        }
                    }
                    'registry' {
                        $view=Candidate-Field $record 'view'; $kind=Candidate-Field $record 'value_kind'; $data=Candidate-Field $record 'value'
                        if ($view -ceq 'Registry64' -and $kind -ceq 'DWord' -and ($data -is [int] -or $data -is [long] -or $data -is [uint32]) -and $data -ge 0 -and $data -le [uint32]::MaxValue) {
                            $dimensions.registry_view='Registry64'; $dimensions.value_type='DWord'; $dimensions.value_data=[long]$data
                        }
                    }
                }
            } elseif ($null -ne $entry -and (Candidate-Field $entry 'reason') -ceq 'INVENTORY_PATH_ACCESS_DENIED') { $reason='INVENTORY_PATH_ACCESS_DENIED' }
            elseif ($null -ne $entry -and (Candidate-Field $entry 'reason') -ceq 'INVENTORY_CREDENTIAL_CONTENT_FORBIDDEN') { $reason='INVENTORY_CREDENTIAL_CONTENT_FORBIDDEN' }
            elseif ($entryState -ceq 'observed') { $reason='INVENTORY_CANDIDATE_HASH_MISMATCH' }
            $missing=@()
            if ($state -cne 'absent_at_observation') { foreach ($dimension in $definition.required) { if (!$dimensions.Contains($dimension)) { $missing+=,$dimension } } }
            if ($state -ceq 'unobserved') { $missing=@('exists')+$missing }
            $rows+=,[ordered]@{id=$id;inventory_id=$inventoryId;resource_sha256=$observed.sha256;state=$state;dimensions=$dimensions;missing_dimensions=$missing;reason_code=$reason}
        }
        $profiles+=,[ordered]@{profile_id=$definition.id;status='partial';rows=@($rows | Sort-Object id)}
    }
    return [ordered]@{contract_version='codex-managed-sandbox-dimension-candidates.v1';status='partial'
        inventory_sha256=(Digest $Inventory);observer_context_sha256=(Digest $ObserverContext);profiles=$profiles}
}


function Report-Json($Value, [long]$Limit) {
    $json=ConvertTo-Json -InputObject $Value -Depth 20 -Compress
    if ($script:Utf8.GetByteCount($json) + 2 -gt $Limit) {
        return '{"contract_version":"codex-managed-sandbox-observation.v1","status":"PREPARATION_BLOCKED","effect_class":"read-only","written":false,"native_execution":"NOT_EXECUTED","inventory":null,"dimension_candidates":null,"diagnostics":[],"errors":[{"code":"INVENTORY_FINAL_OUTPUT_LIMIT","phase":"report.serialize","exception_type":null,"script_line":null}]}'
    }
    return $json
}

$report=[ordered]@{contract_version='codex-managed-sandbox-observation.v1';status='PREPARATION_BLOCKED';effect_class='read-only';written=$false;native_execution='NOT_EXECUTED';observer_context=$null;inventory=$null;dimension_candidates=$null;diagnostics=@();errors=@()}
try {
    $report.dimension_candidates=$null; $script:DimensionCapture=New-DimensionCapture
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { Stop-Code 'INVENTORY_WINDOWS_REQUIRED' }
    $script:Phase='request.read'
    $requestBytes=Read-File $RequestPath 262144 $true
    $script:Phase='request.parse'
    $request=ConvertFrom-Json -InputObject ($script:Utf8.GetString($requestBytes.content))
    $script:Phase='request.validate'
    Exact-Keys $request @('contract_version','host_id','client','manifest_sha256','resources','protected_resources','paths','netsh','limits')
    if ($request.contract_version -cne 'codex-managed-sandbox-observation-request.v1') { Stop-Code 'INVENTORY_REQUEST_VERSION' }
    Safe-Id $request.host_id
    if (![string]::Equals($request.host_id,[Environment]::MachineName,[StringComparison]::OrdinalIgnoreCase)) { Stop-Code 'INVENTORY_HOST_ID_MISMATCH' }
    if ($request.manifest_sha256 -cnotmatch '^[a-f0-9]{64}$') { Stop-Code 'INVENTORY_MANIFEST_HASH' }
    foreach ($pin in @($request.client,$request.netsh)) { Exact-Keys $pin @('path','sha256'); if ($pin.sha256 -cnotmatch '^[a-f0-9]{64}$') { Stop-Code 'INVENTORY_PIN_INVALID' }; $null=Local-Path $pin.path }
    Exact-Keys $request.limits @('max_duration_ms','query_timeout_ms','max_rows','max_file_bytes','max_output_bytes')
    foreach ($pair in @(@('max_duration_ms',1000,60000),@('query_timeout_ms',100,10000),@('max_rows',1,20000),@('max_file_bytes',1024,268435456),@('max_output_bytes',1024,16777216))) {
        $v=$request.limits.($pair[0]); if ($v -isnot [long] -and $v -isnot [int]) { Stop-Code 'INVENTORY_LIMIT_INVALID' }
        if ($v -lt $pair[1] -or $v -gt $pair[2]) { Stop-Code 'INVENTORY_LIMIT_INVALID' }
    }
    $script:BudgetMs=$request.limits.max_duration_ms; $script:QueryMs=$request.limits.query_timeout_ms
    $script:MaxRows=$request.limits.max_rows; $script:FileLimit=$request.limits.max_file_bytes; $script:OutputLimit=$request.limits.max_output_bytes
    # The installed signed client is larger than the ordinary-file ceiling.
    # This exception is confined to this one explicitly pinned executable.
    $script:Phase='client.verify'
    if ((Read-File $request.client.path 536870912).sha256 -cne $request.client.sha256) { Stop-Code 'INVENTORY_CLIENT_PIN_CHANGED' }
    $script:Phase='request.resources'
    $seen=@{}; $requested=@()
    foreach ($list in @('resources','protected_resources')) {
        if ($request.$list -isnot [Array] -or $request.$list.Count -gt 512) { Stop-Code 'INVENTORY_RESOURCE_LIST' }
        foreach ($row in $request.$list) {
            Exact-Keys $row @('kind','id'); Safe-Id $row.id
            if ($script:Kinds -cnotcontains $row.kind) { Stop-Code 'INVENTORY_RESOURCE_KIND' }
            $key=$row.kind + ':' + $row.id; if ($seen.ContainsKey($key)) { Stop-Code 'INVENTORY_RESOURCE_DUPLICATE' }; $seen[$key]=$true
            $requested+=,$row
        }
    }
    if ($request.paths -isnot [Array] -or $request.paths.Count -gt 512) { Stop-Code 'INVENTORY_PATH_LIST' }
    $pathMap=@{}; $pathSeen=@{}; $pathFailures=@{}
    $script:Phase='request.paths'
    foreach ($item in $request.paths) {
        Exact-Keys $item @('id','path','hash_content'); Safe-Id $item.id
        if ($item.hash_content -isnot [bool]) { Stop-Code 'INVENTORY_PATH_LIST' }
        try { $null=Local-Path $item.path }
        catch {
            if ((Reason $_) -ne 'INVENTORY_PATH_ACCESS_DENIED') { throw }
            # No path or ACL query may follow an unverified inaccessible path.
            # Retain the row as inconclusive, with no privilege/ACL workaround.
            $pathFailures[$item.id]=Failure-Detail $_
        }
        if (![string]::Equals($item.id,$item.path,[StringComparison]::OrdinalIgnoreCase)) { Stop-Code 'INVENTORY_PATH_ID_MISMATCH' }
        if ($pathMap.ContainsKey($item.id) -or $pathSeen.ContainsKey($item.path)) { Stop-Code 'INVENTORY_PATH_DUPLICATE' }
        if ($item.hash_content -and $item.path -match '(?i)(?:^|[\\/])(?:\.sandbox-secrets|auth\.json|credentials(?:\.json)?|sandbox_users\.json)(?:[\\/]|$)') { Stop-Code 'INVENTORY_CREDENTIAL_CONTENT_FORBIDDEN' }
        if (!$seen.ContainsKey('filesystem:'+$item.id) -and !$seen.ContainsKey('filesystem_acl:'+$item.id)) { Stop-Code 'INVENTORY_PATH_NOT_REQUESTED' }
        $pathMap[$item.id]=$item; $pathSeen[$item.path]=$true
    }
    foreach ($row in $requested) { if ($row.kind -in @('filesystem','filesystem_acl') -and !$pathMap.ContainsKey($row.id)) { Stop-Code 'INVENTORY_PATH_REQUIRED' } }
    $script:Phase='observer.context'
    $script:SelectedModules=@{}; $script:ObserverContext=Observer-Context; $report.observer_context=$script:ObserverContext
    $observed=@{}; $coverage=@(); $diag=@()
    foreach ($kind in $script:Kinds) {
        $script:Phase='observe.'+$kind
        $failure=$null; $pathDiagnostics=@(); $registryDiagnostics=@(); $script:ProviderDetails=@()
        $projection=@(); $reason='INVENTORY_PROVIDER_NOT_IMPLEMENTED'; $scope=[ordered]@{observer='managed-windows-observer.v1';kind=$kind;observer_token_sha256=$script:ObserverContext.token_projection_sha256;observer_process_bitness=$script:ObserverContext.process_bitness;selectors=@();projection='unavailable'}
        try {
            Check-Time
            switch ($kind) {
                'local_account' {
                    $scope.projection='Get-LocalUser selected public account fields'; $scope.selectors=@('*')
                    $rows=Query 'accounts'; foreach ($r in $rows) { $hash=Digest $r; $observed['local_account:'+$r.Name]=$hash; $observed['local_account:'+$r.SID]=$hash; $projection+=,@{id=$r.Name;sha256=$hash}
                        if ($r.Name -cin @('CodexSandboxOffline','CodexSandboxOnline')) { $script:DimensionCapture.accounts[$r.Name]=@{state='observed';sha256=$hash;record=$r;reason=$null} }
                    }; $script:DimensionCapture.accounts_complete=$true
                    $reason='INVENTORY_ACCOUNT_PASSWORD_AND_POLICY_NOT_OBSERVED'
                }
                'local_group' {
                    $scope.projection='Get-LocalGroup and member SID projections'; $scope.selectors=@('*')
                    $rows=Query 'groups'; foreach ($r in $rows) { $members=Query 'members' $r.Name; $memberRows=@($members | Sort-Object SID,Name); $hash=Digest @{group=$r;members=$memberRows}; $observed['local_group:'+$r.Name]=$hash; $observed['local_group:'+$r.SID]=$hash; $projection+=,@{id=$r.Name;sha256=$hash}
                        if ($r.Name -ceq 'CodexSandboxUsers' -or $r.SID -ceq 'S-1-5-32-545') {
                            $entry=@{state='observed';sha256=$hash;record=@{group=$r;members=$memberRows};reason=$null}
                            $script:DimensionCapture.groups[$r.Name]=$entry; $script:DimensionCapture.groups[$r.SID]=$entry
                        }
                    }; $script:DimensionCapture.groups_complete=$true
                    $reason='INVENTORY_GROUP_SECURITY_DESCRIPTOR_NOT_OBSERVED'
                }
                'filesystem' {
                    $scope.projection='explicit path metadata and opt-in file bytes; no recursive inventory'; $scope.selectors=@($request.paths | ForEach-Object { @{id=$_.id;path=$_.path;hash_content=$_.hash_content} })
                    foreach ($p in $request.paths) {
                        if ($pathFailures.ContainsKey($p.id)) { $pathDiagnostics+=,@{id=$p.id;state='unobserved';failure=$pathFailures[$p.id]}; continue }
                        try { $metadata=Path-Metadata $p.path } catch { $pathDiagnostics+=,@{id=$p.id;state='unobserved';failure=(Failure-Detail $_)}; continue }
                        if ($null -eq $metadata) { $pathDiagnostics+=,@{id=$p.id;state='absent_at_observation';failure=$null}; continue }
                        $record=@{directory=$metadata.directory;attributes=$metadata.attributes;bytes=$metadata.bytes}
                        $contentHash=$null
                        $hash=Digest $record
                        if (!$metadata.directory -and $p.hash_content) {
                            $limit=$script:FileLimit
                            $clientFile=[string]::Equals($p.path,$request.client.path,[StringComparison]::OrdinalIgnoreCase)
                            if ($clientFile) { $limit=536870912 }
                            try { $hash=(Read-File $p.path $limit).sha256; $contentHash=$hash }
                            catch { $pathDiagnostics+=,@{id=$p.id;state='unobserved';failure=(Failure-Detail $_)}; continue }
                            if ($clientFile -and $hash -cne $request.client.sha256) { Stop-Code 'INVENTORY_CLIENT_PIN_CHANGED' }
                        }
                        $observed['filesystem:'+$p.id]=$hash; $projection+=,@{id=$p.id;sha256=$hash}
                        $script:DimensionCapture.files[$p.id]=@{state='observed';sha256=$hash;record=@{directory=$metadata.directory;attributes=$metadata.attributes;content_sha256=$contentHash};reason=$null}
                    }; $reason='INVENTORY_FILESYSTEM_DESCENDANTS_STREAMS_AND_LINKS_NOT_OBSERVED'
                }
                'filesystem_acl' {
                    $scope.projection='Get-Acl exact path owner/group/DACL SDDL, no SACL or descendant traversal'; $scope.selectors=@($request.paths | ForEach-Object { @{id=$_.id;path=$_.path} })
                    foreach ($p in $request.paths) {
                        if ($pathFailures.ContainsKey($p.id)) { $pathDiagnostics+=,@{id=$p.id;state='unobserved';failure=$pathFailures[$p.id]}; continue }
                        try {
                            if ($null -eq (Path-Metadata $p.path)) { $pathDiagnostics+=,@{id=$p.id;state='absent_at_observation';failure=$null}; continue }
                            $rows=Query 'acl' $p.path; if ($rows.Count -ne 1 -or !$rows[0].Sddl) { Stop-Code 'INVENTORY_ACL_NOT_OBSERVED' }
                        } catch { $pathDiagnostics+=,@{id=$p.id;state='unobserved';failure=(Failure-Detail $_)}; continue }
                        $hash=Digest $rows[0]; $observed['filesystem_acl:'+$p.id]=$hash; $projection+=,@{id=$p.id;sha256=$hash}
                        $script:DimensionCapture.acls[$p.id]=@{state='observed';sha256=$hash;record=$rows[0];reason=$null}
                    }; $reason='INVENTORY_ACL_SACL_INHERITANCE_AND_DESCENDANTS_NOT_OBSERVED'
                }
                'firewall_rule' {
                    $scope.projection='Get-NetFirewallRule ActiveStore full selected rule projections; filter associations and effective policy missing'; $scope.selectors=@('ActiveStore:*')
                    $rows=Query 'firewall'; foreach ($r in $rows) { $key='firewall_rule:'+$r.Name; if ($observed.ContainsKey($key)) { Stop-Code 'INVENTORY_FIREWALL_ID_AMBIGUOUS' }; $hash=Digest $r; $observed[$key]=$hash; $projection+=,@{id=$r.Name;sha256=$hash} }
                    $reason='INVENTORY_FIREWALL_ASSOCIATED_FILTERS_AND_POLICY_NOT_OBSERVED'
                }
                'wfp_rule' {
                    $scope.projection='netsh wfp show state file=- provider/sublayer/filter XML records; other WFP objects and security omitted'; $scope.selectors=@('providers:*','sublayers:*','filters:*'); $scope['netsh_sha256']=$request.netsh.sha256
                    $rows=Parse-Wfp (Netsh-State $request.netsh); foreach ($r in $rows) { $observed['wfp_rule:'+$r.id]=$r.sha256; $projection+=,$r }
                    $reason='INVENTORY_WFP_OTHER_OBJECTS_SECURITY_AND_CONCURRENT_CHANGES_NOT_OBSERVED'
                }
                'desktop' { $reason='INVENTORY_DESKTOP_NAMESPACE_AND_SECURITY_PROVIDER_UNAVAILABLE' }
                'device_acl' { $reason='INVENTORY_NT_DEVICE_SECURITY_PROVIDER_UNAVAILABLE' }
                'local_policy' { $reason='INVENTORY_LSA_RIGHTS_AND_EFFECTIVE_POLICY_PROVIDER_UNAVAILABLE' }
                'service' { $reason='INVENTORY_SERVICE_EFFECT_SCOPE_NOT_ESTABLISHED' }
                'registry' {
                    $scope.projection='two exact UserList DWORD values in Registry64; no key security, inheritance or other values'; $scope.selectors=@('HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList\CodexSandboxOffline','HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList\CodexSandboxOnline')
                    $registryDiagnostics=Registry-UserList
                    foreach ($r in $registryDiagnostics) {
                        if ($r.state -ceq 'observed') { $observed['registry:'+$r.id]=$r.sha256 }
                        if ($r.state -cne 'unobserved') { $projection+=,@{id=$r.id;sha256=(Digest @{state=$r.state;sha256=$r.sha256})} }
                    }
                    $reason='INVENTORY_REGISTRY_KEY_SECURITY_AND_PHASE_SCOPE_NOT_ESTABLISHED'
                }
            }
        } catch { $reason=Reason $_; $failure=Failure-Detail $_ }
        if ($kind -cin @('filesystem','filesystem_acl')) {
            $captureMap=$(if($kind -ceq 'filesystem'){$script:DimensionCapture.files}else{$script:DimensionCapture.acls})
            foreach ($diagnostic in $pathDiagnostics) {
                $captureMap[$diagnostic.id]=@{state=$diagnostic.state;sha256=$null;record=$null;reason=$(if($null -ne $diagnostic.failure){$diagnostic.failure.code}else{$null})}
            }
        }
        $scope['provider_modules']=@($script:ProviderDetails | Where-Object { $null -ne $_.module } | ForEach-Object { $_.module } | Sort-Object name,manifest_sha256 -Unique)
        $stable=@($projection | Sort-Object id,sha256)
        # Outside is diagnostic only. The exact allowed row set, not protected
        # rows, is subtracted; this is not an exhaustive host-state envelope.
        $allowed=@{}; foreach ($r in $request.resources) { if ($r.kind -ceq $kind) { $allowed[$r.id]=$true } }
        $outside=@($stable | Where-Object { !$allowed.ContainsKey($_.id) })
        $coverage+=,[ordered]@{kind=$kind;scope_id=('managed-windows-observer.v1.'+$kind);scope_sha256=(Digest $scope);complete=$false;outside_authority_sha256=$null;reason_code=$reason}
        $diag+=,[ordered]@{kind=$kind;reason_code=$reason;observed_count=$stable.Count;observed_projection_sha256=(Digest $stable);outside_projection_sha256=(Digest $outside);projection_is_complete=$false;failure=$failure;paths=$pathDiagnostics;registry_values=$registryDiagnostics;providers=$script:ProviderDetails}
    }
    $script:Phase='report.build'
    $resultRows=@{}; foreach ($list in @('resources','protected_resources')) {
        $values=@(); foreach ($r in $request.$list) { $key=$r.kind+':'+$r.id; $hash=$null; if ($observed.ContainsKey($key)) { $hash=$observed[$key] }; $values+=,[ordered]@{kind=$r.kind;id=$r.id;sha256=$hash} }; $resultRows[$list]=$values
    }
    $report.inventory=[ordered]@{contract_version='codex-managed-sandbox-inventory.v1';host_id=$request.host_id;client_sha256=$request.client.sha256;manifest_sha256=$request.manifest_sha256;observed_at=[DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ');coverage=$coverage;resources=$resultRows.resources;protected_resources=$resultRows.protected_resources}
    $report.diagnostics=$diag
    $report.observer_context.selected_modules=@($script:SelectedModules.Values | Sort-Object name)
    $report.dimension_candidates=Build-DimensionCandidates $script:DimensionCapture $report.inventory $report.observer_context
    if ($script:UnstoppedProvider) { $report.errors+=,@{code='INVENTORY_PROVIDER_STOP_UNCONFIRMED'} }
} catch { $report.errors+=,(Failure-Detail $_) }
# Partial null rows never establish absence. The caller must preserve this
# result as PREPARATION_BLOCKED and cannot turn it into host operation consent.
[Console]::Out.WriteLine((Report-Json $report $script:OutputLimit))
exit 1
