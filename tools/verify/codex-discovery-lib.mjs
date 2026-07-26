import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";

function executableCandidates(env) {
  const pathEntries = String(env.PATH ?? "").split(path.delimiter).filter(Boolean);
  if (process.platform === "win32") {
    return pathEntries.flatMap((entry) => [
      path.join(entry, "codex.cmd"),
      path.join(entry, "codex.exe"),
      path.join(entry, "codex"),
    ]);
  }
  return pathEntries.map((entry) => path.join(entry, "codex"));
}

export function findCodexLauncher(env = process.env) {
  if (env.AIDN_CODEX_JS) {
    const script = path.resolve(env.AIDN_CODEX_JS);
    if (fs.existsSync(script)) {
      return { command: process.execPath, args: [script], source: script };
    }
  }
  for (const candidate of executableCandidates(env)) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    if (candidate.toLowerCase().endsWith(".cmd")) {
      const script = path.join(
        path.dirname(candidate),
        "node_modules",
        "@openai",
        "codex",
        "bin",
        "codex.js",
      );
      if (fs.existsSync(script)) {
        return { command: process.execPath, args: [script], source: candidate };
      }
      continue;
    }
    return { command: candidate, args: [], source: candidate };
  }
  return null;
}

export async function discoverRepoSkills({
  cwd,
  codexHome,
  env = process.env,
  timeoutMs = 30000,
}) {
  const launcher = findCodexLauncher(env);
  if (!launcher) {
    return {
      status: "SKIP",
      reason: "Codex CLI is not available on PATH",
      skills: [],
      errors: [],
    };
  }

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    "[analytics]\nenabled = false\n",
    "utf8",
  );

  const normalizedCwd = path.resolve(cwd);
  const child = spawn(launcher.command, [...launcher.args, "app-server"], {
    cwd: normalizedCwd,
    env: {
      ...env,
      CODEX_HOME: codexHome,
    },
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });
  const lines = readline.createInterface({ input: child.stdout });

  return new Promise((resolve, reject) => {
    let settled = false;
    let stderr = "";
    const finish = (callback) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.end();
      if (child.exitCode !== null || child.signalCode !== null) {
        callback();
        return;
      }
      let closed = false;
      let forceTimer = null;
      let abandonTimer = null;
      const complete = () => {
        if (closed) {
          return;
        }
        closed = true;
        clearTimeout(forceTimer);
        clearTimeout(abandonTimer);
        callback();
      };
      child.once("close", complete);
      child.kill();
      forceTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, 1000);
      abandonTimer = setTimeout(() => {
        if (!closed) {
          closed = true;
          clearTimeout(forceTimer);
          reject(new Error("Codex app-server did not exit after bounded termination"));
        }
      }, 5000);
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`Codex skills/list timed out after ${timeoutMs} ms`)));
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      finish(() => reject(error));
    });
    child.on("exit", (code) => {
      if (!settled && code !== 0) {
        finish(() => reject(new Error(
          `Codex app-server exited with ${code}: ${stderr.trim()}`,
        )));
      }
    });
    lines.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id === 1) {
        child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
        child.stdin.write(`${JSON.stringify({
          method: "skills/list",
          id: 2,
          params: {
            cwds: [normalizedCwd],
            forceReload: true,
          },
        })}\n`);
        return;
      }
      if (message.id !== 2) {
        return;
      }
      if (message.error) {
        finish(() => reject(new Error(`Codex skills/list failed: ${JSON.stringify(message.error)}`)));
        return;
      }
      const entry = message.result?.data?.find(
        (item) => path.resolve(item.cwd) === normalizedCwd,
      );
      const skills = (entry?.skills ?? []).filter(
        (skill) => skill.scope === "repo"
          && path.resolve(skill.path).startsWith(path.join(normalizedCwd, ".agents", "skills")),
      );
      const errors = entry?.errors ?? [];
      finish(() => resolve({
        status: errors.length === 0 ? "PASS" : "FAIL",
        launcher: launcher.source,
        codex_home: path.resolve(codexHome),
        cwd: normalizedCwd,
        skills,
        errors,
      }));
    });

    child.stdin.write(`${JSON.stringify({
      method: "initialize",
      id: 1,
      params: {
        clientInfo: {
          name: "aidn-governance-proof",
          title: "AIDN governance proof",
          version: "1.0.0",
        },
        capabilities: {
          experimentalApi: true,
        },
      },
    })}\n`);
  });
}
