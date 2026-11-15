import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readPackageTarball } from "../lib/release-package-tar.mjs";

// Run the copied actual CLI against Git objects, without checking unusual names
// out on the host filesystem. No source checkout or published ref is changed.
export function qualifyReleaseGitBlobs({ sourceRoot, root, runBuild }) {
  fs.mkdirSync(root);
  const git = (args, input) => execFileSync("git", args, {
    cwd: root, input, encoding: "utf8", windowsHide: true,
    timeout: 30000, maxBuffer: 30 * 1024 * 1024,
  }).trim();
  git(["init", "--initial-branch=fixture"]);
  for (const name of ["tools/build-release.mjs", "tools/lib/release-package-tar.mjs", "src/lib/fs/atomic-write-lib.mjs"]) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(sourceRoot, name), target);
  }
  const packageJson = Buffer.from(JSON.stringify({ name: "aidn-release-blob-fixture", version: "1.0.0", files: ["VERSION", "*.bin"] }) + "\n");
  const files = [
    { name: "package.json", content: packageJson },
    { name: "VERSION", content: Buffer.from("1.0.0\n") },
    { name: "empty.bin", content: Buffer.alloc(0) },
    { name: "binary.bin", content: Buffer.from([0, 255, 10, 128, 13, 0, 10]) },
    { name: "copy.bin", content: Buffer.from([0, 255, 10, 128, 13, 0, 10]) },
    { name: "name with space.bin", content: Buffer.from("space\r\n") },
    { name: "name\ttab.bin", content: Buffer.from("tab\n") },
    { name: "name\nline.bin", content: Buffer.from("line\n") },
    { name: "accent-\u00e9.bin", content: Buffer.from("unicode\n") },
  ];
  const rows = files.map(file => {
    const oid = git(["hash-object", "-w", "--stdin"], file.content);
    return Buffer.from("100644 blob " + oid + "\t" + file.name + "\0");
  });
  const tree = git(["mktree", "-z"], Buffer.concat(rows));
  const commit = git(["-c", "user.name=aidn-release-fixture", "-c", "user.email=release-fixture@example.invalid",
    "commit-tree", tree, "-m", "binary release fixture"]);
  fs.writeFileSync(path.join(root, "empty.bin"), "foreign checkout bytes\n");
  fs.writeFileSync(path.join(root, "untracked.bin"), "not part of the selected commit\n");
  const output = runBuild(path.join(root, "output"), { buildRoot: root, sourceRef: commit, requireClean: false });
  const manifest = JSON.parse(fs.readFileSync(output.manifest));
  const tar = readPackageTarball(fs.readFileSync(output.tarball));
  const expected = files.map(file => file.name).sort((a, b) => a.localeCompare(b));
  assert.equal(output.git_commit, commit);
  assert.equal(output.git_tree, tree);
  assert.deepEqual(manifest.build.inputs, expected);
  assert.deepEqual([...tar.keys()].sort((a, b) => a.localeCompare(b)), expected);
  assert.equal(manifest.build.input_bytes, files.reduce((sum, file) => sum + file.content.length, 0));
  for (const file of files) assert.deepEqual(tar.get(file.name), file.content, file.name);
  assert.equal(fs.readFileSync(path.join(root, "empty.bin"), "utf8"), "foreign checkout bytes\n");
  assert.equal(git(["status", "--porcelain"]).includes("untracked.bin"), true);
  return { status: "PASS", scope: "actual-build-cli-selected-git-objects", files: files.length,
    binary_empty_duplicate_blob_and_unusual_names: true, foreign_checkout_preserved_and_excluded: true };
}
