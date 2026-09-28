import fsNative from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// Only execute this pinned canary program through the reviewed sandbox probe.
// Canary paths are explicit, disposable, pre-created and scoped by that plan.
const canonical = value => value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${JSON.stringify(value[key])}`).join(",")}}` : JSON.stringify(value);
const hash = data => createHash("sha256").update(data).digest("hex");
function refused(action) { try { action(); return false; } catch (cause) { return ["EACCES", "EPERM"].includes(cause.code); } }
// The injectable filesystem/output are solely for portable protocol fixtures.
// The CLI path below always uses real Node facilities inside the official sandbox.
export async function runCodexValidationNativeProbe(input, { filesystem = fsNative, output = text => process.stdout.write(text),
  pid = process.pid, environment = process.env } = {}) {
const fs = filesystem;
if (!/^[a-f0-9-]{36}$/u.test(input.challenge ?? "") || !["filesystem", "network", "timeout", "cancel", "callback"].includes(input.case_id)) throw new Error("PROBE_INPUT_INVALID");
const cooperative = input.assurance_profile === "codex-cooperative.v1";
if (input.assurance_profile !== undefined && !cooperative) throw new Error("PROBE_ASSURANCE_INVALID");
const result = { contract_version: cooperative ? "codex-validation-native-observation.v2" : "codex-validation-native-observation.v1", challenge: input.challenge, case_id: input.case_id,
  pid, environment_sha256: hash(Buffer.from(canonical(environment))), observations: {} };
if (input.case_id === "filesystem") {
  for (const file of [input.snapshot_file, input.scratch_file, input.supervisor_file]) if (!path.isAbsolute(file)) throw new Error("PROBE_PATH_INVALID");
  const writes = () => ({ snapshot_sha256: hash(fs.readFileSync(input.snapshot_file)), snapshot_write_denied: refused(() => {
    const file = fs.openSync(input.snapshot_file, "r+"); try { fs.writeSync(file, Buffer.from(input.challenge), 0, 36, 0); } finally { fs.closeSync(file); }
  }), supervisor_write_denied: refused(() => {
    const file = fs.openSync(input.supervisor_file, "r+"); try { fs.writeSync(file, Buffer.from(input.challenge), 0, 36, 0); } finally { fs.closeSync(file); }
  }) });
  if (cooperative) {
    if (!["primary", "companion"].includes(input.role) || !input.sync || Object.keys(input.sync).sort().join("|") !== "companion_ready|companion_stopped|during_done"
      || Object.values(input.sync).some(file => !path.isAbsolute(file) || path.dirname(file) !== path.dirname(input.scratch_file))
      || new Set(Object.values(input.sync)).size !== 3) throw new Error("PROBE_SYNC_INVALID");
    const wait = async file => {
      const deadline = Date.now() + 50000;
      while (Date.now() < deadline) {
        try { const bytes = fs.readFileSync(file); if (bytes.length > 1024) throw new Error("PROBE_SYNC_INVALID");
          if (!bytes.length || bytes.at(-1) !== 10) throw Object.assign(new Error(), { code: "PROBE_SYNC_PENDING" });
          const value = JSON.parse(bytes); if (value.challenge !== input.challenge) throw new Error("PROBE_SYNC_INVALID"); return value;
        } catch (cause) { if (!["ENOENT", "PROBE_SYNC_PENDING"].includes(cause.code)) throw cause; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error("PROBE_SYNC_TIMEOUT");
    };
    const publish = (file, value) => fs.writeFileSync(file, JSON.stringify({ challenge: input.challenge, ...value }) + "\n", { flag: "wx" });
    if (input.role === "companion") {
      publish(input.sync.companion_ready, { companion_pid: pid });
      const during = await wait(input.sync.during_done);
      if (during.companion_pid !== pid || !Number.isSafeInteger(during.primary_pid) || during.primary_pid <= 0) throw new Error("PROBE_SYNC_INVALID");
      result.phase = "companion_completed"; result.observations = { primary_pid: during.primary_pid };
    } else {
      output(JSON.stringify({ ...result, phase: "primary_ready" }) + "\n");
      const ready = await wait(input.sync.companion_ready);
      if (!Number.isSafeInteger(ready.companion_pid) || ready.companion_pid <= 0) throw new Error("PROBE_SYNC_INVALID");
      const during = { ...writes(), companion_pid: ready.companion_pid };
      publish(input.sync.during_done, { primary_pid: pid, companion_pid: ready.companion_pid });
      const stopped = await wait(input.sync.companion_stopped);
      if (stopped.companion_pid !== ready.companion_pid || stopped.termination_state !== "confirmed") throw new Error("PROBE_SYNC_INVALID");
      const after = { ...writes(), companion_pid: ready.companion_pid, companion_stopped: true };
      fs.writeFileSync(input.scratch_file, input.challenge, { flag: "wx" });
      result.phase = "primary_completed"; result.observations = { ...after, during, after,
        scratch_sha256: hash(fs.readFileSync(input.scratch_file)), read_isolation: "not_guaranteed",
        supervisor_read_denied: refused(() => fs.readFileSync(input.supervisor_file)) };
    }
  } else {
    result.observations = writes();
    fs.writeFileSync(input.scratch_file, input.challenge, { flag: "wx" });
    result.observations.scratch_sha256 = hash(fs.readFileSync(input.scratch_file));
    result.observations.supervisor_read_denied = refused(() => fs.readFileSync(input.supervisor_file));
  }
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
output(JSON.stringify(result) + "\n");
if (["timeout", "cancel", "callback"].includes(input.case_id)) setInterval(() => {}, 1000);
return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [raw] = process.argv.slice(2);
  if (!raw || Buffer.byteLength(raw) > 16384) throw new Error("PROBE_INPUT_INVALID");
  await runCodexValidationNativeProbe(JSON.parse(raw));
}
