import { createPrivateKey, createPublicKey } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { readAgentRunFile } from "../../application/runtime/agent-run-configuration-service.mjs";

const client = "codex-desktop-windows";

function requireCodexDesktop() {
  if (process.platform !== "win32") throw Error("CODEX_DESKTOP_FORM_CLIENT_UNAVAILABLE");
  const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$desktop = @(Get-AppxPackage -Name OpenAI.Codex | Where-Object { $_.PackageFamilyName -eq 'OpenAI.Codex_2p2nqsd0c76g0' -and $_.SignatureKind -eq 'Store' -and $_.Status -eq 'Ok' })",
    "if ($desktop.Count -ne 1) { throw 'Package unavailable' }",
    "$child = Get-CimInstance Win32_Process -Filter 'ProcessId=" + process.pid + "'",
    "$bridge = Get-CimInstance Win32_Process -Filter 'ProcessId=" + process.ppid + "'",
    "$app = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$bridge.ParentProcessId)",
    "if ($child.ParentProcessId -ne $bridge.ProcessId -or $bridge.CreationDate -gt $child.CreationDate -or $app.CreationDate -gt $bridge.CreationDate -or $child.SessionId -ne $bridge.SessionId -or $bridge.SessionId -ne $app.SessionId) { throw 'Client process changed' }",
    "if ($bridge.ExecutablePath -ne (Join-Path $desktop[0].InstallLocation 'app/resources/codex.exe') -or $app.ExecutablePath -ne (Join-Path $desktop[0].InstallLocation 'app/ChatGPT.exe')) { throw 'Client process unavailable' }",
  ].join("\n");
  try {
    execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 10000, maxBuffer: 16384, stdio: ["ignore", "pipe", "pipe"] });
  } catch { throw Error("CODEX_DESKTOP_FORM_CLIENT_UNAVAILABLE"); }
}

// The installation service owns the private directory under the protected
// host home. This launcher is outside the AIDN work actor writable roots.
export function loadWindowsCodexFormIssuer({ authorityId, principals, home }) {
  if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(authorityId) || !path.isAbsolute(home ?? ""))
    throw Error("CODEX_FORM_ISSUER_CONFIGURATION_INVALID");
  const principal = principals.find(row => row.authority_id === authorityId && row.codex_form?.client === client);
  if (!principal) throw Error("CODEX_DECISION_CHANNEL_NOT_ENROLLED");
  requireCodexDesktop();
  const entry = readAgentRunFile(path.join(home, "codex-form-issuers", authorityId + ".pem"),
    { json: false, optional: true, maxBytes: 512 });
  if (!entry) throw Error("CODEX_FORM_ISSUER_KEY_UNAVAILABLE");
  const privateKey = createPrivateKey(entry.value);
  if (privateKey.asymmetricKeyType !== "ed25519" || !createPublicKey(privateKey).export({ type: "spki", format: "der" })
    .equals(createPublicKey(principal.public_key).export({ type: "spki", format: "der" })))
    throw Error("CODEX_FORM_ISSUER_KEY_CHANGED");
  return { authority_id: authorityId, ...principal.codex_form, privateKey };
}
