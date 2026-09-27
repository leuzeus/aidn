// Explicitly built trusted sandbox trampoline. File/network authority comes from Codex.
// The runner gets an entirely new environment block and its own kill-on-close Job.
// The outer controller and this inner Job must both establish termination.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

internal static class CodexValidationTrampoline {
    const uint STILL_ACTIVE = 259;
    static readonly object OutputLock = new object(), StateLock = new object();
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 1048576, RecursionLimit = 20 };
    static string RunnerId = "unknown", StopReason, RequestSha, EnvironmentSha, ParentJobName;
    static bool ResumeRequested, Created, Resumed;
    static int Sequence;
    static long OutputBytes, MaxOutput;
    static IntPtr Job, ProcessHandle, ThreadHandle;
    static uint Pid;
    [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int length; public IntPtr descriptor; public int inherit; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUPINFO {
        public int cb; public string reserved, desktop, title;
        public uint x, y, width, height, charsX, charsY, fill, flags;
        public short show, reservedSize; public IntPtr reservedBytes, stdin, stdout, stderr;
    }
    [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO startup; public IntPtr attributes; }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process, thread; public uint pid, tid; }
    [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMITS {
        public long processTime, jobTime; public uint flags; public UIntPtr minWorkingSet, maxWorkingSet;
        public uint activeLimit; public UIntPtr affinity; public uint priority, scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMITS {
        public BASIC_LIMITS basic; public IO_COUNTERS io;
        public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)] struct ACCOUNTING {
        public long totalUser, totalKernel, periodUser, periodKernel;
        public uint pageFaults, totalProcesses, activeProcesses, terminatedProcesses;
    }
    [StructLayout(LayoutKind.Sequential)] struct FILETIME { public uint low, high; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr OpenJobObject(uint access, bool inherit, string name);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref EXTENDED_LIMITS info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int infoClass, out ACCOUNTING info, uint length, IntPtr returnLength);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SECURITY_ATTRIBUTES attributes, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcess(string application, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string directory, ref STARTUPINFOEX startup, out PROCESS_INFORMATION information);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessTimes(IntPtr process, out FILETIME creation, out FILETIME exit, out FILETIME kernel, out FILETIME user);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    static void Require(bool condition, string code) { if (!condition) throw new InvalidOperationException(code); }
    static string Text(Dictionary<string, object> value, string key) { object result; Require(value.TryGetValue(key, out result) && result is string, "INVALID_REQUEST"); return (string)result; }
    static long Number(Dictionary<string, object> value, string key, long maximum) {
        object result; Require(value.TryGetValue(key, out result) && (result is int || result is long), "INVALID_REQUEST");
        long number = Convert.ToInt64(result); Require(number > 0 && number <= maximum, "INVALID_REQUEST"); return number;
    }
    static string ReadLineBounded(int maximum) {
        var text = new StringBuilder();
        for (;;) { int c = Console.In.Read(); if (c == -1) return text.Length == 0 ? null : text.ToString(); if (c == '\n') return text.ToString(); Require(text.Length < maximum, "INPUT_LIMIT"); if (c != '\r') text.Append((char)c); }
    }
    static void Emit(string type, Dictionary<string, object> values) {
        lock (OutputLock) {
            values["protocol"] = "aidn-validation-trampoline.v1"; values["runner_id"] = RunnerId;
            values["request_sha256"] = RequestSha;
            values["sequence"] = ++Sequence; values["type"] = type;
            Console.Out.WriteLine(Json.Serialize(values)); Console.Out.Flush();
        }
    }
    static void Stop(string reason) { lock (StateLock) { if (StopReason == null) StopReason = reason; } }
    static string Reason() { lock (StateLock) return StopReason; }
    static void Close(ref IntPtr handle) { if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; } }
    static string Hash(Stream stream) { using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant(); }
    static string Quote(string argument) {
        var output = new StringBuilder("\""); int slash = 0;
        foreach (char c in argument) {
            if (c == '\\') { slash++; continue; }
            if (c == '"') { output.Append('\\', slash * 2 + 1); output.Append('"'); }
            else { output.Append('\\', slash); output.Append(c); } slash = 0;
        }
        output.Append('\\', slash * 2); return output.Append('"').ToString();
    }
    static Thread Drain(IntPtr pipe, string type) {
        var thread = new Thread(() => {
            try {
                using (var stream = new FileStream(new SafeFileHandle(pipe, true), FileAccess.Read, 4096, false)) {
                    byte[] buffer = new byte[4096]; int length;
                    while ((length = stream.Read(buffer, 0, buffer.Length)) > 0) {
                        if (Interlocked.Add(ref OutputBytes, length) > MaxOutput) { Stop("OUTPUT_LIMIT"); continue; }
                        Emit(type, new Dictionary<string, object> { { "data", Convert.ToBase64String(buffer, 0, length) } });
                    }
                }
            } catch { Stop("STREAM_FAILED"); }
        }); thread.IsBackground = true; thread.Start(); return thread;
    }
    static uint Active() {
        ACCOUNTING accounting;
        Require(QueryInformationJobObject(Job, 1, out accounting, (uint)Marshal.SizeOf(typeof(ACCOUNTING)), IntPtr.Zero), "JOB_QUERY_FAILED");
        return accounting.activeProcesses;
    }
    public static int Main() {
        Console.InputEncoding = new UTF8Encoding(false, true); Console.OutputEncoding = new UTF8Encoding(false, true);
        string jobName = null, startedAt = null, failure = null;
        long duration = 10000, stopTimeout = 5000; bool confirmed = false, attributesReady = false;
        uint exitCode = STILL_ACTIVE, active = 0; Thread stdout = null, stderr = null;
        IntPtr stdinRead = IntPtr.Zero, stdinWrite = IntPtr.Zero, stdoutRead = IntPtr.Zero, stdoutWrite = IntPtr.Zero, stderrRead = IntPtr.Zero, stderrWrite = IntPtr.Zero;
        IntPtr attributes = IntPtr.Zero, handles = IntPtr.Zero, jobs = IntPtr.Zero, environment = IntPtr.Zero;
        var clock = Stopwatch.StartNew();
        try {
            string line = ReadLineBounded(1048576); Require(line != null, "REQUEST_MISSING");
            var request = Json.Deserialize<Dictionary<string, object>>(line);
            Require(request != null && Text(request, "protocol") == "aidn-validation-trampoline.v1", "INVALID_REQUEST");
            RequestSha = Text(request, "request_sha256"); EnvironmentSha = Text(request, "environment_sha256");
            Require(System.Text.RegularExpressions.Regex.IsMatch(RequestSha, "^[a-f0-9]{64}$") && System.Text.RegularExpressions.Regex.IsMatch(EnvironmentSha, "^[a-f0-9]{64}$"), "INVALID_REQUEST");
            RunnerId = Text(request, "runner_id"); Require(RunnerId.Length > 0 && RunnerId.Length <= 128, "INVALID_REQUEST");
            ParentJobName = Text(request, "parent_job_name");
            Require(System.Text.RegularExpressions.Regex.IsMatch(ParentJobName, "^Local\\\\aidn-execution-[a-f0-9]{32}$"), "PARENT_JOB_INVALID");
            IntPtr parentJob = OpenJobObject(4, false, ParentJobName);
            Require(parentJob != IntPtr.Zero, "PARENT_JOB_UNAVAILABLE");
            try { bool belongs; Require(IsProcessInJob(GetCurrentProcess(), parentJob, out belongs) && belongs, "PARENT_JOB_MEMBERSHIP_REFUSED"); }
            finally { CloseHandle(parentJob); }
            string executable = Text(request, "executable"), cwd = Text(request, "cwd");
            Require(Path.IsPathRooted(executable) && Path.IsPathRooted(cwd) && Directory.Exists(cwd), "INVALID_REQUEST");
            duration = Number(request, "max_duration_ms", 86400000); MaxOutput = Number(request, "max_output_bytes", 1073741824);
            var args = request["args"] as System.Collections.IList; Require(args != null && args.Count <= 256, "INVALID_REQUEST");
            var argv = new List<string> { executable };
            foreach (object arg in args) { Require(arg is string && ((string)arg).IndexOf('\0') < 0, "INVALID_REQUEST"); argv.Add((string)arg); }
            string command = String.Join(" ", argv.Select(Quote)); Require(command.Length < 32767, "INVALID_REQUEST");
            string environmentJson = Text(request, "environment_json");
            using (var input = new MemoryStream(Encoding.UTF8.GetBytes(environmentJson))) Require(Hash(input) == EnvironmentSha, "ENVIRONMENT_HASH_MISMATCH");
            var env = Json.Deserialize<Dictionary<string, object>>(environmentJson);
            var allowedNames = new HashSet<string>(new [] { "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "TZ", "NO_COLOR" }, StringComparer.OrdinalIgnoreCase);
            Require(env != null && env.Count <= allowedNames.Count && env.Keys.All(allowedNames.Contains), "ENVIRONMENT_REFUSED");
            var entries = new List<string>(); var keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var entry in env) { Require(entry.Key.Length > 0 && entry.Key.IndexOfAny(new char[] { '=', '\0' }) < 0 && entry.Value is string && ((string)entry.Value).IndexOf('\0') < 0 && keys.Add(entry.Key), "INVALID_REQUEST"); entries.Add(entry.Key + "=" + (string)entry.Value); }
            entries.Sort(StringComparer.OrdinalIgnoreCase); string block = String.Join("\0", entries) + "\0\0"; Require(block.Length < 32767, "INVALID_REQUEST");
            byte[] prompt = new byte[0];
            jobName = "Local\\aidn-execution-" + Guid.NewGuid().ToString("N"); Job = CreateJobObject(IntPtr.Zero, jobName); int jobError = Marshal.GetLastWin32Error();
            Require(Job != IntPtr.Zero, "JOB_CREATE_FAILED"); Require(jobError != 183, "JOB_ALREADY_EXISTS");
            var limits = new EXTENDED_LIMITS(); limits.basic.flags = 0x2000;
            Require(SetInformationJobObject(Job, 9, ref limits, (uint)Marshal.SizeOf(typeof(EXTENDED_LIMITS))), "JOB_LIMIT_FAILED");
            var security = new SECURITY_ATTRIBUTES { length = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)), inherit = 1 };
            Require(CreatePipe(out stdinRead, out stdinWrite, ref security, 0) && CreatePipe(out stdoutRead, out stdoutWrite, ref security, 0) && CreatePipe(out stderrRead, out stderrWrite, ref security, 0), "PIPE_CREATE_FAILED");
            Require(SetHandleInformation(stdinWrite, 1, 0) && SetHandleInformation(stdoutRead, 1, 0) && SetHandleInformation(stderrRead, 1, 0), "PIPE_INHERITANCE_FAILED");
            IntPtr size = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size); Require(size != IntPtr.Zero, "JOB_ATTRIBUTE_UNAVAILABLE");
            attributes = Marshal.AllocHGlobal(size); Require(InitializeProcThreadAttributeList(attributes, 2, 0, ref size), "JOB_ATTRIBUTE_UNAVAILABLE"); attributesReady = true;
            handles = Marshal.AllocHGlobal(IntPtr.Size * 3); Marshal.WriteIntPtr(handles, 0, stdinRead); Marshal.WriteIntPtr(handles, IntPtr.Size, stdoutWrite); Marshal.WriteIntPtr(handles, IntPtr.Size * 2, stderrWrite);
            jobs = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobs, Job);
            Require(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20002), handles, new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero), "HANDLE_ATTRIBUTE_FAILED");
            // JOB_LIST makes assignment part of CreateProcess: no orphan-before-assignment window.
            Require(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x2000d), jobs, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero), "JOB_ATTRIBUTE_UNAVAILABLE");
            environment = Marshal.StringToHGlobalUni(block);
            var startup = new STARTUPINFOEX { attributes = attributes }; startup.startup.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
            startup.startup.flags = 0x101; startup.startup.show = 0; startup.startup.stdin = stdinRead; startup.startup.stdout = stdoutWrite; startup.startup.stderr = stderrWrite;
            PROCESS_INFORMATION process;
            using (var binary = new FileStream(executable, FileMode.Open, FileAccess.Read, FileShare.Read)) {
                Require(Hash(binary) == Text(request, "executable_sha256"), "EXECUTABLE_HASH_MISMATCH");
                Require(CreateProcess(executable, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, true,
                    0x4 | 0x400 | 0x80000 | 0x8000000, environment, cwd, ref startup, out process), "CREATE_PROCESS_FAILED");
                Created = true; ProcessHandle = process.process; ThreadHandle = process.thread; Pid = process.pid;
            }
            Close(ref stdinRead); Close(ref stdoutWrite); Close(ref stderrWrite);
            bool member; Require(IsProcessInJob(ProcessHandle, Job, out member) && member, "JOB_ASSIGNMENT_UNCONFIRMED");
            parentJob = OpenJobObject(4, false, ParentJobName); Require(parentJob != IntPtr.Zero, "PARENT_JOB_UNAVAILABLE");
            try { bool belongs; Require(IsProcessInJob(ProcessHandle, parentJob, out belongs) && belongs, "CHILD_PARENT_JOB_MEMBERSHIP_REFUSED"); }
            finally { CloseHandle(parentJob); }
            FILETIME created, exited, kernel, user; Require(GetProcessTimes(ProcessHandle, out created, out exited, out kernel, out user), "PROCESS_IDENTITY_FAILED");
            startedAt = DateTime.FromFileTimeUtc(((long)created.high << 32) | created.low).ToString("o");
            Emit("prepared", new Dictionary<string, object> { { "pid", Pid }, { "started_at", startedAt }, { "job_name", jobName }, { "suspended", true }, { "job_assigned", true }, { "parent_job_name", ParentJobName }, { "parent_job_member", true }, { "environment_sha256", EnvironmentSha }, { "executable_sha256", Text(request, "executable_sha256") } });
            ResumeRequested = true; // The outer controller owns cancellation; no control channel is inherited.
            stdout = Drain(stdoutRead, "stdout"); stdoutRead = IntPtr.Zero; stderr = Drain(stderrRead, "stderr"); stderrRead = IntPtr.Zero;
            while (!ResumeRequested && Reason() == null && clock.ElapsedMilliseconds < duration) Thread.Sleep(5);
            if (clock.ElapsedMilliseconds >= duration) Stop("TIMEOUT");
            if (Reason() == null) {
                lock (OutputLock) {
                    Require(ResumeThread(ThreadHandle) != UInt32.MaxValue, "RESUME_FAILED"); Resumed = true; Close(ref ThreadHandle);
                }
                IntPtr input = stdinWrite; stdinWrite = IntPtr.Zero;
                var writer = new Thread(() => {
                    try { using (var stream = new FileStream(new SafeFileHandle(input, true), FileAccess.Write, 4096, false)) stream.Write(prompt, 0, prompt.Length); }
                    catch { /* Early stdin closure remains a child protocol observation. */ }
                }); writer.IsBackground = true; writer.Start();
            }
            long stopping = -1;
            for (;;) {
                if (clock.ElapsedMilliseconds >= duration) Stop("TIMEOUT");
                if (Reason() != null && stopping < 0) { Require(TerminateJobObject(Job, 125), "JOB_TERMINATE_FAILED"); stopping = clock.ElapsedMilliseconds; Close(ref stdinWrite); }
                active = Active(); if (active == 0) { confirmed = true; break; }
                if (stopping >= 0 && clock.ElapsedMilliseconds - stopping >= stopTimeout) { failure = "JOB_TERMINATION_UNCONFIRMED"; break; }
                Thread.Sleep(10);
            }
            Require(GetExitCodeProcess(ProcessHandle, out exitCode), "PROCESS_EXIT_UNAVAILABLE");
        } catch (Exception error) {
            failure = error is InvalidOperationException ? error.Message : "HELPER_FAILED";
            if (Created && Job != IntPtr.Zero) {
                try {
                    TerminateJobObject(Job, 125); var deadline = Stopwatch.StartNew();
                    while (deadline.ElapsedMilliseconds < stopTimeout) { active = Active(); if (active == 0) { confirmed = true; break; } Thread.Sleep(10); }
                    GetExitCodeProcess(ProcessHandle, out exitCode);
                } catch { confirmed = false; }
            }
        } finally {
            Close(ref stdinRead); Close(ref stdinWrite); Close(ref stdoutWrite); Close(ref stderrWrite); Close(ref stdoutRead); Close(ref stderrRead);
            if (attributes != IntPtr.Zero) { if (attributesReady) DeleteProcThreadAttributeList(attributes); Marshal.FreeHGlobal(attributes); }
            if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles); if (jobs != IntPtr.Zero) Marshal.FreeHGlobal(jobs); if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
            Close(ref ThreadHandle); Close(ref ProcessHandle);
        }
        bool streamsDone = (stdout == null || stdout.Join((int)stopTimeout)) && (stderr == null || stderr.Join((int)stopTimeout));
        if (!streamsDone) { failure = "STREAM_TERMINATION_UNCONFIRMED"; confirmed = false; }
        string reason = failure ?? Reason() ?? (exitCode == 0 ? "PROCESS_EXITED" : "PROCESS_FAILED");
        string outcome = Created && !confirmed ? "indeterminate" : reason == "TIMEOUT" ? "timed_out" : reason == "CANCELLED" ? "cancelled" : reason == "PROCESS_EXITED" ? "completed" : "failed";
        try { Emit("terminal", new Dictionary<string, object> {
            { "outcome", outcome }, { "reason_code", reason }, { "termination_state", !Created ? "not_started" : confirmed ? "confirmed" : "unknown" },
            { "exit_code", Created && exitCode != STILL_ACTIVE ? (object)(long)exitCode : null }, { "pid", Created ? (object)Pid : null },
            { "job_name", jobName }, { "started_at", startedAt }, { "active_processes", Created && confirmed ? (object)0 : null },
            { "observed_at", DateTime.UtcNow.ToString("o") }, { "resumed", Resumed }, { "bytes", OutputBytes }
        }); } catch { /* Last-handle close still stops associated processes. */ }
        Close(ref Job); return outcome == "indeterminate" ? 2 : 0;
    }
}
