# ADR-0021 — Sequential agent reuse decision

## Status

Implemented as an opt-in source decision with offline fixture verification.
Normal delivery review and native adoption require their own evidence. No native
host authority, installed activation, persistent agent pool or performance claim.

## Context

Workflow roles describe responsibilities. AgentAdapter profiles run commands;
their IDs are not physical agent, session or contributor identities. A role
transition does not establish independent review or revoke effective rights.
ADR-0014 separately requires a fresh executor object per supervised attempt.

## Decision

Sequential dispatch composition accepts explicit `assignmentRequest` and
`assignmentAuthority` dependencies. Without a request, existing CLI callers
retain behavior/output. No new flag, configuration file, authority discovery,
automatic inventory or installed activation is introduced.

`sequential-agent-reuse.v1` prefers the current eligible execution, otherwise
recommends a separate eligible execution, otherwise waits. Separation and wait
clear executable steps; neither creates/resumes an agent. This decision never
grants write admission or native qualification. Same-role continuation is not a
new transition; role changes retain the existing mode transition policy.

The closed internal request `agent-reuse-request.v1` binds activity, canonical
scope, revision, artifact/criteria SHA-256, assurance profile, mode, role/action,
required/allowed permissions, allowed context-unit fingerprints and reviewed
contributor agent/lineage pairs. Independent review must be explicit, not inferred
from the role name. Context and contributor data are not discarded on a role change.

The authority's read-only `observe` method returns `agent-reuse-observation.v1`:
request fingerprint, scope/revision/profile pins, observation identity/validity,
current execution ID, candidates and retained evidence refs. Each candidate has
execution, agent, lineage, session and adapter IDs, active role/action, effective
permissions, context fingerprints, observed guarantees and retained contributions.
Unknown identity/provenance/history cannot be replaced with a new label or empty
assertions: a provider must refuse incomplete source observations.

The separate read-only `verify` operation authenticates evidence and current
state, returning `outcome: verified` bound to the request SHA-256, observation
SHA-256 and authority ID. A bare verified boolean, authored JSON or content hash
is insufficient. This is a trusted composition dependency, never loaded from an
author-provided module/attestation file by this feature. It must verify canonical
criteria/profile, full contributor history, effective tool/data rights and
context provenance, and retain immutable source observations. No production
provider is supplied or inferred here; missing evidence waits.

Authority reads share a timeout (default 1 second, maximum 5) and AbortSignal.
Observation validity may cover at most 10 seconds and is rechecked after
authentication; stale/future data refuses. These bounds do not extend workflow
deadlines. Providers must be read-only and honor cancellation. Exceptions retain
bounded reason codes, never raw sensitive diagnostics.

Effective permissions must cover requirements without exceeding the ceiling.
The policy never combines old/new rights or treats guidance as revocation.
Required isolation must be observed. Independent review additionally requires
context isolation, protected verdict authority and exclusion by agent, lineage
and any retained contribution to the reviewed scope, including older revisions.
Separate candidates satisfy the same constraints. No LPAC or Windows setup is
implicitly required/performed; an unavailable mandatory guarantee waits.

The planner evaluates this decision before adapter selection. Reuse retains the
observed execution's eligible adapter rather than preferring a specialist score;
explicit selection, roster disabling and health remain binding. Before every
explicitly executed command, the full plan and authority observation are refreshed.
Changed authority/execution identities, revision/role/scope, existing workflow gates or loss of
eligibility stop before that command. Existing pre-write admission is separate.

`phase: verdict` requires the original execution identity and re-evaluates
contributions and pins. It cannot substitute another reviewer for an existing
verdict. This does not introduce/replace a review-acceptance subsystem: a future
consumer must still protect/authenticate the actual verdict and bind its request
and revision. No profile is silently downgraded.

## Evidence and information boundary

Optional `execution_assignment` and executed `assignment_checks` expose bounded
identities, reason codes, request/observation/contribution fingerprints and
evidence refs. No context bodies, credentials or reasoning are included. The
initial decision and all command checks survive a later refusal in the existing
coordination log/history, with unchanged write/sync intent and source-of-truth
rules. This is subsumed by coordination records, not a new persistent registry,
database concept, migration or independent authority. A projection is not proof.

## Verification and rollback

Offline fixtures cover reuse and the real sequential consumers, separation,
contributor/lineage/context/rights exclusions, stale scope/revision/criteria,
missing authority, timeout, verdict/step revalidation, JSON contracts, partial
evidence and legacy behavior. No native identity, OS confinement, installed
profile or tokens/latency benefit is qualified.

The targeted source verification on 2026-10-27 uses
`node tools/perf/verify-agent-reuse-fixtures.mjs`: policy/authority cases, both
public nested contracts, a higher scoring specialist, fresh temporary dispatch
corpora, identity/authority substitution and an interruption after one successful
step. Command execution is a no-process adapter; recorded execution identities
are test observations. Each stopped case retains the first refusal and the
initial/step observations; fixture cleanup must succeed. Existing sequential
planner/execute suites, selection/transition policies and result assembly are
the regression set. Source-of-truth, metadata, governance-completeness, CLI
surface/effect, shared-boundary and documentation-reference checks cover the
affected authorities. The working-diff route is ASSURED; route classification
does not establish the full CI Governance Admission rollup or delivery readiness.

An early fixture run failed the schema namespace check; the internal contract
now uses the existing `agent-execution` validator profile. A subsequent partial
execution test reused a prior case's stopped coordination history and hit the
real escalation gate before its injected second-step failure. Separate temporary
corpora fix that test interference without weakening the escalation gate. These
fixture failures are not native or product performance measurements.

Rollback: stop supplying the opt-in dependencies and retain records, without
bypassing required review/isolation. ADR-0014 executor-instance checks, native
task lifecycle/sandbox, existing admissions and closed audit validations remain
unchanged. No installed client/plugin, old proof or Windows state is modified.

## Gate integration follow-up

Independent review of `4ba1821` returned REQUEST_CHANGES: the new coordination
invocation was not included in the closed context-resilience coverage authority.
The complete offline catalog verifier reproduced exit 1 with two ordered-coverage
errors and two failed positive probes. That review and the initial commit remain
historical evidence; the later correction does not replace their results.

The correction keeps the 43 historical invocation literals, argv and order
unchanged. A separate frozen addition declares the agent-reuse verifier at the
start of coordination. Each group and the manual wrapper are still compared to
an exact ordered list: 43 historical invocations plus this one addition. Routing,
required obligations, wrapper ordering, duplicate-gate and npm lifecycle rules
retain their previous checks. No package script or gate obligation is removed.

The complete offline catalog verifier passes after this correction, including
the original positive/negative checks, equivalent nested invocation of the new
verifier, rejection of its omission/duplication/argv/position changes and removal
or duplication of each of the 44 invocations. The 34 agent-reuse assertions and
documentation-reference checks also pass; the checks leave the checkout
unchanged. These are source and fixture results, not an independent acceptance
verdict, full CI admission, native qualification or installed activation.
