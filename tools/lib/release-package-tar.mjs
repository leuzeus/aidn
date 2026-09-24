import zlib from "node:zlib";

const BLOCK_BYTES = 512;

function writeString(header, value, start, length) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length || bytes.includes(0)) {
    throw new Error(`tar field is too long or contains NUL: ${value}`);
  }
  bytes.copy(header, start);
}

function writeOctal(header, value, start, length) {
  const digits = value.toString(8).padStart(length - 2, "0");
  if (digits.length > length - 2) throw new Error(`tar numeric field overflow: ${value}`);
  Buffer.from(`${digits}\0 `, "ascii").copy(header, start);
}

function tarName(relativePath) {
  const full = `package/${relativePath}`;
  if (Buffer.byteLength(full) <= 100) return { name: full, prefix: "" };
  for (let index = full.lastIndexOf("/"); index > 0; index = full.lastIndexOf("/", index - 1)) {
    const prefix = full.slice(0, index);
    const name = full.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
  }
  throw new Error(`package path cannot be represented in ustar: ${relativePath}`);
}

export function buildPackageTarball(files) {
  const chunks = [];
  for (const file of files) {
    const { name, prefix } = tarName(file.relativePath);
    const header = Buffer.alloc(BLOCK_BYTES);
    writeString(header, name, 0, 100);
    writeOctal(header, 0o644, 100, 8);
    writeOctal(header, 0, 108, 8);
    writeOctal(header, 0, 116, 8);
    writeOctal(header, file.content.length, 124, 12);
    writeOctal(header, 0, 136, 12);
    header.fill(0x20, 148, 156);
    writeString(header, "0", 156, 1);
    writeString(header, "ustar", 257, 6);
    writeString(header, "00", 263, 2);
    writeString(header, prefix, 345, 155);
    writeOctal(header, header.reduce((sum, byte) => sum + byte, 0), 148, 8);
    chunks.push(header, file.content);
    const padding = (BLOCK_BYTES - (file.content.length % BLOCK_BYTES)) % BLOCK_BYTES;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(BLOCK_BYTES * 2));
  return zlib.gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 });
}

function readString(header, start, length) {
  const bytes = header.subarray(start, start + length);
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end < 0 ? bytes.length : end).toString("utf8");
}

export function readPackageTarball(gzip) {
  const tar = zlib.gunzipSync(gzip, { maxOutputLength: 256 * 1024 * 1024 });
  const entries = new Map();
  let offset = 0;
  while (offset + BLOCK_BYTES <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK_BYTES);
    if (header.every((byte) => byte === 0)) break;
    const expectedChecksum = Number.parseInt(readString(header, 148, 8).trim(), 8);
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    const actualChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
    if (expectedChecksum !== actualChecksum || readString(header, 257, 5) !== "ustar") {
      throw new Error("invalid package tar header");
    }
    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const fullPath = prefix ? `${prefix}/${name}` : name;
    const type = readString(header, 156, 1);
    const size = Number.parseInt(readString(header, 124, 12).trim(), 8);
    if (type !== "0" || !fullPath.startsWith("package/") || !Number.isSafeInteger(size)
      || size < 0 || fullPath.includes("\\") || fullPath.split("/").includes("..")) {
      throw new Error(`invalid package tar entry: ${fullPath}`);
    }
    const relativePath = fullPath.slice("package/".length);
    if (!relativePath || entries.has(relativePath)) throw new Error(`duplicate package tar entry: ${fullPath}`);
    const dataStart = offset + BLOCK_BYTES;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new Error(`truncated package tar entry: ${fullPath}`);
    entries.set(relativePath, tar.subarray(dataStart, dataEnd));
    offset = dataStart + Math.ceil(size / BLOCK_BYTES) * BLOCK_BYTES;
  }
  if (offset + BLOCK_BYTES * 2 !== tar.length) throw new Error("invalid package tar terminator");
  return entries;
}
