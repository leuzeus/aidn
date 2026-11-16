import path from 'node:path';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { parseStructuredMarkdownMap } from '../../lib/workflow/structured-artifact-parser-lib.mjs';
import { assertAgenticProcessInstance } from '../../core/workflow/agentic-process.mjs';
import { assertHandoffContext } from '../../core/workflow/standard-handoff-context.mjs';
import { artifactContentHash } from '../../core/workflow/artifact-compare-swap.mjs';
import { shadowHash, freezeShadow } from '../../core/workflow/shadow-json.mjs';

const fail = code => { throw Object.assign(Error(code), { code }); };
const none = value => ['none', '(none)'].includes(value.toLowerCase());
const fixed = ['CURRENT-STATE.md', 'RUNTIME-STATE.md', 'SPEC.md', 'WORKFLOW.md', 'WORKFLOW-KERNEL.md', 'snapshots/context-snapshot.md', 'HANDOFF-PACKET.md'];

// Canonical observation only. This does not hydrate, import a projection, run a
// hook, admit a handoff, infer resource closure or write a relay packet.
export function createStandardHandoffContext({ targetRoot, readCurrent }) {
  if (typeof readCurrent !== 'function') fail('STANDARD_HANDOFF_CONTEXT_READER_REQUIRED');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  function capture() {
    const instance = readCurrent(); assertAgenticProcessInstance(instance);
    const binding = artifacts.describe();
    const first = artifacts.read('CURRENT-STATE.md', { required: true }), current = parseStructuredMarkdownMap(first.content);
    const sessionId = current.active_session || 'unknown', cycleId = current.active_cycle || 'unknown';
    const topology = artifacts.observeTopology();
    const selected = (rows, id, key, code) => {
      if (none(id) || id.toLowerCase() === 'unknown') return null;
      const matches = rows.filter(row => row[key] === id);
      if (matches.length !== 1) fail(code);
      return matches[0].path;
    };
    const sessionPath = selected(topology.sessions(), sessionId, 'session_id', 'STANDARD_HANDOFF_CONTEXT_SESSION_REQUIRED');
    const cyclePath = selected(topology.cycles(), cycleId, 'cycle_id', 'STANDARD_HANDOFF_CONTEXT_CYCLE_REQUIRED');
    const planPath = cyclePath ? path.posix.join(path.posix.dirname(cyclePath), 'plan.md') : null;
    const names = [...new Set([...fixed, sessionPath, cyclePath, planPath].filter(Boolean))];
    const required = ['CURRENT-STATE.md', 'SPEC.md', 'WORKFLOW.md', 'WORKFLOW-KERNEL.md', 'snapshots/context-snapshot.md', sessionPath, cyclePath].filter(Boolean);
    const documents = artifacts.readMany(names, { required, includeMetadata: true });
    if (documents.find(row => row.path === 'CURRENT-STATE.md').sha256 !== first.sha256
      || shadowHash(artifacts.describe()) !== shadowHash(binding)) fail('STANDARD_HANDOFF_CONTEXT_CHANGED');
    return { contract_version: 'standard-handoff-context.v1', instance_id: instance.instance_id, instance_sha256: instance.instance_sha256,
      scope_id: instance.scope_id, model_sha256: instance.model_sha256, policy_sha256: shadowHash(instance.policy_pins),
      physical_root_sha256: shadowHash(artifacts.root), state_mode: binding.state_mode, canonical_source: binding.database ? binding.backend : 'files',
      runtime_binding_sha256: shadowHash(binding),
      current: { mode: current.mode || 'unknown', branch_kind: current.branch_kind || 'unknown',
        active_session: sessionId, active_cycle: cycleId, dor_state: current.dor_state || 'unknown',
        first_plan_step_sha256: artifactContentHash(current.first_plan_step || '') },
      selected: { session_path: sessionPath, cycle_status_path: cyclePath, cycle_plan_path: planPath },
      documents: documents.map(row => ({ path: row.path, sha256: row.sha256, metadata_sha256: row.metadata_sha256 })),
      permits_effects: false, permits_handoff: false, complete_resource_closure: false, written: false };
  }
  return Object.freeze({ inspect() {
    const before = capture(), after = capture();
    if (shadowHash(before) !== shadowHash(after)) fail('STANDARD_HANDOFF_CONTEXT_CHANGED');
    return freezeShadow(assertHandoffContext({ ...after, context_sha256: shadowHash(after) }));
  } });
}
