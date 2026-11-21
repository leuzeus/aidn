import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { readWorkflowProjectAuthority, readWorkflowProjectExecutionAuthority } from "../../src/application/runtime/workflow-instance-composition.mjs";
import { agenticProcessPersistence } from "../../src/application/runtime/agentic-process-persistence.mjs";

const targetRoot = createFreshStandardWorkflowFixture("files"), receipt = path.join(targetRoot, ".aidn/install/receipt.json");
const observe = () => readWorkflowProjectExecutionAuthority({ targetRoot });
const separate = { project: readWorkflowProjectAuthority({ targetRoot }), persistence: agenticProcessPersistence({ targetRoot }) };
const original = fs.readFileSync;
let receiptReads = 0, checks = 0;
function check(name, fn) { fn(); checks++; console.log("PASS " + name); }
try {
  fs.readFileSync = function(file, ...args) { if (file === receipt) receiptReads++; return Reflect.apply(original, this, [file, ...args]); };
  check("combined observation preserves both authority descriptions", () => assert.deepEqual(observe(), separate));
  check("one complete activation receipt is read per combined observation", () => assert.equal(receiptReads, 1));
  check("another observation performs a fresh activation read", () => { observe(); assert.equal(receiptReads, 2); });
} finally { fs.readFileSync = original; }
const assets = JSON.parse(fs.readFileSync(receipt, "utf8")).assets;
const skill = path.join(targetRoot, ...Object.keys(assets).find(name => name.endsWith("/SKILL.md")).split("/"));
const before = fs.readFileSync(skill), stat = fs.statSync(skill);
try {
  // Same length and restored mtime must not make an authority observation cache
  // accept different installed bytes. Every asset is revalidated each call.
  const changed = Buffer.from(before); changed[changed.length - 1] ^= 1;
  fs.writeFileSync(skill, changed); fs.utimesSync(skill, stat.atime, stat.mtime);
  check("changed installed bytes refuse with no cross-call activation cache", () => assert.throws(observe));
} finally { fs.writeFileSync(skill, before); }
check("restored fixture assets permit a newly observed authority", () => assert.deepEqual(observe(), separate));
const configFile = path.join(targetRoot, ".aidn/config.json"), config = JSON.parse(fs.readFileSync(configFile, "utf8"));
config.runtime.stateMode = "dual"; fs.writeFileSync(configFile, JSON.stringify(config));
check("state-mode changes remain freshly observable", () => assert.equal(observe().project.stateMode, "dual"));
const body = fs.readFileSync(receipt); fs.renameSync(receipt, receipt + ".held");
try { check("missing activation receipt refuses the next observation", () => assert.throws(observe)); }
finally { fs.writeFileSync(receipt, body); }
console.log(JSON.stringify({ status: "PASS", checks, target: targetRoot, scope: "fresh-source-install-fixture-activation", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
