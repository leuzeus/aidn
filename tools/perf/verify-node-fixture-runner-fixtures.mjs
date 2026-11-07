import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import manifest from "../../package/catalogs/agentic-process-fixtures.v1.json" with { type: "json" };
import { runNodeFixtureCases } from "../verify/node-fixture-runner-lib.mjs";
import { verifyWindowsVerificationTree } from "./verification-windows-tree-fixture-lib.mjs";

// Accepted febbb020 argv prefix, including the merge fixture and bounded
// composed stop points added in 81b1783e. Later cases remain explicit below.
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 188))).digest("hex"),
  "c14ad5423a7644ee7a7098b58f1400443d059191329a22b5a3d0066658aad555");
assert.deepEqual(manifest.cases.slice(188), [["tools/perf/verify-node-fixture-runner-fixtures.mjs"],
  ["tools/perf/verify-standard-host-source-fixtures.mjs"], ["tools/perf/verify-workflow-execution-authority-fixtures.mjs"],
  ...["files", "dual", "db-only"].map(mode => ["tools/perf/verify-standard-ordinary-entry-fixtures.mjs", "--mode=" + mode])]);
console.log("PASS accepted 188-case prefix and six exact supplemental cases");

const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "aidn fixture runner "));
const log = path.join(base, "events.jsonl"), script = path.join(base, "child with spaces.mjs");
fs.writeFileSync(script, `import fs from 'node:fs'; fs.appendFileSync(process.argv[2],JSON.stringify(process.argv.slice(3))+'\\n'); process.exitCode=Number(process.argv[3]);\n`);
const first = [script, log, "0", "one two", "literal & no shell", "$(literal)"];
const failing = [script, log, "23"], forbidden = [script, log, "0", "must never start"];
let result = await runNodeFixtureCases([first, failing, forbidden], { cwd: base, stdio: "pipe" });
assert.deepEqual(result, { exit_code: 23, signal: null, completed: 1 });
assert.deepEqual(fs.readFileSync(log, "utf8").trim().split("\n").map(JSON.parse), [first.slice(2), failing.slice(2)]);
console.log("PASS argv/paths with spaces and shell literals survive; failing second child prevents third and preserves exit 23");
fs.writeFileSync(log, "");
result = await runNodeFixtureCases([first, forbidden], { cwd: base, stdio: "pipe" });
assert.deepEqual(result, { exit_code: 0, signal: null, completed: 2 });
assert.deepEqual(fs.readFileSync(log, "utf8").trim().split("\n").map(JSON.parse), [first.slice(2), forbidden.slice(2)]);
console.log("PASS successful children execute in their declared order");
const ready = path.join(base, "ready"), waiting = path.join(base, "waiting.mjs"), parent = path.join(base, "parent.mjs");
fs.writeFileSync(waiting, `import fs from 'node:fs'; fs.writeFileSync(process.argv[2],String(process.pid)); setInterval(()=>{},1000);\n`);
const library = new URL("../verify/node-fixture-runner-lib.mjs", import.meta.url).href;
fs.writeFileSync(parent, `import {runNodeFixtureCases} from ${JSON.stringify(library)}; const result=await runNodeFixtureCases(${JSON.stringify([[waiting, ready], forbidden])},{cwd:${JSON.stringify(base)}}); if(result.signal)process.kill(process.pid,result.signal);else process.exitCode=result.exit_code;\n`);
// AbortSignal exercises the portable forwarding path on Windows, whose OS
// terminate signal cannot invoke a JavaScript SIGTERM listener in a child.
if (process.platform === "win32") {
  const stop = new AbortController();
  const before = fs.readFileSync(log, "utf8");
  const run = runNodeFixtureCases([[waiting, ready], forbidden], { cwd: base, stdio: "pipe", signal: stop.signal });
  setTimeout(() => stop.abort(), 500);
  result = await run;
  assert.equal(result.signal, "SIGTERM"); assert.equal(result.completed, 0); assert.equal(fs.readFileSync(log, "utf8"), before);
} else {
  const child = spawn(process.execPath, [parent], { cwd: base, stdio: "pipe", shell: false, windowsHide: true });
  const terminal = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(ready) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(fs.existsSync(ready)); child.kill("SIGTERM");
  assert.equal((await terminal).signal, "SIGTERM");
}
console.log("PASS stop prevents subsequent launch and propagates the active-child signal");
await verifyWindowsVerificationTree(base);
console.log(JSON.stringify({ status: "PASS", platform: process.platform, native: "NOT_RUN", base }));
