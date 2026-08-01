# Gowire AIDN v0.7.2 governance pilot

Date: 2026-08-01

Audit profile: `STANDARD`

Project context: `personal_agent_driven`

Pilot source: `leuzeus/aidn@v0.7.2`

Gowire baseline: `origin/dev@dc6860e8`

AIDN remediation baseline: `origin/dev@7554468d`

## Isolation and rollback evidence

- Main Gowire checkout: `G:\projets\gowire`; it remained on `dev`, aligned
  `0 0` with `origin/dev`, with only its pre-existing untracked backlog file.
- Disposable pilot: `G:\projets\gowire-aidn-v072-audit`, branch
  `codex/aidn-v072-governance-pilot`, created from the exact Gowire baseline.
- Remediation worktree: `G:\projets\aidn-adaptive-governance-v072`, branch
  `codex/aidn-adaptive-governance-v072`, created from the exact AIDN baseline.
- Gowire backup SHA-256:
  `9BECC92C39FCC1B170BA257E21DD4406971DBA65D29D00DDF26E17CCE8F21065`.
- AIDN backup SHA-256:
  `7C78008A69F5B7F814F3BF8CF9377A98DB6AD8084A96953B89DBE3324FA3837B`.
- Backups and manifests are local recovery artifacts outside both Git
  repositories. No secret, runtime cache, `.aidn/config.json`, or production
  PostgreSQL data was copied into the pilot.

The immutable preview command was:

```powershell
npm exec --yes --package=github:leuzeus/aidn#v0.7.2 -- aidn bootstrap --target G:\projets\gowire-aidn-v072-audit --mode upgrade --profile db-only --source-branch dev --dry-run --json
```

The actual upgrade used the same command without `--dry-run`, only inside the
disposable worktree. The first actual invocation exposed an authentication
compatibility issue with the user's global Codex `service_tier=default`; a
process-scoped configuration shim using a supported tier allowed the isolated
upgrade to complete without changing the user's configuration.

## Evidence loaded

The replay inspected `.aidn/config.json`, `docs/audit/SPEC.md`,
`docs/audit/WORKFLOW.md`, `docs/audit/WORKFLOW-KERNEL.md`,
`docs/audit/CURRENT-STATE.md`, `docs/audit/RUNTIME-STATE.md`,
`docs/audit/HANDOFF-PACKET.md`, `.github/workflows/branch-prune.yml`, and
`tools/workflowpolicy/main.go`. Branch protection was checked against the live
Gowire `dev` ruleset.

## Startup timing series

The v0.7.2 installed-client startup chain was replayed once cold and five times
warm. The chain included context reload, runtime hydration, and start-session
admission.

| Sample | Duration |
|---|---:|
| cold | 26,468 ms |
| warm 1 | 26,459 ms |
| warm 2 | 26,963 ms |
| warm 3 | 25,949 ms |
| warm 4 | 25,728 ms |
| warm 5 | 24,906 ms |

These measurements are reported without an arbitrary pass/fail threshold.

## Four-path replay

| Path | v0.7.2 pilot | Candidate remediation | Files and hooks | Writes observed |
|---|---|---|---|---|
| A — non-normative documentation | `FAIL`: read-only startup still paid the full admission/hydration ceremony; stale visible state could contradict `db-only` | `PASS`: `THINKING` routes to `EXPLORE`; no session/checkpoint or automatic DB sync; projections expose source and freshness | Context reload, hydration, start-session admission; current/runtime/handoff projections | None during read-only candidate fixtures |
| B — bounded reversible fix | `FAIL`: no executable two-file fast boundary and source-branch classification differed between reload and session admission | `PASS`: at most two non-critical paths route to `FAST`; contract/schema/security/shared impacts escalate; configured source classification is shared | Pre-write admission, reload check, start-session admission, adaptive-policy fixtures | Temporary fixture repositories only |
| E — persistence or authority | `FAIL`: configured `db-only` conflicted with a visible `dual` projection and no structured freshness result | `PASS` for routing and projection contracts; production preservation remains `UNAVAILABLE` | Hydration, runtime projection/reanchor, `ASSURED` policy and JSON contracts | No production PostgreSQL writes; final gates cleared live DB environment variables |
| F — publication | `PASS`: Gowire `dev` requires PR, Drone, linear history, and resolved discussions; no bypass exists | `PASS`: source direct writes are always false and work-branch action is explicit | Live GitHub ruleset, branch policy, PR route | AIDN work branch and draft PR only; no direct `dev` write |

## Reproduced defects and disposition

| Defect | Evidence | Disposition |
|---|---|---|
| Bootstrap preview did not execute install prerequisite validation | Preview could report a non-mutating success while the actual install failed before mutation | Dry-run now invokes each real operation with `--dry-run`; negative unauthenticated fixture added |
| Configured source branch not used consistently by reload | Gowire `dev` could be classified as non-compliant by one admission path | Reload and start-session now use the configured source and return `branch_role=source`, `source_direct_writes=false`, and `work_branch_required=true` |
| Visible `db-only` projections could be stale or contradictory | `.aidn/config.json` declared `db-only`; visible state still declared `dual` and an older handoff | Projections expose canonical source, revision/version, generation time, and structured freshness |
| Generated pruning relation described `dev` merged into `dev` | v0.7.2 template retained the self-merge wording | Generator renders distinct configured source/base branches and the workflow rejects equality |
| Text-only policy could be presented as enforced | CI capacity prose had no executable control identifier | Structured rule IDs and enforcement were added; prose without a control ID is informative |
| Product and workflow versions were ambiguous | Generated `workflow_version` mixed product and contract meaning | Additive `product_version` and `workflow_contract_version` fields were added; legacy output remains |

## Validation and remaining evidence

Focused policy, pre-write, project-config, start-session, bootstrap,
no-implicit-write, JSON contract, surface-catalog, governance, and repository
cleanliness gates pass on the candidate. The full pre-commit gate replay's only
failure was the expected dirty-worktree gate; it passed after commit.

Production PostgreSQL preservation remains `UNAVAILABLE`, not inferred. The
Gowire compatibility branch remains deferred until this AIDN change is reviewed,
merged, and published under an immutable release tag.
