import { createHash } from "node:crypto";

// Internal shadow data only. Reject accessors before reading values; no coercion,
// toJSON, ambient inputs or timestamps participate in a compilation fingerprint.
export function checkShadowJson(value) {
  const seen = new Set();
  let count = 0;
  function visit(item, depth) {
    if (++count > 50000 || depth > 24) return "JSON_LIMIT";
    if (item === null || typeof item === "boolean") return null;
    if (typeof item === "string") return item.length > 16384 ? "JSON_LIMIT" : null;
    if (typeof item === "number") return Number.isSafeInteger(item) ? null : "INVALID_JSON_NUMBER";
    if (typeof item !== "object" || seen.has(item)) return "INVALID_JSON";
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) return "INVALID_JSON";
    if (Object.getOwnPropertySymbols(item).length) return "INVALID_JSON";
    const properties = Object.getOwnPropertyDescriptors(item);
    if (Array.isArray(item) && Object.keys(properties).length !== item.length + 1) return "INVALID_JSON";
    seen.add(item);
    for (const [name, property] of Object.entries(properties)) {
      if (Array.isArray(item) && name === "length") continue;
      if (!("value" in property) || !property.enumerable || name === "__proto__"
        || (Array.isArray(item) && !/^(0|[1-9][0-9]*)$/.test(name))) return "INVALID_JSON";
      const problem = visit(property.value, depth + 1);
      if (problem) return problem;
    }
    seen.delete(item);
    return null;
  }
  return visit(value, 0);
}

export function canonicalShadowJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalShadowJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalShadowJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export const shadowHash = value => createHash("sha256").update(canonicalShadowJson(value), "utf8").digest("hex");
export const normalizeShadowJson = value => JSON.parse(canonicalShadowJson(value));
export function freezeShadow(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freezeShadow); Object.freeze(value); }
  return value;
}
