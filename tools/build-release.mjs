#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ZIP_STORE = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

function normalizeRelative(filePath) {
  return filePath.split(path.sep).join("/");
}

function isExcluded(relativePath) {
  const normalized = normalizeRelative(relativePath);
  return (
    normalized === ".git" ||
    normalized.startsWith(".git/") ||
    normalized === ".idea" ||
    normalized.startsWith(".idea/") ||
    normalized === "release/dist" ||
    normalized.startsWith("release/dist/") ||
    normalized === "node_modules" ||
    normalized.startsWith("node_modules/")
  );
}

function listFiles(rootDir) {
  const files = [];

  function walk(currentDir, relativeDir) {
    if (relativeDir && isExcluded(relativeDir)) {
      return;
    }

    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      if (isExcluded(relativePath)) {
        continue;
      }
      if (entry.isDirectory()) {
        walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        files.push({
          absolutePath,
          relativePath: normalizeRelative(relativePath),
        });
      }
    }
  }

  walk(rootDir, "");
  return files;
}

function createCrc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[i] = crc >>> 0;
  }
  return table;
}

const CRC32_TABLE = createCrc32Table();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    const index = (crc ^ buffer[i]) & 0xff;
    crc = (CRC32_TABLE[index] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeLocalFileHeader(nameBytes, crc, size) {
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
  header.writeUInt16LE(0, 28);
  return header;
}

function makeCentralDirectoryHeader(nameBytes, crc, size, offset) {
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
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

function makeEndOfCentralDirectory(entryCount, centralSize, centralOffset) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(entryCount, 8);
  record.writeUInt16LE(entryCount, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

function buildZip(files, outputPath) {
  const localChunks = [];
  const centralChunks = [];
  const centralEntries = [];
  let offset = 0;

  for (const file of files) {
    const content = fs.readFileSync(file.absolutePath);
    const nameBytes = Buffer.from(file.relativePath, "utf8");
    const size = content.length;
    const crc = crc32(content);
    const localHeader = makeLocalFileHeader(nameBytes, crc, size);

    localChunks.push(localHeader, nameBytes, content);
    centralEntries.push({ nameBytes, crc, size, offset });
    offset += localHeader.length + nameBytes.length + size;
  }

  let centralSize = 0;
  for (const entry of centralEntries) {
    const header = makeCentralDirectoryHeader(
      entry.nameBytes,
      entry.crc,
      entry.size,
      entry.offset,
    );
    centralChunks.push(header, entry.nameBytes);
    centralSize += header.length + entry.nameBytes.length;
  }

  const eocd = makeEndOfCentralDirectory(centralEntries.length, centralSize, offset);
  const output = Buffer.concat([...localChunks, ...centralChunks, eocd]);
  fs.writeFileSync(outputPath, output);
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const version = fs.readFileSync(path.join(repoRoot, "VERSION"), "utf8").trim();
  const distDir = path.join(repoRoot, "release", "dist");
  const zipName = `aidn-workflow-${version}.zip`;
  const zipPath = path.join(distDir, zipName);
  const checksumsPath = path.join(repoRoot, "release", "checksums.txt");

  fs.mkdirSync(distDir, { recursive: true });
  const files = listFiles(repoRoot);
  buildZip(files, zipPath);

  const hash = sha256File(zipPath);
  const checksumLine = `${hash}  release/dist/${zipName}\n`;
  fs.writeFileSync(checksumsPath, checksumLine, "utf8");

  console.log(`zip: ${path.relative(repoRoot, zipPath)}`);
  console.log(`checksums: ${path.relative(repoRoot, checksumsPath)}`);
}

main();
