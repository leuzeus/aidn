import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SOURCE = path.resolve(import.meta.dirname, "../../src/adapters/runtime/codex-validation-trampoline.cs");
const ACCESS_SOURCE = path.join(path.dirname(SOURCE), "codex-validation-access-check.cs");
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
// Explicit compilation into a caller-selected empty directory. No installation,
// account, ACL, firewall, sandbox, profile, trust or runtime setup is performed.
function buildHelper({ outputDir, compilerPath } = {}, source, name, contract) {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("TRAMPOLINE_PLATFORM_UNAVAILABLE");
  if (![outputDir, compilerPath].every(value => typeof value === "string" && path.isAbsolute(value))) throw new Error("TRAMPOLINE_ABSOLUTE_PATH_REQUIRED");
  const verifyPhysical = target => { let cursor = path.resolve(target); for (;;) {
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error("TRAMPOLINE_PATH_ALIAS");
    const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
  } if (fs.realpathSync.native(target).toLowerCase() !== path.resolve(target).toLowerCase()) throw new Error("TRAMPOLINE_PATH_ALIAS"); };
  verifyPhysical(outputDir); verifyPhysical(compilerPath);
  if (!fs.statSync(outputDir).isDirectory() || fs.readdirSync(outputDir).length || !fs.statSync(compilerPath).isFile()) throw new Error("TRAMPOLINE_BUILD_TARGET_INVALID");
  const executable = path.join(outputDir, name), sourceHash = hash(source), compilerHash = hash(compilerPath);
  const result = spawnSync(compilerPath, ["/nologo", "/target:exe", "/platform:x64", "/optimize+", "/reference:System.Web.Extensions.dll", `/out:${executable}`, source],
    { cwd: outputDir, windowsHide: true, shell: false, encoding: "utf8", timeout: 60000, maxBuffer: 65536, stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.signal || result.status !== 0) throw Object.assign(new Error("TRAMPOLINE_BUILD_FAILED"), {
    diagnostics: { code: result.status, signal: result.signal, error: result.error?.code, tail: `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(-4096) } });
  if (hash(source) !== sourceHash || hash(compilerPath) !== compilerHash) throw new Error("TRAMPOLINE_BUILD_SOURCE_CHANGED");
  const manifest = { contract_version: contract, platform: process.platform, architecture: process.arch,
    executable, sha256: hash(executable), source, source_sha256: sourceHash, compiler: compilerPath, compiler_sha256: compilerHash };
  fs.writeFileSync(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" }); return manifest;
}
export function buildCodexValidationTrampoline(options) {
  return buildHelper(options, SOURCE, "aidn-validation-trampoline.exe", "codex-validation-trampoline-build.v1");
}
export function buildCodexValidationAccessObserver(options) {
  return buildHelper(options, ACCESS_SOURCE, "aidn-validation-access-check.exe", "codex-validation-access-check-build.v1");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const args = process.argv.slice(2), access = args[0] === "--access-observer";
    if (access) args.shift();
    if (args.length !== 4 || args[0] !== "--out-dir" || args[2] !== "--compiler") throw new Error("usage: [--access-observer] --out-dir <empty physical directory> --compiler <absolute csc.exe>");
    const build = access ? buildCodexValidationAccessObserver : buildCodexValidationTrampoline;
    console.log(JSON.stringify({ status: "BUILT_NOT_QUALIFIED", ...build({ outputDir: args[1], compilerPath: args[3] }) }));
  } catch (cause) { console.error(JSON.stringify({ status: "FAIL", reason_code: cause.message, diagnostics: cause.diagnostics })); process.exitCode = 1; }
}
