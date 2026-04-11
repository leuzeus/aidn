#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runJson(scriptRelative, args) {
  const result = spawnSync(process.execPath, [path.resolve(process.cwd(), scriptRelative), ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    payload: (() => {
      try {
        return JSON.parse(String(result.stdout ?? "{}"));
      } catch {
        return null;
      }
    })(),
  };
}

function writeFile(target, relativePath, content) {
  const absolute = path.join(target, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, "utf8");
}

async function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-runtime-source-normalization-"));
    const targetRoot = path.join(tempRoot, "repo");
    fs.mkdirSync(targetRoot, { recursive: true });

    writeFile(
      targetRoot,
      "docs/audit/cycles/C004-spike-root-structure-investigation/status.md",
      "# Cycle Status - C004-spike\ncycle_id: C004\nbranch_name: C004-spike-root-structure-investigation\nnext_entry_point: docs/audit/cycles/C004-spike-root-structure-investigation/status.md\nHYP-C004-001\n",
    );
    writeFile(
      targetRoot,
      "docs/audit/cycles/C005-structural-root-simplification-lot1/brief.md",
      "# Brief - C005 structural root simplification\nLe spike `C004-spike-root-structure-investigation` precede ce lot.\nHYP-C005-L1-001\n",
    );
    writeFile(
      targetRoot,
      "docs/audit/cycles/C032-corrective-component-review-hardening/audit-spec.md",
      "# Audit Spec - C032\nREQ-C032-001\nTEST-C032-001\nbranch_name: C032-corrective-component-review-hardening\n",
    );
    writeFile(
      targetRoot,
      "docs/audit/sessions/S031.md",
      "Cycle ID: C005-structural-root-simplification-lot1\nBranch: C005-structural-root-simplification-lot1\nObjective: Executer les lots 1-2 du cycle C005 pour simplifier la racine.\n",
    );

    const sqliteFile = path.join(targetRoot, ".aidn", "runtime", "index", "workflow-index.sqlite");
    fs.mkdirSync(path.dirname(sqliteFile), { recursive: true });
    fs.writeFileSync(sqliteFile, Buffer.from([0x53, 0x51, 0x4c, 0x00, 0x03, 0x04]));

    const result = runJson("bin/aidn.mjs", [
      "runtime",
      "persistence-source-normalize",
      "--target",
      targetRoot,
      "--rename",
      "C004-spike-root-structure-investigation=C020-spike-root-structure-investigation",
      "--rename",
      "C005-structural-root-simplification-lot1=C021-structural-root-simplification-lot1",
      "--rename",
      "C032-corrective-component-review-hardening=C034-corrective-component-review-hardening",
      "--json",
    ]);
    assert(result.status === 0, "runtime source normalization should succeed");
    assert(result.payload?.files_updated === 4, "expected four text files to be rewritten");
    assert(result.payload?.directories_renamed === 3, "expected three cycle directories to be renamed");
    assert(Array.isArray(result.payload?.skipped_binary_files) && result.payload.skipped_binary_files.length === 0, "expected no binary files to be scanned outside docs/audit");

    const c020Status = fs.readFileSync(path.join(targetRoot, "docs", "audit", "cycles", "C020-spike-root-structure-investigation", "status.md"), "utf8");
    assert(c020Status.includes("cycle_id: C020"), "cycle-local status should rewrite the cycle id");
    assert(c020Status.includes("branch_name: C020-spike-root-structure-investigation"), "cycle-local status should rewrite the branch slug");
    assert(c020Status.includes("HYP-C020-001"), "cycle-local content should rewrite hypothesis identifiers");

    const c021Brief = fs.readFileSync(path.join(targetRoot, "docs", "audit", "cycles", "C021-structural-root-simplification-lot1", "brief.md"), "utf8");
    assert(c021Brief.includes("# Brief - C021 structural root simplification"), "cycle-local brief should rewrite the short display label");
    assert(c021Brief.includes("`C020-spike-root-structure-investigation`"), "cross-cycle slug references should be rewritten");
    assert(c021Brief.includes("HYP-C021-L1-001"), "cycle-local prefixed identifiers should be rewritten");

    const c034AuditSpec = fs.readFileSync(path.join(targetRoot, "docs", "audit", "cycles", "C034-corrective-component-review-hardening", "audit-spec.md"), "utf8");
    assert(c034AuditSpec.includes("# Audit Spec - C034"), "cycle-local heading should rewrite the logical cycle id");
    assert(c034AuditSpec.includes("REQ-C034-001"), "cycle-local REQ identifiers should be rewritten");
    assert(c034AuditSpec.includes("TEST-C034-001"), "cycle-local TEST identifiers should be rewritten");

    const session = fs.readFileSync(path.join(targetRoot, "docs", "audit", "sessions", "S031.md"), "utf8");
    assert(session.includes("Cycle ID: C021-structural-root-simplification-lot1"), "session structured references should rewrite full cycle slugs");
    assert(session.includes("Branch: C021-structural-root-simplification-lot1"), "session structured branch references should rewrite full cycle slugs");
    assert(session.includes("Objective: Executer les lots 1-2 du cycle C005"), "free-form prose should remain unchanged when it does not contain the full slug");

    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      checks: {
        rewrites_cycle_local_ids: true,
        rewrites_cross_cycle_slugs: true,
        rewrites_structured_session_refs: true,
        preserves_unmapped_free_prose: true,
        scopes_to_docs_audit_only: true,
      },
      pass: true,
    }, null, 2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      const cleanup = removePathWithRetry(tempRoot);
      if (!cleanup.ok) {
        throw cleanup.error;
      }
    }
  }
}

await main();
