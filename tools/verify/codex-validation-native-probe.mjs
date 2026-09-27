import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

// Only execute this pinned canary program through the reviewed sandbox probe.
// Canary paths are explicit, disposable, pre-created and scoped by that plan.
const canonical = value => value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${JSON.stringify(value[key])}`).join(",")}}` : JSON.stringify(value);
const hash = data => createHash("sha256").update(data).digest("hex");
function refused(action) { try { action(); return false; } catch (cause) { return ["EACCES", "EPERM"].includes(cause.code); } }
const [raw] = process.argv.slice(2);
if (!raw || Buffer.byteLength(raw) > 16384) throw new Error("PROBE_INPUT_INVALID");
const input = JSON.parse(raw);
if (!/^[a-f0-9-]{36}$/u.test(input.challenge ?? "") || !["filesystem", "network", "timeout", "cancel", "callback"].includes(input.case_id)) throw new Error("PROBE_INPUT_INVALID");
const result = { contract_version: "codex-validation-native-observation.v1", challenge: input.challenge, case_id: input.case_id,
  pid: process.pid, environment_sha256: hash(Buffer.from(canonical(process.env))), observations: {} };
if (input.case_id === "filesystem") {
  for (const file of [input.snapshot_file, input.scratch_file, input.supervisor_file]) if (!path.isAbsolute(file)) throw new Error("PROBE_PATH_INVALID");
  result.observations.snapshot_sha256 = hash(fs.readFileSync(input.snapshot_file));
  result.observations.snapshot_write_denied = refused(() => {
    const file = fs.openSync(input.snapshot_file, "r+"); try { fs.writeSync(file, Buffer.from(input.challenge), 0, 36, 0); } finally { fs.closeSync(file); }
  });
  fs.writeFileSync(input.scratch_file, input.challenge, { flag: "wx" });
  result.observations.scratch_sha256 = hash(fs.readFileSync(input.scratch_file));
  result.observations.supervisor_read_denied = refused(() => fs.readFileSync(input.supervisor_file));
  result.observations.supervisor_write_denied = refused(() => {
    const file = fs.openSync(input.supervisor_file, "r+"); try { fs.writeSync(file, Buffer.from(input.challenge), 0, 36, 0); } finally { fs.closeSync(file); }
  });
} else if (input.case_id === "network") {
  if (!Number.isSafeInteger(input.port) || input.port < 1024 || input.port > 65535) throw new Error("PROBE_NETWORK_INVALID");
  result.observations.network = await new Promise(resolve => {
    const socket = net.createConnection({ host: "127.0.0.1", port: input.port }); let done = false;
    const finish = status => { if (done) return; done = true; socket.destroy(); resolve(status); };
    socket.setTimeout(1500, () => finish("timed_out")); socket.once("error", error => finish(["EACCES", "EPERM"].includes(error.code) ? "denied" : "unproven"));
    socket.once("connect", () => { socket.end(input.challenge); finish("connected"); });
  });
} else {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore", windowsHide: true, env: { ...process.env } });
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  result.observations.descendant_pid = child.pid;
}
process.stdout.write(JSON.stringify(result) + "\n");
if (["timeout", "cancel", "callback"].includes(input.case_id)) setInterval(() => {}, 1000);
