import fs from "node:fs";
import { noOperationReliability } from "../../core/workflow/operation-reliability.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import descriptor from "../../../package/catalogs/standard.workflow-package.json" with { type: "json" };

const retryableObservation = Object.freeze({ idempotent: true, wait_deadline: true });
// These two installed operations read local state and can complete with an
// authenticated no-effect refusal. Each provider declares capabilities explicitly.
export function standardOperationReliability(binding) {
  return ["context_reload", "session_entry_admit"].includes(binding.id) && binding.revision === 1 &&
    binding.executor_kind === "deterministic" && binding.effect_class === "read-only" ? retryableObservation : noOperationReliability;
}

let publishedPins;
export function installedStandardOperationReliability(binding) {
  const capabilities = standardOperationReliability(binding);
  if (capabilities === noOperationReliability) return capabilities;
  if (!publishedPins) {
    const url = new URL("../../../" + descriptor.catalog, import.meta.url);
    const { bindings } = JSON.parse(fs.readFileSync(url, "utf8"));
    publishedPins = new Set(bindings.map(row => shadowHash(row.binding)));
  }
  return publishedPins.has(shadowHash(binding)) ? capabilities : noOperationReliability;
}
