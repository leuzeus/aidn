import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

// A private cluster, never an installed project's connection. No service or
// machine configuration is changed. The generated credential is never emitted.
export async function withEphemeralPostgres(fn, { binDir = process.env.PG_BIN_DIR } = {}) {
  if (!binDir || !path.isAbsolute(binDir)) throw new Error("EPHEMERAL_POSTGRES_BIN_DIR_REQUIRED");
  const suffix = process.platform === "win32" ? ".exe" : "";
  const binary = name => path.join(binDir, name + suffix);
  for (const name of ["initdb", "pg_ctl", "postgres"]) {
    if (!fs.statSync(binary(name), { throwIfNoEntry: false })?.isFile()) throw new Error("EPHEMERAL_POSTGRES_BINARY_MISSING");
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-execution-pg-"));
  const owner = randomUUID();
  fs.writeFileSync(path.join(root, "owner.json"), JSON.stringify({ owner }), { flag: "wx" });
  const data = path.join(root, "data"), passwordFile = path.join(root, "password");
  const password = randomBytes(32).toString("hex");
  fs.writeFileSync(passwordFile, password + "\n", { flag: "wx", mode: 0o600 });
  const run = (name, args) => {
    const result = spawnSync(binary(name), args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
    if (result.status !== 0) {
      // initdb/pg_ctl diagnostics contain no supplied connection string; retain
      // a bounded tail with the generated credential redacted defensively.
      const error = new Error(`EPHEMERAL_POSTGRES_${name.toUpperCase()}_FAILED`);
      error.detail = String(result.stderr || result.stdout || result.error?.code || "").replaceAll(password, "[redacted]").slice(-2048);
      throw error;
    }
    return result.stdout.trim();
  };
  let started = false;
  try {
    const version = run("postgres", ["--version"]);
    run("initdb", ["-D", data, "-U", "aidn_test", "--pwfile", passwordFile, "--auth=scram-sha-256", "--encoding=UTF8", "--no-locale"]);
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer(); server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { const assigned = server.address().port; server.close(error => error ? reject(error) : resolve(assigned)); });
    });
    // Only the numeric allocated port and fixed loopback address enter -o.
    run("pg_ctl", ["-D", data, "-l", path.join(root, "server.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "-t", "30", "start"]);
    started = true;
    const connectionString = `postgresql://aidn_test:${password}@127.0.0.1:${port}/postgres`;
    return await fn({ connectionString, version, root });
  } finally {
    // A partially started server must also be stopped; never delete its data
    // while postmaster.pid exists or if shutdown cannot be established.
    if (started || fs.existsSync(path.join(data, "postmaster.pid"))) run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "-t", "30", "stop"]);
    if (fs.existsSync(path.join(data, "postmaster.pid"))) throw new Error("EPHEMERAL_POSTGRES_STOP_UNCONFIRMED");
    const resolved = fs.realpathSync(root), temp = fs.realpathSync(os.tmpdir());
    if (path.dirname(resolved) !== temp || !path.basename(resolved).startsWith("aidn-execution-pg-")
      || JSON.parse(fs.readFileSync(path.join(resolved, "owner.json"), "utf8")).owner !== owner) throw new Error("EPHEMERAL_POSTGRES_CLEANUP_REFUSED");
    fs.rmSync(resolved, { recursive: true });
    if (fs.existsSync(resolved)) throw new Error("EPHEMERAL_POSTGRES_CLEANUP_FAILED");
  }
}
