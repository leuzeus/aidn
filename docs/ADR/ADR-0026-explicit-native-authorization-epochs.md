# ADR-0026 - Explicit native authorization epochs

## Original-operation return recovery, 2026-11-05

The internal operation host writes a signed `process-dispatch-record.v1` before
each deterministic callback. It retains the exact original intent, preview,
scope/runtime and operation owner hash, an OS-observed process creation identity,
and each local artifact owner's token plus bigint file identity. Local owner
declarations precede the callback; successful ordinary release is recorded after
unlink. A separately signed return retains the original output and context.
No historical journal, grant, counter, deadline, receipt or failure is converted.

`prepareOperationDisposition` is read-only and binds the exact current prefix,
inventory, runtime, authority, original journal/dispatch record and resource-fence
revision. Implementation-owned profiles currently observe read-only reload and
session admissions, plus the finite session report postimages. They never
re-evaluate an old operation under changed inputs. An unavailable return,
changed context, unsupported resource profile or retained owner stays UNKNOWN.
The artifact postimage profile also checks canonical metadata and required visible
projection bytes. Its positive qualification remains separate from read-only
return recovery.

Explicit application requires a separately composed `dispositionSource` with
bounded authorize/verify methods. The ordinary effect authorizer is never a
fallback. Fresh versioned requests carry nonces and exact subjects; grants bind
the request, principal, evidence and a maximum one-minute lifetime. Source
verification is followed by current fences. Fixture sources do not authenticate
real humans. No JSON-selected verifier or closure callback is accepted.

A canonical `local-artifact-resource-fence.v1` serializes managed artifact owners
and disposition/receipt acceptance. Normal owners check their exact fence before
CAS. A new disposition CAS acquires the prepared fence revision before final
postimage observations. A signed disposition attempt, including that held fence,
precedes the journal result. A lost journal append resumes with a fresh signed
plan/grant and preserves all earlier attempts. Receipt acceptance holds the same
fence through the common service's canonical event CAS; its reservation precedes
fresh authorization and is retained. The exact original output can be delivered
again without another business callback or journal write.

After the awaited disposition grant, acquisition compares the exact prepared
fence revision first. The complete current subject is then freshly reobserved
under that fence before any disposition audit or journal-result write. There is
no duplicate full scan immediately before that synchronous acquisition and no
cached inventory, admission or verdict. A changed subject fails and releases
only the newly acquired bookkeeping lease. The later post-audit observation,
fresh grant checks, acceptance fence and canonical CAS remain required.

Only an abandoned **disposition/acceptance** fence authenticated in that operation's
signed audit can transfer by CAS after an OS-observed creation identity proves
the former process terminated. This closes only that bounded local bookkeeping
critical section. It proves neither descendant nor Native/provider/H closure.
Normal abandoned artifact fences and old v1 locks remain unresolved. The
reconciler never unlinks an old effects.lock, deletes artifacts/branches/PRs,
refunds budgets, creates COMPLETED for an unknown or admits another native epoch.

This is a partial executable disposition protocol, not complete all-resource
reconciliation or new workflow admission. Native, H/control allocation discovery
and closure, Git/provider effects and unmanaged writers still require their real
adapters and shared fences. Crash fixtures use actual new Node processes and
termination; their model and consent source remain fixtures. Full published
STANDARD, L1-L8/A1-A10, the required 193 cases, genuine Native/H/provider and the
exact installed package remain separate unfinished obligations.


## Retained-resource inventory foundation, 2026-11-05

The common operation/mixed host exposes the internal read-only
`prepareReconciliationInventory` port. Canonical artifact enumeration discovers
journals staged before their intent event, inbox captures reserved before
delivery, every retained receipt and Native allocation, and local effect owners
and unreferenced evidence. DB modes use canonical content and metadata from one
list statement per observation; visible projections remain non-authoritative.
Exact scope/model/prefix/binding/input/grant links and host MACs are checked.
Physical file identities use bigint stats, exact decimal identifiers, bounded
numeric size/mode/link counts and before/opened/after identity checks.
Two unchanged observations detect drift; they are not an atomic multi-store
snapshot, a CAS fence, anti-rollback storage or independent external discovery.
Future disposition must revalidate versions and acquire its own fence.

`process-reconciliation-inventory.v1` retains record hashes and accounting
minima without changing the original grants, limits, deadlines or results.
Unknown allocations keep unknown accounting even when a debit minimum is known.
All seven discovery domains (deterministic, Native, human, control, process, Git
and provider) still require independent observations. A signed inventory, an
owner PID/UUID or a closed Native tree proves neither all-resource closure nor
absence of a business effect. This port cannot release an owner, append a result,
grant admission, renew authority or rerun an operation. Missing/changed records
and unsupported/truncated local inventories fail without a partial success.
General disposition and actual crash/concurrent recovery remain required.
This foundation does not complete L4 or the standard workflow plan.

## Status

Implemented in source as an internal allocation/host capability. Offline
fixtures exercise signed journals, real canonical stores and the common IR
with doubled approval, native transport and process control. Genuine human,
provider and all-resource termination qualification remains required. This
decision does not complete the standard workflow plan.

## Decision

Keep `native-allocation-journal.v1` and its original ceilings unchanged. A
separate explicit activation can create `native-allocation-journal.v2` only
after every prior allocation is closed with known accounting and authenticated
checkpoints. V2 retains the complete signed original v1 journal, the original
authorization, every allocation, and an ordered history of requests and grants.
Reading a v1 record never activates or converts it. Process models, instances,
events, results and native checkpoint formats retain their existing versions.

`prepareAuthorizationEpoch` is read-only. Its signed, five-minute request binds
a fresh nonce, the exact journal, current instance/product, model, scope,
configuration, cumulative response/storage debits and complete retained resource
inventory. The inventory covers each allocation owner/closure/checkpoint and
every distinct native session identity across those checkpoints.

`activateAuthorizationEpoch` requires explicit write intent and a host-composed
source outside authored configuration. That source independently authenticates
fresh explicit approval and closure of **all** resources, including discovery of
resources outside the retained inventory. It must verify actual native/provider
session and process-tree termination, rather than treating a PID absence, a
signed JSON assertion or an `approved` boolean as proof. Its returned grant and
closure bind the complete request and inventory; every listed resource has a
closed observation and evidence reference, and the source confirms zero active
resources. The host requires a closure no older than one minute, verifies the
source result, reobserves the exact current prefix after asynchronous calls,
and activates through canonical CAS. The mixed host serializes activation with
its existing local effect owner. No default source fabricates approval or
closure. Fixture evidence remains explicitly marked `fixture`.

The new grant declares its own bounded deadline and **cumulative** response and
storage ceilings. Each worker receives those ceilings minus every prior debit,
including earlier epochs. Original authorization, counters and deadlines are
never reset or extended in place. An unused epoch may expire and be superseded
at the same next allocation generation; it remains readable, with unchanged
accounting. Repeated observation returns its actual active, expired, superseded
or resource-unresolved status and the current allocation phase.

The existing worker admission authenticates the v2 reservation and checkpoint;
the mixed host still selects deterministic/native work from the common reducer.
Activation allocates no native resource and does not add a routing engine or
turn deterministic operations and waits into model calls. Failed or unresolved
allocations remain blocked. Resource closure is not evidence that an old effect
was absent. New authority never retries uncertain or confirmed business effects,
changes an accepted result, bypasses cycle admission/DoR/IMPLEMENTING or supplies
Git, provider or merge permission. Such reconciliation remains separate.

Epochs are retained parts of the governed `native_allocation_journal` concept,
using existing artifact CAS, projections and configured persistence. There is
no new SQL table, shared synchronization or implicit db-only export. PostgreSQL
remains optional; configured PostgreSQL never falls back to files or SQLite.
The direct implementation pin includes every new module and contract.

## Limits and validation

The focused `--native-epoch-mode=files|dual|db-only` execution fixtures cover
actual allocation/worker ports, retained original history, current-state refusal,
incomplete/foreign closure, missing/unverified/reused consent, exact grant and
cumulative accounting, unused epoch expiry, cold reads and exact IR simulation.
The FILES variant also exercises the mixed host across deterministic work,
an external wait and resumed native work. Native/provider/approval identities
and process-tree control in these checks are doubles.

An expired unused initial authorization has a separate explicit entry route.
The v2 request binds an empty allocation prefix, original authorization, exact
current instance/product/configuration and a `native_scope` inventory member.
The same out-of-band source must authenticate fresh consent and discover and
close every resource in that scope, including resources absent from an inventory.
No allocation, PID absence or signed claim can stand in for that source.
Activation CAS-creates a v3 journal with the original authorization, signed
request/grant history, zero allocations and a null original journal. It does
not fabricate a v1 journal or claim a previously persisted origin. Subsequent
unused epochs retain the same next generation; all allocations then subtract
the complete cumulative debits as before. Current instance/authority is
reobserved after asynchronous verification before the same canonical CAS.
Reads preserve v1/v2 and never create or migrate the initial route. A first
allocation requires the exact latest authenticated grant through the existing
worker and common reducer. Native generation count remains bounded to 32. Failed/unknown
allocation reconciliation, retained uncertain effect owners, admitted correction
cycles and genuine native/human/provider/installed-archive acceptance remain
separate requirements. Reverting new selection must retain both journal readers
and every existing epoch; it must not restore an older authority pointer.
