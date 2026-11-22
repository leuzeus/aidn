import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

// This file is copied into the frozen snapshot and runs as the supervised
// validator. All writes name disposable scratch files. AccessCheck reads NTFS
// descriptors with an identification copy of this process's primary token.
const input = JSON.parse(process.argv[2]);
const check = value => { if (!value) throw new Error("ACCESS_PROBE_INPUT_INVALID"); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
check(/^[a-f0-9-]{36}$/u.test(input.challenge) && input.assurance_profile === "codex-cooperative-access.v1"
  && input.read_isolation === "not_guaranteed" && input.network_isolation === "not_guaranteed");
const emit = (phase, observations) => process.stdout.write(JSON.stringify({
  contract_version: "codex-validation-access-observation.v1", case_id: input.case_id, challenge: input.challenge,
  assurance_profile: input.assurance_profile, read_isolation: input.read_isolation, network_isolation: input.network_isolation,
  pid: process.pid, environment_sha256: hash(JSON.stringify(Object.fromEntries(Object.entries(process.env).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)))),
  phase, observations,
}) + "\n");

if (input.case_id === "filesystem_access") {
  const paths = { snapshot: input.snapshot_file, supervisor: input.supervisor_file, scratch: input.scratch_file };
  check(Object.values(paths).every(path.isAbsolute) && new Set(Object.values(paths).map(file => file.toLowerCase())).size === 3);
  const scratchDir = path.dirname(paths.scratch);
  check(scratchDir === process.env.TEMP && scratchDir === process.env.TMP);
  for (const name of ["companion_ready", "during_done", "companion_stopped"]) {
    check(input.sync[name] === path.join(scratchDir, `probe-${input.challenge}-${name}.json`));
  }
  const publish = (name, value) => fs.writeFileSync(input.sync[name], JSON.stringify({ challenge: input.challenge, ...value }), { flag: "wx" });
  async function wait(name) {
    const deadline = performance.now() + 45000;
    while (performance.now() < deadline) {
      try {
        const data = JSON.parse(fs.readFileSync(input.sync[name], "utf8"));
        check(data.challenge === input.challenge);
        return data;
      } catch (cause) { if (cause.code !== "ENOENT" && !(cause instanceof SyntaxError)) throw cause; }
      await delay(40);
    }
    throw new Error("ACCESS_PROBE_SYNC_TIMEOUT");
  }
  function inspect(companionPid) {
    const observer = input.access_observer;
    check(hash(fs.readFileSync(observer.executable)) === observer.sha256);
    const sample = JSON.parse(execFileSync(observer.executable, [String(process.pid), paths.snapshot, paths.supervisor, paths.scratch],
      { encoding: "utf8", timeout: 6000, maxBuffer: 65536, windowsHide: true, shell: false }));
    check(sample.subject_pid === process.pid);
    return { ...sample, observer_sha256: observer.sha256, companion_pid: companionPid };
  }
  if (input.role === "companion") {
    publish("companion_ready", { companion_pid: process.pid });
    const during = await wait("during_done");
    check(during.companion_pid === process.pid && Number.isSafeInteger(during.primary_pid) && during.primary_pid > 0);
    emit("companion_completed", { primary_pid: during.primary_pid });
  } else {
    check(input.role === "primary");
    fs.writeFileSync(paths.scratch, input.challenge, { flag: "wx" });
    const scratchHash = hash(fs.readFileSync(paths.scratch)), snapshotHash = hash(fs.readFileSync(paths.snapshot));
    check(scratchHash === hash(input.challenge));
    emit("primary_ready", {});
    const ready = await wait("companion_ready");
    check(Number.isSafeInteger(ready.companion_pid) && ready.companion_pid > 0 && ready.companion_pid !== process.pid);
    const during = inspect(ready.companion_pid);
    publish("during_done", { primary_pid: process.pid, companion_pid: ready.companion_pid });
    const stopped = await wait("companion_stopped");
    check(stopped.termination_state === "confirmed" && stopped.companion_pid === ready.companion_pid);
    const after = { ...inspect(ready.companion_pid), companion_stopped: true };
    emit("primary_completed", { paths, during, after, scratch_sha256: scratchHash, snapshot_sha256: snapshotHash });
  }
} else {
  check(["timeout", "cancel", "callback"].includes(input.case_id));
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  emit("descendant_started", { descendant_pid: child.pid });
}
