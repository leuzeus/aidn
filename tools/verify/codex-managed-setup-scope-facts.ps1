# Bounded, read-only physical inputs for the pinned Legacy scope projector.
# This is not setup, admission, token authentication, or native qualification.
# The caller pins this script, owns its Job and binds request/PID/start/stdout.
[CmdletBinding(DefaultParameterSetName='Path')]
param(
    [Parameter(Mandatory=$true,ParameterSetName='Path')][string]$RequestPath,
    [Parameter(Mandatory=$true,ParameterSetName='Base64')][string]$RequestBase64
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$script:Clock=[Diagnostics.Stopwatch]::StartNew()
$script:BudgetMs=60000
$script:ScopePass=0
$script:ScopeRole=$null
$script:ScopeRequestParameterSetName=$PSCmdlet.ParameterSetName
$script:Utf8=[Text.UTF8Encoding]::new($false,$true)
[Console]::OutputEncoding=$script:Utf8

function Stop-Scope([string]$Code) { throw [InvalidOperationException]::new($Code) }
function Check-ScopeTime {
    if ($script:Clock.ElapsedMilliseconds -ge $script:BudgetMs) { Stop-Scope 'SCOPE_TIME_LIMIT' }
}
function Exact-ScopeKeys($Value,[string[]]$Keys) {
    if ($Value -isnot [Collections.IDictionary] -or $Value.Count -ne $Keys.Count) { Stop-Scope 'SCOPE_REQUEST_INVALID' }
    foreach($name in $Value.Keys) { if($Keys -cnotcontains $name) { Stop-Scope 'SCOPE_REQUEST_INVALID' } }
}
function Scope-Path([string]$Value) {
    if ($Value.Length -le 3 -or $Value.Length -gt 4096 -or $Value -cnotmatch '^[A-Za-z]:\\' -or
        $Value.Normalize([Text.NormalizationForm]::FormC) -cne $Value -or
        [IO.Path]::GetFullPath($Value) -cne $Value -or $Value.EndsWith('\')) { Stop-Scope 'SCOPE_PATH_INVALID' }
    foreach($part in $Value.Substring(3).Split('\')) {
        if (!$part -or $part.Length -gt 255 -or $part -match '[:<>"|?*\x00-\x1f\x7f]|[. ]$|^(?i:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)') { Stop-Scope 'SCOPE_PATH_INVALID' }
    }
    return $Value
}
function Scope-Canonical($Value) {
    if ($null -eq $Value) { return 'null' }
    if ($Value -is [string]) { return [AidnScopeNative]::Quote($Value) }
    if ($Value -is [bool]) { if($Value) { return 'true' } else { return 'false' } }
    if ($Value -is [ValueType]) { return [Convert]::ToString($Value,[Globalization.CultureInfo]::InvariantCulture) }
    if ($Value -is [Collections.IDictionary]) {
        [string[]]$keys=@($Value.Keys); [Array]::Sort($keys,[StringComparer]::Ordinal)
        $parts=[Collections.Generic.List[string]]::new()
        foreach($name in $keys) { $parts.Add((Scope-Canonical $name)+':'+(Scope-Canonical $Value[$name])) }
        return '{'+[string]::Join(',',$parts)+'}'
    }
    if ($Value -is [Array] -or $Value -is [Collections.IList]) {
        $parts=[Collections.Generic.List[string]]::new()
        foreach($row in $Value) { $parts.Add((Scope-Canonical $row)) }
        return '['+[string]::Join(',',$parts)+']'
    }
    Stop-Scope 'SCOPE_JSON_INVALID'
}
function Scope-Hash($Value) {
    $hash=[Security.Cryptography.SHA256]::Create()
    try { return [Convert]::ToHexString($hash.ComputeHash($script:Utf8.GetBytes((Scope-Canonical $Value)))).ToLowerInvariant() }
    finally { $hash.Dispose() }
}
function Read-ScopeRequest {
    if ($script:ScopeRequestParameterSetName -ceq 'Base64') {
        if ($RequestBase64.Length -gt 87384) { Stop-Scope 'SCOPE_REQUEST_LIMIT' }
        try { $bytes=[Convert]::FromBase64String($RequestBase64) } catch { Stop-Scope 'SCOPE_REQUEST_INVALID' }
    } else {
        $null=Scope-Path $RequestPath
        $stream=[IO.File]::Open($RequestPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
        try {
            if ($stream.Length -gt 65536) { Stop-Scope 'SCOPE_REQUEST_LIMIT' }
            $memory=[IO.MemoryStream]::new()
            try {
                $buffer=[byte[]]::new(4096)
                while(($count=$stream.Read($buffer,0,$buffer.Length)) -gt 0) {
                    Check-ScopeTime
                    if($memory.Length+$count -gt 65536) { Stop-Scope 'SCOPE_REQUEST_LIMIT' }
                    $memory.Write($buffer,0,$count)
                }
                $bytes=$memory.ToArray()
            } finally { $memory.Dispose() }
        } finally { $stream.Dispose() }
    }
    if ($bytes.Length -gt 65536) { Stop-Scope 'SCOPE_REQUEST_LIMIT' }
    try { $request=ConvertFrom-Json -InputObject ($script:Utf8.GetString($bytes)) -AsHashtable -Depth 16 }
    catch { Stop-Scope 'SCOPE_REQUEST_INVALID' }
    Exact-ScopeKeys $request @('contract_version','observer_context_sha256','roots','max_duration_ms','request_sha256')
    if ($request.contract_version -cne 'aidn-managed-setup-scope-facts-request.v1' -or
        $request.observer_context_sha256 -isnot [string] -or $request.observer_context_sha256 -cnotmatch '^[a-f0-9]{64}$' -or
        $request.request_sha256 -isnot [string] -or $request.request_sha256 -cnotmatch '^[a-f0-9]{64}$') { Stop-Scope 'SCOPE_REQUEST_INVALID' }
    if (($request.max_duration_ms -isnot [long] -and $request.max_duration_ms -isnot [int]) -or
        $request.max_duration_ms -lt 1000 -or $request.max_duration_ms -gt 60000) { Stop-Scope 'SCOPE_LIMIT_INVALID' }
    Exact-ScopeKeys $request.roots @('cwd','profile_root','candidate_root','user_profile','local_app_data','startup_directories')
    foreach($name in @('cwd','profile_root','candidate_root','user_profile','local_app_data')) {
        if ($request.roots[$name] -isnot [string]) { Stop-Scope 'SCOPE_PATH_INVALID' }
        $null=Scope-Path $request.roots[$name]
    }
    if ($request.roots.startup_directories -isnot [Array] -or $request.roots.startup_directories.Count -gt 16) { Stop-Scope 'SCOPE_REQUEST_INVALID' }
    foreach($directory in $request.roots.startup_directories) {
        if ($directory -isnot [string]) { Stop-Scope 'SCOPE_PATH_INVALID' }
        $null=Scope-Path $directory
    }
    $unsigned=[ordered]@{}
    foreach($name in $request.Keys) { if($name -cne 'request_sha256') { $unsigned[$name]=$request[$name] } }
    if ((Scope-Hash $unsigned) -cne $request.request_sha256) { Stop-Scope 'SCOPE_REQUEST_HASH_MISMATCH' }
    return $request
}

# Primary APIs: FILE_ID_INFO (64-bit volume + original 16 ID bytes),
# BY_HANDLE_FILE_INFORMATION link count on that same handle, final DOS path,
# FSCTL_GET_REPARSE_POINT only (never SET/DELETE), System32 DLL resolution.
# A synchronous filesystem call can outlast the clock; the caller must own a
# deadline-controlled Job. Neither a timeout nor a two-pass match is a lock.
$script:ScopeNativeSource=@'
using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;
[assembly:DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
public static class AidnScopeNative {
    // JSON.stringify-compatible scalar quoting, including line separators and
    // lone UTF-16 surrogates. PowerShell/Newtonsoft escaping differs here.
    public static string Quote(string value) {
        var output=new StringBuilder(value.Length+2); output.Append('"');
        for(int i=0;i<value.Length;i++) {
            char c=value[i];
            switch(c) {
                case '"': output.Append("\\\""); break; case '\\': output.Append("\\\\"); break;
                case '\b': output.Append("\\b"); break; case '\f': output.Append("\\f"); break;
                case '\n': output.Append("\\n"); break; case '\r': output.Append("\\r"); break;
                case '\t': output.Append("\\t"); break;
                default:
                    if(c<32 || char.IsSurrogate(c) && !(char.IsHighSurrogate(c) && i+1<value.Length && char.IsLowSurrogate(value[i+1]))
                        && !(char.IsLowSurrogate(c) && i>0 && char.IsHighSurrogate(value[i-1]))) output.Append("\\u").Append(((int)c).ToString("x4"));
                    else output.Append(c); break;
            }
        }
        return output.Append('"').ToString();
    }
    [StructLayout(LayoutKind.Sequential)] struct FileIdInfo {
        public ulong VolumeSerialNumber;
        [MarshalAs(UnmanagedType.ByValArray,SizeConst=16)] public byte[] Identifier;
    }
    [StructLayout(LayoutKind.Sequential)] struct BasicInfo {
        public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation;
        public System.Runtime.InteropServices.ComTypes.FILETIME Access; public System.Runtime.InteropServices.ComTypes.FILETIME Write;
        public uint Volume; public uint SizeHigh; public uint SizeLow; public uint Links; public uint IndexHigh; public uint IndexLow;
    }
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    static extern SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
    [DllImport("kernel32.dll",SetLastError=true)]
    static extern bool GetFileInformationByHandleEx(SafeFileHandle handle,int kind,out FileIdInfo info,uint size);
    [DllImport("kernel32.dll",SetLastError=true)]
    static extern bool GetFileInformationByHandle(SafeFileHandle handle,out BasicInfo info);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle,StringBuilder path,uint size,uint flags);
    [DllImport("kernel32.dll",SetLastError=true)]
    static extern bool DeviceIoControl(SafeFileHandle handle,uint code,IntPtr input,uint inputSize,byte[] output,uint outputSize,out uint returned,IntPtr overlapped);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]
    static extern uint GetDriveTypeW(string root);
    static readonly Stopwatch Clock=Stopwatch.StartNew();
    static long End;
    static readonly Dictionary<string,string> Witness=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
    public sealed class Fact {
        public string Path,State,ObjectType,PhysicalPath,VolumeId,FileId,ContentHash,Content,Target;
        public uint? LinkCount; public bool Reparse; public uint? ReparseTag;
    }
    public static void Start(long remaining) { End=Clock.ElapsedMilliseconds+remaining; Check(); }
    public static void Check() { if(Clock.ElapsedMilliseconds>=End) Fail("SCOPE_TIME_LIMIT"); }
    static void Fail(string code) { throw new InvalidOperationException(code); }
    // Refusal evidence only: hash the exact rejected path, never expose a path
    // or native exception message. The reason does not change admission.
    static void ReparseFail(string code,string variant,string path,string phase) {
        var error=new InvalidOperationException(code);
        error.Data["reparse_variant"]=variant; error.Data["native_phase"]=phase;
        using(var hash=SHA256.Create()) error.Data["path_sha256"]=Hex(hash.ComputeHash(Encoding.UTF8.GetBytes(path)));
        throw error;
    }
    static void WinFail(int code) {
        var e=new InvalidOperationException("SCOPE_NATIVE_READ_FAILED"); e.Data["win32_error"]=code; throw e;
    }
    static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-","").ToLowerInvariant(); }
    static string Final(SafeFileHandle handle) {
        var buffer=new StringBuilder(32768);
        uint size=GetFinalPathNameByHandleW(handle,buffer,(uint)buffer.Capacity,0);
        if(size==0) WinFail(Marshal.GetLastWin32Error());
        if(size>=buffer.Capacity) Fail("SCOPE_PATH_LIMIT");
        string path=buffer.ToString();
        if(!path.StartsWith(@"\\?\") || path.Length<7 || path[5]!=':') Fail("SCOPE_NONLOCAL_PATH");
        return path.Substring(4);
    }
    static string Identity(SafeFileHandle handle,out FileIdInfo id,out BasicInfo basic,bool content=false) {
        if(!GetFileInformationByHandleEx(handle,18,out id,(uint)Marshal.SizeOf<FileIdInfo>())) WinFail(Marshal.GetLastWin32Error());
        if(!GetFileInformationByHandle(handle,out basic)) WinFail(Marshal.GetLastWin32Error());
        // Ancestor size/mtime are not scope evidence: unrelated siblings may
        // change them. Exact directory listings are compared independently.
        return id.VolumeSerialNumber.ToString("x16")+":"+Hex(id.Identifier)+":"+basic.Attributes+":"+basic.Links+
            ":"+basic.Creation.dwHighDateTime+":"+basic.Creation.dwLowDateTime+":"+Final(handle)+
            (content?":"+basic.SizeHigh+":"+basic.SizeLow+":"+basic.Write.dwHighDateTime+":"+basic.Write.dwLowDateTime:"");
    }
    static void Remember(string path,string state) {
        string old;
        if(Witness.TryGetValue(path,out old) && old!=state) Fail("SCOPE_PATH_CHANGED");
        Witness[path]=state;
    }
    public static void BeginPass() { Check(); Witness.Clear(); }
    public static string WitnessHash() {
        Check();
        var rows=Witness.OrderBy(x=>x.Key,StringComparer.OrdinalIgnoreCase).Select(x=>x.Key.ToUpperInvariant()+"\0"+x.Value);
        using(var hash=SHA256.Create()) return Hex(hash.ComputeHash(Encoding.UTF8.GetBytes(string.Join("\n",rows))));
    }
    sealed class ProfileReparse { public uint Tag; public string Target; }
    // MS-FSCC 2.1.2.1: CLOUD_7 is not a name surrogate. Its opaque payload is
    // never interpreted as a target. Only the mount-point format has one.
    static ProfileReparse DecodeProfileReparse(byte[] buffer,uint returned,string path,string phase) {
        if(returned<8) ReparseFail("SCOPE_REPARSE_UNSUPPORTED","buffer_too_short",path,phase);
        if(returned>buffer.Length || 8+BitConverter.ToUInt16(buffer,4)>returned) ReparseFail("SCOPE_REPARSE_INVALID","invalid_buffer",path,phase);
        uint tag=BitConverter.ToUInt32(buffer,0);
        if(tag==0x9000701A) return new ProfileReparse { Tag=tag,Target=null };
        if(tag!=0xA0000003) ReparseFail("SCOPE_REPARSE_UNSUPPORTED","tag_not_supported",path,phase);
        if(returned<16) ReparseFail("SCOPE_REPARSE_UNSUPPORTED","buffer_too_short",path,phase);
        int dataLength=BitConverter.ToUInt16(buffer,4), offset=BitConverter.ToUInt16(buffer,8), length=BitConverter.ToUInt16(buffer,10);
        if(8+dataLength>returned || (offset|length)%2!=0 || length==0 || 16+offset+length>8+dataLength) ReparseFail("SCOPE_REPARSE_INVALID","invalid_buffer",path,phase);
        string target=new UnicodeEncoding(false,false,true).GetString(buffer,16+offset,length);
        if(!target.StartsWith(@"\??\") || target.Length<7 || target[5]!=':') ReparseFail("SCOPE_REPARSE_UNSUPPORTED","target_not_local_dos",path,phase);
        return new ProfileReparse { Tag=tag,Target=target.Substring(4).TrimEnd('\\') };
    }
    static ProfileReparse ReadProfileReparse(SafeFileHandle handle,string path,string phase) {
        var buffer=new byte[16384]; uint returned;
        if(!DeviceIoControl(handle,0x000900A8,IntPtr.Zero,0,buffer,(uint)buffer.Length,out returned,IntPtr.Zero)) WinFail(Marshal.GetLastWin32Error());
        return DecodeProfileReparse(buffer,returned,path,phase);
    }
    static Fact OpenFact(string path,bool allowProfileReparse,bool readContent,string phase) {
        Check();
        using(var handle=CreateFileW(path,readContent?0x80000080u:0x80u,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) {
            if(handle.IsInvalid) {
                int code=Marshal.GetLastWin32Error();
                if(code==2 || code==3) { Remember(path,"absent"); Check(); return new Fact { Path=path,State="absent" }; }
                WinFail(code);
            }
            FileIdInfo id; BasicInfo basic; string before=Identity(handle,out id,out basic,readContent);
            string physical=Final(handle);
            if(!string.Equals(path,physical,StringComparison.OrdinalIgnoreCase)) Fail("SCOPE_PHYSICAL_PATH_MISMATCH");
            bool directory=(basic.Attributes&0x10)!=0, reparse=(basic.Attributes&0x400)!=0;
            if(reparse && !allowProfileReparse) ReparseFail("SCOPE_REPARSE_UNSUPPORTED","reparse_not_allowed",path,phase);
            if(reparse && !directory) ReparseFail("SCOPE_REPARSE_UNSUPPORTED","reparse_not_directory",path,phase);
            if(!directory && basic.Links!=1) Fail("SCOPE_LINK_COUNT_UNSUPPORTED");
            var fact=new Fact { Path=physical,State="present",ObjectType=directory?"directory":"file",PhysicalPath=physical,
                VolumeId=id.VolumeSerialNumber.ToString("x16"),FileId=Hex(id.Identifier),LinkCount=directory?(uint?)null:basic.Links,Reparse=reparse };
            if(reparse) { var parsed=ReadProfileReparse(handle,path,phase); fact.Target=parsed.Target; fact.ReparseTag=parsed.Tag; }
            if(readContent) {
                if(directory || reparse || (((ulong)basic.SizeHigh<<32)|basic.SizeLow)>65536) Fail("SCOPE_PRIOR_STATE_LIMIT");
                using(var stream=new FileStream(handle,FileAccess.Read,4096,false))
                using(var memory=new MemoryStream()) {
                    var buffer=new byte[4096]; int count;
                    while((count=stream.Read(buffer,0,buffer.Length))>0) {
                        Check(); if(memory.Length+count>65536) Fail("SCOPE_PRIOR_STATE_LIMIT"); memory.Write(buffer,0,count);
                    }
                    byte[] bytes=memory.ToArray();
                    fact.Content=new UTF8Encoding(false,true).GetString(bytes);
                    using(var hash=SHA256.Create()) fact.ContentHash=Hex(hash.ComputeHash(bytes));
                    FileIdInfo afterId; BasicInfo afterBasic;
                    if(Identity(handle,out afterId,out afterBasic,true)!=before) Fail("SCOPE_PATH_CHANGED");
                }
            } else {
                FileIdInfo afterId; BasicInfo afterBasic;
                if(Identity(handle,out afterId,out afterBasic)!=before) Fail("SCOPE_PATH_CHANGED");
            }
            Remember(path,before+(fact.ContentHash??"")+(fact.Target??"")+":"+fact.ReparseTag); Check(); return fact;
        }
    }
    public static Fact Read(string path,bool allowProfileReparse,bool readContent) {
        Check(); string root=System.IO.Path.GetPathRoot(path);
        if(GetDriveTypeW(root)!=3) Fail("SCOPE_FIXED_VOLUME_REQUIRED");
        var ancestors=new List<string>(); string cursor=System.IO.Path.GetDirectoryName(path);
        while(!string.IsNullOrEmpty(cursor)) { ancestors.Add(cursor); if(cursor==root) break; cursor=System.IO.Path.GetDirectoryName(cursor); }
        ancestors.Reverse(); bool absent=false;
        foreach(string ancestor in ancestors) {
            if(absent) continue;
            Fact row=OpenFact(ancestor,false,false,"ancestor_before");
            if(row.State=="absent") absent=true;
            else if(row.ObjectType!="directory") Fail("SCOPE_ANCESTOR_INVALID");
        }
        if(absent) { Remember(path,"absent"); Check(); return new Fact { Path=path,State="absent" }; }
        Fact result=OpenFact(path,allowProfileReparse,readContent,"target");
        foreach(string ancestor in ancestors) {
            Fact row=OpenFact(ancestor,false,false,"ancestor_after");
            if(row.State!="present" || row.ObjectType!="directory") Fail("SCOPE_ANCESTOR_CHANGED");
        }
        return result;
    }
    public static string[] List(string path,int maximum) {
        Fact before=Read(path,false,false);
        if(before.State!="present" || before.ObjectType!="directory") Fail("SCOPE_DIRECTORY_REQUIRED");
        var entries=new List<string>();
        foreach(string entry in Directory.EnumerateFileSystemEntries(path)) {
            Check(); if(entries.Count>=maximum) Fail("SCOPE_LISTING_LIMIT"); entries.Add(entry);
        }
        Read(path,false,false); Check();
        entries.Sort(StringComparer.OrdinalIgnoreCase);
        if(entries.Distinct(StringComparer.OrdinalIgnoreCase).Count()!=entries.Count) Fail("SCOPE_LISTING_DUPLICATE");
        return entries.ToArray();
    }
}
'@

function Read-PhysicalScopeFact([string]$Path,[bool]$AllowProfileReparse=$false,[bool]$ReadPrior=$false) {
    Check-ScopeTime; $null=Scope-Path $Path
    return [AidnScopeNative]::Read($Path,$AllowProfileReparse,$ReadPrior)
}
function Read-PhysicalScopeListing([string]$Path,[int]$Maximum) {
    Check-ScopeTime; return ,([AidnScopeNative]::List($Path,$Maximum))
}
function Convert-PhysicalScopeFact($Native) {
    $present=$Native.State -ceq 'present'
    return [ordered]@{path=$Native.Path;state=$Native.State;object_type=$Native.ObjectType;physical_path=$Native.PhysicalPath;
        volume_id=$Native.VolumeId;file_id=$Native.FileId;link_count=$Native.LinkCount;ancestors_non_reparse=$true;
        reparse=$(if($present){$Native.Reparse}else{$null});content_sha256=$Native.ContentHash}
}
# Only our closed diagnostic fields are returned. Exception text/Data and path
# contents cannot become an output side channel through a provider error.
function Convert-ScopeReparseDiagnostic($Cause) {
    $roles=@('required_root','cwd_metadata','ssh_config','prior_deny_read','sandbox_bin','platform_root',
        'profile_listing','profile_child','profile_junction_target','runtime_root','runtime_entry','runtime_listing')
    $variants=@('reparse_not_allowed','reparse_not_directory','buffer_too_short','tag_not_supported','target_not_local_dos','invalid_buffer')
    if($Cause.Message -cnotin @('SCOPE_REPARSE_UNSUPPORTED','SCOPE_REPARSE_INVALID') -or
        $script:ScopePass -notin @(1,2) -or $script:ScopeRole -cnotin $roles -or
        $Cause.Data['native_phase'] -cnotin @('ancestor_before','target','ancestor_after') -or
        $Cause.Data['reparse_variant'] -cnotin $variants -or
        $Cause.Data['path_sha256'] -isnot [string] -or $Cause.Data['path_sha256'] -cnotmatch '^[a-f0-9]{64}$') { return $null }
    return [ordered]@{pass=$script:ScopePass;role=$script:ScopeRole;native_phase=$Cause.Data['native_phase'];
        path_sha256=$Cause.Data['path_sha256'];reparse_variant=$Cause.Data['reparse_variant']}
}
function Observe-PhysicalScope($Roots) {
    $paths=[Collections.Generic.Dictionary[string,object]]::new([StringComparer]::OrdinalIgnoreCase)
    $listings=[Collections.Generic.Dictionary[string,object]]::new([StringComparer]::OrdinalIgnoreCase)
    $junctions=[Collections.Generic.List[object]]::new()
    $cloudDirectories=[Collections.Generic.List[object]]::new()
    $exclusions=@('.ssh','.tsh','.brev','.gnupg','.aws','.azure','.kube','.docker','.config','.npm','.pki','.terraform.d')
    function Keep($Row) {
        $fact=Convert-PhysicalScopeFact $Row
        if($paths.ContainsKey($fact.path)) {
            if((Scope-Hash $paths[$fact.path]) -cne (Scope-Hash $fact)) { Stop-Scope 'SCOPE_PATH_CHANGED' }
        } else {
            if($paths.Count -ge 4609) { Stop-Scope 'SCOPE_FACT_LIMIT' }
            $paths.Add($fact.path,$fact)
        }
    }
    function Get-Fact([string]$Path,[bool]$Junction=$false,[bool]$Prior=$false) {
        $row=Read-PhysicalScopeFact $Path $Junction $Prior; Keep $row; return $row
    }
    function Need-Directory([string]$Path) {
        $row=Get-Fact $Path
        if($row.State -cne 'present' -or $row.ObjectType -cne 'directory') { Stop-Scope 'SCOPE_DIRECTORY_REQUIRED' }
    }
    function Keep-Listing([string]$Path,[int]$Maximum) {
        $entries=Read-PhysicalScopeListing $Path $Maximum
        if($listings.Count -ge 4097 -or $listings.ContainsKey($Path)) { Stop-Scope 'SCOPE_LISTING_LIMIT' }
        $listings.Add($Path,[ordered]@{path=$Path;complete=$true;entries=@($entries)})
        return ,$entries
    }
    $script:ScopeRole='required_root'
    foreach($path in @($Roots.cwd,$Roots.profile_root,$Roots.candidate_root,$Roots.user_profile)+@($Roots.startup_directories)) { Need-Directory $path }
    $script:ScopeRole='cwd_metadata'
    foreach($name in @('.git','.agents','.codex')) {
        if((Get-Fact ([IO.Path]::Combine($Roots.cwd,$name))).State -cne 'absent') { Stop-Scope 'SCOPE_CWD_METADATA_PRESENT' }
    }
    $script:ScopeRole='ssh_config'
    if((Get-Fact ([IO.Path]::Combine($Roots.user_profile,'.ssh','config'))).State -cne 'absent') { Stop-Scope 'SCOPE_SSH_CONFIG_PRESENT' }
    $script:ScopeRole='prior_deny_read'
    $prior=Get-Fact ([IO.Path]::Combine($Roots.profile_root,'.sandbox','deny_read_acl_state.json')) $false $true
    $priorContent=$null
    if($prior.State -ceq 'present') {
        if($prior.Content -isnot [string] -or $prior.Content -cnotmatch '^\s*\{\s*"principals"\s*:\s*\{\s*\}\s*\}\s*$') { Stop-Scope 'SCOPE_PRIOR_STATE_UNSUPPORTED' }
        $priorContent=$prior.Content
    }
    $script:ScopeRole='sandbox_bin'
    Need-Directory ([IO.Path]::Combine($Roots.profile_root,'.sandbox-bin'))
    $script:ScopeRole='platform_root'
    foreach($path in @('C:\Windows','C:\Program Files','C:\Program Files (x86)','C:\ProgramData')) {
        $row=Get-Fact $path
        if($row.State -ceq 'present' -and $row.ObjectType -cne 'directory') { Stop-Scope 'SCOPE_PLATFORM_ROOT_INVALID' }
    }
    $script:ScopeRole='profile_listing'
    $children=Keep-Listing $Roots.user_profile 512
    foreach($path in $children) {
        $script:ScopeRole='profile_child'
        $row=Read-PhysicalScopeFact $path $true
        if($row.State -cne 'present') { Stop-Scope 'SCOPE_LISTING_CHANGED' }
        if($row.Reparse) {
            if($row.ReparseTag -eq [uint32]2415947802) {
                if($cloudDirectories.Count -ge 32) { Stop-Scope 'SCOPE_CLOUD_DIRECTORY_LIMIT' }
                if($row.ObjectType -cne 'directory' -or $null -ne $row.Target) { Stop-Scope 'SCOPE_REPARSE_UNSUPPORTED' }
                Keep $row
                $cloudDirectories.Add([ordered]@{path=$row.Path;reparse_tag=[long]2415947802})
                continue
            }
            if($row.ReparseTag -ne [uint32]2684354563) { Stop-Scope 'SCOPE_REPARSE_UNSUPPORTED' }
            if($junctions.Count -ge 32) { Stop-Scope 'SCOPE_JUNCTION_LIMIT' }
            $target=Scope-Path $row.Target
            $prefix=$Roots.user_profile+'\'
            if(!$target.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { Stop-Scope 'SCOPE_JUNCTION_OUTSIDE_PROFILE' }
            $script:ScopeRole='profile_junction_target'
            $targetRow=Get-Fact $target
            if($targetRow.State -cne 'present' -or $targetRow.ObjectType -cne 'directory' -or $targetRow.Reparse) { Stop-Scope 'SCOPE_JUNCTION_TARGET_INVALID' }
            Keep $row
            $junctions.Add([ordered]@{path=$row.Path;target_path=$targetRow.Path;reparse_tag=[long]2684354563})
        } elseif($exclusions -cnotcontains [IO.Path]::GetFileName($path).ToLowerInvariant()) { Keep $row }
    }
    $script:ScopeRole='runtime_root'
    foreach($path in @([IO.Path]::Combine($Roots.local_app_data,'OpenAI','Codex'),[IO.Path]::Combine($Roots.user_profile,'.cache','codex-runtimes'))) {
        $row=Get-Fact $path
        if($row.State -ceq 'present' -and $row.ObjectType -cne 'directory') { Stop-Scope 'SCOPE_RUNTIME_ROOT_INVALID' }
    }
    $runtime=[IO.Path]::Combine($Roots.local_app_data,'OpenAI','Codex','runtimes')
    $root=Get-Fact $runtime
    if($root.State -ceq 'present') {
        if($root.ObjectType -cne 'directory') { Stop-Scope 'SCOPE_RUNTIME_ROOT_INVALID' }
        $pending=[Collections.Generic.Stack[object]]::new(); $pending.Push(@{path=$runtime;depth=0})
        $discovered=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase); $null=$discovered.Add($runtime)
        $visited=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        while($pending.Count) {
            Check-ScopeTime; $item=$pending.Pop()
            if($item.depth -gt 32 -or !$visited.Add($item.path) -or $visited.Count -gt 4097) { Stop-Scope 'SCOPE_RUNTIME_LIMIT' }
            $script:ScopeRole='runtime_entry'
            $row=Get-Fact $item.path
            if($row.State -cne 'present') { Stop-Scope 'SCOPE_LISTING_CHANGED' }
            if($row.ObjectType -ceq 'directory') {
                $script:ScopeRole='runtime_listing'
                foreach($child in (Keep-Listing $item.path 4096)) {
                    if(!$discovered.Add($child) -or $discovered.Count -gt 4097) { Stop-Scope 'SCOPE_RUNTIME_LIMIT' }
                    $pending.Push(@{path=$child;depth=$item.depth+1})
                }
            }
        }
        if($paths.Count-$visited.Count -gt 512) { Stop-Scope 'SCOPE_NONRUNTIME_LIMIT' }
    } elseif($paths.Count -gt 512) { Stop-Scope 'SCOPE_NONRUNTIME_LIMIT' }
    $pathRows=@($paths.Values | Sort-Object -Property path -CaseSensitive)
    $listingRows=@($listings.Values | Sort-Object -Property path -CaseSensitive)
    $junctionRows=@($junctions | Sort-Object -Property path -CaseSensitive)
    $cloudRows=@($cloudDirectories | Sort-Object -Property path -CaseSensitive)
    return [ordered]@{paths=$pathRows;listings=$listingRows;prior_deny_read_content=$priorContent;profile_junctions=$junctionRows;profile_cloud_directories=$cloudRows}
}
function Convert-ScopeReport($Report) {
    $Report.duration_ms=$script:Clock.ElapsedMilliseconds
    $json=ConvertTo-Json -InputObject $Report -Depth 20 -Compress
    $code=$null
    if($script:Clock.ElapsedMilliseconds -ge $script:BudgetMs) { $code='SCOPE_TIME_LIMIT' }
    elseif($script:Utf8.GetByteCount($json)+2 -gt 2097152) { $code='SCOPE_OUTPUT_LIMIT' }
    if($null -ne $code) {
        $Report.status='REFUSED'; $Report.facts=$null; $Report.facts_sha256=$null
        $Report.duration_ms=$script:Clock.ElapsedMilliseconds
        $Report.errors=@([ordered]@{code=$code;win32_error=$null})
        $json=ConvertTo-Json -InputObject $Report -Depth 20 -Compress
    }
    return $json
}

$processInfo=[ordered]@{pid=$PID;started_at=[Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ',[Globalization.CultureInfo]::InvariantCulture)}
$report=[ordered]@{contract_version='aidn-managed-setup-scope-facts-observation.v1';request_sha256=$null;status='REFUSED';
    process=$processInfo;duration_ms=0;facts=$null;facts_sha256=$null;errors=@()}
try {
    if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or $PSVersionTable.PSEdition -cne 'Core' -or $PSVersionTable.PSVersion.Major -lt 7) { Stop-Scope 'SCOPE_WINDOWS_POWERSHELL_7_REQUIRED' }
    Add-Type -TypeDefinition $script:ScopeNativeSource -ErrorAction Stop
    Check-ScopeTime; $request=Read-ScopeRequest; $report.request_sha256=$request.request_sha256
    $script:BudgetMs=$request.max_duration_ms; Check-ScopeTime
    Check-ScopeTime; [AidnScopeNative]::Start($script:BudgetMs-$script:Clock.ElapsedMilliseconds)
    $script:ScopePass=1; [AidnScopeNative]::BeginPass(); $first=Observe-PhysicalScope $request.roots; $firstWitness=[AidnScopeNative]::WitnessHash()
    $script:ScopePass=2; [AidnScopeNative]::BeginPass(); $second=Observe-PhysicalScope $request.roots; $secondWitness=[AidnScopeNative]::WitnessHash()
    Check-ScopeTime
    if($firstWitness -cne $secondWitness -or (Scope-Hash $first) -cne (Scope-Hash $second)) { Stop-Scope 'SCOPE_TWO_PASS_MISMATCH' }
    $facts=[ordered]@{contract_version='aidn-managed-setup-legacy-facts.v3';observed_at=[DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ',[Globalization.CultureInfo]::InvariantCulture);
        observer_context_sha256=$request.observer_context_sha256;paths=$second.paths;listings=$second.listings;
        prior_deny_read_content=$second.prior_deny_read_content;profile_junctions=$second.profile_junctions;profile_cloud_directories=$second.profile_cloud_directories}
    $report.facts=$facts; $report.facts_sha256=Scope-Hash $facts; Check-ScopeTime; $report.status='OBSERVED'
} catch {
    $cause=$_.Exception.GetBaseException(); $code='SCOPE_OBSERVATION_FAILED'; $native=$null
    if($cause.Message -cmatch '^SCOPE_[A-Z0-9_]+$') { $code=$cause.Message }
    if($cause.Data.Contains('win32_error')) { $native=[int]$cause.Data['win32_error'] }
    $report.status='REFUSED'; $report.facts=$null; $report.facts_sha256=$null
    $errorRow=[ordered]@{code=$code;win32_error=$native}
    $diagnostic=Convert-ScopeReparseDiagnostic $cause
    if($null -ne $diagnostic) { $errorRow.diagnostic=$diagnostic }
    $report.errors=@($errorRow)
}
$json=Convert-ScopeReport $report
[Console]::Out.WriteLine($json)
if($report.status -ceq 'OBSERVED') { exit 0 } else { exit 1 }
