import { shadowHash } from "./shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
export const processModels = model => [model, ...(model.call_targets ?? []).map(row => row.model)];
export const processModelIdentity = model => ({ model_id: model.model_id, revision: model.revision, model_sha256: shadowHash(model) });
export function resolveProcessCallTarget(root, reference) {
  const target = root.call_targets?.find(row => row.model_id === reference?.model_id && row.revision === reference?.revision);
  if (!target) fail("PROCESS_CALL_TARGET_MISSING");
  if (target.model_sha256 !== reference.model_sha256 || shadowHash(target.model) !== reference.model_sha256)
    fail("PROCESS_CALL_TARGET_CHANGED");
  return target.model;
}
// Frame identity is emitted by the common reducer from authenticated embedded
// bytes. It is never a path, package lookup, download or executable module.
export function processFrameModel(root, frame) {
  if (!frame) fail("PROCESS_OCCURRENCE_UNKNOWN");
  if (frame.model_sha256 === undefined) return root;
  const model = processModels(root).find(row => shadowHash(row) === frame.model_sha256);
  if (!model) fail("PROCESS_CALL_TARGET_CHANGED");
  return model;
}
export const processFrameNode = (root, frame) => processFrameModel(root, frame).nodes.find(row => row.id === frame.node_id);
export function assertProcessCallValues(values, types) {
  if (!values || typeof values !== "object" || Array.isArray(values)
    || Object.keys(values).length !== Object.keys(types).length || Object.keys(types).some(key => !Object.hasOwn(values, key)))
    fail("PROCESS_CALL_VALUES_INVALID");
  for (const [key, type] of Object.entries(types)) {
    const value = values[key];
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : Number.isSafeInteger(value) ? "integer" : typeof value;
    if (actual !== type) fail("PROCESS_CALL_VALUE_TYPE_CHANGED");
  }
  return values;
}
