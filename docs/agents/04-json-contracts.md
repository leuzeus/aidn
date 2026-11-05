# 04 JSON Contracts

## Close expiry continuation contracts

The renewal plan embeds the closed hook-input data shape and its contract-version
annotation. `$schema` and `$id` remain on schema roots only. The pure close-hook
contract fixture validates the renewal, v2 output and close-selection definitions,
including invalid data paths and incompatible outcome combinations.

Private standard-cycle-close-renewal-plan.v1 and close-hook-output.v2 distinguish
a proved pre-effect expiry return from confirmed closure and UNKNOWN. A completed
no-effect attempt must set cycle_close_completed=false and retain its historical
completion anchor. The private close selection output projects only an accepted
confirmed operation identity across the loop boundary. V1 readers remain. These
are existing operation-journal records, with no new public CLI case or independent
authority. See ADR-0025 for fences and qualification limits.


The private standard-drift-recovery-plan.v3 adds an exact accepted-completion
anchor to a fresh objective review. V2 question/source and inbox v12 bind that
nested subject without converting historical records. The private route-output
v1 carries control facts only. See ADR-0025 for authority and proof limits.

The private `standard-drift-objective-disposition.v1` is a derived view of an
authenticated accepted opinion. `standard-drift-finalize-plan.v3` retains that
view for exact effect-fence comparison. They reuse the governed decision inbox
and operation journal; they introduce no public CLI case, independent authority,
table or historical conversion. Finalization plan v1/v2 readers remain. See
ADR-0025 for the internal authenticated hook boundary and qualification limits.

The private workflow-definition namespace adds `native-allocation-journal.v2`
and explicit native authorization/request/grant/resource-closure v1 contracts.
V2 retains the full signed v1 origin and is created only through an authenticated
explicit activation. Historical instance/checkpoint/v1 journal readers remain
unchanged; reads never activate an epoch. These internal contracts add no public
CLI output case. See ADR-0026.

The separate initial-entry route uses `native-allocation-journal.v3` and
`native-authorization-epoch-request.v2`. It preserves an expired unused original
authorization and an authenticated empty allocation prefix. A native-scope
inventory still requires independent complete resource discovery and closure;
absence of allocations is not a termination proof. V1/v2 schemas are unchanged.


## Purpose

Every stable public JSON output must have an explicit contract under `src/core/contracts/cli-output/`.

Contracts keep the public CLI surface predictable for agents, scripts, and tests.

## Contract Rules

- every stable public JSON output needs a versioned schema
- v1 schemas should stay shallow and additive
- do not break v1 without a new versioned schema
- create v2 if the shape must change in a breaking way
- update fixtures and gates whenever a contract changes

## Recommended Top-Level Fields

Use the relevant subset of these fields when they apply:

- `contract_version`
- `command`
- `effect_class`
- `dry_run`
- `written`
- `write_targets`
- `source_of_truth`
- `source_mode`
- `lifecycle_status`
- `runtime_state_mode`
- `shared_coordination_sync`
- `errors`
- `warnings`

Some current v1 payloads also use `issues` and `operations` instead of `errors`.
Do not rename those fields in place without a version bump and fixture update.

## Practical Rules

- keep the schema file as the versioned contract
- keep `x-aidn-command` and `x-aidn-contract-version` aligned with the command name
- when preview and explicit-write variants share one additive payload, keep the preview in `x-aidn-command` and enumerate both exact forms in `x-aidn-commands`
- do not encode local paths or secrets as schema constants
- keep nested objects extensible until the fixtures and gates are ready to tighten them
- machine-readable commands must emit exactly one complete JSON document on
  `stdout`; surrounding whitespace is allowed, but prefixes, suffixes, logs,
  and substring extraction are forbidden
- diagnostics belong on `stderr` and are validated separately from the JSON
  document

The executable contract verifier validates every schema keyword used by this
registry, recursively. The supported validation vocabulary is `type`,
`required`, `properties`, `const`, `enum`, `items`, `additionalProperties`,
`minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `format`, `minItems`,
`maxItems`, `minProperties`, `maxProperties`, `oneOf`, `anyOf`, and `allOf`;
the supported formats are `date-time`, `uri`, and `email`. Schema annotations
remain descriptive. Adding another validation keyword requires implementing it
in the deterministic validator and
adding a rejecting fixture before that keyword can appear in a public schema.

Contract coverage is closed in both directions:

- every active public contract has exactly one isolated executable case
- every executable case resolves to exactly one active schema
- each case validates an output produced by the real command
- each case parses the complete trimmed `stdout` with `JSON.parse`, without a
  recovery fallback
- negative fixtures prove that each supported validation keyword rejects an
  invalid payload
- redaction checks remain separate from structural schema validation

## Change Rule

If the payload shape changes, update the schema, the fixture coverage, and the relevant gate in the same change set.

## Internal Agent Reuse Decision

ADR-0021 adds the closed nested `agent-reuse-decision.v1` contract under
`src/core/contracts/agent-reuse/`. Sequential dispatch plan/execute v1 roots may
include `execution_assignment`; executed checks retain the same shape. These
optional fields distinguish execution identity from adapter selection and never
grant writes or native qualification. Legacy CLI calls do not opt in. Internal
request/observation guards and authority composition are specified in ADR-0021;
authored JSON alone is not evidence. No new root CLI case or persistent authority
is introduced.

## Internal Shadow Workflow Definition

Session reports add private `standard-session-closure-record.v2` and
`standard-session-closure-completion.v2` bodies in the workflow-definition
namespace. New reports bind the human subject, HEAD and ordered historical block
hashes; their completion binds the report and decision. Current and archived v2
pairs require matching versions, and each archived report checks its historical
prefix. Legacy pairs stay readable without conversion. These are session content
records under existing canonical artifact CAS, not a new public CLI output or
an independent authority. See ADR-0025.

ADR-0022 adds closed `agentic-process-model.v1` and
`agentic-process-instance.v1` contracts in the `workflow-definition` namespace.
Nested models, assignment requests/decisions and typed events receive their own
schema/semantic checks during replay. These internal APIs add no root CLI case.
The structured execution profile is distinct from the descriptive shadow format;
neither a hash nor an authored declaration authenticates a resource or verdict.

ADR-0023 adds `bpmn-process-compilation.v1` and
`agentic-process-simulation.v1` in this same internal namespace. Compilation
validates its nested executable model with the existing IR schema/guard;
simulation validates each replayed instance/event before exposing its cursor.
Source maps are derived, traces synthetic, and neither envelope grants writes
or creates a public CLI case. See [the BPMN profile](../BPMN_EXECUTION_PROFILE.md).
The default v2 XML compiler uses the same
compilation envelope. Explicit v1 remains compatible; existing model/instance/event
contracts and required execution authorities retain their versions and meaning.
The optional internal `agentic-process-control-scenario.v1` file uses a closed
root/step schema and semantic control-event guard. It is a pinned operational
input to the owned composition, not a public CLI output, executor credential or
new durable authority. Delivered events retain the existing instance contract.

ADR-0020 exposes the experimental `runtime-workflow-inspect.v1`,
`runtime-workflow-action.v1` and `runtime-workflow-dashboard.v1` public roots.
The common derived view retains exact IDs, reason codes and independent run
status axes. CLI and HTTP fixtures compare complete objects; existing internal
schemas still validate nested instances and selections before projection.

ADR-0024 adds `runtime-workflow-run.v1` for ordinary structured-agentic execution.
Its selected engine, exact preview, requirements and owned-host result remain
explicit. The console's derived instances carry `engine`; their nested agentic
or sequential records are validated through their own versioned contracts.

ADR-0019 adds closed internal `workflow-candidate.v1`,
`workflow-candidate-preview.v1`, `workflow-projection.v1` and
`workflow-selection.v1` contracts. Nested definitions and compilations use the
existing schemas. Retained selection validation recomputes diffs, permission
ceilings and exact historical review previews. Projection regeneration detects
stale content. These internal APIs add no public CLI contract case.

ADR-0018 adds the closed internal `workflow-instance.v1` envelope with retained
definition/compilation schemas, scope pins and typed event history. Replay
validates cursor, bounded returns, run uniqueness and supervisor result binding.
Its opt-in internal composition adds no public JSON command or registry case.

ADR-0017 adds closed `workflow-segment-binding.v1` and
`workflow-segment-selection.v1` contracts in this namespace. The binding's nested
definition and context are validated against their existing schemas by the
binding validator. Explicit run configuration v2 requires this binding; v1
rejects it. Existing public `agent-run*` JSON roots remain v1 and expose the
selection at the extensible `action.preconditions.workflow`. The lifecycle gate
validates the nested contract as well as the public root. Selection does not
change the descriptive macro's execution availability or source of truth.

ADR-0015 proposes `workflow-definition.v1` under
`src/core/contracts/workflow-definition/`, using the explicit
`workflow-definition` validator profile and contract URI namespace. It has no
standalone public CLI entry or handler dispatcher. Descriptors and parity
expectations in `tests/fixtures/workflow-shadow/` are reference data. The
`contracts-workflow-shadow` gate checks schema, links, graph shape and existing
helper behavior; it does not establish executable workflow availability.

ADR-0016 adds `workflow-shadow-context.v1` and `workflow-compilation.v1` in the
same internal profile. Compilation is pure, with caller-supplied context and
explicit definition/registry/compiler fingerprints. Optional `primitive_ref`
preserves structural v1 compatibility; compilation requires a registered
reference. This pure compiler adds no public CLI registry entry or dispatch;
ADR-0017 supplies its explicit run-local consumer.
`contracts-workflow-compilation` verifies deterministic output and semantic
refusals; a valid shadow envelope grants no authority to execute.

## Internal Agent Execution Contracts

Private `standard-spike-experiment-admission-output.v3` adds an explicit
`cycle_work_requested=true` only to a completed SPIKE execution admission.
Blocked output carries no positive facts. V1/v2 outputs remain readable with
their original semantics. Private `standard-operation-output.v3` carries the
mode decision's initial requested/not-requested value. Its closed facts bind
all three mode flags and that request to the exact observed choice. The closed
v2 schema remains unchanged for historical readers. This grants no product effect
and cannot substitute for plan selection or DoR. See ADR-0025.

Private task-selection/progression inputs, the advance plan and task output use
versioned closed contracts. The distinct task-work report/output bind a selected
task and explicit changed/unchanged result. Validation-evaluation input v2 adds
an optional accepted progress identity for a verified causal bridge; its v1
schema and historical readers remain retained. These are private workflow
contracts, not new public CLI outputs or an implicit migration.

The private workflow-definition namespace also contains validation-evaluation
input and verification-entry input/plan/output v1 contracts. Accepted source
identities, coverage facts and the four exact canonical changes are distinct
from task acceptance, audit completion and cycle closure. These contracts add
no public CLI command or historical instance conversion.

`standard-cycle-validation-profile.v1`, its prepared plan, input and output
use the private workflow-definition namespace. The host supplies a pinned check
profile out of band; authored IR carries only the accepted observed-work
operation identity. Native planning prose cannot supply an executable command.
The output distinguishes check status from operation completion and identifies
fixture evidence explicitly. These contracts introduce no public CLI command.

The workflow-definition namespace separately adds explicit
`process-data-bindings.v2` / `process-resolved-input.v2` activity targets, preserving
v1 operation-only validation. `standard-cycle-work-report.v1` and its evaluation
input/output are internal native/application contracts. They confer no CLI
command, authority, validation success or lifecycle completion.

ADR-0014 defines internal schemas under `src/core/contracts/agent-execution/`.
They use the explicit `agent-execution` validator profile and
`aidn://contracts/agent-execution/` identifiers. The default `cli-output` profile
and public command registry remain unchanged. Internal schemas are not CLI
commands and must not acquire fake `x-aidn-command` entries or public output cases.
Both profiles reject unsupported validation keywords. Positive and adversarial
payloads, semantic checks and executor doubles are covered by the dedicated
`runtime-agent-execution-contracts` gate.

The eighteen schemas cover sixteen kinds: descriptor, availability, plan, run, delegated task,
attempt, delegation, request, event, result, acceptance, supervisor, prepared
and applied integration, the pre-Git integration intent, and final run validation. Their pure validity does not
prove a working executor, live lease, Git reference or native admission. Task
validation selection is optional for v1 compatibility; final run validation
always covers the complete plan and audit on the exact integrated SHA.
An optional frozen verification configuration preserves historical v1 fingerprints.
It pins the executable, environment, exact regular control files, audit policy,
verification limits and SHA-256 of an explicitly selected Ed25519 public key in
SPKI DER form. Delegated operations cannot touch control files. An integration
intent binds the accepted source, expected parent, workspace, commit identity and
original creator before Git preparation. The prepared record retains its actual
producer and references the intent hash. These are model bindings, not live leases.
Contract validity and runtime availability remain separate evidence.

Plan v2 adds the required `assurance_profile: codex-cooperative.v1`. Plan v1
keeps its original closed shape and fingerprint; normalization does not promote
it to v2. The selected profile participates in the plan hash. Run, task and
attempt contracts retain their existing version and bind to that hash. The
cooperative validation configuration/qualification are v3 and explicitly state
`read_isolation: not_guaranteed`; strict and cooperative evidence cannot mix.
Public preview preconditions expose these limitations without claiming native
availability. The PostgreSQL JSONB plan retains the exact version and profile.

Plan v3 separately selects `codex-cooperative.v2` and boundary configuration and
qualification v4. These declare `read_isolation: not_guaranteed` and
`network_isolation: not_guaranteed`; qualification requires `network_disabled:
false`. Earlier versions still require network denial. The preview exposes the
new limitation in its action hash. Native write, process and exact-SHA proofs
remain required; network diagnostics are separate from v4 qualification.

Internal plan/run runtime scope keys accept the bounded canonical form
`runtime:project=<project_id>:workspace=<workspace_id>:profile=<profile>` produced
by the runtime context resolver, separately from historical internal IDs. The
embedded project/workspace must match the canonical reference. No other ID
syntax or existing plan fingerprint changes. The public supervisor requires
exact equality with the resolved runtime scope before reading its canonical
digest; a legacy short ID is not an alias for that context. PostgreSQL reads,
reservations and ordinary canonical writers use that same key and reservation
fence, without schema migration or implicit context adoption.

## Activation Refusals

Activation refusals use `activation-refusal.v1`, registered as an alternative for
the same command rather than changing its logical effect class. Required
`written: false` and `refused: true` report the observed refusal. Diagnostic and
pre-write admission contracts include compact activation, while native trust,
secret recovery pre-images and backend credentials are never part of that shape.


Private `standard-cycle-audit` report, selection and evaluation input/output v1
contracts describe read-only audit components. A favorable typed native proposal
cannot grant effects, accept risk or choose a terminal cycle state. Authenticated
source and complete canonical inventory are application responsibilities; schema
validity alone does not establish them. Ordered document chunks preserve complete
text without relaxing the shared JSON limits. No public CLI output is added.


Cycle closure adds private review/input/plan/question/decision/output contracts
and `process-decision-inbox.v3`. The review schema is also embedded in its parent
envelopes; no executable module, effect or permission may be supplied by a human
claim. Request facts identify a disposition, never a terminal lifecycle or hook
success. Explicit historical v1/v2 dispatch remains unchanged. The new contracts
and HMAC inbox alone do not authenticate a provider or qualify the full host.


The private `standard-cycle-close-input.v1`, `standard-cycle-close-plan.v1` and
`standard-cycle-close-output.v1` describe the bounded terminal metadata writer.
Output correlation rejects completion facts on blocked or uncertain effects and
keeps final hook completion false. They add no public CLI JSON root and confer
neither human authority nor write authorization. Full host execution evidence
is separate from schema/renderer/component checks.


The private `standard-cycle-close-hook-input.v1`, plan and output contracts
separate recorded terminal metadata from confirmed hook completion. Only an
operation identity selects the accepted source. Unknown effects carry no success
facts; confirmed completion includes the real checkpoint and three current
postimages. These contracts add no public CLI JSON root or authored authority.

Promotion review input/plan/question, human source and decision-output contracts
are private fixed-operation boundaries. Inbox v4 carries the typed promotion
source; v1-v3 retain their original readers and schemas. Successful decision
facts never assert baseline writes or completed promotion. The baseline record
input accepts an accepted decision identity only. These additions create no
public CLI JSON root or process-authored result authority.

The private standard-baseline-promotion-hook input/plan/output separate pending
baseline metadata from actual checkpoint confirmation. Input is an accepted
record identity; plan paths are fixed to five canonical artifacts. Blocked and
uncertain outcomes have no completion facts. Only confirmed checkpoint plus
five postimages may emit completed promotion. No public CLI root is added.


The private GitHub content readers add explicit github-review-evidence.v2 and
github-pr-observation.v2 outputs, together with github-pr-observation-request.v2.
Review bodies use complete
bounded chunks with semantic byte/digest checks; comments retain actor node IDs
and the observed exact base. Their historical v1 interfaces keep their original
shape. The distinct standard-session-pr-review-content-output.v1 embeds these
v2 observations under the existing pending-triage/no-merge semantics. It adds no
public CLI root, conversion or provider credential.

### Human-reviewed corrective cycle candidate, 2026-11-04

Private correction review input/plan/question, human decision and decision output
v2 bind the proposed cycle ID, title and objective to the current checkpoint
subject. The signed decision inbox v8 retains the explicit v2 source. The
initializer refuses substituted fields before ordinary admission or effects;
the published IR derives them from the accepted human operation output.
Historical v1/v7 readers remain explicit, without conversion. A proposal grants
no product permission, DoR, IMPLEMENTING phase or success. Refusal, defer and
cancellation retain empty positive facts. General mode/cycle/topology choices,
repeated corrections and the complete C2 journey remain unqualified.

The targeted decision/inbox and composition suites cover these boundaries. The
real-port correction-cycle suite selects `--decision-v2` separately in each
`--mode=files|dual|db-only` run. Its accepted-operation/provider/human capabilities
remain doubles. Component evidence cannot establish the production dispatcher
UNKNOWN chain, genuine human/native/provider/OS, configured PostgreSQL or exact
installed archive. Exact-source results remain pending at this source change.

### Human-selected new corrective cycle, 2026-11-04

Correction review v3 carries the current checkpoint subject and a digest of the
canonical cycle inventory, including metadata in database modes. It offers no
caller-supplied candidate. The authenticated v3 human source selects the new cycle
ID, title and objective; signed inbox v9 retains those values and their hash.
The published IR obtains initializer fields only from that accepted output.
An existing cycle number, field substitution, stale inventory or legacy answer
cannot authorize the new occurrence. Refusal, deferral and cancellation carry
no selected cycle or positive facts. V1/v2 and inbox v7/v8 remain readable without
conversion. Ordinary admission, continuity, plan freeze, DoR and IMPLEMENTING
remain mandatory. The PR correction authority requires a new corrective cycle;
startup selection of an existing cycle is a separate outstanding route.

The decision/inbox suite covers v3 subject/selection and cold FILES/DUAL/DB-only
reads. The real initializer suite selects `--decision-v3` separately per mode,
with accepted-operation/provider/human fixture capabilities. Source wiring and
these components do not establish repeated correction, the full C2 journey,
genuine human/native/provider/OS, configured PostgreSQL or exact installed
archive behavior. The qualification record separates terminal component results
from pending business journeys.

Mode analysis continuation adds closed private review/question/human source,
observation and decision-output v1 contracts and `process-decision-inbox.v10`.
A report observation preserves its original evaluation; an authenticated human
continuation requests a new occurrence without positive analysis or effect facts.
Historical inbox v1-v9 and mode evaluation v1 keep their meaning. These records
reuse the operation/native-result/decision-inbox authorities from ADR-0025;
they introduce no public JSON command or automatic migration.
