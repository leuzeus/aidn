import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import childProcess from "node:child_process";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import dgram from "node:dgram";
import dns from "node:dns";
import workerThreads from "node:worker_threads";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Fixture reads and the test harness process precede the guarded interval.
// Only these source modules and schemas may be read while importing. After
// import even source reads are forbidden: discovery and validation must not
// consult configuration, Git, persisted state or files. Intercepted attempts
// remain failures even if production code catches the exception.
const fixture = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agent-execution/contracts/complete-chain.json", import.meta.url), "utf8"));
const effects = [];
const readDescriptors = new Map();
let phase = "import";
function fileKey(value) {
  if (value instanceof URL) value = fileURLToPath(value);
  if (Buffer.isBuffer(value)) value = value.toString("utf8");
  if (typeof value !== "string") return null;
  const absolute = resolve(value);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}
const importReads = new Set([
  "src/core/agents/agent-execution-contracts.mjs",
  "src/core/contracts/json-schema-validator.mjs",
  "src/core/ports/agent-task-executor-port.mjs",
  "src/application/runtime/agent-task-executor-registry-service.mjs",
  ...["descriptor", "availability", "plan", "run", "task", "attempt", "delegation", "request", "event", "result", "acceptance"].map((kind) => `src/core/contracts/agent-execution/${kind}.v1.schema.json`),
].map((path) => fileKey(new URL(`../../${path}`, import.meta.url))));
function deny(name) {
  return () => {
    effects.push(name);
    throw new Error(`Forbidden effect during pure contract probe: ${name}`);
  };
}
function prohibit(object, names, prefix) {
  for (const name of names) {
    if (typeof object[name] === "function") object[name] = deny(`${prefix}.${name}`);
  }
}
function requireAllowedRead(name, path) {
  const descriptor = typeof path === "number" ? path : path?.fd;
  const key = Number.isInteger(descriptor) ? readDescriptors.get(descriptor) : fileKey(path);
  if (phase !== "import" || !importReads.has(key)) deny(`${name}:read`)();
}
function guardRead(original, name) {
  return function (path, ...args) {
    requireAllowedRead(name, path);
    return original.call(this, path, ...args);
  };
}
const reads = ["access", "accessSync", "exists", "existsSync", "readFile", "readFileSync", "read", "readSync", "readv", "readvSync", "fstat", "fstatSync", "createReadStream", "stat", "statSync", "lstat", "lstatSync", "statfs", "statfsSync", "realpath", "realpathSync", "readlink", "readlinkSync", "readdir", "readdirSync", "opendir", "opendirSync", "openAsBlob"];
for (const [owner, prefix] of [[fs, "fs"], [fsPromises, "fs.promises"]]) {
  for (const method of reads) {
    if (typeof owner[method] !== "function") continue;
    const original = owner[method];
    owner[method] = guardRead(original, `${prefix}.${method}`);
    if (typeof original.native === "function") owner[method].native = guardRead(original.native, `${prefix}.${method}.native`);
  }
  // Watching and globbing are unrelated to this explicit ESM dependency set.
  prohibit(owner, ["glob", "globSync", "watch", "watchFile"], prefix);
}
const mutations = ["appendFile", "appendFileSync", "chmod", "chmodSync", "chown", "chownSync", "copyFile", "copyFileSync", "cp", "cpSync", "createWriteStream", "fchmod", "fchmodSync", "fchown", "fchownSync", "fdatasync", "fdatasyncSync", "fsync", "fsyncSync", "ftruncate", "ftruncateSync", "futimes", "futimesSync", "lchmod", "lchmodSync", "lchown", "lchownSync", "link", "linkSync", "lutimes", "lutimesSync", "mkdir", "mkdirSync", "mkdtemp", "mkdtempSync", "mkdtempDisposableSync", "rename", "renameSync", "rm", "rmSync", "rmdir", "rmdirSync", "symlink", "symlinkSync", "truncate", "truncateSync", "unlink", "unlinkSync", "utimes", "utimesSync", "write", "writeSync", "writeFile", "writeFileSync", "writev", "writevSync"];
prohibit(fs, mutations, "fs");
prohibit(fsPromises, mutations, "fs.promises");
const writeMask = fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND;
for (const [owner, method] of [[fs, "open"], [fs, "openSync"], [fsPromises, "open"]]) {
  const original = owner[method];
  owner[method] = function (path, flags, ...args) {
    if ((typeof flags === "string" && flags !== "r" && flags !== "rs") || (typeof flags === "number" && (flags & writeMask))) {
      return deny(`fs.${method}:write`)();
    }
    requireAllowedRead(`fs.${method}`, path);
    if (owner === fsPromises) {
      return original.call(this, path, flags, ...args).then((handle) => {
        readDescriptors.set(handle.fd, fileKey(path));
        for (const read of ["read", "readFile", "readLines", "readv", "stat", "createReadStream"]) {
          if (typeof handle[read] !== "function") continue;
          const originalRead = handle[read];
          handle[read] = function (...readArgs) {
            requireAllowedRead(`FileHandle.${read}`, this.fd);
            return originalRead.apply(this, readArgs);
          };
        }
        const close = handle.close.bind(handle);
        handle.close = function (...closeArgs) {
          readDescriptors.delete(this.fd);
          return close(...closeArgs);
        };
        return handle;
      });
    }
    if (method === "openSync") {
      const fd = original.call(this, path, flags, ...args);
      readDescriptors.set(fd, fileKey(path));
      return fd;
    }
    const callback = args.pop();
    return original.call(this, path, flags, ...args, (error, fd) => {
      if (!error) readDescriptors.set(fd, fileKey(path));
      callback(error, fd);
    });
  };
}
for (const method of ["close", "closeSync"]) {
  const original = fs[method];
  fs[method] = function (fd, ...args) {
    readDescriptors.delete(fd);
    return original.call(this, fd, ...args);
  };
}
prohibit(childProcess, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"], "child_process");
prohibit(workerThreads, ["Worker"], "worker_threads");
prohibit(net, ["connect", "createConnection", "createServer"], "net");
prohibit(net.Socket.prototype, ["connect"], "net.Socket");
prohibit(net.Server.prototype, ["listen"], "net.Server");
prohibit(http, ["request", "get", "createServer"], "http");
prohibit(https, ["request", "get", "createServer"], "https");
prohibit(tls, ["connect", "createServer"], "tls");
prohibit(dgram, ["createSocket"], "dgram");
prohibit(dns, ["lookup", "resolve", "resolve4", "resolve6"], "dns");
prohibit(dns.promises, ["lookup", "resolve", "resolve4", "resolve6"], "dns.promises");
globalThis.fetch = deny("fetch");
process.chdir = deny("process.chdir");
syncBuiltinESMExports();

// Prove that forbidden reads fail before consulting the filesystem, then reset
// only this deliberate harness effect before the tested import interval starts.
assert.throws(() => fs.readFileSync(new URL("../../.aidn/forbidden-purity-probe.json", import.meta.url), "utf8"), /Forbidden effect.*read/);
assert.deepEqual(effects, ["fs.readFileSync:read"]);
effects.length = 0;

const contracts = await import("../../src/core/agents/agent-execution-contracts.mjs");
const { createAgentTaskExecutorRegistry } = await import("../../src/application/runtime/agent-task-executor-registry-service.mjs");
const { assertAgentTaskExecutor } = await import("../../src/core/ports/agent-task-executor-port.mjs");
phase = "validation";
assert.deepEqual(createAgentTaskExecutorRegistry().discover(), []);
let probes = 0;
let tasks = 0;
const candidate = {
  getDescriptor() { return fixture.descriptor; },
  async checkAvailability() { probes += 1; return fixture.availability; },
  async runTask() { tasks += 1; throw new Error("Unexpected task launch"); },
};
assert.equal(assertAgentTaskExecutor(candidate), candidate);
assert.deepEqual(createAgentTaskExecutorRegistry([candidate]).discover(), [fixture.descriptor]);
const before = JSON.stringify(fixture);
for (const kind of ["descriptor", "availability", "plan", "run", "task", "attempt", "delegation", "request", "event", "result", "acceptance"]) {
  assert.equal(contracts.validateAgentExecutionContract(kind, fixture[kind]).ok, true, kind);
}
assert.equal(contracts.validateAgentExecutionBindings(fixture).ok, true);
assert.equal(contracts.normalizeAgentExecutionPlan(fixture.plan).plan_sha256, fixture.expected.plan_sha256);
assert.equal(JSON.stringify(fixture), before);
assert.equal(probes, 0);
assert.equal(tasks, 0);
assert.deepEqual(effects, []);
console.log(JSON.stringify({ status: "PASS", effects, probes, tasks }));
