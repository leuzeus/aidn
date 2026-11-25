import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const fail = () => { throw Object.assign(Error("STANDARD_VALIDATION_RECOVERY_PROCESS_OBSERVATION_UNAVAILABLE"),
  { code: "STANDARD_VALIDATION_RECOVERY_PROCESS_OBSERVATION_UNAVAILABLE" }); };

// Used only with authenticated evidence that the sandbox command never began.
// The reviewed client can refresh credentials and retry a failed runner spawn.
// Conservatively refuse while ANY matching runner/trampoline is visible, even
// when it could belong to another session. Never terminate an unrelated process.
// This observation alone proves neither historical closure nor non-execution.
export function observeCodexValidationChildRunners() {
  if (process.platform !== "win32") fail();
  const executable = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
  const script = "$ErrorActionPreference='Stop'; $rows=@(Get-CimInstance Win32_Process -Filter \"Name='codex-command-runner.exe' OR Name='aidn-validation-trampoline.exe'\"); if ($rows.Count -gt 256) {throw 'Bound exceeded'}; [pscustomobject]@{complete=$true; pids=@($rows | ForEach-Object {[int]$_.ProcessId})} | ConvertTo-Json -Compress";
  let value;
  try { value = JSON.parse(execFileSync(executable, ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, shell: false, encoding: "utf8", timeout: 10000, maxBuffer: 16384, stdio: ["ignore", "pipe", "pipe"] })); }
  catch { fail(); }
  if (value?.complete !== true || !Array.isArray(value.pids) || value.pids.length > 256
    || value.pids.some(pid => !Number.isSafeInteger(pid) || pid <= 0) || new Set(value.pids).size !== value.pids.length) fail();
  return { contract_version: "codex-validation-process-observation.v1", platform: "win32", host: os.hostname(),
    observed_at: new Date().toISOString(), complete: true, image_names: ["codex-command-runner.exe", "aidn-validation-trampoline.exe"],
    matching_pids: value.pids.sort((a, b) => a - b), active_count: value.pids.length };
}
