#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readAgentRunFile } from "../../src/application/runtime/agent-run-configuration-service.mjs";
import { resolveRuntimeProjectContext } from "../../src/application/runtime/runtime-project-context-service.mjs";
import { createStandardOperatorSession } from "../../src/adapters/workflow-console/standard-operator-session.mjs";
import { serveWindowsDecisionPanel } from "../../src/adapters/workflow-console/standard-windows-decision-panel.mjs";
import {
  assertWindowsEnrollmentIntent, readStandardWindowsOperator, windowsEnrollmentVersion, windowsOperatorSystemDirectory,
} from "../../src/adapters/runtime/standard-windows-operator-authority.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

const print = value => console.log(JSON.stringify(value));
const fail = code => { throw Error(code); };
const policy = targetRoot => readStandardWindowsOperator({ targetRoot, environment: process.env });
const scope = targetRoot => resolveRuntimeProjectContext({ targetRoot, env: process.env });
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const read = file => readAgentRunFile(path.resolve(file), { maxBytes: 32768 }).value;

function operatorSid() {
  const response = spawnSync(path.join(windowsOperatorSystemDirectory(), "whoami.exe"), ["/user", "/fo", "csv", "/nh"],
    { encoding: "utf8", timeout: 3000, windowsHide: true, maxBuffer: 4096 });
  const match = /"(S-1-5-21(?:-[0-9]{1,10}){4})"/.exec(response.stdout ?? "");
  if (response.status !== 0 || !match) fail("STANDARD_WINDOWS_OPERATOR_IDENTITY_UNAVAILABLE");
  return match[1];
}

export function prepareWindowsOperatorInstallation(targetRoot, file, expected = null) {
  const plan = path.resolve(file);
  const { value, sha256: observed } = readAgentRunFile(plan, { maxBytes: 32768 });
  if (expected !== null && observed !== expected) fail("STANDARD_WINDOWS_OPERATOR_ENROLLMENT_CHANGED");
  assertWindowsEnrollmentIntent(value, scope(targetRoot));
  if (value.operator_sid !== operatorSid()) fail("STANDARD_WINDOWS_OPERATOR_IDENTITY_CHANGED");
  return { plan, sha256: observed, intent: value };
}

export function installWindowsOperator(targetRoot, file, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected ?? "")) fail("STANDARD_WINDOWS_OPERATOR_EXPECT_PLAN_REQUIRED");
  const { plan, intent } = prepareWindowsOperatorInstallation(targetRoot, file, expected);
  const verified = installed => {
    const { public_key, credential_id, ...fields } = installed;
    if (shadowHash({ ...fields, contract_version: windowsEnrollmentVersion }) !== shadowHash(intent))
      fail("STANDARD_WINDOWS_OPERATOR_AUTHORITY_CHANGED");
    return status(installed);
  };
  try { return verified(policy(targetRoot)); }
  catch (error) { if (error.message !== "STANDARD_WINDOWS_OPERATOR_NOT_ENROLLED") throw error; }
  const script = fileURLToPath(new URL("./install-standard-windows-operator.ps1", import.meta.url));
  const native = fileURLToPath(new URL("../../src/adapters/workflow-console/windows-operator-enrollment.cs", import.meta.url));
  const safeLiteral = value => "'" + value.replaceAll("'", "''") + "'";
  const powershell = path.join(windowsOperatorSystemDirectory(), "WindowsPowerShell", "v1.0", "powershell.exe");
  const readPinned = file => safeLiteral(file) + " " + safeLiteral(sha256(fs.readFileSync(file)));
  const elevated = "$ErrorActionPreference = 'Stop'; function Read-Pinned([string]$file,[string]$expected) { "
    + "$bytes = [IO.File]::ReadAllBytes($file); $sha = [Security.Cryptography.SHA256]::Create(); "
    + "try { $actual = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }; "
    + "if ($actual -cne $expected) { throw 'STANDARD_WINDOWS_OPERATOR_INSTALLER_CHANGED' }; "
    + "return [Text.UTF8Encoding]::new($false,$true).GetString($bytes) }; "
    + "$script = Read-Pinned " + readPinned(script) + "; $native = Read-Pinned " + readPinned(native) + "; "
    + "& ([ScriptBlock]::Create($script)) -Plan " + safeLiteral(plan) + " -ExpectPlan " + safeLiteral(expected) + " -NativeSource $native";
  const childArgs = "-NoProfile -EncodedCommand " + Buffer.from(elevated, "utf16le").toString("base64");
  const command = "$ErrorActionPreference = 'Stop'; $p = Start-Process -FilePath " + safeLiteral(powershell)
    + " -ArgumentList " + safeLiteral(childArgs) + " -Verb RunAs -Wait -PassThru; exit $p.ExitCode";
  const result = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")],
    { stdio: "inherit", timeout: 300_000, windowsHide: true });
  if (result.status !== 0) fail("STANDARD_WINDOWS_OPERATOR_ENROLLMENT_NOT_COMPLETED");
  return verified(policy(targetRoot));
}

function status(installed) {
  return { status: "enrolled", authority_sha256: shadowHash(installed), origin: installed.origin, thread_id: installed.thread_id,
    credential_sha256: sha256(Buffer.from(installed.credential_id, "base64url")) };
}

async function main([verb, target, ...args]) {
  const targetRoot = target ? path.resolve(target) : null;
  if (!targetRoot) fail("STANDARD_WINDOWS_OPERATOR_USAGE");
  if (verb === "--prepare-enrollment" && args.length === 3) {
    const currentScope = scope(targetRoot);
    const [thread, port, decisionsFile] = args;
    print(assertWindowsEnrollmentIntent({
      contract_version: windowsEnrollmentVersion, project_id: currentScope.project_id, runtime_scope_id: currentScope.runtime_scope_id,
      thread_id: thread, origin: "http://localhost:" + port, operator_sid: operatorSid(), decisions: read(decisionsFile),
    }, currentScope));
  } else if (verb === "--enrollment-status" && !args.length) {
    print(status(policy(targetRoot)));
  } else if (verb === "--serve" && args.length === 2) {
    const [configuration, threadId] = args;
    const session = createStandardOperatorSession({ targetRoot, configuration });
    const bound = session.windowsOperatorPolicy?.();
    if (!bound || bound.thread_id !== threadId) fail("STANDARD_WINDOWS_OPERATOR_CHAT_CHANGED");
    if ((await session.question()).status === "retained") await session.resume();
    const panel = await serveWindowsDecisionPanel({ session, threadId });
    print({ status: "listening", url: panel.url });
  } else {
    fail("STANDARD_WINDOWS_OPERATOR_USAGE");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await main(process.argv.slice(2)); }
  catch (error) {
    print({ status: "refused", code: /^[A-Z][A-Z_0-9]{0,100}$/.test(error.message) ? error.message : "STANDARD_WINDOWS_OPERATOR_UNAVAILABLE" });
    process.exitCode = 1;
  }
}
