using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

// Inspect the primary token of our own parent (the receipted Node probe).
// Only NTFS security metadata is read. The duplicated identification token
// can be queried by AccessCheck and cannot impersonate the runner.
internal static class ValidationAccessCheck {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct ProcessEntry {
        public uint size, uses, pid;
        public UIntPtr heap;
        public uint module, threads, parent;
        public int priority;
        public uint flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string image;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct Mapping { public uint read, write, execute, all; }
    [DllImport("kernel32.dll", SetLastError=true)] static extern SafeFileHandle CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool Process32FirstW(SafeFileHandle snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool Process32NextW(SafeFileHandle snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", SetLastError=true)] static extern SafeFileHandle OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(SafeFileHandle process, uint access, out SafeFileHandle token);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool DuplicateTokenEx(SafeFileHandle token, uint access, IntPtr attributes, int level, int type, out SafeFileHandle copy);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(SafeFileHandle token, int kind, byte[] buffer, int length, out int bytes);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool LookupPrivilegeNameW(string system, ref long luid, StringBuilder name, ref int length);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool AccessCheck(byte[] descriptor, SafeFileHandle token, uint desired, ref Mapping map, byte[] privileges, ref uint length, out uint granted, out bool allowed);

    static void Require(bool condition, string reason) {
        if (!condition) throw new InvalidOperationException(reason);
    }
    static void Win(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    static uint ParentId() {
        uint own = (uint)Process.GetCurrentProcess().Id;
        using (var snapshot = CreateToolhelp32Snapshot(2, 0)) {
            Win(!snapshot.IsInvalid);
            var entry = new ProcessEntry { size = (uint)Marshal.SizeOf(typeof(ProcessEntry)) };
            Win(Process32FirstW(snapshot, ref entry));
            do { if (entry.pid == own) return entry.parent; } while (Process32NextW(snapshot, ref entry));
        }
        throw new InvalidOperationException("PARENT_UNOBSERVED");
    }
    static byte[] TokenInfo(SafeFileHandle token, int kind) {
        var data = new byte[4096]; int bytes;
        Win(GetTokenInformation(token, kind, data, data.Length, out bytes));
        Array.Resize(ref data, bytes); return data;
    }
    static void CheckPrivileges(SafeFileHandle token) {
        byte[] data = TokenInfo(token, 3); // TokenPrivileges, including disabled privileges.
        int count = BitConverter.ToInt32(data, 0);
        Require(count >= 0 && count <= 128 && data.Length >= 4 + count * 12, "INVALID_PRIVILEGE_LIST");
        for (int i=0; i<count; i++) {
            long luid = BitConverter.ToInt64(data, 4 + 12*i);
            int length = 128; var name = new StringBuilder(length);
            Win(LookupPrivilegeNameW(null, ref luid, name, ref length));
            Require(name.ToString() == "SeChangeNotifyPrivilege", "UNQUALIFIED_TOKEN_PRIVILEGE");
        }
    }
    static object Rights(SafeFileHandle token, string name, bool directory) {
        FileAttributes attr = File.GetAttributes(name);
        Require((attr & FileAttributes.ReparsePoint) == 0 && ((attr & FileAttributes.Directory) != 0) == directory, "UNQUALIFIED_FILE_TYPE");
        const AccessControlSections parts = AccessControlSections.Owner | AccessControlSections.Group | AccessControlSections.Access;
        FileSystemSecurity security = directory ? (FileSystemSecurity)Directory.GetAccessControl(name, parts) : File.GetAccessControl(name, parts);
        byte[] descriptor = security.GetSecurityDescriptorBinaryForm(), privileges = new byte[4096];
        var mapping = new Mapping { read=0x120089, write=0x120116, execute=0x1200a0, all=0x1f01ff };
        uint length=(uint)privileges.Length, granted; bool allowed;
        Win(AccessCheck(descriptor, token, 0x02000000, ref mapping, privileges, ref length, out granted, out allowed)); // MAXIMUM_ALLOWED
        using (var sha = SHA256.Create()) return new {
            granted = allowed ? granted : 0u,
            descriptor_sha256 = BitConverter.ToString(sha.ComputeHash(descriptor)).Replace("-", "").ToLowerInvariant()
        };
    }
    static object Inspect(SafeFileHandle token, string name) {
        var drive = new DriveInfo(Path.GetPathRoot(name));
        Require(Path.GetFullPath(name) == name && drive.DriveType == DriveType.Fixed && drive.DriveFormat == "NTFS", "LOCAL_NTFS_REQUIRED");
        var chain = new List<object>();
        for (var parent=Directory.GetParent(name); parent!=null; parent=parent.Parent) {
            Require(chain.Count < 64, "DIRECTORY_DEPTH_LIMIT");
            chain.Add(Rights(token, parent.FullName, true));
        }
        return new { file=Rights(token, name, false), ancestors=chain };
    }
    static int Main(string[] args) {
        try {
            uint parent = ParentId();
            Require(args.Length == 4 && uint.Parse(args[0]) == parent, "PROBE_PARENT_REQUIRED");
            using (var process = OpenProcess(0x1000, false, parent)) {
                Win(!process.IsInvalid); SafeFileHandle primary, identification;
                Win(OpenProcessToken(process, 0x000a, out primary)); // QUERY | DUPLICATE
                using (primary) {
                    CheckPrivileges(primary);
                    string tokenId=BitConverter.ToUInt64(TokenInfo(primary, 10), 0).ToString("x16"); // TokenStatistics.TokenId
                    Win(DuplicateTokenEx(primary, 0x0008, IntPtr.Zero, 1, 2, out identification)); // QUERY, SecurityIdentification
                    using (identification) Console.WriteLine(new JavaScriptSerializer().Serialize(new {
                        subject_pid=parent, token_id=tokenId,
                        snapshot=Inspect(identification, args[1]), supervisor=Inspect(identification, args[2]), scratch=Inspect(identification, args[3])
                    }));
                }
            }
            return 0;
        } catch (Exception error) {
            var win = error as Win32Exception;
            Console.Error.WriteLine(win != null ? "WIN32_" + win.NativeErrorCode : error is InvalidOperationException ? error.Message : error.GetType().Name);
            return 1;
        }
    }
}
