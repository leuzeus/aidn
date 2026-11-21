import { types } from "node:util";

const { isProxy } = types;
// Eligibility only, after complete validation. No value, table or authority is
// retained. Reject proxies before their traps and inspect data descriptors only.
export function isPlainProcessReplayData(value) {
  if (value === null || typeof value !== "object") return true;
  if (isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value) ? prototype !== Array.prototype : ![Object.prototype, null].includes(prototype)) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(row =>
    Object.hasOwn(row, "value") && isPlainProcessReplayData(row.value));
}
