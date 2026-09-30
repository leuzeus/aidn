#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const WINDOWS_PROCESS_HELPER_SOURCE = path.resolve(import.meta.dirname,
  "../../src/adapters/agents/process-tree/windows-job-helper.cs");
const hashFile = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

// Explicit build only: importing this module or inspecting availability never compiles.
export function buildAgentProcessHelper({ outputDir, compilerPath = path.join(
  process.env.WINDIR ?? "C:\\Windows", "Microsoft.NET/Framework64/v4.0.30319/csc.exe"),
} = {}) {
  if (process.platform !== "win32") throw new Error("PROCESS_HELPER_PLATFORM_UNAVAILABLE");
  if (!path.isAbsolute(outputDir ?? "") || !path.isAbsolute(compilerPath)) throw new Error("PROCESS_HELPER_ABSOLUTE_PATH_REQUIRED");
  if (!fs.statSync(compilerPath).isFile()) throw new Error("PROCESS_HELPER_COMPILER_UNAVAILABLE");
  fs.mkdirSync(outputDir, { recursive: true });
  if (fs.readdirSync(outputDir).length) throw new Error("PROCESS_HELPER_OUTPUT_MUST_BE_EMPTY");
  if (fs.realpathSync.native(outputDir).toLowerCase() !== path.resolve(outputDir).toLowerCase()) throw new Error("PROCESS_HELPER_OUTPUT_ALIAS_REFUSED");
  const executable = path.join(outputDir, "aidn-process-job.exe");
  const sourceSha256 = hashFile(WINDOWS_PROCESS_HELPER_SOURCE);
  const result = spawnSync(compilerPath, ["/nologo", "/target:exe", "/platform:x64", "/optimize+",
    "/reference:System.Web.Extensions.dll", `/out:${executable}`, WINDOWS_PROCESS_HELPER_SOURCE], {
    cwd: outputDir, windowsHide: true, shell: false, encoding: "utf8", timeout: 60000,
    maxBuffer: 65536, stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.signal || result.status !== 0) {
    const error = new Error("PROCESS_HELPER_BUILD_FAILED");
    error.diagnostics = { exit_code: result.status, signal: result.signal,
      error_code: result.error?.code ?? null, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(-8192) };
    throw error;
  }
  if (hashFile(WINDOWS_PROCESS_HELPER_SOURCE) !== sourceSha256) throw new Error("PROCESS_HELPER_SOURCE_CHANGED_DURING_BUILD");
  const manifest = {
    contract_version: "agent-process-helper-build.v1", platform: "win32", architecture: "x64",
    manifest_path: path.join(outputDir, "manifest.json"),
    helper_path: executable, helper_sha256: hashFile(executable),
    source_path: WINDOWS_PROCESS_HELPER_SOURCE, source_sha256: sourceSha256,
    compiler_path: compilerPath, compiler_sha256: hashFile(compilerPath),
  };
  fs.writeFileSync(manifest.manifest_path, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== "--out-dir") throw new Error("usage: build-agent-process-helper.mjs --out-dir <empty absolute directory>");
    console.log(JSON.stringify({ ok: true, ...buildAgentProcessHelper({ outputDir: args[1] }) }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, reason: error.message, diagnostics: error.diagnostics }));
    process.exitCode = 1;
  }
}
