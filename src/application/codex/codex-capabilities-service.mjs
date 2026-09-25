import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const COMMON_EVENTS = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PermissionRequest",
  "PostToolUse", "PreCompact", "PostCompact", "SubagentStart", "SubagentStop", "Stop"];
const VERIFIED = {
  "0.146.0-alpha.9.2": { source_commit: "86cc9f2177cad015befd595286d8767a650f7d13", mcp_hooks: "unsupported", events: COMMON_EVENTS },
  "0.155.0-alpha.9.2": { source_commit: "4607249e430dac1c961df4dc615beae88e33cec8", mcp_hooks: "schema_verified", events: [...COMMON_EVENTS, "Interrupt"] },
};
function isFile(file) { try { return fs.statSync(file).isFile(); } catch { return false; } }
function directories(root) { try { return fs.readdirSync(root, {withFileTypes:true}).filter((item)=>item.isDirectory()).map((item)=>item.name); } catch { return []; } }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file,"utf8")); } catch { return null; } }

export function codexVersionCapabilities(version) {
  const verified = VERIFIED[version];
  return { version_status: verified ? "schema_verified" : "unverified", command_hooks: verified ? "schema_verified" : "unknown",
    mcp_hooks: verified?.mcp_hooks ?? "unknown", events: verified ? [...verified.events] : [],
    source_commit: verified?.source_commit ?? null, native_qualification: "not_executed" };
}

function pathLauncher(env, platform) {
  const entries = String(env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean);
  for (const entry of entries) {
    const names = platform === "win32" ? ["codex.exe", "codex.cmd", "codex"] : ["codex"];
    for (const name of names) {
      const candidate = path.join(entry.replace(/^"|"$/g,""),name);
      if (!isFile(candidate)) continue;
      if (name.endsWith(".cmd")) {
        const script = path.join(path.dirname(candidate),"node_modules","@openai","codex","bin","codex.js");
        if (isFile(script)) return {source:candidate,command:process.execPath,args:[script]};
        continue; // Never execute an arbitrary shell wrapper just to diagnose it.
      }
      return {source:candidate,command:candidate,args:[]};
    }
  }
  return null;
}

function probe(launcher, targetRoot, commandRunner, probeVersion) {
  if (!launcher) return { version:null, version_probe:"not_available" };
  if (!probeVersion) return { version:null, version_probe:"not_requested" };
  try {
    const result = commandRunner(launcher.command,[...launcher.args,"--version"],{
      cwd:targetRoot,encoding:"utf8",shell:false,windowsHide:true,timeout:3000,maxBuffer:16384,
    });
    const version = String(result.stdout ?? "").trim().match(/^codex-cli\s+(\S+)$/)?.[1] ?? null;
    return { version:result.status === 0 && !result.error ? version : null,
      version_probe:result.status === 0 && !result.error && version ? "observed" : "unavailable" };
  } catch { return {version:null,version_probe:"unavailable"}; }
}

/** Read-only local inventory. It does not start app-server, authenticate or infer native trust. */
export function inspectCodexCapabilities({ targetRoot = process.cwd(), env = process.env,
  platform = process.platform, commandRunner = spawnSync, probeVersion = true } = {}) {
  const root = path.resolve(targetRoot);
  const clients = [];
  const warnings = [];
  const add = (kind, launcher, metadata = {}) => {
    const observed = probe(launcher,root,commandRunner,probeVersion);
    clients.push({kind,detected:Boolean(launcher) || metadata.app_detected === true,source:launcher?.source ?? null,
      ...metadata,...observed,capabilities:codexVersionCapabilities(observed.version)});
  };
  add("cli",pathLauncher(env,platform));
  if (platform === "win32") {
    const runtimeRoot = env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA,"OpenAI","Codex","bin") : null;
    const backends = runtimeRoot ? directories(runtimeRoot).map((dir)=>path.join(runtimeRoot,dir,"codex.exe")).filter(isFile) : [];
    const appRoots = [env.ProgramFiles && path.join(env.ProgramFiles,"WindowsApps"),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA,"Microsoft","WindowsApps")].filter(Boolean);
    const packages = appRoots.flatMap((dir)=>directories(dir).filter((name)=>name.startsWith("OpenAI.Codex_")).map((name)=>({
      package:name,path:path.join(dir,name,"app","ChatGPT.exe"),
    }))).filter((item)=>isFile(item.path));
    const app = packages[0];
    if (!backends.length) add("desktop",null,{app_detected:app ? true : "unknown",package:app?.package ?? null});
    for (const binary of backends) add("desktop",{source:binary,command:binary,args:[]},
      {app_detected:app ? true : "unknown",package:app?.package ?? null,active_backend:"unknown"});
  } else {
    const desktopPaths = platform === "darwin"
      ? ["/Applications/Codex.app", "/Applications/ChatGPT.app"] : [];
    add("desktop",null,{app_detected:desktopPaths.some((item)=>fs.existsSync(item)) ? true : "unknown"});
  }
  const userRoot = env.USERPROFILE ?? env.HOME;
  if (userRoot) {
    for (const editor of [".vscode",".vscode-insiders"]) {
      const extensions = path.join(userRoot,editor,"extensions");
      for (const name of directories(extensions).filter((item)=>item.startsWith("openai.chatgpt-"))) {
        const extensionRoot = path.join(extensions,name);
        const manifest = readJson(path.join(extensionRoot,"package.json"));
        if (manifest?.publisher !== "openai" || manifest?.name !== "chatgpt") continue;
        const binRoot = path.join(extensionRoot,"bin");
        const prefix = platform === "win32" ? "windows-" : platform === "darwin" ? "macos-" : "linux-";
        const binaries = directories(binRoot).filter((dir)=>dir.startsWith(prefix)).map((dir)=>path.join(binRoot,dir,platform === "win32" ? "codex.exe" : "codex")).filter(isFile);
        const binary = binaries[0];
        add("ide",binary ? {source:binary,command:binary,args:[]} : null,
          {extension_installed:true,extension_version:manifest?.version ?? null,active_extension:"unknown"});
      }
    }
  }
  const expected = ["AGENTS.md", ".agents/skills", ".codex/agents", ".codex/hooks.json",
    ".codex/hooks/aidn-session-start.mjs", ".codex/hooks/aidn-pre-tool-use.mjs", ".codex/hooks/aidn-hook-runtime.mjs",
    ".aidn/install/receipt.json"];
  const missing = expected.filter((item)=>!fs.existsSync(path.join(root,item)));
  const detected = clients.some((client)=>client.detected);
  if (!clients[0].detected) warnings.push("cli_not_on_path; desktop and IDE inventories are independent");
  if (clients.some((client)=>client.detected && client.capabilities.version_status === "unverified")) {
    warnings.push("client_version_unqualified; installed templates do not prove native execution");
  }
  warnings.push("project_and_hook_trust_not_inspected; approval requires the native client");
  const hooks = readJson(path.join(root,".codex/hooks.json"));
  const configured = (hooks?.hooks?.PreToolUse ?? []).some((group) => group.matcher === "^(apply_patch|Edit|Write)$"
    && group.hooks?.some((hook) => String(hook.command ?? "").includes("aidn-pre-tool-use.mjs")));
  return {schema_version:1,clients,installation:{expected,missing},native_write_coverage:{
    configured:configured ? "edit-matcher-present" : "not-detected", tools:["apply_patch","Edit","Write"],
    payload_format:"codex-tool_input.command-v4a", expected_policy:"specific-canonical-task-scope", installed_policy:"not-verified-by-inventory",
    excluded:["shell","write_stdin","MCP","other-tools"], native_approval:"unknown", execution:"unverified",
    limitation:"Metadata describes configuration only; disabled, unapproved or unexecuted hooks provide no native refusal guarantee.",
  },states:{
    installed:missing.length === 0 ? "present" : missing.length === expected.length ? "absent" : "incomplete",
    detected:detected ? "present" : "unknown",approved:"unknown",connected:"not_applicable",
    operational:"unverified",degraded:missing.length > 0 || !detected,
  },warnings,scope:"local_metadata_and_version_only",effect_class:"read-only"};
}
