// Coverage authority for splitting the 43-command context-resilience chain
// recorded at 5f768d3. Keep argv and order explicit: package script names alone
// cannot prove that a renamed, nested or shortened group retains its coverage.
const REQUIRED_INVOCATIONS = Object.freeze([
  "node tools/perf/verify-reanchor-template.mjs",
  "node tools/perf/verify-current-state-skill-coverage.mjs --root scaffold/codex",
  "node tools/perf/verify-pre-write-admit-skill-coverage.mjs --root scaffold/codex",
  "node tools/perf/verify-codex-db-only-skill-readiness.mjs --root scaffold/codex --agents scaffold/root/AGENTS.md",
  "node tools/perf/verify-start-session-admission-fixtures.mjs",
  "node tools/perf/verify-branch-cycle-audit-admission-fixtures.mjs",
  "node tools/perf/verify-cycle-close-admission-fixtures.mjs",
  "node tools/perf/verify-cycle-close-completion-fixtures.mjs",
  "node tools/perf/verify-pr-orchestrate-admission-fixtures.mjs",
  "node tools/perf/verify-reanchor-artifacts-fixtures.mjs --target tests/fixtures/repo-installed-core",
  "node tools/perf/verify-agent-role-model.mjs",
  "node tools/perf/verify-agent-roster-fixtures.mjs",
  "node tools/perf/verify-agent-health-summary-fixtures.mjs",
  "node tools/perf/verify-agent-selection-policy.mjs",
  "node tools/perf/verify-agent-transition-policy.mjs",
  "node tools/perf/verify-coordinator-escalation-policy.mjs",
  "node tools/perf/verify-handoff-packet-fixtures.mjs",
  "node tools/perf/verify-handoff-admit-fixtures.mjs",
  "node tools/perf/verify-pre-write-admit-fixtures.mjs",
  "node tools/perf/verify-integration-risk-fixtures.mjs",
  "node tools/perf/verify-coordinator-next-action-fixtures.mjs",
  "node tools/perf/verify-coordinator-select-agent-fixtures.mjs",
  "node tools/perf/verify-coordinator-suggest-arbitration-fixtures.mjs",
  "node tools/perf/verify-coordinator-loop-fixtures.mjs",
  "node tools/perf/verify-coordinator-record-arbitration-fixtures.mjs",
  "node tools/perf/verify-coordinator-resume-fixtures.mjs",
  "node tools/perf/verify-coordinator-orchestrate-fixtures.mjs",
  "node tools/perf/verify-coordinator-dispatch-plan-fixtures.mjs",
  "node tools/perf/verify-coordinator-dispatch-execute-fixtures.mjs",
  "node tools/perf/verify-coordination-summary-fixtures.mjs",
  "node tools/perf/verify-list-agent-adapters-fixtures.mjs",
  "node tools/perf/verify-agent-selection-summary-fixtures.mjs",
  "node tools/perf/verify-multi-agent-status-fixtures.mjs",
  "node tools/perf/verify-current-state-consistency-fixtures.mjs",
  "node tools/perf/verify-runtime-state-projector-fixtures.mjs",
  "node tools/perf/verify-runtime-state-projector-repair-fixtures.mjs",
  "node tools/perf/verify-hydrate-context-runtime-state-fixtures.mjs",
  "node tools/perf/verify-codex-context-repair-layer-fixtures.mjs",
  "node tools/perf/verify-runtime-digest-hints-fixtures.mjs",
  "node tools/perf/verify-current-state-skill-coverage.mjs --root tests/fixtures/repo-installed-core/.agents/skills",
  "node tools/perf/verify-codex-db-only-skill-readiness.mjs --root tests/fixtures/repo-installed-core/.agents/skills --manifest tests/fixtures/repo-installed-core/.aidn/codex/skills.yaml --agents tests/fixtures/repo-installed-core/AGENTS.md",
  "node tools/perf/verify-install-import-fixtures.mjs",
  "node tools/perf/verify-install-source-branch-fixtures.mjs",
]);

const GROUPS = Object.freeze([
  { name: "admission", start: 0, end: 7 },
  { name: "completion", start: 7, end: 9 },
  { name: "coordination", start: 9, end: 29 },
  { name: "projection", start: 29, end: 43 },
].map((group) => Object.freeze({
  ...group,
  id: `codex-context-${group.name}`,
  script: `perf:verify-context-${group.name}`,
})));
const WRAPPER = "perf:verify-context-resilience";

// The governed scripts use a deliberately small grammar: blocking && chains
// of literal node argv or npm run references. Shell fallbacks, conditions and
// extra npm arguments cannot be interpreted as equivalent coverage.
function expandScript(scripts, name, active = new Set()) {
  if (active.has(name)) throw new Error(`${name}: recursive npm script`);
  if (typeof scripts[name] !== "string" || !scripts[name].trim()) {
    throw new Error(`${name}: package script missing or empty`);
  }
  if (scripts[`pre${name}`] != null || scripts[`post${name}`] != null) {
    throw new Error(`${name}: implicit npm lifecycle hooks alter governed coverage`);
  }
  active.add(name);
  const invocations = scripts[name].split("&&").flatMap((part) => {
    const command = part.trim().replace(/\s+/gu, " ");
    const nested = /^npm run ([\w:.-]+)$/u.exec(command);
    if (nested) return expandScript(scripts, nested[1], active);
    if (!/^node tools\/perf\/[\w.-]+\.mjs(?: [\w./-]+)*$/u.test(command)) {
      throw new Error(`${name}: unsupported command form`);
    }
    return [command];
  });
  active.delete(name);
  return invocations;
}

// Inspect npm references and lifecycle hooks without interpreting arbitrary
// shell programs. Flags without a separate value (including --silent/-s and
// --loglevel=silent) may precede or follow run. A literal protected script in
// an unsupported form is conservatively refused rather than silently ignored.
function referencesContextScript(scripts, name, protectedScripts, seen = new Set()) {
  if (protectedScripts.has(name)) return true;
  if (seen.has(name)) return false;
  seen.add(name);
  const body = String(scripts[name] ?? "");
  if ((body.match(/[\w:.-]+/gu) ?? []).some((token) => protectedScripts.has(token))) return true;
  const lifecycle = [`pre${name}`, `post${name}`].filter((hook) => Object.hasOwn(scripts, hook));
  const references = [...body.matchAll(
    /\bnpm(?:\.cmd)?(?:\s+--?[\w-]+(?:=[\w.-]+)?)*\s+run(?:-script)?(?:\s+--?[\w-]+(?:=[\w.-]+)?)*\s+([\w][\w:.-]*)/gu,
  )].map((match) => match[1]);
  return [...lifecycle, ...references]
    .some((reference) => referencesContextScript(scripts, reference, protectedScripts, seen));
}

export function validateContextResiliencePolicy({ catalog, packageJson }) {
  const issues = [];
  const scripts = packageJson?.scripts ?? {};
  const gates = Array.isArray(catalog?.gates) ? catalog.gates : [];
  const protectedScripts = new Set([WRAPPER, ...GROUPS.map((group) => group.script)]);
  const expectedWrapper = GROUPS.map((group) => `npm run ${group.script}`).join(" && ");
  if (scripts[WRAPPER] !== expectedWrapper) {
    issues.push(`${WRAPPER}: manual wrapper must invoke the four groups once in order`);
  }
  for (const group of [...GROUPS, { script: WRAPPER, start: 0, end: 43 }]) {
    try {
      const actual = expandScript(scripts, group.script);
      const expected = REQUIRED_INVOCATIONS.slice(group.start, group.end);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        issues.push(`${group.script}: ordered invocation coverage or argv changed`);
      }
    } catch (error) {
      issues.push(error.message);
    }
  }
  for (const group of GROUPS) {
    const matches = gates.filter((gate) => gate.id === group.id);
    if (matches.length !== 1) {
      issues.push(`${group.id}: exactly one context group gate is required`);
      continue;
    }
    const gate = matches[0];
    if (gate.script !== group.script || gate.family !== "codex"
        || gate.job !== "governance-admission/gates" || gate.condition !== "always"
        || ![undefined, "admission"].includes(gate.execution_scope)) {
      issues.push(`${group.id}: immutable context group routing changed`);
    }
    for (const context of ["dev", "main", "release"]) {
      if (gate.obligation?.[context] !== "required") {
        issues.push(`${group.id}: immutable ${context} obligation must be required`);
      }
    }
  }
  for (const gate of gates) {
    const ownGroup = GROUPS.find((group) => group.id === gate.id);
    if (ownGroup && gate.script === ownGroup.script) continue;
    if (gate.id === "codex-context-resilience"
        || referencesContextScript(scripts, gate.script, protectedScripts)) {
      issues.push(`${gate.id}: context groups must not be repeated through another gate or the manual wrapper`);
    }
  }
  return issues;
}
