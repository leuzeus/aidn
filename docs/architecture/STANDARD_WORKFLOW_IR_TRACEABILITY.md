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
| Cycle creation, R1/R2/R3 continuity, branch audit and DoR | Remaining business adapters/model branches |
| THINKING/EXPLORING/COMMITTING work, retained exploration | Remaining standard control and native work integration |
| Drift, incidents, validation and independent review | Remaining model branches and actual ports |
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
