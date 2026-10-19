"""Owned Windows research runner: suspended launch, Job memory cap, EOF cleanup.

Only Python's standard library is used. The parent supplies an explicit local
binary/model command after digest verification. This does not manage Ollama.
"""
import ctypes as c
from ctypes import wintypes as w
import json
import msvcrt
import os
import subprocess
import sys
import threading
import time


def main():
    if os.name != "nt":
        raise RuntimeError("WINDOWS_JOB_REQUIRED")
    spec = json.load(open(sys.argv[1], encoding="utf-8-sig"))
    k = c.WinDLL("kernel32", use_last_error=True)
    class Basic(c.Structure):
        _fields_ = [("ProcessTime", c.c_int64), ("JobTime", c.c_int64), ("LimitFlags", w.DWORD),
                    ("MinWS", c.c_size_t), ("MaxWS", c.c_size_t), ("Active", w.DWORD),
                    ("Affinity", c.c_size_t), ("Priority", w.DWORD), ("Scheduling", w.DWORD)]
    class IO(c.Structure):
        _fields_ = [(name, c.c_uint64) for name in ("ReadOps", "WriteOps", "OtherOps", "ReadBytes", "WriteBytes", "OtherBytes")]
    class Limits(c.Structure):
        _fields_ = [("Basic", Basic), ("IO", IO), ("ProcessMemory", c.c_size_t), ("JobMemory", c.c_size_t),
                    ("PeakProcessMemory", c.c_size_t), ("PeakJobMemory", c.c_size_t)]
    class Memory(c.Structure):
        _fields_ = [("Length", w.DWORD), ("Load", w.DWORD)] + [(n, c.c_uint64) for n in
                     ("Total", "Free", "PageTotal", "PageFree", "VirtualTotal", "VirtualFree", "Extended")]
    class Startup(c.Structure):
        _fields_ = [("cb", w.DWORD), ("reserved", w.LPWSTR), ("desktop", w.LPWSTR), ("title", w.LPWSTR)] + [
            (n, w.DWORD) for n in ("x", "y", "xs", "ys", "xc", "yc", "fill", "flags")] + [
            ("show", w.WORD), ("reserved2size", w.WORD), ("reserved2", c.c_void_p),
            ("stdin", w.HANDLE), ("stdout", w.HANDLE), ("stderr", w.HANDLE)]
    class Process(c.Structure):
        _fields_ = [("process", w.HANDLE), ("thread", w.HANDLE), ("pid", w.DWORD), ("tid", w.DWORD)]
    k.CreateJobObjectW.argtypes = [c.c_void_p, w.LPCWSTR]; k.CreateJobObjectW.restype = w.HANDLE
    k.SetInformationJobObject.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD]
    k.QueryInformationJobObject.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.c_void_p]
    k.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
    k.TerminateJobObject.argtypes = [w.HANDLE, w.UINT]
    k.TerminateProcess.argtypes = [w.HANDLE, w.UINT]
    k.CloseHandle.argtypes = [w.HANDLE]
    k.ResumeThread.argtypes = [w.HANDLE]
    k.WaitForSingleObject.argtypes = [w.HANDLE, w.DWORD]
    k.GetExitCodeProcess.argtypes = [w.HANDLE, c.POINTER(w.DWORD)]
    k.CreateProcessW.argtypes = [w.LPCWSTR, w.LPWSTR, c.c_void_p, c.c_void_p, w.BOOL, w.DWORD,
                                c.c_void_p, w.LPCWSTR, c.POINTER(Startup), c.POINTER(Process)]
    def check(value):
        if not value:
            raise c.WinError(c.get_last_error())
    def free_memory():
        mem = Memory(); mem.Length = c.sizeof(mem); check(k.GlobalMemoryStatusEx(c.byref(mem))); return mem.Free
    if free_memory() < spec["memory_limit_bytes"] + spec["host_reserve_bytes"]:
        raise RuntimeError("RESOURCE_ADMISSION_REFUSED")
    job = k.CreateJobObjectW(None, None); check(job)
    limits = Limits(); limits.Basic.LimitFlags = 0x2000 | 0x100 | 0x200 | 0x8  # kill-on-close, process/job memory, active count
    limits.Basic.Active = 1
    limits.ProcessMemory = limits.JobMemory = spec["memory_limit_bytes"]
    pi = Process(); launched = False; log = null_input = None
    receipt = {"status": "STARTING", "memory_limit_bytes": spec["memory_limit_bytes"], "host_reserve_bytes": spec["host_reserve_bytes"],
               "memory_limit_kind": "windows-job-committed-memory", "host_reserve_kind": "physical-available",
               "suspended_assignment": False, "kill_on_job_close": True, "process_stopped": False}
    stop = threading.Event()
    try:
        check(k.SetInformationJobObject(job, 9, c.byref(limits), c.sizeof(limits)))
        si = Startup(); si.cb = c.sizeof(si); si.flags = 0x100
        # Inherit only the two explicit files, never the parent's lifetime pipe.
        for stream in (sys.stdin, sys.stdout, sys.stderr):
            os.set_handle_inheritable(msvcrt.get_osfhandle(stream.fileno()), False)
        log = open(spec["server_log"], "wb", buffering=0); null_input = open(os.devnull, "rb", buffering=0)
        for stream in (log, null_input):
            os.set_handle_inheritable(msvcrt.get_osfhandle(stream.fileno()), True)
        si.stdout = si.stderr = msvcrt.get_osfhandle(log.fileno()); si.stdin = msvcrt.get_osfhandle(null_input.fileno())
        # No inherited credentials or LLAMA_ARG overrides. Server flags are explicit.
        env = {n: os.environ[n] for n in ("SystemRoot", "WINDIR", "PATH", "TEMP", "TMP") if n in os.environ}
        env["OMP_NUM_THREADS"] = "2"
        block = c.create_unicode_buffer("\0".join(f"{n}={v}" for n, v in sorted(env.items())) + "\0\0")
        cmd = c.create_unicode_buffer(subprocess.list2cmdline(spec["command"]))
        check(k.CreateProcessW(spec["command"][0], cmd, None, None, True, 0x4 | 0x400 | 0x08000000,
                               block, spec["cwd"], c.byref(si), c.byref(pi)))
        launched = True
        check(k.AssignProcessToJobObject(job, pi.process))
        receipt.update(pid=pi.pid, suspended_assignment=True, status="RUNNING")
        if k.ResumeThread(pi.thread) == 0xFFFFFFFF:
            raise c.WinError(c.get_last_error())
        print(json.dumps({"pid": pi.pid, "status": "RUNNING"}), flush=True)
        def eof():
            sys.stdin.buffer.read(); stop.set()
        threading.Thread(target=eof, daemon=True).start()
        deadline = time.monotonic() + spec["deadline_seconds"]
        while k.WaitForSingleObject(pi.process, 200) == 258:
            if stop.is_set():
                receipt["status"] = "CLOSED"; break
            if free_memory() < spec["host_reserve_bytes"]:
                receipt["status"] = "HOST_RESERVE_REFUSED"; break
            if time.monotonic() > deadline:
                receipt["status"] = "DEADLINE_REFUSED"; break
        else:
            code = w.DWORD(); check(k.GetExitCodeProcess(pi.process, c.byref(code)))
            receipt.update(status="EXITED", exit_code=code.value)
    finally:
        peak = Limits()
        if k.QueryInformationJobObject(job, 9, c.byref(peak), c.sizeof(peak), None):
            receipt["peak_job_memory_bytes"] = peak.PeakJobMemory
        # Also terminate a suspended process if assignment failed.
        if launched:
            k.TerminateJobObject(job, 1); k.TerminateProcess(pi.process, 1)
            receipt["process_stopped"] = k.WaitForSingleObject(pi.process, 5000) == 0
            k.CloseHandle(pi.thread); k.CloseHandle(pi.process)
        k.CloseHandle(job)
        if log: log.close()
        if null_input: null_input.close()
        with open(spec["receipt"], "w", encoding="utf8") as out:
            json.dump(receipt, out, indent=2)


if __name__ == "__main__":
    main()
