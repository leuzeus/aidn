import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createTrackedFixtureFilter, initGitRepo, removePathWithRetry } from "./test-git-fixture-lib.mjs";

export function verifyTrackedFixtureCopy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-tracked-fixture-"));
  const repo = path.join(root, "source"), corpus = path.join(repo, "corpus"), target = path.join(root, "copy");
  const put = (name, content) => { const file = path.join(repo, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
  try {
    put(".gitignore", "corpus/.aidn/runtime/\n");
    put("corpus/docs/audit/CURRENT-STATE.md", "mode: unknown\n");
    initGitRepo(repo, { sourceBranch: "main" });
    put("corpus/.aidn/runtime/agents/tracked.mjs", "export const fixture = true;\n");
    execFileSync("git", ["-C", repo, "add", "-f", "corpus/.aidn/runtime/agents/tracked.mjs"], { stdio: "pipe" });
    execFileSync("git", ["-C", repo, "commit", "-m", "test: retain tracked hidden fixture asset"], { stdio: "pipe" });
    put("corpus/.aidn/runtime/index/workflow-index.sqlite", "ignored stale canonical store");
    put("corpus/.aidn/runtime/context/hydrated-context.json", "ignored stale observation");
    put("corpus/private-local.txt", "untracked local material");
    const filter = createTrackedFixtureFilter(corpus, repo);
    fs.cpSync(corpus, target, { recursive: true, filter });
    assert.equal(fs.readFileSync(path.join(target, "docs/audit/CURRENT-STATE.md"), "utf8"), "mode: unknown\n");
    assert(fs.existsSync(path.join(target, ".aidn/runtime/agents/tracked.mjs")));
    for (const name of [".aidn/runtime/index/workflow-index.sqlite", ".aidn/runtime/context/hydrated-context.json", "private-local.txt"]) {
      assert(!fs.existsSync(path.join(target, name)), name + " must not contaminate a new fixture");
      assert(fs.existsSync(path.join(corpus, name)), "source must remain untouched");
    }
    assert.equal(fs.readFileSync(path.join(corpus, ".aidn/runtime/index/workflow-index.sqlite"), "utf8"), "ignored stale canonical store");
    return { pass: true, tracked_bootstrap_preserved: true, tracked_hidden_asset_preserved: true, ignored_runtime_excluded: true, source_unchanged: true };
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("aidn-tracked-fixture-"));
    const cleanup = removePathWithRetry(root); assert(cleanup.ok && !fs.existsSync(root), "tracked fixture cleanup");
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(verifyTrackedFixtureCopy()));
