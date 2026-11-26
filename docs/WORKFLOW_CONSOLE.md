# Workflow console

## Decisions inside Codex

In the installed Windows desktop app, the packaged MCP server presents the
pending STANDARD question in the current Codex conversation. The operator
answers once in the native form using the existing Codex session. Merge
consent identifies the repository, pull request, target branch and full
commit. Each choice uses the same installed software issuer.

Project setup installs the connector through the existing installation
transaction. Supply the protected STANDARD execution configuration along
with the approved issuer policy when it has yet to be installed.

```powershell
aidn project add --target PROJECT --standard-codex-configuration FILE --standard-authorization POLICY --json
aidn project add --target PROJECT --standard-codex-configuration FILE --standard-authorization POLICY --write --expect-plan PLAN_ID --json
```

The same configuration option is available to `aidn install`. A project
already attached to the global engine can add the connector through the same
reviewed project operation. The installed policy may be reused by omitting
the authorization file. The installer checks the project scope and the
issuer for the current chat. It adds a dedicated server in the user Codex
configuration and preserves other entries. Reload the MCP servers in a
desktop session that was already open during its first installation.

The global registration names the stable AIDN launcher. After `aidn update`,
each new call on the open connection uses the active verified package. The
installed key and authorization are preserved. An in-flight decision keeps
its current generation for the call. A workflow instance retains its own
configuration and continuity checks.

The launcher checks that the MCP process was started by the installed
Microsoft Store Codex desktop package. The installed policy identifies
the issuer and conversation. The `session` tool reports enrollment, whether
the call is from the configured chat, and its last accepted receipt.
The `question` tool reads the pending subject.

The `ask` tool takes zero arguments. The issuer uses Codex-owned conversation
metadata and the result returned on the same MCP connection for its outstanding
form request. It signs the linked result in the background. The receipt
binds the conversation, request, exact question, operation and answer.
Closing the form leaves the question pending. A restarted host reuses a
retained answer or reads the existing receipt from the journal.

The trust boundary includes the installed desktop app and the provisioning
service that protects the issuer key. This is software-origin evidence for
the existing session. The form introduces no personal authentication prompt.
Keep the host home and installed launcher outside AIDN work actor access.
For a PostgreSQL process whose desktop environment omits the configured
connection variable, setup can provision `codex-form-database.env` beneath
the protected host home. The file contains only the project database
variable already named by its runtime configuration. The Codex registration
contains paths and arguments and leaves the credential in the protected home.

### Enroll a decision issuer at installation

An authenticated project setup service provisions its administrator's
Ed25519 public key as `project-authorization-admin.pem` in the protected
`AIDN_STANDARD_HOST_HOME`. The home is dedicated to the project and lives
outside the checkout. The setup service keeps its signing authority and the
decision issuer's private key outside the requesting agent.

The service approves a closed `standard-project-authorization.v1` contract
for the resolved project and runtime scope. Each principal contains one public
key, an authority ID, and explicit pairs of question contract and allowed
choices. The initial revision is `1` with `previous_sha256: null`. The next
revision names the digest of the full signed predecessor. The administrator
signs the UTF-8 hex SHA-256 of the canonical unsigned body using Ed25519.
Installation receives only the signed public enrollment data.

```sh
aidn install --target . --standard-authorization approved-project-authorization.json --dry-run
aidn install --target . --standard-authorization approved-project-authorization.json
```

The preview reports the revision and contract digest. The installation
transaction publishes the approved revision after verifying the installation.
Resuming the transaction reuses its validated input. Reapplying the same
revision is idempotent. A signed successor can remove issuers or choices.
Apply it on every execution host for the project. Installation asset rollback
and uninstall leave this administrator-owned authority available.

For the native Windows form, add `"codex_form": {"thread_id": "THREAD_UUID",
"client": "codex-desktop-windows"}` to the issuer principal. Provision its
Ed25519 private key as `codex-form-issuers/AUTHORITY_ID.pem` under the
protected host home. The setup service provisions this key separately from
project content and the administrator key. The launcher reads it only after
checking the desktop client. Enroll the matching public key using the signed
project policy above. An ordinary connector restart reuses the key.

The active authorization checks the exact question contract and choice.
For a form issuer it verifies the signed `codex:form/…/request/…` evidence
for the configured conversation. A principal without `codex_form` uses the
signed Codex message reference described below. The active revision and
digest appear as `project_authorization` in the session status.

A trusted launcher can append `--chat <thread-uuid> <enrolled-human-authority>`
to expose `recover_message`. These two selectors restrict delivery to that
chat and principal. For an existing text answer the Codex client reads the
item through `thread/items/list`. The packaged `readCodexMessageReference`
helper uses two single-item requests and hashes the exact UTF-8 text,
including any trailing newline. The client supplies the resulting
`turn_id`, `message_id` and `content_sha256` together with the original
`operation_id` and `question_sha256`. This path never opens a form.

An independent authenticated integration must attest the author's choice for
that question. It publishes the ordinary signed human `standard-host-source.v1`
at the offered source reference in the protected host inbox. Its signed
`evidence_refs` include exactly one Codex message reference
`codex:thread/<thread-uuid>/turn/<turn-uuid>/message/<message-uuid>` and the
text digest. The workflow host checks the enrolled principal, complete claim,
signature and current question. While the source is missing, recovery returns
`awaiting_attestation` with the required reference and records no decision.
After acceptance, the same lookup reads the matching signed journal result and
process receipt across restarts, even after the transport copy is removed.

### Windows operator key and decision panel

This separate qualification prototype uses a WebAuthn verification for each
panel decision. The native Codex form above uses the installed software issuer
for subsequent choices in the existing conversation.

An administrator can enroll an operator on Windows through an explicit
installation action. A trusted launcher prepares the public enrollment plan
with the packaged `tools/runtime/standard-windows-decisions.mjs` helper.
`--prepare-enrollment` takes the project root, Codex thread UUID, a local port
and a file of question contracts and allowed choices. The plan also binds the
resolved project and runtime scope and the current Windows account.

```sh
aidn install --target . --standard-windows-operator-enrollment windows-enrollment.json --dry-run
aidn install --target . --standard-windows-operator-enrollment windows-enrollment.json --expect-windows-operator-plan SHA256
```

Use the SHA-256 printed by the preview. Windows asks for administrator consent
to install the authority. The same Windows user enrolls the key through the
platform authenticator. The installer obtains the public key from the native
WebAuthn API and records it under an administrator-owned machine registry key.
The workflow receives only public data. Reapplying the same enrollment reuses
the key. A different scope, thread, account or set of choices requires a new
administrator-approved enrollment. Enrollment supplies no business decision.

Pin the returned authority digest in `windows_operator_authority_sha256` in
the STANDARD execution request. The packaged helper starts the loopback panel
with `--serve <project> <standard-configuration> <thread-uuid>`. The launcher
opens its URL in the browser panel of that same Codex chat. The panel presents
the exact pending subject and its authorized choices. The operator chooses
once. Windows can request device verification for the selected action. The
private key stays with the authenticator throughout the workflow.

The workflow host verifies the assertion against the machine enrollment before
publishing the answer and again at the operation boundary. The signed
challenge covers the exact claim, profile, thread, question and source. The
accepted receipt and its canonical journal entry support reopening the panel
without another choice. The signature authenticates an approved panel action.
The separate Codex message recovery path continues to verify message evidence.

The experimental workflow console shares its read model and action service
between the CLI and a local browser dashboard. It requires no dashboard install
or PostgreSQL for human-only workflows. New workflows default to the structured
agentic engine, including models authored directly as JSON. The catalog reads
both agentic and historical sequential records through their own contracts.

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
explicit and exact selectors remain available.
An ID retained in both formats requires `--instance <id> --engine agentic|legacy`
for an exact read. Reads resolve the configured
backend on each request, never fall back to stale visible DB projections, and
do not initialize a missing database. The view is a per-record observation.

A source repository without installed activation can inspect its empty catalog
and reference registry; it cannot create a client instance by implication.
Agentic progress is read with `--instance <id>` from its canonical occurrences
and journal. The `--configuration ... --run ...` live supervisor selector is the
sequential compatibility surface; a canonical cursor alone does not prove native
process liveness.
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

Enter an instance ID in **Instance exacte** to enable **Moteur de l’instance**.
If both engines retain that ID, the dashboard prompts you to choose **Agentique**
or **Historique** and click **Actualiser**. The raw inspection JSON keeps the
`WORKFLOW_ENGINE_AMBIGUOUS` code. Clearing the ID also clears the engine.
Changing the engine invalidates any action preview awaiting confirmation.
If you click **Actualiser** again while a read is in progress, only the latest
click can update the displayed results,
errors and connection status. If that request fails, the dashboard clears the
previous results and their JSON. The error and the selected filters stay visible
so you can retry with **Actualiser**.

The interface first displays observations. The advanced action editor accepts
the same request JSON as the CLI and shows the exact preview. Editing a request
immediately clears its preview and approval. The dashboard ignores late replies
and errors from that preview. Prepare and confirm a fresh preview for the edited
request. Run commands using the sequential lifecycle also require explicit
shared synchronization consent. Ordinary agentic execution retains its local
owned-host admission.
After a lost response,
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
| `initialize` | `instanceId`, `model`, optional `facts` | Default agentic; `--write` and current project activation required |
| `initialize` (compatibility) | `engine: "legacy"`, `instanceId`, `definition`, `context` | Explicit sequential creation; `--write` |
| `signal` | `instanceId`, `expectedSha256`, `event` | Agentic facts/message/cancel only; `--write`; never supplies an assignment or authenticated result |
| `decide` | `instanceId`, `expectedSha256`, `outcome`, `evidence` | `--write`; typed human decision/evidence |
| `prepare-segment` | `instanceId`, `expectedSha256`, `configurationPath`, `planPath` | `--write`; checkpoint intent before run preview |
| `reconcile` | `instanceId`, `expectedSha256` | `--write`; observes existing run, never dispatches |
| `propose` | `definition`, `explanation`, optional `baseInstanceId` | Preview only |
| `activate` | proposal fields plus `expectedPreviewSha256`, `review` | `--write`; exact candidate review required |
| `initialize-selected` | `engine: "legacy"`, `workflowId`, `instanceId`, `expectedSelectionSha256` | Explicit sequential compatibility; `--write`; existing instances stay pinned |
| `run` | `configuration`, `authorization`, optional `command: "workflow-run"` | Default agentic; `--execute` and exact preview; owned runner validates authorization and budgets |
| `run` (compatibility) | Explicit old `command`, `configuration`, `plan` for start or `run` for other commands | Existing supervisor admission and explicit shared sync |

Sequential compatibility command values are `agent-run`, `agent-run-resume`, `agent-run-cancel` and
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
