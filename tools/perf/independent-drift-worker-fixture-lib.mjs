import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createWorkerHumanVerificationSource } from "../../src/application/runtime/native-human-verification-port.mjs";

// A fixture controller, not OS confinement or a genuine Native adapter. The
// enclosing qualification Job owns both processes. The child reconstructs the
// production worker authority and executor; its H callbacks reach the live parent.
export async function runIndependentDriftWorker({ request, sent, f, options, onEvent }) {
  const capability = structuredClone(sent.allocation.human_verification);
  f.assertWorkerChannelClosed = async ({ source, question }) => {
    await assert.rejects(createWorkerHumanVerificationSource(capability).verify({ source, question }));
  };
  const child = fork(fileURLToPath(new URL("independent-drift-worker-fixture.mjs", import.meta.url)), [], {
    env: request.env, cwd: request.cwd, stdio: ["pipe", "pipe", "pipe", "ipc"], execArgv: [], windowsHide: true,
  });
  let stdout = "", stderr = "", metrics = null, pending = Promise.resolve(), failure = null;
  // The phase Job is the independent OS deadline. This child ceiling is fixed
  // before spawn and clipped to the original owned-run remaining duration.
  const childTimeoutMs = Math.min(120000, request.maxDurationMs);
  assert.ok(Number.isSafeInteger(childTimeoutMs) && childTimeoutMs > 0);
  const stop = setTimeout(() => child.kill(), childTimeoutMs);
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  child.stdout.on("data", bytes => { stdout += bytes.toString("utf8"); if (Buffer.byteLength(stdout) > 1048576) child.kill(); });
  child.stderr.on("data", bytes => { stderr += bytes.toString("utf8"); if (Buffer.byteLength(stderr) > 16384) child.kill(); });
  child.on("message", message => {
    pending = pending.then(async () => {
      if (message?.kind === "fixture_observed") {
        await options.afterWorkerObservation?.(f);
        child.send({ kind: "fixture_continue" });
      } else if (message?.kind === "fixture_metrics") metrics = message;
      else throw Error("INDEPENDENT_FIXTURE_MESSAGE_INVALID");
    }).catch(error => { failure = error; child.kill(); });
  });
  // Allocation credentials travel only in the same private stdin input as the
  // production entry. Fixture IPC carries stage markers/counters, no authority.
  child.stdin.end(JSON.stringify(sent));
  let exit;
  try { exit = await closed; await pending; } finally { clearTimeout(stop); }
  if (failure) throw failure;
  assert.equal(exit.signal, null, "Independent fixture must finish without forced termination");
  assert.equal(exit.code, 0, stderr);
  assert.ok(metrics, "Independent fixture must retain its counters and exact child identity");
  assert.equal(metrics.pid, child.pid); assert.notEqual(metrics.pid, process.pid);
  assert.equal(metrics.parent_pid, process.pid);
  assert.equal(metrics.sessions.every(row => row.closed && row.confirmedClosures === 1 && row.closeCalls >= 1), true);
  f.independentWorker = { ...metrics, exit, stderr, stdout, child_timeout_ms: childTimeoutMs };
  await onEvent({ type: "stdout", bytes: Buffer.from(stdout) });
  return { outcome: "completed", termination_state: "confirmed", termination_proof: { active_processes: 0 } };
}
