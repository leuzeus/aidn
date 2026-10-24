# Artifact intent preparation experiment

The internal `src/application/codex/artifact-intent-preparation.mjs` compiler
prepares several governed artifact drafts or exact mutations from one retained
canonical observation. It is opt-in research-host composition. It adds no public
CLI, write effect, persistence, installation change or default skill adoption.

## Explicit intent and complete inputs

`prepareArtifactIntentBatch(request, observation)` is pure. The host obtains and
retains complete UTF-8 preimages through the ordinary canonical snapshot or batch
artifact reader, verifies the configured backend and scope, and supplies only
the selected sources. Template references come from the existing complete
`artifact-store list --templates` discovery. An absent creation target must be
observed in the same scoped snapshot; a failed lookup or unavailable backend is
never evidence of absence. Template discovery does not replace the complete
template read or the skill's mandatory authority reads.

The observation contains `target_root`, `backend`, `state_mode`, the four canonical
project/workspace/runtime/worktree scope IDs, complete `artifacts`, explicit
`absent_paths` and discovered `template_paths`. `artifactIntentObservationRevision`
binds this observation's content hashes, metadata hashes, membership and scope.
The request pins that revision and scope once, plus explicit `session_id`,
`cycle_id` and 1–32 ordered `items`. Each item supplies:

- `path`: the intended session/cycle artifact, current state or context snapshot;
- `source_path`: omitted for an update, or a discovered session/cycle template
  in the same family for a create-only draft;
- compact `fields`, `sections` and/or `replacements`, processed in that order;
  alternatively `edits`: 1–32 explicit ordered field/section/replacement edits.
  The two forms cannot be mixed. Both have a combined 32-edit limit per item.

No goal, result, test verdict, ownership decision, timestamp, workflow outcome or
next action is inferred. The caller supplies every changed value. Unedited bytes
remain unchanged. Authorities, generated runtime/handoff digests, foreign
entities, path aliases and traversal are outside this compiler's mutation scope.
Unknown or invalid input refuses the whole preparation with no partial plan.

For example, after the host has retained and delivered the actual complete
sources, it can prepare several edits in one invocation:

```js
const prepared = prepareArtifactIntentBatch({
  scope: observation.scope,
  observation_sha256: artifactIntentObservationRevision(observation),
  session_id: "S001", cycle_id: "C001",
  items: [{
    path: "cycles/C001-feature/status.md",
    fields: { next_action: explicitNextAction },
  }, {
    path: "cycles/C001-feature/brief.md",
    source_path: discoveredBriefTemplatePath,
    sections: { "## Objective": explicitObjective },
  }],
}, observation);
```

`field` edits select exactly one whole non-fenced `key: value` or `- key: value`
line. Optional `heading` limits selection to the complete ATX section, including
nested headings. With that selector the generated replacement binds the whole
section, preserving identical field lines elsewhere and in examples. `section`
edits keep the original heading and replace its complete body with explicit
`body`; peer/superior headings and unclosed fences refuse. `replace` retains the
ordinary exact `old`/`new` uniqueness rules, including overlapping matches.

## Prepared outputs and existing writers

The versioned internal observation contains source references, a plan hash and
ordered `items`. Every update has one `cas_request` with the real expected content
and metadata hashes and generated exact replacements. No model copies old field
values or invents a source hash. A creation has one complete canonical artifact
and `expectedSha256:null`, for the existing create-only compare-and-swap port;
an unchecked full-content upsert is not a safe consumer of this draft.

Preparation performs no admission or write. It always reports `written:false`,
`write_authorization:false` and `freshness_proven:false`. Source/plan hashes detect
changes but do not authenticate a supplied observation or replace retained proof.
The host must bind actual sources and any execution to its exact scope, invocation,
deadline, current admissions and reservation fences. It must inspect every actual
result and retain the complete receipts. A prepared plan is never reusable
permission. Creation drafts are prepared and CAS-tested here; a native startup
executor consuming them remains unqualified.

`runPreparedOrderedClosure` is the concrete terminal consumer. After pure
preparation it checks the existing engine's pure preview target and forwards only
the generated existing-artifact mutations to `createOrderedClosureSequence.run`.
Actual effects still require `write:true`.
The consumer captures the boolean write intent before awaiting, isolates each
port's request copy and preserves the original preparation/engine refusal codes.
The engine performs its unchanged fresh stage admission, SHA-CAS writes, runtime generation/persistence and verified
strict final hook. Its writer preserves current metadata under its ordinary lock;
the terminal CLI does not acquire an additional historical metadata-pin option.
Session closure still requires the actual successful cycle segment in that host.
Any actual refusal, global stop, changed binding, stale content, partial write or
unknown outcome keeps its original stop behavior. An executor exception reports
`written:null`; it cannot authorize retry or claim rollback.

The complete serialized preparation is bounded (1 MiB maximum, reducible with
`maxOutputBytes`). An insufficient budget returns an explicit refusal and the
required/requested byte counts, never a clipped draft or authority. This is not
the context-hydration budget and bytes are not tokens. Hosts can deliver compact
diagnostics only after retaining and verifying the complete plan and sources.

## Evidence and adoption

The existing `runtime-artifact-efficiency` gate includes
`verify-artifact-intent-preparation-fixtures.mjs`. It checks deterministic and
atomic preparation, all distributed session/cycle templates, CRLF/fenced examples,
scope/revision/ambiguity/budget refusal, unchanged database bytes during
preparation, and real SQLite CAS application with stale-byte, metadata and
create-only conflict rejection. The terminal consumer uses injected host ports;
it does not establish actual native hook execution.

No default procedure is adopted here. A future native research host must bind
this preparation to real observations and retain the same ordinary controls,
then compare the complete unchanged scenario against its reference. Fewer emitted
document bytes or easier input preparation do not establish fewer model responses,
lower cumulative input or a causal token gain. PostgreSQL, installed-package and
native model qualification remain separate from these fixtures.
