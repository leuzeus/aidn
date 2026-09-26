#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// This resolves already provisioned binaries. Tests create their own cluster;
// neither a project connection string nor an existing PostgreSQL service is used.
export function resolvePostgresTestRuntime({
  env = process.env,
  platform = process.platform,
  run = (command, args) => execFileSync(command, args, {
    encoding: "utf8", timeout: 10000, windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16384,
  }),
  verifyBinary = (file) => {
    if (!fs.statSync(file).isFile()) throw new Error("not a file");
    fs.accessSync(file, fs.constants.X_OK);
  },
} = {}) {
  let binDir;
  try {
    binDir = env.PG_BIN_DIR ?? String(run("pg_config", ["--bindir"])).trim();
  } catch {
    throw new Error("POSTGRES_TEST_RUNTIME_UNAVAILABLE: set PG_BIN_DIR to an existing PostgreSQL bin directory");
  }
  if (typeof binDir !== "string" || !path.isAbsolute(binDir) || /[\r\n\0]/u.test(binDir)) {
    throw new Error("POSTGRES_TEST_RUNTIME_INVALID: PG_BIN_DIR must be an absolute directory");
  }
  for (const name of ["initdb", "pg_ctl", "postgres"]) {
    try {
      const binary = path.join(binDir, `${name}${platform === "win32" ? ".exe" : ""}`);
      verifyBinary(binary);
      const version = String(run(binary, ["--version"])).trim();
      if (!version.startsWith(`${name} (PostgreSQL) `)) throw new Error("invalid version");
    } catch {
      throw new Error(`POSTGRES_TEST_RUNTIME_UNAVAILABLE: ${name} cannot execute`);
    }
  }
  return { bin_dir: path.normalize(binDir) };
}

export async function preparePostgresTestRuntime({
  env = process.env,
  importDriver = () => import("pg"),
  resolve = () => resolvePostgresTestRuntime({ env }),
  appendEnvironment = (file, value) => fs.appendFileSync(file, value, "utf8"),
} = {}) {
  try {
    const driver = await importDriver();
    if (typeof (driver.Client ?? driver.default?.Client) !== "function") throw new Error("missing Client");
  } catch {
    throw new Error("POSTGRES_TEST_DRIVER_UNAVAILABLE: the locked optional pg driver is required by this gate");
  }
  if (!env.GITHUB_ENV || !path.isAbsolute(env.GITHUB_ENV)) {
    throw new Error("POSTGRES_TEST_ENVIRONMENT_UNAVAILABLE: an absolute GITHUB_ENV file is required");
  }
  const result = resolve();
  appendEnvironment(env.GITHUB_ENV, `PG_BIN_DIR=${result.bin_dir}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await preparePostgresTestRuntime();
    console.log(JSON.stringify({ ok: true, status: "PASS", ...result }));
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
