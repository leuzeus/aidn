import path from 'node:path';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { createStandardHandoffContext } from './standard-handoff-context.mjs';
import { projectHandoffPacket } from '../../../tools/runtime/project-handoff-packet.mjs';
import { buildHandoffPacketMarkdown } from './handoff-packet-projector-use-case.mjs';
import { parseStructuredMarkdownMap } from '../../lib/workflow/structured-artifact-parser-lib.mjs';
import { shadowHash, freezeShadow } from '../../core/workflow/shadow-json.mjs';

const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const equal = (a, b) => shadowHash(a) === shadowHash(b);
// A fixed canonical adapter for the existing pure packet producer. It neither
// imports visible projections nor invokes that producer's filesystem writer.
export function createCanonicalHandoffProjection({ targetRoot, readCurrent }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  const context = createStandardHandoffContext({ targetRoot, readCurrent });
  return Object.freeze({ async prepare(input, at) {
    const before = context.inspect(), binding = artifacts.describe(), sources = new Map();
    const resolve = name => {
      name = String(name).replace(/^docs\/audit\//, '');
      const [row] = artifacts.readMany([name], { includeMetadata: true });
      const value = { path: row.path, sha256: row.sha256, metadata_sha256: row.metadata_sha256 };
      if (sources.has(name) && !equal(sources.get(name), value)) fail('STANDARD_HANDOFF_PROJECTION_CHANGED');
      sources.set(name, value);
      return { exists: row.sha256 !== null, logicalPath: 'docs/audit/' + name, source: row.sha256 === null ? 'missing' : binding.database ? binding.backend : 'file',
        text: row.content ?? '', absolutePath: path.join(artifacts.root, 'docs/audit', name) };
    };
    const missing = () => ({ exists: false, logicalPath: 'none', source: 'missing', text: '' });
    const selected = (id, expected, name) => {
      const absent = value => ['none', '(none)', 'unknown', ''].includes(String(value).toLowerCase());
      if (id !== expected && !(name === null && absent(id) && absent(expected))) fail('STANDARD_HANDOFF_PROJECTION_OWNER_CHANGED');
      return name ? resolve(name) : missing();
    };
    const reader = Object.freeze({ root: artifacts.root, describe: artifacts.describe,
      parseMap: text => new Map(Object.entries(parseStructuredMarkdownMap(text))),
      resolveAuditArtifactText: ({ candidatePath }) => resolve(candidatePath),
      resolveSessionArtifact: ({ sessionId }) => selected(sessionId, before.current.active_session, before.selected.session_path),
      resolveCycleStatusArtifact: ({ cycleId }) => selected(cycleId, before.current.active_cycle, before.selected.cycle_status_path),
      resolveCyclePlanArtifact: ({ cycleId }) => selected(cycleId, before.current.active_cycle, before.selected.cycle_plan_path) });
    const projection = await projectHandoffPacket({ targetRoot: artifacts.root, canonicalReader: reader, dryRun: true, write: false, syncRelay: false,
      nextAgentGoal: input.next_agent_goal, handoffNote: input.handoff_note, fromAgentRole: input.from_agent_role, fromAgentAction: input.from_agent_action,
      nextAgentRole: input.next_agent_role, nextAgentAction: input.next_agent_action, updatedAt: new Date(at).toISOString() });
    // Normalize observational time only. Verdicts, details, actual packet fields,
    // scope, shared planning and every canonical content/metadata witness remain.
    if (projection.consistency?.ts) projection.consistency.ts = new Date(at).toISOString();
    if (!equal(context.inspect(), before) || !equal(artifacts.describe(), binding)) fail('STANDARD_HANDOFF_PROJECTION_CHANGED');
    for (const row of sources.values()) { const [current] = artifacts.readMany([row.path], { includeMetadata: true });
      if (current.sha256 !== row.sha256 || current.metadata_sha256 !== row.metadata_sha256) fail('STANDARD_HANDOFF_PROJECTION_CHANGED'); }
    return freezeShadow({ context: before, projection, sources: [...sources.values()].sort((a, b) => a.path.localeCompare(b.path, 'en')),
      markdown: buildHandoffPacketMarkdown(projection.packet) });
  } });
}
