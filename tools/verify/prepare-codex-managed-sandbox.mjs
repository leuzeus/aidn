import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildManagedSandboxPreparationPlan } from "../../src/core/agents/codex-managed-sandbox-contracts.mjs";

import { assessManagedSandboxOperationAdequacy } from "../../src/core/agents/codex-managed-sandbox-operation-policy.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
function readDocument(file) {
  if (!path.isAbsolute(file) || path.normalize(file) !== file || /[\x00-\x1f\x7f]/u.test(file)) fail("MANAGED_PREVIEW_PATH_INVALID");
  if (process.platform === "win32" && (!/^[a-z]:\\/iu.test(file) || file.slice(3).split("\\").some(part =>
    !part || /[:<>"|?*]/u.test(part) || /[. ]$/u.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)))) fail("MANAGED_PREVIEW_PATH_INVALID");
  for (let cursor = file;;) {
    if (fs.lstatSync(cursor).isSymbolicLink()) fail("MANAGED_PREVIEW_PATH_ALIAS");
    const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  const same = (left, right) => process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
  if (!same(fs.realpathSync(file), file)) fail("MANAGED_PREVIEW_PATH_ALIAS");
  const before = fs.lstatSync(file), limit = 8 * 1024 * 1024;
  if (!before.isFile() || before.nlink !== 1 || before.size > limit) fail("MANAGED_PREVIEW_FILE_INVALID");
  const handle = fs.openSync(file, "r");
  try {
    const opened = fs.fstatSync(handle);
    if (opened.dev !== before.dev || opened.ino !== before.ino) fail("MANAGED_PREVIEW_FILE_CHANGED");
    const chunks = []; let bytes = 0;
    for (;;) {
      const block = Buffer.alloc(Math.min(65536, limit - bytes + 1));
      const count = fs.readSync(handle, block, 0, block.length, null); if (!count) break;
      bytes += count; if (bytes > limit) fail("MANAGED_PREVIEW_FILE_INVALID"); chunks.push(block.subarray(0, count));
    }
    const after = fs.fstatSync(handle), current = fs.lstatSync(file);
    if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
      || current.dev !== before.dev || current.ino !== before.ino || current.isSymbolicLink()) fail("MANAGED_PREVIEW_FILE_CHANGED");
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes))); } catch { fail("MANAGED_PREVIEW_JSON_INVALID"); }
  } finally { fs.closeSync(handle); }
}

// Internal review tool. There is deliberately no launch, write, setup or approval
// switch: a preparation document cannot authorize native Windows changes.
export function prepareManagedSandboxPreview(argv) {
  const envelope = { contract_version: "codex-managed-sandbox-preview.v1", effect_class: "read-only", written: false,
    native_execution: "NOT_EXECUTED", execution_available: false, plan: null, errors: [] };
  try {
    if (argv.includes("--help") || argv.includes("-h")) return { ...envelope, status: "HELP",
      usage: "node tools/verify/prepare-codex-managed-sandbox.mjs --manifest <absolute-json> --inventory <absolute-json> [--operation <absolute-json> --at <ISO-time> [--coverage <absolute-json>]] [--json]",
      note: "Read-only preparation. Does not collect host state, grant consent, configure or launch a sandbox." };
    const args = {}, seen = new Set();
    for (let index = 0; index < argv.length; index++) {
      const flag = argv[index];
      if (!["--manifest", "--inventory", "--operation", "--coverage", "--at", "--json"].includes(flag) || seen.has(flag)) fail("MANAGED_PREVIEW_ARGUMENT_INVALID");
      seen.add(flag); if (flag === "--json") continue;
      const value = argv[++index]; if (!value || value.startsWith("--")) fail("MANAGED_PREVIEW_ARGUMENT_INVALID");
      args[flag.slice(2)] = value;
    }
    if (!args.manifest || !args.inventory) fail("MANAGED_PREVIEW_INPUT_REQUIRED");
    if (Boolean(args.operation) !== Boolean(args.at) || args.coverage && !args.operation) fail("MANAGED_PREVIEW_OPERATION_INPUT_REQUIRED");
    const manifest = readDocument(args.manifest), observed = readDocument(args.inventory);
    const inventory = observed.contract_version === "codex-managed-sandbox-inventory.v1" ? observed : observed.inventory;
    const plan = buildManagedSandboxPreparationPlan({ manifest, inventory });
    if (args.operation) {
      const operation_assessment = assessManagedSandboxOperationAdequacy({ manifest, inventory,
        operation: readDocument(args.operation), observation: args.coverage ? readDocument(args.coverage) : null, at: args.at });
      return { ...envelope, contract_version: "codex-managed-sandbox-operation-preview.v1",
        status: operation_assessment.status, plan, operation_assessment };
    }
    return { ...envelope, status: plan.status, plan };
  } catch (error) {
    const code = /^[A-Z][A-Z0-9_]{1,100}$/u.test(error.code ?? "") ? error.code : "MANAGED_PREVIEW_INPUT_INVALID";
    return { ...envelope, status: "PREPARATION_BLOCKED", errors: [{ code }] };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = prepareManagedSandboxPreview(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (["PREPARATION_BLOCKED", "INVALID", "REVIEWABLE_WITH_GAPS"].includes(report.status)) process.exitCode = 1;
}
