import { spawn } from "node:child_process";

// argv is passed directly to Node, including paths/arguments containing spaces.
// No shell expansion, npm recursion, output buffering or timeout replacement.
export async function runNodeFixtureCases(cases, { cwd, env = process.env, stdio = "inherit", signal } = {}) {
  if (!Array.isArray(cases) || !cases.length || cases.some(args => !Array.isArray(args) || !args.length
    || args.some(arg => typeof arg !== "string" || !arg || arg.includes("\0")))) throw Error("NODE_FIXTURE_CASES_INVALID");
  let active = null, requestedSignal = null;
  const stop = name => { requestedSignal ??= name; if (active) active.kill(name); };
  const interrupt = () => stop("SIGINT"), terminate = () => stop("SIGTERM"), abort = () => stop("SIGTERM");
  process.on("SIGINT", interrupt); process.on("SIGTERM", terminate);
  signal?.addEventListener("abort", abort, { once: true });
  let completed = 0;
  try {
    if (signal?.aborted) abort();
    for (const args of cases) {
      if (requestedSignal) return { exit_code: null, signal: requestedSignal, completed };
      const result = await new Promise(resolve => {
        const child = spawn(process.execPath, args, { cwd, env, stdio, shell: false, windowsHide: true });
        active = child;
        let error = null;
        child.once("error", cause => { error = cause; });
        child.once("close", (code, childSignal) => {
          active = null;
          if (error) process.stderr.write(`Node fixture launch failed: ${error.code ?? "UNKNOWN"}\n`);
          resolve({ exit_code: error ? 1 : code, signal: childSignal });
        });
        if (requestedSignal) child.kill(requestedSignal);
      });
      if (result.signal || result.exit_code !== 0 || requestedSignal) return { ...result, signal: requestedSignal ?? result.signal, completed };
      completed++;
    }
    return { exit_code: 0, signal: null, completed };
  } finally {
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", terminate);
    signal?.removeEventListener("abort", abort);
  }
}
