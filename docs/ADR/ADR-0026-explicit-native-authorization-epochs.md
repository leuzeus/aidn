# ADR-0026 - Explicit native authorization epochs

## Native owner provenance candidate, 2026-11-14

The fixed mixed allocator and Native epoch activation compose their existing
local effect owner through the private standard dispatch context. A separate
closed `native-dispatch-record.v1` is retained by the existing canonical
workflow record adapter under `workflows/native-dispatches/`. It belongs to
`native_allocation_journal`; no new backend, table, shared surface or principal
is introduced. Allocation journal v1-v3 and their CAS subjects remain unchanged.

Before fence acquisition or lock creation, the signed record binds the exact
Native authorization or epoch request, current authority, scope/model/configuration,
original process creation identity and proposed owner/fence. The actual opened
lock identity is declared before the Native callback. Ordinary release retains
its lease declaration. Returned/threw records preserve the action result digest
or a bounded error code and the observed allocation-journal digests.

These observations grant no takeover, replay, admission, budget renewal or
resource cleanup. A returned dispatch and a released lock do not prove Native
session closure, absence of business effects or release of every resource.
The record always carries `permits_effects: false` and
`complete_resource_closure: false`. The read-only reconciliation inventory
authenticates its source and original instance prefix without clearing UNKNOWN.
Historical attempts lacking this original signed evidence remain unchanged.

This prerequisite still needs actual owner/crash tests, coherent implementation
authoring and the relevant composed qualification. General Native disposition,
R10 severity/verified recovery, handoff and complete L1-L8/A1-A10 remain separate.

## Exact-current disposition consent without a host age ceiling, 2026-11-11

A disposition plan binds the original operation, inventory, runtime, instance,
journal, owner and fence. Elapsed preparation age no longer invalidates that
unchanged subject. Preparation timestamps remain safe nonnegative provenance.
Every awaited authorization and later write boundary still reobserves its
current subject, verified grant, owner/fence and canonical CAS.

New local exact-action consent uses private
process-disposition-authorization-grant.v2 without a host-generated expiry.
The host authenticates its exact request, explicit permit, protected key and
current trust context on verification. An altered action, principal, request,
scope, instance or permit remains a refusal. This is separate from Native
allocation authorization and grants no resource closure or budget renewal.

Original v1 grants retain their closed shape, exact MAC and issuer expiry.
Current use still rejects future issuance or actual expiry. The generic
consumer adds no sixty-second age or maximum issuer horizon. Historical
control attempts validate either original grant shape and do not apply current
expiry to stored proof. No retained plan, grant, control record or receipt is
converted; storage and canonical authorities remain unchanged.

Focused component and real-crash fixtures must qualify old unchanged plans,
v2 consent across clock movement, legacy issuer expiry, revocation, changed
subjects and mixed-version cold readers. Published model pins require explicit
authoring. Full STANDARD, genuine actors, all-resource disposition and installed
package qualification remain separate obligations.

## Embedded calls and authority, 2026-11-06

The ADR-0022 call candidate introduces no authorization epoch, grant, owner,
resource disposition, debit refund or counter reset. Native calls remain subject
to current consent, exact source/model/scope/prefix, original cumulative budgets
and all existing exclusions for UNKNOWN. A completed call child is not a resource
closure proof. The Native target-activity profile explicitly refuses before
allocation until model-qualified instructions and output bindings are defined
and qualified. Existing FAIL/UNKNOWN evidence remains historical and unchanged.

## Normal-writer preallocation declaration candidate, 2026-11-05

New deterministic dispatches use `process-dispatch-record.v2`. Its signed bounded
local-owner intentions retain the exact proposed owner, plan hash, physical lock
path, current context hash and proposed canonical fence token with OS creation
identity before the fence CAS or lock creation. The existing dispatch links the
original intent, preview, grant, model, scope, runtime and operation owner. The
proposal grants neither a held lease nor permission to perform a business effect.
The actual lock declaration still records the opened physical identity before
the callback. Original owner release retains its declaration and released lease.
V1 remains readable; no historical dispatch is converted or retried.

Canonical inventory authenticates both dispatch versions against the original
operation and retains v2 proposals even when no lock was created. A proposal
without a matching released lease stays unresolved for original-return
disposition. No process observation, two stable scans or proposed token proves
closure. This change grants no takeover of an ordinary abandoned fence/lock,
resource deletion, refund, new admission or result for an UNKNOWN operation.
Standalone legacy writers without a signed dispatch capability, Native/H/control
reservations, process trees, Git/provider effects and general L4 remain open.

Three appended crash cases exercise the actual session-report writer before
fence acquisition, after acquisition before lock creation and after its signed
lock declaration. The trusted synchronous observation hook adds no awaited
permission boundary or authored callback. Each cold check must retain the exact
proposal/fence, unchanged business preimages, zero receipts and UNKNOWN, and must
refuse second dispatch. Exact-source qualification is pending; this is not a
productive STANDARD, external-resource closure or L1-L8/A1-A10 completion.

## Compound ordinary-host observations, 2026-11-05

An internal ordinary-host port derives its project/persistence authority and
context from one fresh activation within each synchronous boundary. Inventory
capture uses that compound subject before and after its two resource scans,
retaining canonical instance/history authentication and all three comparisons.
Dispatch declaration and original-return assessment use the same compound port;
later observations and every awaited boundary read again. The mixed host retains
its existing authority path. No JSON supplies an observation, and no observation
is stored as admission or carried across calls/awaits. Resource closure, consent,
CAS, cumulative debits, historical journals and UNKNOWN rules are unchanged.
This reduces redundant work identified in source; it makes no measured speedup
claim. Current-source real-crash, storage and loader qualification is required.
General L4 and the full L1-L8/A1-A10 objective remain incomplete.

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

Before acquisition, a private signed `process-operation-control-intent.v1`
retains the exact proposed fence token/revision and OS creation identity, plan,
current verified disposition grant, signed inventory and journal/receipt/audit
hashes. Its bounded ordered attempts use the existing operation-journal canonical
CAS/projection policy. The proposal is not a held lease. A crash before acquisition
retains only that proposal; a crash after acquisition can be matched to the exact
retained token even before the disposition audit exists. Each new attempt needs
a fresh plan and independently verified grant. The original attempts and grants
remain historical; they do not renew permission or close external resources.
An acceptance control reservation likewise precedes its acquisition and binds
the exact retained receipt/audit and current inventory/prefix. It grants no effect
authority: fresh receipt-acceptance authorization and canonical CAS still follow.
Only this operation's own control artifact is excluded from its business-subject
hash, alongside its existing audit and fence; it is separately authenticated.
The complete inventory remains retained, including receipts and debit minima.
The bounded control record refuses further allocation rather than dropping proof.

Grant lifetime, plan lifetime and cancellation are checked immediately before
the reservation write and immediately before acquisition after the awaited
reservation checkpoint. The trusted source re-verifies consent after each
critical awaited reservation/acquisition/audit checkpoint; complete synchronous
subject and lease fences still follow before audit/result writes. A retained
reservation never extends expired or revoked permission. The inventory can
return its freshly authenticated instance and signed inventory together in one
internal synchronous capture. Both original instance observations, both resource
scans and both context/authority observations remain. No capture is cached for
a later call/await; the public prepared-inventory expected-prefix check remains.

Only an abandoned **disposition/acceptance** fence authenticated in that operation's
signed audit or pre-acquisition control intention can transfer by CAS after an OS-observed creation identity proves
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
and unreferenced evidence. Review-wait reservations are unresolved resources
in their own right, including when the selected capture has yet to be written.
An accepted control event binds the exact captured delivery, its prior prefix,
the acknowledgement prefix if present, and the selected reservation where
the wait requires one. A matching reserved capture still accounts for the
interruption after event acceptance and before acknowledgement.
A human capture linked to a retained operation binds the question rebuilt
from its signed preview and intent, an offered choice and any reserved claim
on that operation. An acknowledged capture must identify the exact retained
receipt that names it. A matching reserved capture remains observable before
the operation receipt is written, without calling the human source. DB modes use canonical content and metadata from one
list statement per observation; visible projections remain non-authoritative.
Exact scope/model/prefix/binding/input/grant links and host MACs are checked.
For a reusable call, the reconstructed prefix identifies the occurrence's
model. Inventory resolves the operation node and pin within that model,
while retaining the containing instance's model and scope hashes in the
intent check.
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
When the mixed host refuses execution because the latest Native allocation
is unresolved, the two read-only reconciliation ports may authenticate the
retained prefix using diagnostic history. They still require current host
authority and bind the unresolved journal to the observed context. Reserved
and failed allocations keep their owners, phase and known debit minima.
Normal inspection for execution and preparation or application of disposition
retain the original Native exclusion.

The internal `prepareProcessOwnerObservation` port selects an exact unknown
operation by instance digest and operation ID. Two reads of the original
process creation identity bracket a new canonical inventory read. The original
dispatch and operation must be authenticated and name the same owner PID.
The signed `process-owner-observation.v1` links the inventory, operation,
dispatch and process identity digests, plus the observation interval. Missing
dispatch evidence or an unavailable local observation leaves the status
unresolved. Changed status or canonical evidence refuses the observation.

An original process can be absent after exit or PID reuse. This is evidence
about that process identity. Process-tree closure stays unobserved and the
business effect stays unknown. Native resources, external actors and provider
effects require their respective authorities. The observation performs no
write and grants no authority to release an owner, accept a result or replay.
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

The worker and both allocation readers allow up to 2 MiB for the typed
`native-host-state.v1` checkpoint envelope, including its trailing newline.
The native projection check allows up to 1 MiB for the visible instance,
matching the file-backed artifact inventory's per-artifact read limit. The
checkpoint also carries bounded executor and result inventories and response
digests, so it gets additional headroom within the reconciliation inventory's
16 MiB per-file limit. Existing structural limits and the 256 KiB generic
evidence limit still apply to their respective records. The full checkpoint
counts against the worker's remaining storage budget before the 256 KiB footer
reserve, then against cumulative allocation storage. These bounds are owned by
the implementation. Resume still verifies the exact checkpoint, protected
evidence, canonical instance and required projection under the signed journal
and supervisor closure.

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


## Native allocation assessment candidate

The internal `prepareNativeAllocationAssessment` port returns a signed, closed
`native-allocation-assessment.v1` with its exact canonical reconciliation
inventory. It selects a real Native dispatch ID and latest unresolved allocation
generation; it never substitutes an operation ID. The fixed host authenticates
historical journal, checkpoint, operation, human and control provenance using
the original model and configuration. Its diagnostic product observation uses
the existing protected snapshot reader without constructing a Native executor
for an older binding set. Normal execution and disposition retain current
binding checks and unresolved-allocation exclusion.

Two unchanged captures bind the canonical backend, instance, inventory,
journal, dispatch, checkpoint and closure bytes. A failed allocation reports
`no_assignment` only when its original signed allocator return matches, its
initial/checkpoint/dispatch prefix is identical, its checkpoint has no response,
resource or result, and both parent and owned tree closure are observed under
the original limits. Other cases retain `unknown`; changed or invalid evidence
refuses. This is an observation of that allocation, not absence of business
effects or independent discovery of every external resource.

The returned observation adds no canonical record family, store, table or
principal. Failed history, original grants, unknown accounting and retained
leases remain unchanged. All effect, resume, renewal, owner-retirement and
complete-resource-closure permissions are false. No preparation-age ceiling
is introduced. Any later disposition needs separate authority and exact fresh
owner/fence/CAS checks; any later Native execution needs its own finite grant.
Controlled component evidence and a retained historical observation do not
complete R10, abrupt crash recovery, concurrency, genuine Native, installed
archive or the STANDARD plan.


## Native owner disposition candidate

The distinct private Native owner disposition authenticates the current
no-assignment failure assessment, original dispatch/lease, exact physical lock
and original process creation identity. An active or unobserved original
creator refuses. A signed read-only plan binds the unchanged canonical
inventory material, backend, model, configuration and original fence.

Application requires exact write intent and separate current operator
authorization for `native_owner_retire`. Existing grant v1/v2 wire readers
retain issuer expiry and no host-generated preparation age. The protected
operator key and trust digest bind the reviewed action, instance, configuration
and plan; synchronous permission checks run before effects. No original
Native execution grant supplies retirement permission. H source calls retain
the existing five-second authority limit.

A closed signed `native-owner-disposition-record.v1` belongs to the existing
`native_allocation_journal` family at `workflows/native-owner-dispositions/`.
It uses the same canonical CAS/projection adapter and no new table, store or
principal. At most 32 complete attempt records are retained without truncation.
Each attempt durably names its creator and proposed fence before acquisition.
An incomplete live attempt excludes another repreneur; transfer requires its
original creation identity to be terminated. An acquired disposition fence
guards the exact original lock and preserves it at a fixed Native archive
path. The operation-specific retirement API remains unchanged.

The immutable signed physical-retirement receipt precedes final fence-release
acknowledgement. Recovery authenticates its original witness and may finish
its own fence steps without repeating a confirmed rename. Fence closure and
physical retirement stay distinct; foreign current resources still refuse.
The original Native allocation and dispatch bytes, failed phase, unknown debit
totals, original grants and all confirmed contributions remain unchanged.
No receipt authorizes a Native allocation, accounting refund, workflow resume
or complete resource closure. Unproved post-assignment effects stay unresolved.
Public entry actions, general R10/handoff, actual abrupt crash/concurrent
qualification, genuine Native and the exact installed archive remain separate
until their required executable evidence exists.

## Native allocation reconciliation reader candidate, 2026-11-14

Private journal v4 retains an exact signed v1, v2 or v3 origin, every original
allocation and epoch, and a bounded ordered reconciliation-receipt history.
Original failed phases, failures and observed consumption remain unchanged.
Its current no-assignment profile binds the exact allocation, dispatch,
checkpoint, original prefix, physical root, inventory and owner-retirement
receipt. The closed request, independently sourced closure/accounting grant
and verification are retained together. Closure must cover both the exact
allocation and its Native scope. A receipt grants no effect, workflow resume,
Native renewal or complete workflow-resource closure.

Pure readers accept known accounting only from that exact closed proof and
never reduce an original debit. They preserve earlier response/storage debits,
refuse duplicate or reordered reconciliation and reused source events, and
require a distinct authorization epoch after reconciliation before a later
allocation can validate. A backdated epoch cannot use a later reconciliation.
The v4 revision bound is 128: one origin transition plus at most 32 reservations,
32 returns, 31 authorization epochs and 32 reconciliations. Allocation count
and execution ceilings remain unchanged. V1-v3 schemas and readers retain
their historical behavior; reading never converts or writes a journal.

The reader prerequisite alone supplies no producer or execution permission.
The runtime candidate below connects independent source verification, current
state fencing and explicit writes to those readers. A host MAC alone supplies
none of the external observations; a new finite Native grant and the common
workflow/business admissions remain separate. Public entry, post-assignment
resolution and genuine resource termination are not supplied by these readers.
Pure fixture grants and closure claims are synthetic. General R10/handoff,
full STANDARD, genuine Native and installed qualification remain unfinished.

## Native no-assignment reconciliation producer candidate, 2026-11-14

The fixed operation and mixed hosts expose private prepare/apply/read ports.
Preparation is read-only and binds the current signed inventory, failed
allocation and original dispatch/checkpoint, current prefix/configuration/root
and confirmed old-owner retirement witness. Application requires exact write
intent, the request digest, a separate protected local-operator permission and
independently authenticated Native scope closure and final accounting through
the existing native-renewal principal. Neither JSON, the host MAC, a closed
checkpoint, PID absence nor an old Native grant supplies that source.

A Native allocation-journal subrecord at
`workflows/native-allocation-reconciliations/<journal>_g<generation>.json`
retains the exact signed preimage and content digest, bounded ordered attempts,
proposed v4 journals, operator grants, source verification, process-creation
identities and fence intentions/leases. Intent precedes acquisition. The
canonical v4 CAS retains the old allocation and failed phase, original
authorization/deadlines, and all earlier response/storage debits. A separately
retained commit witness precedes fence-release acknowledgement. Cold recovery
requires the exact former creator to be terminated and the fence to match a
retained intention or lease. An already committed proposal keeps its exact
receipt and is acknowledged without repeating the Native journal CAS.

Active history requires the confirmed canonical audit, exact preimage/proposal
and receipt links, and the old signed owner/dispatch plus physical archive
witness. A typed v4 receipt alone remains insufficient. A later legitimate
writer may own effects.lock; the historical check observes the retained old
archive separately. The common authority, allocator, worker history, epoch
ports and reconciliation inventory use that confirmed history. Inventory keeps
original failed consumption and reports the separately reconciled final debit.
All seven independent-discovery gaps and false global-closure/effect flags stay
explicit. Later Native execution needs a distinct finite epoch after
reconciliation and every normal business/worker admission remains required.
The epoch preserves v4 and reports the original failed phase; authorizing a
new budget does not itself allocate a Native worker.

Before recording intent, the writer projects the complete final audit, Native
journal and released fence against the existing 1 MiB artifact and 16 MiB
inventory read bounds. Unreadable history refuses before intent/CAS; no proof
is dropped, budget reset or automatic purge performed. Authority is rechecked
after observations immediately before audit writes. Preparation has no new
age ceiling; original issuer expiry and the existing five-second authority
call timeout remain. The namespace reuses the configured canonical artifact
CAS, projection and import protections and adds no backend, table or principal.

The private producer covers no assignment only. The public resource-action
extension below is separate. Post-assignment uncertain effects, general
R10/handoff, complete STANDARD, genuine Native and exact installed-archive
qualification remain separate.
Fixture source signatures and physical/CAS ports are real, while Native
closure and epoch consent are synthetic and no model is called.


## Ordinary Native resource actions candidate, 2026-11-15

The ordinary entry and console expose separate closed Native action/result v1
contracts without changing historical ordinary or call schemas. An unresolved
failed allocation can use diagnostic inspection solely to prepare resource
recovery. All normal business actions retain active admission. The current
signed inventory selects exactly one returned allocation dispatch; ambiguity,
active original ownership or an unproved no-assignment subject refuses.

The fixed composition connects protected local-operator HMAC capabilities for
physical old-owner retirement and accounting reconciliation. Exact action-file
execution/expect-plan consent supplies their scoped permit. Reconciliation and
finite epoch activation separately require the existing independently signed
Native source. Neither the MAC, an action-file nor source_ref establishes that
external closure/approval. Missing source data waits or refuses without an
allocation. Owner retirement leaves accounting unresolved. Reconciliation keeps
the original failed phase, dispatch, deadline, debit and signed origin; a later
Native generation still needs its separate finite epoch and normal admissions.

A prepared Native action retains its original request and source reference.
Acknowledgement may observe its own journal postimage: comparison excludes only
the Native journal digest, phase and aggregate consumption, while prefix,
generation, configuration/root, model/source, key and trust remain exact. The
private producer then proves the original or its own retained proposal under
its existing owner/fence/CAS protocol. This narrow comparison supplies no write
permission or ordinary business admission. An epoch replay reads the retained
activation without materializing or allocating. Resource results never mark
the whole workflow complete.

The fixed public source rechecks current signature/principal/issuer permission
after observations immediately before the epoch CAS. Physical retirement also
checks current permission after its subject observation. No new preparation
age ceiling or Native budget change is introduced. Existing finite epoch
request/grant expiry remains separate. Post-assignment resolution, general R10,
full STANDARD, genuine actors and exact installed archive remain unfinished.


### Post-assignment retained-work observation

The common host exposes a separate closed read-only post-assignment assessment.
It consumes the original signed journal/dispatch, admitted protected checkpoint
and result files, current authenticated canonical history and original supervisor
closure. It preserves cumulative prior resources, contributions, results and
debits while checking the worker closure count against this generation alone.
Ahead/divergent canonical history is refused; missing admission or incomplete
closure/accounting remains unknown. An admitted_closed_checkpoint observation
establishes no business postcondition, retirement, reconciliation, resume or Native
renewal permission. The historical no_assignment disposition/reconciliation
producers remain unchanged; a mutating post-assignment profile needs its own
explicit version, independent source verification and current effect authority.


### Explicit physical-owner profile after admitted Native work

A distinct v2 owner plan/request/record/receipt handles the admitted_post_assignment
profile. Its preparation separates initial, checkpoint and current canonical
prefixes and binds the stable signed post-assignment observation. Only a matching
failed allocator return with admitted complete work, known original consumption,
closed Native parent/tree and terminated original creator enters this first
physical-owner profile. Unknown or unadmitted work stays unresolved and requires
additional independent closure/admission or R10 recovery; it is not excluded from
the full workflow. Historical v1 no_assignment preparation remains unchanged.

The same canonical path, current exact operator permission, physical owner/fence,
preimage, durable intent, conditional writes and cold recovery protocol apply.
V2 receipts preserve the original failed allocation and accepted work and retain
false accounting/complete-closure/resume/renewal permissions. A separate explicit
resource reconciliation and independently authorized finite Native epoch remain
necessary. No preparation-age ceiling or implicit checkpoint/flag conversion is
introduced. Existing initial Native grants and current issuer/source permissions
retain their original boundaries.


### Explicit admitted-work accounting profile

The private post-assignment reconciliation producer uses distinct closed v2
request, grant, receipt and record formats. A request retains its signed
post-assignment assessment/inventory and separately binds initial, checkpoint
and current prefixes, original non-refunded consumption, protected resource
identities, all known Native sessions and the complete configured Native scope.
The fixed host requires matched failed return, admitted complete checkpoint
work, known original consumption and confirmed v2 physical-owner retirement.
Business postconditions remain unknown. Unknown or unadmitted classes are not
resolved by this first profile and remain explicit full-workflow work.

The same independent Native resource principal supplies current scope closure
and final accounting, while the protected local operator separately authorizes
the exact write. Response hashes remain an ordered observed prefix and final
storage never drops below the original debit. Current source permission is
checked after subject observation immediately before effects. No original
Native execution grant or JSON field supplies this authority.

Journal v5 retains its exact signed v1-v4 origin and inherited v4 proof prefix,
all original allocations/epochs/failures and ordered new v2 receipts. The
existing record path holds the exact original/proposed journal before CAS.
Terminated-actor cold recovery preserves the first committed receipt and
finishes only its own owner/fence/audit steps under fresh operator permission;
it does not recapture closure after the journal CAS. Canonical confirmed
history and the physical original-owner witness remain required for active
consumers. Existing artifact capacity checks refuse before further intent.

A later Native epoch is separately approved, includes its Native scope using
the existing epoch request v2 format and retains journal v5 with its consumed
responses/storage. V1-v4 schema bytes, old requests, initial authorization and
finite issuer/source boundaries stay unchanged. There is no elapsed
preparation-age ceiling, implicit conversion, refund, new allocation, business
resume or complete workflow-resource closure. Public transport, independent
genuine discovery, unknown-state recovery, R10 and installed/full-plan
qualification remain separate required work.

### Typed public transport for admitted accepted work

Public Native action/result v2 explicitly selects admitted_post_assignment and
embeds only the existing closed owner-v2 or accounting-v2 preparation. V1
actions/results retain their original bytes and scope. The fixed producer
authenticates admitted checkpoint/result history and current subject; neither
the profile nor a retained response counter grants permission. CLI and console
use the same saved-action/execute/expect-plan boundary and protected sources.
Cold application retains its original preparation and first committed receipt.

Accounting confirmation grants no business effect. A later deterministic
operation is separately admitted by the ordinary host, and any later Native
generation still needs an independently approved finite epoch through the
existing epoch action. Unknown/unadmitted histories and global resource closure
remain unresolved. No new information concept, store, shared table, migration,
preparation-age ceiling or Native budget change follows from this transport.
