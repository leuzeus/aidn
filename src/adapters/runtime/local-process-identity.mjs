import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const fail = () => { throw Object.assign(Error("PROCESS_IDENTITY_UNAVAILABLE"), { code: "PROCESS_IDENTITY_UNAVAILABLE" }); };
// A PID is only a lookup key. Never use PID absence as all-resource closure.
// Creation identity is observed from this OS, without any authored verifier.
export function observeLocalProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) fail();
  let creation;
  if (process.platform === "win32") {
    const executable = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
    const script = `$ErrorActionPreference='Stop'; try { $p=[System.Diagnostics.Process]::GetProcessById(${pid}); $p.StartTime.ToUniversalTime().Ticks.ToString() } catch [System.ArgumentException] { 'ABSENT' }`;
    try { creation = execFileSync(executable, ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", windowsHide: true, shell: false, timeout: 5000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"] }).trim(); }
    catch { fail(); }
    if (creation === "ABSENT") return null;
    if (!/^[0-9]{18}$/.test(creation)) fail();
  } else if (process.platform === "linux") {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8"), fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      // A zombie cannot execute. Its retained /proc entry is not a live owner.
      if (fields[0] === "Z") return null;
      creation = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() + ":" + fields[19];
      if (!/^[a-f0-9-]{36}:[0-9]+$/.test(creation)) fail();
    } catch (cause) { if (cause.code === "ENOENT") return null; fail(); }
  } else fail();
  return { platform: process.platform, host: os.hostname(), pid, creation };
}

export function observeLocalProcessOwner(identity) {
  if (!identity || identity.platform !== process.platform || identity.host !== os.hostname()) return "unresolved";
  const current = observeLocalProcess(identity.pid);
  return current === null || current.creation !== identity.creation ? "terminated" : "active";
}
