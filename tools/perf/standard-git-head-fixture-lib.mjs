import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readStandardGitHead } from "../../src/application/runtime/standard-drift-git.mjs";

export function verifyStandardGitHead() {
  const temporary = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(temporary, "aidn-git-head-"));
  const git = args => execFileSync("git", ["-C", root, "-c", "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null"),
    "-c", "commit.gpgSign=false", ...args], { encoding: "utf8", shell: false, windowsHide: true, timeout: 10000,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  function witness() {
    const rows = [];
    function walk(file) {
      const stat = fs.lstatSync(file), row = { path: path.relative(root, file), dev: stat.dev, ino: stat.ino, mode: stat.mode };
      if (stat.isSymbolicLink()) rows.push({ ...row, link: fs.readlinkSync(file) });
      else if (stat.isDirectory()) { const names = fs.readdirSync(file).sort(); rows.push({ ...row, names }); for (const name of names) walk(path.join(file, name)); }
      else rows.push({ ...row, bytes: stat.size, sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex") });
    }
    walk(root); return rows;
  }
  function observed() {
    const before = witness(), calls = [];
    const actual = readStandardGitHead(args => { calls.push(args); return git(args); });
    assert.deepEqual(actual, { branch: git(["branch", "--show-current"]).trim(), head: git(["rev-parse", "HEAD"]).trim() });
    assert.equal(calls.length, 1); assert.deepEqual(witness(), before);
    return actual;
  }
  try {
    git(["init", "-b", "fixture"]);
    const before = witness(); assert.throws(() => readStandardGitHead(git)); assert.deepEqual(witness(), before);
    git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture first"]);
    const first = observed(); assert.equal(first.branch, "fixture");
    git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture next"]);
    assert.notEqual(observed().head, first.head);
    git(["symbolic-ref", "refs/heads/alias", "refs/heads/fixture"]); git(["symbolic-ref", "HEAD", "refs/heads/alias"]);
    assert.equal(observed().branch, "fixture");
    git(["checkout", "--detach", "HEAD"]); assert.equal(observed().branch, "");
    git(["switch", "-c", "fixture-next"]); assert.equal(observed().branch, "fixture-next");
    for (const value of ["", "a".repeat(40), "a".repeat(40) + "\nrefs/tags/foreign\n", "a".repeat(40) + "\nHEAD\nextra\n"])
      assert.throws(() => readStandardGitHead(() => value), { code: "STANDARD_DRIFT_GIT_OBSERVATION_FAILED" });
    return { checks: 7, fresh_per_invocation: true, unchanged_read_witnesses: true, native_started: false };
  } finally {
    const resolved = fs.realpathSync(root);
    if (!resolved.startsWith(temporary + path.sep)) throw Error("FIXTURE_CLEANUP_SCOPE_INVALID");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
