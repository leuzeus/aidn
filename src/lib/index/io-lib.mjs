import fs from "node:fs";
import path from "node:path";

export function writeUtf8IfChanged(filePath, content, options = {}) {
  const absolute = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });

  if (fs.existsSync(absolute)) {
    const previous = fs.readFileSync(absolute, "utf8");
    if (previous === content) {
      return {
        path: absolute,
        written: false,
        bytes_written: 0,
      };
    }
    if (typeof options.isEquivalent === "function" && options.isEquivalent(previous) === true) {
      return {
        path: absolute,
        written: false,
        bytes_written: 0,
      };
    }
  }

  fs.writeFileSync(absolute, content, "utf8");
  return {
    path: absolute,
    written: true,
    bytes_written: Buffer.byteLength(content, "utf8"),
  };
}

export function writeJsonIfChanged(filePath, payload, options = {}) {
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  return writeUtf8IfChanged(filePath, content, options);
}

function normalizeForCompare(value, ignoredKeys) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForCompare(item, ignoredKeys));
  }
  if (value && typeof value === "object") {
    const out = {};
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      if (ignoredKeys.has(key)) {
        continue;
      }
      out[key] = normalizeForCompare(value[key], ignoredKeys);
    }
    return out;
  }
  return value;
}

export function isJsonEquivalent(previousContent, nextPayload, ignoredKeys = []) {
  try {
    const previous = JSON.parse(previousContent);
    const ignored = new Set(ignoredKeys);
    const left = normalizeForCompare(previous, ignored);
    const right = normalizeForCompare(nextPayload, ignored);
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}
