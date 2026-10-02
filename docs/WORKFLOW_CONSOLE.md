# Workflow console

The experimental workflow console shares its read model and action service
between the CLI and a local browser dashboard. It requires no dashboard install
or PostgreSQL for human-only workflows. Default AIDN execution is unchanged.

## Inspect before acting

```text
aidn runtime workflow-inspect --target <root> --json
aidn runtime workflow-inspect --target <root> --instance <id> --workflow <workflow-id> --json
aidn runtime workflow-inspect --target <root> --configuration <absolute-file> --run <id> --json
```

The output includes canonical selections/revisions, instance steps/transitions,
human evidence, retained run observations, current authorization blockers and
limits. Exact selectors must exist. The default catalog is bounded to 256 file
records per family or the first 10,000 canonical DB artifacts; truncation is
explicit and exact selectors remain available. Reads resolve the configured
backend on each request, never fall back to stale visible DB projections, and
do not initialize a missing database. The view is a per-record observation.

A source repository without installed activation can inspect its empty catalog
and reference registry; it cannot create a client instance by implication.
An unsupported handler remains a blocker. A historical run checkpoint is not a
live observation. Supply the run configuration and ID for current status.
Completed execution, accepted attempts, integration, final validation and
cleanup remain separate; none implies the others.

## Local dashboard

```text
aidn runtime workflow-dashboard --target <root> --json
aidn runtime workflow-dashboard --target <root> --serve --json
```

The first command previews without starting a listener. With `--serve`, the
foreground process returns a loopback URL and a random session token. Open that
URL locally, paste the token, then choose **Actualiser**. The token is kept only
in browser memory; it is not a durable project credential. No browser opens
automatically. The server binds only `127.0.0.1`, serves local assets, checks
Host/Origin/token and rejects cross-origin API calls. Stop the listener with
Ctrl+C. An already admitted run uses its normal status/cancel lifecycle;
closing the dashboard is not proof of process termination or cleanup.

The interface first displays observations. The advanced action editor accepts
the same request JSON as the CLI and shows the exact preview. Editing a request
invalidates its approval. Applying requires explicit confirmation; run commands
also require explicit shared synchronization consent. After a lost response,
inspect canonical state before taking any further action.

## Common action contract

```text
aidn runtime workflow-action --target <root> --request <file.json> --json
aidn runtime workflow-action --target <root> --request <file.json> --write --expect-plan <action_sha256> --json
```

Request shape: `{ "operation": "decide", "input": { ... } }`. Unknown fields,
target overrides and effect flags inside the request are rejected. Preview
returns `action_sha256`, declared effects, the nested service preview and
`can_apply`. Application repeats preview and admission; a changed result cannot
be committed under the old hash. `--json` never authorizes an effect.

| Operation | Input fields | Application |
| --- | --- | --- |
| `initialize` | `instanceId`, `definition`, `context` | `--write`; current project activation required |
| `decide` | `instanceId`, `expectedSha256`, `outcome`, `evidence` | `--write`; typed human decision/evidence |
| `prepare-segment` | `instanceId`, `expectedSha256`, `configurationPath`, `planPath` | `--write`; checkpoint intent before run preview |
| `reconcile` | `instanceId`, `expectedSha256` | `--write`; observes existing run, never dispatches |
| `propose` | `definition`, `explanation`, optional `baseInstanceId` | Preview only |
| `activate` | proposal fields plus `expectedPreviewSha256`, `review` | `--write`; exact candidate review required |
| `initialize-selected` | `workflowId`, `instanceId`, `expectedSelectionSha256` | `--write`; existing instances stay pinned |
| `run` | `command`, `configuration`, `plan` for start or `run` for other commands | Existing supervisor admission and explicit shared sync |

Run command values are `agent-run`, `agent-run-resume`, `agent-run-cancel` and
`agent-run-cleanup`. Start/resume/cancel use `--execute --expect-plan <hash>
--sync-relay`; cleanup uses `--write --expect-plan <hash> --sync-relay`. Here the
hash is the console's complete action hash; the service forwards the nested
supervisor hash to the existing lifecycle. A macro decision never replaces its
native admission. Configurations and plan paths follow the existing commands'
absolute-path and identity rules. Request JSON may be prepared externally;
the console does not automatically generate human approval evidence.

Canonical writes and projections retain the instance/selection recovery rules.
`written: true` with `projection: reconciliation_required` means the checkpoint
already committed; repair the projection explicitly rather than repeat it.
The UI and API add no SQL write route or shared coordination authority.
Fixtures prove these contracts and transport behavior, not native Codex or an
external pilot. Cooperative profile limitations remain visible in supervisor
preconditions and are not upgraded by the dashboard.

Product upgrades preserve retained instances and selections without rewriting
their pins. Inspection still exposes an instance compiled for an older product
version, with `WORKFLOW_INSTANCE_AUTHORITY_CHANGED`; productive instance actions
refuse with `WORKFLOW_INSTANCE_CONTEXT_CHANGED`. Selecting an old-version
definition does not grant migration authority. Initialize a separately reviewed
definition with an explicit context matching the executing package to start a
new instance. See [upgrade guidance](UPGRADE.md) for the version boundary.
