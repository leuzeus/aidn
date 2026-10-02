# Scoped GFD Adoption

Status: accepted partial source adoption, 2026-10-02. Owner: `project_owner`.
This is a local binding and compatibility guide, not a copy of GFD or a
certification of AIDN or its clients.

## Source Declaration

The canonical declaration is
[gfd-adoption.v1.json](../package/governance/gfd-adoption.v1.json), accepted under
[ADR-0010](./ADR/ADR-0010-adaptive-repository-governance.md#gfd-adoption-amendment-2026-10-02).
It pins GFD `0.1-draft` at commit
`0eec798a5270ba6de51f31708b3dbc5b6147d9fb` and the SHA-256 of `METHOD.md`.
The [upstream method](https://github.com/leuzeus/governance-first-development/blob/0eec798a5270ba6de51f31708b3dbc5b6147d9fb/METHOD.md)
is an external reference. Ordinary configuration and workflow reads do not
fetch it. Offline consumers use the accepted local bindings, references and
hashes; a missing upstream document must not be replaced by an invented rule.

The project remains personal and agent driven. `project_owner`,
`technical_owner`, `evidence_operator`, `release_authority` and `data_owner` are
cumulative authority hats. They do not imply separate people or independent
reviews. Context must be reviewed when contributors, users, deployment,
criticality or applicable external duties change.

## Authority And Precedence

The declaration maps each effective local authority to its owner and scope.
Apply the concept-specific canonical source and validated contract before a
convenient projection. The local order is:

1. Applicable external legal, contractual, safety and security obligations,
   identified by their responsible owner; none are invented from missing data.
2. Explicit project-authority decisions within their scope. Changing an
   invariant requires a recorded decision, compatible contract change and
   relevant new evidence; an instruction cannot silently bypass a live gate.
3. Public contracts, non-negotiable invariants and canonical policies by concept.
4. The canonical project specification within its declared scope.
5. Accepted current ADRs and scoped policies consistent with those contracts.
6. Current intent, subordinate plans and operational routing instructions.
7. Informative material, examples, projections, caches and historical records.

GFD has local effect only through the accepted mapping. It does not replace the
gate catalog, runtime admissions, canonical backend or project-specific domain
contracts. A more recent file or a more similar search result cannot resolve an
authority conflict. Record both sources, their scopes, the disputed point and
the deciding authority; suspend the affected change until it is resolved.
Historical inspection can remain read-only.

## Section Mapping

The JSON declaration is the maintained section-by-section mapping. The table
below explains its responsibility split; it does not assert that every GFD
requirement has an automatic implementation. Referenced fixture `PASS` applies
to its named claim and environment only.

| GFD section | Local disposition and source control | Human responsibility / client boundary |
|---|---|---|
| 1 Context | Adapted through ADR-0010 and source route fixtures | Owner reviews real context changes; each client describes its own obligations. |
| 2 Authorities | Adapted through concept policies, contracts and registry closure | Owner decides unresolved precedence; clients bind their existing authorities. |
| 3 Intent | Adopted through operating model and adoption proposal/refusal fixtures | Owner accepts intent and non-goals; detection never accepts a rule. |
| 4 Decisions | Adapted through ADRs and explicit adoption lifecycle | Deciding authority records costly choices and replacements; no ADR per trivial occurrence. |
| 5 Contracts | Adopted through specification, public JSON contracts and source policies | Technical owner identifies domain/material checks; source tests do not certify a client's product. |
| 6 Controls | Adapted through the existing gate catalog and runner | Technical owner reviews risk, value, exceptions and costs. |
| 7 Evidence | Adapted through testing policy, exact-SHA CI and L0 baseline | Evidence operator states claim, environment, limits and invalidation trigger. |
| 7.1 Attempts | Principles adapted; runner proves zero product execution when a required prerequisite is absent | Evidence operator separates execution, gate, proof, product judgement and failure layer; general AOI schemas are deferred. |
| 8 Lifecycle | Adapted through metadata and retained adoption revision references | Data owner retains history; changed claims require materiality assessment. |
| 9 Context debt | Adapted through scoped routing and L0 byte/omission measurements | Complete-unit selection and native token qualification remain subsequent lots. |
| 10 Documents | Adapted through information model and reference checks | Owner maintains status, translations, replacements and one source per responsibility. |
| 11 Agents | Adopted through bounded instructions and no-implicit-write fixtures | Human scope and permissions remain independent of declaration validity. |
| 12 Friction | Adopted through measured L0 bytes/timings and named unknowns | Operator records measured, proxy or unknown costs; no reconstructed token savings. |
| 13 Improvement | Adapted through bounded operating model and owner-selected lots | Owner authorizes reform and chooses the minimum sufficient audit profile. |
| 14 Profiles | Adapted through ADR-0010 and upward-only route fixtures | Source delivery lanes, client method profiles and THINKING/EXPLORING/COMMITTING modes remain separate. |
| 15 Adoption | Adopted through pinned declaration and preservation/refusal fixtures | Source adoption is scoped; every client independently accepts its own declaration. |

AIDN's source `FAST` remains restricted to recognized historical or non-normative
documents. Public or critical boundaries require `ASSURED`; `EMERGENCY` remains
the existing hotfix overlay. A client's fast path cannot lower source admission.

## Attempt Integrity And Materiality

The pinned addendum 0001 is referenced by commit and hash in the declaration.
Its complete attempt/outcome schemas are not adopted. The following principles
apply prospectively to meaningful validation evidence:

| AOI requirements | Local binding / explicit limit |
|---|---|
| 001, 002, 007, 008 | Name the bounded evaluation and ordered gates; distinguish execution, named gate result, proof, product judgement and failure layer. Existing CI logs remain telemetry; no new general attempt store is claimed. |
| 003 | Identify the changed authority, implementation, environment, method or acceptance condition and affected claims before invalidating their proof. Editorial or observational changes alone do not invalidate unrelated evidence. Integration gates still execute as required by the catalog. |
| 004, 005, 011 | Retain exact earlier records and hashes; append a correction, retry, supersession or retrospective classification with causal references. Sidecars are justified only for historical results material to a current claim. |
| 006, 010 | A product failure requires an executed product-evaluating gate. Missing preparation, permission or environment means the product was not evaluated; uncertain executed observations remain inconclusive. Do not fix product code solely because its test never ran. |
| 009 | Classification, rerun and maintenance costs are measured or unknown. |
| 012 | Failed lookups and incidental commands remain lightweight occurrences unless part of a declared evaluation or promoted for material impact, recurrence or causal significance. |

A correction is not validated merely because it was applied. Preserve that
distinction until a relevant later evaluation links the correction to its
result. Neither this declaration nor registry completeness changes the meaning
of supervised `execution_attempt` or promotes `gate_result` to product state.

## Installed Project Policy

Adapter version 1 may contain an optional `governanceAdoption` object, with its
own `schemaVersion: 1`. Old adapters and generated defaults omit the field.
An installed-project record must declare `scope: "installed-project"`; copying
the source declaration with `scope: "package-source"` is refused.

The record contains `adoptionId`, positive `revision`, explicit `status`, `owner`,
`recordedAt`, pinned `method`, `precedence`, `authorities`, section dispositions
and rationale, control references and human responsibility, `omissions`,
`reviewTriggers`, `history` and optional `replacement`, `changeDecision` and
`extensions`. Store references to domain contracts rather than copied contracts
or secrets. The [validator](../src/core/governance/adoption-policy.mjs) defines
the supported declaration shape; nested JSON extension data is preserved.

`proposed` requires `acceptance: null` and remains non-effective. `accepted`
requires a deciding authority, decision reference, acceptance date and effective
date; adopted/adapted sections can bind only effective authorities. An effective
claim requires an explicit observation date. Structural validity verifies the
declaration, not the authenticity of human acceptance, available material proof
or permission to execute.

Later revisions retain immutable prior-record references and SHA-256. Deprecated,
revoked and superseded declarations require a new revision and change decision;
supersession also names the successor. They are not effective. No automatic
purge, upstream update, instance migration, backend rebind or acceptance occurs.

Prepare a project-owned complete adapter file and use the existing
`aidn project config --adapter-file <file> --json` preview before explicitly
adding `--write` to initialize a missing adapter. That command refuses an
existing destination. Existing policy remains owner-maintained; explicit
adapter migration and the current wizard preserve an existing valid adoption
record. Invalid declarations or unsupported versions fail before a write.
Install/reinstall does not replace a client's adapter or add adoption defaults.
Native installation/upgrade qualification remains L4/L5 work.

The client file stays canonical project policy in `files`, `dual` and `db-only`.
It is not runtime DB state. A valid declaration does not grant activation,
native trust, workflow admission, shared synchronization or publication rights.

## Review, Compatibility And Rollback

Revisions are proposed and explicitly accepted with their changed obligations,
omissions, affected evidence and owner. Pin a new upstream revision deliberately;
do not follow a moving branch at runtime. Preserve former references and hashes.
No full GFD conformance, AOI-schema conformance, universal context budget or
native model-token savings are claimed. External duties and native evidence
require their actual owners and environments.

Rollback uses a superseding or withdrawal decision, preserving prior records and
stopping withdrawn prospective obligations. An older AIDN binary may discard
the optional field during explicit normalization; preserve the raw adapter
before downgrading and avoid rewriting it with such a binary. No existing v1
public JSON root, CLI option, runtime admission or gate obligation changes.

Run `node tools/perf/verify-governance-adoption-fixtures.mjs` for the focused
declaration and adapter tests. The existing governance-completeness gate includes
those checks. Coverage is declaration/source-fixture evidence, not native
client conformance or proof of every domain requirement.
