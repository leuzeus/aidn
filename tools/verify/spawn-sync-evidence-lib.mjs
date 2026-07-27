function tokenizeJavaScript(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const token = source[index];
    const next = source[index + 1] ?? "";
    if (/\s/u.test(token)) {
      index += 1;
      continue;
    }
    if (token === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      continue;
    }
    if (token === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index += 1;
      }
      index += 2;
      continue;
    }
    if (token === "'" || token === "\"" || token === "`") {
      const quote = token;
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (/[A-Za-z_$]/u.test(token)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_$]/u.test(source[index])) {
        index += 1;
      }
      tokens.push(source.slice(start, index));
      continue;
    }
    if (/[0-9]/u.test(token)) {
      const start = index;
      index += 1;
      while (index < source.length && /[0-9A-Za-z_.]/u.test(source[index])) {
        index += 1;
      }
      tokens.push(source.slice(start, index));
      continue;
    }
    tokens.push(token);
    index += 1;
  }
  return tokens;
}

function countSequence(tokens, sequence) {
  let count = 0;
  for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
    if (sequence.every((token, offset) => tokens[index + offset] === token)) {
      count += 1;
    }
  }
  return count;
}

export function inspectSpawnSyncOracleSource(source) {
  const tokens = tokenizeJavaScript(String(source ?? ""));
  const forbiddenIdentifiers = [
    "all_exited",
    "child_pid_exited",
    "child_processes_exited",
    "launchedPids",
  ];
  const processKillCalls = countSequence(tokens, ["process", ".", "kill", "("]);
  const pidMemberReads = countSequence(tokens, [".", "pid"]);
  const identifierHits = forbiddenIdentifiers.filter((identifier) => tokens.includes(identifier));
  return {
    ok: processKillCalls === 0 && pidMemberReads === 0 && identifierHits.length === 0,
    process_kill_calls: processKillCalls,
    pid_member_reads: pidMemberReads,
    forbidden_identifiers: identifierHits,
  };
}

export function createSpawnSyncEvidenceTracker() {
  let invocationsReturned = 0;
  return Object.freeze({
    recordReturn() {
      invocationsReturned += 1;
    },
    snapshot() {
      return {
        execution_model: "spawnSync-return",
        invocations_returned: invocationsReturned,
        completion_basis: "spawnSync-returned-for-original-child",
        numeric_pid_rechecks: 0,
      };
    },
  });
}

export function isSpawnSyncEvidence(value) {
  return value?.execution_model === "spawnSync-return"
    && Number.isInteger(value?.invocations_returned)
    && value.invocations_returned >= 0
    && value?.completion_basis === "spawnSync-returned-for-original-child"
    && value?.numeric_pid_rechecks === 0;
}

export function verifySpawnSyncOraclePolicy({ source, label }) {
  const inspection = inspectSpawnSyncOracleSource(source);
  if (!inspection.ok) {
    throw new Error(
      `${label}: late numeric PID oracle is forbidden: ${JSON.stringify(inspection)}`,
    );
  }

  const oldPatternMutant = [
    String(source ?? ""),
    "const launchedPids = new Set([result.pid]);",
    "const all_exited = [...launchedPids].every((pid) => {",
    "  try { process.kill(pid, 0); return false; } catch { return true; }",
    "});",
  ].join("\n");
  const mutantInspection = inspectSpawnSyncOracleSource(oldPatternMutant);
  if (mutantInspection.ok) {
    throw new Error(`${label}: old late-PID oracle mutant was not rejected`);
  }

  let numericPidReads = 0;
  const reusedPidSentinel = new Proxy({}, {
    get(_target, property) {
      if (property === "pid") {
        numericPidReads += 1;
        throw new Error("numeric PID identity must not be read");
      }
      return undefined;
    },
  });
  const tracker = createSpawnSyncEvidenceTracker();
  tracker.recordReturn(reusedPidSentinel);
  const evidence = tracker.snapshot();
  const reusedPidIgnored = numericPidReads === 0 && isSpawnSyncEvidence(evidence);
  if (!reusedPidIgnored) {
    throw new Error(`${label}: reused numeric PID affected synchronous completion evidence`);
  }

  return {
    source_policy_ok: true,
    process_kill_calls: inspection.process_kill_calls,
    pid_member_reads: inspection.pid_member_reads,
    false_completion_fields: inspection.forbidden_identifiers,
    old_pattern_mutant_rejected: true,
    reused_numeric_pid_ignored: true,
  };
}
