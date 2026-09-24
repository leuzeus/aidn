import { resolveInstallOwnership } from "./install-ownership-policy.mjs";

export function isRetainedInstallSeed(relative) { return ["seed-once", "runtime-state"].includes(resolveInstallOwnership(relative)); }
export function isLocalInstallationTarget(relative) {
  if ([".aidn/config.json", ".aidn/project/workflow.adapter.json", ".gitignore"].includes(relative)) return true;
  if (relative.startsWith(".aidn/runtime/agents/") || relative.startsWith(".github/")) return true;
  if (!relative.startsWith("docs/audit/")) return false;
  if (/^docs\/audit\/(?:cycles\/C\d|sessions\/S\d|baseline\/v)/i.test(relative)) return false;
  return !relative.split("/").some((part) => part === ".." || !part || part.includes(":") || part.includes("\\"));
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function get(data, keys) { let node = data; for (const key of keys) { if (!object(node) || !Object.hasOwn(node, key)) return { exists: false }; node = node[key]; } return { exists: true, value: node }; }
function set(data, keys, state) {
  if (keys.some((key) => ["__proto__", "prototype", "constructor"].includes(key))) throw new Error("UNSAFE_CONFIG_FIELD");
  let node = data; const parents = [];
  for (const key of keys.slice(0, -1)) { if (!object(node[key])) node[key] = {}; parents.push([node, key]); node = node[key]; }
  if (state.exists) node[keys.at(-1)] = structuredClone(state.value); else delete node[keys.at(-1)];
  for (const [parent, key] of parents.reverse()) if (Object.keys(parent[key]).length === 0) delete parent[key];
}
export function configFieldPatch(before, after) {
  const left = {}, right = {};
  function visit(a, b, keys) {
    if (same(a, b)) return;
    if (object(a) && object(b)) { for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) visit(a[key], b[key], [...keys, key]); return; }
    if ((a === undefined || object(a)) && object(b) && Object.keys(b).length) { for (const key of Object.keys(b)) visit(a?.[key], b[key], [...keys, key]); return; }
    const name = JSON.stringify(keys); left[name] = get(before ?? {}, keys); right[name] = get(after ?? {}, keys);
  }
  visit(before ?? {}, after ?? {}, []); return { before: left, after: right };
}
export function restoreConfigFields(text, from, to) {
  const data = text === null ? {} : JSON.parse(text);
  for (const name of Object.keys(from)) if (!same(get(data, JSON.parse(name)), from[name])) throw new Error("CONFIG_FIELD_POSTIMAGE_CHANGED");
  for (const name of Object.keys(to)) set(data, JSON.parse(name), to[name]);
  return `${JSON.stringify(data, null, 2)}\n`;
}
export function restoreAppendLines(text, from, to) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  for (const line of from) if (lines.filter((item) => item === line).length !== 1) throw new Error("APPEND_LINE_POSTIMAGE_CHANGED");
  const result = lines.filter((line) => !from.includes(line));
  for (const line of to) if (!result.includes(line)) result.splice(result.at(-1) === "" ? result.length - 1 : result.length, 0, line);
  return result.join(String(text).includes("\r\n") ? "\r\n" : "\n");
}

export function configFieldStates(data, fields) { return Object.fromEntries(Object.keys(fields).map((name) => [name, get(data, JSON.parse(name))])); }
