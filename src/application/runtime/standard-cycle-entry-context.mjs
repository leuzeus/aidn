import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { parseSessionMetadata } from "../../lib/workflow/session-context-lib.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
const fields = row => analyzeStructuredArtifact(row.content).key_values;
const pin = ({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 });

// Internal canonical read shared by admission and human choice preparation.
// It grants no selection, checkout, write or implementation permission.
export function observeStandardCycleEntryContext({ artifacts, scope, sessionId }) {
  const selected = artifacts.describe(), topology = artifacts.observeTopology();
  const references = topology.cycles().sort((a, b) => a.path.localeCompare(b.path, "en"));
  const names = ["CURRENT-STATE.md", `sessions/${sessionId}.md`, ...references.map(row => row.path)];
  const rows = new Map(artifacts.readMany(names, { required: names, includeMetadata: true }).map(row => [row.path, row]));
  const required = name => {
    if (!rows.has(name)) rows.set(name, artifacts.readMany([name], { required: [name], includeMetadata: true })[0]);
    return rows.get(name);
  };
  const current = required("CURRENT-STATE.md"), session = required(`sessions/${sessionId}.md`);
  const cycles = references.map(reference => { const row = required(reference.path); return { row, cycle_id: reference.cycle_id, fields: fields(row) }; });
  if (new Set(cycles.map(row => row.cycle_id)).size !== cycles.length) fail("STANDARD_CYCLE_ENTRY_AMBIGUOUS_INVENTORY");
  if (shadowHash(artifacts.describe()) !== shadowHash(selected)) fail("STANDARD_CANONICAL_BACKEND_CONFLICT");
  const canonical = [current, session].map(pin), inventoryPins = cycles.map(({ row, cycle_id }) => ({ cycle_id, ...pin(row) }));
  return { rows, required, current, session, cycles, canonical, state: fields(current), metadata: parseSessionMetadata(session.content),
    inventory_sha256: shadowHash({ source: selected.database ? selected.backend : "files", binding_sha256: shadowHash(selected), cycles: inventoryPins }),
    scope: scope() };
}
