# Standard workflow IR traceability

The target is AIDN's complete standard session/cycle/work/review/PR workflow,
authored in JSON IR and executed, resumed, replayed and simulated by the common
engine. BPMN is an optional authoring/compiler path. The historical shadow
definition supplies comparison evidence and does not become runtime authority.

The first distributed model is a **fresh-session startup component**. A separate
cycle scaffold component is described below:

- [IR model](../../package/catalogs/process-models/aidn-standard-startup.v1.json)
- [versioned catalog](../../package/catalogs/standard-workflow-startup.v1.json)
- [composition](../../src/application/runtime/standard-workflow-startup-composition.mjs)

It does not deliver the complete standard workflow or replace ordinary workflow
selection. It assumes a fresh session is allowed by the real admission and starts
with an explicitly UNKNOWN mode. A resume, cycle choice or failed admission
cannot turn into a second session creation. The business ports refuse that effect.

## Startup component

The JSON sequence is authoritative for this component's routing. The host
resolves fixed binding identities; the catalog cannot choose a module, shell,
SQL command, key or verifier. Real-port fixtures load this distributed JSON and
select the next occurrence from the reducer cursor instead of building a second
startup sequence in test code.

| IR activity | SPEC intent | Skill | Actual realization |
| --- | --- | --- | --- |
| `context_reload` | R01/R11 canonical context before session actions | `context-reload` | `standard-workflow-operations.mjs.reload`: complete required documents and real `runReloadCheckUseCase`, read-only |
| `session_admit` | R01/R04 fresh admission, no permission from a preview | `start-session` | `preWriteAdmit` and `runStartSessionAdmitUseCase` |
| `session_initialize` | R01/R07 fresh session and continuity | `start-session` | pinned template/preview, actual Git branch and canonical artifact CAS, observed postconditions |
| `mode_decision` | R01/R02 explicit operator choice | `start-session` | trusted source read/verify, durable deduplicated inbox; no model allocation while waiting |
| `session_mode_apply` | R01/R02 acknowledged mode applied under admission | `start-session` | authenticated accepted decision, separate effect grant, canonical session/current-state updates |
| `session_start_finalize` | R01/R04/R11 actual hook and checkpoint results | `start-session` | `runSkillHookUseCase` and fixed `start-session-hook.mjs`; nested gate and required evidence checked |

Session initialization is a skill component before mode acknowledgement; hook
finalization follows acknowledgement/application. The catalog does not claim that
COMMITTING's subsequent branch/cycle audit or DoR has occurred. Those activities
remain explicitly outside this component, as do work and session closure.

The catalog pins the canonical JSON model hash, each exact binding, packaged
[SPEC](../SPEC.md) bytes and skill-source bytes. Code binding hashes cover the
listed direct implementation modules/schemas, not the entire transitive package.
Project rules and admissions are still read through the actual application ports.
Neither these hashes nor a catalog grant authorization or authenticate a human.

The source descriptor enters host scope and each signed operation snapshot. Its
catalog/model/SPEC/skill identities remain available with the operation journal;
the instance embeds the exact model. A generic host without that provenance
cannot adopt the same instance merely by presenting the same graph and key.

Runtime loading refuses stale bindings or changed authorities. The internal
`tools/verify/refresh-standard-startup-bindings.mjs` is read-only by default.
An explicit `--write` refreshes implementation hashes and creates a new model and
catalog revision; it does not regenerate the graph, rewrite old instances or
accept changed SPEC, skill bytes, effect classes or contracts automatically.
Those changes require a reviewed source edit. A partial source update fails
loading; it never triggers runtime repair.

## Remaining standard integration

| Required path | Current status |
| --- | --- |
| Existing session/cycle resume, carryover and cycle selection | Not delivered by the startup model |
| Cycle creation, continuity, branch audit and DoR | R1/R2 scaffold JSON and business ports exist; checkpoint/DoR ports have offline evidence. R3, cycle choice and the full model remain |
| THINKING/EXPLORING/COMMITTING work, retained exploration | Frozen COMMITTING task/work/validation/progression ports have offline mixed-host evidence. Other mode branches and full-model assembly remain |
| Drift, incidents, validation and independent review | Drift/recovery and deterministic validation have ports; incident/review/audit completion and full-model branches remain |
| Cycle close, optional promotion, open-cycle resolution and session close | Remaining standard control and observed effects |
| PR submission, authenticated review/check events, corrections, merge and sync | Remaining provider adapters and durable mixed resume |
| Full standard JSON/catalog, ordinary CLI/console entrypoints | Not replaced by this startup component |

## Evidence boundary

The model suite validates published assets, changed authority/binding refusals,
source provenance and explicit revision refresh. The mode suite executes this
published component through actual files/SQLite/Git/hook ports. THINKING startup
succeeds on the files/dual corpus. The legacy db-only corpus has an inferred open
cycle without a defined goal: its nested gate warns despite outer hook success;
the host retains WAITING/unknown instead of declaring startup complete. A fourth
scenario installs an empty coherent db-only project through the real source
installer and reaches completed startup through the same published JSON. Only
Codex discovery/login is stubbed during fixture installation; human/grant
capabilities remain fixture authorities.

Human identity and effect grants in these suites are fixture capabilities.
Package topology proves assets are included; working-directory independence
proves package-relative resolution. Neither is execution from an exact installed
archive. Full A1–A10, native human/Codex/provider
execution, live PostgreSQL and exact archive qualification remain required.


## Cycle scaffold component

A second, separate package component is distributed in
`package/catalogs/process-models/aidn-standard-cycle-create.v1.json`, with catalog
`package/catalogs/standard-workflow-cycle-create.v1.json` and fixed loader
`standard-workflow-cycle-composition.mjs`. Its five operation occurrences invoke
four bindings through the same operation host, journal, service and reducer:

| Occurrence | Actual port and effect | Result and limitation |
| --- | --- | --- |
| `refresh_before` | Existing runtime projector, canonical RUNTIME-STATE CAS and required projection; explicit grant | Observed canonical repair/freshness, not a fabricated admission |
| `admit` | Real pre-write and continuity admissions; read-only | Dirty business work, uncertain continuity and unsupported modes remain blocked |
| `initialize` | Eight pinned cycle templates, real Git branch, eleven artifact CAS writes | OPEN/NOT_READY status, session linkage, snapshot and CURRENT-STATE; no product permission |
| `audit` | Real branch-cycle audit and canonical ownership checks; read-only | Unique session/cycle/branch mapping, separately observed DoR |
| `refresh_after` | Same projector binding after cycle registration | Runtime digest now reflects the registered cycle |

Session identity, selected mode and exact cycle parameters are preconditions.
Only inferred, currently admitted R1/R2 continuity is implemented; R3 and human
cycle selection remain explicit remaining activities. Grants authorize the exact
signed preview. They do not replace admission, infer a human answer or set READY.
The default empty native write scope is preserved. A completed scaffold component
is not completion of the `cycle-create` skill, DoR, work or the standard workflow.

The offline cycle suite loads this JSON, retains a real dirty-work admission
wait, then resumes after an explicit external Git checkpoint. A new Node process
accepts the creation receipt without repeating effects. Files, dual and db-only
use their actual canonical stores; native patch admission must deny product work
in OPEN/NOT_READY. The same event history is replayed/simulated with the common
reducer. Human identity/effect grants and installer Codex discovery are fixture
capabilities; native and exact installed-archive execution remain unqualified.

The existing owned `.gitignore.append` install asset excludes the local runtime
index/database, effect-owner directory, structured instances, operation journals
and decision inbox. These remain durable canonical/control data in their chosen
store, not disposable caches. Model definitions, session/cycle artifacts and
product files remain subject to Git hygiene. No tracked file is automatically
untracked or migrated. Existing tracked runtime records require explicit tracking
reconciliation. The actual Git-clean admission is unchanged.

The explicit source refresh tool accepts `--cycle-create` for the fixed second
component; runtime loading still refuses stale sources. No component factory is
yet wired as the ordinary complete standard workflow.


## Durable control delivery

`standard-workflow-operation-host.mjs` optionally composes a trusted control
source with the common service/reducer. `standard-workflow-control-inbox.mjs`
verifies typed request/source records and persists a signed canonical capture
before delivery, acknowledgement afterwards. Scope includes instance/revision,
model, occurrence/correlation, allowed event keys, branch/head and context hash.
The operation/control histories authenticate after reopening; accepted events
and prior business operations are not re-executed. A provider identity cannot be
reused for a second request. Missing sources wait without model calls or polling.

The six record namespaces include the new private `control-inbox` and retain
canonical bulk-projection protection. Required derived projections may be
repaired explicitly, never substituted for canonical authority. This is not yet
the GitHub adapter, native human channel, R05 realization or mixed native resume.
A source event only selects its declared IR branch; downstream business admission
and explicit effect grants remain necessary.

## Available work and verification ports

These are fixed application/native components of the mixed host. Their two-task
loop is currently authored in the executable fixture corpus. It is not another
distributed standard model and does not replace the remaining full JSON graph
or its ordinary CLI/console entrypoints.

| Activity/port | SPEC and skill component | Actual realization |
| --- | --- | --- |
| `cycle_implementation_enter` | R03/R04, `start-session` admission | Fresh authenticated DoR, explicit grant and two canonical updates establish IMPLEMENTING/READY with frozen scope |
| `cycle_task_select` | R03/R04, `start-session` context | Ordered cursor from the approved typed proposal, signed accepted progress and exact current context; no model or write |
| Typed selected-task native activity | R03/R04, scoped implementation | Fixed native adapter, durable allocation, v2 activity data link and specific patch admission; report binds the selected task |
| `cycle_task_work_evaluate` | R03/R04, observed work | Authenticated native result/context and actual before/after file observations; an explicit no-change still requires checks |
| `cycle_validation_execute` | R04 validation | Pinned host check profile, bounded immutable snapshot and execution boundary; final task selects every planned cycle test, without a model call |
| `cycle_task_advance` | R03/R04, `start-session` admission | Current task checks passed, reviewed grant and metadata-preserving CAS of plan/status/CURRENT-STATE; unchanged frozen scope; uncertainty retains its owner |
| `cycle_validation_evaluate` | R04/R07, `cycle-close` evidence consumption | Reauthenticated physical manifest/logs/snapshot and exact code; explicit accepted progress bridges owned metadata changes, without rerunning effects |
| `cycle_verification_enter` | R04/R07, `cycle-close` phase component | Fresh accepted evidence and all task work observed; actual admission/grant and four canonical updates enter VERIFYING with audit pending |

Work observation does not authenticate a per-file writer or prove semantic
acceptance. Failed/unavailable checks, unresolved audit and human decisions are
not converted into DONE. These operations do not finalize `cycle-close`, promote
baseline, merge code or finish a session. Historical contracts/readers remain
separate; checked task text is interpreted as progress only with its versioned
marker and the process host also requires the authenticated progress chain.

The [task qualification record](../qualification/agentic-process/task-progression-2026-11-02.json)
separates actual offline ports, fixture transports, source-package inclusion and
remaining native/installed-archive proof. The complete standard model and A1–A10
acceptance remain required.


The offline-qualified audit tranche adds read-only source selection and typed native
audit evaluation after VERIFYING. Its bridge reauthenticates final machine checks
and scoped canonical documents. A complete global inventory precedes the audit
namespace fingerprint; ordered chunks preserve whole documents. Component checks
do not prove the full application path. Human decisions, approved closure and
its hook remain unimplemented in this tranche; they are not supplied by favorable
report fields or by changing a reference definition's markers.

The [audit qualification record](../qualification/agentic-process/cycle-audit-2026-11-02.json) records both offline application paths through the actual local ports and exact simulation. Native transport/grants/boundary remain fixtures; actual native and installed-archive evidence remain NOT_RUN. This is not full standard workflow qualification.

| Closure component | Authority and binding | Status and proof boundary |
| --- | --- | --- |
| Human closure review | R04/R07, `cycle-close`, `cycle_closure_decision` | Fresh accepted audit through a fixed host reader; typed question and human-source verification; component checks use a fixture audit authority |
| Durable human capture | Process decision inbox v3 | Actual files/SQLite adapter, HMAC, cold restart and preserved v1/v2 readers; human verifier remains a fixture |
| Canonical cycle closure | R07, fresh effect authorization | Still required; a selected disposition does not implement its writes or postconditions |
| Final closure hook | R07, real skill hook/checkpoint | Still required; warnings, refusal and drift-check retry must remain visible |


The [human closure qualification](../qualification/agentic-process/cycle-human-closure-2026-11-03.json)
adds both actual offline mixed-host component paths, with a cold acceptance and
exact reducer replay. Its provider/grant/native boundaries remain fixtures.
Canonical terminal writes and the final hook are separate pending integrations;
authenticated human disposition alone never establishes their success.


The [canonical promotion admission prerequisite](../qualification/agentic-process/promotion-admission-2026-11-03.json)
qualifies actual SQLite and configured PostgreSQL-adapter observations, with
fixture PostgreSQL transport. Current focus, selected cycle and trace/gap/usage
evidence come from one snapshot; refusal preserves canonical SQLite against
post-hook import. It supplies no promotion decision, baseline mutation, final
checkpoint completion or standard IR binding.

Promotion pre-write now calls the canonical selected-DONE-cycle admission rather
than requiring a released cycle to remain active or re-enter implementation DoR.
The existing activation/runtime/source-of-truth gates remain; target traceability,
open-gap and usage checks apply to the selected cycle. The required promotion
suite covers the actual port/public CLI in files/dual/DB-only and fileless DB
reads. See [promotion pre-write evidence](../qualification/agentic-process/promotion-prewrite-2026-11-03.json).
This is admission only: the promotion human decision, baseline mutation binding,
final hook and complete standard IR route still require their own qualification.

The [baseline-record component](../qualification/agentic-process/baseline-record-component-2026-11-03.json)
provides a private five-document deterministic writer and closed schemas with
source-installed physical-store tests. Human request/close authority is a fixture
capability. The later request tranche wires fixed host bindings and the signed
inbox; their common-cursor use after actual closure, the final hook and full
standard-model replay/simulation remain required. Confirmed baseline
record keeps promotion completion false.

The [GitHub observation prerequisite](../qualification/agentic-process/github-pr-observation-2026-11-03.json)
adds actual remote review-state acquisition with bounded complete pagination and
head/identity checks. Its successful response provides observations, not merge
permission. Authenticated durable external delivery, triage decisions and the
standard PR model route remain required. Actual network reads, fixture transport,
native and installed-archive proof remain separately identified.

| Terminal record component | Authority and binding | Proof boundary |
| --- | --- | --- |
| Six canonical closure artifacts | R04/R07, `cycle-close`, deterministic `cycle_close_record` | Actual source-install/CAS/projection component; common files/DB-only path with authenticated human fixture transport passed on exact snapshots |
| Completed cycle-close skill | Deterministic cycle_close_finalize, actual correlated hook and three completion CAS | Source component and retained common-host continuation qualified on distinct exact snapshots; full IR Git/reload/R05 route and interrupted suffix reconciliation still required |
| Earlier-phase and other-mode exits | Current SPEC plus explicit decisions | Still required in the complete standard IR; the COMMITTING/VERIFYING component is not a general abort path |

The promotion request tranche adds fixed human baseline_promotion_decision and
deterministic baseline_promotion_record bindings (SPEC-R04/R07). Inbox v4,
actual signer/canonical stores and read-only baseline review have component
proofs. The accepted-journal/closure capability remains a fixture in reader
checks; full common-cursor use after actual closure and the final promotion hook
remain unqualified. See [bounded promotion proof](../qualification/agentic-process/baseline-request-bindings-2026-11-03.json).
not_requested is a recorded choice, never promotion completion or a rule waiver.

| Final promotion component | Authority/operation | Proof boundary |
| --- | --- | --- |
| Confirmed baseline checkpoint | SPEC-R04/R05/R07/R11, deterministic baseline_promotion_finalize | Real selected-target shared checkpoint, physical event and five completion CAS on source clients; human/close authority fixture |
| Append-only promotion history | Accepted pending record plus confirmed event | Prior bytes and pending entry retained, separate confirmation appended; uncertain effects cannot repeat the checkpoint |
| Full standard route | Distributed IR, common cursor and ordinary entrypoints | Still required with replay/simulation, durable external waits and native/exact archive proof |


## Composed standard IR: partial source, not full workflow qualification

The [standard model](../../package/catalogs/process-models/aidn-standard.v1.json)
and its [catalog](../../package/catalogs/standard-workflow.v1.json) now compose
69 nodes and 40 operation occurrences through the existing reducer and
[application loader](../../src/application/runtime/standard-workflow-composition.mjs).
The catalog pins real bindings, SPEC and skills and declares typed native reports.
Its closed contract still requires `complete_standard_workflow: false`.
It does not replace ordinary workflow selection.

| Composed IR nodes | Current realization | Remaining qualification |
| --- | --- | --- |
| `startup`, `mode_route` | Existing six startup bindings and authenticated mode facts | Startup prefix only; THINKING/EXPLORING work remains open |
| `cycle_create`, `plan`, `plan_evaluate`, `plan_record`, `readiness`, `implementation_enter` | Real cycle ports, native plan proposal, canonical plan CAS and admission | Files composed prefix PASS with fake wire; other stores/native remain |
| `task_loop`, `task_iteration`, `final_verification` | Common loop reducer and real task/validation/progress ports | One-task files path PASS with fake wire and fixture verification boundary; multi-task, other stores, work drift and incidents remain |
| `audit_select`, `audit_review`, `audit_evaluate` | Selected scoped audit and authenticated evaluation | Files composed prefix PASS; real native/other stores remain |
| `closure_decide`, `close_record`, `close_finalize` | Authenticated decision, six terminal CAS, actual checkpoint ports | Human wait, refusal/resume and closure through the same composed cursor remain |
| `promotion_decide`, `promotion_route`, `promotion_record`, `promotion_finalize` | Authenticated promotion request, real five CAS and checkpoint | Same composed cursor after actual closure |

The empty `promotion_not_requested` branch carries no baseline completion fact.
Empty v2 structural sequences require no dummy reload or model call. Unknown
conditions, refusals, deferred/cancelled decisions and uncertain effects retain
their existing reducer and authorization semantics; historical v1 remains intact.
R05/R10 routing, existing-cycle/session resume, R07 session closure, R08 PR
review/merge and R09 post-merge sync remain explicit missing activities. Native
and exact installed-archive qualification remain separate requirements.


The [recorded prefix proof](../qualification/agentic-process/standard-composition-prefix-2026-11-03.json)
passes nine checks each for files, dual and DB-only on its exact frozen snapshot:
six real business bindings, an authenticated fixture human defer/resume, signed
result acceptance in a new process, retained redispatch, and exact replay/simulation.
It uses the source installer with a Codex discovery stub. It does not execute
the declared native activities or the composed COMMITTING cycle route, and does
not qualify ordinary entrypoints, a native host or an exact installed archive.


## R05 preflight and observed Git gap

The current model revision 7 declares 68 nodes, 39 operation occurrences and
seven native activities. A COMMITTING-only preflight runs the diagnostic,
authenticated evaluation and real R05 finalizer before `session_start_finalize`.
The same pattern is declared before cycle, closure and promotion checkpoints.
Only the startup prefix has been exercised in the
[bounded R05 proof](../qualification/agentic-process/standard-startup-r05-prefix-2026-11-03.json),
with a fake native wire and actual application ports. Its replay/simulation use
the exact published model and reducer. The host is reopened after the retained
native result in the same process; this is not general native process resume.

The earlier bounded startup probe exposed a missing governed Git checkpoint:
actual cycle admission refused the metadata changes created by startup. The
connection below now supplies that operation from the IR with a fixed host-derived
scope and explicit authorization. The clean-tree admission remains unchanged;
an external fixture commit does not substitute for an authenticated receipt.
The full COMMITTING cycle, other modes/tail, ordinary selection, actual native
host and exact installed archive remain unqualified.


## Governed Git connection in progress

`session_git_checkpoint` consumes the accepted `cycle_context_refresh` and
confirmed startup result. Its fixed application adapter authenticates canonical
session/current/runtime postimages, authorizes the concrete local Git plan and
observes the parent, commit and index. The IR inserts it before `cycle_admit`;
that clean-tree admission is preserved. The local port's ten real-Git fixture
checks are offline component evidence. The separate
[files prefix qualification](../qualification/agentic-process/standard-governed-git-prefix-2026-11-03.json)
executes 17 actual application operations and two fake-wire diagnostics through
the distributed model, reaches `plan`, and reproduces the exact instance hash
by replay/simulation. The retained cold-resume refusal remains WAITING and
proves no repeated session, governed commit or cycle creation. Uncertain-index
recovery, the full standard route, native host and installed archive remain open.

## Composed work and audit evidence

The [recorded files path](../qualification/agentic-process/standard-composed-work-audit-2026-11-03.json)
drives the same distributed JSON through 30 application operations and five
simulated native activities. Planning, admitted product work, real Node checks,
canonical task progression, VERIFYING and audit precede READY `closure_decide`.
Replay/simulation reproduce the exact instance hash. No fixture prepares a
completed plan, task or verification state outside the IR for this path.

The human/grant source, native wire and verification containment authority are
fixtures. The case ends before starting human closure, and preserves pending
closure rather than claiming a finished cycle. Its remaining acceptance includes
human refusal/wait/cold resume, closure/promotion/session/PR effects, the other
modes/stores, native reauthorization after long waits, a real native host and
boundary, and the exact installed archive. The standard catalog remains partial.
