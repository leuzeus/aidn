import fs from "node:fs";
import path from "node:path";

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function stripComments(line) {
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted && ch === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if (ch === '"' && !escaped) {
      quoted = !quoted;
    }
    if (ch === "#" && !quoted) {
      if (i === 0 || /\s/.test(line[i - 1])) {
        return line.slice(0, i);
      }
    }
    escaped = false;
  }
  return line;
}

function parseScalar(rawValue) {
  const value = rawValue.trim();
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "null") {
    return null;
  }
  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }
  if (value === "[]") {
    return [];
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return inner.split(",").map((item) => parseScalar(item.trim()));
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseYaml(content) {
  const root = {};
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const stack = [{ indent: -1, kind: "object", container: root }];

  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    const rawLine = stripComments(lines[lineNo]).replace(/\s+$/, "");
    if (!rawLine.trim()) {
      continue;
    }

    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trimStart();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    let frame = stack[stack.length - 1];
    if (frame.kind === "pending") {
      if (line.startsWith("- ")) {
        frame.kind = "array";
        frame.container = [];
      } else {
        frame.kind = "object";
        frame.container = {};
      }
      frame.parent[frame.key] = frame.container;
    }

    if (line.startsWith("- ")) {
      if (frame.kind !== "array") {
        throw new Error(`Invalid YAML list placement at line ${lineNo + 1}`);
      }
      const itemRaw = line.slice(2).trim();
      if (!itemRaw) {
        const obj = {};
        frame.container.push(obj);
        stack.push({ indent, kind: "object", container: obj });
        continue;
      }
      if (itemRaw.includes(":")) {
        const sep = itemRaw.indexOf(":");
        const key = itemRaw.slice(0, sep).trim();
        const valueRaw = itemRaw.slice(sep + 1).trim();
        const obj = {};
        frame.container.push(obj);
        if (valueRaw) {
          obj[key] = parseScalar(valueRaw);
        } else {
          obj[key] = {};
        }
        stack.push({ indent, kind: "object", container: obj });
        if (!valueRaw) {
          stack.push({
            indent: indent + 1,
            kind: "pending",
            container: null,
            parent: obj,
            key,
          });
        }
        continue;
      }
      frame.container.push(parseScalar(itemRaw));
      continue;
    }

    if (frame.kind !== "object") {
      throw new Error(`Invalid YAML key placement at line ${lineNo + 1}`);
    }

    const sep = line.indexOf(":");
    if (sep < 0) {
      throw new Error(`Invalid YAML syntax at line ${lineNo + 1}`);
    }

    const key = line.slice(0, sep).trim();
    const valueRaw = line.slice(sep + 1).trim();
    if (valueRaw) {
      frame.container[key] = parseScalar(valueRaw);
      continue;
    }

    stack.push({
      indent,
      kind: "pending",
      container: null,
      parent: frame.container,
      key,
    });
  }

  return root;
}

export function readYamlFile(filePath) {
  const absolutePath = path.resolve(filePath);
  return parseYaml(readUtf8(absolutePath));
}
