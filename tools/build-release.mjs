#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { writeFileAtomicSync } from "../src/lib/fs/atomic-write-lib.mjs";
import { buildPackageTarball } from "./lib/release-package-tar.mjs";

const ZIP_STORE = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

function parseArgs(argv) {
  const args = {
    outputRoot: "",
    sourceRef: process.env.GITHUB_SHA || "HEAD",
    requireClean: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--output-root") {
      args.outputRoot = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--source-ref") {
      args.sourceRef = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--require-clean") {
      args.requireClean = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      console.log("Usage: node tools/build-release.mjs [--source-ref <commit>] [--output-root <dir>] [--require-clean] [--json]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.sourceRef) {
    throw new Error("--source-ref must not be empty");
  }
  return args;
}

function git(repoRoot, argv, options = {}) {
  return execFileSync("git", argv, {
    cwd: repoRoot,
    encoding: options.encoding,
    maxBuffer: options.maxBuffer ?? 30 * 1024 * 1024,
    input: options.input,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
}

function resolveCommit(repoRoot, sourceRef) {
  return String(git(repoRoot, ["rev-parse", "--verify", `${sourceRef}^{commit}`], { encoding: "utf8" })).trim();
}

function globRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, "[^/]*")}$`);
}

function packagePathIncluded(relativePath, packageJson) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (["package.json", "README.md", "LICENSE"].includes(normalized)) {
    return true;
  }
  const patterns = Array.isArray(packageJson.files) ? packageJson.files : [];
  let included = false;
  for (const raw of patterns) {
    const negative = raw.startsWith("!");
    const pattern = negative ? raw.slice(1) : raw;
    const matches = pattern.endsWith("/")
      ? normalized.startsWith(pattern)
      : pattern.includes("*")
        ? globRegex(pattern).test(normalized)
        : normalized === pattern || normalized.startsWith(`${pattern}/`);
    if (matches) {
      included = !negative;
    }
  }
  return included;
}

function listPackageFiles(repoRoot, commit, packageJson) {
  // Pin blob identities and sizes at the selected commit before reading payloads.
  const raw = git(repoRoot, ["ls-tree", "-r", "-l", "-z", "--full-tree", commit]);
  const entries = raw.toString("utf8").split("\0").filter(Boolean).map(row => {
    const separator = row.indexOf("\t");
    if (separator < 0) throw new Error("release Git tree entry is malformed");
    const [mode, type, oid, sizeText] = row.slice(0, separator).trim().split(/\s+/u);
    return { relativePath: row.slice(separator + 1), mode, type, oid, size: Number(sizeText) };
  }).filter(entry => packagePathIncluded(entry.relativePath, packageJson))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  if (!entries.length) return [];
  for (const entry of entries) {
    if (entry.type !== "blob" || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(entry.oid)
        || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 30 * 1024 * 1024) {
      throw new Error("release Git package entry is not a supported bounded blob");
    }
  }
  // One binary batch avoids one Git process per file. Its bound is the exact
  // framed size; each payload retains the former per-command 30 MiB limit.
  const maxBuffer = entries.reduce((sum, entry) => sum + entry.oid.length
    + " blob ".length + String(entry.size).length + 2 + entry.size, 0);
  if (!Number.isSafeInteger(maxBuffer)) throw new Error("release Git batch size is invalid");
  const batch = git(repoRoot, ["cat-file", "--batch"], {
    input: entries.map(entry => entry.oid).join("\n") + "\n", maxBuffer,
  });
  let offset = 0;
  const files = entries.map(entry => {
    const end = batch.indexOf(10, offset);
    const expected = entry.oid + " blob " + entry.size;
    if (end < 0 || batch.toString("ascii", offset, end) !== expected) {
      throw new Error("release Git batch blob header does not match the pinned tree");
    }
    const start = end + 1, next = start + entry.size;
    if (next >= batch.length || batch[next] !== 10) throw new Error("release Git batch blob is truncated");
    const content = batch.subarray(start, next);
    offset = next + 1;
    return { relativePath: entry.relativePath, content };
  });
  if (offset !== batch.length) throw new Error("release Git batch contains unexpected trailing data");
  return files;
}

function createCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[index] = crc >>> 0;
  }
  return table;
}

const CRC32_TABLE = createCrc32Table();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = (CRC32_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function localHeader(nameBytes, crc, size) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(ZIP_STORE, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(size, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  return header;
}

function centralHeader(nameBytes, crc, size, offset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(ZIP_STORE, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(size, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt32LE(offset, 42);
  return header;
}

function endRecord(count, size, offset) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(count, 8);
  record.writeUInt16LE(count, 10);
  record.writeUInt32LE(size, 12);
  record.writeUInt32LE(offset, 16);
  return record;
}

function buildZip(files) {
  const local = [];
  const central = [];
  const entries = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.relativePath, "utf8");
    const size = file.content.length;
    const crc = crc32(file.content);
    const header = localHeader(name, crc, size);
    local.push(header, name, file.content);
    entries.push({ name, crc, size, offset });
    offset += header.length + name.length + size;
  }
  let centralSize = 0;
  for (const entry of entries) {
    const header = centralHeader(entry.name, entry.crc, entry.size, entry.offset);
    central.push(header, entry.name);
    centralSize += header.length + entry.name.length;
  }
  return Buffer.concat([...local, ...central, endRecord(entries.length, centralSize, offset)]);
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function assertCleanCommit(repoRoot, commit) {
  const head = resolveCommit(repoRoot, "HEAD");
  if (head !== commit) {
    throw new Error(`source commit ${commit} does not match checked out HEAD ${head}`);
  }
  const status = String(git(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"], { encoding: "utf8" })).trim();
  if (status) {
    throw new Error(`release source checkout is not clean:\n${status}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const commit = resolveCommit(repoRoot, args.sourceRef);
  if (args.requireClean) {
    assertCleanCommit(repoRoot, commit);
  }
  const packageJson = JSON.parse(git(repoRoot, ["show", `${commit}:package.json`], { encoding: "utf8" }));
  const versionText = String(git(repoRoot, ["show", `${commit}:VERSION`], { encoding: "utf8" })).trim();
  if (packageJson.version !== versionText) {
    throw new Error(`package.json version ${packageJson.version} does not match VERSION ${versionText}`);
  }
  const outputRoot = path.resolve(repoRoot, args.outputRoot || "release");
  const zipName = `aidn-workflow-${versionText}.zip`;
  const tarballName = `aidn-workflow-${versionText}.tgz`;
  const zipRelativePath = `release/dist/${zipName}`;
  const tarballRelativePath = `release/dist/${tarballName}`;
  const zipPath = path.join(outputRoot, "dist", zipName);
  const tarballPath = path.join(outputRoot, "dist", tarballName);
  const checksumsPath = path.join(outputRoot, "checksums.txt");
  const manifestPath = path.join(outputRoot, "manifest.json");
  const files = listPackageFiles(repoRoot, commit, packageJson);
  const zip = buildZip(files);
  const tarball = buildPackageTarball(files);
  const zipHash = sha256(zip);
  const tarballHash = sha256(tarball);
  const tree = String(git(repoRoot, ["rev-parse", `${commit}^{tree}`], { encoding: "utf8" })).trim();
  const generatedAt = String(git(repoRoot, ["show", "-s", "--format=%cI", commit], { encoding: "utf8" })).trim();
  const versionBuffer = git(repoRoot, ["show", `${commit}:VERSION`]);
  const packageBuffer = git(repoRoot, ["show", `${commit}:package.json`]);
  const manifest = {
    schema_version: 2,
    package_name: packageJson.name,
    version: versionText,
    git_commit: commit,
    git_tree: tree,
    generated_at: generatedAt,
    source: {
      ref: args.sourceRef,
      github_sha: process.env.GITHUB_SHA || null,
      version_file: "VERSION",
      version_file_sha256: sha256(versionBuffer),
      package_file: "package.json",
      package_file_sha256: sha256(packageBuffer),
      tracked_tree_only: true,
      clean_checkout_required: args.requireClean,
    },
    build: {
      tool: "tools/build-release.mjs",
      deterministic: true,
      package_allowlist: "package.json#files",
      input_files: files.length,
      input_bytes: files.reduce((total, file) => total + file.content.length, 0),
      inputs: files.map((file) => file.relativePath),
    },
    artifacts: [
      { name: zipName, path: zipRelativePath, sha256: zipHash, bytes: zip.length },
      { name: tarballName, path: tarballRelativePath, sha256: tarballHash, bytes: tarball.length },
    ],
  };
  writeFileAtomicSync(zipPath, zip);
  writeFileAtomicSync(tarballPath, tarball);
  writeFileAtomicSync(checksumsPath,
    `${zipHash}  ${zipRelativePath}\n${tarballHash}  ${tarballRelativePath}\n`,
    { encoding: "utf8" });
  writeFileAtomicSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8" });
  const output = {
    ok: true,
    version: versionText,
    source_ref: args.sourceRef,
    git_commit: commit,
    git_tree: tree,
    input_files: files.length,
    zip: zipPath,
    tarball: tarballPath,
    checksums: checksumsPath,
    manifest: manifestPath,
    sha256: zipHash,
    tarball_sha256: tarballHash,
  };
  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`zip: ${path.relative(repoRoot, zipPath)}`);
    console.log(`tarball: ${path.relative(repoRoot, tarballPath)}`);
    console.log(`checksums: ${path.relative(repoRoot, checksumsPath)}`);
    console.log(`manifest: ${path.relative(repoRoot, manifestPath)}`);
    console.log(`source: ${commit} (${files.length} tracked package files)`);
  }
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
