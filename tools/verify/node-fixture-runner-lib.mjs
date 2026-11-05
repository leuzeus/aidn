import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { verificationEvidenceDirectory, verificationWindowsController, runWindowsVerificationCommand } from "./owned-verification-process-lib.mjs";

// argv is passed directly to Node, including paths/arguments containing spaces.
// No shell expansion, npm recursion, output buffering or timeout replacement.
export async function runNodeFixtureCases(cases, { cwd, env = process.env, stdio = "inherit", signal,
  evidenceRoot = env.AIDN_FIXTURE_EVIDENCE_ROOT, deadlineAt = Number(env.AIDN_VERIFICATION_DEADLINE_AT) || Date.now() + 900000 } = {}) {
  if (!Array.isArray(cases) || !cases.length || cases.some(args => !Array.isArray(args) || !args.length
    || args.some(arg => typeof arg !== "string" || !arg || arg.includes("\0")))) throw Error("NODE_FIXTURE_CASES_INVALID");
  if (!Number.isSafeInteger(deadlineAt) || deadlineAt <= 0) throw Error("NODE_FIXTURE_DEADLINE_INVALID");
  const evidence = verificationEvidenceDirectory(cwd, evidenceRoot);
  process.stderr.write(`Node fixture evidence: ${evidence}\n`);
  fs.writeFileSync(path.join(evidence, "cases.json"), JSON.stringify({ contract_version: "node-fixture-observation.v1",
    pid: process.pid, cwd, started_at: new Date().toISOString(), deadline_at: new Date(deadlineAt).toISOString(), cases }, null, 2), { flag: "wx" });
  let active = null, requestedSignal = null;
  const cancellation = new AbortController();
  const stop = name => { requestedSignal ??= name; cancellation.abort(); if (active) active.kill(name); };
  const interrupt = () => stop("SIGINT"), terminate = () => stop("SIGTERM"), abort = () => stop("SIGTERM");
  process.on("SIGINT", interrupt); process.on("SIGTERM", terminate);
  signal?.addEventListener("abort", abort, { once: true });
  let completed = 0;
  const windows = process.platform === "win32" ? verificationWindowsController(evidence, env) : null;
  const timer = setTimeout(() => stop("SIGTERM"), Math.max(1, deadlineAt - Date.now()));
  const finish = result => { fs.writeFileSync(path.join(evidence, "summary.json"), JSON.stringify({ ...result,
    ended_at: new Date().toISOString(), required: cases.length }), { flag: "wx" }); return result; };
  try {
    if (signal?.aborted) abort();
    for (const args of cases) {
      if (Date.now() >= deadlineAt) stop("SIGTERM");
      if (requestedSignal) return finish({ exit_code: null, signal: requestedSignal, completed });
      const index = completed + 1, folder = path.join(evidence, String(index).padStart(3, "0")); fs.mkdirSync(folder);
      const started = new Date().toISOString();
      fs.appendFileSync(path.join(evidence, "events.jsonl"), JSON.stringify({ index, args, started_at: started }) + "\n");
      let result;
      if (windows) {
        const descriptors = ["stdout", "stderr"].map(name => fs.openSync(path.join(folder, name + ".log"), "wx"));
        let observed;
        try { observed = await runWindowsVerificationCommand({ command: process.execPath, args, cwd, env, deadlineAt,
          maxOutputBytes: 30 * 1024 * 1024, controller: windows.controller, evidenceDir: folder, signal: cancellation.signal,
          onEvent(event) { if (["stdout", "stderr"].includes(event.type)) {
            fs.writeSync(descriptors[event.type === "stdout" ? 0 : 1], event.bytes);
            if (stdio === "inherit") process[event.type].write(event.bytes);
          } } });
        } finally { for (const fd of descriptors) fs.closeSync(fd); }
        result = { exit_code: observed.outcome === "completed" && observed.termination_state === "confirmed" ? 0 : observed.exit_code || 1,
          signal: observed.outcome === "cancelled" || observed.outcome === "timed_out" ? "SIGTERM" : null };
      } else result = await new Promise(resolve => {
        const child = spawn(process.execPath, args, { cwd, env, stdio, shell: false, windowsHide: true });
        active = child;
        fs.writeFileSync(path.join(folder, "started.json"), JSON.stringify({ index, args, pid: child.pid ?? null, started_at: started }), { flag: "wx" });
        let error = null;
        child.once("error", cause => { error = cause; });
        child.once("close", (code, childSignal) => {
          active = null;
          if (error) process.stderr.write(`Node fixture launch failed: ${error.code ?? "UNKNOWN"}\n`);
          resolve({ exit_code: error ? 1 : code, signal: childSignal });
        });
        if (requestedSignal) child.kill(requestedSignal);
      });
      fs.appendFileSync(path.join(evidence, "events.jsonl"), JSON.stringify({ index, args, ended_at: new Date().toISOString(), result }) + "\n");
      if (!windows) fs.writeFileSync(path.join(folder, "result.json"), JSON.stringify({ index, args, result,
        ended_at: new Date().toISOString(), cleanup: { state: "direct_child_closed", descendants: "NOT_VERIFIED" } }), { flag: "wx" });
      if (result.signal || result.exit_code !== 0 || requestedSignal) return finish({ ...result, signal: requestedSignal ?? result.signal, completed });
      completed++;
    }
    return finish({ exit_code: 0, signal: null, completed });
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", terminate);
    signal?.removeEventListener("abort", abort);
  }
}
