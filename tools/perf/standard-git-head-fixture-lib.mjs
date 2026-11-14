import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fixturePhysicalStat } from "./fixture-physical-stat-lib.mjs";
import { diagnosticFixtureWitness } from "./standard-terminal-diagnostic-fixture-lib.mjs";
import { readStandardGitHead } from "../../src/application/runtime/standard-drift-git.mjs";

export function verifyStandardGitHead() {
  const temporary = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(temporary, "aidn-git-head-"));
  const git = args => execFileSync("git", ["-C", root, "-c", "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null"),
    "-c", "commit.gpgSign=false", ...args], { encoding: "utf8", shell: false, windowsHide: true, timeout: 10000,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  function witness() {
    const rows = [];
    function walk(file) {
      const stat = fs.lstatSync(file, { bigint: true }), observed = fixturePhysicalStat(stat);
      const row = { path: path.relative(root, file), dev: observed.dev, ino: observed.ino, mode: observed.mode };
      if (stat.isSymbolicLink()) rows.push({ ...row, link: fs.readlinkSync(file) });
      else if (stat.isDirectory()) { const names = fs.readdirSync(file).sort(); rows.push({ ...row, names }); for (const name of names) walk(path.join(file, name)); }
      else rows.push({ ...row, bytes: observed.bytes, sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex") });
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
    const wide = { dev: 9007199254740993n, ino: 11821949023755611n, mode: 0o100644n, size: 17n };
    assert.deepEqual(fixturePhysicalStat(wide), { dev: "9007199254740993", ino: "11821949023755611", mode: 0o100644, bytes: 17 });
    assert.notEqual(fixturePhysicalStat({ ...wide, ino: wide.ino + 1n }).ino, fixturePhysicalStat(wide).ino);
    for (const stat of [{ ...wide, ino: Number(wide.ino) }, { ...wide, size: -1n }, { ...wide, mode: 0x100000000n },
      { ...wide, size: BigInt(Number.MAX_SAFE_INTEGER) + 1n }]) assert.throws(() => fixturePhysicalStat(stat));
    assert.throws(() => fixturePhysicalStat(wide, { maxBytes: 16 }));
    assert.throws(() => fixturePhysicalStat(wide, { maxBytes: 1.5 }));
    const configuration = { target_root: root, control_root: root, product_root: root, review_root: root, native: { home: root } };
    fs.writeFileSync(path.join(root, "identity.txt"), "exact identity\n");
    const actualStat = fs.lstatSync(path.join(root, "identity.txt"), { bigint: true });
    const physical = diagnosticFixtureWitness(configuration), actualFile = physical.find(row => row.path === path.join(root, "identity.txt"));
    assert.equal(actualFile.ino, actualStat.ino.toString()); assert.equal(actualFile.dev, actualStat.dev.toString());
    assert.equal(actualFile.bytes, 15); assert.deepEqual(JSON.parse(JSON.stringify(physical)), physical);
    assert.deepEqual(diagnosticFixtureWitness(configuration), physical);
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
    return { checks: 17, exact_bigint_identity: true, fresh_per_invocation: true, unchanged_read_witnesses: true, native_started: false };
  } finally {
    const resolved = fs.realpathSync(root);
    if (!resolved.startsWith(temporary + path.sep)) throw Error("FIXTURE_CLEANUP_SCOPE_INVALID");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
